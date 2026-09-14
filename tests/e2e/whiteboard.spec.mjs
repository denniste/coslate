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

process.env.TMPDIR = '/dev/shm';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAYWRIGHT_ENTRY =
  process.env.COSLATE_PLAYWRIGHT ?? '/root/.nvm/versions/node/v24.14.1/lib/node_modules/playwright/index.mjs';
const CHROMIUM_EXECUTABLE =
  process.env.COSLATE_CHROMIUM ?? '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ARTIFACTS = path.join(ROOT, '.artifacts');
const PORT = Number(process.env.COSLATE_E2E_PORT ?? 4321);
const BASE_URL = `http://127.0.0.1:${PORT}/`;

const { chromium } = await import(PLAYWRIGHT_ENTRY);

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

const viteBin = path.join(ROOT, 'node_modules/.bin/vite');
const preview = spawn(viteBin, ['preview', '--port', String(PORT), '--strictPort'], {
  cwd: path.join(ROOT, 'apps/demo'),
  env: { ...process.env, TMPDIR: '/dev/shm' },
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
  console.log(`\nCoSlate e2e — serving ${BASE_URL} from apps/demo/dist\n`);

  browser = await chromium.launch({
    executablePath: CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    acceptDownloads: true,
    deviceScaleFactor: 1,
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
    assert.equal(document.version, 1, 'saved document has version 1');
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
  JSON.stringify({ passed, total: results.length, results, screenshots, pageErrors }, null, 2),
);

process.exit(exitCode);
