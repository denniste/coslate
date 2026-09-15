# Getting started with CoSlate

CoSlate ships as three packages. You need all three only if you want the ready-made UI chrome —
the editor and the viewer work without it.

```bash
npm install @coslate/core @coslate/konva konva        # editor or viewer
npm install @coslate/ui                                # optional chrome
```

`konva` is a peer dependency of `@coslate/konva` (MIT). Node 20+ is expected for the toolchain;
the runtime itself is browser JavaScript (ESM, TypeScript types included).

## The editor

```ts
import { WhiteboardEditor } from '@coslate/konva';

const editor = new WhiteboardEditor({
  container: document.querySelector<HTMLElement>('#board')!, // must be position: relative
});

editor.setTool('pen');                        // select · pen · eraser · rect · ellipse · line · arrow · text
editor.setStyle({ stroke: '#4dabf7', strokeWidth: 4 });
```

The editor's container must be a positioned element — the canvas and the text overlay are laid out
inside it. Everything the user can do with a tool is also available programmatically, and every
mutation is a command: undoable, serializable, and derivable into a wire payload.

- `editor.undo()` / `editor.redo()` — history is derived from command inverses; one gesture is one
  undo step.
- `editor.clearAll()` — wipes the board as **one** undoable step (the right call for "clear the
  room").
- `editor.resetDocument()` — the destructive reset for "open a different board"; history is
  dropped. (`clear()` still compiles as a deprecated alias — new code should say which of the two
  it means.)
- `editor.setReadOnly(true)` — hot-swappable gate; safe at any moment, including mid-gesture. The
  camera stays live.
- `editor.getSummary()` — `{ objects, bytes, selection, zoom, readOnly, canUndo, canRedo, isEmpty }`
  for a host status line.

## The chrome (optional)

```ts
import { createChrome } from '@coslate/ui';
import { createI18n } from '@coslate/core';
import { en } from './catalog-en';              // your translations, typed against one reference

const i18n = createI18n({ catalogs: { en }, requested: navigator.languages });
const chrome = createChrome({ toolbar, statusbar, editor, i18n });
```

The chrome ships **no user-visible copy**: every label, tooltip and status message comes from your
catalog, typed so a missing translation is a compile error. Theme it with `--coslate-*` custom
properties; hide it entirely with `chrome: 'none'` (a "mini" state) or `chrome.setChromeVisible(false)`.
The style row offers a stroke palette, fill options and stroke widths.

## The read-only viewer

```ts
import { createSceneViewer } from '@coslate/konva';

const viewer = createSceneViewer({ container: document.querySelector<HTMLElement>('#stage')! });
viewer.applyDelta(delta);      // the same object-state deltas an editor ingests
```

A viewer is a renderer plus a store with **no input handlers at all** — not a disabled editor.
Use it for audiences, anonymous participants and live mirrors.

## Sharing a scene (object state, never patches)

```ts
import { recordsFromCommands, shouldBroadcast } from '@coslate/core';

editor.store.subscribe((event) => {
  if (!shouldBroadcast(event)) return;                 // received batches never echo
  const delta = recordsFromCommands(event.scene, event.commands);
  if (delta) channel.send(delta);                      // { added, updated, removed, order }
});
```

```ts
store.applyDelta(delta);        // editor or viewer: idempotent, atomic, never in the undo stack
```

The wire format is upsert state, so retransmitted and duplicated frames cannot corrupt the
document, and remote changes never enter local undo.

## Saving and loading

```ts
const json = editor.toJSON();   // pretty-printed, for humans and "open file"
editor.loadJSON(json);          // throws on a corrupt or newer document — a user-opened file
                                // fails loudly rather than eating the drawing

import { isSceneEmpty, readBaseline } from '@coslate/core';
isSceneEmpty(editor.getScene());              // a blank board need not occupy a baseline slot
const result = readBaseline(cached);          // a cached baseline NEVER throws:
                                              // { status: 'ok', scene } | { status: 'empty', reason }
```

`readBaseline` is the tolerant reader for server-stored blobs that may have been written by a
different engine or a newer build; `loadJSON` is the strict one, for files the user chose.

## The page: background and grid

The board's background colour and grid are **view configuration**, never document state — they do
not travel in a scene, a delta or an undo step, and the PNG export paints the same page:

```ts
const editor = new WhiteboardEditor({
  container,
  background: '#ffffff',
  grid: { visible: false },
});
editor.setGrid({ color: 'rgba(0,0,0,0.06)', spacing: 25 });
```

## Localizing

Core ships the locale mechanism and no strings. Catalogs are plain `key → message` maps with CLDR
plural forms; matching is BCP 47 + RFC 4647 with likely subtags (`zh` → Simplified, `zh-TW` →
Traditional), and text direction comes from `Intl.Locale`, so Arabic is RTL with no alias tables.
See the repository README's "Localizing it" section for a full example.

## Where to look next

- Feature tour and repository layout: [../README.md](../README.md)
- How it is built: [../ARCHITECTURE.md](../ARCHITECTURE.md)
- Version history: [../CHANGELOG.md](../CHANGELOG.md)
