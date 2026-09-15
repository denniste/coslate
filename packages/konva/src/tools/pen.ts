import Konva from 'konva';
import { addObjectOps, makeObject, worldToScreen, type Point } from '@coslate/core';
import { normalizePoints } from '../geometry.js';
import type { PointerInfo, Tool, ToolHost } from './types.js';

/**
 * Pen tool: freehand ink.
 *
 * Points are collected in world space and committed as *semantic data*
 * (`freehand.stroke` with a point list), never as a bitmap. That is what keeps
 * a stroke editable, resizable and serializable — and what will let a future
 * version re-render it through a different renderer without loss.
 *
 * One gesture, one command: the whole stroke lands on pointer-up.
 */

const MIN_POINT_DISTANCE = 1.5;

export class PenTool implements Tool {
  public readonly name = 'pen' as const;
  public readonly cursor = 'crosshair';

  private readonly host: ToolHost;
  private drawing = false;
  private points: number[] = [];
  private preview: Konva.Line | null = null;

  constructor(host: ToolHost) {
    this.host = host;
  }

  deactivate(): void {
    this.cancel();
  }

  onPointerDown(info: PointerInfo): void {
    if (info.button !== 0) return;
    this.drawing = true;
    this.points = [info.world.x, info.world.y];
    this.preview = new Konva.Line({
      points: [],
      stroke: this.host.style.stroke,
      strokeWidth: this.host.style.strokeWidth,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
      perfectDrawEnabled: false,
    });
    this.host.overlay.add(this.preview);
    this.updatePreview();
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.drawing) return;
    const length = this.points.length;
    const lastX = this.points[length - 2] ?? info.world.x;
    const lastY = this.points[length - 1] ?? info.world.y;
    if (Math.hypot(info.world.x - lastX, info.world.y - lastY) < MIN_POINT_DISTANCE) return;
    this.points.push(info.world.x, info.world.y);
    this.updatePreview();
  }

  onPointerUp(info: PointerInfo): void {
    if (!this.drawing) return;
    const worldPoints = this.points.slice();
    const lastX = worldPoints[worldPoints.length - 2];
    const lastY = worldPoints[worldPoints.length - 1];
    if (lastX !== info.world.x || lastY !== info.world.y) worldPoints.push(info.world.x, info.world.y);
    this.cancel();
    if (worldPoints.length < 4) return;

    const { points, bounds } = normalizePoints(worldPoints);
    const object = makeObject({
      type: 'freehand.stroke',
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, 0.5),
      height: Math.max(bounds.height, 0.5),
      data: {
        points,
        stroke: this.host.style.stroke,
        strokeWidth: this.host.style.strokeWidth,
        strokeStyle: this.host.style.strokeStyle,
      },
    });
    this.host.store.commit({
      type: 'object.create',
      patch: addObjectOps(object),
      label: 'Draw',
    });
  }

  private updatePreview(): void {
    if (!this.preview) return;
    const viewport = this.host.getViewport();
    const screenPoints: number[] = [];
    for (let i = 0; i + 1 < this.points.length; i += 2) {
      const screen = worldToScreen(viewport, { x: this.points[i] ?? 0, y: this.points[i + 1] ?? 0 });
      screenPoints.push(screen.x, screen.y);
    }
    this.preview.points(screenPoints);
    // Screen-space overlay: keep the preview the same visual weight at any zoom.
    this.preview.strokeWidth(this.host.style.strokeWidth);
    this.host.requestDraw();
  }

  private cancel(): void {
    this.drawing = false;
    this.points = [];
    if (this.preview) {
      this.preview.destroy();
      this.preview = null;
      this.host.requestDraw();
    }
  }
}

/** Shared helper: convert a world point to overlay (screen) coordinates. */
export function toScreen(host: ToolHost, point: Point): Point {
  return worldToScreen(host.getViewport(), point);
}
