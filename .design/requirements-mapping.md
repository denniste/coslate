# CoSlate ⇄ CoStage: requirements → implementation

> **Source of requirements:** `.design/requirements.md` in **this** repository — R1–R14, the
> preconditions, C1–C8 host-side changes and D1–D4 decisions. It moved here on 2026-09-15 so that the
> requirement, the code and the evidence live in one place; the host repository keeps only a pointer.
> This file is the requirement-by-requirement answer: what was built, where it lives, and what proves
> it works. The `C*` items are changes in the host repository and are deliberately absent here.
>
> Analysis that shaped the work (moved here from CoStage): `analysis/2026-09-14-coslate-tldraw-gap.md`
> and `analysis/2026-09-14-tldraw-replacement.md`. Scope and origin: `scope-and-origin.md`.

## 0. Where each requirement stands

| # | Requirement | Status | Lives in | Proven by |
| --- | --- | --- | --- | --- |
| **R1** | Read-only projection for viewers and anonymous participants | **done** | `packages/konva/src/viewer.ts` (`createSceneViewer`) | e2e `u` (no input path exists at all); viewer entry `viewer.html` |
| **R2** | Dynamic read-only gating on the editor, hot-swappable, no residual tool state | **done** | `WhiteboardEditor.setReadOnly` / `isReadOnly` | e2e `u` (mid-gesture revocation, every mutator refused) |
| **R3** | Incremental change stream with local/remote/undo origins, no echo | **done** | `records.ts` (`recordsFromCommands`, `shouldBroadcast`), existing `ChangeEvent.origin` | `tests/unit/records.test.ts` (echo, undo reach) + e2e `v` |
| **R4** | Remote application must be idempotent and atomic | **done** | `records.ts` (`SceneDelta`, `applyDelta`), `SceneStore.applyDelta` | `records.test.ts`: 5× replay, fresh-instance replay, batch refusal, invalid-op order |
| **R5** | Snapshot/baseline: serialization, version discrimination, empty-board semantics | **done** | `serialize.ts` (`isSceneEmpty`, `readBaseline`, v1→v2 migration) | `serialize.test.ts` baselines + migrations suites |
| **R6** | The camera must never be broadcast | **done** | `Scene` v2 has no `viewport`; the camera is editor state | `serialize.test.ts` migration; e2e `h` asserts no `viewport` in a saved document |
| **R7** | Clear the board as one undoable step | **done** (0.2.1 fixed the toolbar button) | `WhiteboardEditor.clearAll()` — the chrome's clear button used `clear()`, the destructive reset, so it was neither undoable nor broadcast; it now calls `clearAll()` | `records.test.ts` + e2e `u`/`v`/`aa`; `clearAll` returns the count and is refused read-only; the destructive reset itself is renamed `resetDocument()` in 0.2.1 (bug-log O3), with `clear()` kept as a deprecated alias |
| **R8** | Embeddable UI: tools/style/zoom/theme, hide *all* chrome, stable z-index and container contract | **done** | `@coslate/ui` (`createChrome`, `ensureChromeStyles`, `ChromeTheme`) | e2e `w` (mini state, z-index/container contract, theme override) |
| **R9** | i18n injected by the host, locale hot-swap, RTL | **done** | `packages/core/src/i18n.ts` + `@coslate/ui` string injection | e2e `s`/`t` (zh-CN, zh-Hant, ar/RTL, hot swap without remount) |
| **R10** | Status pushed back to the host status line | **done** | `WhiteboardEditor.getSummary()` | e2e `w` (objects/bytes/editable counters follow drawing and saving) |
| **R11** | The visual contract (page background, grid) is host-settable and the PNG export follows | **done** | `core/src/appearance.ts` (defaults + `resolveGrid`), `renderer.ts` (`setBackground`/`setGrid`, `drawGrid`, `exportDataURL`), editor/viewer options + setters | `appearance.test.ts` (defaults, resolution, never in the document) + e2e `y`/`z` (pixels change, export matches, document byte-identical) |
| **R13** | A whole document applies through the delta path (baseline application) | **done** (0.2.2) | `records.ts` (`diffScenes`), `editor.ts` (`getBaseline`/`applyBaseline`/`loadBaseline`/`downloadBaseline` + `EditorOptions.scene`), `viewer.ts` (`loadBaseline`/`applyBaseline`), chrome save/load-baseline buttons | `records.test.ts` (`records: diffScenes`) + `store.test.ts` (`store: baseline apply`) + e2e `af` |
| **R14** | Connector endpoint binding (flowchart/sequence-diagram foundation; promoted from §5 non-requirement "arrow binding to shapes") | **done** (0.2.5) | `core/src/types.ts` (`EndpointBinding`, `LineData.start/end`), `konva/src/binding.ts` (pure helpers), creation snap + commit-path wiring (`tools/shape.ts`, `editor.ts`, `tools/select.ts`, `tools/eraser.ts`) | `tests/unit/binding.test.ts` (27 tests) + e2e `aj` |

Two open decisions were **adopted as recommended**, and they shape everything else:

| # | Decision | Adopted | Consequence |
| --- | --- | --- | --- |
| **D1** | patch vs **object state (upsert)** on the wire | upsert | Idempotent transport, no inverse on the wire, no arbitrary patch surface — see §2 |
| **D2** | camera **out of the document** vs filtering the wire | out of the document | `Scene` v2 + a migration; a shared document can no longer carry somebody's view of it |
| **D3** | image/asset storage | **not started** (P1) | Deliberately not begun: an embedded base64 image would collide with the server's 8 MB cap and 24 h TTL, so the asset API has to be designed first. |
| **D4** | is "clear the board" undoable? | undoable | `clearAll()` deletes through the ordinary command path; `resetDocument()` (renamed from `clear()` in 0.2.1, bug-log O3) remains the destructive reset for "open a different board". |

## 1. R1/R2 — read-only, in two different shapes

A viewer and a gated editor are different problems and got different mechanisms.

**Viewer.** `createSceneViewer({ container })` builds a renderer plus a store and installs *no
input handlers whatsoever* — there is no tool, no transformer, no text overlay, nothing to
disable and nothing a future edit could forget to disable. It ingests the same `applyDelta` an
editor does, so both converge on identical state from identical messages. The camera is the
viewer's own, so panning and zooming stay live.

**Gated editor.** The product mounts read-only and unlocks when permission arrives, and permission
can be revoked mid-stroke. `setReadOnly(true)`:

- aborts the in-flight gesture and lets the active tool discard its preview,
- closes an open text editor,
- clears the selection, hides the transformer, resets the tool to Select,
- closes **every** mutating entry point — pointer gestures, double-click, `deleteSelection`,
  `duplicateSelection`, `paste`, `setStyle`, `bringToFront`, `sendToBack`, `clearAll`,
  `openTextEditor`.

Remote ingestion (`applyDelta`) and the camera stay available: neither is a local edit. Hiding a
toolbar is not read-only; a host that forgets a check must not be able to write.

## 2. R3/R4 — records on the wire

The first attempt was to transport commands (patches). Reviewing it against a real data channel
found two defects worth stating plainly, because they are the reason for the format that exists
now:

1. **Patch replay corrupts the document.** Re-sending `add /order/-` appends the id a second time;
   `validateScene` then rejects the whole scene, so a reconnecting peer could make the board
   unloadable. Data channels duplicate messages as a matter of course.
2. **Batches were not atomic.** A batch whose third command failed to apply still applied the
   first two, which is silent divergence.

`packages/core/src/records.ts` replaces both:

- **Outbound:** `recordsFromCommands(scene, commands)` reads *patch paths* (not command `type`,
  which hosts invent freely) and returns `{added, updated, removed, order}`, or `null` when there
  is nothing to send. A camera move or a host's private metadata is therefore never broadcast, and
  `shouldBroadcast(event)` excludes exactly one origin — `remote` — so a received batch can never
  echo while a local undo still reaches the room.
- **Inbound:** `store.applyDelta(delta)` → `deltaToCommands` wraps the delta in **one** command
  (one patch, one assignment), and `applyRemote` first builds the whole batch against a working
  copy, refusing it whole if any op fails.
- **Idempotent by content, not by reference:** a retransmitted frame has been through `JSON.parse`
  and arrives as new instances holding the same state, so records compare by content.
  `applyDelta` returns the same scene reference when nothing changed, which makes replay detection
  free.

## 3. R5/R6/R7 — baseline semantics and the camera

- **The camera left the document** (`Scene` v2). It was `Scene.viewport`, which meant a broadcast
  document carried the publisher's view of it — one person panning dragged every participant's
  screen — and a saved baseline recorded whichever camera happened to be current. v1 documents are
  migrated by discarding the field; there is nothing in a document a reader's camera should be
  restored from.
- **Two readers, on purpose.** `deserialize` throws for a file the user chose to open (refusing
  beats eating their drawing). `readBaseline` never throws and returns
  `{status:'empty', reason}`, because a stored baseline is a cache that may have been written by a
  *different engine* — an old third-party snapshot ageing out of Redis must not fail a classroom.
  The reason code is returned rather than swallowed so a host can still log or count it.
- **`isSceneEmpty(scene)`** lets a host skip writing a baseline for a blank board at all.
- **`clearAll()`** deletes every object as one transaction: undoable, and broadcast like any other
  edit, so every participant converges on the same empty board. **`resetDocument()`** (renamed from
  `clear()` in 0.2.1, bug-log O3; `clear()` survives as a deprecated alias) — reset + drop history —
  stays, but for "open a different board".

## 4. R8/R9/R10 — the embeddable UI

- `@coslate/ui` owns the chrome (toolbar, style pill, zoom, language menu, status bar) and ships
  its **own stylesheet, injected once** (`ensureChromeStyles`), so a host needs no CSS pipeline to
  mount it.
- **Theme** is a set of `--coslate-*` custom properties on the package's root element, overridable
  per instance via the `theme` option; no host ever needs to know a class name.
- **`chrome: 'none'` / `setChromeVisible(false)`** is the mini state: the canvas fills the
  container and no chrome remains.
- **z-index and container contract**: one stacking context for the chrome root, with
  `--coslate-z-chrome` / `--coslate-z-tooltip` published so a host's own panels can sit above it.
- **The package ships no visible copy.** Every label, hint, accessible name and status message
  comes from the host's translator; the demo passes its four-language catalog (R9). Locale changes
  re-render in place — no remount — and status text is held as *key + params*, so the last message
  re-renders in the new language too. Arabic mirrors the whole chrome because the layout is flex
  rows plus logical properties.
- **`editor.getSummary()`** gives the host status line `{objects, bytes, selection, zoom, readOnly,
  canUndo, canRedo, isEmpty}`, with the byte count memoised against the scene reference because it
  is the real serialized size.

## 5. R7 regression found by the host, 0.2.1

The first host's page-level acceptance caught something this repository's own suite did not: the
chrome's **clear button** called `editor.clear()`, the destructive reset kept for "open a different
board" (D4). `clear()` replaces the document outside the command pipeline, so pressing the button
emptied the board locally, discarded the local undo history, and **left every other participant
looking at the old drawing** — a peer-visible difference with no error anywhere.

`clearAll()` was already correct and already asserted; the *button* was not asserted at all, which is
exactly the gap I15 exists for. Fixed in 0.2.1: the button calls `clearAll()`, and e2e `aa` now draws
a stroke, presses the button, asserts the board empties, and asserts that one undo restores all of
it (which is what proves the pipeline was used rather than a reset).

## 6. R11 — the page is the host's

The runtime's default page is a dark board with a faint white grid; the first host's classroom
board is white and ungridded. That gap is closed as **view configuration**, deliberately the same
class of state as the camera:

- **Contract in core** (`appearance.ts`): `DEFAULT_BACKGROUND`, `DEFAULT_GRID` and `resolveGrid` —
  the published defaults and the one function that turns a partial option into a complete grid.
  Pure values, no DOM, so the defaults a host reads about and the ones the renderer feeds on are
  the same constants the unit tests pin.
- **Paint in konva** (`renderer.ts`): the grid layer takes `background` and `grid` options and
  runtime `setBackground`/`setGrid`; `drawGrid` reads only that configuration. The editor and the
  viewer expose the same two options and the same two setters. The grid can be disabled
  (`{visible: false}`) or restyled (either colour and the spacing).
- **Export follows by construction.** `exportDataURL` paints this same page layer — and, since this
  change, draws the grid for the camera the export borrows, so the exported grid's spacing is the
  one that camera would show. There is no second code path to keep in sync.
- **Never in the document.** Nothing here can reach a serialized scene, a delta or an undo step
  (I4). The e2e proof is byte-level: `window.__scene.toJSON()` is identical before and after every
  appearance change (e2e `y`), and the viewer's projected scene stays empty through its own config
  changes (e2e `z`).
- **Page-level evidence, as the acceptance standard demands.** e2e `y` samples real pixels of the
  page canvas: default dark + grid → white and ungridded (exactly one colour) → restyled grid draws
  its configured colours → a 10× spacing draws measurably fewer lines → the PNG export carries the
  white background and the configured grid, and loses the grid again when it is disabled.

These values are **not** `--coslate-*` custom properties: those theme the DOM chrome, while the
page is a canvas. The defaults are documented with the theme in `README.md` ("The page: background
and grid") and `ARCHITECTURE.md` §4.

## 7. The 0.2.1 defect fixes — bug-log O1/O2/O3

Three defects tracked in `.design/bug-log.md` were closed in 0.2.1:

- **O1 — corrupt frames are reported, duplicates are not.** `store.applyDelta` now calls the
  store's `onError` (a `TypeError`, context `'applyDelta'`) when a frame is corrupt — not
  delta-shaped, or carrying unusable entries (`isCorruptDeltaFrame`, `core/src/store.ts`). A
  retransmitted duplicate and an empty-but-valid frame still return `false` in silence, and nothing
  ever throws (R4). Proven by `tests/unit/store.test.ts` (`store: applyDelta error reporting`)
  plus the unchanged e2e `v` replay checks.
- **O2 — no language control when there is nothing to choose.** `@coslate/ui` builds the language
  group only when `i18n.languages.length >= 2`. Proven at page level by e2e **`ab`**: present at
  the demo's four languages, absent at one and at zero (toolbar and status bar intact), restored
  with the full table.
- **O3 — the reset is renamed so the names cannot be confused.** `WhiteboardEditor.resetDocument()`
  is the canonical destructive reset; `clear()` remains only as a `@deprecated` alias (removal is
  deferred to the next breaking release), and `clearAll()` is untouched. The demo's test hook
  exposes both names.

## 8. Deliberately not done

These are **P1/P2** in the source analysis and stay out: images/assets (**blocked on the asset-storage
decision**, D3), arrow binding to shapes, laser pointer, system-clipboard interop, rich text,
highlighter, alignment guides and snap-to-grid, touch pinch-zoom, multi-page, grouping/frames/
embeds/bookmarks, presence and comments, full a11y, light theme. §5 of the requirements document
lists them as non-blocking for the replacement.

(R11 **is** on that list's exception path: it was called out in `.design/requirements.md` §2 as
required for this replacement and is now implemented — see §6 above. The settable page background
is view configuration, not the "light theme as a runtime concern" that stays out: the chrome is
untouched.)

## 9. What still has to happen on the host side

`C1`–`C8` are CoStage's changes, not CoSlate's. The two that depend on this work are worth naming
because they are the integration contract:

- **C1** — `web-sdk/src/core/board.ts` keeps its `{t:'ops', added, updated, removed}` shape and
  sends object state; the receiving side becomes `store.applyDelta(...)`. No more LWW merge code
  and no more patch replay.
- **C2/C5** — mounting drives `WhiteboardEditor` (or `createSceneViewer` for the audience) and the
  read-only gate follows `canPublishData`; the CSS that reached into the old engine's DOM classes
  is replaced by the `--coslate-*` custom properties and the published z-index variables.

## 10. The 0.2.2 additions — wheel zoom, custom pickers, baseline application (R13)

Three host-visible changes shipped together in 0.2.2:

- **Wheel zoom slowed and normalised.** `wheelZoomFactor(deltaY, deltaMode, fine)` in
  `core/src/viewport.ts` normalises `deltaMode` (line ×16, page ×100) before the exponential step,
  so a plain mouse-wheel notch is now ≈ ×1.20 (was ≈ ×1.82) and a ctrl/meta step (macOS trackpad
  pinch) ≈ ×1.06. Proven by `viewport.test.ts` (`viewport: wheel zoom factor`) and e2e `ad`.
- **Custom colour pickers for stroke and fill.** The chrome's style pill gains a custom swatch per
  channel — a button carrying the pressed state and `data-testid`, with a hidden `<input
  type="color">` inside; only the `change` event is honoured, so one pick is exactly one undo step.
  A non-palette value lights the custom swatch and no palette swatch. Proven by e2e `ae`.
- **R13 — a whole document applies through the delta path.** The host's three restore legs (live
  channel, reconnect snapshot, fallback poll) converge on one apply path: `diffScenes(from, to)`
  emits the wire's own `SceneDelta` shape and the document travels `store.applyDelta` like any peer
  update — idempotent, atomic, never an undo step, and free when already converged. The editor adds
  `getBaseline()`/`applyBaseline(scene)`/`loadBaseline(json)`/`downloadBaseline()` (+ `EditorOptions.
  scene`), the viewer the load/apply pair, and the chrome save/load-baseline buttons with four new
  copy keys (44→48). The redo branch forks clear like any remote change; the undo stack survives.
  One design note worth keeping: record comparison in `diffScenes` ignores the denormalised `z`
  mirror — local creation leaves the mirror stale, `applyDelta` renumbers mirrors on every apply,
  and the `order` array is the sole paint-order carrier — otherwise an already-converged baseline
  would diff non-null on mirror noise alone. Proven by `records: diffScenes` + `store: baseline
  apply` unit suites and e2e `af`.

## 11. The 0.2.3 additions — line styles, board themes, picker icons

Three host-visible changes shipped together in 0.2.3. All are additive: `SCENE_VERSION` stays
2, no migration, the document shape unchanged (a missing `strokeStyle` means solid).

- **Line styles.** Every stroked object (rect, ellipse, line, arrow, freehand ink) carries an
  optional `strokeStyle: 'solid' | 'dashed' | 'dashDot'`; `dashPattern(style, width)` in
  `@coslate/core` scales the dash segments with the stroke width, and `strokeScaleEnabled(false)`
  keeps the pattern screen-constant under zoom. The style strip gains a three-glyph line-style
  group; the editor style and tool presets carry the key like any other style, so ink drawn
  under a preset inherits its pattern. +3 chrome keys (48→51). Proven by `tests/unit/
  strokestyle.test.ts` and e2e `ag`.
- **Whiteboard / blackboard switch.** `BOARD_THEMES` in `core/src/appearance.ts` pairs each
  board surface with its page background and grid colours; the black preset is exactly the
  documented defaults, so flipping back restores the published contract, and grid colours
  merge over the current grid without re-enabling a hidden one. The flip rides the view-config
  rule (I4): the page background and grid are view state, so the PNG export follows, the
  document stays byte-identical and the undo stack is untouched. The chrome flips in two
  layers: the public `ChromeTheme` tokens go through the same inline `applyTheme`/`clearTheme`
  mechanism as the host's `theme` option (a stylesheet rule can never beat an inline property,
  and hosts may pin their palette that way), while derived surfaces, the color-scheme and the
  custom-picker glyph frames flip in the `[data-board='white']` stylesheet block. The chrome
  exposes `boardTheme` / `onBoardThemeChange` options and `getBoardTheme()` / `setBoardTheme()`.
  +3 chrome keys (51→54). Proven by `tests/unit/boardtheme.test.ts` and e2e `ah`.
- **Picker-icon polish.** The "invisible on the dark chrome" style samples are replaced: the
  no-fill swatch is a transparency checkerboard (its rule outranks the grouped-pill flattening
  rule, which had silently voided every earlier sample style), the panel/board-colour fill
  samples render in neutral grey, and the custom pickers become legible glyphs — an unfilled
  square for stroke (white frame over the chosen colour when active) and a framed square whose
  centre previews the current custom fill. Proven by e2e `ae`'s pressed-state assertions and
  the `ah` glyph-frame colour checks.
