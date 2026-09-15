/**
 * CoSlate end-to-end suite.
 *
 * Runs the *built* demo (`apps/demo/dist`) behind a real `vite preview` server
 * and drives a real Chromium with real input events. Every assertion reads
 * `window.__scene` — the live scene document — rather than DOM text, so a
 * passing run means the scene model, the command pipeline, the renderer and the
 * tools all agree.
 *
 *   node tests/e2e/whiteboard.spec.mjs
 *
 * Playwright and Chromium come from the preinstalled sandbox locations declared
 * in the task; override with COSLATE_PLAYWRIGHT / COSLATE_CHROMIUM if needed.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// /dev/shm exists on Linux only; elsewhere let the OS choose its own temp dir.
if (existsSync('/dev/shm')) process.env.TMPDIR = '/dev/shm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ARTIFACTS = path.join(ROOT, '.artifacts');
const DEMO_DIST = path.join(ROOT, 'apps/demo/dist');
const PORT = Number(process.env.COSLATE_E2E_PORT ?? 4321);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const require = createRequire(import.meta.url);

// ------------------------------------------------------------- toolchain lookup
// Playwright is deliberately *not* a workspace dependency: the suite borrows a
// preinstalled copy. Resolve it instead of pinning one machine's absolute path,
// so the suite runs on any host that has it.

function resolvePlaywrightEntry() {
  if (process.env.COSLATE_PLAYWRIGHT) {
    if (!existsSync(process.env.COSLATE_PLAYWRIGHT)) {
      throw new Error(`COSLATE_PLAYWRIGHT points at ${process.env.COSLATE_PLAYWRIGHT}, which does not exist.`);
    }
    return process.env.COSLATE_PLAYWRIGHT;
  }
  const candidates = [];
  for (const specifier of ['playwright', 'playwright-core']) {
    try {
      candidates.push(require.resolve(specifier));
    } catch {
      // not installed locally — try the global prefixes below
    }
  }
  const globalRoots = [];
  try {
    globalRoots.push(
      execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    );
  } catch {
    // npm is not on PATH
  }
  const nvmVersions = path.join(os.homedir(), '.nvm/versions/node');
  if (existsSync(nvmVersions)) {
    for (const version of readdirSync(nvmVersions).sort().reverse()) {
      globalRoots.push(path.join(nvmVersions, version, 'lib/node_modules'));
    }
  }
  for (const root of globalRoots.filter(Boolean)) {
    for (const name of ['playwright', 'playwright-core']) {
      candidates.push(path.join(root, name, 'index.mjs'), path.join(root, name, 'index.js'));
    }
  }
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      `Playwright not found. Install it (npm i -g playwright) or set COSLATE_PLAYWRIGHT to its index.mjs.\nTried:\n  ${candidates.join('\n  ') || '(no candidates)'}`,
    );
  }
  return found;
}

/** Ask Playwright where its Chromium is; fall back to scanning its browser cache. */
function resolveChromiumExecutable(chromium) {
  if (process.env.COSLATE_CHROMIUM) {
    if (!existsSync(process.env.COSLATE_CHROMIUM)) {
      throw new Error(`COSLATE_CHROMIUM points at ${process.env.COSLATE_CHROMIUM}, which does not exist.`);
    }
    return process.env.COSLATE_CHROMIUM;
  }
  try {
    const fromPlaywright = chromium.executablePath();
    if (fromPlaywright && existsSync(fromPlaywright)) return fromPlaywright;
  } catch {
    // no revision resolved from the registry — scan the cache below
  }
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
  const revisions = existsSync(browsersRoot)
    ? readdirSync(browsersRoot)
        .map((entry) => /^chromium(?:-headless_shell)?-(\d+)$/.exec(entry))
        .filter(Boolean)
        .map((match) => Number(match[1]))
        .sort((a, b) => b - a)
    : [];
  const candidates = [];
  for (const revision of revisions) {
    for (const prefix of ['chromium', 'chromium_headless_shell']) {
      for (const [dir, binary] of [
        ['chrome-linux64', 'chrome'],
        ['chrome-linux', 'chrome'],
        ['chrome-linux64', 'headless_shell'],
        ['chrome-linux', 'headless_shell'],
        ['chrome-mac', 'Chromium.app/Contents/MacOS/Chromium'],
        ['chrome-mac-arm64', 'Chromium.app/Contents/MacOS/Chromium'],
        ['chrome-win', 'chrome.exe'],
      ]) {
        candidates.push(path.join(browsersRoot, `${prefix}-${revision}`, dir, binary));
      }
    }
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Chromium not found under ${browsersRoot}. Run \`npx playwright install chromium\` or set COSLATE_CHROMIUM to the browser binary.`,
    );
  }
  return found;
}

const PLAYWRIGHT_ENTRY = resolvePlaywrightEntry();
const { chromium } = await import(pathToFileURL(PLAYWRIGHT_ENTRY).href);
const CHROMIUM_EXECUTABLE = resolveChromiumExecutable(chromium);

// --------------------------------------------------------------------- harness

const results = [];
const screenshots = [];

async function check(id, title, fn) {
  try {
    const detail = await fn();
    results.push({ id, title, ok: true, detail: detail ?? '' });
    console.log(`  PASS  ${id}  ${title}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ id, title, ok: false, detail });
    console.log(`  FAIL  ${id}  ${title} — ${detail}`);
  }
}

async function shot(page, name) {
  const file = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file });
  screenshots.push(file);
  return file;
}

const getScene = (page) => page.evaluate(() => window.__scene.getScene());
const getSelection = (page) => page.evaluate(() => window.__scene.getSelection());
const getViewport = (page) => page.evaluate(() => window.__scene.getViewport());
const getRenderedScale = (page) => page.evaluate(() => window.__scene.getRenderedScale());
const objectsOfType = (scene, type) => scene.order.map((id) => scene.objects[id]).filter((o) => o.type === type);
const round = (value) => Math.round(value * 1000) / 1000;

// --------------------------------------------- page-layer sampling (for R11)
// The page layer is the first canvas of a Konva stage: background rect + grid.
// Assertions read real pixels — "the config object changed" proves nothing
// about what a host's audience sees. Stride 4 keeps a full-canvas pass cheap.

async function samplePageLayer(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.coslate-canvas-host canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    if (!ctx || width === 0 || height === 0) return null;
    const data = ctx.getImageData(0, 0, width, height).data;
    const counts = {};
    let samples = 0;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4;
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        counts[key] = (counts[key] ?? 0) + 1;
        samples += 1;
      }
    }
    let modal = '';
    let modalCount = 0;
    for (const [key, count] of Object.entries(counts)) {
      if (count > modalCount) {
        modal = key;
        modalCount = count;
      }
    }
    return { width, height, samples, modal, modalCount, counts };
  });
}

/** Redraws are rAF-scheduled (`batchDraw`), so poll until the pixels agree. */
async function samplePageLayerUntil(page, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let sample = await samplePageLayer(page);
  while (!sample || !predicate(sample)) {
    if (Date.now() > deadline) break;
    await page.waitForTimeout(50);
    sample = await samplePageLayer(page);
  }
  return sample;
}

/** Count sampled pixels close to a pure grid colour (tolerant for the scaled export raster). */
function countColor(sample, kind) {
  const test =
    kind === 'red'
      ? (r, g, b) => r > 200 && g < 80 && b < 80
      : (r, g, b) => b > 200 && r < 80 && g < 80;
  let total = 0;
  for (const [key, count] of Object.entries(sample.counts)) {
    const [r, g, b] = key.split(',').map(Number);
    if (test(r, g, b)) total += count;
  }
  return total;
}

/** Export a PNG through the public API and sample its pixels (runs in the page). */
async function exportPixels(page) {
  const dataUrl = await page.evaluate(() => window.__scene.editor.exportPNG());
  return page.evaluate((url) => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const counts = {};
        let samples = 0;
        for (let y = 0; y < canvas.height; y += 8) {
          for (let x = 0; x < canvas.width; x += 8) {
            const i = (y * canvas.width + x) * 4;
            const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
            counts[key] = (counts[key] ?? 0) + 1;
            samples += 1;
          }
        }
        let modal = '';
        let modalCount = 0;
        for (const [key, count] of Object.entries(counts)) {
          if (count > modalCount) {
            modal = key;
            modalCount = count;
          }
        }
        resolve({ width: canvas.width, height: canvas.height, samples, modal, modalCount, counts });
      };
      image.onerror = () => reject(new Error('the exported PNG did not decode'));
      image.src = url;
    });
  }, dataUrl);
}

/** Newest mtime under a directory tree, or 0 when it does not exist. */
function newestMtimeMs(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

async function waitForServer(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`preview server did not answer at ${url} within ${timeoutMs}ms (last error: ${lastError})`);
}

// ------------------------------------------------------------------ preview svr

await mkdir(ARTIFACTS, { recursive: true });

// The suite drives the *built* demo, so a missing or stale bundle changes what is
// being tested. Missing is fatal; stale is loud, because that is how a suite
// silently passes against code you already fixed.
const DIST_INDEX = path.join(DEMO_DIST, 'index.html');
if (!existsSync(DIST_INDEX)) {
  console.error(`No built demo at ${DEMO_DIST}.\nRun \`pnpm build\` first — or \`pnpm e2e\`, which builds and then runs this suite.`);
  process.exit(1);
}
const staleDist =
  ['packages/core/src', 'packages/konva/src', 'apps/demo/src']
    .map((relative) => newestMtimeMs(path.join(ROOT, relative)))
    .reduce((a, b) => Math.max(a, b), 0) > statSync(DIST_INDEX).mtimeMs;
if (staleDist) {
  console.warn(
    '\n!! apps/demo/dist is older than the sources — this run tests the previous build.\n' +
      '!! Run `pnpm build` (or `pnpm e2e`, which builds first) before trusting these results.\n',
  );
}

const viteBin = path.join(ROOT, 'node_modules/.bin/vite');
const preview = spawn(viteBin, ['preview', '--port', String(PORT), '--strictPort'], {
  cwd: path.join(ROOT, 'apps/demo'),
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let previewLog = '';
preview.stdout.on('data', (chunk) => {
  previewLog += chunk.toString();
});
preview.stderr.on('data', (chunk) => {
  previewLog += chunk.toString();
});

let exitCode = 1;
let browser;
const pageErrors = [];

try {
  await waitForServer(BASE_URL);
  console.log(`\nCoSlate e2e — serving ${BASE_URL} from apps/demo/dist`);
  console.log(`  chromium:   ${CHROMIUM_EXECUTABLE}`);
  console.log(`  playwright: ${PLAYWRIGHT_ENTRY}\n`);

  browser = await chromium.launch({
    executablePath: CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    acceptDownloads: true,
    deviceScaleFactor: 1,
    // Pin the browser locale: the demo resolves its language from
    // `navigator.languages`, and the assertions below are written in English.
    locale: 'en-US',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });
  await page.waitForSelector('#canvas-host canvas');

  const box = await page.locator('#canvas-host').boundingBox();
  assert.ok(box && box.width > 200 && box.height > 200, 'canvas host has a usable size');
  const at = (x, y) => ({ x: box.x + x, y: box.y + y });
  const state = {};

  // ---------------------------------------------------------------- a. pen
  await check('a', 'pen drag creates exactly one freehand.stroke with >= 5 points', async () => {
    await page.click('[data-testid="tool-pen"]');
    const from = at(220, 200);
    const to = at(320, 280);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 14 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__scene.getScene().order.length === 1);

    const scene = await getScene(page);
    const strokes = objectsOfType(scene, 'freehand.stroke');
    assert.equal(scene.order.length, 1, `expected 1 object in the scene, found ${scene.order.length}`);
    assert.equal(strokes.length, 1, 'expected exactly one freehand.stroke');
    const points = strokes[0].data.points;
    assert.ok(Array.isArray(points), 'stroke data.points is an array');
    assert.ok(
      points.length / 2 >= 5,
      `expected at least 5 points, found ${points.length / 2}`,
    );
    state.strokeId = strokes[0].id;
    await shot(page, 'a-pen-stroke');
    return `${points.length / 2} points, bbox ${round(strokes[0].width)}x${round(strokes[0].height)}`;
  });

  // ---------------------------------------------------------------- b. rect
  await check('b', 'rect tool drag creates a shape.rect matching the drag', async () => {
    await page.click('[data-testid="tool-rect"]');
    const from = at(500, 200);
    const to = at(660, 320);
    const dragWidth = to.x - from.x;
    const dragHeight = to.y - from.y;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__scene.getScene().order.length === 2);

    const scene = await getScene(page);
    const rects = objectsOfType(scene, 'shape.rect');
    assert.equal(rects.length, 1, 'expected exactly one shape.rect');
    const rect = rects[0];
    assert.ok(
      Math.abs(rect.width - dragWidth) <= 2,
      `rect.width ${round(rect.width)} does not match drag width ${dragWidth}`,
    );
    assert.ok(
      Math.abs(rect.height - dragHeight) <= 2,
      `rect.height ${round(rect.height)} does not match drag height ${dragHeight}`,
    );

    const world = await page.evaluate(
      ([x, y]) => window.__scene.screenToWorld(x, y),
      [from.x - box.x, from.y - box.y],
    );
    assert.ok(Math.abs(rect.x - world.x) <= 2, `rect.x ${round(rect.x)} vs drag origin ${round(world.x)}`);
    assert.ok(Math.abs(rect.y - world.y) <= 2, `rect.y ${round(rect.y)} vs drag origin ${round(world.y)}`);
    state.rectId = rect.id;
    state.rectBefore = { x: rect.x, y: rect.y };
    await shot(page, 'b-rect');
    return `rect ${round(rect.width)}x${round(rect.height)} at (${round(rect.x)}, ${round(rect.y)})`;
  });

  // -------------------------------------------------------- c. select + move
  await check('c', 'select tool click selects the rect and dragging moves it by +100/+50', async () => {
    await page.click('[data-testid="tool-select"]');
    const inside = at(560, 250);
    await page.mouse.click(inside.x, inside.y);
    const selection = await getSelection(page);
    assert.deepEqual(selection, [state.rectId], `expected the rect to be selected, got ${JSON.stringify(selection)}`);

    const grab = at(560, 250);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 100, grab.y + 50, { steps: 10 });
    await page.mouse.up();

    const scene = await getScene(page);
    const rect = scene.objects[state.rectId];
    const dx = rect.x - state.rectBefore.x;
    const dy = rect.y - state.rectBefore.y;
    assert.ok(Math.abs(dx - 100) <= 2, `expected dx ~100, measured ${round(dx)}`);
    assert.ok(Math.abs(dy - 50) <= 2, `expected dy ~50, measured ${round(dy)}`);
    state.rectMoved = { x: rect.x, y: rect.y };
    await shot(page, 'c-moved');
    return `moved by (${round(dx)}, ${round(dy)})`;
  });

  // ------------------------------------------------------------ d. undo/redo
  await check('d', 'Ctrl+Z restores the position and Ctrl+Shift+Z moves it again', async () => {
    await page.keyboard.press('Control+z');
    const undone = (await getScene(page)).objects[state.rectId];
    assert.ok(
      Math.abs(undone.x - state.rectBefore.x) <= 0.001 && Math.abs(undone.y - state.rectBefore.y) <= 0.001,
      `undo did not restore the position: (${round(undone.x)}, ${round(undone.y)}) vs (${round(state.rectBefore.x)}, ${round(state.rectBefore.y)})`,
    );

    await page.keyboard.press('Control+Shift+z');
    const redone = (await getScene(page)).objects[state.rectId];
    assert.ok(
      Math.abs(redone.x - state.rectMoved.x) <= 0.001 && Math.abs(redone.y - state.rectMoved.y) <= 0.001,
      `redo did not reapply the move: (${round(redone.x)}, ${round(redone.y)}) vs (${round(state.rectMoved.x)}, ${round(state.rectMoved.y)})`,
    );
    await shot(page, 'd-redo');
    return `undo -> (${round(undone.x)}, ${round(undone.y)}), redo -> (${round(redone.x)}, ${round(redone.y)})`;
  });

  // ----------------------------------------------------------------- e. zoom
  await check('e', 'zoom in raises viewport.scale and the rendered canvas scale', async () => {
    const before = await getViewport(page);
    const beforeRendered = await getRenderedScale(page);
    const beforeSize = await page.evaluate((id) => window.__scene.getRenderedSize(id), state.rectId);

    await page.click('[data-testid="zoom-in"]');
    await page.waitForFunction((scale) => window.__scene.getViewport().scale > scale, before.scale);

    const after = await getViewport(page);
    const afterRendered = await getRenderedScale(page);
    const afterSize = await page.evaluate((id) => window.__scene.getRenderedSize(id), state.rectId);

    assert.ok(after.scale > before.scale, `viewport.scale did not increase (${before.scale} -> ${after.scale})`);
    assert.ok(
      afterRendered > beforeRendered + 1e-6,
      `rendered scale did not increase (${beforeRendered} -> ${afterRendered})`,
    );
    assert.ok(
      Math.abs(afterRendered - after.scale) < 1e-6,
      `rendered scale ${afterRendered} should track viewport.scale ${after.scale}`,
    );
    const growth = afterSize.width / beforeSize.width;
    assert.ok(
      Math.abs(growth - after.scale / before.scale) < 0.02,
      `rendered pixel width grew by ${round(growth)}x but zoom grew by ${round(after.scale / before.scale)}x`,
    );

    // Wheel zoom (no modifier) and two-finger pan both work over the canvas.
    const beforeWheel = await getViewport(page);
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.wheel(0, -240);
    const afterWheel = await getViewport(page);
    assert.ok(afterWheel.scale > beforeWheel.scale, 'plain wheel did not zoom in');

    const beforePan = await getViewport(page);
    await page.mouse.wheel(80, 0);
    const afterPan = await getViewport(page);
    assert.ok(
      Math.abs(afterPan.x - beforePan.x) > 0.5 && afterPan.scale === beforePan.scale,
      'horizontal (two-finger) wheel did not pan without zooming',
    );

    await shot(page, 'e-zoomed');
    return `scale ${round(before.scale)} -> ${round(after.scale)}, rendered ${round(beforeRendered)} -> ${round(afterRendered)}, wheel -> ${round(afterWheel.scale)}`;
  });

  // ----------------------------------------------------------------- f. text
  await check('f', 'text tool commits exactly one shape.text with the typed content', async () => {
    await page.click('[data-testid="tool-text"]');
    const spot = at(760, 480);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForSelector('textarea.coslate-text-overlay', { timeout: 5000 });
    await page.keyboard.type('Hello CoSlate');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      () => Object.values(window.__scene.getScene().objects).some((o) => o.type === 'shape.text'),
      null,
      { timeout: 5000 },
    );
    const scene = await getScene(page);
    const texts = objectsOfType(scene, 'shape.text');
    assert.equal(texts.length, 1, `expected exactly one shape.text, found ${texts.length}`);
    assert.equal(texts[0].data.text, 'Hello CoSlate', `unexpected text "${texts[0].data.text}"`);
    assert.ok(texts[0].width > 0 && texts[0].height > 0, 'text object has a measured size');
    state.textId = texts[0].id;
    await shot(page, 'f-text');
    return `"${texts[0].data.text}" at (${round(texts[0].x)}, ${round(texts[0].y)})`;
  });

  // ------------------------------------------------------------------- g. PNG
  await check('g', 'export PNG produces a download larger than 1000 bytes', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.click('[data-testid="export-png"]'),
    ]);
    const file = await download.path();
    assert.ok(file, 'download has a local path');
    const info = await stat(file);
    assert.ok(info.size > 1000, `PNG download was only ${info.size} bytes`);
    const bytes = await readFile(file);
    const signature = bytes.subarray(0, 8).toString('hex');
    assert.equal(signature, '89504e470d0a1a0a', 'download is not a PNG');
    state.pngBytes = info.size;
    await writeFile(path.join(ARTIFACTS, 'g-exported-scene.png'), bytes);
    await shot(page, 'g-export');
    return `${download.suggestedFilename()} — ${info.size} bytes, valid PNG signature`;
  });

  // ------------------------------------------------------------------ h. JSON
  await check('h', 'save JSON round-trips the live scene object ids and types', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.click('[data-testid="save-json"]'),
    ]);
    const file = await download.path();
    assert.ok(file, 'download has a local path');
    const text = await readFile(file, 'utf8');
    const document = JSON.parse(text);
    const live = await getScene(page);

    assert.equal(document.format, 'coslate/scene', 'saved document has the format tag');
    assert.equal(document.version, 2, 'saved document is version 2 (camera left the document)');
    assert.equal('viewport' in document, false, 'the saved document must not carry a camera');
    assert.deepEqual(document.order, live.order, 'saved paint order matches the live scene');
    assert.deepEqual(
      Object.keys(document.objects).sort(),
      Object.keys(live.objects).sort(),
      'saved object ids match the live scene',
    );
    for (const id of live.order) {
      assert.equal(document.objects[id].type, live.objects[id].type, `type mismatch for ${id}`);
    }
    assert.equal(document.objects[live.order[0]].data.points !== undefined, true, 'stroke points survived the round-trip');
    state.savedObjects = live.order.length;
    await shot(page, 'h-json');
    return `${live.order.length} objects, ${text.length} bytes of JSON, ids and types identical`;
  });

  // ------------------------------------------------------------- extras
  await check('i', 'one gesture is one undo step (stroke + text + move)', async () => {
    const before = await getScene(page);
    const depth = await page.evaluate(() => window.__scene.store.historyDepth().undo);
    await page.click('[data-testid="tool-pen"]');
    await page.mouse.move(box.x + 200, box.y + 500);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 560, { steps: 10 });
    await page.mouse.up();
    const after = await getScene(page);
    assert.equal(after.order.length, before.order.length + 1, 'the stroke was added');
    const depthAfter = await page.evaluate(() => window.__scene.store.historyDepth().undo);
    assert.equal(depthAfter, depth + 1, `a whole stroke must be one undo step (${depth} -> ${depthAfter})`);
    await page.keyboard.press('Control+z');
    const undone = await getScene(page);
    assert.equal(undone.order.length, before.order.length, 'undo removed the whole stroke');
    return `history depth ${depth} -> ${depthAfter}, one undo removed the stroke`;
  });

  await check('j', 'eraser drag deletes objects as a single undo step', async () => {
    // Frame everything first: the previous check left the camera zoomed in.
    await page.evaluate(() => window.__scene.fit());
    await page.click('[data-testid="tool-eraser"]');
    const scene = await getScene(page);
    const stroke = scene.objects[state.strokeId];
    assert.ok(stroke, 'the pen stroke is still present');
    const spot = await page.evaluate(
      ([x, y]) => window.__scene.worldToScreen(x, y),
      [stroke.x + stroke.width / 2, stroke.y + stroke.height / 2],
    );
    assert.ok(
      spot.x > 4 && spot.y > 4 && spot.x < box.width - 4 && spot.y < box.height - 4,
      `the stroke centre is off-canvas at (${round(spot.x)}, ${round(spot.y)})`,
    );
    await page.mouse.move(box.x + spot.x, box.y + spot.y);
    await page.mouse.down();
    await page.mouse.up();
    const after = await getScene(page);
    assert.equal(after.objects[state.strokeId], undefined, 'the stroke was not erased');
    await page.keyboard.press('Control+z');
    const restored = await getScene(page);
    assert.ok(restored.objects[state.strokeId], 'undo did not restore the erased stroke');
    await shot(page, 'j-erase');
    return 'stroke erased and restored by a single undo';
  });

  await check('k', 'the page reported no uncaught errors', async () => {
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    return 'no console errors, no uncaught exceptions';
  });

  // ------------------------------------------------- l. shapes, style, tools
  await check('l', 'ellipse / line / arrow render, and style applies to the selection', async () => {
    const before = (await getScene(page)).order.length;
    await page.click('[data-testid="tool-ellipse"]');
    let from = at(180, 560);
    let to = at(280, 640);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();

    await page.click('[data-testid="tool-line"]');
    from = at(340, 560);
    to = at(440, 640);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();

    await page.click('[data-testid="tool-arrow"]');
    from = at(500, 560);
    to = at(600, 640);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();

    const scene = await getScene(page);
    assert.equal(scene.order.length, before + 3, 'three shapes were created');
    assert.equal(objectsOfType(scene, 'shape.ellipse').length, 1, 'one ellipse');
    assert.equal(objectsOfType(scene, 'shape.line').length, 1, 'one line');
    assert.equal(objectsOfType(scene, 'shape.arrow').length, 1, 'one arrow');
    const arrow = objectsOfType(scene, 'shape.arrow')[0];
    assert.equal(arrow.data.points.length, 4, 'arrow has a two-point path');
    assert.ok(arrow.data.pointerLength > 0, 'arrow has an arrowhead');

    // Style: select the arrow, change stroke colour and width.
    await page.click('[data-testid="tool-select"]');
    await page.evaluate((id) => window.__scene.editor.setSelection([id]), arrow.id);
    await page.click('[data-testid="stroke-ff6b6b"]');
    await page.click('[data-testid="width-8"]');
    const styled = (await getScene(page)).objects[arrow.id];
    assert.equal(styled.data.stroke, '#ff6b6b', 'stroke colour applied to the selection');
    assert.equal(styled.data.strokeWidth, 8, 'stroke width applied to the selection');

    // ...and the same style is used for the next created object.
    await page.click('[data-testid="tool-rect"]');
    from = at(660, 560);
    to = at(740, 640);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const newest = (await getScene(page)).objects[(await getScene(page)).order.slice(-1)[0]];
    assert.equal(newest.data.stroke, '#ff6b6b', 'new object inherited the stroke colour');
    assert.equal(newest.data.strokeWidth, 8, 'new object inherited the stroke width');
    await shot(page, 'l-shapes');
    return 'ellipse + line + arrow created, style applied to selection and to the next object';
  });

  // ------------------------------------------------- m. duplicate & z-order
  await check('m', 'duplicate creates a copy and front/back change paint order', async () => {
    await page.click('[data-testid="tool-select"]');
    const scene = await getScene(page);
    const target = scene.objects[state.rectId];
    await page.evaluate((id) => window.__scene.editor.setSelection([id]), target.id);
    const countBefore = scene.order.length;

    await page.click('[data-testid="duplicate"]');
    const afterDuplicate = await getScene(page);
    assert.equal(afterDuplicate.order.length, countBefore + 1, 'duplicate added one object');
    const selection = await getSelection(page);
    assert.equal(selection.length, 1, 'the duplicate is selected');
    const copy = afterDuplicate.objects[selection[0]];
    assert.equal(copy.type, target.type, 'the copy has the same type');
    assert.equal(copy.x, target.x + 16, 'the copy is offset by 16 world units');
    assert.equal(copy.width, target.width, 'the copy keeps its size');

    await page.click('[data-testid="front"]');
    const front = await getScene(page);
    assert.equal(front.order[front.order.length - 1], copy.id, 'bring-to-front moved it last');
    await page.click('[data-testid="back"]');
    const back = await getScene(page);
    assert.equal(back.order[0], copy.id, 'send-to-back moved it first');
    assert.equal(back.objects[copy.id].z, 0, 'denormalised z follows the order array');
    await shot(page, 'm-order');
    return `duplicated ${target.type}, order ${back.order.length} deep, z renumbered`;
  });

  // ------------------------------------------------- n. transformer resize
  await check('n', 'the Konva transformer resizes the selection through a real drag', async () => {
    await page.click('[data-testid="tool-select"]');
    await page.evaluate(() => window.__scene.fit());
    const scene = await getScene(page);
    const target = scene.objects[state.rectId];
    await page.evaluate((id) => window.__scene.editor.setSelection([id]), target.id);

    const corner = await page.evaluate(
      ([x, y]) => window.__scene.worldToScreen(x, y),
      [target.x + target.width, target.y + target.height],
    );
    const scale = (await getViewport(page)).scale;
    const grab = { x: box.x + corner.x, y: box.y + corner.y };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 120, grab.y + 60, { steps: 12 });
    await page.mouse.up();

    const resized = (await getScene(page)).objects[state.rectId];
    const expectedWidth = target.width + 120 / scale;
    const expectedHeight = target.height + 60 / scale;
    assert.ok(
      Math.abs(resized.width - expectedWidth) <= 4,
      `width after resize ${round(resized.width)}, expected ~${round(expectedWidth)}`,
    );
    assert.ok(
      Math.abs(resized.height - expectedHeight) <= 4,
      `height after resize ${round(resized.height)}, expected ~${round(expectedHeight)}`,
    );
    assert.equal(resized.scaleX, 1, 'scale is baked into width, not left on the node');
    assert.equal(resized.scaleY, 1, 'scale is baked into height, not left on the node');
    assert.ok(
      Math.abs(resized.x - target.x) < 0.01 && Math.abs(resized.y - target.y) < 0.01,
      `the anchor corner moved: (${round(target.x)}, ${round(target.y)}) -> (${round(resized.x)}, ${round(resized.y)})`,
    );
    await shot(page, 'n-resize');
    return `${round(target.width)}x${round(target.height)} -> ${round(resized.width)}x${round(resized.height)}`;
  });

  // ------------------------------------------------------- o. autosave cycle
  await check('o', 'autosave to localStorage survives a reload', async () => {
    const before = await getScene(page);
    await page.waitForTimeout(600); // autosave is debounced
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });
    const after = await getScene(page);
    assert.deepEqual(after.order, before.order, 'object order survived the reload');
    for (const id of before.order) {
      assert.equal(after.objects[id].type, before.objects[id].type, `type of ${id} survived`);
    }
    await shot(page, 'o-restored');
    return `${after.order.length} objects restored from localStorage`;
  });

  // ------------------------------------------------------------ p. load JSON
  await check('p', 'load JSON replaces the scene from a file', async () => {
    const doc = {
      format: 'coslate/scene',
      version: 1,
      viewport: { x: 0, y: 0, scale: 1 },
      objects: {
        loaded: {
          id: 'loaded',
          type: 'shape.rect',
          version: 1,
          x: 40,
          y: 40,
          width: 220,
          height: 140,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          z: 0,
          visible: true,
          locked: false,
          data: { fill: null, stroke: '#51cf66', strokeWidth: 4, cornerRadius: 0 },
        },
      },
      order: ['loaded'],
    };
    const file = path.join(ARTIFACTS, 'p-load.json');
    await writeFile(file, JSON.stringify(doc, null, 2));
    await page.setInputFiles('[data-testid="load-file"]', file);
    await page.waitForFunction(() => window.__scene.getScene().order.length === 1, null, { timeout: 5000 });

    const scene = await getScene(page);
    assert.deepEqual(scene.order, ['loaded'], 'the loaded scene replaced the old one');
    assert.equal(scene.objects.loaded.data.stroke, '#51cf66', 'loaded object kept its style');
    assert.equal(await page.evaluate(() => window.__scene.store.canUndo()), false, 'loading resets history');
    await shot(page, 'p-loaded');
    return 'scene replaced from file, history reset';
  });

  // ------------------------------------------------------- q. toolbar shape
  await check('q', 'the toolbar is icon-only, labelled, and explains itself on hover', async () => {
    const audit = await page.evaluate(() => {
      const iconOnly = [
        'tool-select', 'tool-pen', 'tool-eraser', 'tool-rect', 'tool-ellipse', 'tool-line', 'tool-arrow', 'tool-text',
        'undo', 'redo', 'zoom-out', 'zoom-in', 'zoom-fit',
        'delete', 'duplicate', 'front', 'back',
        'export-png', 'save-json', 'load-json', 'clear',
      ];
      const problems = [];
      for (const id of iconOnly) {
        const node = document.querySelector(`[data-testid="${id}"]`);
        if (!node) {
          problems.push(`${id}: missing`);
          continue;
        }
        if (!node.querySelector('svg')) problems.push(`${id}: no icon`);
        if (!node.getAttribute('aria-label')) problems.push(`${id}: no accessible name`);
        if ((node.textContent ?? '').trim() !== '') problems.push(`${id}: expected icon-only, found text`);
      }
      const zoom = document.querySelector('[data-testid="zoom-reset"]');
      if (!zoom || !/%$/.test((zoom.textContent ?? '').trim())) problems.push('zoom-reset: no percentage readout');
      if (!zoom?.getAttribute('aria-label')) problems.push('zoom-reset: no accessible name');
      return { icons: iconOnly.length, groups: document.querySelectorAll('.toolbar-group').length, problems };
    });
    assert.deepEqual(audit.problems, [], `toolbar problems: ${audit.problems.join(' | ')}`);

    await page.hover('[data-testid="tool-arrow"]');
    const tooltip = page.locator('.tooltip');
    await tooltip.waitFor({ state: 'visible', timeout: 3000 });
    const label = ((await tooltip.locator('.tooltip-label').textContent()) ?? '').trim();
    const hint = ((await tooltip.locator('.tooltip-hint').textContent()) ?? '').trim();
    assert.equal(label, 'Arrow', `hover hint named "${label}" instead of the tool`);
    assert.equal(hint, 'A', `hover hint carried "${hint}" instead of the shortcut`);
    await shot(page, 'q-toolbar');
    return `${audit.icons} icon-only controls in ${audit.groups} groups, hover hint "${label} ${hint}"`;
  });

  // --------------------------------------------------- r. narrow arrangement
  await check('r', 'every toolbar control stays reachable and unclipped down to 320px', async () => {
    const widths = [1024, 768, 560, 480, 420, 360, 320];
    const problems = [];
    const heights = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 820 });
      await page.waitForTimeout(80);
      const audit = await page.evaluate(() => {
        const viewport = window.innerWidth;
        const issues = [];
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          issues.push('page scrolls horizontally');
        }
        // Only real controls: the hidden <input type="file"> is meant to be 0x0.
        for (const node of document.querySelectorAll('#toolbar button[data-testid], #toolbar select[data-testid]')) {
          const box = node.getBoundingClientRect();
          const id = node.getAttribute('data-testid');
          if (box.width === 0 || box.height === 0) {
            issues.push(`${id}: collapsed`);
          } else if (box.left < -0.5 || box.right > viewport + 0.5) {
            issues.push(`${id}: outside the viewport (${Math.round(box.left)}..${Math.round(box.right)})`);
          }
        }
        const bar = document.querySelector('#statusbar');
        if (bar && bar.scrollWidth > bar.clientWidth + 1) issues.push('status bar overflows');
        const canvas = document.querySelector('#canvas-host');
        return {
          issues,
          canvasHeight: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0,
          groups: document.querySelectorAll('.toolbar-group').length,
        };
      });
      for (const issue of audit.issues) problems.push(`${width}px ${issue}`);
      if (audit.canvasHeight < 300) problems.push(`${width}px toolbar left only ${audit.canvasHeight}px of canvas`);
      if (audit.groups !== 7) problems.push(`${width}px lost a toolbar group (${audit.groups}/7)`);
      heights.push(`${width}:${audit.canvasHeight}`);
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    assert.deepEqual(problems, [], `narrow-layout problems: ${problems.join(' | ')}`);
    return `7 widths, 320-1024px, all 21 controls reachable; canvas height ${heights.join(' ')}`;
  });

  // ------------------------------------------------------------------ s. i18n
  await check('s', 'switching locale translates the chrome, flips dir, and survives a reload', async () => {
    const keyPattern = /^(group|tool|action|zoom|file|style|status|language)\.[A-Za-z.]+$/;

    const readLocale = () =>
      page.evaluate(() => ({
        locale: window.__i18n.locale,
        dir: window.__i18n.dir,
        lang: document.documentElement.lang,
        htmlDir: document.documentElement.dir,
        title: document.title,
      }));

    const start = await readLocale();
    assert.equal(start.locale, 'en', `expected the default locale to be en, got ${start.locale}`);
    assert.equal(start.htmlDir, 'ltr', 'English should be left-to-right');
    assert.match(start.title, /demo whiteboard/, 'the document title should be English');

    await page.selectOption('[data-testid="locale-select"]', 'zh-CN');
    await page.waitForFunction(() => window.__i18n.locale === 'zh-CN');
    const zh = await readLocale();
    assert.equal(zh.lang, 'zh-CN', 'the <html lang> attribute should follow the locale');
    assert.equal(zh.htmlDir, 'ltr', 'Chinese is left-to-right');
    assert.equal(zh.title, 'CoSlate — 演示白板', `unexpected title "${zh.title}"`);

    const zhChrome = await page.evaluate(() => ({
      pen: document.querySelector('[data-testid="tool-pen"]').getAttribute('aria-label'),
      group: document.querySelector('.toolbar-group').getAttribute('aria-label'),
      toolLabel: document.querySelector('#statusbar .status-label').textContent,
      message: document.querySelector('.status-message').textContent,
      select: document.querySelector('[data-testid="locale-select"]').selectedOptions[0].textContent,
    }));
    assert.equal(zhChrome.pen, '画笔 (P)', `pen aria-label was "${zhChrome.pen}"`);
    assert.equal(zhChrome.group, '工具', `first group aria-label was "${zhChrome.group}"`);
    assert.equal(zhChrome.toolLabel, '工具', `status label was "${zhChrome.toolLabel}"`);
    assert.ok(zhChrome.message.length > 0 && !keyPattern.test(zhChrome.message), `status message leaked a key: "${zhChrome.message}"`);
    // The menu shows each language in its own language, per CLDR.
    assert.match(zhChrome.select, /中文/, `language menu showed "${zhChrome.select}"`);

    await page.hover('[data-testid="tool-rect"]');
    await page.locator('.tooltip').waitFor({ state: 'visible' });
    const zhHint = await page.evaluate(() => ({
      label: document.querySelector('.tooltip-label').textContent,
      hint: document.querySelector('.tooltip-hint').textContent,
    }));
    assert.equal(zhHint.label, '矩形', `hover hint was "${zhHint.label}"`);
    assert.equal(zhHint.hint, 'R', 'the shortcut badge is not translated');

    assert.match(page.url(), /[?&]lang=zh-CN\b/, `the URL should carry the choice: ${page.url()}`);

    // Arabic is the right-to-left proof: the chrome must mirror, not just translate.
    await page.selectOption('[data-testid="locale-select"]', 'ar');
    await page.waitForFunction(() => window.__i18n.locale === 'ar');
    const ar = await readLocale();
    assert.equal(ar.dir, 'rtl', 'Arabic should resolve to right-to-left');
    assert.equal(ar.htmlDir, 'rtl', 'the <html dir> attribute should be rtl');

    const mirrored = await page.evaluate(() => {
      const viewport = window.innerWidth;
      const group = document.querySelector('.toolbar-group').getBoundingClientRect();
      const select = document.querySelector('[data-testid="locale-select"]').getBoundingClientRect();
      return {
        groupLeft: Math.round(group.left),
        selectLeft: Math.round(select.left),
        viewport,
      };
    });
    assert.ok(
      mirrored.groupLeft > mirrored.viewport / 2,
      `in RTL the first tool group should sit on the right, found left=${mirrored.groupLeft}`,
    );
    assert.ok(
      mirrored.selectLeft < mirrored.viewport / 2,
      `in RTL the language menu should sit on the left, found left=${mirrored.selectLeft}`,
    );
    await shot(page, 's-rtl');

    // The choice is remembered, and it comes back as RTL after a full reload.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__i18n));
    const reloaded = await readLocale();
    assert.equal(reloaded.locale, 'ar', 'the locale should survive a reload');
    assert.equal(reloaded.htmlDir, 'rtl', 'direction should survive a reload');
    assert.equal(await page.evaluate(() => localStorage.getItem(window.__i18n.storageKey)), 'ar', 'the choice is persisted');

    // Back to English, and clean up the URL parameter the switcher wrote.
    await page.selectOption('[data-testid="locale-select"]', 'en');
    await page.waitForFunction(() => window.__i18n.locale === 'en');
    const restored = await readLocale();
    assert.equal(restored.htmlDir, 'ltr', 'switching back should restore ltr');
    assert.match(restored.title, /demo whiteboard/, 'the title should be English again');

    const leaks = await page.evaluate((pattern) => {
      const key = new RegExp(pattern);
      const problems = [];
      for (const node of document.querySelectorAll('#toolbar [aria-label], #statusbar span, #statusbar strong')) {
        const label = node.getAttribute('aria-label') ?? '';
        const text = (node.textContent ?? '').trim();
        if (key.test(label)) problems.push(`untranslated aria-label: ${label}`);
        if (key.test(text)) problems.push(`untranslated text: ${text}`);
      }
      return problems;
    }, keyPattern.source);
    assert.deepEqual(leaks, [], `untranslated strings leaked into the UI: ${leaks.join(' | ')}`);

    return `${start.locale} → zh-CN → ar (rtl, mirrored, persisted) → en; no untranslated keys`;
  });

  // ------------------------------------------- t. language resolution + copy
  await check('t', '?lang= resolves by likely subtags, and runtime copy is localized', async () => {
    // A bare `zh` maximizes to zh-Hans-CN, so it must land on Simplified.
    await page.goto(`${BASE_URL}?lang=zh`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__i18n));
    assert.equal(await page.evaluate(() => window.__i18n.locale), 'zh-CN', 'bare `zh` should resolve to zh-CN');

    // `zh-TW` is really `zh-Hant-TW`: likely subtags must pick Traditional, not
    // the Simplified catalog that happens to be declared first.
    await page.goto(`${BASE_URL}?lang=zh-TW`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__i18n));
    const tw = await page.evaluate(() => ({
      locale: window.__i18n.locale,
      url: window.location.search,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      languages: window.__i18n.languages.map((language) => language.label),
    }));
    assert.equal(tw.locale, 'zh-Hant', `zh-TW resolved to ${tw.locale}`);
    assert.equal(tw.title, 'CoSlate — 示範白板', `unexpected title "${tw.title}"`);
    assert.match(tw.description, /示範/, `the meta description did not follow: "${tw.description}"`);
    assert.ok(tw.languages.includes('繁體中文'), `menu lacks the endonym: ${tw.languages.join(' / ')}`);
    // The URL keeps the *preference* (`zh-TW`); the app renders the *resolution*
    // (`zh-Hant`). Rewriting the request would lose the user's actual intent the
    // day a `zh-TW` catalog is added.
    assert.match(tw.url, /lang=zh-TW\b/, `the URL should keep the request: ${tw.url}`);

    // The runtime ships no copy: the text tool's placeholder comes from the catalog.
    await page.click('[data-testid="tool-text"]');
    const host = await page.locator('#canvas-host').boundingBox();
    await page.mouse.click(host.x + 220, host.y + 220);
    await page.waitForSelector('textarea.coslate-text-overlay', { timeout: 5000 });
    const field = await page.evaluate(() => {
      const textarea = document.querySelector('textarea.coslate-text-overlay');
      return { placeholder: textarea.getAttribute('placeholder'), ariaLabel: textarea.getAttribute('aria-label') };
    });
    assert.equal(field.placeholder, '輸入文字…', `text placeholder was "${field.placeholder}"`);
    assert.equal(field.ariaLabel, '編輯文字', `text accessible name was "${field.ariaLabel}"`);
    await page.keyboard.press('Escape');
    await shot(page, 't-zh-hant');
    return `zh → zh-CN, zh-TW → zh-Hant, field "${field.ariaLabel}"/"${field.placeholder}", ${tw.languages.length} languages`;
  });

  // ------------------------------------------------- u. read-only (R1 / R2)
  await check('u', 'read-only refuses every local mutation, keeps the camera live, and leaves no tool state', async () => {
    const record = {
      id: 'remote-1',
      type: 'shape.rect',
      version: 1,
      x: 40,
      y: 40,
      width: 120,
      height: 90,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      z: 0,
      visible: true,
      locked: false,
      data: { fill: null, stroke: '#51cf66', strokeWidth: 4, cornerRadius: 0 },
    };

    await page.evaluate(() => {
      window.__scene.clear();
      window.__scene.setReadOnly(false);
      window.__scene.setTool('pen');
    });
    await page.waitForFunction(() => window.__scene.getScene().order.length === 0);

    // Mid-gesture revocation: press, move, revoke permission, then release.
    const from = at(300, 300);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y + 90, { steps: 10 });
    await page.evaluate(() => window.__scene.setReadOnly(true));
    await page.mouse.up();
    await page.waitForTimeout(60);

    const afterRevoke = await page.evaluate(() => ({
      objects: window.__scene.getScene().order.length,
      readOnly: window.__scene.isReadOnly(),
      tool: window.__scene.getToolName(),
    }));
    assert.equal(afterRevoke.objects, 0, 'a stroke interrupted by a permission change must not land');
    assert.equal(afterRevoke.readOnly, true, 'the editor should report read-only');
    assert.equal(afterRevoke.tool, 'select', `the tool should reset, found ${afterRevoke.tool}`);

    // Every mutating entry point is closed, not just the pointer.
    const refused = await page.evaluate((r) => {
      const hook = window.__scene;
      hook.applyDelta({ added: [r], order: [r.id] });
      const seeded = hook.getScene().order.length;
      hook.setStyle({ stroke: '#ff0000' });
      hook.deleteSelection();
      hook.duplicateSelection();
      hook.setSelection([r.id]);
      hook.deleteSelection();
      return {
        seeded,
        objects: hook.getScene().order.length,
        stroke: hook.getScene().objects[r.id].data.stroke,
        selection: hook.getSelection().length,
        cleared: hook.clearAll(),
      };
    }, record);
    assert.equal(refused.seeded, 1, 'a read-only editor must still accept remote records');
    assert.equal(refused.objects, 1, 'delete/duplicate must not remove anything while read-only');
    assert.equal(refused.stroke, '#51cf66', 'style changes must be refused while read-only');
    assert.equal(refused.cleared, 0, 'clearAll must refuse while read-only');

    // The camera is view state, not document state: a viewer still navigates.
    const beforeZoom = await getViewport(page);
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.wheel(0, -240);
    const afterZoom = await getViewport(page);
    assert.ok(afterZoom.scale > beforeZoom.scale, 'a read-only board must still zoom');

    // ...including dragging to pan, which an audience has no other use for.
    const beforePan = await getViewport(page);
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 240, { steps: 6 });
    await page.mouse.up();
    const afterPan = await getViewport(page);
    assert.ok(
      Math.abs(afterPan.x - beforePan.x) > 1 || Math.abs(afterPan.y - beforePan.y) > 1,
      'dragging on a read-only board should pan the camera',
    );
    assert.equal(afterPan.scale, beforePan.scale, 'panning must not change the zoom');

    // And nothing was written while read-only.
    const persisted = await page.evaluate(() => window.__scene.toJSON());
    assert.equal(JSON.parse(persisted).objects['remote-1'].data.stroke, '#51cf66', 'the document is unchanged');

    await page.evaluate(() => window.__scene.setReadOnly(false));
    await shot(page, 'u-readonly');
    return 'mid-gesture revocation, closed API, live camera';
  });

  // --------------------------------------- v. record replay (R3 / R4)
  await check('v', 'replaying the same record delta is idempotent and never touches undo history', async () => {
    const delta = {
      added: [
        {
          id: 'peer-a',
          type: 'shape.rect',
          version: 1,
          x: 10,
          y: 10,
          width: 60,
          height: 60,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          z: 0,
          visible: true,
          locked: false,
          data: { fill: null, stroke: '#ffd43b', strokeWidth: 2, cornerRadius: 0 },
        },
      ],
      order: ['peer-a'],
    };

    await page.evaluate(() => {
      window.__scene.clear();
      window.__scene.setReadOnly(false);
    });

    const replayed = await page.evaluate((d) => {
      const hook = window.__scene;
      const depthBefore = hook.store.historyDepth().undo;
      for (let i = 0; i < 5; i += 1) hook.applyDelta(d);
      const scene = hook.getScene();
      return {
        order: scene.order,
        objects: Object.keys(scene.objects).length,
        depthBefore,
        depthAfter: hook.store.historyDepth().undo,
        undoable: hook.store.canUndo(),
      };
    }, delta);

    assert.deepEqual(replayed.order, ['peer-a'], `replay duplicated the order: ${JSON.stringify(replayed.order)}`);
    assert.equal(replayed.objects, 1, 'replay created extra objects');
    assert.equal(replayed.depthAfter, replayed.depthBefore, 'a remote delta must not enter the undo history');
    assert.equal(replayed.undoable, false, 'there is nothing local to undo');

    // The document is still loadable: this is the exact failure the old patch
    // replay caused, where the duplicated order made validation reject the scene.
    const roundTrip = await page.evaluate(() => {
      const text = window.__scene.toJSON();
      window.__scene.loadJSON(text);
      return { version: JSON.parse(text).version, order: window.__scene.getScene().order };
    });
    assert.equal(roundTrip.version, 2, 'the document should still be v2');
    assert.deepEqual(roundTrip.order, ['peer-a'], 'the scene must survive a save/load round trip');

    // Local edits stay undoable, and undo must not reach into the peer's object.
    const mixed = await page.evaluate(() => {
      const hook = window.__scene;
      hook.setTool('select');
      hook.applyDelta({ updated: [{ ...hook.getScene().objects['peer-a'], x: 200 }] });
      return { x: hook.getScene().objects['peer-a'].x, canUndo: hook.store.canUndo() };
    });
    assert.equal(mixed.x, 200, 'the newest state of an object should win');
    assert.equal(mixed.canUndo, false, 'remote updates are not local history');

    // Malformed input is refused without throwing and without changing anything.
    const garbage = await page.evaluate(() => {
      const hook = window.__scene;
      const before = JSON.stringify(hook.getScene().order);
      hook.applyDelta({ added: [{ nope: true }] });
      hook.applyDelta(null);
      return { before, after: JSON.stringify(hook.getScene().order) };
    });
    assert.equal(garbage.after, garbage.before, 'garbage deltas must not change the document');

    await shot(page, 'v-records');
    return '5x replay → one entry, no history, still serializable';
  });

  // ------------------------------- w. summary + hide-all-chrome (R8 / R10)
  await check('w', 'the status summary tracks the document, and the chrome can vanish entirely', async () => {
    await page.evaluate(() => {
      window.__scene.clear();
      window.__scene.setReadOnly(false);
      window.__chrome.setChromeVisible(true);
    });

    // An empty board must say so — that is what stops a baseline being written.
    const empty = await page.evaluate(() => window.__scene.getSummary());
    assert.equal(empty.objects, 0, 'a cleared board has no objects');
    assert.equal(empty.isEmpty, true, 'an empty board should report isEmpty');
    assert.equal(empty.readOnly, false, 'the editor is editable');

    await page.click('[data-testid="tool-rect"]');
    const from = at(420, 260);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 140, from.y + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__scene.getScene().order.length === 1);

    const summary = await page.evaluate(() => {
      const scene = window.__scene.getScene();
      return {
        ...window.__scene.getSummary(),
        // The compact form a server stores; `toJSON()` is pretty-printed.
        serialized: JSON.stringify(scene).length,
      };
    });
    assert.equal(summary.objects, 1, 'the summary should follow the document');
    assert.equal(summary.isEmpty, false, 'a board with an object is not empty');
    // The byte count is what a server would store, not an estimate.
    assert.equal(summary.bytes, summary.serialized, `summary reported ${summary.bytes} bytes, document is ${summary.serialized}`);
    assert.ok(summary.canUndo, 'a local edit is undoable');

    // R7: clearing the board is ONE undoable step, not a history reset.
    const wiped = await page.evaluate(() => {
      const hook = window.__scene;
      const before = hook.getScene().order.length;
      const removed = hook.clearAll();
      const after = hook.getScene().order.length;
      const undone = hook.store.undo();
      return { before, removed, after, undone, restored: hook.getScene().order.length };
    });
    assert.equal(wiped.removed, wiped.before, 'clearAll should report what it removed');
    assert.equal(wiped.after, 0, 'clearAll should leave an empty board');
    assert.equal(wiped.undone, true, 'clearing the board must be undoable');
    assert.equal(wiped.restored, wiped.before, 'one undo must bring the whole board back');

    // The published z-index contract: a host needs to know what to sit above.
    const zContract = await page.evaluate(() => {
      const root = document.querySelector('.coslate-ui') ?? document.querySelector('#toolbar')?.parentElement;
      const styles = root ? getComputedStyle(root) : null;
      return {
        zChrome: styles?.getPropertyValue('--coslate-z-chrome').trim() ?? '',
        zTooltip: styles?.getPropertyValue('--coslate-z-tooltip').trim() ?? '',
      };
    });
    assert.ok(zContract.zChrome.length > 0, 'the chrome must publish --coslate-z-chrome');
    assert.ok(zContract.zTooltip.length > 0, 'the chrome must publish --coslate-z-tooltip');

    // Mini state: every piece of chrome gone, canvas keeps the space.
    const fullCanvas = await page.evaluate(() => document.querySelector('#canvas-host').getBoundingClientRect().height);
    const mini = await page.evaluate(() => {
      window.__chrome.setChromeVisible(false);
      const visible = (node) => node !== null && node.getBoundingClientRect().height > 0 && getComputedStyle(node).display !== 'none';
      return {
        chromeVisible: window.__chrome.isChromeVisible(),
        toolbar: visible(document.querySelector('#toolbar')),
        statusbar: visible(document.querySelector('#statusbar')),
        canvasHeight: document.querySelector('#canvas-host').getBoundingClientRect().height,
        controls: [...document.querySelectorAll('#toolbar button, #statusbar button')].filter((n) => n.offsetParent !== null).length,
      };
    });
    assert.equal(mini.chromeVisible, false, 'the chrome should report hidden');
    assert.equal(mini.toolbar, false, 'the toolbar must be gone in mini state');
    assert.equal(mini.statusbar, false, 'the status bar must be gone in mini state');
    assert.equal(mini.controls, 0, 'no chrome control may remain focusable while hidden');
    assert.ok(
      mini.canvasHeight > fullCanvas,
      `the canvas should reclaim the chrome height (${Math.round(fullCanvas)} -> ${Math.round(mini.canvasHeight)})`,
    );
    await shot(page, 'w-mini');

    // ...and back again.
    const restored = await page.evaluate(() => {
      window.__chrome.setChromeVisible(true);
      return {
        visible: window.__chrome.isChromeVisible(),
        toolbarHeight: Math.round(document.querySelector('#toolbar').getBoundingClientRect().height),
      };
    });
    assert.equal(restored.visible, true, 'the chrome should come back');
    assert.ok(restored.toolbarHeight > 0, 'the toolbar should be laid out again');
    return `summary ${summary.objects} object / ${summary.bytes} bytes, mini reclaims ${Math.round(mini.canvasHeight - fullCanvas)}px`;
  });

  // ------------------------------------- x. the viewer page (R1, no editor)
  await check('x', 'the viewer page renders a stream, replays safely, and has no way to edit', async () => {
    const delta = {
      added: [
        {
          id: 'viewer-1',
          type: 'shape.ellipse',
          version: 1,
          x: 60,
          y: 60,
          width: 160,
          height: 120,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          z: 0,
          visible: true,
          locked: false,
          data: { fill: null, stroke: '#4dabf7', strokeWidth: 3 },
        },
      ],
      order: ['viewer-1'],
    };

    await page.goto(`${BASE_URL}viewer.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__viewer), null, { timeout: 10_000 });
    // The viewer page has its own container; the renderer mounts inside it.
    await page.waitForSelector('#viewer canvas, .coslate-canvas-host canvas');

    const result = await page.evaluate((payload) => {
      const viewer = window.__viewer;
      const first = viewer.applyDelta(payload);
      const replay = viewer.applyDelta(JSON.parse(JSON.stringify(payload)));
      const scene = viewer.getScene();
      return {
        first,
        replay,
        order: scene.order,
        objects: Object.keys(scene.objects).length,
        hasEditor: typeof window.__scene !== 'undefined',
        editableNodes: document.querySelectorAll('[data-testid]').length,
        canvases: document.querySelectorAll('.coslate-canvas-host canvas').length,
      };
    }, delta);

    assert.equal(result.first, true, 'the viewer should accept the delta');
    assert.equal(result.replay, false, 'replaying the same frame must change nothing');
    assert.deepEqual(result.order, ['viewer-1'], `viewer order was ${JSON.stringify(result.order)}`);
    assert.equal(result.objects, 1, 'the viewer should hold exactly one object');
    assert.equal(result.hasEditor, false, 'no editor may be mounted on the viewer page');
    assert.equal(result.editableNodes, 0, 'the viewer must expose no editable controls');
    assert.equal(result.canvases, 3, 'the viewer still renders the grid/content/overlay layers');

    await shot(page, 'x-viewer');

    // Back to the editor page, so the app state is where a later check expects it.
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });
    return 'viewer renders, replay is a no-op, no editor and no editable controls';
  });

  // --------------------- y. the page's visual contract (R11, editor surface)
  await check('y', 'page background and grid are view config: they repaint the page, the PNG export follows, and the document never changes', async () => {
    // The defaults are part of the published contract — pin them here so the
    // docs, the constants and the pixels cannot drift apart silently.
    const defaults = await page.evaluate(() => window.__scene.getViewConfig());
    assert.deepEqual(defaults, {
      background: '#14161a',
      grid: { visible: true, color: 'rgba(255, 255, 255, 0.05)', majorColor: 'rgba(255, 255, 255, 0.09)', spacing: 20 },
    });

    // A known camera, so grid-line density is deterministic for the counts below.
    await page.evaluate(() => window.__scene.editor.setViewport({ x: 0, y: 0, scale: 1 }));

    // Default page: the dark fill dominates, and the grid draws over it.
    const dark = await samplePageLayerUntil(
      page,
      (s) => s.modal === '20,22,26' && Object.keys(s.counts).length > 1,
    );
    assert.ok(dark, `the default page should be #14161a with grid on top, modal was ${dark?.modal}`);

    // The document before any appearance change — appearance must never touch it.
    const documentBefore = await page.evaluate(() => window.__scene.toJSON());

    // Host look #1 — the classroom board: white page, no grid at all.
    await page.evaluate(() => {
      window.__scene.setBackground('#ffffff');
      window.__scene.setGrid({ visible: false });
    });
    const plain = await samplePageLayerUntil(
      page,
      (s) => s.modal === '255,255,255' && Object.keys(s.counts).length === 1,
    );
    assert.ok(plain, `a white ungridded page must be exactly one colour, saw ${JSON.stringify(Object.keys(plain?.counts ?? {}))}`);

    // Host look #2 — a restyled grid: both colours AND the spacing change.
    await page.evaluate(() => window.__scene.setGrid({ visible: true, color: '#ff0000', majorColor: '#0000ff', spacing: 20 }));
    const gridded = await samplePageLayerUntil(
      page,
      (s) => s.modal === '255,255,255' && countColor(s, 'red') > 0 && countColor(s, 'blue') > 0,
    );
    assert.ok(gridded, 'a restyled grid must draw exactly its configured colours');
    const denseRed = countColor(gridded, 'red');

    // Spacing is honoured too: 10x the base spacing draws measurably fewer lines
    // (10 is not a power of two, so the zoom-adaptive step can never collapse
    // the two configurations onto the same drawn grid).
    await page.evaluate(() => window.__scene.setGrid({ spacing: 200 }));
    const sparse = await samplePageLayerUntil(
      page,
      (s) => countColor(s, 'red') > 0 && countColor(s, 'red') < denseRed * 0.95,
    );
    assert.ok(sparse, `a larger spacing must draw fewer lines (${countColor(sparse ?? gridded, 'red')} vs ${denseRed})`);

    // The export follows the same choice: white background, configured grid.
    const pngGridded = await exportPixels(page);
    assert.equal(pngGridded.modal, '255,255,255', `exported background should be white, modal was ${pngGridded.modal}`);
    assert.ok(countColor(pngGridded, 'red') > 0, 'the exported PNG must carry the configured grid');
    assert.ok(countColor(pngGridded, 'blue') > 0, 'the exported PNG must carry the configured major grid');
    assert.ok(!pngGridded.counts['20,22,26'], 'the exported PNG must not carry the old default background');

    // Grid off again → the export loses it too.
    await page.evaluate(() => window.__scene.setGrid({ visible: false }));
    const pngPlain = await exportPixels(page);
    assert.equal(pngPlain.modal, '255,255,255');
    assert.equal(countColor(pngPlain, 'red'), 0, 'a disabled grid must not reach the export');
    assert.equal(countColor(pngPlain, 'blue'), 0, 'a disabled grid must not reach the export');

    // And the whole time, the document was untouched: view config, not scene state.
    const documentAfter = await page.evaluate(() => window.__scene.toJSON());
    assert.equal(documentAfter, documentBefore, 'appearance configuration must never change the document');

    // Restore the documented look for anything that reads the page later.
    await page.evaluate(() => {
      window.__scene.setBackground('#14161a');
      window.__scene.setGrid({ visible: true, color: 'rgba(255, 255, 255, 0.05)', majorColor: 'rgba(255, 255, 255, 0.09)', spacing: 20 });
    });
    await samplePageLayerUntil(page, (s) => s.modal === '20,22,26');
    assert.deepEqual(await page.evaluate(() => window.__scene.getViewConfig()), defaults, 'the getter round-trips the restored configuration');
    await shot(page, 'y-visual-contract');
    return 'white/ungridded and restyled grids repaint the page, exports match, document byte-identical';
  });

  // --------------------- z. the page's visual contract (R11, viewer surface)
  await check('z', 'the read-only viewer honours the same visual contract without touching its document', async () => {
    await page.goto(`${BASE_URL}viewer.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__viewer), null, { timeout: 10_000 });
    await page.waitForSelector('.coslate-canvas-host canvas');

    const defaults = await page.evaluate(() => window.__viewer.getViewConfig());
    assert.deepEqual(defaults, {
      background: '#14161a',
      grid: { visible: true, color: 'rgba(255, 255, 255, 0.05)', majorColor: 'rgba(255, 255, 255, 0.09)', spacing: 20 },
    }, 'the viewer must expose the same documented defaults as the editor');

    const dark = await samplePageLayerUntil(
      page,
      (s) => s.modal === '20,22,26' && Object.keys(s.counts).length > 1,
    );
    assert.ok(dark, 'the viewer page should start on the default dark, gridded look');

    // The host look, on the projection surface: white and ungridded.
    await page.evaluate(() => {
      window.__viewer.setBackground('#ffffff');
      window.__viewer.setGrid({ visible: false });
    });
    const plain = await samplePageLayerUntil(
      page,
      (s) => s.modal === '255,255,255' && Object.keys(s.counts).length === 1,
    );
    assert.ok(plain, 'a host-configured viewer must render the white, ungridded page');

    // Still view state over here too: the projected document is unchanged.
    const scene = await page.evaluate(() => window.__viewer.getScene());
    assert.equal(scene.order.length, 0, 'appearance configuration must not create objects');

    await shot(page, 'z-viewer-visual');

    // Back to the editor page, leaving the suite where it found it.
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });
    return 'viewer defaults match the editor, config repaints, projected document stays empty';
  });

  // --------------------- aa. the toolbar's clear button is an ordinary edit (R7)
  await check(
    'aa',
    'the clear button empties the board through the command pipeline: one undo restores it',
    async () => {
      await page.goto(BASE_URL, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });

      // A real stroke with the pen tool, so there is something to clear.
      await page.click('[data-testid="tool-pen"]');
      const box = await page.locator('.coslate-canvas-host canvas').first().boundingBox();
      const cx = box.x + box.width * 0.4;
      const cy = box.y + box.height * 0.4;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 12; i += 1) await page.mouse.move(cx + i * 8, cy + i * 4);
      await page.mouse.up();
      await page.waitForTimeout(300);

      const before = await page.evaluate(() => window.__scene.getScene().order.length);
      assert.ok(before > 0, 'the pen should have left something to clear');

      // The regression this guards: the button used to call clear(), which replaces the document
      // without a command — locally destructive, invisible to peers, and impossible to undo.
      await page.click('[data-testid="clear"]');
      await page.waitForTimeout(250);
      const cleared = await page.evaluate(() => window.__scene.getScene().order.length);
      assert.equal(cleared, 0, 'the clear button must empty the board');

      const undone = await page.evaluate(() => window.__scene.undo());
      assert.equal(undone, true, 'clearing must be undoable — that is what proves it used the pipeline');
      const restored = await page.evaluate(() => window.__scene.getScene().order.length);
      assert.equal(restored, before, `one undo should restore all ${before} object(s), saw ${restored}`);

      await page.click('[data-testid="clear"]');
      await page.waitForTimeout(200);
      await shot(page, 'aa-clear-button');
      return `cleared ${before} object(s) via the button; one undo restored them`;
    },
  );

  // ------------------------------------ ab. no dead language control (O2)
  await check(
    'ab',
    'the chrome mounts no language control when the host offers fewer than two languages',
    async () => {
      await page.goto(BASE_URL, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });

      // The reference host ships four languages, so the menu exists with them all.
      const options = await page.locator('[data-testid="locale-select"] option').count();
      assert.ok(options >= 2, `the reference host should mount the language menu, found ${options} option(s)`);

      // One language: nothing to choose — the whole group must be absent, while
      // the rest of the chrome and the status bar keep working.
      await page.evaluate(() => window.__chrome.setLanguageCount(1));
      assert.equal(await page.locator('[data-testid="locale-select"]').count(), 0, 'one language must leave no language control');
      assert.ok(await page.locator('[data-testid="tool-pen"]').isVisible(), 'the toolbar must survive without the menu');
      assert.ok(await page.locator('#statusbar .status-message').isVisible(), 'the status bar must survive without the menu');

      await page.evaluate(() => window.__chrome.setLanguageCount(0));
      assert.equal(await page.locator('[data-testid="locale-select"]').count(), 0, 'zero languages must leave no language control');

      // And restoring the host table brings a working menu back.
      await page.evaluate(() => window.__chrome.setLanguageCount(4));
      assert.equal(await page.locator('[data-testid="locale-select"] option').count(), options, 'the menu must come back with the host table');
      await shot(page, 'ab-language-menu');
      return `menu present at ${options} languages, absent at 1 and 0, restored at ${options}`;
    },
  );

  // ------------------- ac. every mutating toolbar control, proven by one undo
  await check(
    'ac',
    'delete / duplicate / front / back / style / text-commit each change the document and one undo reverts each',
    async () => {
      await page.goto(BASE_URL, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__scene), null, { timeout: 10_000 });

      // A known camera, so screen coordinates are world coordinates throughout.
      await page.evaluate(() => window.__scene.editor.setViewport({ x: 0, y: 0, scale: 1 }));
      const box = await page.locator('.coslate-canvas-host canvas').first().boundingBox();
      const at = (x, y) => ({ x: box.x + x, y: box.y + y });

      // Setup: two strokes, drawn for real with the pen tool.
      await page.click('[data-testid="tool-pen"]');
      const draw = async (x, y) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 80, y + 50, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(120);
      };
      await draw(at(120, 180).x, at(120, 180).y);
      await draw(at(320, 380).x, at(320, 380).y);
      const ids = await page.evaluate(() => window.__scene.getScene().order);
      assert.equal(ids.length, 2, 'setup: the two strokes exist');
      const doc = () => page.evaluate(() => window.__scene.getScene());
      const order = () => doc().then((s) => s.order);
      const select = (id) => page.evaluate((i) => window.__scene.setSelection([i]), id);

      // Selection itself is real input: click stroke B inside its own bbox.
      await page.click('[data-testid="tool-select"]');
      const b = (await doc()).objects[ids[1]];
      await page.mouse.click(box.x + b.x + b.width / 2, box.y + b.y + b.height / 2);
      assert.deepEqual(await page.evaluate(() => window.__scene.getSelection()), [ids[1]], 'the click should select stroke B');

      // duplicate: a new object appears; one undo removes exactly it.
      await page.click('[data-testid="duplicate"]');
      await page.waitForTimeout(150);
      let s = await doc();
      assert.equal(s.order.length, 3, 'duplicate added an object');
      const copyId = (await page.evaluate(() => window.__scene.getSelection()))[0];
      assert.ok(copyId && copyId !== ids[1], 'the duplicate is a new object and is selected');
      await page.evaluate(() => window.__scene.undo());
      s = await doc();
      assert.equal(s.order.length, 2, 'one undo removed the duplicate');
      assert.equal(s.objects[copyId], undefined, 'the duplicate is gone');

      // delete: the selection goes; one undo brings it back with its data.
      await select(ids[1]);
      await page.click('[data-testid="delete"]');
      await page.waitForTimeout(150);
      s = await doc();
      assert.equal(s.order.length, 1, 'delete removed the selection');
      assert.equal(s.objects[ids[1]], undefined, 'stroke B is gone');
      await page.evaluate(() => window.__scene.undo());
      s = await doc();
      assert.equal(s.order.length, 2, 'one undo restored the deleted object');
      assert.deepEqual(s.objects[ids[1]].data, JSON.parse(JSON.stringify(b.data)), 'the restored stroke kept its data');

      // front / back: the paint order moves; one undo restores it exactly.
      const orderBefore = await order();
      await select(ids[1]);
      await page.click('[data-testid="back"]');
      await page.waitForTimeout(120);
      let reordered = await order();
      assert.equal(reordered[0], ids[1], 'send-to-back moved stroke B first');
      await page.evaluate(() => window.__scene.undo());
      const afterBack = await order();
      assert.deepEqual(afterBack, orderBefore, `undo after back: before=${JSON.stringify(orderBefore)} after=${JSON.stringify(afterBack)}`);

      await select(ids[0]);
      await page.click('[data-testid="front"]');
      await page.waitForTimeout(120);
      reordered = await order();
      assert.equal(reordered[reordered.length - 1], ids[0], 'bring-to-front moved stroke A last');
      await page.evaluate(() => window.__scene.undo());
      const afterFront = await order();
      assert.deepEqual(afterFront, orderBefore, `undo after front: before=${JSON.stringify(orderBefore)} after=${JSON.stringify(afterFront)}`);

      // style: a swatch and a width button restyle the selection; one undo each.
      const strokeBefore = (await doc()).objects[ids[0]].data.stroke;
      await select(ids[0]);
      await page.click('[data-testid="stroke-ff6b6b"]');
      await page.waitForTimeout(120);
      assert.equal((await doc()).objects[ids[0]].data.stroke, '#ff6b6b', 'the swatch restyled the selection');
      await page.evaluate(() => window.__scene.undo());
      assert.equal((await doc()).objects[ids[0]].data.stroke, strokeBefore, 'one undo restored the colour');

      const widthBefore = (await doc()).objects[ids[0]].data.strokeWidth;
      await select(ids[0]);
      await page.click('[data-testid="width-8"]');
      await page.waitForTimeout(120);
      assert.equal((await doc()).objects[ids[0]].data.strokeWidth, 8, 'the width button restyled the selection');
      await page.evaluate(() => window.__scene.undo());
      assert.equal((await doc()).objects[ids[0]].data.strokeWidth, widthBefore, 'one undo restored the width');

      // text commit: type into the real overlay; the object lands; one undo removes it.
      await page.click('[data-testid="tool-text"]');
      await page.mouse.click(at(560, 520).x, at(560, 520).y);
      await page.waitForSelector('textarea.coslate-text-overlay', { timeout: 5000 });
      await page.keyboard.type('coverage');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__scene.getScene().order.length === 3, null, { timeout: 5000 });
      s = await doc();
      const text = Object.values(s.objects).find((o) => o.type === 'shape.text');
      assert.ok(text && text.data.text === 'coverage', 'the committed text landed as an object');
      await page.evaluate(() => window.__scene.undo());
      s = await doc();
      assert.equal(s.order.length, 2, 'one undo removed the text object');
      assert.equal(Object.values(s.objects).some((o) => o.type === 'shape.text'), false, 'the text is gone');

      // Everything above was undone: the board is exactly the two setup strokes.
      const final = await doc();
      assert.deepEqual([...final.order].sort(), [...ids].sort(), 'the board ends exactly as the setup left it');
      await shot(page, 'ac-mutating-controls');
      return 'duplicate, delete, back, front, stroke colour, stroke width, text commit — each reverted by one undo';
    },
  );

  exitCode = results.every((entry) => entry.ok) ? 0 : 1;
} catch (error) {
  console.error('\nFATAL:', error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  preview.kill('SIGTERM');
}

// --------------------------------------------------------------------- report

const passed = results.filter((entry) => entry.ok).length;
console.log('\n──────────────────────────────────────────────────────────────');
for (const entry of results) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id}  ${entry.title}`);
  if (entry.detail) console.log(`      ${entry.detail}`);
}
console.log('──────────────────────────────────────────────────────────────');
console.log(`${passed}/${results.length} assertions passed`);
if (previewLog.trim()) console.log(`\npreview server said:\n${previewLog.trim()}`);
console.log(`screenshots: ${screenshots.length ? screenshots.join(', ') : '(none)'}`);

await writeFile(
  path.join(ARTIFACTS, 'e2e-report.json'),
  JSON.stringify(
    {
      passed,
      total: results.length,
      staleDist,
      playwrightEntry: PLAYWRIGHT_ENTRY,
      chromiumExecutable: CHROMIUM_EXECUTABLE,
      results,
      screenshots,
      pageErrors,
    },
    null,
    2,
  ),
);

process.exit(exitCode);
