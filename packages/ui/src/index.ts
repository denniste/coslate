/**
 * @coslate/ui — the embeddable chrome.
 *
 * A host hands the package two mount points, its editor and its translator; it
 * gets back an icon toolbar (tools, history, zoom, object actions, file, style,
 * language) and a status bar, themed with `--coslate-*` custom properties and
 * styled by a stylesheet the package injects itself. The package ships **no
 * copy**: every visible string is a key the host resolves.
 *
 *   const chrome = createChrome({ toolbar, statusbar, editor, i18n, theme });
 *   chrome.setChromeVisible(false);   // the mini state: canvas only
 */

export { createChrome } from './chrome.js';
export { ensureChromeStyles } from './styles.js';

export type { Chrome, ChromeI18n, ChromeMessageKey, ChromeOptions, ChromeParams, ChromeTheme } from './types.js';
