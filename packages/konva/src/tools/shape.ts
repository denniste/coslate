import Konva from 'konva';
import {
  addObjectOps,
  makeObject,
  worldToScreen,
  type ObjectType,
  type Point,
} from '@coslate/core';
import { normalizePoints } from '../geometry.js';
import type { PointerInfo, Tool, ToolHost, ToolName } from './types.js';

/**
 * Rect / ellipse / line / arrow: press, drag, release.
 *
 * Same contract as the pen — the shape exists in the document only once, on
 * pointer-up, as a single create command. Everything before that is a preview
 * node on the overlay layer.
 */

export type ShapeKind = Extract<ObjectType, 'shape.rect' | 'shape.ellipse' | 'shape.line' | 'shape.arrow'>;

const KIND_TO_TOOL: Record<ShapeKind, ToolName> = {
  'shape.rect': 'rect',
  'shape.ellipse': 'ellipse',
  'shape.line': 'line',
  'shape.arrow': 'arrow',
};

const LABELS: Record<ShapeKind, string> = {
  'shape.rect': 'Rectangle',
  'shape.ellipse': 'Ellipse',
  'shape.line': 'Line',
  'shape.arrow': 'Arrow',
};

export class ShapeTool implements Tool {
  public readonly name: ToolName;
  public readonly cursor = 'crosshair';

  private readonly host: ToolHost;
  private readonly kind: ShapeKind;
  private startWorld: Point | null = null;
  private preview: Konva.Shape | null = null;

  constructor(host: ToolHost, kind: ShapeKind) {
    this.host = host;
    this.kind = kind;
    this.name = KIND_TO_TOOL[kind];
  }

  deactivate(): void {
    this.cancel();
  }

  onPointerDown(info: PointerInfo): void {
    if (info.button !== 0) return;
    this.startWorld = info.world;
    this.preview = this.createPreview();
    this.host.overlay.add(this.preview);
    this.updatePreview(info);
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.startWorld) return;
    this.updatePreview(info);
  }

  onPointerUp(info: PointerInfo): void {
    const start = this.startWorld;
    if (!start) return;
    const end = this.constrain(start, info.world, info.shiftKey);
    this.cancel();

    const viewport = this.host.getViewport();
    const minWorld = 2 / viewport.scale;
    const style = this.host.style;

    if (this.kind === 'shape.rect' || this.kind === 'shape.ellipse') {
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width < minWorld || height < minWorld) return;
      const object = makeObject({
        type: this.kind,
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width,
        height,
        data: { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth },
      });
      this.host.store.commit({ type: 'object.create', patch: addObjectOps(object), label: LABELS[this.kind] });
      return;
    }

    if (Math.hypot(end.x - start.x, end.y - start.y) < minWorld) return;
    const { points, bounds } = normalizePoints([start.x, start.y, end.x, end.y]);
    const object = makeObject({
      type: this.kind,
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, 0.5),
      height: Math.max(bounds.height, 0.5),
      data: { points, stroke: style.stroke, strokeWidth: style.strokeWidth },
    });
    this.host.store.commit({ type: 'object.create', patch: addObjectOps(object), label: LABELS[this.kind] });
  }

  /** Shift constrains a box to a square/circle, or a line to 45-degree steps. */
  private constrain(start: Point, end: Point, shiftKey: boolean): Point {
    if (!shiftKey) return end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (this.kind === 'shape.rect' || this.kind === 'shape.ellipse') {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: start.x + Math.sign(dx || 1) * size, y: start.y + Math.sign(dy || 1) * size };
    }
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
  }

  private createPreview(): Konva.Shape {
    const style = this.host.style;
    const strokeWidth = style.strokeWidth * this.host.getViewport().scale;
    const common = {
      stroke: style.stroke,
      strokeWidth,
      listening: false,
      perfectDrawEnabled: false,
    } as const;

    if (this.kind === 'shape.rect') {
      return new Konva.Rect({
        ...common,
        fill: style.fill ?? undefined,
        fillEnabled: style.fill !== null,
        dash: [6, 4],
      });
    }
    if (this.kind === 'shape.ellipse') {
      return new Konva.Shape({
        ...common,
        dash: [6, 4],
        fillEnabled: style.fill !== null,
        fill: style.fill ?? undefined,
        sceneFunc: (context, shape) => {
          const width = Math.abs(shape.width());
          const height = Math.abs(shape.height());
          context.beginPath();
          context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2, false);
          context.closePath();
          context.fillStrokeShape(shape);
        },
      });
    }
    if (this.kind === 'shape.arrow') {
      return new Konva.Arrow({
        ...common,
        points: [0, 0, 0, 0],
        pointerLength: 12 * this.host.getViewport().scale,
        pointerWidth: 10 * this.host.getViewport().scale,
        fill: style.stroke,
      });
    }
    return new Konva.Line({ ...common, points: [0, 0, 0, 0], lineCap: 'round', lineJoin: 'round' });
  }

  private updatePreview(info: PointerInfo): void {
    const start = this.startWorld;
    const preview = this.preview;
    if (!start || !preview) return;
    const end = this.constrain(start, info.world, info.shiftKey);
    const viewport = this.host.getViewport();
    const a = worldToScreen(viewport, start);
    const b = worldToScreen(viewport, end);

    if (this.kind === 'shape.rect' || this.kind === 'shape.ellipse') {
      preview.setAttrs({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      });
    } else {
      (preview as Konva.Line | Konva.Arrow).points([a.x, a.y, b.x, b.y]);
    }
    this.host.requestDraw();
  }

  private cancel(): void {
    this.startWorld = null;
    if (this.preview) {
      this.preview.destroy();
      this.preview = null;
      this.host.requestDraw();
    }
  }
}
