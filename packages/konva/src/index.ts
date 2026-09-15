/**
 * @coslate/konva — the Konva renderer, tools and editor shell.
 *
 * This package is a *client* of `@coslate/core`: it reads the scene and writes
 * commands. It never owns the document, which is why the same scene can be
 * rendered by something else tomorrow.
 */

export { SceneRenderer } from './renderer.js';
export type { SceneRendererOptions, ExportOptions } from './renderer.js';

export {
  contentBounds,
  hitTest,
  hitTestObject,
  localToWorld,
  normalizePoints,
  objectsInBounds,
  worldToLocal,
} from './geometry.js';
export type { HitOptions } from './geometry.js';

export { createObjectNode, measureText, textAttrs, updateObjectNode } from './nodes.js';

export {
  cloneStyle,
  DEFAULT_STYLE,
  STROKE_PALETTE,
  STROKE_WIDTHS,
  styleDataFor,
  stylePatchOps,
} from './style.js';
export type { EditorStyle, StyleKey } from './style.js';

export { TextOverlay } from './text-overlay.js';
export type { TextOverlayOptions } from './text-overlay.js';

export { WhiteboardEditor } from './editor.js';
export type { EditorEventName, EditorOptions, EditorSummary } from './editor.js';

export { createSceneViewer, renderSceneOnce } from './viewer.js';
export type { SceneViewer, SceneViewerOptions } from './viewer.js';

export { TOOL_NAMES } from './tools/types.js';
export type { PointerInfo, TextEditorRequest, Tool, ToolHost, ToolName } from './tools/types.js';
export { SelectTool } from './tools/select.js';
export { PenTool } from './tools/pen.js';
export { EraserTool } from './tools/eraser.js';
export { ShapeTool } from './tools/shape.js';
export type { ShapeKind } from './tools/shape.js';
export { TextTool } from './tools/text.js';

/** Re-exported so applications need only one import for the common case. */
export {
  createStore,
  createEmptyScene,
  DEFAULT_BACKGROUND,
  DEFAULT_GRID,
  deserialize,
  resolveGrid,
  serialize,
  screenToWorld,
  worldToScreen,
} from '@coslate/core';
export type { GridAppearance, Scene, SceneObject, SceneStore, Viewport } from '@coslate/core';
