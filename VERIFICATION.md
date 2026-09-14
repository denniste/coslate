# Verification record

Everything below was executed in this directory on the staging machine. Raw output for the
end-to-end run is in `.artifacts/e2e-report.json`; screenshots are in `.artifacts/`.

Environment: Node v24.14.1, pnpm 12.3.4, Chromium 1228 (preinstalled),
`http_proxy=http://127.0.0.1:7890`, `npm_config_cache=/root/CoStage/.tmp/npmcache`,
stage-local pnpm store at `.pnpm-store/`.

---

## 1. `pnpm install`

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

## 2. `pnpm typecheck` — PASS

`tsc -b` over four TypeScript projects (`packages/core`, `packages/konva`, `apps/demo`,
`tsconfig.tests.json`) with `strict: true`, `noImplicitAny`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitOverride`, `noImplicitReturns`, `verbatimModuleSyntax`.
Zero errors. No `any` anywhere in `packages/*/src` or `apps/demo/src`
(`grep -rn ": any\|<any>\|as any\|any\[\]"` → no matches).

## 3. `pnpm test` — PASS, 72 tests in 5 files

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

## 4. `pnpm build` — PASS

```
dist/index.html                   1.16 kB │ gzip:  0.64 kB
dist/assets/index-Kr5Q0b2f.css    2.17 kB │ gzip:  0.97 kB
dist/assets/index-VUK4OKk7.js   255.04 kB │ gzip: 76.26 kB
✓ built in 1.30s
```

`apps/demo/dist/index.html` exists (1167 bytes). The demo bundle resolves `@coslate/core` and
`@coslate/konva` through their built `dist` output, so the build exercises the real package
artifacts.

## 5. `pnpm e2e` — PASS, 16/16 assertions

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

## 6. `scripts/rename.sh`

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

## 7. `pnpm dev`

```
Port 5173 is in use, trying another one...   (occupied by another project on this machine)
  VITE v5.4.21  ready in 209 ms
  ➜  Local:   http://localhost:5176/
```

Serves the demo (`<title>CoSlate — demo whiteboard</title>`) and resolves `@coslate/core` to
`packages/core/dist/index.js`.

---

## Known limitations

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
