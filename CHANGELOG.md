# Changelog

All notable changes to CoSlate are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver while `0.x` —
anything may still change, but breaking changes are called out explicitly.

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

## 0.1.0 — an open interactive scene runtime

Initial release: the scene model (v1), the command protocol with a minimal built-in JSON Patch,
derived undo/redo with transactions, viewport math, serialization with a migration hook, the Konva
renderer, six object types, eight tools, the style system, locale primitives (`createI18n`), PNG/JSON
export, the demo app, and the unit + Playwright suites.
