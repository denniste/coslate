# Verification record

> **This file is a log, newest first.** The current state of the project is the
> [v0.2 host-readiness run](#1-v02--host-readiness-2026-09-15-current) right below: **128 unit tests,
> 24/24 end-to-end assertions, both demo pages building**. Everything after it is kept as history —
> §2 is the i18n-era run (20/20) and the staging sections that follow it are the original v0.1
> record (16/16). Where any of them disagree with the newest, the newest wins.

Everything below was executed in this directory on the staging machine. Raw output for the
end-to-end run is in `.artifacts/e2e-report.json`; screenshots are in `.artifacts/`.

Environment: Node v24.14.1, pnpm 12.3.4, Chromium 1228 (preinstalled),
`http_proxy=http://127.0.0.1:7890`, `npm_config_cache=<npm cache dir>`,
stage-local pnpm store at `.pnpm-store/`.

---

## 1. v0.2 — host-readiness (2026-09-15, current)

Requirement source: CoStage's `docs/COSLATE-REPLACEMENT-REQUIREMENTS.md` (R1–R10, C1–C8, D1–D4).
Requirement-by-requirement mapping: [`docs/requirements-mapping.md`](./docs/requirements-mapping.md).

| Step | Result |
| --- | --- |
| `pnpm typecheck` | PASS — 5 TypeScript projects (core, konva, ui, demo, tests), zero errors |
| `pnpm test` | PASS — **128/128 in 7 files** (records 25, i18n 25, store 24, serialize 19, viewport 14, geometry 12, jsonpatch 9) |
| `pnpm build` | PASS — two entries: see the payload table below |
| `pnpm e2e` | PASS — **24/24 assertions**, zero page errors |

Final run for this record: `24/24 assertions passed` with `pageErrors = []`
(`.artifacts/e2e-report.json`), from a clean tree after the `@coslate/ui` extraction.

**Defects this round was written to remove** (each found by review or by a test, not by a user):

1. **Patch replay corrupted the document.** Re-sending `add /order/-` appended the id a second
   time; `validateScene` then rejected the entire scene, so a reconnecting peer could make a board
   unloadable. A data channel duplicates messages as a matter of course. Fixed by transporting
   object state (R4/D1) — replaying the same delta is now a no-op *by content*, because a
   retransmitted frame has been through `JSON.parse` and is a different instance holding the same
   state, which a reference check would miss.
2. **Remote batches were not atomic.** A batch whose third command failed still applied the first
   two, which is silent divergence. `applyRemote` now builds the whole batch against a working
   copy and refuses it whole, rolling back.
3. **The echo guard suppressed local undo.** `shouldBroadcast` originally allowed only
   `origin === 'local'`, which would have stopped an undo from ever reaching the room. Undo and
   redo are local edits; the only origin that must not be broadcast is `remote`. What stops an
   undo from eating a peer's work is that remote commands never enter the local history.
4. **The camera travelled with the document.** One participant panning dragged every other
   participant's screen, and a baseline recorded whoever's camera was current. `Scene` is now v2
   with the camera owned by the editor, and a registered v1 → v2 migration drops the field.
5. **Read-only existed only as wishful thinking.** The editor now aborts an in-flight gesture when
   permission is revoked and closes every mutating entry point — not just the pointer, but
   `deleteSelection`, `duplicateSelection`, `paste`, `setStyle`, `bringToFront`, `sendToBack` and
   `clearAll`. The audience path (`createSceneViewer`) has no input handlers at all, so there is
   nothing to disable and nothing a later change can forget to disable.

The demo build is code-split into two pages, so the honest number is per page (gzipped, measured
with `gzip -c`):

| Page | JS | CSS | Total gzipped |
| --- | --- | --- | --- |
| `dist/index.html` — the editor | `main` 77 024 B → 23 663 B, `renderer` 216 897 B → 65 103 B | 577 B → 368 B | **89.1 kB** |
| `dist/viewer.html` — read-only | `viewer` 1 358 B → 729 B, `renderer` 216 897 B → 65 103 B | 577 B → 368 B | **66.2 kB** |

The editor page grew from 82.8 kB gzipped (v0.1) to 89.1 kB: object-state records, the read-only
gating and viewer, and the `@coslate/ui` package, whose stylesheet is injected from JavaScript
rather than emitted as a separate asset (which gzips slightly worse than a standalone CSS file, and
is the price of a host needing no CSS pipeline). The read-only page is 23 kB *lighter* than the
editor — that is the chrome, and an audience does not download it.

**What the e2e suite proves for these requirements** (real Chromium, real input events):

| Check | Assertion |
| --- | --- |
| `h` | a saved document is version 2 and carries **no** `viewport` field |
| `u` | read-only: a stroke interrupted by a permission change never lands; the tool resets to Select; `setStyle` / `deleteSelection` / `duplicateSelection` / `clearAll` all refuse; remote records are still accepted; zoom **and drag-to-pan** still work |
| `v` | five replays of the same delta leave one order entry and no history; the document still round-trips through save/load; a remote update never makes `canUndo` true; garbage deltas change nothing |
| `w` | `getSummary()` tracks the document and its byte count equals the real *compact* serialized size; `clearAll()` wipes the board and one undo restores all of it; the chrome publishes `--coslate-z-chrome` / `--coslate-z-tooltip`; `setChromeVisible(false)` removes the toolbar **and** the status bar, leaves no focusable control, and hands the reclaimed height (130px at 1280×820) to the canvas |
| `x` | the viewer page renders a stream, ignores a replay, mounts no editor and exposes no editable control |

---

## 2. Re-verification — 2026-09-14 (i18n era, superseded)

> Historical: this run predates v0.2 below. It recorded 97 unit tests and 20 e2e assertions; the
> v0.2 run has 128 and 24. Kept because it is the evidence for the icon toolbar, the narrow-viewport
> work and the locale mechanism.

Re-run end to end from a clean working tree (`git status` empty) to confirm the published
verification still holds. Everything below was executed again; **all of it passed**.

| Step | Result |
| --- | --- |
| `pnpm install` | up to date, 48 packages, lockfile passes supply-chain policy (95 entries) |
| `pnpm typecheck` | PASS — `tsc -b`, 4 projects, zero errors |
| `pnpm test` | PASS — **97/97 in 6 files**, 25 of them locale |
| `pnpm build` | PASS — `index.html` 1.16 kB (gzip 0.64), `index-9GoFN6-L.css` 5.26 kB (gzip 1.66), `index-DxVYCmg2.js` 273.02 kB (**gzip 82.82 kB**) |
| `pnpm e2e` | PASS — **20/20 assertions**, zero page errors |

Deltas from the original staging run are noise, not regressions: the exported PNG is 102 963
bytes (staging recorded 105 321), the saved JSON is 2473 bytes (was 2476), and the transformer
resize measured 217.917×148.958 (was 217.9×149.0). The bundle grew from the staging
`index-VUK4OKk7.js` 76.26 kB gzip to 82.82 kB gzip: ~1.5 kB for the icon toolbar and its tooltip
layer, ~1 kB for the narrow-viewport rules, and ~4 kB for locale support — the `createI18n` core,
four catalogs and the language switcher (§ "Icon toolbar", § "Narrow viewports" and § "Locale"
below). `pnpm dev` and `scripts/rename.sh` were **not** re-run in this pass.

### Two harness defects found and fixed

The suite passed, but it passed *for reasons that would not survive a different machine or a
stale build*. Both are fixed in `tests/e2e/whiteboard.spec.mjs`:

1. **The browser toolchain was pinned to one host.** The spec hardcoded
   `/root/.nvm/versions/node/v24.14.1/lib/node_modules/playwright/index.mjs` and
   `/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`; anywhere else it died at
   import with an opaque `MODULE_NOT_FOUND`. It now resolves Playwright from
   `COSLATE_PLAYWRIGHT`, then the local tree, then the `npm root -g` / nvm global prefixes, and
   resolves Chromium from `COSLATE_CHROMIUM`, then `chromium.executablePath()`, then a scan of
   the browser cache. `TMPDIR=/dev/shm` is now applied only where `/dev/shm` exists. A bogus
   explicit override fails immediately with the path it could not find, instead of silently
   falling through to a different install.

   Verified: with no environment overrides the suite resolved
   `/root/.nvm/versions/node/v24.14.1/lib/node_modules/playwright/index.mjs` and
   `/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` on its own;
   `COSLATE_PLAYWRIGHT=/nope/index.mjs` exits at once with
   `COSLATE_PLAYWRIGHT points at /nope/index.mjs, which does not exist.`

2. **`pnpm e2e` tested whatever `dist` happened to be on disk.** It served
   `apps/demo/dist` without building it, so a green run could describe code that had already
   been changed. The script is now `pnpm build && node tests/e2e/whiteboard.spec.mjs`; a missing
   `dist` is a hard error naming the fix, and a `dist` older than `packages/*/src` or
   `apps/demo/src` prints a loud stale-build banner and records `staleDist: true` in
   `.artifacts/e2e-report.json`.

   Verified: after `touch packages/core/src/store.ts`, a direct
   `node tests/e2e/whiteboard.spec.mjs` printed
   `!! apps/demo/dist is older than the sources — this run tests the previous build.` and a full
   `pnpm e2e` immediately afterwards printed no such warning.

The report JSON now also records `playwrightEntry`, `chromiumExecutable` and `staleDist`, so an
archived run says which browser and which bundle produced it.

### Icon toolbar (demo chrome)

The demo toolbar was text buttons in four rows. It is now a tldraw-shaped icon toolbar: grouped,
icon-only controls with the text hint on hover, which is also where the keyboard binding is
stated.

- `apps/demo/src/icons.ts` — 21 hand-written 24×24 stroke glyphs on `currentColor`, parsed to
  live SVG nodes with `DOMParser`. No icon font, no sprite sheet, no dependency.
- `apps/demo/src/tooltip.ts` — one fixed-position tooltip node shared by every control, showing
  a label plus a `<kbd>` shortcut badge. Native `title` was rejected: it cannot carry the
  shortcut badge and takes about a second to appear. The hint anchors to the bottom of the
  toolbar (not the button) so it never covers the style row underneath.
- `apps/demo/src/chrome.ts` + `style.css` — six labelled groups (`Tools`, `History`, `Zoom`,
  `Selection`, `File`, `Style`), each a rounded pill; `aria-pressed` still marks the active tool
  and the active stroke / fill / width. Every existing `data-testid` and all keyboard shortcuts
  are unchanged, so the rest of the suite exercises the same controls through the new chrome.

Verified by a new end-to-end assertion, **q**, in a real Chromium: all 21 icon-only controls
exist, each renders an `<svg>` with a non-empty `aria-label` and **no text content**, the zoom
control still reads as a percentage, and hovering `tool-arrow` shows a hint whose label is
exactly `Arrow` and whose badge is exactly `A`. Screenshot: `.artifacts/q-toolbar.png`; glyph
close-ups were captured separately at 3× device scale to judge the drawing itself.

### Narrow viewports

An icon toolbar has a failure mode that a labelled one does not: with labels, controls get
taller; with icons, a cluster that does not fit simply runs off the edge. Measuring the toolbar
at nine widths found two real defects:

1. **The style cluster was unreachable below ~440px.** It needed ~484px on one line and it did
   not wrap, so at 420px it ended at x=494 — past the viewport. Because `body { overflow:
   hidden }`, those colours and stroke widths could not be reached at all. Groups now carry
   `flex-wrap: wrap; max-width: 100%`, so a cluster that cannot fit wraps *inside its own pill*
   instead of crossing an edge.
2. **The status bar reflowed to a second row below ~950px** to fit the debug hint. The hint now
   has `flex-basis: 0` — flexbox breaks lines on the *base* size, so a content-sized hint is
   pushed to its own row rather than shortened — and ellipsizes instead. Below 560px it is
   hidden outright.

Below 560px the pills also stop paying for themselves (a border and padding each, and an atomic
pill that misses the next row leaves it half empty), so they drop to a dense wrapped flow with
whitespace between clusters; below 400px controls tighten to 28px so the eight-tool cluster and
undo/redo share one line. Nothing is ever hidden — all 21 controls keep their `data-testid` and
stay clickable at every width.

Measured on the running demo (`.artifacts/narrow-check.mjs`), after the fixes:

| viewport | toolbar rows | toolbar height | canvas height | mode |
| --- | --- | --- | --- | --- |
| 1280 / 1024px | 2 | 100px | 693px | grouped pills |
| 900px | 3 | 146px | 647px | grouped pills |
| 768 / 640px | 3 | 146px | 647px | grouped pills |
| 520px | 4 | 151px | 642px | dense |
| 420px | 4 | 187px | 606px | dense |
| 360px | 5 | 175px | 600px | dense, compact controls |
| 320px | 5 | 200px | 575px | dense, compact controls |

Horizontal page overflow is 0 at every width, no group is clipped, the status bar never
overflows, and every hover hint stays inside the viewport (checked down to 320px).

Verified by a new end-to-end assertion, **r**: at 1024, 768, 560, 480, 420, 360 and 320px it
asserts that the page does not scroll horizontally, that all seven groups survive, that **every**
`#toolbar button[data-testid], #toolbar select[data-testid]` is non-collapsed and fully inside the
viewport, that the status bar does not overflow, and that the toolbar never leaves the canvas less
than 300px tall. It reported canvas heights `1024:693 768:647 560:678 480:606 420:606 360:600
320:575`.

### Locale (i18n)

`@coslate/core` gained `i18n.ts`: typed catalogs, BCP 47 canonicalization, RFC 4647 lookup, CLDR
plural selection, `Intl` number/list formatting and text direction. It contains no user-visible
string and touches no DOM, so the same catalog can drive a canvas, an HTML chrome or a
server-rendered thumbnail — and core still depends on nothing but the language built-ins.

The demo ships `en`, `zh-CN`, `zh-Hant` and `ar`, and a language menu in the toolbar. Detection is
`?lang=` → remembered choice → `navigator.languages` → `en`; a switch writes `<html lang>`,
`<html dir>`, `document.title` and the meta description, persists under `coslate:locale:v1` and
rewrites the URL.

**Chinese is two locales, and the resolution is standards-based.** `zh` maximizes to `zh-Hans-CN`
and resolves to `zh-CN`; `zh-TW` and `zh-HK` maximize to `zh-Hant-…` and resolve to `zh-Hant`.
That comes from `Intl.Locale.prototype.maximize()` (CLDR likely subtags), not from an alias table,
and the best-fit step compares shared leading subtags of the *maximized* forms — so `zh` prefers
`zh-CN` over `zh-Hant` regardless of the order the catalogs are declared in.

**The runtime no longer ships copy.** `@coslate/konva` hardcoded the text tool's placeholder as
`'Type…'`. That is a localization bug wearing a default, and no host could fix it without patching
the package; it is now `EditorOptions.textPlaceholder`, accepting a string or a function read when
the editor opens, and the demo passes `() => i18n.t('text.placeholder')`.

**25 unit tests** (`tests/unit/i18n.test.ts`, taking the suite from 72 to 97) cover canonicalization,
lookup and truncation, likely-subtag resolution (`zh` vs `zh-TW` vs `zh-HK`, in either declaration
order), priority order, the unknown-tag fallback, direction including script overrides (`ku-Latn`
is LTR, `ku-Arab` is not), interpolation, locale-formatted numbers, plural categories in English /
Chinese / Arabic, per-key fallback, the missing-key contract, and switching with subscribers. Two
real bugs were found by writing them:

1. **Truncation never fed the extension pass**, so `zh-Hant-TW` matched nothing and fell back to
   English even though `zh-CN` was available.
2. **A later exact match beat an earlier preference**: for `['zh-TW', 'ar']` the lookup returned
   `ar`, because the truncation chain of `zh-TW` was abandoned before `zh` was allowed to extend
   to `zh-CN`. A requested tag is now exhausted before the next one is considered.

Both were caught by unit tests, not by the browser — which is the point of testing the model
hard and the product in a browser.

Verified by a new end-to-end assertion, **s**, in a real Chromium: the default locale resolves to
`en`; selecting `zh-CN` sets `<html lang="zh-CN">`, translates the tool `aria-label` (`画笔 (P)`),
the group label, the status label and the hover hint (`矩形` + `R`), translates `document.title`,
keeps the shortcut badge untranslated, and puts `lang=zh-CN` in the URL; selecting `ar` sets
`dir="rtl"` and **mirrors the layout** — the first tool group moves into the right half of the
viewport and the language menu into the left half; a full reload restores `ar` and RTL from
storage; switching back to `en` restores LTR; and a final sweep of every `aria-label` and status
string asserts none of them is still equal to its own message key (the "untranslated leak" check).
Screenshot: `.artifacts/s-rtl.png`.

A second assertion, **t**, covers resolution and the runtime copy: loading `?lang=zh` resolves to
`zh-CN` and loading `?lang=zh-TW` resolves to `zh-Hant` (asserting the title is `CoSlate — 示範白板`,
the meta description follows, the menu lists the `繁體中文` endonym, and the URL *keeps* the
requested `zh-TW` — the URL records the preference, the app renders the resolution); and opening
the text tool reads the placeholder out of the live `<textarea>` and requires `輸入文字…`, proving
the localized copy reaches the runtime rather than sitting in a constant. Screenshot:
`.artifacts/t-zh-hant.png`.

## 3. Original staging record — the v0.1 run (superseded)

> The first verification run, kept as history: 72 unit tests and 16 e2e assertions against
> the code as it stood at 0.1.0. Superseded by §1 in every respect.
>
> The sections below are the *first* verification run, kept as history: they record 72 unit
> tests and 16 e2e assertions against the code as it stood then. The current numbers are in §0.
> Where they disagree, §0 wins.

### 3.1 `pnpm install`

```
devDependencies:
+ @coslate/core link:packages/core
+ @coslate/konva link:packages/konva
+ @types/node 22.20.2
+ typescript 5.9.3
+ vite 5.4.21
+ vitest 2.1.9
Done in 1.4s
```

Package runtime dependencies:

| Package | Runtime deps | Peer deps | Dev deps |
| --- | --- | --- | --- |
| `@coslate/core` | **none** | none | none |
| `@coslate/konva` | `konva@^9.3.16` | `@coslate/core@^1.0.0` | `@coslate/core` (workspace) |
| `@coslate/demo` (private) | `@coslate/core`, `@coslate/konva`, `konva` | — | — |

Root devDependencies: `typescript`, `vite`, `vitest`, `@types/node`, plus the two workspace
packages linked for the root-level test project. Total installed packages: 48.

### 3.2 `pnpm typecheck` — PASS

`tsc -b` over four TypeScript projects (`packages/core`, `packages/konva`, `apps/demo`,
`tsconfig.tests.json`) with `strict: true`, `noImplicitAny`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitOverride`, `noImplicitReturns`, `verbatimModuleSyntax`.
Zero errors. No `any` anywhere in `packages/*/src` or `apps/demo/src`
(`grep -rn ": any\|<any>\|as any\|any\[\]"` → no matches).

### 3.3 `pnpm test` — PASS, 72 tests in 5 files

Required coverage, and where it lives:

| Requirement | Test |
| --- | --- |
| JSON-patch apply + inverse round-trip | `jsonpatch.test.ts` → 9 tests, incl. *restores the original document exactly*, *inverts an append with a concrete index* |
| transaction → single undo step | `store.test.ts` → *groups many commands into a single undo step* |
| undo/redo ordering | `store.test.ts` → *walks back and forward through the exact sequence of edits*, *drops the redo branch when a new edit lands after an undo* |
| history bound | `store.test.ts` → *keeps at most `limit` undo steps and drops the oldest*, *defaults to 200* |
| viewport world↔screen round-trip + zoom-at-point invariance | `viewport.test.ts` → *round-trips points exactly*, *keeps the world point under the cursor pinned (zoom-at-point invariance)* |
| serialize→deserialize equality | `serialize.test.ts` → *deserialize(serialize(scene)) deep-equals the original* |
| unknown future version error | `serialize.test.ts` → *throws FUTURE_VERSION on a document from a newer build* |

Two real bugs were found by these tests during development and fixed:

1. `invertPatch` inverted `add` at an array index to `replace`, which duplicated ids on undo.
   Array inserts must invert to removals.
2. The demo's text tool could not open its editor at all: Chromium's `mousedown` default action
   blurred the freshly focused `<textarea>`, which committed an empty string and tore the
   overlay down. Fixed by suppressing the default on the canvas host.

### 3.4 `pnpm build` — PASS

```
dist/index.html                   1.16 kB │ gzip:  0.64 kB
dist/assets/index-Kr5Q0b2f.css    2.17 kB │ gzip:  0.97 kB
dist/assets/index-VUK4OKk7.js   255.04 kB │ gzip: 76.26 kB
✓ built in 1.30s
```

`apps/demo/dist/index.html` exists (1167 bytes). The demo bundle resolves `@coslate/core` and
`@coslate/konva` through their built `dist` output, so the build exercises the real package
artifacts.

### 3.5 `pnpm e2e` — PASS, 16/16 assertions

Real Chromium, real input events, against `vite preview` on port 4321, with `TMPDIR=/dev/shm`.
Every assertion reads `window.__scene` (the live scene document), not DOM text.

| # | Assertion | Result |
| --- | --- | --- |
| a | pen drag → exactly 1 `freehand.stroke`, ≥ 5 points | PASS — 1 object, 15 points, bbox 100x80 |
| b | rect drag → 1 `shape.rect` matching the drag | PASS — 160x120 at (500, 200), within 2px of the drag |
| c | select + drag +100/+50 moves the rect | PASS — measured dx 100, dy 50 |
| d | `Ctrl+Z` restores, `Ctrl+Shift+Z` re-applies | PASS — undo → (500, 200), redo → (600, 250) |
| e | zoom raises `viewport.scale` **and** rendered scale | PASS — 1 → 1.2, rendered 1 → 1.2, node pixel width grew by the same factor; wheel → 5.065 |
| f | text tool → 1 `shape.text` with the typed content | PASS — `"Hello CoSlate"` at (526.874, 344.912), measured size > 0 |
| g | export PNG → download > 1000 bytes | PASS — `coslate.png`, 105 321 bytes, valid PNG signature |
| h | save JSON → ids/types match the live scene | PASS — 3 objects, 2476 bytes, order and types identical |
| i | one gesture = one undo step | PASS — history depth 4 → 5 for a whole stroke, one undo removed it |
| j | eraser → erase + single undo restores | PASS |
| k | no uncaught page errors | PASS |
| l | ellipse/line/arrow + style to selection and to the next object | PASS |
| m | duplicate + bring-to-front/send-to-back | PASS — copy offset +16, z renumbered |
| n | `Konva.Transformer` resize through a real drag | PASS — 160x120 → 217.9x149.0, scale baked to 1, anchor corner fixed |
| o | autosave survives a reload | PASS — 8 objects restored from `localStorage` |
| p | load JSON from a file replaces the scene | PASS — history reset |

### 3.6 `scripts/rename.sh`

Tested on a full copy of the tree (`.rename-test`, since removed):

```
$ bash scripts/rename.sh _testname
rename: changed 41 file(s), 136 substitution(s).
$ grep -ril coslate .rename-test        # → only scripts/rename.sh (excluded on purpose)
```

Then a second, npm-valid rename in a fresh copy, followed by a real install and test run:

```
$ bash scripts/rename.sh scenekit && pnpm install && pnpm typecheck && pnpm test
rename: changed 41 file(s), 136 substitution(s).
Done in 8.8s
$ tsc -b                                  # no output = clean
Test Files  5 passed (5)
     Tests  72 passed (72)
```

Refusals: missing argument → exit 2; `bad/name` → exit 2 ("must not contain a path separator");
already-current name → exit 2; dirty git tree → exit 2 unless `--force` (only checked when the
stage is itself a git root, so the script never reaches into a parent repository).
`node_modules`, `dist`, `.git`, `.pnpm-store`, `.artifacts` and `.tsbuild` are never touched, and
`scripts/rename.sh` deliberately skips itself so it stays re-runnable.

### 3.7 `pnpm dev`

```
Port 5173 is in use, trying another one...   (occupied by another project on this machine)
  VITE v5.4.21  ready in 209 ms
  ➜  Local:   http://localhost:5176/
```

Serves the demo (`<title>CoSlate — demo whiteboard</title>`) and resolves `@coslate/core` to
`packages/core/dist/index.js`.

---

### 3.8 Known limitations

- `viewport` is part of the document, so a camera change is a (transient, non-undoable) command.
  Remote peers would receive camera moves; there is no per-user camera yet.
- Rotation is supported on every object, but the transformer's scale-baking path only applies to
  box shapes and text; lines, arrows and strokes keep `scaleX`/`scaleY`.
- Text is measured with canvas metrics and does not reflow on resize — resizing text scales the
  font size instead of rewrapping.
- `parentId` (grouping) is reserved in the schema and is never set.
- Hit testing is bounding-box based for boxes and path-based for lines; there is no per-pixel
  hit testing and no `evenodd` fill-rule awareness.
- The e2e suite drives Chromium only; Firefox and WebKit are not covered.
- **Command labels are English sentences stored in the document.** `object.create`,
  `object.delete`, `Edit text` and friends are `Command.label` values, and the runtime cannot
  localize them without baking one language into a saved file. A host that renders an undo
  history should switch on `command.type` and translate that, treating `label` as provenance.
- **The demo catalogs are working demonstrations, not reviewed copy.** The Arabic and Traditional
  Chinese strings are correct to the best of the author's knowledge and are exactly the kind of
  patch this repo wants, but no native speaker has signed off on them.
- **RTL is verified for the chrome, not for canvas text.** `<html dir>` flips the toolbar, the
  style pill and the status line, and the text tool's `<textarea>` inherits it, but RTL text
  entry, shaping and caret behaviour on the canvas itself are untested.
- **Direction falls back to a script table on older engines.** `Intl.Locale.prototype.textInfo`
  is ES2024; where it is missing, a small table decides, so a language/script pair it does not
  know is assumed LTR.
- The toolbar's debug-hint text is hidden below 560px by design (it is a developer affordance),
  and the text tool's placeholder/accessible name are empty when a host supplies neither.
