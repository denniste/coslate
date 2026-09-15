# CoSlate

**An open interactive scene runtime — the whiteboard core, not the whole product.**

CoSlate is a small, dependency-light TypeScript runtime for building whiteboards, diagram
editors, annotation layers and canvas tools *inside your own product*. It gives you the hard,
boring, load-bearing parts — a document model, an invertible command protocol, undo/redo,
camera math, serialization and a Konva renderer — and stays out of the way of everything else.

It is not an app. The demo in `apps/demo` exists to prove the runtime works in a real browser,
not to compete with one.

## Why this exists

CoSlate was written to replace a third-party whiteboard engine inside **CoStage**, a
self-hosted live-classroom product. That engine is not open source, and it was the single
largest asset in the app (a ~7.2 MB ESM bundle). CoSlate keeps the scene model — not the
renderer — as the source of truth, so the whole runtime plus renderer plus UI chrome ships
as a **89 kB gzipped** editor page (and **66 kB** for the read-only viewer page, which loads the
renderer but no chrome) in the demo build.

The CoStage integration is in progress; the runtime here stands on its own.

```
┌──────────────────────────────────────────────────────────┐
│ your product: chrome, auth, storage, AI, business logic   │
├──────────────────────────────────────────────────────────┤
│ CoSlate: scene model · commands · undo · serialization   │  ← this repo
│           viewport math · Konva renderer · tools          │
└──────────────────────────────────────────────────────────┘
```

## Quickstart

```bash
pnpm install
pnpm dev        # demo whiteboard on http://localhost:5173 (Vite moves to the next free port if taken)
pnpm test       # unit tests (vitest)
pnpm typecheck  # strict TypeScript across the workspace
pnpm build      # builds packages + apps/demo/dist
pnpm e2e        # builds the demo, then drives it in Playwright (fixed port 4321)
```

Node 20+ and pnpm 9+.

### Versions and breaking changes

Current release: **0.2.3** — see [CHANGELOG.md](./CHANGELOG.md) for the full list. The two breaking
changes an upgrade to 0.2 needs to know about:

- **`Scene` is v2 and the camera left the document.** The serialized document no longer carries a
  `viewport`; the camera is per-user view state owned by the editor or viewer. v1 documents still
  open — a registered migration drops the field — and a baseline that cannot be understood still
  reports itself empty instead of throwing.
- **The text tool no longer ships English copy.** The text field's placeholder and accessible name
  are editor options (`textPlaceholder`, `textAriaLabel`); an embed that omits them gets an empty
  field rather than a built-in English string.

Host-facing API changes are always accompanied by a version bump and a note here and in
`CHANGELOG.md`. Publishing the packages is `pnpm publish:packages` from a clean, green tree; the
maintainer runbook (one-time npm-org setup, web-auth 2FA flow, artifact smoke test) lives in the
repository's local design docs and is not part of the public tree.

### Embedding it

```ts
import { WhiteboardEditor } from '@coslate/konva';
import { createChrome } from '@coslate/ui';

const editor = new WhiteboardEditor({ container: document.querySelector('#board')! });
// Optional: the chrome is a separate package, and a host that has its own UI
// simply never imports it.
const chrome = createChrome({ toolbar, statusbar, editor, i18n });

editor.setTool('pen');
editor.setStyle({ stroke: '#4dabf7', strokeWidth: 4 });
editor.undo();

const json = editor.toJSON();          // portable scene document
editor.loadJSON(json);
console.log(editor.getScene().order);  // authoritative paint order

// Two different "clear"s, on purpose:
editor.clearAll();        // wipe the board as ONE undoable step (clearing a room)
editor.resetDocument();   // destructive reset for "open a different board" (history dropped)
// `clear()` still compiles as a deprecated alias of resetDocument(); new code should
// say which of the two it means.

// A whole document (a stored baseline, a reconnect snapshot) converges through the
// delta path: idempotent, atomic, never an undo step, and a free no-op when the
// board already matches. `loadBaseline` never throws — an unreadable blob reports
// { status: 'empty', reason } and leaves the board untouched.
const baseline = editor.getBaseline();   // compact serialized document
editor.loadBaseline(baseline);
```

Every mutation goes through a command, so the same API works for tools, menus, keyboard
shortcuts, remote peers and — later — an AI client:

```ts
import { addObjectOps, makeObject, updateObjectOps } from '@coslate/core';

editor.store.transaction((_scene, tx) => {
  const note = makeObject({ type: 'shape.text', x: 40, y: 40, width: 200, height: 24, data: { text: 'hi' } });
  editor.store.dispatch(tx.commit('object.create', addObjectOps(note)));
  editor.store.dispatch(tx.commit('object.move', updateObjectOps(note.id, { x: 100 })));
}, { label: 'Add note' });   // <- one Ctrl+Z undoes both commands
```

### Sharing it

The wire carries **object state**, never patches — so a reconnecting channel, a retransmitted
frame or a duplicated message cannot corrupt the document:

```ts
import { recordsFromCommands, shouldBroadcast } from '@coslate/core';
import { createSceneViewer } from '@coslate/konva';

// Send: derive what to broadcast from a local change.
editor.store.subscribe((event) => {
  if (!shouldBroadcast(event)) return;              // remote batches never echo
  const delta = recordsFromCommands(event.scene, event.commands);
  if (delta) channel.send(delta);                   // { added, updated, removed, order }
});

// Receive (editor): idempotent, atomic, and never in the undo history.
store.applyDelta(delta);

// Receive (audience): no editor, no input handlers, nothing to disable.
const viewer = createSceneViewer({ container: document.querySelector('#stage')! });
viewer.applyDelta(delta);

// Permission can arrive — or be revoked — at any moment.
editor.setReadOnly(true);                           // aborts any in-flight gesture
editor.setReadOnly(canPublishData());
```

### Localizing it

Core ships the locale *mechanism* and no strings; your product ships the language. Catalogs are
typed against one reference catalog, so a missing translation is a compile error rather than a
silent English fallback:

```ts
import { createI18n } from '@coslate/core';
import { en } from './catalog-en';               // the reference catalog
const zh: Record<keyof typeof en, Message> = { … }; // missing a key? tsc says so

const i18n = createI18n({
  catalogs: { en, 'zh-CN': zhHans, 'zh-Hant': zhHant, ar },
  requested: navigator.languages,
});

i18n.locale;                                   // 'zh-Hant' for a zh-TW request — resolved, never a failed one
i18n.dir;                                      // 'rtl' for ar, straight from Intl.Locale
i18n.t('status.objects', { count: 3 });        // CLDR plural category, localized number
document.documentElement.lang = i18n.locale;
document.documentElement.dir = i18n.dir;
```

Matching is RFC 4647 with CLDR likely subtags, so "Chinese" is not one locale: `zh` maximizes to
`zh-Hans-CN` and lands on the Simplified catalog, while `zh-TW` / `zh-HK` maximize to `zh-Hant-…`
and land on the Traditional one — no alias table, and no dependence on the order catalogs were
declared in. A `{count}` plural picks its CLDR category (`one`/`other` in English, six forms in
Arabic, one in Chinese); a missing category falls back to `other`, then to the fallback locale,
then to the key itself, so nothing is ever silently blank.

### The page: background and grid

The page the board is drawn on — its background colour and its grid — is **view configuration**,
the same class of state as the camera: it belongs to the host's surface, never to the document. It
never appears in a serialized `Scene`, in a delta, or in an undo step, and the PNG export paints
the very same page layer, so an export always matches what was configured:

```ts
// At construction — the first host's classroom board is white and ungridded:
const editor = new WhiteboardEditor({
  container,
  background: '#ffffff',
  grid: { visible: false },
});
// …or restyled rather than removed (any canvas colour; spacing is in world units):
editor.setGrid({ color: 'rgba(0, 0, 0, 0.06)', majorColor: 'rgba(0, 0, 0, 0.12)', spacing: 25 });
// …and it can change at runtime (a theme switch, a presentation mode):
editor.setBackground('#ffffff');
// `createSceneViewer` takes the same two options and the same setters.
```

The values used when a host does not choose, published so a host can derive from them:

| Token | Default | Meaning |
| --- | --- | --- |
| page background | `#14161a` | painted under everything; also the PNG export background |
| grid — visible | `true` | `{ visible: false }` removes the grid entirely |
| grid — minor lines | `rgba(255, 255, 255, 0.05)` | any canvas colour |
| grid — major lines | `rgba(255, 255, 255, 0.09)` | drawn every fifth step |
| grid — spacing | `20` | world units; the drawn step adapts to the zoom level (roughly 24–96 screen px) |

These are constructor options on the editor, the viewer and `SceneRenderer`, with
`setBackground`/`setGrid` for runtime changes and `getBackground`/`getGrid` to read back. They are
deliberately **not** `--coslate-*` custom properties: those theme the DOM chrome, while the page is
a canvas — but a host that renders its own page around the board can mirror them by setting the
same values on its own container. The constants live in `@coslate/core`
(`DEFAULT_BACKGROUND`, `DEFAULT_GRID`, `resolveGrid`) and are re-exported from `@coslate/konva`.

## What v1 does

**Scene**
- `Scene { format, version, objects, order }` — plain JSON, immutable updates, structural sharing.
- Object types: `shape.rect`, `shape.ellipse`, `shape.line`, `shape.arrow`, `shape.text`, `freehand.stroke`.
- Free-form `data` and `meta` bags so new features never need a format bump.
- **No camera in the document.** View state is per user, so a shared scene cannot drag everyone to
  the publisher's pan position and a saved baseline cannot record somebody else's view. v1 files
  are migrated by dropping the field.

**Commands and history**
- Minimal built-in JSON Patch (`add` / `replace` / `remove`, RFC 6901 pointers) — no dependency.
- Every command carries its own inverse; undo/redo is derived, never snapshotted.
- `store.transaction(fn, { label })` groups commands into one atomic undo step; nested
  transactions flatten into the outermost; a throwing transaction rolls itself back.
- Bounded history (200 steps by default), redo branch dropped on new edits, `transient`
  commands excluded from undo.
- `clearAll()` wipes the board as one undoable step — clearing a room must not be the moment the
  undo history disappears.

**Sharing a scene**
- The wire carries **object state**, not patches: `{ added, updated, removed, order }`.
- Idempotent (a retransmitted frame is a no-op, compared by content, not by reference), atomic
  (a rejected batch changes nothing), and free of inverses and arbitrary patch paths.
- `recordsFromCommands` derives what to send from a local change; `shouldBroadcast` excludes
  remote batches so nothing echoes, while a local undo still reaches the room.
- `createSceneViewer` is the read-only projection: a renderer and a store with no input handlers,
  fed by the same deltas an editor uses.

**Read-only**
- `editor.setReadOnly(true)` is safe at any moment, including mid-stroke: it aborts the gesture,
  closes the text editor, resets the tool and closes every mutating entry point.
- The camera stays live — panning and zooming are the viewer's own view state.

**Baselines**
- `isSceneEmpty()` so a blank board never occupies a baseline slot.
- `readBaseline()` never throws: an unrecognised or foreign stored document becomes an empty
  board, with the reason code returned so it can still be logged.

**Camera**
- Pure math: `worldToScreen`, `screenToWorld`, `zoomAt` (cursor-pinned), `panBy`, `fitToContent`.
- Zoom via toolbar, wheel, ctrl+wheel; pan via space+drag, middle-drag, two-finger wheel.
- Owned by the editor, not the scene — the same math drives an editor and a read-only viewer.

**Renderer (`@coslate/konva`)**
- One-way scene → Konva reconciliation keyed by object id; three layers: grid, content, overlay.
- The renderer never mutates the scene: gestures move *nodes*, then commit one command.
- **The page is configurable** — see "The page: background and grid" below.

**Tools**
- select (click, shift-click, marquee, multi-object drag, rotate/resize via `Konva.Transformer`),
  pen (freehand points as semantic data), eraser (drag to erase, one undo step),
  rect, ellipse, line, arrow, text (DOM `<textarea>` overlay transformed to match the shape).
- Style: stroke colour palette, fill (none / white / palette), stroke width — applied to the
  selection or to the next created object.

**Locale (`@coslate/core`)**
- `createI18n`: typed catalogs, BCP 47 tags, RFC 4647 lookup with CLDR likely subtags, plural
  categories, `Intl` number/list formatting and text direction. Dependency-free, DOM-free, and it
  ships no strings of its own — the mechanism is core's, the language is yours. Neither does the
  renderer: the text tool's placeholder and accessible name are editor options
  (`textPlaceholder`, `textAriaLabel`), not constants.
- A catalog that misses a key fails `tsc`; a key that is missing at runtime falls back to the
  fallback locale and then to the key itself, so nothing is ever silently blank.

**Demo app**
- Chrome comes from `@coslate/ui`: a tldraw-shaped icon toolbar in labelled groups (tools, history,
  zoom, selection, file, language, style) plus a status bar. Every control is icon-only and
  explains itself on hover — label and keyboard shortcut in one hint.
- The same page shows the read-only path: `viewer.html` mounts `createSceneViewer` with no editor
  and no controls, and takes the same deltas an editor does.
- Responsive chrome: grouped pills while they fit, then a dense wrapped flow below 560px and
  compact controls below 400px. Nothing is ever hidden — every control stays reachable down to
  320px wide.
- Ships `en`, `zh-CN`, `zh-Hant` and `ar` with a language menu: `?lang=` → remembered choice →
  `navigator.languages`. Switching updates `<html lang>`, `<html dir>`, the document title and the
  meta description, and Arabic mirrors the whole chrome because everything is a flex row in the
  writing direction.
- Keyboard shortcuts (`v p e r o l a t`, `Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`, `Ctrl+C/V`, `Ctrl+D`,
  `Delete`, `Ctrl+0`, `Ctrl+Shift+F`, `Ctrl+S`).
- Autosave to `localStorage` with restore-on-load. The camera is stored under its own key,
  because it is view state and not part of the document.
- Clearing the board is undoable (one step), so a mis-click is not a lost lesson.
- Export PNG (clean full-content snapshot, no selection UI), save/load JSON.
- `window.__scene` and `window.__i18n` debug/test hooks — documented, stable, and used by the e2e
  suite.

## Rules

`AGENTS.md` is the contract in one screen: the guarantees a host depends on and the rules that keep
this project worth using. In short: zero dependencies and no DOM in the core, no third-party
engine ever, the camera is never in the document, remote application is idempotent and atomic,
read-only is structural rather than a flag check, and the packages ship no user-visible copy. The
machine-checkable half is enforced in `tests/unit/invariants.test.ts`; the full invariant set,
the requirement documents and the bug log live in the maintainers' local design docs (`.design/`,
gitignored — they are working documents, not published documentation).

User-facing documentation lives in [docs/](./docs/README.md): what the packages are, how to
install them, and how to embed the editor, the viewer and the chrome.

## Non-goals for v1

Deliberately **not** built, and not planned for v1.x: AI or MCP integration, collaboration /
CRDT / multi-user sync, real-time transport, formulas or LaTeX, pages, images, embeds, React
bindings, zod-style runtime schemas, an SVG renderer, themes beyond dark, runtime-loaded plugins.
See `ARCHITECTURE.md` for the growth path these are deferred into.

## Repository layout

```
packages/core/    @coslate/core   — scene model, commands, records, undo, i18n, serialization (zero deps)
packages/konva/   @coslate/konva  — Konva renderer, editor, read-only viewer (dep: konva)
packages/ui/      @coslate/ui     — embeddable chrome: toolbar, style, zoom, theme, status bar
apps/demo/        vanilla TypeScript + Vite demo: the editor page and the viewer page
tests/unit/       vitest — model-level tests
tests/e2e/        Playwright — real browser, real scene assertions
docs/             user documentation: what it is, how to install it, how to embed it
scripts/rename.sh utility: `bash scripts/rename.sh <new-name> [--display <Name>]`
AGENTS.md         rules for contributors and AI agents (the short version of the contract)
```

## License

MIT — see [LICENSE](./LICENSE).

Sponsorship keeps maintenance alive; it never gates a feature. See
[.github/FUNDING.yml](./.github/FUNDING.yml).

---

## 中文简介

CoSlate 是一个**可嵌入的开放交互场景运行时**——提供白板内核，而不是完整产品。

- **场景即唯一事实来源**：`Scene` 是纯 JSON，不可变更新 + 结构共享。
- **一切修改都是命令**：内置极简 JSON Patch，每条命令自带逆操作，撤销/重做由逆操作推导，不存快照。
- **一次手势 = 一步撤销**：`store.transaction()` 把多条命令合并为一步，嵌套事务自动展平，事务抛错自动回滚。
- **渲染器只是投影**：`@coslate/konva` 单向地把场景映射到 Konva 节点，永远不直接改场景。
- **序列化是契约**：`format` + `version` + `migrate()`；遇到更高版本的文件会抛出明确错误，绝不静默丢数据。
- **国际化是标准接口**：core 只提供机制（BCP 47 标签、RFC 4647 匹配 + CLDR likely subtags、复数分类、`Intl` 数字/列表格式化、书写方向），不含任何文案；渲染器同样不含文案（文本工具的 placeholder 与无障碍名称都是编辑器选项）。演示内置 `en` / `zh-CN` / `zh-Hant` / `ar`，其中 `zh` 归简体、`zh-TW`/`zh-HK` 归繁体（靠 likely subtags 而非别名表），阿拉伯语自动 RTL 镜像整个界面。
- **v1 明确不做**：AI/MCP、协同/CRDT、实时同步、公式、页面、图片、嵌入、React、运行时插件。

快速开始：`pnpm i && pnpm dev`（演示地址 http://localhost:5173），测试 `pnpm test` / `pnpm e2e`。
许可证：MIT。
