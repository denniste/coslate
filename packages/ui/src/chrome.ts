import { BOARD_THEMES, FONT_FAMILIES, FONT_SIZES, STROKE_PALETTE, STROKE_STYLES, STROKE_WIDTHS, TOOL_NAMES, type BoardThemeName, type ToolName } from '@coslate/konva';
import { icon, type IconName } from './icons.js';
import { ensureChromeStyles } from './styles.js';
import { applyTheme, clearTheme } from './theme.js';
import { createTooltipLayer } from './tooltip.js';
import type { Chrome, ChromeMessageKey, ChromeOptions, ChromeParams, ChromeTheme } from './types.js';

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

const FILL_OPTIONS: { value: string | null; key: ChromeMessageKey; sample?: string }[] = [
  { value: null, key: 'style.fill.none' },
  { value: '#ffffff', key: 'style.fill.white' },
  // The panel/board colour as a fill: sampled in grey because the true colour
  // is the chrome's own background — an honest swatch would read as empty.
  { value: '#1c2129', key: 'style.fill.panel', sample: 'var(--coslate-muted)' },
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
  const { toolbar, statusbar, editor, i18n, theme, statusHint, onBoardThemeChange } = options;

  // The stylesheet ships with the package and is injected once per document.
  ensureChromeStyles(toolbar.ownerDocument);

  // Two mount points, one chrome: both wear the package root class so the
  // scoped stylesheet (and the z-index band) reaches them and nothing else.
  toolbar.classList.add('coslate-ui', 'coslate-toolbar');
  statusbar.classList.add('coslate-ui', 'coslate-statusbar');
  applyTheme([toolbar, statusbar], theme);

  // The board surface (white board / black board) is one switch with several
  // faces: the page background and grid (editor view config), the chrome's own
  // tokens, and the glyph frames whose greys are literal in the icon markup.
  // The attribute is the source of truth the stylesheet keys on; the public
  // colour tokens ride the inline `theme` mechanism, because a host may pin
  // its palette inline through the `theme` option and a stylesheet rule can
  // never beat an inline custom property. The black board needs no token
  // object of its own: the host's `theme` option IS the black-board baseline.
  const WHITE_BOARD_TOKENS: Partial<ChromeTheme> = {
    bg: '#f7f8fa',
    panel: '#eceff3',
    panelAlt: '#e2e7ec',
    border: '#cdd4dc',
    text: '#1d2733',
    muted: '#5c6875',
    accent: '#1c7ed6',
    accentSoft: 'rgba(28, 126, 214, 0.14)',
  };

  let boardTheme: BoardThemeName = options.boardTheme ?? 'black';
  const boardRoots = (): HTMLElement[] => [toolbar, statusbar, tooltip.node];
  function paintBoard(previous: BoardThemeName): void {
    const preset = BOARD_THEMES[boardTheme];
    editor.setBackground(preset.background);
    editor.setGrid(preset.grid);
    const roots = boardRoots();
    clearTheme(roots, previous === 'white' ? WHITE_BOARD_TOKENS : (theme ?? {}));
    applyTheme(roots, boardTheme === 'white' ? WHITE_BOARD_TOKENS : (theme ?? {}));
    for (const root of roots) root.dataset.board = boardTheme;
  }

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
  paintBoard('black');

  const toolButtons = new Map<ToolName, HTMLButtonElement>();
  const strokeButtons = new Map<string, HTMLButtonElement>();
  const fillButtons = new Map<string, HTMLButtonElement>();
  const widthButtons = new Map<number, HTMLButtonElement>();
  const lineStyleButtons = new Map<string, HTMLButtonElement>();
  const boardButtons = new Map<BoardThemeName, HTMLButtonElement>();

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

  // --- board surface (white board / black board) -------------------------------------------
  // Two radio-style buttons, like the tools: the glyph shows the board each
  // button paints, and exactly one stays pressed. The flip is view
  // configuration — the document, the undo stack and read-only state are all
  // untouched — but it is the deepest chrome gesture, retheming the page, the
  // grid, every token and the glyph frames in one attribute change.
  const BOARD_META: Record<BoardThemeName, { key: ChromeMessageKey; icon: IconName }> = {
    white: { key: 'board.white', icon: 'boardWhite' },
    black: { key: 'board.black', icon: 'boardBlack' },
  };
  const boardRow: (Node | string)[] = [];
  for (const name of Object.keys(BOARD_META) as BoardThemeName[]) {
    const meta = BOARD_META[name];
    const node = iconButton({
      testId: `board-${name}`,
      icon: meta.icon,
      label: () => t(meta.key),
      toggle: true,
      onClick: () => setBoardTheme(name),
    });
    boardButtons.set(name, node);
    boardRow.push(node);
  }
  const board = group('group.board', ...boardRow);

  function setBoardTheme(next: BoardThemeName): void {
    if (next === boardTheme) return;
    const previous = boardTheme;
    boardTheme = next;
    paintBoard(previous);
    onBoardThemeChange?.(next);
    render();
  }

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

  const baselineInput = el('input', { type: 'file', accept: '.json,application/json', 'data-testid': 'load-baseline-input' });
  baselineInput.style.display = 'none';
  baselineInput.addEventListener('change', () => {
    const file = baselineInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      // loadBaseline never throws (readBaseline semantics): an unreadable blob
      // comes back as { status: 'empty', reason } and the board stays as it was.
      const result = editor.loadBaseline(text);
      if (result.status === 'ok') applyStatus('status.baselineLoaded', { file: file.name });
      else applyStatus('status.baselineEmpty', { reason: result.reason });
      baselineInput.value = '';
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
      testId: 'save-baseline',
      icon: 'baseline',
      label: () => t('file.saveBaseline'),
      onClick: () => editor.downloadBaseline('coslate-baseline.json'),
    }),
    iconButton({
      testId: 'load-baseline',
      icon: 'upload',
      label: () => t('file.loadBaseline'),
      onClick: () => baselineInput.click(),
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
    baselineInput,
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
  strokeCustom.append(icon('strokeBox', 18));
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
    if (option.value !== null) swatch.style.background = option.sample ?? option.value;
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
  const fillBoxIcon = icon('fillBox', 18);
  const fillCustomCentre = fillBoxIcon.querySelector<SVGElement>('.fill-centre');
  fillCustom.append(fillBoxIcon);
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

  style.append(separator());
  const LINE_STYLE_META = {
    solid: { icon: 'lineSolid', key: 'style.lineSolid' },
    dashed: { icon: 'lineDashed', key: 'style.lineDashed' },
    dashDot: { icon: 'lineDashDot', key: 'style.lineDashDot' },
  } as const;
  for (const lineStyle of STROKE_STYLES) {
    const meta = LINE_STYLE_META[lineStyle];
    const node = el('button', {
      type: 'button',
      class: 'width-button',
      'data-testid': `linestyle-${lineStyle}`,
      'aria-pressed': 'false',
    });
    node.append(icon(meta.icon, 18));
    node.addEventListener('click', () => editor.setStyle({ strokeStyle: lineStyle }));
    tooltip.bind(node, () => ({ label: t(meta.key) }));
    lineStyleButtons.set(lineStyle, node);
    style.append(node);
  }

  // --- text typography -------------------------------------------------------
  // Two native selects, same rationale as the language menu: keyboard
  // navigation, screen-reader support and mobile pickers for free. One pick is
  // one setStyle — the preset for the next text, and a restyle of any selected
  // text objects, in one undo step. A value the host set outside the menu (any
  // CSS font stack / size) gets its own honest extra option, exactly like the
  // custom colour swatch — the menu always reflects the live style.
  const fontFamilySelect = el('select', { class: 'font-select font-family-select', 'data-testid': 'font-family-select' });
  fontFamilySelect.addEventListener('change', () => editor.setStyle({ fontFamily: fontFamilySelect.value }));
  tooltip.bind(fontFamilySelect, () => ({ label: t('style.fontFamily') }));
  style.append(separator(), fontFamilySelect);

  const fontSizeSelect = el('select', { class: 'font-select font-size-select', 'data-testid': 'font-size-select' });
  fontSizeSelect.addEventListener('change', () => editor.setStyle({ fontSize: Number(fontSizeSelect.value) }));
  tooltip.bind(fontSizeSelect, () => ({ label: t('style.fontSize') }));
  style.append(fontSizeSelect);

  /**
   * Rebuild both option lists against the live style. Runs on every render
   * (including locale switches, so the menu labels retranslate) and appends a
   * single "custom" option carrying the raw value when the live style is not in
   * the fixed menu — same contract as the custom swatch's pressed state.
   */
  function syncFontSelects(): void {
    fontFamilySelect.setAttribute('aria-label', t('style.fontFamily'));
    const family = editor.style.fontFamily;
    fontFamilySelect.textContent = '';
    for (const option of FONT_FAMILIES) {
      const node = el('option', { value: option.value });
      node.textContent = t(option.labelKey);
      // The label previews in the stack it selects — the menu is its own sample.
      node.style.fontFamily = option.value;
      fontFamilySelect.append(node);
    }
    if (!FONT_FAMILIES.some((option) => option.value === family)) {
      const node = el('option', { value: family });
      node.textContent = family;
      fontFamilySelect.append(node);
    }
    fontFamilySelect.value = family;

    fontSizeSelect.setAttribute('aria-label', t('style.fontSize'));
    const size = editor.style.fontSize;
    fontSizeSelect.textContent = '';
    for (const option of FONT_SIZES) {
      const node = el('option', { value: String(option) });
      node.textContent = String(option);
      fontSizeSelect.append(node);
    }
    if (!FONT_SIZES.includes(size)) {
      const node = el('option', { value: String(size) });
      node.textContent = String(size);
      fontSizeSelect.append(node);
    }
    fontSizeSelect.value = String(size);
  }

  // The toolbar fills its container; the inner wrapper carries the padding so
  // the container-query width is the true available width (see styles.ts).
  const main = el('div', { class: 'toolbar-main' });
  main.append(tools, history, zoom, board, objectActions, io, ...(language ? [language] : []));
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
    setPressed(lineStyleButtons, editor.style.strokeStyle);
    setPressed(boardButtons, boardTheme);
    syncFontSelects();

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
    fillCustomInput.value = typeof currentFill === 'string' ? currentFill : '#ffffff';
    // The fill picker's sample lives in the glyph's solid centre, not the
    // swatch background: the centre previews the custom colour — what a pick
    // applies — and stays put (showing the picker's held colour) when a fixed
    // fill is active, so the colour always reads exactly once.
    if (fillCustomCentre) {
      fillCustomCentre.style.fill =
        fillCustomActive && typeof currentFill === 'string' ? currentFill : fillCustomInput.value;
    }

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
    for (const root of [toolbar, statusbar]) delete root.dataset.board;
    toolbar.hidden = false;
    statusbar.hidden = false;
    chromeVisible = true;
    clearTheme([toolbar, statusbar, tooltip.node], boardTheme === 'white' ? WHITE_BOARD_TOKENS : theme);
  }

  render();

  return {
    sync,
    setStatus: applyStatus,
    setChromeVisible,
    isChromeVisible: () => chromeVisible,
    getBoardTheme: () => boardTheme,
    setBoardTheme,
    destroy,
  };
}
