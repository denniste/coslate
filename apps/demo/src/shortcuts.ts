import type { MessageParams } from '@coslate/core';
import type { ToolName, WhiteboardEditor } from '@coslate/konva';
import type { MessageKey } from './i18n/catalog-en.js';

/**
 * Keyboard shortcuts.
 *
 * Kept in the application, not in the editor: a host product will want to remap
 * everything, and a runtime that swallows keystrokes is a runtime you cannot
 * embed.
 *
 * Status text is reported as a *message key*, never as a finished string, so a
 * language switch re-renders what the last keystroke said.
 */

const TOOL_KEYS: Record<string, ToolName> = {
  v: 'select',
  p: 'pen',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  t: 'text',
};

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export interface ShortcutOptions {
  onSaveJson(): void;
  setStatus(key: MessageKey, params?: MessageParams): void;
}

export function installShortcuts(editor: WhiteboardEditor, options: ShortcutOptions): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) return;
    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (meta) {
      switch (key) {
        case 'z':
          event.preventDefault();
          if (event.shiftKey) {
            editor.redo();
            options.setStatus('status.redo');
          } else {
            editor.undo();
            options.setStatus('status.undo');
          }
          return;
        case 'y':
          event.preventDefault();
          editor.redo();
          options.setStatus('status.redo');
          return;
        case 'c':
          event.preventDefault();
          options.setStatus('status.copied', { count: editor.copySelection() });
          return;
        case 'v': {
          event.preventDefault();
          options.setStatus('status.pasted', { count: editor.paste().length });
          return;
        }
        case 'd':
          event.preventDefault();
          options.setStatus('status.duplicated', { count: editor.duplicateSelection().length });
          return;
        case 'a':
          event.preventDefault();
          editor.setSelection(editor.getScene().order);
          return;
        case '0':
          event.preventDefault();
          editor.setZoom(1);
          return;
        case 'f':
          if (event.shiftKey) {
            event.preventDefault();
            editor.zoomToFit();
          }
          return;
        case 's':
          // The browser's "save page" dialog is never what the user wants here.
          event.preventDefault();
          options.onSaveJson();
          return;
        default:
          return;
      }
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      editor.deleteSelection();
      return;
    }
    if (event.key === 'Escape') {
      editor.clearSelection();
      return;
    }
    if (event.shiftKey || event.altKey) return;
    const tool = TOOL_KEYS[key];
    if (tool) {
      event.preventDefault();
      editor.setTool(tool);
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
