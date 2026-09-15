# @coslate/core

The scene model, command protocol and serialization of [CoSlate](https://github.com/denniste/coslate)
— an open, embeddable interactive-scene runtime (a whiteboard core, not the whole product).

**Zero runtime dependencies. Zero DOM access.** It runs headless — in Node, in workers, in tests —
and it is small enough to audit in one sitting.

## What is in it

- **`Scene`** — a plain-JSON document (`format` + `version` + `objects` + `order`) with immutable
  updates and structural sharing. The camera is deliberately not part of it (v2; v1 files are
  migrated automatically on open).
- **Commands** — every mutation is a command carrying its own inverse. Undo/redo is derived, never
  snapshotted; `store.transaction` folds many commands into one undo step; a throwing transaction
  rolls back completely.
- **Records** — the wire format: object state (`{ added, updated, removed, order }`), never patch
  operations. `applyDelta` is idempotent by content and atomic; `shouldBroadcast` is the echo
  guard; a data channel that duplicates messages cannot corrupt the document.
- **Serialization** — `format` + `version` + a registered migration chain. A document from a newer
  build fails loudly; a cached baseline never throws (`readBaseline` reports
  `{status:'empty', reason}`).
- **`createI18n`** — the locale *mechanism* and no copy: BCP 47 lookup with CLDR likely subtags,
  plural categories, `Intl` number formatting and text direction.
- **Viewport math** — world↔screen, cursor-pinned zoom, pan, fit-to-content.

## Install

```bash
npm install @coslate/core
```

## Use it headless

```ts
import { createStore, makeObject, addObjectOps, serialize, deserialize } from '@coslate/core';

const store = createStore();
store.transaction((_scene, tx) => {
  const rect = makeObject({ type: 'shape.rect', x: 10, y: 10, width: 120, height: 80 });
  store.dispatch(tx.commit('object.create', addObjectOps(rect), { label: 'Add rect' }));
});                                    // one gesture, one undo step
store.undo();

const text = serialize(store.getState());   // portable JSON document
const scene = deserialize(text);
```

Pair it with [`@coslate/konva`](https://www.npmjs.com/package/@coslate/konva) for the renderer,
tools and editor, and [`@coslate/ui`](https://www.npmjs.com/package/@coslate/ui) for optional
chrome. The surface a host may depend on is pinned in
[`docs/INVARIANTS.md`](https://github.com/denniste/coslate/blob/main/docs/INVARIANTS.md).

## License

MIT.
