# CoSlate architecture

This document describes how CoSlate is put together, why each boundary sits where it does,
and what is intentionally left out of v1. It is an engineering document, not a pitch: where a
decision has a cost, the cost is stated.

---

## 1. The ten engineering principles

**1. The scene model is the single source of truth.**
There is exactly one document — `Scene` — and everything else is a projection of it or a
producer of commands against it. Tools, the renderer, exporters, the debug hook and (later) a
sync layer never hold authoritative state of their own. When two components disagree, the
scene wins, and the disagreement is a bug in the projection.

**2. Every mutation is a command. No back doors.**
There is no `scene.objects[id].x = 5` anywhere in the codebase, and no API that would let a
caller do it: the store hands out the state object but every write path constructs a
`Command` with a JSON Patch and an inverse. This is what makes undo, replay, persistence and
future multi-peer sync fall out of one mechanism instead of needing four.

**3. Immutability by default, structural sharing by construction.**
A patch application copies only the nodes along the patched path; every untouched object is
shared by reference (`store.getState().objects.a === previousState.objects.a`). Renderers can
therefore diff cheaply, and "did this change?" is `!==`. The scene stays plain JSON — no class
instances, no cycles, no functions — so serialization is `JSON.stringify` with a validator,
not a custom encoder.

**4. Undo is derived, never snapshotted.**
Commands carry their own inverse, computed against the document they were about to modify.
Memory is proportional to the number of edits, not to document size, and a 10,000-object board
undoes as cheaply as an empty one. Snapshots are the thing you reach for when the mutation
model is unprincipled; we did not need them.

**5. One gesture is one atomic step.**
`Ctrl+Z` after moving five shapes must move five shapes back. `store.transaction(fn, {label})`
collects every command dispatched inside it into a single history entry; nested transactions
flatten into the outermost; a transaction whose body throws rolls back exactly the commands it
applied. Tools are written so that a whole drag — press, move, release — commits once, at
release.

**6. The renderer is a projection, not an owner.**
`@coslate/konva` reads the scene and writes Konva node attributes. It has no API to change
the document. The only concession to interactivity is that in-flight gestures move *nodes*
directly for instant feedback; the commit at the end of the gesture re-establishes the
scene as truth, and an aborted gesture is corrected by the next render pass.

**7. Serialization is a contract with a version, and it fails loudly.**
`format` names the document type, `version` is an integer, and reading a document written by a
*newer* build throws a typed error instead of silently dropping the fields it does not
understand. A whiteboard that eats your drawing is worse than one that refuses to open it.

**8. Prefer open payloads to closed schemas.**
`SceneObject.data` is typed per object type, but `SceneObject.meta` and `Scene.meta` are
deliberately free-form. Provenance, authorship, comments, plugin scratch space and future AI
annotations all live there without a schema change, which means features can ship without a
migration and without a format bump.

**9. The core has no dependencies, and the boundary is enforceable.**
`@coslate/core` has zero runtime dependencies, no DOM access and no renderer import. That is
not a stylistic preference: it is what allows the same model to run in a browser, in a worker,
in Node, in a test, and — later — on a server that has never heard of a canvas. It is checked
by the compiler, not by good intentions: the core `tsconfig` does not include the DOM lib.

**10. Test the model hard, then prove the product in a real browser.**
Model behaviour (patch inverses, transaction atomicity, undo ordering, viewport invariance,
serialization round-trips) is unit tested, because those are the things that break silently.
The user-visible product is verified end-to-end in a real Chromium, with assertions that read
the live scene through `window.__scene` rather than scraping DOM text, because a green DOM
proves nothing about the document.

---

## 2. The scene model

```ts
interface Scene {
  format: 'coslate/scene';
  version: 1;
  viewport: { x: number; y: number; scale: number };
  objects: Record<Id, SceneObject>;
  order: Id[];                 // authoritative paint order
  meta?: Record<string, unknown>;
}
```

`objects` is a lookup table keyed by id; `order` is the paint order. Splitting them keeps
reordering O(n) on the order array instead of rewriting a `z` field across the whole document,
while `z` is still maintained as a denormalised mirror because it makes scene dumps readable and
gives plugins a cheap sort key.

Geometry is transform-based, never baked:

```
world = R(rotation) · S(scaleX, scaleY) · local + (x, y)
```

`x`/`y` place the object, `width`/`height` are its untransformed box, and rotation happens
around the object's **top-left corner** — a choice made so the scene contract, the Konva node
origin and the hit-test math all agree without conversion code.

`viewport` lives inside the document. That makes the camera serializable and testable, and it
means save/load restores what the user was looking at.

---

## 3. The command protocol

```ts
interface Command {
  id: Id;
  type: string;               // 'object.create' | 'object.move' | 'object.style' | ...
  patch: JSONPatchOp[];       // forward operations, RFC 6901 pointers
  inverse: JSONPatchOp[];     // exact reverse, stored back-to-front
  source: 'user' | 'api' | 'system';
  txId?: string;              // shared by every command in one transaction
  timestamp: number;
  label?: string;
  transient?: boolean;        // applied but not recorded as an undo step
}
```

The patch engine is ~300 lines in `packages/core/src/jsonpatch.ts` and supports three
operations — `add`, `replace`, `remove` — over paths such as `/objects/obj_1/x`, plus the
append token `/order/-`. It is deliberately ours rather than a dependency: this is the spine of
the product, both undo and (later) remote sync are defined in terms of it, and it must be
auditable in one sitting.

Two details that are easy to get wrong and are handled explicitly:

- **Array inserts invert to removals.** `add /order/0` shifts everything after it, so its
  inverse is `remove /order/0` — not `replace /order/0`, which is what a naive
  capture-the-old-value implementation produces and which silently duplicates ids.
- **`/order/-` is normalised** to a concrete index when the inverse is computed, so replay and
  undo stay exact even if the transaction appends several objects.

### Transactions

```
store.transaction((scene, tx) => {
  store.dispatch(tx.commit('object.create', addObjectOps(a)));
  store.dispatch(tx.commit('object.create', addObjectOps(b)));
}, { label: 'Paste 2 objects' });      // → one undo step, two commands
```

- Nested transactions reuse the outermost `txId`, so inner groups never leak into history.
- A callback that throws rolls back the commands it applied and rethrows; the document is left
  exactly as it was.
- Commands stream to subscribers as they are dispatched (tools need immediate feedback) while
  history records a single entry when the outermost transaction closes.
- `transient: true` marks view-only changes. Camera moves use it, so `Ctrl+Z` undoes *content*,
  which is what a user means by "undo".

### Undo / redo

`History` is a bounded stack of entries (`{ txId, label, commands[], timestamp }`). Undo walks
an entry's commands backwards applying inverses; redo walks them forwards. The bound is a hard
cap (200 by default) so a long session cannot grow without limit. `applyRemote()` applies
commands forward, never records them, and drops the redo branch — keeping a stale redo branch
alive across an out-of-band change would let redo resurrect state a peer already superseded.

---

## 4. The renderer boundary

```
store.getState() ──subscribe──▶ SceneRenderer.sync(scene)
                                     │
                                     ├─ grid layer     (screen space: background + grid)
                                     ├─ content layer  (world space: one node per object)
                                     └─ overlay layer  (screen space: transformer, marquee, previews)
```

- **Reconciliation, not rebuilding.** Nodes are keyed by object id: `sync()` creates what is
  new, updates what changed, destroys what is gone and re-applies paint order only when the
  order array actually changed. Selection and transformer attachments survive a re-render.
- **The content layer carries the camera, not the stage root.** Konva's `Transformer` sizes its
  anchors in screen pixels and assumes an unscaled parent, and transient UI should not get
  thicker as you zoom in. Transforming the content layer keeps the overlay in screen space and
  keeps Konva's transformer honest.
- **Hit testing does not use the canvas.** It is pure geometry over the scene model
  (`packages/konva/src/geometry.ts`), so it is unit-testable, renderer-independent, and gives
  the behaviour users expect — an unfilled rectangle is clickable anywhere inside it, and a
  locked object is not clickable at all. Content nodes are `listening(false)`; the only thing
  that reaches Konva's hit graph is the transformer's own handles, which is exactly how the
  editor knows to hand a pointer-down to Konva instead of starting a scene drag underneath it.
- **Every transient visual lives on the overlay layer.** That is what makes PNG export a
  one-liner: hide the overlay, fit the content, snapshot, restore the camera.

---

## 5. Serialization contract

```ts
serialize(scene, { pretty? }): string
deserialize(text | object): Scene      // throws SceneSerializationError
migrate(raw, target?): RawDocument     // the migration hook
registerMigration(fromVersion, fn)
```

| Situation | Behaviour |
| --- | --- |
| Malformed JSON | `SceneSerializationError('INVALID_JSON')` |
| `format` is not `coslate/scene` | `SceneSerializationError('UNKNOWN_FORMAT')` |
| `version` > reader version | `SceneSerializationError('FUTURE_VERSION')` — never coerced |
| Older `version`, migration registered | migration chain runs, then validation |
| Older `version`, no migration | `SceneSerializationError('UNSUPPORTED_VERSION')` |
| Structurally invalid scene | `SceneSerializationError('INVALID_SCENE')` with the exact path |
| Non-JSON value in the document | `PatchError('TYPE_MISMATCH')` at the offending path |

Validation is strict about structure (ids match keys, `order` is a permutation of `objects`,
viewport numbers are finite) and permissive about payloads: `data` and `meta` are open bags by
design, which is the extension hatch that keeps future features from needing a format bump.
`version` is currently `1`; `migrate()` takes an optional target version so the chain itself is
testable today, before a second version exists.

---

## 6. Object types

| Type | Payload (`data`) | Geometry | Notes |
| --- | --- | --- | --- |
| `shape.rect` | `fill`, `stroke`, `strokeWidth`, `cornerRadius` | box | Fill may be `null` (no fill); still clickable inside. |
| `shape.ellipse` | `fill`, `stroke`, `strokeWidth` | box | Drawn with a custom `sceneFunc` so the node origin stays the top-left corner. |
| `shape.line` | `points[]`, `stroke`, `strokeWidth` | bbox + local points | Points are local to `x`/`y`, so resize is a pure scale. |
| `shape.arrow` | line + `pointerLength`, `pointerWidth` | bbox + local points | Arrowhead is geometry, not a texture. |
| `shape.text` | `text`, `fontFamily`, `fontSize`, `fill`, `align` | box, measured | Edited in a DOM `<textarea>` overlay; resize scales the font and re-measures. |
| `freehand.stroke` | `points[]`, `stroke`, `strokeWidth` | bbox + local points | Ink is semantic point data, never a bitmap. |

All types share the same transform fields, the same `version`, and the same `meta` hatch.

---

## 7. Interaction model

- **Pointer gestures** are owned end-to-end by `WhiteboardEditor`: it decides whether a press
  is a pan (space / middle button), editor UI (transformer handle), or a tool gesture, and it
  guarantees the "one gesture, one command" rule.
- **Drag, resize and rotate** move nodes during the gesture and commit once. Box shapes bake
  the transformer's scale back into `width`/`height` (scale stays `1`); text converts scale into
  `fontSize` and re-measures. Without this, scene files rot into a pile of nested scales that no
  exporter or importer can reason about.
- **Text** is rendered on the canvas and edited in a real `<textarea>` positioned and
  transformed to match the shape's world placement. IME, caret placement, selection and
  accessibility are DOM problems; pretending otherwise on a canvas is how editors get bad.
- **Wheel semantics**: plain wheel zooms, ctrl/⌘+wheel zooms finely (pinch on a trackpad), and a
  wheel event carrying horizontal travel is treated as a two-finger pan. `preventDefault()` is
  always called so the browser never scrolls or zooms the page over a canvas.

---

## 8. Non-goals for v1

Explicitly out of scope, and enforced by not building them:

| Not in v1 | Why |
| --- | --- |
| AI / MCP integration | Needs a stable command protocol first; a model that edits a scene must be an ordinary command producer, never a renderer hook. |
| Collaboration, CRDT, multi-user | The command protocol is the prerequisite; sync belongs behind it, not inside the store. |
| Real-time transport | Same as above. v1 has no network code at all. |
| Formulas / LaTeX | A text-engine project, not a scene-runtime project. |
| Pages / images / embeds | Each is a new object family plus asset lifecycle; the object table is the place to add them, later. |
| React bindings | The runtime is framework-free on purpose; bindings belong in a separate package. |
| zod or runtime schema validation | The validator is small, typed and dependency-free; a schema library would be a dependency in the one package that must not have any. |
| SVG renderer | The renderer boundary makes one possible; shipping two renderers in v1 would double the surface for no user benefit. |
| Themes beyond dark | Cosmetic, and it would leak product decisions into the runtime. |
| Runtime-loaded plugins | The object-type table is open, but a plugin *loader* needs a security and versioning story that v1 does not have. |

---

## 9. Growth path (designed, not built)

**Command protocol → remote / undo-safe sync.**
Commands are already immutable values with inverses and a `source` tag. A sync layer becomes:
transport commands, apply remote batches with `applyRemote()` (forward only, no history, redo
branch cleared), and reconcile with an operation log. Nothing in the store needs to change to
support it; what is missing is a conflict policy, not a mechanism.

**Object Plugin registry.**
`ObjectType` is a string union with a namespaced shape (`shape.rect`), so third-party types such
as `acme.chart` fit without a schema change. A registry would map a type to: a renderer, a
default `data` factory, a hit-test strategy, a bounds strategy and a property schema. The
renderer's `switch` on object type is the seam where that registry plugs in.

**Domain packs.**
A pack is a bundle of object types, tools and commands for one domain (flowcharts, UML, music
notation) built on the same command protocol. Because packs only create commands, they compose
with undo, serialization and future sync for free.

**AI as an optional scene-mutating client.**
An AI feature must never touch the renderer. It reads the scene and emits commands with
`source: 'api'`, ideally inside one transaction with a `label`, so its work is one honest undo
step that a human can inspect, refine or reject. `meta` is where provenance and confidence
annotations live, which is why it is free-form today.

---

## 10. Roadmap

| | Scope | Status |
| --- | --- | --- |
| **v1** | Scene model, command protocol + JSON Patch, transactions, bounded undo/redo, viewport math, serialization with migrations, Konva renderer, six object types, eight tools, style system, PNG/JSON export, demo app, unit + Playwright suites | **shipped** |
| **v1.1** | Grouping (`parentId` is already reserved), lock/hide UI, copy/paste across documents, image object, alignment guides, snap-to-grid, multi-page documents, `store.beginTransaction()` for long-lived gestures | planned |
| **v2** | Object Plugin registry, domain packs, optional sync package built on the command protocol, AI client as a first-class command producer, alternative (SVG/headless) renderers | planned |

---

## 11. Package boundaries

| Package | May depend on | Must not |
| --- | --- | --- |
| `@coslate/core` | nothing at runtime | use the DOM, import a renderer, hold editor state |
| `@coslate/konva` | `@coslate/core`, `konva` | own the document, mutate the scene directly, leak Konva types into the public scene API |
| `apps/demo` | both packages | contain whiteboard logic that belongs in a package |

`packages/konva` consumes `@coslate/core` through its built `dist` output via a TypeScript
project reference, so the boundary is enforced by the compiler: a stray deep import from
another package fails `pnpm typecheck`.

---

## 12. Testing strategy

| Layer | Tool | What it proves |
| --- | --- | --- |
| Patch engine | vitest | apply semantics, immutability, structural sharing, inverse round-trips |
| Store / history | vitest | transaction atomicity, one-step grouping, undo/redo ordering, bounded history, remote application |
| Viewport | vitest | world↔screen round-trip, cursor-pinned zoom invariance, fit-to-content |
| Serialization | vitest | round-trip equality, typed failures including future versions |
| Geometry | vitest | hit testing, marquee selection, point normalisation, content bounds |
| Product | Playwright + real Chromium | tools produce the right *scene state*, zoom changes the rendered canvas, export produces real files |

The e2e suite asserts against `window.__scene` — the live document — rather than DOM text, so a
green run means the model, the command pipeline, the renderer and the tools agree.
