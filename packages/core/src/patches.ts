import type { JSONPatchOp } from './jsonpatch.js';
import { newId } from './ids.js';
import {
  defaultData,
  SCENE_FORMAT,
  SCENE_VERSION,
  type Id,
  type ObjectDataMap,
  type ObjectType,
  type Scene,
  type SceneObject,
} from './types.js';

/**
 * Scene-level patch builders.
 *
 * Tools and applications should not hand-write JSON pointers. These helpers are
 * the vocabulary of the command protocol: create, delete, update, reorder. They
 * only *build* patches — applying them is the store's job, which keeps the
 * renderer and the tools incapable of mutating the scene by accident.
 */

export interface CreateObjectInput<T extends ObjectType> {
  type: T;
  id?: Id;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: Partial<ObjectDataMap[T]>;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  visible?: boolean;
  locked?: boolean;
  parentId?: Id | null;
  meta?: Record<string, unknown>;
}

/** Build a fully-formed object with defaults filled in. */
export function makeObject<T extends ObjectType>(input: CreateObjectInput<T>): SceneObject {
  const base: SceneObject = {
    id: input.id ?? newId('obj'),
    type: input.type,
    version: SCENE_VERSION,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: input.rotation ?? 0,
    scaleX: input.scaleX ?? 1,
    scaleY: input.scaleY ?? 1,
    z: 0,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    data: { ...defaultData(input.type), ...(input.data ?? {}) } as SceneObject['data'],
  };
  if (input.parentId !== undefined) base.parentId = input.parentId;
  if (input.meta !== undefined) base.meta = input.meta;
  return base;
}

export type ObjectPropPatch = Partial<
  Pick<SceneObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scaleX' | 'scaleY' | 'visible' | 'locked' | 'meta'>
>;

/** `/objects/<id>/x` etc. */
export function objectPath(id: Id, ...tokens: (string | number)[]): string {
  return `/objects/${id}${tokens.map((t) => `/${String(t)}`).join('')}`;
}

/** Insert an object at the end of the paint order: one `add` plus one append. */
export function addObjectOps(object: SceneObject): JSONPatchOp[] {
  return [
    { op: 'add', path: `/objects/${object.id}`, value: object },
    { op: 'add', path: '/order/-', value: object.id },
  ];
}

/** Delete an object and its order entry. */
export function removeObjectOps(scene: Scene, id: Id): JSONPatchOp[] {
  const index = scene.order.indexOf(id);
  const ops: JSONPatchOp[] = [{ op: 'remove', path: `/objects/${id}` }];
  if (index >= 0) ops.push({ op: 'remove', path: `/order/${index}` });
  return ops;
}

/** Update scalar properties of one object. `data` is patched per sub-key. */
export function updateObjectOps(id: Id, props: ObjectPropPatch): JSONPatchOp[] {
  const ops: JSONPatchOp[] = [];
  for (const [key, value] of Object.entries(props)) {
    ops.push({ op: 'replace', path: `${objectPath(id)}/${key}`, value });
  }
  return ops;
}

/** Patch individual keys of `object.data`, leaving the rest untouched. */
export function updateObjectDataOps<T extends ObjectType>(
  id: Id,
  data: Partial<ObjectDataMap[T]>,
): JSONPatchOp[] {
  return Object.entries(data).map(([key, value]) => ({
    op: 'replace' as const,
    path: `${objectPath(id, 'data')}/${key}`,
    value,
  }));
}

export type ReorderTarget = 'front' | 'forward' | 'backward' | 'back';

/**
 * Reorder one object within `scene.order`.
 *
 * Moving is expressed as a remove + insert. The insert index is computed after
 * the removal, which is exactly the off-by-one that silently scrambles z-order
 * in most hand-rolled implementations.
 */
export function reorderObjectOps(scene: Scene, id: Id, target: ReorderTarget): JSONPatchOp[] {
  const from = scene.order.indexOf(id);
  if (from < 0) return [];
  const last = scene.order.length - 1;

  let to: number;
  switch (target) {
    case 'front':
      to = last;
      break;
    case 'back':
      to = 0;
      break;
    case 'forward':
      to = Math.min(last, from + 1);
      break;
    case 'backward':
      to = Math.max(0, from - 1);
      break;
  }
  if (to === from) return [];

  const without = scene.order.filter((entry) => entry !== id);
  return [
    { op: 'remove', path: `/order/${from}` },
    { op: 'add', path: `/order/${to}`, value: id },
    ...renumberZOps(without, id, to),
  ];
}

/**
 * `z` is a denormalised mirror of the order array, kept because it makes scene
 * dumps readable and gives plugins a cheap sort key.
 */
function renumberZOps(orderWithout: readonly Id[], id: Id, index: number): JSONPatchOp[] {
  const next = [...orderWithout.slice(0, index), id, ...orderWithout.slice(index)];
  return next.map((entry, position) => ({
    op: 'replace' as const,
    path: `${objectPath(entry)}/z`,
    value: position,
  }));
}

/** Build a scene literal from objects — handy in tests and importers. */
export function sceneFromObjects(objects: readonly SceneObject[]): Scene {
  const map: Record<Id, SceneObject> = {};
  const order: Id[] = [];
  objects.forEach((object, index) => {
    map[object.id] = { ...object, z: index };
    order.push(object.id);
  });
  return { format: SCENE_FORMAT, version: SCENE_VERSION, objects: map, order };
}
