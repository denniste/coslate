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
as a **76 kB gzipped** bundle in the demo build.

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
pnpm e2e        # Playwright suite against the built demo (fixed port 4321)
```

Node 20+ and pnpm 9+.

### Embedding it

```ts
import { WhiteboardEditor } from '@coslate/konva';

const editor = new WhiteboardEditor({ container: document.querySelector('#board')! });

editor.setTool('pen');
editor.setStyle({ stroke: '#4dabf7', strokeWidth: 4 });
editor.undo();

const json = editor.toJSON();          // portable scene document
editor.loadJSON(json);
console.log(editor.getScene().order);  // authoritative paint order
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

## What v1 does

**Scene**
- `Scene { format, version, viewport, objects, order }` — plain JSON, immutable updates, structural sharing.
- Object types: `shape.rect`, `shape.ellipse`, `shape.line`, `shape.arrow`, `shape.text`, `freehand.stroke`.
- Free-form `data` and `meta` bags so new features never need a format bump.

**Commands and history**
- Minimal built-in JSON Patch (`add` / `replace` / `remove`, RFC 6901 pointers) — no dependency.
- Every command carries its own inverse; undo/redo is derived, never snapshotted.
- `store.transaction(fn, { label })` groups commands into one atomic undo step; nested
  transactions flatten into the outermost; a throwing transaction rolls itself back.
- Bounded history (200 steps by default), redo branch dropped on new edits, `transient`
  commands (camera moves) excluded from undo.

**Camera**
- Pure math: `worldToScreen`, `screenToWorld`, `zoomAt` (cursor-pinned), `panBy`, `fitToContent`.
- Zoom via toolbar, wheel, ctrl+wheel; pan via space+drag, middle-drag, two-finger wheel.

**Renderer (`@coslate/konva`)**
- One-way scene → Konva reconciliation keyed by object id; three layers: grid, content, overlay.
- The renderer never mutates the scene: gestures move *nodes*, then commit one command.

**Tools**
- select (click, shift-click, marquee, multi-object drag, rotate/resize via `Konva.Transformer`),
  pen (freehand points as semantic data), eraser (drag to erase, one undo step),
  rect, ellipse, line, arrow, text (DOM `<textarea>` overlay transformed to match the shape).
- Style: stroke colour palette, fill (none / white / palette), stroke width — applied to the
  selection or to the next created object.

**Demo app**
- Dark chrome: toolbar, canvas, status bar; keyboard shortcuts
  (`v p e r o l a t`, `Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`, `Ctrl+C/V`, `Ctrl+D`, `Delete`,
  `Ctrl+0`, `Ctrl+Shift+F`, `Ctrl+S`).
- Autosave to `localStorage` with restore-on-load and a clear that resets it.
- Export PNG (clean full-content snapshot, no selection UI), save/load JSON.
- `window.__scene` debug/test hook — documented, stable, and used by the e2e suite.

## Non-goals for v1

Deliberately **not** built, and not planned for v1.x: AI or MCP integration, collaboration /
CRDT / multi-user sync, real-time transport, formulas or LaTeX, pages, images, embeds, React
bindings, zod-style runtime schemas, an SVG renderer, themes beyond dark, runtime-loaded plugins.
See `ARCHITECTURE.md` for the growth path these are deferred into.

## Repository layout

```
packages/core/    @coslate/core   — scene model, commands, undo, viewport, serialization (zero deps)
packages/konva/   @coslate/konva  — Konva renderer, tools, editor shell (dep: konva)
apps/demo/        vanilla TypeScript + Vite demo whiteboard
tests/unit/       vitest — model-level tests
tests/e2e/        Playwright — real browser, real scene assertions
scripts/rename.sh utility: `bash scripts/rename.sh <new-name> [--display <Name>]`
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
- **v1 明确不做**：AI/MCP、协同/CRDT、实时同步、公式、页面、图片、嵌入、React、运行时插件。

快速开始：`pnpm i && pnpm dev`（演示地址 http://localhost:5173），测试 `pnpm test` / `pnpm e2e`。
许可证：MIT。
