import './style.css';
import { serialize } from '@coslate/core';
import { WhiteboardEditor } from '@coslate/konva';
import { createChrome } from './chrome.js';
import { installTestHook } from './hooks.js';
import { installI18n } from './i18n/index.js';
import { installShortcuts } from './shortcuts.js';

/**
 * Demo application shell.
 *
 * Everything whiteboard-shaped lives in `@coslate/konva`; this file only wires
 * the chrome, autosave, locale and keyboard shortcuts. If you are embedding
 * CoSlate in your own product, this is the file to read first — it is the
 * smallest complete integration.
 */

const STORAGE_KEY = 'coslate:scene:v1';
const AUTOSAVE_DELAY_MS = 250;

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

const chrome = createChrome({ toolbar, statusbar, editor, i18n });

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
editor.on('change', scheduleAutosave);

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
  }
}
window.coslateDemo = { editor, saveNow };
