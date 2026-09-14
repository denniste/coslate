import type { ToolName, WhiteboardEditor } from '@coslate/konva';

/**
 * Keyboard shortcuts.
 *
 * Kept in the application, not in the editor: a host product will want to remap
 * everything, and a runtime that swallows keystrokes is a runtime you cannot
 * embed.
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
  onStatus(text: string): void;
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
            options.onStatus('Redo');
          } else {
            editor.undo();
            options.onStatus('Undo');
          }
          return;
        case 'y':
          event.preventDefault();
          editor.redo();
          return;
        case 'c':
          event.preventDefault();
          options.onStatus(`Copied ${editor.copySelection()} object(s)`);
          return;
        case 'v':
          event.preventDefault();
          options.onStatus(`Pasted ${editor.paste().length} object(s)`);
          return;
        case 'd':
          event.preventDefault();
          options.onStatus(`Duplicated ${editor.duplicateSelection().length} object(s)`);
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
