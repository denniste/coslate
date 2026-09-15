import type { Catalog, Message } from '@coslate/core';

/**
 * The reference catalog.
 *
 * Every other locale is typed against these keys (`DemoCatalog`), so a missing
 * translation is a **compile error** rather than a silent English string in the
 * middle of a Chinese UI. Adding a message means adding it here first, and the
 * type checker then lists every catalog that still needs it.
 *
 * Conventions:
 * - keys are dotted and namespaced by the surface that owns them;
 * - `{name}` is a placeholder, `{count}` is always a number and gets formatted
 *   with the locale's `Intl.NumberFormat`;
 * - a value may be a plural map instead of a string, keyed by CLDR category.
 */
export const en = {
  'app.title': 'CoSlate — demo whiteboard',
  'app.description': 'CoSlate demo: an open interactive scene runtime — the whiteboard core, not the whole product.',

  // Toolbar groups — these are the `aria-label`s of the pills.
  'group.tools': 'Tools',
  'group.history': 'History',
  'group.zoom': 'Zoom',
  'group.selection': 'Selection',
  'group.file': 'File',
  'group.style': 'Style',
  'group.language': 'Language',
  'group.board': 'Board surface',
  'board.white': 'Whiteboard',
  'board.black': 'Blackboard',

  // Tools. The keyboard hint beside each label is a key, not a word, so it is
  // not translated (a remapped host would change it, not translate it).
  'tool.select.label': 'Select',
  'tool.pen.label': 'Pen',
  'tool.eraser.label': 'Eraser',
  'tool.rect.label': 'Rectangle',
  'tool.ellipse.label': 'Ellipse',
  'tool.line.label': 'Line',
  'tool.arrow.label': 'Arrow',
  'tool.text.label': 'Text',
  'text.placeholder': 'Type…',
  'text.ariaLabel': 'Edit text',

  'action.undo': 'Undo',
  'action.redo': 'Redo',
  'action.delete': 'Delete selection',
  'action.duplicate': 'Duplicate selection',
  'action.front': 'Bring to front',
  'action.back': 'Send to back',

  'zoom.out': 'Zoom out',
  'zoom.in': 'Zoom in',
  'zoom.fit': 'Zoom to fit',
  'zoom.reset': 'Reset zoom to 100%',

  'file.exportPng': 'Export PNG',
  'file.saveJson': 'Save scene as JSON',
  'file.loadJson': 'Load a scene from JSON',
  'file.saveBaseline': 'Save baseline',
  'file.loadBaseline': 'Load baseline',
  'file.clear': 'Clear the board',

  'style.stroke': 'Stroke {color}',
  'style.strokeCustom': 'Custom stroke colour',
  'style.width': '{width}px stroke',
  'style.lineSolid': 'Solid line',
  'style.lineDashed': 'Dashed line',
  'style.lineDashDot': 'Dash-dot line',
  'style.fill.none': 'No fill',
  'style.fill.white': 'White fill',
  'style.fill.panel': 'Panel fill',
  'style.fillCustom': 'Custom fill',

  // Status bar counters.
  'status.tool': 'tool',
  'status.selection': 'selection',
  'status.objects': 'objects',
  'status.zoom': 'zoom',

  // Status bar messages. Held as a key + params, never as a translated string,
  // so switching language re-renders the last message in the new language.
  'status.saved': 'saved',
  'status.newScene': 'new scene',
  'status.restored': { one: 'restored {count} object', other: 'restored {count} objects' },
  'status.cleared': 'cleared',
  'status.downloaded': 'downloaded {file}',
  'status.loaded': 'Loaded {file}',
  'status.loadFailed': 'Load failed: {error}',
  'status.baselineLoaded': 'Baseline loaded ({file})',
  'status.baselineEmpty': 'No baseline applied: {reason}',
  'status.restoreFailed': 'restore failed: {error}',
  'status.autosaveFailed': 'autosave failed: {error}',

  'status.undo': 'Undo',
  'status.redo': 'Redo',
  'status.copied': { one: 'Copied {count} object', other: 'Copied {count} objects' },
  'status.pasted': { one: 'Pasted {count} object', other: 'Pasted {count} objects' },
  'status.duplicated': { one: 'Duplicated {count} object', other: 'Duplicated {count} objects' },

  'language.label': 'Language',
} satisfies Catalog;

/** The message-key union every catalog must cover. */
export type MessageKey = keyof typeof en;

/** A complete catalog: all keys, no extras. */
export type DemoCatalog = Record<MessageKey, Message>;
