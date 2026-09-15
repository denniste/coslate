import type { Bounds, Point, Size, Viewport } from './types.js';

/**
 * Viewport math. Pure functions, no DOM, no renderer, fully unit-testable.
 *
 * Convention (the single most important line in this file):
 *
 *     screen = (world - viewport.xy) * viewport.scale
 *
 * `viewport.x` / `viewport.y` are the *world* coordinates sitting at the
 * viewport's top-left corner, and `scale` is screen pixels per world unit.
 */

/** The camera a fresh editor starts from: origin, 100%. */
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export interface ScaleLimits {
  min?: number;
  max?: number;
}

/** Clamp a zoom factor into the supported range. */
export function clampScale(scale: number, limits: ScaleLimits = {}): number {
  const min = limits.min ?? MIN_SCALE;
  const max = limits.max ?? MAX_SCALE;
  if (!Number.isFinite(scale) || scale <= 0) return min;
  return Math.min(max, Math.max(min, scale));
}

/**
 * Mouse-wheel zoom, as a multiplicative factor for {@link zoomAt}.
 *
 * Browsers disagree about wheel units, so the first thing the factor does is
 * normalize `WheelEvent.deltaMode` into pixels: line-based deltas (Firefox
 * wheels) are multiplied to a pixel estimate, page-based deltas to a viewport
 * estimate. On top of normalized pixels the zoom is exponential, which keeps
 * trackpad gestures (many small deltas) proportional and makes a hardware
 * notch — ~100 px on the dominant platforms — land at a predictable step:
 * about **×1.20 plain** and **×1.06 fine** (`ctrl`/`meta`, which is also how
 * a trackpad pinch reports itself).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, fine: boolean): number {
  const pixels =
    deltaMode === DOM_DELTA_LINE
      ? deltaY * WHEEL_PIXELS_PER_LINE
      : deltaMode === DOM_DELTA_PAGE
        ? deltaY * WHEEL_PIXELS_PER_PAGE
        : deltaY;
  return Math.exp(-pixels * (fine ? WHEEL_ZOOM_RATE_FINE : WHEEL_ZOOM_RATE));
}

// WheelEvent.deltaMode values (declared locally so the pure core module needs
// no DOM lib types): 0 = pixels, 1 = lines, 2 = pages.
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_PIXELS_PER_LINE = 16;
const WHEEL_PIXELS_PER_PAGE = 100;
const WHEEL_ZOOM_RATE = 0.0018;
const WHEEL_ZOOM_RATE_FINE = 0.0006;

export function worldToScreen(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.x) * viewport.scale,
    y: (point.y - viewport.y) * viewport.scale,
  };
}

export function screenToWorld(viewport: Viewport, point: Point): Point {
  return {
    x: point.x / viewport.scale + viewport.x,
    y: point.y / viewport.scale + viewport.y,
  };
}

/**
 * Zoom by a *multiplicative* factor (1.1 = 10% closer) while keeping the world
 * point currently under `screenPoint` pinned to that same screen position.
 *
 * That invariance is the property the unit tests assert: the camera may move,
 * but the pixel under the cursor must not.
 */
export function zoomAt(viewport: Viewport, screenPoint: Point, delta: number, limits: ScaleLimits = {}): Viewport {
  const nextScale = clampScale(viewport.scale * delta, limits);
  return zoomTo(viewport, screenPoint, nextScale);
}

/** Set an absolute scale while pinning `screenPoint`. */
export function zoomTo(viewport: Viewport, screenPoint: Point, nextScale: number, limits: ScaleLimits = {}): Viewport {
  const scale = clampScale(nextScale, limits);
  const world = screenToWorld(viewport, screenPoint);
  return {
    scale,
    x: world.x - screenPoint.x / scale,
    y: world.y - screenPoint.y / scale,
  };
}

/** Pan by a screen-space delta (drag gesture). */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return {
    scale: viewport.scale,
    x: viewport.x - dxScreen / viewport.scale,
    y: viewport.y - dyScreen / viewport.scale,
  };
}

/** Pan by a *world*-space delta (arrow keys, programmatic scroll). */
export function panByWorld(viewport: Viewport, dxWorld: number, dyWorld: number): Viewport {
  return { scale: viewport.scale, x: viewport.x + dxWorld, y: viewport.y + dyWorld };
}

export function boundsCenter(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function boundsOfPoints(points: readonly number[]): Bounds {
  if (points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

/**
 * Fit `bounds` into a viewport of `size`, leaving `padding` screen pixels of
 * margin. Zero-area content (a single dot, an empty scene) is handled without
 * dividing by zero.
 */
export function fitToContent(
  bounds: Bounds | null,
  size: Size,
  padding = 48,
  limits: ScaleLimits = {},
): Viewport {
  const available: Size = {
    width: Math.max(1, size.width - padding * 2),
    height: Math.max(1, size.height - padding * 2),
  };

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    const scale = clampScale(1, limits);
    const center = bounds ? boundsCenter(bounds) : { x: 0, y: 0 };
    return {
      scale,
      x: center.x - size.width / (2 * scale),
      y: center.y - size.height / (2 * scale),
    };
  }

  const scale = clampScale(Math.min(available.width / bounds.width, available.height / bounds.height), limits);
  const center = boundsCenter(bounds);
  return {
    scale,
    x: center.x - size.width / (2 * scale),
    y: center.y - size.height / (2 * scale),
  };
}

/** Screen-space rect expressed as world bounds — used by the marquee tool. */
export function screenRectToWorldBounds(viewport: Viewport, a: Point, b: Point): Bounds {
  const p1 = screenToWorld(viewport, a);
  const p2 = screenToWorld(viewport, b);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

/**
 * Axis-aligned bounds of a transformed object. Rotation is handled by rotating
 * the four corners, so selection and fit stay correct for rotated shapes.
 */
export function objectBounds(object: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}): Bounds {
  const w = object.width * object.scaleX;
  const h = object.height * object.scaleY;
  if (object.rotation === 0) return { x: object.x, y: object.y, width: Math.abs(w), height: Math.abs(h) };
  const radians = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((corner) => ({
    x: object.x + corner.x * cos - corner.y * sin,
    y: object.y + corner.x * sin + corner.y * cos,
  }));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
