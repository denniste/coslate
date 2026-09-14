import './style.css';
import { serialize } from '@coslate/core';
import { WhiteboardEditor } from '@coslate/konva';
import { createChrome } from './chrome.js';
import { installTestHook } from './hooks.js';
import { installShortcuts } from './shortcuts.js';

/**
 * Demo application shell.
 *
 * Everything whiteboard-shaped lives in `@coslate/konva`; this file only wires
 * the chrome, autosave and keyboard shortcuts. If you are embedding CoSlate in
 * your own product, this is the file to read first — it is the smallest complete
 * integration.
 */

const STORAGE_KEY = 'coslate:scene:v1';
const AUTOSAVE_DELAY_MS = 250;

const toolbar = document.getElementById('toolbar');
const canvasHost = document.getElementById('canvas-host');
const statusbar = document.getElementById('statusbar');

if (!toolbar || !canvasHost || !statusbar) {
  throw new Error('CoSlate demo: expected #toolbar, #canvas-host and #statusbar in the document');
}

const editor = new WhiteboardEditor({
  container: canvasHost,
  background: '#14161a',
});

const chrome = createChrome(toolbar, statusbar, editor);

// ------------------------------------------------------------------ autosave

let autosaveTimer: number | null = null;

function saveNow(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(editor.getScene()));
    chrome.setStatus('saved');
  } catch (error) {
    chrome.setStatus(`autosave failed: ${error instanceof Error ? error.message : String(error)}`);
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
    chrome.setStatus('new scene');
    return;
  }
  try {
    const scene = editor.loadJSON(raw);
    chrome.setStatus(`restored ${scene.order.length} object(s)`);
  } catch (error) {
    // A corrupt autosave must never block the editor from opening.
    chrome.setStatus(`restore failed: ${error instanceof Error ? error.message : String(error)}`);
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
    chrome.setStatus('downloaded coslate.scene.json');
  },
  onStatus: (text) => chrome.setStatus(text),
});

// "Clear" also has to reset the autosave, or the next reload resurrects the scene.
toolbar.querySelector('[data-testid="clear"]')?.addEventListener('click', () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  chrome.setStatus('cleared');
});

// ------------------------------------------------------------- test/debug hook

installTestHook(editor);

// Expose the editor for hosts that want to script it from the console.
declare global {
  interface Window {
    coslateDemo?: { editor: WhiteboardEditor; saveNow: () => void };
  }
}
window.coslateDemo = { editor, saveNow };
