import Konva from 'konva';
import {
  DEFAULT_BACKGROUND,
  resolveGrid,
  worldToScreen,
  type GridAppearance,
  type Id,
  type Scene,
  type Viewport,
} from '@coslate/core';
import type { SceneStore } from '@coslate/core';
import { contentBounds } from './geometry.js';
import { createObjectNode, updateObjectNode } from './nodes.js';

/**
 * The renderer: a one-way projection of the scene onto a Konva stage.
 *
 * Rules that this class enforces by construction:
 *  - it never writes to the store; it only reads `store.getState()` on change;
 *  - every object maps to exactly one node, reconciled by id, so re-render is a
 *    diff and not a rebuild (selection and transformer stay attached);
 *  - the three layers are fixed: background grid, content, overlay. Tools draw
 *    previews on the overlay layer so a half-finished gesture can never be
 *    mistaken for document content.
 *
 * The page layer (background + grid) is **view configuration**, not document
 * state: a host sets it through the options here or at runtime, and nothing of
 * it can reach a serialized scene.
 */

export interface SceneRendererOptions {
  /** Element Konva mounts into. The editor creates this as a child of its container. */
  container: HTMLDivElement;
  width: number;
  height: number;
  /** Page background painted under the grid; also the PNG export background. Defaults to {@link DEFAULT_BACKGROUND}. */
  background?: string;
  /** Grid look; unspecified fields keep {@link DEFAULT_GRID}. Pass `{ visible: false }` for an ungridded page. */
  grid?: Partial<GridAppearance>;
}

export interface ExportOptions {
  pixelRatio?: number;
  /** Viewport to render the snapshot with. Defaults to the current camera. */
  viewport?: Viewport;
  /** Padding around the content when auto-fitting, in screen pixels. */
  padding?: number;
}

const GRID_TARGET_MIN = 24;
const GRID_TARGET_MAX = 96;

export class SceneRenderer {
  public readonly stage: Konva.Stage;

  private readonly gridLayer: Konva.Layer;
  private readonly contentLayer: Konva.Layer;
  private readonly overlayLayer: Konva.Layer;
  private readonly background: Konva.Rect;
  private readonly gridShape: Konva.Shape;
  private readonly nodes = new Map<Id, Konva.Shape>();

  private backgroundFill: string;
  private grid: GridAppearance;
  private scene: Scene | null = null;
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  /**
   * The camera an in-flight export is drawn with, while it is in flight. The
   * grid is world-anchored, so the snapshot must draw it for the camera the
   * export uses — not for whichever camera happens to be live.
   */
  private exportViewport: Viewport | null = null;
  private orderKey = '';
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor(options: SceneRendererOptions) {
    this.backgroundFill = options.background ?? DEFAULT_BACKGROUND;
    this.grid = resolveGrid(options.grid);

    this.stage = new Konva.Stage({
      container: options.container,
      width: options.width,
      height: options.height,
    });

    this.gridLayer = new Konva.Layer({ listening: false });
    this.contentLayer = new Konva.Layer();
    this.overlayLayer = new Konva.Layer();

    this.background = new Konva.Rect({
      x: 0,
      y: 0,
      width: options.width,
      height: options.height,
      fill: this.backgroundFill,
      listening: false,
      perfectDrawEnabled: false,
    });

    this.gridShape = new Konva.Shape({
      x: 0,
      y: 0,
      width: options.width,
      height: options.height,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (context, shape) => this.drawGrid(context, shape),
    });

    this.gridLayer.add(this.background, this.gridShape);
    this.stage.add(this.gridLayer, this.contentLayer, this.overlayLayer);
  }

  /** Subscribe to a store and render it. Returns an unsubscribe function. */
  attach(store: SceneStore): () => void {
    this.detach();
    this.unsubscribe = store.subscribe((event) => this.sync(event.scene));
    this.sync(store.getState());
    return () => this.detach();
  }

  private detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  getScene(): Scene | null {
    return this.scene;
  }

  getContentLayer(): Konva.Layer {
    return this.contentLayer;
  }

  getOverlayLayer(): Konva.Layer {
    return this.overlayLayer;
  }

  getGridLayer(): Konva.Layer {
    return this.gridLayer;
  }

  getNode(id: Id): Konva.Shape | undefined {
    return this.nodes.get(id);
  }

  getSize(): { width: number; height: number } {
    return { width: this.stage.width(), height: this.stage.height() };
  }

  /** The scale scene content is actually rendered at, read back through Konva's transform chain. */
  getRenderedScale(): number {
    return this.contentLayer.getAbsoluteScale().x;
  }

  /** The on-screen size of an object's rendered node, in CSS pixels. */
  getRenderedSize(id: Id): { width: number; height: number } | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    const rect = node.getClientRect({ skipStroke: false });
    return { width: rect.width, height: rect.height };
  }

  getStagePosition(): { x: number; y: number } {
    return this.stage.position();
  }

  resize(width: number, height: number): void {
    this.stage.width(width);
    this.stage.height(height);
    this.background.width(width);
    this.background.height(height);
    this.gridShape.width(width);
    this.gridShape.height(height);
    this.batchDraw();
  }

  /**
   * Reconcile the stage with the scene. This is the only entry point that
   * touches nodes, and it is driven purely by store subscriptions.
   */
  sync(scene: Scene): void {
    if (this.destroyed) return;
    this.scene = scene;

    const seen = new Set<Id>();
    for (const id of scene.order) {
      const object = scene.objects[id];
      if (!object) continue;
      seen.add(id);
      const existing = this.nodes.get(id);
      if (existing) {
        updateObjectNode(existing, object);
      } else {
        const node = createObjectNode(object);
        this.nodes.set(id, node);
        this.contentLayer.add(node);
      }
    }

    for (const [id, node] of Array.from(this.nodes.entries())) {
      if (!seen.has(id)) {
        node.destroy();
        this.nodes.delete(id);
      }
    }

    const orderKey = scene.order.join('|');
    if (orderKey !== this.orderKey) {
      this.orderKey = orderKey;
      scene.order.forEach((id, index) => {
        const node = this.nodes.get(id);
        if (node) node.zIndex(index);
      });
    }
  }

  /**
   * Apply the camera.
   *
   * The *content layer* is transformed, not the stage root. That keeps the
   * overlay layer in screen space, which matters for two reasons: Konva's
   * `Transformer` sizes its anchors in screen pixels and assumes an unscaled
   * parent, and transient UI (marquee, previews, handles) should not get thicker
   * as you zoom in.
   */
  applyViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.contentLayer.scale({ x: viewport.scale, y: viewport.scale });
    this.contentLayer.position({ x: -viewport.x * viewport.scale, y: -viewport.y * viewport.scale });
    this.batchDraw();
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  // --------------------------------------------------------------- appearance

  /** The page background — the colour painted under everything, including the PNG export. */
  getBackground(): string {
    return this.backgroundFill;
  }

  /** The grid exactly as it is configured right now. */
  getGrid(): Readonly<GridAppearance> {
    return this.grid;
  }

  /**
   * Repaint the page in another colour.
   *
   * View configuration, not document state: nothing here can reach a serialized
   * scene. An unusable value keeps the current colour rather than throwing — a
   * page must not fail because a theming string was wrong.
   */
  setBackground(color: string): void {
    if (!isUsableColor(color) || color === this.backgroundFill) return;
    this.backgroundFill = color;
    this.background.fill(color);
    this.batchDraw();
  }

  /**
   * Restyle the grid, or switch it off (`{ visible: false }`).
   *
   * Merges over the current configuration, so a host that only wants a white
   * board's faint grey lines passes `{ color }` and nothing else. Redraws the
   * page layer; PNG export follows, because it paints this same layer.
   */
  setGrid(partial: Partial<GridAppearance>): void {
    const next = resolveGrid(partial, this.grid);
    if (
      next.visible === this.grid.visible &&
      next.color === this.grid.color &&
      next.majorColor === this.grid.majorColor &&
      next.spacing === this.grid.spacing
    ) {
      return;
    }
    this.grid = next;
    this.batchDraw();
  }

  batchDraw(): void {
    if (this.destroyed) return;
    this.gridLayer.batchDraw();
    this.contentLayer.batchDraw();
    this.overlayLayer.batchDraw();
  }

  /**
   * Render a clean snapshot: no selection handles, no marquee, no preview
   * shapes. Used by "export PNG"; the overlay layer is the only thing hidden,
   * which is exactly why every transient UI lives there.
   */
  exportDataURL(options: ExportOptions = {}): string {
    const previousScale = this.contentLayer.scale();
    const previousPosition = this.contentLayer.position();
    const previousOverlay = this.overlayLayer.visible();

    try {
      if (options.viewport) {
        this.contentLayer.scale({ x: options.viewport.scale, y: options.viewport.scale });
        this.contentLayer.position({
          x: -options.viewport.x * options.viewport.scale,
          y: -options.viewport.y * options.viewport.scale,
        });
      }
      // The grid follows the camera the snapshot borrows, so the exported grid
      // shows the spacing that camera would draw on screen. The background and
      // grid *configuration* is shared by definition — it is this same page layer.
      this.exportViewport = options.viewport ?? { ...this.viewport };
      this.overlayLayer.visible(false);
      this.stage.draw();
      return this.stage.toDataURL({
        pixelRatio: options.pixelRatio ?? 2,
        mimeType: 'image/png',
      });
    } finally {
      // The camera is document state, so the snapshot borrows the transform and
      // puts it back exactly as it was. `this.viewport` is never touched.
      this.exportViewport = null;
      this.overlayLayer.visible(previousOverlay);
      this.contentLayer.scale(previousScale);
      this.contentLayer.position(previousPosition);
      this.batchDraw();
    }
  }

  /** Fit a viewport that frames all content, or `null` when the scene is empty. */
  fitViewport(padding = 64): Viewport | null {
    if (!this.scene) return null;
    const bounds = contentBounds(this.scene);
    if (!bounds) return null;
    const size = this.getSize();
    const scale = Math.min(
      (size.width - padding * 2) / Math.max(1, bounds.width),
      (size.height - padding * 2) / Math.max(1, bounds.height),
      4,
    );
    const clamped = Math.max(0.05, Math.min(8, scale));
    return {
      scale: clamped,
      x: bounds.x + bounds.width / 2 - size.width / (2 * clamped),
      y: bounds.y + bounds.height / 2 - size.height / (2 * clamped),
    };
  }

  destroy(): void {
    this.detach();
    this.nodes.clear();
    this.destroyed = true;
    this.stage.destroy();
  }

  /** Screen (container-relative) point for a world point, using the live stage transform. */
  screenPoint(world: { x: number; y: number }): { x: number; y: number } {
    return worldToScreen(this.viewport, world);
  }

  private drawGrid(context: Konva.Context, shape: Konva.Shape): void {
    if (!this.grid.visible) return;
    const viewport = this.exportViewport ?? this.viewport;
    const width = shape.width();
    const height = shape.height();
    const { scale } = viewport;
    if (width <= 0 || height <= 0 || !Number.isFinite(scale) || scale <= 0) return;

    let step = this.grid.spacing;
    if (step * scale < GRID_TARGET_MIN) {
      step *= 2 ** Math.ceil(Math.log2(GRID_TARGET_MIN / (step * scale)));
    } else if (step * scale > GRID_TARGET_MAX) {
      step /= 2 ** Math.max(0, Math.floor(Math.log2((step * scale) / GRID_TARGET_MAX)));
    }
    if (!Number.isFinite(step) || step <= 0) return;

    const worldLeft = viewport.x;
    const worldTop = viewport.y;
    const worldRight = worldLeft + width / scale;
    const worldBottom = worldTop + height / scale;

    const startX = Math.floor(worldLeft / step) * step;
    const startY = Math.floor(worldTop / step) * step;

    context.save();
    context.setLineDash([]);
    context.lineWidth = 1;
    context.strokeStyle = this.grid.color;
    context.beginPath();
    for (let x = startX; x <= worldRight; x += step) {
      const sx = Math.round((x - worldLeft) * scale) + 0.5;
      context.moveTo(sx, 0);
      context.lineTo(sx, height);
    }
    for (let y = startY; y <= worldBottom; y += step) {
      const sy = Math.round((y - worldTop) * scale) + 0.5;
      context.moveTo(0, sy);
      context.lineTo(width, sy);
    }
    context.stroke();

    // Every fifth line is brighter, which makes panning legible without a
    // separate "major grid" node.
    const major = step * 5;
    const majorStartX = Math.floor(worldLeft / major) * major;
    const majorStartY = Math.floor(worldTop / major) * major;
    context.strokeStyle = this.grid.majorColor;
    context.beginPath();
    for (let x = majorStartX; x <= worldRight; x += major) {
      const sx = Math.round((x - worldLeft) * scale) + 0.5;
      context.moveTo(sx, 0);
      context.lineTo(sx, height);
    }
    for (let y = majorStartY; y <= worldBottom; y += major) {
      const sy = Math.round((y - worldTop) * scale) + 0.5;
      context.moveTo(0, sy);
      context.lineTo(width, sy);
    }
    context.stroke();
    context.restore();
  }
}

/** A colour a page can be painted in; anything else keeps the current one. */
function isUsableColor(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
