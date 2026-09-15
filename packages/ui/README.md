# @coslate/ui

Embeddable chrome — toolbar, style controls, zoom, language menu, status bar — for the
[CoSlate](https://github.com/denniste/coslate) editor. It ships its **own stylesheet** (a host needs
no CSS pipeline and never needs to know a class name) and it ships **no copy**: every label, hint
and status message comes from the host's translator.

- **`createChrome({ toolbar, statusbar, editor, i18n, theme? })`** — mount the whole chrome by
  handing over two elements and a translator.
- **`chrome: 'none'` / `setChromeVisible(false)`** — the mini state: the canvas fills the layout
  and no focusable chrome control remains.
- **Theme = `--coslate-*` custom properties** — colours, radius, and the published stacking
  contract (`--coslate-z-chrome`, `--coslate-z-tooltip`) so host panels can sit above the chrome.
  Override any subset per instance via the `theme` option.
- **`ChromeMessageKey`** — the exact set of strings the chrome asks for, declared as a type the
  host can enumerate; a missing key renders as the key itself, never blank.

## Install

```bash
npm install @coslate/ui
# peers: @coslate/konva ^0.2.0 and, through it, @coslate/core ^0.2.0
```

## Use it

```ts
import { createChrome } from '@coslate/ui';

const chrome = createChrome({
  toolbar: document.querySelector('#toolbar')!,
  statusbar: document.querySelector('#statusbar')!,
  editor,
  i18n,                          // your translator (createI18n, or a wrapper with the same shape)
  theme: { accent: '#4dabf7' },  // any subset of --coslate-*
});
chrome.setStatus('status.saved');
```

## License

MIT.
