/**
 * Invariants — the machine-checkable half of `.design/INVARIANTS.md`.
 *
 * Most of these read source files and manifests on purpose. The rules they protect are
 * architectural: what may depend on what, what may appear in a wire message, what may ship as copy.
 * A behavioural test cannot see a violation that has not happened yet, so the scan *is* the test.
 *
 * The behavioural rules that need a real store are asserted here too, except where an existing
 * suite already drives the harder case (noted inline, so the checks stay in one place each).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createEmptyScene,
  createStore,
  deserialize,
  makeObject,
  SCENE_VERSION,
  shouldBroadcast,
  type Command,
} from '@coslate/core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const sourceFiles = (pkg: string): string[] => filesUnder(join(ROOT, 'packages', pkg, 'src'));

const readPackage = (pkg: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };

/**
 * Comments are prose, and I1 is about code: a doc comment may legitimately name `navigator` while
 * explaining where a preference list comes from.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const DOM_API =
  /(document\.(createElement|head|body|querySelector|querySelectorAll|getElementById)|window\.|globalThis\.|localStorage|sessionStorage|navigator\.|HTMLElement|ResizeObserver|requestAnimationFrame|HTMLCanvasElement|new Image\()/;
const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const INPUT_BINDING =
  /addEventListener\(\s*['"](pointer|mouse|touch|key|wheel|click)|\.on\(\s*['"](pointer|mouse|touch|key|wheel|click)/;

describe('invariants: package boundaries', () => {
  it('I1 — @coslate/core declares no runtime dependency', () => {
    expect(Object.keys(readPackage('core').dependencies ?? {})).toEqual([]);
  });

  it('I2/I17 — the only runtime dependency in the published packages is konva', () => {
    const declared = ['core', 'konva', 'ui'].flatMap((pkg) =>
      Object.keys(readPackage(pkg).dependencies ?? {}),
    );
    expect([...new Set(declared)].sort()).toEqual(['konva']);
  });

  it('I1 — core never touches the DOM or the BOM', () => {
    const offenders = sourceFiles('core')
      .filter((file) => DOM_API.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });

  it('I12 — published package sources are English-only, so no copy can ship', () => {
    const offenders = ['core', 'konva', 'ui']
      .flatMap(sourceFiles)
      .filter((file) => CJK.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });
});

describe('invariants: the document', () => {
  it('I4 — the camera is not in the document, and a v1 document still opens', () => {
    expect(SCENE_VERSION).toBeGreaterThanOrEqual(2);
    expect(Object.keys(createEmptyScene()).sort()).toEqual(['format', 'objects', 'order', 'version']);

    const legacy = JSON.stringify({
      format: 'coslate/scene',
      version: 1,
      viewport: { x: 12, y: 34, scale: 2 },
      objects: {},
      order: [],
    });
    const scene = deserialize(legacy);
    expect('viewport' in scene).toBe(false);
    expect(scene.objects).toEqual({});
  });
});

describe('invariants: the wire', () => {
  const command = (transient: boolean): Command => ({ transient }) as unknown as Command;

  it('I7/I8 — remote changes and transient commands are never broadcast', () => {
    expect(shouldBroadcast({ origin: 'remote', commands: [command(false)] })).toBe(false);
    expect(shouldBroadcast({ origin: 'local', commands: [command(true)] })).toBe(false);
    expect(shouldBroadcast({ origin: 'local', commands: [command(false)] })).toBe(true);
    expect(shouldBroadcast({ origin: 'undo', commands: [command(false)] })).toBe(true);
  });

  it('I6/I7 — replaying a delta is idempotent, remote-sourced and outside history', () => {
    const store = createStore();
    const object = makeObject({ type: 'shape.rect', x: 0, y: 0, width: 10, height: 10 });
    const delta = { added: [object], order: [object.id] };

    const origins: string[] = [];
    store.subscribe((event) => origins.push(event.origin));

    expect(store.applyDelta(delta)).toBe(true);
    const afterFirst = store.getState();
    expect(afterFirst.order).toEqual([object.id]);

    // A data channel duplicates messages as a matter of course: replay the same delta.
    for (let replay = 0; replay < 4; replay += 1) expect(store.applyDelta(delta)).toBe(false);

    expect(store.getState()).toBe(afterFirst);
    expect(store.getState().order).toEqual([object.id]);
    expect(store.getState().objects[object.id]?.id).toBe(object.id);
    expect(store.historyDepth().undo).toBe(0);
    expect(store.canUndo()).toBe(false);
    expect(origins[0]).toBe('remote');
  });

  // I6's atomicity half — a refused batch leaves the document exactly as it was — is asserted in
  // tests/unit/records.test.ts, which drives a genuinely failing operation rather than a fake one.
});

describe('invariants: the embedded UI', () => {
  it('I11 — the read-only viewer installs no input handler at all', () => {
    const viewer = readFileSync(join(ROOT, 'packages/konva/src/viewer.ts'), 'utf8');
    expect(viewer).toContain('export function createSceneViewer');
    expect(INPUT_BINDING.test(stripComments(viewer))).toBe(false);
  });

  it('I3 — no chrome control replaces the document (it must go through the command pipeline)', () => {
    // The regression this guards: the clear button called editor.clear(), which resets the document
    // outside the pipeline — so it was neither undoable nor broadcast (0.2.1, see .design/bug-log.md).
    const forbidden = [/editor\.clear\(\)/, /store\.reset\(/, /\.setScene\(/];
    const offenders = filesUnder(join(ROOT, 'packages/ui/src'))
      .filter((file) => forbidden.some((pattern) => pattern.test(stripComments(readFileSync(file, 'utf8')))))
      .map((file) => file.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });

  it('I13 — the chrome publishes its theme and stacking context as custom properties', () => {
    const styles = readFileSync(join(ROOT, 'packages/ui/src/styles.ts'), 'utf8');
    for (const token of [
      '--coslate-z-chrome',
      '--coslate-z-tooltip',
      '--coslate-bg',
      '--coslate-accent',
      '--coslate-radius',
    ]) {
      expect(styles).toContain(token);
    }
    expect(readFileSync(join(ROOT, 'packages/ui/src/index.ts'), 'utf8')).toContain(
      'ensureChromeStyles',
    );
  });
});
