# Working in this repository

Instructions for anyone — human or AI agent — changing CoSlate.

**First, read `docs/INVARIANTS.md`.** It is the contract: the guarantees hosts depend on and the
rules that keep this project worth using. `docs/scope-and-origin.md` explains why it exists;
`ARCHITECTURE.md` explains how it is put together.

## The non-negotiables, in one screen

1. `@coslate/core` has **zero runtime dependencies** and never touches the DOM or BOM.
2. The only runtime dependency in the published packages is **`konva`** (MIT). Nothing
   non-open-source may ship, ever — that is why this project exists.
3. The renderer **never mutates the scene**; every mutation is a command.
4. The **camera is never in the serialized document**.
5. The wire format is **object state (upsert), never patches**; remote application is **idempotent
   and atomic**; nothing received from a peer is broadcast back or pushed onto the undo stack.
6. `transient` commands are never in history and never broadcast.
7. Undo/redo is derived from command inverses; one gesture is one undo step.
8. Serialization is `format` + `version` + a registered migration. A user-opened file fails loudly;
   a **cached baseline never fails** (`{status:'empty', reason}`).
9. Read-only is **structural**: the viewer has no input path at all; the editor refuses every
   mutating entry point.
10. The packages ship **no user-visible copy**; the host injects every string. A missing key returns
    the key itself so it is visible.
11. Mounting is **zero-config**: styles are injected once, theme and stacking order are
    `--coslate-*` custom properties.
12. No host-specific code in the packages. The demo is a reference host, not the product.

## Before you say a change is done

```bash
pnpm typecheck   # 5 strict TypeScript projects
pnpm test        # unit tests
pnpm e2e         # builds both demo pages, then drives real Chromium (page-level assertions)
```

A unit test alone is **not** evidence for a behavioural change: the e2e suite drives real input
events and asserts on real scene state. If you add behaviour, add a page-level assertion for it.

## When you must go further

- **Changing the document shape** (`Scene`, object types): increment `SCENE_VERSION`, register a
  migration with `registerMigration`, and prove the old document still opens. Never silently accept
  a document from a newer build.
- **Changing a host-facing API** (`createSceneViewer`, `WhiteboardEditor`, `SceneStore`, `serialize`,
  `@coslate/ui`, `createI18n`): bump the version and note it in `README.md`/`ARCHITECTURE.md`.
- **Adding a dependency**: check the licence rule first; a runtime dependency in `core` needs a
  decision recorded in `docs/INVARIANTS.md`.
- **Changing a rule**: edit `docs/INVARIANTS.md` in the same commit and explain why in the message.

## Things this project deliberately refuses

AI/MCP inside the runtime, collaboration/CRDT inside the core, formulas, pages, images, embeds,
React bindings, runtime schema libraries, runtime plugin loading, light themes as a runtime concern,
and being a product. See `ARCHITECTURE.md` §9 and `docs/scope-and-origin.md` for the reasoning.
If a request pulls toward one of these, the answer is a *host* or *separate package*, not a change
to the core.
