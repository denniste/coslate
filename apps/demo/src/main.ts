import './app.css';
import { serialize, type MessageParams, type Viewport } from '@coslate/core';
import { WhiteboardEditor } from '@coslate/konva';
import { createChrome, type ChromeTheme } from '@coslate/ui';
import { installTestHook } from './hooks.js';
import { installI18n } from './i18n/index.js';
import type { MessageKey } from './i18n/catalog-en.js';
import { installShortcuts } from './shortcuts.js';

/**
 * Demo application shell.
 *
 * Everything whiteboard-shaped lives in `@coslate/konva` and everything
 * chrome-shaped lives in `@coslate/ui`; this file only wires the two, plus
 * autosave, locale and keyboard shortcuts. If you are embedding CoSlate in your
 * own product, this is the file to read first — it is the smallest complete
 * integration.
 */

const STORAGE_KEY = 'coslate:scene:v1';
// The camera is per-user view state and deliberately not part of the document
// (a saved scene has no `viewport` field), so it is persisted under its own key.
const CAMERA_KEY = 'coslate:camera:v1';
const AUTOSAVE_DELAY_MS = 250;

/**
 * The demo palette, handed to the chrome as `--coslate-*` custom properties.
 * A host that wants different colours changes this object and nothing else.
 */
const THEME: Partial<ChromeTheme> = {
  bg: '#0f1115',
  panel: '#161a20',
  panelAlt: '#1c2129',
  border: '#262c36',
  text: '#e8eaed',
  muted: '#9aa4b2',
  accent: '#4dabf7',
  accentSoft: 'rgba(77, 171, 247, 0.16)',
  danger: '#ff6b6b',
  radius: '10px',
  zChrome: '30',
  zTooltip: '40',
};

/**
 * Developer affordance, not copy: a code sample showing the test hook. It stays
 * in the application (and out of the catalog) because it is not prose — which
 * is exactly why `createChrome` takes it as a host string.
 */
const DEBUG_HINT = 'window.__scene = { store, getScene, getSelection, setTool, … } — debug/test hook';

const toolbar = document.getElementById('toolbar');
const canvasHost = document.getElementById('canvas-host');
const statusbar = document.getElementById('statusbar');

if (!toolbar || !canvasHost || !statusbar) {
  throw new Error('CoSlate demo: expected #toolbar, #canvas-host and #statusbar in the document');
}

// Locale first: the chrome is built from translated labels, and this also sets
// `<html lang>`/`dir` before anything is measured or painted.
const i18n = installI18n();

const editor = new WhiteboardEditor({
  container: canvasHost,
  background: '#14161a',
  // The runtime ships no copy, so the text tool's copy comes from here — read
  // lazily, so it is already in the right language when the tool opens.
  textPlaceholder: () => i18n.t('text.placeholder'),
  textAriaLabel: () => i18n.t('text.ariaLabel'),
});

let chrome = createChrome({
  toolbar,
  statusbar,
  editor,
  i18n,
  theme: THEME,
  statusHint: DEBUG_HINT,
});

// ------------------------------------------------------------------ autosave

let autosaveTimer: number | null = null;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function saveNow(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(editor.getScene()));
    chrome.setStatus('status.saved');
  } catch (error) {
    chrome.setStatus('status.autosaveFailed', { error: describe(error) });
  }
}

function scheduleAutosave(): void {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    saveNow();
  }, AUTOSAVE_DELAY_MS);
}

// ------------------------------------------------------------------- camera
// Per-user view state, saved quietly (no status message) under its own key and
// restored with `setViewport`, so reloading reopens where you were looking.

let cameraTimer: number | null = null;

function saveCameraNow(): void {
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(editor.getViewport()));
  } catch {
    // Storage can be unavailable (private mode); the camera is not worth failing over.
  }
}

function scheduleCameraSave(): void {
  if (cameraTimer !== null) window.clearTimeout(cameraTimer);
  cameraTimer = window.setTimeout(() => {
    cameraTimer = null;
    saveCameraNow();
  }, AUTOSAVE_DELAY_MS);
}

function restoreCamera(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CAMERA_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as Partial<Viewport>;
    if (typeof saved.x === 'number' && typeof saved.y === 'number' && typeof saved.scale === 'number') {
      editor.setViewport({ x: saved.x, y: saved.y, scale: saved.scale });
    }
  } catch {
    // A corrupt camera must never block the editor from opening.
    try {
      localStorage.removeItem(CAMERA_KEY);
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------- restore

function restore(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    chrome.setStatus('status.newScene');
    return;
  }
  try {
    const scene = editor.loadJSON(raw);
    chrome.setStatus('status.restored', { count: scene.order.length });
  } catch (error) {
    // A corrupt autosave must never block the editor from opening.
    chrome.setStatus('status.restoreFailed', { error: describe(error) });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

restore();
restoreCamera();
editor.on('change', scheduleAutosave);
editor.on('viewport', scheduleCameraSave);

// ---------------------------------------------------------------- shortcuts

installShortcuts(editor, {
  onSaveJson: () => {
    editor.downloadJSON('coslate.scene.json');
    chrome.setStatus('status.downloaded', { file: 'coslate.scene.json' });
  },
  setStatus: (key, params) => chrome.setStatus(key, params),
});

// "Clear" also has to reset the autosave, or the next reload resurrects the scene.
toolbar.querySelector('[data-testid="clear"]')?.addEventListener('click', () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CAMERA_KEY);
  } catch {
    /* ignore */
  }
  chrome.setStatus('status.cleared');
});

// ------------------------------------------------------------- test/debug hook

installTestHook(editor);

// Expose the editor for hosts that want to script it from the console.
// `window.__i18n` is installed by `installI18n`.
declare global {
  interface Window {
    coslateDemo?: { editor: WhiteboardEditor; saveNow: () => void };
    /** Lets the e2e suite drive the mini state and the status line. */
    __chrome?: {
      setChromeVisible(visible: boolean): void;
      isChromeVisible(): boolean;
      setStatus(key: MessageKey, params?: MessageParams): void;
      /** Remount the chrome with the language table cut to `count` entries (O2). */
      setLanguageCount(count: number): void;
    };
  }
}
window.coslateDemo = { editor, saveNow };
window.__chrome = {
  setChromeVisible: (visible) => chrome.setChromeVisible(visible),
  isChromeVisible: () => chrome.isChromeVisible(),
  setStatus: (key, params) => chrome.setStatus(key, params),
  // The reference host ships four languages; a host that ships fewer must not
  // get a dead language control (O2). Destroying and re-creating the chrome is
  // exactly what a host changing its language table would do.
  setLanguageCount: (count) => {
    chrome.destroy();
    const languages = i18n.languages.slice(0, Math.max(0, count));
    chrome = createChrome({
      toolbar,
      statusbar,
      editor,
      i18n: { ...i18n, languages },
      theme: THEME,
      statusHint: DEBUG_HINT,
    });
    chrome.setStatus('status.newScene');
  },
};
