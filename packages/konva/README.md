# @coslate/konva

The Konva renderer, tools and editor shell of [CoSlate](https://github.com/denniste/coslate). It
renders a [`@coslate/core`](https://www.npmjs.com/package/@coslate/core) scene and **never owns the
document**: every mutation is a command, so undo, serialization and sharing keep working no matter
what the tools do.

- **`WhiteboardEditor`** — tools (select, pen, eraser, rect, ellipse, line, arrow, text), style,
  camera, dynamic read-only gating (`setReadOnly`, safe mid-stroke), undoable `clearAll()`,
  `getSummary()` for a host status line, PNG/JSON export.
- **`createSceneViewer`** — the read-only projection: a renderer and a store with **no input path
  at all**, fed by the same deltas an editor takes, so both converge on identical state.
- **The page is view configuration** — set the background colour and restyle or disable the grid at
  construction (`background`, `grid`) or at runtime (`setBackground`/`setGrid`); the PNG export
  paints the same page layer, so it always follows. View configuration never enters the document.

## Install

```bash
npm install @coslate/konva
# brings konva; the @coslate/core peer (^0.2.0) is installed automatically by npm 7+
```

## Use it

```ts
import { WhiteboardEditor } from '@coslate/konva';

const editor = new WhiteboardEditor({
  container: document.querySelector('#board')!,
  background: '#ffffff',        // view config: the host's page colour
  grid: { visible: false },     // view config: an ungridded surface
});
editor.setTool('pen');
editor.on('change', () => console.log(editor.getSummary()));
const png = editor.exportPNG(); // clean snapshot: no handles, no previews
```

A browser or bundler context is required — this package draws on a canvas. (Plain Node should use
`@coslate/core` directly; this package is proven in real Chromium by the repository's e2e suite.)

## License

MIT.
