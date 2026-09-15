# CoSlate documentation

CoSlate is an open interactive scene runtime — the whiteboard core, not the whole product. It gives
you a document model, an invertible command protocol, undo/redo, camera math, serialization and a
Konva renderer, so your product can own everything else: chrome, auth, storage, business logic.

| Document | What it covers |
| --- | --- |
| [Getting started](./getting-started.md) | Installing the three packages, embedding the editor, the read-only viewer and the UI chrome, saving and loading documents |
| [The repository README](../README.md) | What CoSlate is, why it exists, the full feature tour, repository layout |
| [CHANGELOG](../CHANGELOG.md) | Version history and breaking changes |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | How the runtime is put together: packages, layers, the command pipeline |

The packages themselves:

| Package | Purpose |
| --- | --- |
| `@coslate/core` | Headless scene model, commands, records, undo, i18n, serialization. Zero runtime dependencies, no DOM. |
| `@coslate/konva` | Konva renderer, `WhiteboardEditor`, read-only `createSceneViewer`. |
| `@coslate/ui` | Optional embeddable chrome: toolbar, style row, zoom, status bar. A host with its own UI never imports it. |

License: MIT — see [LICENSE](../LICENSE).
