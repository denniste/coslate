import {
  STROKE_PALETTE,
  STROKE_WIDTHS,
  TOOL_NAMES,
  type ToolName,
  type WhiteboardEditor,
} from '@coslate/konva';

/**
 * The demo chrome: a toolbar and a status bar.
 *
 * Deliberately plain DOM. The point of the demo is to prove the runtime works in
 * a browser, not to be a UI framework — every control here is a thin call into
 * `WhiteboardEditor`, which is the API a real product would also use.
 */

const TOOL_LABELS: Record<ToolName, { label: string; title: string }> = {
  select: { label: 'Select', title: 'Select — click, shift-click, drag a marquee (V)' },
  pen: { label: 'Pen', title: 'Freehand pen (P)' },
  eraser: { label: 'Erase', title: 'Eraser — click or drag over objects (E)' },
  rect: { label: 'Rect', title: 'Rectangle (R)' },
  ellipse: { label: 'Ellipse', title: 'Ellipse (O)' },
  line: { label: 'Line', title: 'Line (L)' },
  arrow: { label: 'Arrow', title: 'Arrow (A)' },
  text: { label: 'Text', title: 'Text — click to place, Enter to commit (T)' },
};

const FILL_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'No fill' },
  { value: '#ffffff', label: 'White fill' },
  { value: '#1c2129', label: 'Panel fill' },
];

export interface Chrome {
  sync(): void;
  setStatus(text: string): void;
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

function button(label: string, title: string, testId: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', { type: 'button', title, 'data-testid': testId });
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function separator(): HTMLElement {
  return el('span', { class: 'sep' });
}

export function createChrome(toolbar: HTMLElement, statusbar: HTMLElement, editor: WhiteboardEditor): Chrome {
  const toolButtons = new Map<ToolName, HTMLButtonElement>();
  const strokeButtons = new Map<string, HTMLButtonElement>();
  const fillButtons = new Map<string, HTMLButtonElement>();
  const widthButtons = new Map<number, HTMLButtonElement>();

  // --- tools ---------------------------------------------------------------
  const toolRow = el('div', { class: 'toolbar-row' });
  for (const name of TOOL_NAMES) {
    const meta = TOOL_LABELS[name];
    const node = button(meta.label, meta.title, `tool-${name}`, () => editor.setTool(name));
    node.setAttribute('aria-pressed', 'false');
    toolButtons.set(name, node);
    toolRow.append(node);
  }

  // --- history -------------------------------------------------------------
  const undoButton = button('Undo', 'Undo (Ctrl+Z)', 'undo', () => editor.undo());
  const redoButton = button('Redo', 'Redo (Ctrl+Shift+Z / Ctrl+Y)', 'redo', () => editor.redo());
  toolRow.append(separator(), undoButton, redoButton);

  // --- zoom ----------------------------------------------------------------
  const zoomOut = button('−', 'Zoom out', 'zoom-out', () => editor.zoomBy(1 / 1.2));
  const zoomLabel = button('100%', 'Reset zoom to 100% (Ctrl+0)', 'zoom-reset', () => editor.setZoom(1));
  zoomLabel.classList.add('zoom-label');
  const zoomIn = button('+', 'Zoom in', 'zoom-in', () => editor.zoomBy(1.2));
  const zoomFit = button('Fit', 'Zoom to fit (Ctrl+Shift+F)', 'zoom-fit', () => editor.zoomToFit());
  toolRow.append(separator(), zoomOut, zoomLabel, zoomIn, zoomFit);

  // --- object actions ------------------------------------------------------
  const actions = el('div', { class: 'toolbar-row' });
  actions.append(
    button('Delete', 'Delete selection (Delete)', 'delete', () => editor.deleteSelection()),
    button('Duplicate', 'Duplicate selection (Ctrl+D)', 'duplicate', () => editor.duplicateSelection()),
    button('Front', 'Bring to front', 'front', () => editor.bringToFront()),
    button('Back', 'Send to back', 'back', () => editor.sendToBack()),
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
        setStatus(`Loaded ${file.name}`);
      } catch (error) {
        setStatus(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      fileInput.value = '';
    });
  });

  const ioRow = el('div', { class: 'toolbar-row' });
  ioRow.append(
    button('Export PNG', 'Download a clean PNG of all content', 'export-png', () => editor.downloadPNG('coslate.png')),
    button('Save JSON', 'Download the scene as JSON (Ctrl+S)', 'save-json', () => editor.downloadJSON('coslate.scene.json')),
    button('Load JSON', 'Load a scene from a JSON file', 'load-json', () => fileInput.click()),
    button('Clear', 'Remove every object', 'clear', () => editor.clear()),
    fileInput,
  );

  // --- style ---------------------------------------------------------------
  const styleRow = el('div', { class: 'toolbar-row' });
  for (const color of STROKE_PALETTE) {
    const swatch = el('button', {
      type: 'button',
      class: 'swatch',
      title: `Stroke ${color}`,
      'data-testid': `stroke-${color.replace('#', '')}`,
      'aria-pressed': 'false',
    });
    swatch.style.background = color;
    swatch.addEventListener('click', () => editor.setStyle({ stroke: color }));
    strokeButtons.set(color, swatch);
    styleRow.append(swatch);
  }

  styleRow.append(separator());
  for (const option of FILL_OPTIONS) {
    const testId = option.value === null ? 'fill-none' : `fill-${option.value.replace('#', '')}`;
    const swatch = el('button', {
      type: 'button',
      class: option.value === null ? 'swatch swatch-none' : 'swatch',
      title: option.label,
      'data-testid': testId,
      'aria-pressed': 'false',
    });
    if (option.value !== null) swatch.style.background = option.value;
    swatch.addEventListener('click', () => editor.setStyle({ fill: option.value }));
    fillButtons.set(String(option.value), swatch);
    styleRow.append(swatch);
  }

  styleRow.append(separator());
  for (const width of STROKE_WIDTHS) {
    const node = button('', `${width}px stroke`, `width-${width}`, () => editor.setStyle({ strokeWidth: width }));
    node.classList.add('width-button');
    const dot = el('span', { class: 'width-dot' });
    const size = Math.min(12, 3 + width);
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    node.append(dot);
    widthButtons.set(width, node);
    styleRow.append(node);
  }

  toolbar.append(toolRow, actions, ioRow, styleRow);

  // --- status bar ----------------------------------------------------------
  const toolStatus = el('span');
  const selectionStatus = el('span');
  const objectStatus = el('span');
  const zoomStatus = el('span');
  const saveStatus = el('span');
  const hint = el('span', { class: 'status-hint' });
  hint.textContent = 'window.__scene = { store, getScene, getSelection, setTool, … } — debug/test hook';
  statusbar.append(toolStatus, selectionStatus, objectStatus, zoomStatus, saveStatus, hint);

  function setStatus(text: string): void {
    saveStatus.textContent = text;
  }

  function setPressed<T>(map: Map<T, HTMLButtonElement>, value: T): void {
    for (const [key, node] of map) node.setAttribute('aria-pressed', String(key === value));
  }

  function sync(): void {
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

    toolStatus.innerHTML = `tool <strong>${tool}</strong>`;
    selectionStatus.innerHTML = `selection <strong>${selection.length}</strong>`;
    objectStatus.innerHTML = `objects <strong>${scene.order.length}</strong>`;
    const percent = Math.round(scene.viewport.scale * 100);
    zoomStatus.innerHTML = `zoom <strong>${percent}%</strong>`;
    zoomLabel.textContent = `${percent}%`;
  }

  editor.on('tool', sync);
  editor.on('selection', sync);
  editor.on('style', sync);
  editor.on('change', sync);
  sync();

  return { sync, setStatus };
}
