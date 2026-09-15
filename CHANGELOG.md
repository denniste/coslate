# Changelog

All notable changes to CoSlate are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver while `0.x` —
anything may still change, but breaking changes are called out explicitly.

## 0.2.2 (unreleased)

### Changed

- **Mouse-wheel zoom is deliberately slower and per-browser consistent.** A plain wheel notch
  (~100 px) now zooms ≈×1.20 (it was ≈×1.82, near-doubling per notch), and `ctrl`/`meta`+wheel —
  the fine step, and the shape a trackpad pinch arrives in — lands ≈×1.06. `WheelEvent.deltaMode`
  is normalized (lines→pixels, pages→pixels), so Firefox wheels no longer step differently from
  Chrome's. The conversion is a pure, exported helper: `wheelZoomFactor(deltaY, deltaMode, fine)`
  in `@coslate/core`. Proven by the `viewport: wheel zoom factor` unit suite and e2e `ad`.

## 0.2.1 — the toolbar's clear button was not an edit

### Fixed

- **The chrome's "clear the board" button called `clear()` instead of `clearAll()`.** `clear()` is
  the destructive reset kept for "open a different board": it replaces the document without going
  through the command pipeline, so it was **not undoable and not broadcast** — the person pressing
  it lost the board locally (and their history) while every other participant kept the old drawing.
  It now calls `clearAll()`, which is one transaction: undoable, and delivered to peers like any
  other edit (R7). The button previously had no page-level assertion; it has one now (e2e `aa`).
- **`store.applyDelta` could not tell a duplicate frame from a corrupt one** (bug-log O1). Both
  returned `false`, and a corrupt frame never reached `onError`. `applyDelta` now reports a corrupt
  frame through `onError` (a `TypeError`, context `'applyDelta'`); a retransmitted duplicate or an
  empty-but-valid frame (`{}`, `{added: []}`) still returns `false` in silence, and the call never
  throws (R4). A host can count genuinely dropped frames without pre-validating.
- **The chrome drew a language control when there was nothing to choose** (bug-log O2). The
  language `<select>` is now built only when `i18n.languages.length >= 2`, so a host shipping one
  language (or none) no longer gets a visible, empty, dead control. Proven by e2e `ab`.

### Changed

- **`WhiteboardEditor` gains `resetDocument()`, the unambiguous name for the destructive reset**
  (bug-log O3). The one-word difference between `clear()` (reset + drop history, "open a different
  board") and `clearAll()` (one undoable transaction) is how the toolbar bug above happened.
  `clear()` remains as a `@deprecated` alias so 0.2.x embeds keep compiling; **removal is deferred
  to the next breaking release**. `clearAll()` is unchanged. The demo's test hook exposes both
  names. Documented in `README.md` and `ARCHITECTURE.md`.

### Added

- **Page-level proof for every document-mutating toolbar control** (e2e `ac`): delete, duplicate,
  send-to-back, bring-to-front, stroke colour, stroke width and a text commit are each driven with
  real input, asserted to change the document, and asserted to be reverted by exactly one undo —
  the same standard e2e `aa` set for the clear button.

## 0.2.0 — host-ready

The release that makes the runtime embeddable by its first host. Two changes are **breaking**;
both were introduced by the same host-readiness work and neither has a migration cost beyond what
is described.

### Breaking

- **`Scene` is version 2, and the camera is no longer part of the document.** v1 documents kept a
  `viewport` field, which meant a shared document carried one participant's view of it and a saved
  baseline restored whoever saved last. The camera now belongs to the editor (or viewer) as
  per-user view state; a host that wants "reopen where I left off" persists it itself.
  - **Old documents still open**: a registered v1 → v2 migration drops the field
    (`packages/core/src/serialize.ts`); no host wiring is needed.
  - Documents written by a *newer* build fail loudly with `SceneSerializationError('FUTURE_VERSION')`
    rather than being silently coerced.
  - A **cached baseline** that cannot be understood still never throws: `readBaseline` reports
    `{status:'empty', reason}`.
- **The text tool ships no copy any more.** v1 hard-coded an English placeholder (`'Type…'`) and an
  English accessible name (`'Edit text'`) for the text field. Both are now editor options
  (`textPlaceholder`, `textAriaLabel`, each a string or a function read when the field opens). An
  embed that omits them gets an empty, unlabelled field — never English baked into a localized UI.

### Changed

- `peerDependencies` are aligned to this release: `@coslate/konva` requires `@coslate/core`
  `^0.2.0`, `@coslate/ui` requires `@coslate/konva` `^0.2.0`.
- `SceneStore.applyRemote` now applies a batch **atomically**: it builds the whole batch against a
  working copy and refuses it whole (leaving the document untouched) if any command cannot apply.
  Previously a mid-batch failure could leave a half-applied batch — silent divergence between
  peers. A host observing a refused batch now gets `onError` and an unchanged document.

### Added

- **Object-state records for sharing** (`@coslate/core`): `recordsFromCommands` derives
  `{added, updated, removed, order}` from local commands, `shouldBroadcast` is the echo guard
  (it excludes `remote` only — undo/redo still reach the room), and `store.applyDelta` applies an
  inbound delta idempotently (by content, so a retransmitted frame is a no-op) and atomically.
- **Read-only, in two shapes** (`@coslate/konva`): `createSceneViewer` — a projection with no input
  path at all — and `WhiteboardEditor.setReadOnly`/`isReadOnly`, safe mid-gesture, which closes
  every mutating entry point.
- **`clearAll()`** — the board is wiped as one undoable step that broadcasts like any other edit;
  `clear()` stays the destructive "open a different board".
- **Baseline semantics** (`@coslate/core`): `isSceneEmpty(scene)` and `readBaseline`, which never
  throws.
- **`getSummary()`** on the editor: `{objects, bytes, selection, zoom, readOnly, canUndo, canRedo,
  isEmpty}` with the byte count measured from the real compact serialization.
- **`@coslate/ui`** — the chrome (toolbar, style, zoom, language menu, status bar) as its own
  package: ships its own stylesheet (`ensureChromeStyles`, no CSS pipeline needed), themes through
  `--coslate-*` custom properties, takes every user-visible string from the host
  (`ChromeMessageKey`), and collapses entirely via `chrome:'none'` / `setChromeVisible(false)`.
- **A controllable page visual contract** (`@coslate/konva`, defaults in `@coslate/core`): a host
  sets the page background and can disable or restyle the grid — colour of the minor/major lines
  and the base spacing — on the editor, the viewer or the renderer, at construction
  (`background`, `grid` options) or at runtime (`setBackground`/`setGrid`, with
  `getBackground`/`getGrid` to read back). The PNG export paints the same page layer with the
  camera the export borrows, so an export always carries exactly the configured background and
  grid. Like the camera, this is view state: it never appears in a serialized `Scene`, a delta or
  an undo step. Defaults (`#14161a`, faint white grid, base spacing 20) are documented in
  `README.md` and `ARCHITECTURE.md`.

## 0.1.0 — an open interactive scene runtime

Initial release: the scene model (v1), the command protocol with a minimal built-in JSON Patch,
derived undo/redo with transactions, viewport math, serialization with a migration hook, the Konva
renderer, six object types, eight tools, the style system, locale primitives (`createI18n`), PNG/JSON
export, the demo app, and the unit + Playwright suites.
