import Konva from 'konva';
import {
  addObjectOps,
  clampScale,
  createEmptyScene,
  createStore,
  DEFAULT_VIEWPORT,
  deserialize,
  isObjectOfType,
  makeObject,
  newId,
  panBy,
  removeObjectOps,
  reorderObjectOps,
  screenToWorld,
  serialize,
  updateObjectDataOps,
  updateObjectOps,
  zoomAt,
  zoomTo,
  type Id,
  type ObjectPropPatch,
  type Point,
  type Scene,
  type SceneObject,
  type SceneStore,
  type TextData,
  type Viewport,
} from '@coslate/core';
import { hitTest as hitTestScene } from './geometry.js';
import { measureText } from './nodes.js';
import { SceneRenderer } from './renderer.js';
import { DEFAULT_STYLE, stylePatchOps, type EditorStyle, type StyleKey } from './style.js';
import { TextOverlay } from './text-overlay.js';
import { EraserTool } from './tools/eraser.js';
import { PenTool } from './tools/pen.js';
import { SelectTool } from './tools/select.js';
import { ShapeTool } from './tools/shape.js';
import { TextTool } from './tools/text.js';
import type { PointerInfo, TextEditorRequest, Tool, ToolHost, ToolName } from './tools/types.js';

/**
 * The editor: scene + store + renderer + tools + input, wired together.
 *
 * It is the only place that owns a pointer gesture from start to finish, which
 * is what makes "one gesture = one undo step" enforceable rather than aspirational.
 */

export type EditorEventName = 'selection' | 'tool' | 'style' | 'change' | 'history' | 'viewport' | 'readonly';

/** What a host status bar needs, without reaching into the store. */
export interface EditorSummary {
  objects: number;
  /**
   * Bytes of the **compact** `serialize(scene)` — the number a server would
   * actually store. Note that `toJSON()` is pretty-printed for humans, so the two
   * differ; this is the one to show in a status bar.
   */
  bytes: number;
  selection: number;
  zoom: number;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Whether there is anything worth saving at all (R5: an empty board is not). */
  isEmpty: boolean;
}

export interface EditorOptions {
  /** Positioning context for the canvas and the text overlay. Must be `position: relative`. */
  container: HTMLElement;
  store?: SceneStore;
  style?: Partial<EditorStyle>;
  background?: string;
  width?: number;
  height?: number;
  historyLimit?: number;
  /** Watch the container and resize the stage. Defaults to `true`. */
  observeResize?: boolean;
  /**
   * Placeholder for the text tool's `<textarea>`, or a function read each time it
   * opens. The runtime ships no user-visible copy, so a localized embed passes
   * `() => i18n.t('text.placeholder')`; omit it and the field is simply empty.
   */
  textPlaceholder?: string | (() => string);
  /**
   * Accessible name for that same field, same rules. Omit both and the field is
   * unlabelled rather than labelled in English — an embed that cares about
   * localization is expected to supply one.
   */
  textAriaLabel?: string | (() => string);
  /**
   * Starting camera. The camera is per-user view state and never travels with the
   * document, so a host that wants "reopen where I left off" persists this itself.
   */
  viewport?: Viewport;
  /**
   * Mount read-only. Products usually mount read-only and unlock later — see
   * {@link WhiteboardEditor.setReadOnly}.
   */
  readOnly?: boolean;
  /** Called after a read-only flip, once the editor has settled into it. */
  onReadOnlyChange?: (readOnly: boolean) => void;
}

/** Coerce `string | () => string | undefined` into a lazy getter. */
function textOption(value: string | (() => string) | undefined): () => string {
  return typeof value === 'function' ? value : () => value ?? '';
}

const PASTE_OFFSET = 16;
const MIN_ZOOM_STEP = 0.0015;

function cloneObject(object: SceneObject): SceneObject {
  return JSON.parse(JSON.stringify(object)) as SceneObject;
}

function dataURLToBlob(dataUrl: string): Blob {
  const [meta = '', payload = ''] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'application/octet-stream';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export class WhiteboardEditor implements ToolHost {
  public readonly store: SceneStore;
  public readonly renderer: SceneRenderer;
  public readonly overlay: Konva.Layer;
  public style: EditorStyle;

  private readonly container: HTMLElement;
  private readonly canvasHost: HTMLDivElement;
  private readonly transformer: Konva.Transformer;
  private readonly textOverlay: TextOverlay;
  private readonly textPlaceholder: () => string;
  private readonly textAriaLabel: () => string;
  private readonly onReadOnlyChange: ((readOnly: boolean) => void) | undefined;

  /**
   * The camera. Per-user view state — deliberately not part of the scene, so it
   * cannot be broadcast to collaborators or captured in a baseline snapshot.
   */
  private viewport: Viewport;
  private readOnly: boolean;
  /** Memoised `{scene, bytes, objects}` for {@link getSummary}. */
  private summaryCache: { scene: Scene; bytes: number; objects: number } | null = null;
  private readonly tools = new Map<ToolName, Tool>();
  private readonly listeners = new Map<EditorEventName, Set<() => void>>();

  private tool: Tool;
  private selection: Id[] = [];
  private attachedKey = '';
  private clipboard: SceneObject[] = [];
  private pan: { pointerId: number; last: Point } | null = null;
  private spaceDown = false;
  private activePointerId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;
  /** World anchor of the open text editor, kept so the overlay can follow the camera. */
  private textOverlayWorld: { x: number; y: number; rotation: number } | null = null;

  constructor(options: EditorOptions) {
    this.container = options.container;
    this.style = { ...DEFAULT_STYLE, ...(options.style ?? {}) };
    this.textPlaceholder = textOption(options.textPlaceholder);
    this.textAriaLabel = textOption(options.textAriaLabel);
    this.onReadOnlyChange = options.onReadOnlyChange;
    this.viewport = { ...DEFAULT_VIEWPORT, ...(options.viewport ?? {}) };
    this.readOnly = options.readOnly === true;

    const computed = typeof getComputedStyle === 'function' ? getComputedStyle(this.container) : null;
    if (computed && computed.position === 'static') this.container.style.position = 'relative';

    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'coslate-canvas-host';
    Object.assign(this.canvasHost.style, {
      position: 'absolute',
      inset: '0',
      touchAction: 'none',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);
    this.container.appendChild(this.canvasHost);

    const width = options.width ?? Math.max(1, this.container.clientWidth);
    const height = options.height ?? Math.max(1, this.container.clientHeight);

    this.store = options.store ?? createStore({ historyLimit: options.historyLimit });
    this.renderer = new SceneRenderer({
      container: this.canvasHost,
      width,
      height,
      background: options.background ?? '#14161a',
    });
    this.overlay = this.renderer.getOverlayLayer();

    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      keepRatio: false,
      ignoreStroke: true,
      padding: 2,
      anchorSize: 9,
      anchorStroke: '#4dabf7',
      anchorFill: '#14161a',
      anchorCornerRadius: 2,
      borderStroke: '#4dabf7',
      borderStrokeWidth: 1,
      rotateAnchorOffset: 26,
      // A zero-area object cannot be recovered by dragging, so refuse it.
      boundBoxFunc: (oldBox, newBox) =>
        Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox,
    });
    this.transformer.visible(false);
    this.overlay.add(this.transformer);
    this.transformer.on('transformend', () => this.commitTransform());

    this.textOverlay = new TextOverlay(this.container);

    const select = new SelectTool(this);
    this.tools.set('select', select);
    this.tools.set('pen', new PenTool(this));
    this.tools.set('eraser', new EraserTool(this));
    this.tools.set('rect', new ShapeTool(this, 'shape.rect'));
    this.tools.set('ellipse', new ShapeTool(this, 'shape.ellipse'));
    this.tools.set('line', new ShapeTool(this, 'shape.line'));
    this.tools.set('arrow', new ShapeTool(this, 'shape.arrow'));
    this.tools.set('text', new TextTool(this));
    this.tool = select;
    this.canvasHost.style.cursor = this.tool.cursor;

    this.bindEvents();
    // The renderer subscribes first so nodes are reconciled before any listener
    // (including this editor's own) reacts to the same change.
    this.renderer.attach(this.store);
    // The renderer is told the camera explicitly: it is not in the scene it syncs.
    this.renderer.applyViewport(this.viewport);
    this.unsubscribe = this.store.subscribe(() => this.handleStoreChange());

    if (options.observeResize !== false && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.syncSize());
      this.resizeObserver.observe(this.container);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  destroy(): void {
    this.destroyed = true;
    this.unbindEvents();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.textOverlay.close();
    this.renderer.destroy();
    this.canvasHost.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------- events

  on(event: EditorEventName, handler: () => void): () => void {
    const set = this.listeners.get(event) ?? new Set<() => void>();
    set.add(handler);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  private emit(event: EditorEventName): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) handler();
  }

  // -------------------------------------------------------------------- tools

  setTool(name: ToolName): void {
    const next = this.tools.get(name);
    if (!next || next === this.tool) return;
    this.tool.deactivate?.();
    this.tool = next;
    this.tool.activate?.();
    this.canvasHost.style.cursor = this.spaceDown ? 'grab' : next.cursor;
    this.refreshTransformer();
    this.emit('tool');
  }

  getToolName(): ToolName {
    return this.tool.name;
  }

  // --------------------------------------------------------------- read-only

  /**
   * Whether this editor refuses local mutation.
   *
   * Read-only is not "hide the toolbar": every path that could write to the
   * document is closed here, in the editor, because a viewer that merely *looks*
   * disabled will eventually be written to by a host that forgot to check. The
   * camera stays live — panning and zooming are the viewer's own view state and
   * never touch the document.
   */
  isReadOnly(): boolean {
    return this.readOnly;
  }

  /**
   * Flip read-only at runtime.
   *
   * Products mount read-only and unlock when permission arrives (a student is
   * invited to the stage, a co-host is promoted), so this must be safe to call
   * at any moment — including mid-gesture. Turning it *on* aborts whatever the
   * user was doing and resets the tool, because "no residual tool state" is the
   * requirement: a half-drawn stroke that resumes after permission is revoked is
   * exactly the accident the gating exists to prevent.
   */
  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly) return;
    this.readOnly = readOnly;
    if (readOnly) {
      this.abortGesture();
      this.setSelection([]);
      // A mutating tool left selected would look armed; go back to Select.
      this.setTool('select');
      this.renderer.batchDraw();
    }
    this.canvasHost.style.cursor = this.readOnly ? 'grab' : this.spaceDown ? 'grab' : this.tool.cursor;
    this.emit('readonly');
    this.onReadOnlyChange?.(readOnly);
  }

  /** Drop any in-flight gesture and let the active tool discard its preview. */
  private abortGesture(): void {
    this.textOverlay.close();
    this.textOverlayWorld = null;
    this.pan = null;
    if (this.activePointerId !== null) {
      if (this.canvasHost.hasPointerCapture(this.activePointerId)) {
        this.canvasHost.releasePointerCapture(this.activePointerId);
      }
      this.activePointerId = null;
    }
    // Tools cancel their in-flight work in `deactivate`; re-arm immediately.
    this.tool.deactivate?.();
    this.tool.activate?.();
    this.refreshTransformer();
    this.renderer.batchDraw();
  }

  // ------------------------------------------------------------- ToolHost API

  getScene(): Scene {
    return this.store.getState();
  }

  /** A copy: the camera belongs to the editor, and callers must not mutate it. */
  getViewport(): Viewport {
    return { ...this.viewport };
  }

  /** Replace the camera outright — host restore, or a "go to object" feature. */
  setViewport(viewport: Viewport): void {
    this.applyViewport(viewport);
  }

  getSelection(): Id[] {
    return this.selection.slice();
  }

  isSelected(id: Id): boolean {
    return this.selection.includes(id);
  }

  setSelection(ids: readonly Id[], options: { additive?: boolean } = {}): void {
    const base = options.additive ? this.selection : [];
    const next: Id[] = [];
    for (const id of [...base, ...ids]) {
      if (!next.includes(id) && this.store.getObject(id)) next.push(id);
    }
    if (next.length === this.selection.length && next.every((id, index) => this.selection[index] === id)) return;
    this.selection = next;
    this.refreshTransformer();
    this.emit('selection');
  }

  toggleSelection(id: Id): void {
    const next = this.selection.includes(id)
      ? this.selection.filter((entry) => entry !== id)
      : [...this.selection, id];
    this.selection = next;
    this.refreshTransformer();
    this.emit('selection');
  }

  clearSelection(): void {
    this.setSelection([]);
  }

  hitTest(world: Point): SceneObject | null {
    const tolerance = 4 / Math.max(0.05, this.getViewport().scale);
    return hitTestScene(this.store.getState(), world, { tolerance });
  }

  getNode(id: Id): Konva.Shape | undefined {
    return this.renderer.getNode(id);
  }

  requestDraw(): void {
    this.overlay.batchDraw();
  }

  refreshTransformer(): void {
    const key = this.selection.join('|');
    if (key !== this.attachedKey) {
      this.attachedKey = key;
      const nodes = this.selection
        .map((id) => this.renderer.getNode(id))
        .filter((node): node is Konva.Shape => node !== undefined);
      this.transformer.nodes(nodes);
    } else {
      this.transformer.forceUpdate();
    }
    this.transformer.visible(
      !this.readOnly && this.selection.length > 0 && this.tool.name === 'select' && !this.textOverlay.isOpen(),
    );
    this.overlay.batchDraw();
  }

  openTextEditor(request: TextEditorRequest): void {
    if (this.readOnly) return;
    // Clicking away from an open editor commits it rather than discarding it.
    if (this.textOverlay.isOpen()) this.textOverlay.commit();
    this.textOverlayWorld = { x: request.world.x, y: request.world.y, rotation: request.rotation };
    this.textOverlay.open({
      screen: request.screen,
      rotation: request.rotation,
      scale: request.scale,
      fontSize: request.fontSize,
      fontFamily: request.fontFamily,
      color: request.color,
      value: request.value,
      placeholder: request.objectId ? undefined : this.textPlaceholder(),
      ariaLabel: this.textAriaLabel(),
      onCommit: (value) => this.commitText(request, value),
      onCancel: () => {
        this.textOverlayWorld = null;
        this.refreshTransformer();
        this.emit('change');
      },
    });
    this.refreshTransformer();
  }

  // ------------------------------------------------------------------- style

  setStyle(partial: Partial<EditorStyle>): void {
    if (this.readOnly) return;
    const keys = Object.keys(partial) as StyleKey[];
    if (keys.length === 0) return;
    this.style = { ...this.style, ...partial };
    if (this.selection.length > 0) this.applyStyleToSelection(keys);
    this.emit('style');
  }

  private applyStyleToSelection(keys: readonly StyleKey[]): void {
    const ids = this.selection.slice();
    const store = this.store;
    store.transaction(
      (_scene, tx) => {
        for (const id of ids) {
          const object = store.getObject(id);
          if (!object) continue;
          const ops = stylePatchOps(object, this.style, keys);
          if (ops.length > 0) {
            store.dispatch(tx.commit('object.style', ops, { label: 'Style' }));
          }
          if (isObjectOfType(object, 'shape.text') && keys.includes('fontSize')) {
            const size = measureText({ ...object.data, fontSize: this.style.fontSize });
            store.dispatch(
              tx.commit('object.resize', updateObjectOps(id, { width: size.width, height: size.height }), {
                label: 'Style',
              }),
            );
          }
        }
      },
      { label: 'Change style' },
    );
  }

  // ------------------------------------------------------------------ editing

  deleteSelection(): void {
    if (this.readOnly) return;
    const ids = this.selection.slice();
    if (ids.length === 0) return;
    const store = this.store;
    store.transaction(
      (_scene, tx) => {
        for (const id of ids) {
          store.dispatch(tx.commit('object.delete', removeObjectOps(store.getState(), id), { label: 'Delete' }));
        }
      },
      { label: ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete' },
    );
    this.setSelection([]);
  }

  copySelection(): number {
    this.clipboard = this.selection
      .map((id) => this.store.getObject(id))
      .filter((object): object is SceneObject => object !== undefined)
      .map((object) => cloneObject(object));
    return this.clipboard.length;
  }

  paste(): Id[] {
    if (this.readOnly) return [];
    if (this.clipboard.length === 0) return [];
    const created = this.createFrom(this.clipboard, PASTE_OFFSET);
    this.setSelection(created);
    return created;
  }

  duplicateSelection(): Id[] {
    if (this.readOnly) return [];
    const sources = this.selection
      .map((id) => this.store.getObject(id))
      .filter((object): object is SceneObject => object !== undefined)
      .map((object) => cloneObject(object));
    if (sources.length === 0) return [];
    const created = this.createFrom(sources, PASTE_OFFSET);
    this.setSelection(created);
    return created;
  }

  private createFrom(sources: readonly SceneObject[], offset: number): Id[] {
    const store = this.store;
    const created: Id[] = [];
    store.transaction(
      (_scene, tx) => {
        for (const source of sources) {
          const copy = cloneObject(source);
          copy.id = newId('obj');
          copy.x += offset;
          copy.y += offset;
          if (copy.parentId) delete copy.parentId;
          store.dispatch(tx.commit('object.create', addObjectOps(copy), { label: 'Paste' }));
          created.push(copy.id);
        }
      },
      { label: sources.length > 1 ? `Paste ${sources.length} objects` : 'Paste' },
    );
    return created;
  }

  bringToFront(): void {
    if (this.readOnly) return;
    this.reorder('front');
  }

  sendToBack(): void {
    if (this.readOnly) return;
    this.reorder('back');
  }

  private reorder(target: 'front' | 'back'): void {
    const ids = this.selection.slice();
    if (ids.length === 0) return;
    const store = this.store;
    store.transaction(
      (_scene, tx) => {
        for (const id of ids) {
          const ops = reorderObjectOps(store.getState(), id, target);
          if (ops.length > 0) {
            store.dispatch(tx.commit('object.reorder', ops, { label: target === 'front' ? 'Bring to front' : 'Send to back' }));
          }
        }
      },
      { label: target === 'front' ? 'Bring to front' : 'Send to back' },
    );
  }

  private commitText(request: TextEditorRequest, value: string): void {
    const store = this.store;
    this.textOverlayWorld = null;

    if (request.objectId) {
      const object = store.getObject(request.objectId);
      if (!object || !isObjectOfType(object, 'shape.text')) {
        this.refreshTransformer();
        return;
      }
      const size = measureText({ ...object.data, text: value });
      const id = request.objectId;
      store.transaction(
        (_scene, tx) => {
          store.dispatch(tx.commit('object.update', updateObjectDataOps<'shape.text'>(id, { text: value }), { label: 'Edit text' }));
          store.dispatch(
            tx.commit('object.resize', updateObjectOps(id, { width: size.width, height: size.height }), {
              label: 'Edit text',
            }),
          );
        },
        { label: 'Edit text' },
      );
      this.refreshTransformer();
      return;
    }

    // An empty commit is an abandoned click: no object, no undo step.
    if (value.trim() === '') {
      this.refreshTransformer();
      return;
    }

    const data: TextData = {
      text: value,
      fontFamily: this.style.fontFamily,
      fontSize: this.style.fontSize,
      fill: this.style.stroke,
      align: 'left',
    };
    const size = measureText(data);
    const object = makeObject({
      type: 'shape.text',
      x: request.world.x,
      y: request.world.y,
      width: size.width,
      height: size.height,
      data,
    });
    store.commit({ type: 'object.create', patch: addObjectOps(object), label: 'Text' });
    this.refreshTransformer();
  }

  // ------------------------------------------------------------------ history

  undo(): boolean {
    return this.store.undo();
  }

  redo(): boolean {
    return this.store.redo();
  }

  canUndo(): boolean {
    return this.store.canUndo();
  }

  canRedo(): boolean {
    return this.store.canRedo();
  }

  /**
   * A cheap summary of the document, for a host status bar.
   *
   * The first host application shows "baseline objects / saved bytes / editable"
   * and needs it to update as the user draws *and* as the board is saved, so the
   * byte count is the real serialized size rather than an estimate. It is cached
   * against the scene reference: computing it per repaint would serialize the
   * whole document on every pointer move.
   */
  getSummary(): EditorSummary {
    const scene = this.store.getState();
    if (this.summaryCache?.scene !== scene) {
      this.summaryCache = {
        scene,
        bytes: serialize(scene).length,
        objects: scene.order.length,
      };
    }
    const zoom = this.viewport.scale;
    return {
      objects: this.summaryCache.objects,
      bytes: this.summaryCache.bytes,
      selection: this.selection.length,
      zoom,
      readOnly: this.readOnly,
      canUndo: this.store.canUndo(),
      canRedo: this.store.canRedo(),
      isEmpty: scene.order.length === 0,
    };
  }

  // ------------------------------------------------------------------ camera

  zoomBy(factor: number, screenPoint?: Point): void {
    const viewport = this.getViewport();
    this.applyViewport(zoomAt(viewport, screenPoint ?? this.centerScreen(), factor));
  }

  setZoom(scale: number, screenPoint?: Point): void {
    const viewport = this.getViewport();
    this.applyViewport(zoomTo(viewport, screenPoint ?? this.centerScreen(), scale));
  }

  panByScreen(dx: number, dy: number): void {
    this.applyViewport(panBy(this.getViewport(), dx, dy));
  }

  zoomToFit(padding = 64): void {
    const fitted = this.renderer.fitViewport(padding);
    if (fitted) this.applyViewport(fitted);
  }

  private applyViewport(viewport: Viewport): void {
    const next = { ...viewport, scale: clampScale(viewport.scale) };
    if (next.x === this.viewport.x && next.y === this.viewport.y && next.scale === this.viewport.scale) return;
    this.viewport = next;
    this.renderer.applyViewport(next);
    if (this.textOverlay.isOpen()) this.repositionTextOverlay();
    this.emit('viewport');
  }

  private repositionTextOverlay(): void {
    const viewport = this.getViewport();
    const open = this.textOverlayWorld;
    if (!open) return;
    this.textOverlay.reposition(
      { x: (open.x - viewport.x) * viewport.scale, y: (open.y - viewport.y) * viewport.scale },
      viewport.scale,
      open.rotation,
    );
  }

  private centerScreen(): Point {
    const size = this.renderer.getSize();
    return { x: size.width / 2, y: size.height / 2 };
  }

  screenToWorld(point: Point): Point {
    return screenToWorld(this.getViewport(), point);
  }

  worldToScreen(point: Point): Point {
    const viewport = this.getViewport();
    return { x: (point.x - viewport.x) * viewport.scale, y: (point.y - viewport.y) * viewport.scale };
  }

  getRenderedScale(): number {
    return this.renderer.getRenderedScale();
  }

  getRenderedSize(id: Id): { width: number; height: number } | null {
    return this.renderer.getRenderedSize(id);
  }

  // ----------------------------------------------------------- serialization

  toJSON(): string {
    return serialize(this.store.getState(), { pretty: true });
  }

  loadJSON(text: string): Scene {
    const scene = deserialize(text);
    this.setSelection([]);
    this.store.reset(scene);
    return scene;
  }

  /**
   * Reset the document and **discard history**. This is "open a different board",
   * not "clear the board": the camera survives (it is not in the document) but
   * nothing can be undone afterwards.
   */
  clear(): void {
    this.setSelection([]);
    this.store.reset(createEmptyScene());
  }

  /**
   * Delete every object as one undoable step, and return how many went.
   *
   * This is the "clear the board" a classroom actually needs. The reset above
   * cannot serve it: destroying the undo history at the exact moment a teacher
   * wipes the room is how a mis-click becomes a lost lesson. Deleting through the
   * ordinary command path also means the wipe is broadcast like any other edit,
   * so every participant converges on the same empty board.
   */
  clearAll(): number {
    if (this.readOnly) return 0;
    const ids = this.store.getState().order;
    if (ids.length === 0) return 0;
    this.setSelection([]);
    this.store.transaction(
      (_scene, tx) => {
        for (const id of [...ids].reverse()) {
          this.store.dispatch(tx.commit('object.delete', removeObjectOps(this.store.getState(), id)));
        }
      },
      { label: 'Clear board' },
    );
    return ids.length;
  }

  exportPNG(pixelRatio = 2): string {
    const fitted = this.renderer.fitViewport(48) ?? this.getViewport();
    return this.renderer.exportDataURL({ viewport: fitted, pixelRatio });
  }

  downloadPNG(filename = 'coslate.png'): void {
    this.download(dataURLToBlob(this.exportPNG()), filename);
  }

  downloadJSON(filename = 'coslate.scene.json'): void {
    this.download(new Blob([this.toJSON()], { type: 'application/json' }), filename);
  }

  private download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a beat to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ------------------------------------------------------------------ resize

  syncSize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const size = this.renderer.getSize();
    if (size.width === width && size.height === height) return;
    this.renderer.resize(width, height);
  }

  // ------------------------------------------------------------------- input

  private bindEvents(): void {
    this.canvasHost.addEventListener('pointerdown', this.handlePointerDown);
    this.canvasHost.addEventListener('pointermove', this.handlePointerMove);
    this.canvasHost.addEventListener('pointerup', this.handlePointerUp);
    this.canvasHost.addEventListener('pointercancel', this.handlePointerUp);
    this.canvasHost.addEventListener('mousedown', this.handleMouseDown);
    this.canvasHost.addEventListener('dblclick', this.handleDoubleClick);
    this.canvasHost.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvasHost.addEventListener('contextmenu', this.handleContextMenu);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  private unbindEvents(): void {
    this.canvasHost.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvasHost.removeEventListener('pointermove', this.handlePointerMove);
    this.canvasHost.removeEventListener('pointerup', this.handlePointerUp);
    this.canvasHost.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvasHost.removeEventListener('mousedown', this.handleMouseDown);
    this.canvasHost.removeEventListener('dblclick', this.handleDoubleClick);
    this.canvasHost.removeEventListener('wheel', this.handleWheel);
    this.canvasHost.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  /**
   * Suppress the browser's default mousedown behaviour (focus shift, text
   * selection, native drag). Without this, placing a text object is impossible:
   * the textarea is focused during `pointerdown`, and the focus change that
   * `mousedown` would otherwise perform blurs it immediately, which commits an
   * empty string and closes the editor before a single key is pressed.
   *
   * Clicking the canvas with an editor open still commits — the editor does that
   * explicitly in `handlePointerDown`, so behaviour is unchanged.
   */
  private readonly handleMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private pointerInfo(event: PointerEvent | WheelEvent): PointerInfo {
    const rect = this.canvasHost.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      screen,
      world: this.screenToWorld(screen),
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      button: 'button' in event ? event.button : 0,
      pointerId: 'pointerId' in event ? event.pointerId : 1,
    };
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.textOverlay.isOpen() && event.button === 0) {
      // The overlay's own handlers stop propagation, so reaching here means the
      // click landed on the canvas: commit the text and continue.
      this.textOverlay.commit();
    }
    const info = this.pointerInfo(event);
    if (event.button === 1 || (event.button === 0 && this.spaceDown)) {
      event.preventDefault();
      this.pan = { pointerId: event.pointerId, last: info.screen };
      this.canvasHost.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (this.readOnly) {
      // An audience has no other use for the left button, so dragging pans rather
      // than doing nothing: "you cannot edit" must not mean "you cannot look
      // around". The camera is view state and never reaches the document.
      event.preventDefault();
      this.pan = { pointerId: event.pointerId, last: info.screen };
      this.canvasHost.setPointerCapture(event.pointerId);
      return;
    }

    // Selection handles belong to Konva's Transformer. Content nodes are all
    // `listening(false)`, so anything the hit graph reports here is editor UI —
    // hand the gesture to Konva instead of starting a scene drag underneath it.
    if (this.stageHitsOverlayUi(info.screen)) return;

    this.canvasHost.setPointerCapture(event.pointerId);
    this.activePointerId = event.pointerId;
    this.textOverlayWorld = null;
    this.tool.onPointerDown?.(info);
  };

  private stageHitsOverlayUi(screen: Point): boolean {
    return this.renderer.stage.getIntersection(screen) !== null;
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const info = this.pointerInfo(event);
    if (this.pan && this.pan.pointerId === event.pointerId) {
      const dx = info.screen.x - this.pan.last.x;
      const dy = info.screen.y - this.pan.last.y;
      this.pan.last = info.screen;
      this.applyViewport(panBy(this.getViewport(), dx, dy));
      return;
    }
    if (!this.readOnly) this.tool.onPointerMove?.(info);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const info = this.pointerInfo(event);
    if (this.pan && this.pan.pointerId === event.pointerId) {
      this.pan = null;
      if (this.canvasHost.hasPointerCapture(event.pointerId)) {
        this.canvasHost.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (this.activePointerId === event.pointerId) {
      this.activePointerId = null;
      if (this.canvasHost.hasPointerCapture(event.pointerId)) {
        this.canvasHost.releasePointerCapture(event.pointerId);
      }
    }
    if (!this.readOnly) this.tool.onPointerUp?.(info);
  };

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    if (this.readOnly) return;
    const rect = this.canvasHost.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.tool.onDoubleClick?.({
      screen,
      world: this.screenToWorld(screen),
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      button: 0,
      pointerId: 1,
    });
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    // Always ours: the browser must not scroll or zoom the page over a canvas.
    event.preventDefault();
    const info = this.pointerInfo(event);
    const viewport = this.getViewport();
    const intensity = event.ctrlKey || event.metaKey ? MIN_ZOOM_STEP : MIN_ZOOM_STEP * 4;

    // A two-finger trackpad gesture reports horizontal travel; treat it as a pan
    // so the same hardware gesture that scrolls a page pans the board.
    if (event.deltaX !== 0 && !event.ctrlKey && !event.metaKey) {
      this.applyViewport(panBy(viewport, -event.deltaX, -event.deltaY));
      return;
    }
    this.applyViewport(zoomAt(viewport, info.screen, Math.exp(-event.deltaY * intensity)));
  };

  private readonly handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || isTextInput(event.target)) return;
    if (!this.spaceDown) {
      this.spaceDown = true;
      this.canvasHost.style.cursor = 'grab';
    }
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    this.spaceDown = false;
    this.canvasHost.style.cursor = this.tool.cursor;
  };

  private handleStoreChange(): void {
    this.refreshTransformer();
    this.emit('change');
    this.emit('history');
  }

  // ------------------------------------------------------------------ internal

  private commitTransform(): void {
    const store = this.store;
    const ids = this.selection.slice();
    if (ids.length === 0) return;

    interface Pending {
      id: Id;
      props: ObjectPropPatch;
      data?: { fontSize: number };
      size?: { width: number; height: number };
    }
    const pending: Pending[] = [];

    for (const id of ids) {
      const object = store.getObject(id);
      const node = this.renderer.getNode(id);
      if (!object || !node) continue;
      const x = node.x();
      const y = node.y();
      const rotation = node.rotation();
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const props: ObjectPropPatch = { x, y, rotation };

      if ((object.type === 'shape.rect' || object.type === 'shape.ellipse') && scaleX > 0 && scaleY > 0) {
        // Bake the scale into the box: the rendered result is identical, and the
        // document stays readable (2x scale on every resize is how scene files rot).
        props.width = Math.max(1, object.width * scaleX);
        props.height = Math.max(1, object.height * scaleY);
        props.scaleX = 1;
        props.scaleY = 1;
        pending.push({ id, props });
        continue;
      }

      if (isObjectOfType(object, 'shape.text') && scaleY > 0) {
        // Text cannot be baked into a box; scale the glyphs instead.
        const fontSize = Math.max(6, Math.round(object.data.fontSize * scaleY));
        const size = measureText({ ...object.data, fontSize });
        props.scaleX = 1;
        props.scaleY = 1;
        pending.push({ id, props, data: { fontSize }, size });
        continue;
      }

      props.scaleX = scaleX;
      props.scaleY = scaleY;
      pending.push({ id, props });
    }

    if (pending.length === 0) return;
    store.transaction(
      (_scene, tx) => {
        for (const entry of pending) {
          if (entry.data && entry.size) {
            store.dispatch(
              tx.commit('object.update', updateObjectDataOps<'shape.text'>(entry.id, { fontSize: entry.data.fontSize }), {
                label: 'Resize',
              }),
            );
            store.dispatch(
              tx.commit(
                'object.resize',
                updateObjectOps(entry.id, {
                  x: entry.props.x,
                  y: entry.props.y,
                  rotation: entry.props.rotation,
                  width: entry.size.width,
                  height: entry.size.height,
                }),
                { label: 'Resize' },
              ),
            );
            continue;
          }
          store.dispatch(tx.commit('object.update', updateObjectOps(entry.id, entry.props), { label: 'Resize' }));
        }
      },
      { label: pending.length > 1 ? `Resize ${pending.length} objects` : 'Resize' },
    );
  }
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** Re-exported so applications can build their own chrome on the same names. */
export type { ToolName };
