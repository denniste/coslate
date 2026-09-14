import type Konva from 'konva';
import type { Id, Point, Scene, SceneObject, SceneStore, Viewport } from '@coslate/core';
import type { EditorStyle } from '../style.js';

/**
 * Tools are small, stateless-ish gesture handlers. They receive pointer events,
 * draw *previews* on the overlay layer, and commit at most one command per
 * gesture.
 *
 * The `ToolHost` interface is what a tool is allowed to see of the editor. It is
 * deliberately narrow: no tool can reach the renderer's content layer, and no
 * tool can mutate the scene without going through a transaction.
 */

export type ToolName = 'select' | 'pen' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

export const TOOL_NAMES: readonly ToolName[] = ['select', 'pen', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'text'];

export interface PointerInfo {
  /** Container-relative pixels. */
  screen: Point;
  /** Scene coordinates. */
  world: Point;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  button: number;
  pointerId: number;
}

export interface TextEditorRequest {
  /** Screen position (container-relative pixels) of the text box origin. */
  screen: Point;
  world: Point;
  rotation: number;
  scale: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  value: string;
  /** Existing object being edited, or `null` when placing a new one. */
  objectId: Id | null;
}

export interface ToolHost {
  readonly store: SceneStore;
  readonly style: EditorStyle;
  readonly overlay: Konva.Layer;

  getScene(): Scene;
  getViewport(): Viewport;
  getSelection(): Id[];
  isSelected(id: Id): boolean;
  setSelection(ids: readonly Id[], options?: { additive?: boolean }): void;
  toggleSelection(id: Id): void;

  hitTest(world: Point): SceneObject | null;
  getNode(id: Id): Konva.Shape | undefined;

  /** Repaint the overlay layer after moving/creating preview nodes. */
  requestDraw(): void;
  /** Keep the selection transformer aligned with preview node positions. */
  refreshTransformer(): void;
  openTextEditor(request: TextEditorRequest): void;
}

export interface Tool {
  readonly name: ToolName;
  /** CSS cursor while this tool is active. */
  readonly cursor: string;
  activate?(): void;
  deactivate?(): void;
  onPointerDown?(info: PointerInfo): void;
  onPointerMove?(info: PointerInfo): void;
  onPointerUp?(info: PointerInfo): void;
  onDoubleClick?(info: PointerInfo): void;
}
