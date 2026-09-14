import type { Id, Point, Scene, SceneStore, Viewport } from '@coslate/core';
import type { ToolName, WhiteboardEditor } from '@coslate/konva';

/**
 * The test/debug hook.
 *
 * `window.__scene` exists so that end-to-end tests (and a curious human in
 * devtools) can assert against *real scene state* instead of scraping DOM text.
 * It is a documented public surface of the demo, not an accident: the Playwright
 * suite in `tests/e2e` depends on exactly these names.
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
  /** Scene coordinates for a viewport-relative screen point. */
  screenToWorld(x: number, y: number): Point;
  worldToScreen(x: number, y: number): Point;
  setTool(name: ToolName): void;
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
  clear(): void;
  toJSON(): string;
  loadJSON(text: string): void;
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
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    zoomBy: (factor) => editor.zoomBy(factor),
    fit: () => editor.zoomToFit(),
    getRenderedScale: () => editor.getRenderedScale(),
    getRenderedSize: (id) => editor.getRenderedSize(id),
    deleteSelection: () => editor.deleteSelection(),
    clear: () => editor.clear(),
    toJSON: () => editor.toJSON(),
    loadJSON: (text) => {
      editor.loadJSON(text);
    },
  };
  window.__scene = hook;
  return hook;
}
