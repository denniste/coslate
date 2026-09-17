import {
  isObjectOfType,
  objectPath,
  updateObjectDataOps,
  type EndpointBinding,
  type Id,
  type JSONPatchOp,
  type Point,
  type Scene,
  type SceneObject,
  type SceneObjectOf,
} from '@coslate/core';
import { localToWorld, worldToLocal } from './geometry.js';

/**
 * Connector endpoint binding — the flowchart/sequence-diagram foundation (R14).
 *
 * A line or arrow end may be *bound* to another object: the binding is optional
 * metadata on `LineData` (`start` / `end`), the anchor normalized 0..1 on the
 * bound object's untransformed box. The stored `points` remain the single
 * source of truth for render, export, read-only projection and sync — every
 * helper here only *derives* fresh points or binding-field patches, and the
 * editing host dispatches them inside the same transaction as the gesture that
 * moved the bound object. A consumer that knows nothing about bindings renders
 * and round-trips a bound connector correctly.
 *
 * Deliberately free of any Konva import, like `geometry.ts`: the math is a
 * property of the scene model, so headless tests exercise exactly what the
 * editor dispatches.
 */

/** Creation snap distance, in world units, for binding a freshly drawn end. */
export const BIND_THRESHOLD_PX = 8;

/** Only box-shaped objects accept bindings. Lines, arrows and ink never do. */
export const BINDABLE_TYPES: readonly SceneObject['type'][] = ['shape.rect', 'shape.ellipse', 'shape.text'];

function isBindable(object: SceneObject): boolean {
  return object.visible && (BINDABLE_TYPES as readonly string[]).includes(object.type);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The world position of a bound anchor on `object`: the anchor is normalized
 * on the *untransformed* box, so scale and rotation apply on top of it.
 */
export function resolveAnchorWorld(
  object: Pick<SceneObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scaleX' | 'scaleY'>,
  anchor: Pick<EndpointBinding, 'x' | 'y'>,
): Point {
  return localToWorld(object, { x: anchor.x * object.width, y: anchor.y * object.height });
}

/**
 * Snap a world point to the perimeter of a bindable object's box. Returns the
 * normalized anchor of the closest perimeter point when the point lies within
 * `thresholdPx` of it, else `null`. Non-bindable or hidden objects never bind.
 */
export function nearestAnchor(
  object: SceneObject,
  world: Point,
  thresholdPx: number = BIND_THRESHOLD_PX,
): EndpointBinding | null {
  if (!isBindable(object)) return null;
  const local = worldToLocal(object, world);
  const cx = clamp(local.x, 0, object.width);
  const cy = clamp(local.y, 0, object.height);
  const snapped = localToWorld(object, { x: cx, y: cy });
  if (Math.hypot(snapped.x - world.x, snapped.y - world.y) > thresholdPx) return null;
  return {
    id: object.id,
    x: object.width === 0 ? 0 : cx / object.width,
    y: object.height === 0 ? 0 : cy / object.height,
  };
}

function isConnector(
  object: SceneObject,
): object is SceneObjectOf<'shape.line'> | SceneObjectOf<'shape.arrow'> {
  return isObjectOfType(object, 'shape.line') || isObjectOfType(object, 'shape.arrow');
}

/**
 * Patch ops that re-derive the endpoints of every line/arrow bound to one of
 * `changedIds`, computed against the *current* scene — dispatch the bound
 * objects' own updates first, then these, inside one transaction. Both ends of
 * a multi-point line collapse into a single `points` patch; a binding whose
 * target is missing from the scene is inert (the stored points stand); a
 * connector whose binding references a changed object only through itself is
 * untouched.
 */
export function boundArrowOps(scene: Scene, changedIds: readonly Id[]): JSONPatchOp[] {
  const changed = new Set(changedIds);
  const ops: JSONPatchOp[] = [];
  for (const id of scene.order) {
    const object = scene.objects[id];
    if (!object || !isConnector(object)) continue;
    const points = object.data.points;
    let next: number[] | null = null;
    const rebind = (binding: EndpointBinding | undefined, atStart: boolean): void => {
      if (!binding || !changed.has(binding.id)) return;
      const target = scene.objects[binding.id];
      if (!target) return;
      const local = worldToLocal(object, resolveAnchorWorld(target, binding));
      const patch = next ? [...next] : [...points];
      if (atStart) {
        if (patch.length < 2) return;
        patch[0] = local.x;
        patch[1] = local.y;
      } else {
        if (patch.length < 2) return;
        patch[patch.length - 2] = local.x;
        patch[patch.length - 1] = local.y;
      }
      next = patch;
    };
    rebind(object.data.start, true);
    rebind(object.data.end, false);
    if (next) ops.push(...updateObjectDataOps(object.id, { points: next }));
  }
  return ops;
}

/**
 * Patch ops stripping the `start` / `end` bindings that point at any of
 * `deletedIds`, for connectors surviving the delete. Removing a field inverts
 * to an `add` of the prior value, so undoing the delete restores the binding
 * for free. Connectors inside `deletedIds` itself need no strip — they leave
 * with their target.
 */
export function stripBindingOps(scene: Scene, deletedIds: readonly Id[]): JSONPatchOp[] {
  const deleted = new Set(deletedIds);
  const ops: JSONPatchOp[] = [];
  for (const id of scene.order) {
    const object = scene.objects[id];
    if (!object || deleted.has(id) || !isConnector(object)) continue;
    const { start, end } = object.data;
    if (start && deleted.has(start.id)) {
      ops.push({ op: 'remove', path: objectPath(object.id, 'data', 'start') });
    }
    if (end && deleted.has(end.id)) {
      ops.push({ op: 'remove', path: objectPath(object.id, 'data', 'end') });
    }
  }
  return ops;
}
