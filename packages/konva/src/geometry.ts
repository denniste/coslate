import {
  boundsIntersect,
  isObjectOfType,
  objectBounds,
  type Bounds,
  type Point,
  type Scene,
  type SceneObject,
} from '@coslate/core';

/**
 * Pure geometry helpers: the scene's transform, hit testing and marquee math.
 *
 * Deliberately free of any Konva import. Hit testing is a property of the *scene
 * model*, not of the renderer — the renderer is one possible projection of the
 * scene, and a hit test that depended on canvas hit-graphs would break the
 * moment a second renderer (SVG, server-side raster, headless test) appeared.
 */

/**
 * Local -> world.
 *
 *     world = R(rotation) * S(scale) * local + (x, y)
 *
 * Rotation is around the object's top-left corner, matching both the scene
 * contract and Konva's node origin, which keeps renderer and model in lockstep.
 */
export function localToWorld(
  object: Pick<SceneObject, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>,
  local: Point,
): Point {
  const radians = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = local.x * object.scaleX;
  const sy = local.y * object.scaleY;
  return {
    x: object.x + sx * cos - sy * sin,
    y: object.y + sx * sin + sy * cos,
  };
}

/** World -> local (the inverse of {@link localToWorld}). */
export function worldToLocal(
  object: Pick<SceneObject, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>,
  world: Point,
): Point {
  const radians = (-object.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = world.x - object.x;
  const dy = world.y - object.y;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: object.scaleX === 0 ? 0 : rx / object.scaleX,
    y: object.scaleY === 0 ? 0 : ry / object.scaleY,
  };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polylineHit(points: readonly number[], local: Point, tolerance: number): boolean {
  if (points.length < 4) {
    const x = points[0] ?? 0;
    const y = points[1] ?? 0;
    return Math.hypot(local.x - x, local.y - y) <= tolerance;
  }
  for (let i = 0; i + 3 < points.length; i += 2) {
    const a = { x: points[i] ?? 0, y: points[i + 1] ?? 0 };
    const b = { x: points[i + 2] ?? 0, y: points[i + 3] ?? 0 };
    if (distanceToSegment(local, a, b) <= tolerance) return true;
  }
  return false;
}

export interface HitOptions {
  /** Extra world-space slack, so thin strokes stay clickable when zoomed out. */
  tolerance?: number;
  /** Include objects flagged `locked`. Defaults to `false`. */
  includeLocked?: boolean;
}

/** Is `world` inside this object? Boxes are hit anywhere inside, not just on the stroke. */
export function hitTestObject(object: SceneObject, world: Point, options: HitOptions = {}): boolean {
  if (!object.visible) return false;
  if (object.locked && !options.includeLocked) return false;
  const tolerance = options.tolerance ?? 4;
  const local = worldToLocal(object, world);

  // Polyline-ish objects are hit near their path; everything else is a box, and
  // an unfilled box is still clickable anywhere inside it (what users expect).
  if (isObjectOfType(object, 'freehand.stroke')) {
    return polylineHit(object.data.points, local, tolerance + object.data.strokeWidth / 2);
  }
  if (isObjectOfType(object, 'shape.line')) {
    return polylineHit(object.data.points, local, tolerance + object.data.strokeWidth / 2);
  }
  if (isObjectOfType(object, 'shape.arrow')) {
    return polylineHit(object.data.points, local, tolerance + object.data.strokeWidth / 2);
  }

  const minX = Math.min(0, object.width) - tolerance;
  const maxX = Math.max(0, object.width) + tolerance;
  const minY = Math.min(0, object.height) - tolerance;
  const maxY = Math.max(0, object.height) + tolerance;
  return local.x >= minX && local.x <= maxX && local.y >= minY && local.y <= maxY;
}

/** Topmost object under a world point, honouring paint order. */
export function hitTest(scene: Scene, world: Point, options: HitOptions = {}): SceneObject | null {
  for (let i = scene.order.length - 1; i >= 0; i -= 1) {
    const id = scene.order[i];
    if (id === undefined) continue;
    const object = scene.objects[id];
    if (object && hitTestObject(object, world, options)) return object;
  }
  return null;
}

/** Every object whose transformed bounds intersect `bounds` (marquee selection). */
export function objectsInBounds(scene: Scene, bounds: Bounds): SceneObject[] {
  const found: SceneObject[] = [];
  for (const id of scene.order) {
    const object = scene.objects[id];
    if (!object || !object.visible || object.locked) continue;
    if (boundsIntersect(objectBounds(object), bounds)) found.push(object);
  }
  return found;
}

/**
 * Re-origin a flat point list so its bounding box starts at (0, 0) in local
 * space. Returns the normalised points plus the world offset they were shifted
 * by, which is what the object's `x` / `y` must become.
 */
export function normalizePoints(points: readonly number[]): { points: number[]; offset: Point; bounds: Bounds } {
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
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const normalized: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    normalized.push((points[i] ?? 0) - minX, (points[i + 1] ?? 0) - minY);
  }
  return {
    points: normalized,
    offset: { x: minX, y: minY },
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

/** Axis-aligned bounds of every visible object, or `null` for an empty scene. */
export function contentBounds(scene: Scene): Bounds | null {
  let result: Bounds | null = null;
  for (const id of scene.order) {
    const object = scene.objects[id];
    if (!object || !object.visible) continue;
    const box = objectBounds(object);
    result = result
      ? {
          x: Math.min(result.x, box.x),
          y: Math.min(result.y, box.y),
          width: Math.max(result.x + result.width, box.x + box.width) - Math.min(result.x, box.x),
          height: Math.max(result.y + result.height, box.y + box.height) - Math.min(result.y, box.y),
        }
      : box;
  }
  return result;
}
