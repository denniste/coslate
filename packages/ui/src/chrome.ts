import { STROKE_PALETTE, STROKE_WIDTHS, TOOL_NAMES, type ToolName } from '@coslate/konva';
import { icon, type IconName } from './icons.js';
import { ensureChromeStyles } from './styles.js';
import { applyTheme, clearTheme } from './theme.js';
import { createTooltipLayer } from './tooltip.js';
import type { Chrome, ChromeMessageKey, ChromeOptions, ChromeParams } from './types.js';

/**
 * The embeddable chrome: an icon toolbar with hover hints, and a status bar.
 *
 * tldraw-shaped on purpose — grouped, icon-only controls that read at a glance,
 * with the text hint on hover instead of a permanent label. The hint carries the
 * keyboard shortcut too, which is the only place the two bindings are stated
 * together.
 *
 * Everything visible here goes through the host's `i18n.t()`. Nothing is
 * pre-translated into component state — the status line keeps a *key plus
 * params* — so switching language re-renders the whole chrome, including the
 * last message it showed, without rebuilding a single control.
 *
 * The package ships no copy and no layout assumption: the host supplies the two
 * mount points, the chrome fills them, and the stylesheet is injected once
 * (`ensureChromeStyles`). Every colour and radius is a `--coslate-*` custom
 * property on the package root (`.coslate-ui`).
 *
 * Deliberately plain DOM. The point is to prove the runtime works in a browser,
 * not to be a UI framework — every control here is a thin call into
 * `WhiteboardEditor`, which is the API a real product would also use.
 */

const TOOL_META: Record<ToolName, { key: ChromeMessageKey; hint: string; icon: IconName }> = {
  select: { key: 'tool.select.label', hint: 'V', icon: 'select' },
  pen: { key: 'tool.pen.label', hint: 'P', icon: 'pen' },
  eraser: { key: 'tool.eraser.label', hint: 'E', icon: 'eraser' },
  rect: { key: 'tool.rect.label', hint: 'R', icon: 'rect' },
  ellipse: { key: 'tool.ellipse.label', hint: 'O', icon: 'ellipse' },
  line: { key: 'tool.line.label', hint: 'L', icon: 'line' },
  arrow: { key: 'tool.arrow.label', hint: 'A', icon: 'arrow' },
  text: { key: 'tool.text.label', hint: 'T', icon: 'text' },
};

const FILL_OPTIONS: { value: string | null; key: ChromeMessageKey }[] = [
  { value: null, key: 'style.fill.none' },
  { value: '#ffffff', key: 'style.fill.white' },
  { value: '#1c2129', key: 'style.fill.panel' },
];

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

/**
 * Counters are a label plus a number in the host locale, so they use `Intl`
 * directly rather than borrowing a formatter method from the translator: the
 * chrome's `ChromeI18n` contract exposes `locale`, which is all `Intl` needs.
 */
function formatNumber(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
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

export function createChrome<K extends string>(options: ChromeOptions<K>): Chrome<K> {
  const { toolbar, statusbar, editor, i18n, theme, statusHint } = options;

  // The stylesheet ships with the package and is injected once per document.
  ensureChromeStyles(toolbar.ownerDocument);

  // Two mount points, one chrome: both wear the package root class so the
  // scoped stylesheet (and the z-index band) reaches them and nothing else.
  toolbar.classList.add('coslate-ui', 'coslate-toolbar');
  statusbar.classList.add('coslate-ui', 'coslate-statusbar');
  applyTheme([toolbar, statusbar], theme);

  /**
   * The chrome's own keys, resolved through the host translator.
   *
   * `K` is the host's full key union (the package cannot name it), and the
   * chrome only ever asks for keys in {@link ChromeMessageKey} — which the
   * `ChromeI18n` contract requires a host catalog to cover — so the assertion
   * is a statement of that contract rather than a hole in the types.
   */
  const t = (key: ChromeMessageKey, params?: ChromeParams): string => i18n.t(key as K, params);
  const tooltip = createTooltipLayer(toolbar.ownerDocument.body);
  applyTheme([tooltip.node], theme);

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

  function group(labelKey: ChromeMessageKey, ...children: (Node | string)[]): HTMLElement {
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
        applyStatus('status.loaded', { file: file.name });
      } catch (error) {
        applyStatus('status.loadFailed', { error: error instanceof Error ? error.message : String(error) });
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
      // clearAll, not clear: clear() is the destructive reset kept for "open a different board"
      // — it bypasses the command pipeline, so it is neither undoable nor broadcast. A toolbar
      // button has to be an ordinary edit that peers receive (R7).
      onClick: () => editor.clearAll(),
    }),
    fileInput,
  );

  // --- language ------------------------------------------------------------
  // A native <select>, because a language menu is exactly what it is good at:
  // keyboard navigation, screen-reader support and mobile pickers for free.
  // The group exists only when there is something to choose: a host that ships
  // fewer than two languages gets no menu at all, not a visible, empty, dead
  // control (O2 in the bug log).
  const languageSelect =
    i18n.languages.length >= 2
      ? el('select', {
          class: 'language-select',
          'data-testid': 'locale-select',
        })
      : null;
  if (languageSelect) {
    for (const language of i18n.languages) {
      const option = el('option', { value: language.tag });
      option.textContent = language.label;
      languageSelect.append(option);
    }
    languageSelect.value = i18n.locale;
    languageSelect.addEventListener('change', () => {
      i18n.setLocale(languageSelect.value);
    });
  }
  const language = languageSelect
    ? (() => {
        const globe = el('span', { class: 'toolbar-glyph' });
        globe.append(icon('globe', 18));
        tooltip.bind(languageSelect, () => ({ label: t('language.label') }));
        return group('group.language', globe, languageSelect);
      })()
    : null;

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

  // The custom swatch: a button (testid, pressed state, tooltip) opening a
  // hidden native colour input. Only `change` is applied — the picker fires it
  // once when dismissed — so one pick is exactly one setStyle, i.e. one undo
  // step when it restyles a selection. Live `input` preview is deliberately
  // skipped to keep that invariant (see the changelog).
  const strokeCustomInput = el('input', { type: 'color', class: 'color-input', 'data-testid': 'stroke-custom-input' });
  strokeCustomInput.addEventListener('change', () => editor.setStyle({ stroke: strokeCustomInput.value }));
  const strokeCustom = el('button', {
    type: 'button',
    class: 'swatch swatch-custom swatch-custom-idle',
    'data-testid': 'stroke-custom',
    'aria-pressed': 'false',
  });
  strokeCustom.addEventListener('click', () => strokeCustomInput.click());
  tooltip.bind(strokeCustom, () => ({ label: t('style.strokeCustom') }));
  style.append(strokeCustom, strokeCustomInput);

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
  const fillCustomInput = el('input', { type: 'color', class: 'color-input', 'data-testid': 'fill-custom-input' });
  fillCustomInput.addEventListener('change', () => editor.setStyle({ fill: fillCustomInput.value }));
  const fillCustom = el('button', {
    type: 'button',
    class: 'swatch swatch-custom swatch-custom-idle',
    'data-testid': 'fill-custom',
    'aria-pressed': 'false',
  });
  fillCustom.addEventListener('click', () => fillCustomInput.click());
  tooltip.bind(fillCustom, () => ({ label: t('style.fillCustom') }));
  style.append(fillCustom, fillCustomInput);

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

  // The toolbar fills its container; the inner wrapper carries the padding so
  // the container-query width is the true available width (see styles.ts).
  const main = el('div', { class: 'toolbar-main' });
  main.append(tools, history, zoom, objectActions, io, ...(language ? [language] : []));
  const toolbarInner = el('div', { class: 'coslate-toolbar-inner' }, [main, style]);
  toolbar.append(toolbarInner);

  // --- status bar ----------------------------------------------------------
  interface StatusItem {
    root: HTMLElement;
    label: HTMLElement;
    value: HTMLElement;
  }

  const statusbarInner = el('div', { class: 'coslate-statusbar-inner' });

  function statusItem(): StatusItem {
    const label = el('span', { class: 'status-label' });
    const value = el('strong');
    const root = el('span', {}, [label, ' ', value]);
    statusbarInner.append(root);
    return { root, label, value };
  }

  const toolStatus = statusItem();
  const selectionStatus = statusItem();
  const objectStatus = statusItem();
  const zoomStatus = statusItem();
  const message = el('span', { class: 'status-message' });
  const hint = el('span', { class: 'status-hint' });
  // A code snippet, not prose: deliberately outside the catalog, so the host
  // passes it in (or not at all) rather than the package shipping English.
  if (statusHint !== undefined) hint.textContent = statusHint;
  statusbarInner.append(message, hint);
  statusbar.append(statusbarInner);

  let status: { key: K | ChromeMessageKey; params?: ChromeParams } = { key: 'status.newScene' };

  /** Shared by the host-facing `setStatus` and the chrome's own messages. */
  function applyStatus(key: K | ChromeMessageKey, params?: ChromeParams): void {
    status = { key, params };
    message.textContent = i18n.t(key as K, params);
  }

  function setPressed<T>(map: Map<T, HTMLButtonElement>, value: T): void {
    for (const [key, node] of map) node.setAttribute('aria-pressed', String(key === value));
  }

  /** Re-read every translated string. Cheap: text nodes only, no rebuilds. */
  function render(): void {
    const summary = editor.getSummary();
    const tool = editor.getToolName();

    for (const [name, node] of toolButtons) node.setAttribute('aria-pressed', String(name === tool));
    setPressed(strokeButtons, editor.style.stroke);
    setPressed(fillButtons, String(editor.style.fill));
    setPressed(widthButtons, editor.style.strokeWidth);

    // The custom pickers carry the pressed state for any value the fixed
    // options do not cover; the input opens at the current colour so picking
    // starts where the user already is. (Invalid values — a host may set any
    // CSS colour — are silently ignored by the input, never a throw.)
    const strokeCustomActive = !STROKE_PALETTE.includes(editor.style.stroke);
    strokeCustom.setAttribute('aria-pressed', String(strokeCustomActive));
    strokeCustom.classList.toggle('swatch-custom-idle', !strokeCustomActive);
    strokeCustom.style.background = strokeCustomActive ? editor.style.stroke : '';
    strokeCustomInput.value = editor.style.stroke;

    const currentFill = editor.style.fill;
    const fillCustomActive =
      typeof currentFill === 'string' && !FILL_OPTIONS.some((option) => option.value === currentFill);
    fillCustom.setAttribute('aria-pressed', String(fillCustomActive));
    fillCustom.classList.toggle('swatch-custom-idle', !fillCustomActive);
    fillCustom.style.background = fillCustomActive ? currentFill : '';
    fillCustomInput.value = typeof currentFill === 'string' ? currentFill : '#ffffff';

    undoButton.disabled = !summary.canUndo;
    redoButton.disabled = !summary.canRedo;
    const hasSelection = summary.selection > 0;
    for (const id of ['delete', 'duplicate', 'front', 'back'] as const) {
      const node = toolbar.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      if (node) node.disabled = !hasSelection;
    }

    for (const node of toolbar.querySelectorAll<HTMLElement>('[data-label-key]')) {
      node.setAttribute('aria-label', t(node.dataset.labelKey as ChromeMessageKey));
    }
    if (languageSelect) languageSelect.value = i18n.locale;

    toolStatus.label.textContent = t('status.tool');
    toolStatus.value.textContent = t(TOOL_META[tool].key);
    selectionStatus.label.textContent = t('status.selection');
    selectionStatus.value.textContent = formatNumber(i18n.locale, summary.selection);
    // The counters are a label plus a formatted number, not a sentence: splitting
    // a plural message around a bold value is how translations break.
    objectStatus.label.textContent = t('status.objects');
    objectStatus.value.textContent = formatNumber(i18n.locale, summary.objects);
    zoomStatus.label.textContent = t('status.zoom');
    const percent = formatNumber(i18n.locale, summary.zoom, { style: 'percent' });
    zoomStatus.value.textContent = percent;
    zoomLabel.textContent = percent;

    // The message is state, so it survives the switch in the new language.
    message.textContent = i18n.t(status.key as K, status.params);
  }

  function sync(): void {
    render();
  }

  const unsubscribers: (() => void)[] = [
    editor.on('tool', sync),
    editor.on('selection', sync),
    editor.on('style', sync),
    editor.on('change', sync),
    i18n.subscribe(() => {
      tooltip.refresh();
      render();
    }),
  ];

  // --- visibility (the mini state) -----------------------------------------
  let chromeVisible = options.chrome !== 'none';

  /**
   * Hide or show *all* chrome. The mount points collapse, so the host's layout
   * gives the canvas back everything the toolbar and status bar occupied; focus
   * is released from any control that just vanished, so Tab cannot land in a
   * hidden widget.
   */
  function setChromeVisible(visible: boolean): void {
    chromeVisible = visible;
    toolbar.hidden = !visible;
    statusbar.hidden = !visible;
    if (!visible) {
      tooltip.hide();
      const doc = toolbar.ownerDocument;
      const active = doc.activeElement;
      if (active instanceof HTMLElement && (toolbar.contains(active) || statusbar.contains(active))) active.blur();
    }
  }

  if (!chromeVisible) setChromeVisible(false);

  function destroy(): void {
    for (const unsubscribe of unsubscribers) unsubscribe();
    tooltip.destroy();
    toolbarInner.remove();
    statusbarInner.remove();
    toolbar.classList.remove('coslate-ui', 'coslate-toolbar');
    statusbar.classList.remove('coslate-ui', 'coslate-statusbar');
    toolbar.hidden = false;
    statusbar.hidden = false;
    chromeVisible = true;
    clearTheme([toolbar, statusbar, tooltip.node], theme);
  }

  render();

  return {
    sync,
    setStatus: applyStatus,
    setChromeVisible,
    isChromeVisible: () => chromeVisible,
    destroy,
  };
}
