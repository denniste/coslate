import { STROKE_PALETTE, STROKE_WIDTHS, TOOL_NAMES, type ToolName, type WhiteboardEditor } from '@coslate/konva';
import type { MessageParams } from '@coslate/core';
import { icon, type IconName } from './icons.js';
import type { DemoI18n } from './i18n/index.js';
import type { MessageKey } from './i18n/catalog-en.js';
import { createTooltipLayer } from './tooltip.js';

/**
 * The demo chrome: an icon toolbar with hover hints, and a status bar.
 *
 * tldraw-shaped on purpose — grouped, icon-only controls that read at a glance,
 * with the text hint on hover instead of a permanent label. The hint carries the
 * keyboard shortcut too, which is the only place the two bindings are stated
 * together.
 *
 * Everything visible here goes through `i18n.t()`. Nothing is pre-translated into
 * component state — the status line keeps a *key plus params* — so switching
 * language re-renders the whole chrome, including the last message it showed,
 * without rebuilding a single control.
 *
 * Deliberately plain DOM. The point of the demo is to prove the runtime works in
 * a browser, not to be a UI framework — every control here is a thin call into
 * `WhiteboardEditor`, which is the API a real product would also use.
 */

const TOOL_META: Record<ToolName, { key: MessageKey; hint: string; icon: IconName }> = {
  select: { key: 'tool.select.label', hint: 'V', icon: 'select' },
  pen: { key: 'tool.pen.label', hint: 'P', icon: 'pen' },
  eraser: { key: 'tool.eraser.label', hint: 'E', icon: 'eraser' },
  rect: { key: 'tool.rect.label', hint: 'R', icon: 'rect' },
  ellipse: { key: 'tool.ellipse.label', hint: 'O', icon: 'ellipse' },
  line: { key: 'tool.line.label', hint: 'L', icon: 'line' },
  arrow: { key: 'tool.arrow.label', hint: 'A', icon: 'arrow' },
  text: { key: 'tool.text.label', hint: 'T', icon: 'text' },
};

const FILL_OPTIONS: { value: string | null; key: MessageKey }[] = [
  { value: null, key: 'style.fill.none' },
  { value: '#ffffff', key: 'style.fill.white' },
  { value: '#1c2129', key: 'style.fill.panel' },
];

export interface Chrome {
  sync(): void;
  /** Set the status message by *key*, so it re-renders on a locale change. */
  setStatus(key: MessageKey, params?: MessageParams): void;
}

export interface ChromeOptions {
  toolbar: HTMLElement;
  statusbar: HTMLElement;
  editor: WhiteboardEditor;
  i18n: DemoI18n;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

interface IconButtonOptions {
  testId: string;
  icon: IconName;
  /** Read lazily, so a locale change needs no re-binding. */
  label: () => string;
  hint?: string;
  /** Renders as a toggle and participates in `aria-pressed` sync. */
  toggle?: boolean;
  onClick: () => void;
}

export function createChrome(options: ChromeOptions): Chrome {
  const { toolbar, statusbar, editor, i18n } = options;
  const t = i18n.t;
  const tooltip = createTooltipLayer();
  const toolButtons = new Map<ToolName, HTMLButtonElement>();
  const strokeButtons = new Map<string, HTMLButtonElement>();
  const fillButtons = new Map<string, HTMLButtonElement>();
  const widthButtons = new Map<number, HTMLButtonElement>();

  function iconButton(button: IconButtonOptions): HTMLButtonElement {
    const node = el('button', { type: 'button', class: 'icon-button', 'data-testid': button.testId });
    node.append(icon(button.icon));
    if (button.toggle) node.setAttribute('aria-pressed', 'false');
    node.addEventListener('click', button.onClick);
    tooltip.bind(node, () => (button.hint ? { label: button.label(), hint: button.hint } : { label: button.label() }));
    return node;
  }

  function group(labelKey: MessageKey, ...children: (Node | string)[]): HTMLElement {
    const node = el('div', { class: 'toolbar-group', role: 'group' });
    node.dataset.labelKey = labelKey;
    node.setAttribute('aria-label', t(labelKey));
    node.append(...children);
    return node;
  }

  function separator(): HTMLElement {
    return el('span', { class: 'sep' });
  }

  // --- tools ---------------------------------------------------------------
  const toolButtonsRow: (Node | string)[] = [];
  for (const name of TOOL_NAMES) {
    const meta = TOOL_META[name];
    const node = iconButton({
      testId: `tool-${name}`,
      icon: meta.icon,
      label: () => t(meta.key),
      hint: meta.hint,
      toggle: true,
      onClick: () => editor.setTool(name),
    });
    toolButtons.set(name, node);
    toolButtonsRow.push(node);
  }
  const tools = group('group.tools', ...toolButtonsRow);

  // --- history -------------------------------------------------------------
  const undoButton = iconButton({
    testId: 'undo',
    icon: 'undo',
    label: () => t('action.undo'),
    hint: 'Ctrl+Z',
    onClick: () => editor.undo(),
  });
  const redoButton = iconButton({
    testId: 'redo',
    icon: 'redo',
    label: () => t('action.redo'),
    hint: 'Ctrl+Shift+Z',
    onClick: () => editor.redo(),
  });
  const history = group('group.history', undoButton, redoButton);

  // --- zoom ----------------------------------------------------------------
  const zoomOut = iconButton({
    testId: 'zoom-out',
    icon: 'zoomOut',
    label: () => t('zoom.out'),
    onClick: () => editor.zoomBy(1 / 1.2),
  });
  const zoomLabel = el('button', { type: 'button', class: 'zoom-label', 'data-testid': 'zoom-reset' });
  zoomLabel.addEventListener('click', () => editor.setZoom(1));
  tooltip.bind(zoomLabel, () => ({ label: t('zoom.reset'), hint: 'Ctrl+0' }));
  const zoomIn = iconButton({
    testId: 'zoom-in',
    icon: 'zoomIn',
    label: () => t('zoom.in'),
    onClick: () => editor.zoomBy(1.2),
  });
  const zoomFit = iconButton({
    testId: 'zoom-fit',
    icon: 'zoomFit',
    label: () => t('zoom.fit'),
    hint: 'Ctrl+Shift+F',
    onClick: () => editor.zoomToFit(),
  });
  const zoom = group('group.zoom', zoomOut, zoomLabel, zoomIn, zoomFit);

  // --- object actions ------------------------------------------------------
  const objectActions = group(
    'group.selection',
    iconButton({
      testId: 'delete',
      icon: 'trash',
      label: () => t('action.delete'),
      hint: 'Del',
      onClick: () => editor.deleteSelection(),
    }),
    iconButton({
      testId: 'duplicate',
      icon: 'duplicate',
      label: () => t('action.duplicate'),
      hint: 'Ctrl+D',
      onClick: () => editor.duplicateSelection(),
    }),
    iconButton({
      testId: 'front',
      icon: 'front',
      label: () => t('action.front'),
      onClick: () => editor.bringToFront(),
    }),
    iconButton({
      testId: 'back',
      icon: 'back',
      label: () => t('action.back'),
      onClick: () => editor.sendToBack(),
    }),
  );

  // --- io ------------------------------------------------------------------
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', 'data-testid': 'load-file' });
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        editor.loadJSON(text);
        setStatus('status.loaded', { file: file.name });
      } catch (error) {
        setStatus('status.loadFailed', { error: error instanceof Error ? error.message : String(error) });
      }
      fileInput.value = '';
    });
  });

  const io = group(
    'group.file',
    iconButton({
      testId: 'export-png',
      icon: 'image',
      label: () => t('file.exportPng'),
      onClick: () => editor.downloadPNG('coslate.png'),
    }),
    iconButton({
      testId: 'save-json',
      icon: 'download',
      label: () => t('file.saveJson'),
      hint: 'Ctrl+S',
      onClick: () => editor.downloadJSON('coslate.scene.json'),
    }),
    iconButton({
      testId: 'load-json',
      icon: 'upload',
      label: () => t('file.loadJson'),
      onClick: () => fileInput.click(),
    }),
    iconButton({
      testId: 'clear',
      icon: 'clearBoard',
      label: () => t('file.clear'),
      onClick: () => editor.clear(),
    }),
    fileInput,
  );

  // --- language ------------------------------------------------------------
  // A native <select>, because a language menu is exactly what it is good at:
  // keyboard navigation, screen-reader support and mobile pickers for free.
  const languageSelect = el('select', {
    class: 'language-select',
    'data-testid': 'locale-select',
  });
  for (const language of i18n.languages) {
    const option = el('option', { value: language.tag });
    option.textContent = language.label;
    languageSelect.append(option);
  }
  languageSelect.value = i18n.i18n.locale;
  languageSelect.addEventListener('change', () => {
    i18n.setLocale(languageSelect.value);
  });
  const globe = el('span', { class: 'toolbar-glyph' });
  globe.append(icon('globe', 18));
  const language = group('group.language', globe, languageSelect);
  tooltip.bind(languageSelect, () => ({ label: t('language.label') }));

  // --- style ---------------------------------------------------------------
  const style = el('div', { class: 'toolbar-group toolbar-style', role: 'group' });
  style.dataset.labelKey = 'group.style';
  style.setAttribute('aria-label', t('group.style'));
  for (const color of STROKE_PALETTE) {
    const swatch = el('button', {
      type: 'button',
      class: 'swatch',
      'data-testid': `stroke-${color.replace('#', '')}`,
      'aria-pressed': 'false',
    });
    swatch.style.background = color;
    swatch.addEventListener('click', () => editor.setStyle({ stroke: color }));
    tooltip.bind(swatch, () => ({ label: t('style.stroke', { color }) }));
    strokeButtons.set(color, swatch);
    style.append(swatch);
  }

  style.append(separator());
  for (const option of FILL_OPTIONS) {
    const testId = option.value === null ? 'fill-none' : `fill-${option.value.replace('#', '')}`;
    const swatch = el('button', {
      type: 'button',
      class: option.value === null ? 'swatch swatch-none' : 'swatch',
      'data-testid': testId,
      'aria-pressed': 'false',
    });
    if (option.value !== null) swatch.style.background = option.value;
    swatch.addEventListener('click', () => editor.setStyle({ fill: option.value }));
    tooltip.bind(swatch, () => ({ label: t(option.key) }));
    fillButtons.set(String(option.value), swatch);
    style.append(swatch);
  }

  style.append(separator());
  for (const width of STROKE_WIDTHS) {
    const node = el('button', {
      type: 'button',
      class: 'width-button',
      'data-testid': `width-${width}`,
      'aria-pressed': 'false',
    });
    const dot = el('span', { class: 'width-dot' });
    const size = Math.min(12, 3 + width);
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    node.append(dot);
    node.addEventListener('click', () => editor.setStyle({ strokeWidth: width }));
    tooltip.bind(node, () => ({ label: t('style.width', { width }) }));
    widthButtons.set(width, node);
    style.append(node);
  }

  const main = el('div', { class: 'toolbar-main' });
  main.append(tools, history, zoom, objectActions, io, language);
  toolbar.append(main, style);

  // --- status bar ----------------------------------------------------------
  interface StatusItem {
    root: HTMLElement;
    label: HTMLElement;
    value: HTMLElement;
  }

  function statusItem(): StatusItem {
    const label = el('span', { class: 'status-label' });
    const value = el('strong');
    const root = el('span', {}, [label, ' ', value]);
    statusbar.append(root);
    return { root, label, value };
  }

  const toolStatus = statusItem();
  const selectionStatus = statusItem();
  const objectStatus = statusItem();
  const zoomStatus = statusItem();
  const message = el('span', { class: 'status-message' });
  const hint = el('span', { class: 'status-hint' });
  // A code snippet, not prose: deliberately outside the catalog.
  hint.textContent = 'window.__scene = { store, getScene, getSelection, setTool, … } — debug/test hook';
  statusbar.append(message, hint);

  let status: { key: MessageKey; params?: MessageParams } = { key: 'status.newScene' };

  function setStatus(key: MessageKey, params?: MessageParams): void {
    status = { key, params };
    message.textContent = t(key, params);
  }

  function setPressed<T>(map: Map<T, HTMLButtonElement>, value: T): void {
    for (const [key, node] of map) node.setAttribute('aria-pressed', String(key === value));
  }

  /** Re-read every translated string. Cheap: text nodes only, no rebuilds. */
  function render(): void {
    const scene = editor.getScene();
    const selection = editor.getSelection();
    const tool = editor.getToolName();

    for (const [name, node] of toolButtons) node.setAttribute('aria-pressed', String(name === tool));
    setPressed(strokeButtons, editor.style.stroke);
    setPressed(fillButtons, String(editor.style.fill));
    setPressed(widthButtons, editor.style.strokeWidth);

    undoButton.disabled = !editor.canUndo();
    redoButton.disabled = !editor.canRedo();
    const hasSelection = selection.length > 0;
    for (const id of ['delete', 'duplicate', 'front', 'back'] as const) {
      const node = toolbar.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      if (node) node.disabled = !hasSelection;
    }

    for (const node of toolbar.querySelectorAll<HTMLElement>('[data-label-key]')) {
      node.setAttribute('aria-label', t(node.dataset.labelKey as MessageKey));
    }
    languageSelect.value = i18n.i18n.locale;

    toolStatus.label.textContent = t('status.tool');
    toolStatus.value.textContent = t(TOOL_META[tool].key);
    selectionStatus.label.textContent = t('status.selection');
    selectionStatus.value.textContent = i18n.i18n.formatNumber(selection.length);
    // The counters are a label plus a formatted number, not a sentence: splitting
    // a plural message around a bold value is how translations break.
    objectStatus.label.textContent = t('status.objects');
    objectStatus.value.textContent = i18n.i18n.formatNumber(scene.order.length);
    zoomStatus.label.textContent = t('status.zoom');
    const percent = i18n.i18n.formatNumber(scene.viewport.scale, { style: 'percent' });
    zoomStatus.value.textContent = percent;
    zoomLabel.textContent = percent;

    // The message is state, so it survives the switch in the new language.
    message.textContent = t(status.key, status.params);
  }

  function sync(): void {
    render();
  }

  editor.on('tool', sync);
  editor.on('selection', sync);
  editor.on('style', sync);
  editor.on('change', sync);
  i18n.i18n.subscribe(() => {
    tooltip.refresh();
    render();
  });
  render();

  return { sync, setStatus };
}
