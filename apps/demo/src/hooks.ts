import type { GridAppearance, Id, Point, Scene, SceneDelta, SceneStore, Viewport } from '@coslate/core';
import type { EditorStyle, EditorSummary, ToolName, WhiteboardEditor } from '@coslate/konva';

/**
 * The test/debug hook.
 *
 * `window.__scene` exists so that end-to-end tests (and a curious human in
 * devtools) can assert against *real scene state* instead of scraping DOM text.
 * It is a documented public surface of the demo, not an accident: the Playwright
 * suite in `tests/e2e` depends on exactly these names.
 *
 * `window.__i18n` is its counterpart for locale — declared and installed by
 * `installI18n` in `./i18n/index.ts`, with the same "documented, depended on"
 * status.
 */
export interface CoSlateTestHook {
  editor: WhiteboardEditor;
  store: SceneStore;
  /** Full scene document: `{ format, version, viewport, objects, order }`. */
  getScene(): Scene;
  /** Current viewport (camera) state. */
  getViewport(): Viewport;
  /** Selected object ids. */
  getSelection(): Id[];
  setSelection(ids: readonly Id[]): void;
  /** Scene coordinates for a viewport-relative screen point. */
  screenToWorld(x: number, y: number): Point;
  worldToScreen(x: number, y: number): Point;
  setTool(name: ToolName): void;
  getToolName(): ToolName;
  undo(): boolean;
  redo(): boolean;
  /** Multiply the zoom by `factor`. */
  zoomBy(factor: number): void;
  fit(): void;
  /** The scale scene content is actually rendered at. */
  getRenderedScale(): number;
  /** On-screen pixel size of an object's rendered node. */
  getRenderedSize(id: Id): { width: number; height: number } | null;
  deleteSelection(): void;
  duplicateSelection(): Id[];
  setStyle(partial: Partial<EditorStyle>): void;
  clear(): void;
  /** Undoable "clear the board", as opposed to the destructive reset above. */
  clearAll(): number;
  toJSON(): string;
  loadJSON(text: string): void;
  // Collaboration / read-only surfaces, so the suite can drive the same paths a
  // host would: a viewer that receives deltas, and permission that flips.
  isReadOnly(): boolean;
  setReadOnly(readOnly: boolean): void;
  /** Feed the store an inbound object-state delta, exactly as a peer would. */
  applyDelta(delta: SceneDelta): boolean;
  getSummary(): EditorSummary;
  // The page's visual contract (R11): view configuration a host can set, proven
  // to change what is painted without ever entering the document.
  /** Current page background and grid, read back through the renderer. */
  getViewConfig(): { background: string; grid: GridAppearance };
  setBackground(color: string): void;
  setGrid(partial: Partial<GridAppearance>): void;
}

declare global {
  interface Window {
    __scene?: CoSlateTestHook;
  }
}

export function installTestHook(editor: WhiteboardEditor): CoSlateTestHook {
  const hook: CoSlateTestHook = {
    editor,
    store: editor.store,
    getScene: () => editor.getScene(),
    getViewport: () => editor.getViewport(),
    getSelection: () => editor.getSelection(),
    screenToWorld: (x, y) => editor.screenToWorld({ x, y }),
    worldToScreen: (x, y) => editor.worldToScreen({ x, y }),
    setTool: (name) => editor.setTool(name),
    getToolName: () => editor.getToolName(),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    zoomBy: (factor) => editor.zoomBy(factor),
    fit: () => editor.zoomToFit(),
    getRenderedScale: () => editor.getRenderedScale(),
    getRenderedSize: (id) => editor.getRenderedSize(id),
    setSelection: (ids) => editor.setSelection(ids),
    deleteSelection: () => editor.deleteSelection(),
    duplicateSelection: () => editor.duplicateSelection(),
    setStyle: (partial) => editor.setStyle(partial),
    clear: () => editor.clear(),
    clearAll: () => editor.clearAll(),
    isReadOnly: () => editor.isReadOnly(),
    setReadOnly: (readOnly) => editor.setReadOnly(readOnly),
    applyDelta: (delta) => editor.store.applyDelta(delta),
    getSummary: () => editor.getSummary(),
    getViewConfig: () => ({
      background: editor.renderer.getBackground(),
      grid: { ...editor.renderer.getGrid() },
    }),
    setBackground: (color) => editor.setBackground(color),
    setGrid: (partial) => editor.setGrid(partial),
    toJSON: () => editor.toJSON(),
    loadJSON: (text) => {
      editor.loadJSON(text);
    },
  };
  window.__scene = hook;
  return hook;
}
