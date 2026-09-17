# Requirements — replacing the third-party whiteboard engine in the first host

> **Authority.** This file is the source of truth for what the runtime must provide so that the host
> application (**CoStage**, a self-hosted live-classroom product) can delete its third-party
> whiteboard engine. It is deliberately kept here, next to the code that must satisfy it, so that
> anyone — human or model/agent — implementing or reviewing can work from one document.
>
> Read with: `.design/INVARIANTS.md` (the rules that must not be broken to satisfy a requirement),
> `.design/requirements-mapping.md` (requirement → implementation → evidence, kept current as work
> lands), `.design/scope-and-origin.md` (why this project exists), `ARCHITECTURE.md` (how it is built).

## 0. How to work from this document

- **Requirement IDs are stable.** `R*` = what this runtime must provide. `C*` = changes on the host
  side, listed here only so the interface is unambiguous — the host repository owns them. `D*` =
  decisions that were open; their current state is recorded in §4.
- **One requirement, one row in the status table (§7).** When you implement one, update its row in
  the same commit: status, the code that satisfies it, and the test that proves it. A requirement is
  **not** done because a document says so.
- **The bar for "done" is §6.** Read it before claiming anything; it is the standard a reviewer will
  apply, and self-reported success without reproducible evidence is treated as not done.
- **Do not weaken `.design/INVARIANTS.md` to make a requirement pass.** If a rule must change, change
  it in the same commit with the reason in the message. Everything in §5 is out of scope even if it
  looks like it would make a requirement easier.

## 1. Preconditions

| # | Precondition | State |
| --- | --- | --- |
| P1 | Published version reflects the breaking `Scene` v1→v2 change (camera out of the document), and `peerDependencies` ranges match. | **done** — all five manifests are `0.2.1`, peers `^0.2.1`; the breaking changes are recorded in `CHANGELOG.md` and `README.md` |
| P2 | R11 (visual contract) is implemented, since the host's board is white and ungridded. | **done** — see R11 |

## 2. Requirements

Each requirement states what is needed, why the host needs it, and what a reviewer will look for.

### R1 — Read-only projection for viewers and anonymous participants
**Why:** viewing is the primary path for most participants; the host renders a live mirror of the
host's board on a page that must not be able to edit it.
**Definition of done:** a viewer can be constructed that renders a scene and ingests live changes
while offering **no** way to modify it — not "a disabled editor", but a surface with no input path.
**Status:** done — `packages/konva/src/viewer.ts`, proven by e2e `u` and the invariant scan.

### R2 — Dynamic read-only gating on the editor
**Why:** the product mounts the board locked and unlocks on permission (`canPublishData`), and
permission can be revoked mid-gesture.
**Definition of done:** read-only can be toggled at runtime; a toggle aborts an in-flight gesture,
closes text editing, clears selection, and causes **every** mutating entry point to refuse —
including calls made programmatically, not just gestures.
**Status:** done — `WhiteboardEditor.setReadOnly`/`isReadOnly`, proven by e2e `u`.

### R3 — Incremental change stream with origin, and no echo
**Why:** the host broadcasts local edits over a data channel and applies peer edits; a received
batch must never be re-broadcast, and a local undo must reach the room.
**Definition of done:** a subscriber receives each atomic step with an origin distinguishing local,
remote, undo and redo; the broadcast predicate excludes remote-origin changes and excludes
`transient` commands; the host can derive a wire payload of changed objects from an event.
**Status:** done — `packages/core/src/records.ts` + `ChangeEvent.origin`, proven by
`tests/unit/records.test.ts` and e2e `v`.

### R4 — Remote application is idempotent **and** atomic
**Why:** the transport duplicates and reorders messages; a half-applied batch silently diverges two
peers, and a replayed patch can corrupt the document's `order` so badly that `validateScene` refuses
the whole scene — an unloadable board during a class.
**Definition of done:** applying the same payload twice changes nothing the second time (including
paint order); a payload containing an operation that cannot apply leaves the document **exactly** as
it was; neither outcome throws at the caller.
**Status:** done — `SceneDelta`/`applyDelta` + batch-refusal in `applyRemote`, proven by
`tests/unit/records.test.ts` (replay, fresh-instance replay, batch refusal) and the invariants test.

### R5 — Snapshot and baseline semantics
**Why:** the host persists a snapshot server-side (opaque JSON, 8 MB cap, 24 h TTL), unicasts one to
a reconnecting peer, and polls it for passive viewers.
**Definition of done:** the document can be serialized and restored; a document from a *newer* build
fails loudly; a **cached baseline that cannot be understood never throws** — it reports itself empty
with a reason, because a cache may have been written by a different engine; the host can tell whether
a board is empty without serializing it.
**Status:** done — `serialize`/`deserialize`/`readBaseline`/`isSceneEmpty`, proven by
`tests/unit/serialize.test.ts`.

### R6 — The camera is never broadcast
**Why:** a shared document must not carry one participant's view of it. With the camera inside the
document, one person panning dragged every viewer's screen, and a stored baseline restored whoever
saved it last.
**Definition of done:** the camera is not part of the serialized document; each editor and viewer
has its own; older documents still open.
**Status:** done — `Scene` v2 with a registered v1→v2 migration, proven by `serialize.test.ts` and
the invariants test.

### R7 — Clear the board as one undoable step
**Why:** the host exposes a "clear board" control to the teacher; the deletion must reach every
participant as an ordinary edit.
**Definition of done:** clearing deletes every object as a single transaction (one undo restores the
board), broadcasts like any other local edit, and is refused while read-only.
**Status:** done — `WhiteboardEditor.clearAll()`, proven by `records.test.ts` and e2e `u`/`v`.

### R8 — Embeddable UI, with every part of it removable
**Why:** the host currently shows a third-party editor's whole UI; after the swap it must supply the
chrome itself, restyle it to its own dark theme, and keep a "mini" state where only the canvas shows.
**Definition of done:** the host mounts a toolbar and a status area by handing over two elements; it
can hide **all** chrome at once without leaving focusable controls behind; theming is done through
documented custom properties, never by reaching into class names; a stacking-context contract is
published so host panels can sit above the chrome. The host must not need a CSS pipeline.
**Status:** partly done — `@coslate/ui` `createChrome`/`ensureChromeStyles`/`chrome:'none'`/
`--coslate-*`, proven by e2e `w`; **the container/element contract and the full key inventory must be
documented for the host (see R9, R12-open).**

### R9 — All copy comes from the host, and can be enumerated
**Why:** the host is bilingual (and the runtime must not ship copy); the host must be able to know
exactly which strings it has to translate, and switching language must not disturb the board.
**Definition of done:** the runtime contains no user-visible string; the set of keys the chrome asks
for is declared as a type/constant a host can enumerate; a missing key is visible (not blank, not a
throw); changing locale re-renders the chrome in place, including the last status message, without a
remount. RTL is supported.
**Status:** done, with one host-facing caveat — `packages/core/src/i18n.ts` +
`ChromeMessageKey` (54 keys) and the four-language demo, proven by e2e `s`/`t`; the invariants test
enforces "no copy in packages". The host must supply ~54 keys × its languages (see C6).

### R10 — Status pushed back to the host
**Why:** the host shows the teacher a status line (objects, save size, editable, unsaved state).
**Definition of done:** the editor can report object count, the real serialized byte size, selection,
zoom, read-only state and undo/redo availability, and the byte figure is the actual serialized size
rather than an estimate.
**Status:** done — `WhiteboardEditor.getSummary()`, proven by e2e `w`.

### R11 — The visual contract is controllable
**Why:** the host's board is a **white, ungridded** surface (the classroom look), while this runtime
defaults to a dark page and **always** draws a grid whose lines are white — on a white background the
grid is effectively invisible, and the background also changes PNG exports. A host cannot fix this
without either a grid switch or documented theme tokens for the page.
**Definition of done:** a host can set the page background and can disable (or restyle) the grid, so
that a white, ungridded board looks the same as it does today; PNG export follows the same choice;
the values used by default are documented with the rest of the theme.
**Status:** done — `packages/core/src/appearance.ts` (defaults + `resolveGrid`),
`packages/konva/src/renderer.ts` (`setBackground`/`setGrid`, drawn by `drawGrid`, painted by
`exportDataURL`), editor/viewer options and setters. View state, never document state (I4). Proven
by `tests/unit/appearance.test.ts` and, at page level, e2e `y` (editor: pixels change, PNG export
matches, document byte-identical) and `z` (viewer). Defaults documented in `README.md`
("The page: background and grid") and `ARCHITECTURE.md` §4.

### R13 — A whole document applies through the delta path (baseline application)
**Why:** the host's baseline feature has three restore legs — the live data channel (already a
delta), the reconnect snapshot (`{t:'snap', scene}` — a whole document) and a 5-second fallback
poll of the REST baseline (also a whole document). The whole-document legs went through `reset()`,
which silently cleared the local undo stack mid-class, and the two application paths drifted
because whole-document application and the wire delta path were two codebases.
**Definition of done:** `diffScenes(from, to)` produces the same `SceneDelta` shape the wire uses,
so a whole document travels the *identical* apply path as an ordinary peer update: idempotent (a
second application of the same target changes nothing), convergent (the result equals the target,
`order` included), and undo-preserving — the application itself touches neither the undo depth nor
the undo stack, so the local edit made before it is still one undo away. The redo branch is
forked-clear exactly like any other remote change (a stale redo entry carries an old `/order`
replace that would resurrect the superseded paint order — the same clearRedo safety rule as
`applyRemote`, not new behaviour). A baseline that is already converged is a free no-op: no history
entry, no repaint, and the caller can tell (boolean `false` / unchanged scene reference). The R5
contract is untouched: `readBaseline` still never throws — a cache written by another engine or a
newer build reports itself empty with a reason — while `deserialize` still throws for a file the
user explicitly opens. The runtime still does not take over transport, storage, permissions, the
8 MB cap, the 24 h TTL, save cadence or poll cadence: this requirement only solves "apply a whole
document without lying to the undo stack".
**Status:** done (0.2.2) — `diffScenes` (`core/src/records.ts`; record comparison ignores the
denormalised `z` mirror, which `applyDelta` renumbers on every application — the `order` array is
the sole paint-order carrier), editor `getBaseline()`/`applyBaseline()`/`loadBaseline()`/
`downloadBaseline()` + `EditorOptions.scene`, viewer `loadBaseline()`/`applyBaseline()`, chrome
save/load-baseline buttons + `baseline` icon + 4 new copy keys (44→48). Proven by
`records: diffScenes` and `store: baseline apply` unit suites and e2e `af`.

### R14 — Connector endpoint binding (flowchart/sequence-diagram foundation)
**Why:** flowcharts and sequence diagrams share one load-bearing wall — connectors that follow
their shapes. Before this, `shape.arrow` / `shape.line` were two-point polylines: move a rect and
an arrow resting on it stayed behind, broken. Without the primitive, any chart feature is a
generate-once static collage; with it, the everyday editing of shapes and connectors (drag,
resize, rotate, edit text) holds together. This was §5's "arrow binding to shapes", promoted per
the AGENTS.md rule (design doc first, §5 strike after implementation — the O1/O2 precedent). Tier
C (structured chart objects, auto-layout, diagram semantics) builds on this and is deliberately
out of scope here.
**Definition of done:** a connector end dropped within 8 screen px of a bindable box (rect,
ellipse, text) snaps to the nearest point on the box and records a normalized anchor
(`start?` / `end?` on `LineData`, anchor 0..1 on the bound object's *untransformed* box; missing
= free end). While the bound object moves, resizes, rotates or re-measures (font-size restyle,
text edit), the bound ends follow — visually during the gesture (nodes only) and in the stored
`points` in the same transaction at commit, so one gesture stays one undo step. Deleting a bound
object strips survivors' bindings in the same transaction; the stored points stand, and undoing
the delete restores the binding (a patch `remove` inverts to an `add` of the prior value).
`freehand.stroke` never binds; line and arrow share the fields.
**Status:** done (0.2.5) — `EndpointBinding` + `LineData.start/end` (`core/src/types.ts`; optional
fields, missing means unbound, no SCENE_VERSION bump — the `strokeStyle` precedent), pure helpers
`nearestAnchor` / `snapEndpoint` / `resolveAnchorWorld` / `boundArrowOps` / `stripBindingOps`
(`konva/src/binding.ts`, no Konva import), creation snap (`konva/src/tools/shape.ts`), commit-path
wiring (`konva/src/editor.ts` `commitTransform` / `deleteSelection` / `applyStyleToSelection` /
`commitText`, transient `updateBoundArrowsTransient`), drag/erase (`konva/src/tools/select.ts`,
`konva/src/tools/eraser.ts`). `points` remain the authoritative geometry — renderers, export,
viewer and sync are untouched. Accepted boundaries (`.design/requirements/r14-connector-binding.md`):
mixed-version peers do not re-derive until a same-version client moves the box; duplicate keeps
pointing at the original box; single-endpoint re-drag deferred. Proven by `tests/unit/binding.test.ts`
(27 tests) and e2e `aj`.

## 3. Host-side changes (C) — listed for interface clarity only

These are changes in the **host** repository. They are recorded here because they define what the
runtime's interface must support; the host owns their execution.

| # | Change | Interface it depends on |
| --- | --- | --- |
| C1 | The host's whiteboard transport sends **object state** (upsert), and applies arrivals with `applyDelta`; its own last-write-wins merge code is deleted | `recordsFromCommands`, `shouldBroadcast`, `applyDelta` |
| C2 | Board lifecycle drives the editor (or the viewer for the audience); read-only follows the publish permission | `WhiteboardEditor`, `createSceneViewer`, `setReadOnly` |
| C3 | The mount layer and the third-party asset table are deleted | `@coslate/ui` |
| C4 | The host's dependency set drops the third-party engine and React | package manifests |
| C5 | The host's CSS stops targeting the old engine's internal class names; the mini state uses the chrome switch | `chrome:'none'`, `--coslate-*`, `--coslate-z-*` |
| C6 | The host authors ~54 chrome keys in its languages | `ChromeMessageKey`, `createI18n` |
| C7 | Licence entries, the carve-out, the attribution fetch script and the site pages for the removed engine are deleted | — |
| C8 | The frozen legacy front-end and the old proof of concept are left untouched | — |

## 4. Decisions (D)

| # | Decision | State | Consequence |
| --- | --- | --- | --- |
| D1 | patch operations vs **object state** on the wire | **adopted: object state** | idempotent transport, no inverse on the wire, no arbitrary-patch surface |
| D2 | camera out of the document vs filtering the wire | **adopted: out of the document** | `Scene` v2 + migration |
| D3 | image/asset storage | **not started** | an embedded base64 image would collide with the host's 8 MB cap and 24 h TTL, so the asset API must be designed first. Not required for this replacement. |
| D4 | is "clear the board" undoable | **adopted: undoable** | `clearAll()` goes through the ordinary command path; the destructive "open a different board" reset is `resetDocument()` since 0.2.1 (`clear()` remains a deprecated alias, bug-log O3) |

### Open items (not requirements, but known)

- **~~O1 — distinguishing a duplicate frame from a corrupt one~~ (fixed in 0.2.1).**
  `applyDelta` now reports a corrupt frame through `onError` while still returning `false`; a
  duplicate or empty-but-valid frame stays a silent `false`. See `.design/bug-log.md` O1.
- **~~O2 — applying a full snapshot without clearing undo history~~ (promoted to R13, done in
  0.2.2).** `diffScenes` now provides the scene diff; a whole document travels the delta apply path
  and the undo stack survives it (the redo branch forks clear like any remote change).
- **O3 — `shouldBroadcast` ignores `command.source`.** Local undo/redo are broadcast (correct), and so
  would be a programmatic `source:'api'` change. If that is not wanted, the predicate needs a rule.

## 5. Explicit non-requirements

Not needed for this replacement, and **not** to be built in its name: images/assets (D3),
~~arrow binding to shapes~~ (promoted to R14, done in 0.2.5 — connector ends bind to
rect/ellipse/text boxes and follow them through move/resize/rotate/text-edit; see R14), laser
pointer, system-clipboard interop, rich text, highlighter, alignment guides,
snap-to-grid, touch pinch-zoom, multi-page, grouping/frames/embeds/bookmarks, presence, comments,
full accessibility, light theme as a runtime concern, AI/MCP, CRDT collaboration. These belong to the
project's own roadmap (`ARCHITECTURE.md` §11) and must not be pulled in by this work.

## 6. How acceptance is judged

The reviewer applies all of the following. **Anything not reproducible from the repository is not
evidence.**

1. **The suite runs green from a clean checkout**: `pnpm typecheck && pnpm test && pnpm e2e`. The e2e
   suite drives real browser input events and asserts on real scene state; a container existing, a
   pixel count, or a screenshot is not evidence of behaviour.
2. **Behavioural requirements need page-level assertions.** A unit test alone does not discharge R1,
   R2, R3, R7, R8, R9, R10 or R11.
3. **Every claim cites `file:line`.** The status table points at the code and the test that proves it.
4. **The invariants still hold** (`.design/INVARIANTS.md`, enforced by `tests/unit/invariants.test.ts`).
   Weakening a rule to pass a requirement is a failed review, not a shortcut.
5. **Document-shape changes carry a version bump and a migration**, with proof that documents from the
   previous version still open.
6. **Host-facing interface changes carry a version bump** and a note in `README.md`/`ARCHITECTURE.md`.
7. **Nothing from §5 appears in the diff.**
8. **Self-reported success without evidence is treated as not done.** Where something is partial, say
   so; a partial requirement reported honestly passes review faster than a claimed one that is not.

## 7. Status

Update the relevant row in the same commit that changes its state. `Evidence` means: code + the test
that proves it.

| # | Requirement | Status | Evidence (code · test) |
| --- | --- | --- | --- |
| R1 | Read-only projection | done | `konva/src/viewer.ts` · e2e `u`, invariants test |
| R2 | Dynamic read-only gating | done | `konva/src/editor.ts` (`setReadOnly`) · e2e `u` |
| R3 | Change stream with origin, no echo | done | `core/src/records.ts` · `records.test.ts`, e2e `v` |
| R4 | Idempotent **and** atomic remote apply | done | `core/src/records.ts`, `core/src/store.ts` · `records.test.ts`, `store.test.ts` (corrupt-frame reporting, 0.2.1) |
| R5 | Snapshot / baseline semantics | done | `core/src/serialize.ts` · `serialize.test.ts` |
| R6 | Camera never broadcast | done | `core/src/types.ts` (v2 + migration) · `serialize.test.ts` |
| R7 | Clear board as one undoable step | done | `konva/src/editor.ts` (`clearAll`), and the chrome button now calls it too · `records.test.ts`, e2e `u`/`v`/`aa` |
| R8 | Embeddable, fully removable UI | partly done | `packages/ui` · e2e `w`; container contract + key inventory to document |
| R9 | Host-injected copy, enumerable | done | `core/src/i18n.ts`, `ui` `ChromeMessageKey` · e2e `s`/`t` |
| R10 | Status pushed to the host | done | `konva/src/editor.ts` (`getSummary`) · e2e `w` |
| R11 | Visual contract controllable | done | `core/src/appearance.ts`, `konva/src/renderer.ts` (`setBackground`/`setGrid`/`drawGrid`/`exportDataURL`), editor+viewer options · `appearance.test.ts`, e2e `y`/`z` |
| R13 | Whole document applied via the delta path | done | `core/src/records.ts` (`diffScenes`), `konva/src/editor.ts` (`getBaseline`/`applyBaseline`/`loadBaseline`), `konva/src/viewer.ts` · `records.test.ts` (`records: diffScenes`), `store.test.ts` (`store: baseline apply`), e2e `af` |
| R14 | Connector endpoint binding | done (0.2.5) | `core/src/types.ts` (`EndpointBinding`, `LineData.start/end`), `konva/src/binding.ts`, creation snap + commit-path wiring (`tools/shape.ts`, `editor.ts`, `tools/select.ts`, `tools/eraser.ts`) · `binding.test.ts` (27), e2e `aj` |
| P1 | Version reflects the breaking change | done | all five manifests `0.2.0`, peers `^0.2.0` · `CHANGELOG.md`, `README.md` |
| P2 | R11 implemented | done | = R11 |
