import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  createStore,
  deserialize,
  makeObject,
  removeObjectOps,
  sceneFromObjects,
  serialize,
  updateObjectOps,
  type Id,
  type Scene,
} from '@coslate/core';
import {
  BIND_THRESHOLD_PX,
  boundArrowOps,
  nearestAnchor,
  resolveAnchorWorld,
  snapEndpoint,
  stripBindingOps,
} from '../../packages/konva/src/binding';

/**
 * Endpoint binding is scene-model geometry: anchors, snapping and the patch
 * derivation are all pure, so the whole R14 contract is unit tested without a
 * canvas. The stored `points` stay authoritative — these tests assert the
 * derived patches, and the store suite asserts one-undo-step behaviour.
 */

function rect(id: string, x: number, y: number, width = 100, height = 50) {
  return makeObject({ type: 'shape.rect', id, x, y, width, height });
}

interface ArrowSpec {
  id: string;
  x: number;
  y: number;
  points: number[];
  start?: { id: Id; x: number; y: number };
  end?: { id: Id; x: number; y: number };
}

function arrow({ id, x, y, points, start, end }: ArrowSpec) {
  return makeObject({
    type: 'shape.arrow',
    id,
    x,
    y,
    width: 100,
    height: 50,
    data: { points, ...(start ? { start } : {}), ...(end ? { end } : {}) },
  });
}

/** The canonical scene: a rect with an arrow glued to its right-edge midpoint. */
function boundScene(): { scene: Scene; rectId: Id; arrowId: Id } {
  const r = rect('rect_1', 100, 100);
  const a = arrow({
    id: 'arrow_1',
    x: 200,
    y: 125,
    points: [0, 0, 100, 25],
    start: { id: 'rect_1', x: 1, y: 0.5 },
  });
  return { scene: sceneFromObjects([r, a]), rectId: 'rect_1', arrowId: 'arrow_1' };
}

describe('binding: resolveAnchorWorld', () => {
  it('translates', () => {
    const box = { x: 10, y: 20, width: 100, height: 50, rotation: 0, scaleX: 1, scaleY: 1 };
    expect(resolveAnchorWorld(box, { x: 1, y: 0.5 })).toEqual({ x: 110, y: 45 });
  });

  it('rotates 90 degrees around the object origin', () => {
    const box = { x: 0, y: 0, width: 100, height: 50, rotation: 90, scaleX: 1, scaleY: 1 };
    const world = resolveAnchorWorld(box, { x: 1, y: 0.5 });
    expect(world.x).toBeCloseTo(-25, 9);
    expect(world.y).toBeCloseTo(100, 9);
  });

  it('rotates 30 degrees around the object origin', () => {
    const box = { x: 0, y: 0, width: 100, height: 50, rotation: 30, scaleX: 1, scaleY: 1 };
    const world = resolveAnchorWorld(box, { x: 0.5, y: 1 });
    expect(world.x).toBeCloseTo(50 * Math.cos(Math.PI / 6) - 50 * Math.sin(Math.PI / 6), 9);
    expect(world.y).toBeCloseTo(50 * Math.sin(Math.PI / 6) + 50 * Math.cos(Math.PI / 6), 9);
  });

  it('scales the box before rotating', () => {
    const box = { x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleX: 2, scaleY: 3 };
    expect(resolveAnchorWorld(box, { x: 1, y: 1 })).toEqual({ x: 200, y: 150 });
  });

  it('combines translation, rotation and scale', () => {
    const box = { x: 10, y: 5, width: 100, height: 50, rotation: 90, scaleX: 2, scaleY: 1 };
    const world = resolveAnchorWorld(box, { x: 0.5, y: 0.5 });
    expect(world.x).toBeCloseTo(-15, 9);
    expect(world.y).toBeCloseTo(105, 9);
  });
});

describe('binding: creation snap', () => {
  it('snaps a near point to the nearest perimeter anchor', () => {
    const r = rect('r', 0, 0);
    const anchor = nearestAnchor(r, { x: 103, y: 25 });
    expect(anchor).toEqual({ id: 'r', x: 1, y: 0.5 });
    const top = nearestAnchor(r, { x: 50, y: -5 });
    expect(top).toEqual({ id: 'r', x: 0.5, y: 0 });
  });

  it('returns null beyond the threshold', () => {
    const r = rect('r', 0, 0);
    expect(nearestAnchor(r, { x: 100 + BIND_THRESHOLD_PX + 1, y: 25 })).toBeNull();
  });

  it('never binds lines, arrows or ink', () => {
    const line = makeObject({ type: 'shape.line', id: 'l', x: 0, y: 0, width: 100, height: 0, data: { points: [0, 0, 100, 0] } });
    const ink = makeObject({ type: 'freehand.stroke', id: 'f', x: 0, y: 0, width: 100, height: 50, data: { points: [0, 0, 100, 50] } });
    expect(nearestAnchor(line, { x: 50, y: 0 })).toBeNull();
    expect(nearestAnchor(ink, { x: 50, y: 25 })).toBeNull();
  });

  it('never binds hidden boxes', () => {
    const r = makeObject({ type: 'shape.rect', id: 'r', x: 0, y: 0, width: 100, height: 50, visible: false });
    expect(nearestAnchor(r, { x: 103, y: 25 })).toBeNull();
  });

  it('picks the nearest box across the scene', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 108, 0); // gap of 8: one point can reach both perimeters
    const scene = sceneFromObjects([a, b]);
    const snap = snapEndpoint(scene, { x: 106, y: 25 });
    expect(snap?.binding.id).toBe('b');
    expect(snap?.world).toEqual({ x: 108, y: 25 });
  });

  it('binds an interior start to the matching interior anchor', () => {
    // A gesture starting inside a box glues to the matching interior point —
    // "the arrow from this box" follows the box, which is the useful outcome.
    const r = rect('r', 0, 0);
    const anchor = nearestAnchor(r, { x: 40, y: 25 });
    expect(anchor).toEqual({ id: 'r', x: 0.4, y: 0.5 });
  });

  it('returns null when nothing is near', () => {
    const scene = sceneFromObjects([rect('a', 0, 0)]);
    expect(snapEndpoint(scene, { x: 500, y: 500 })).toBeNull();
  });
});

describe('binding: boundArrowOps', () => {
  it('follows a pure translation', () => {
    const { scene, rectId, arrowId } = boundScene();
    const moved = scene.objects[rectId]!;
    const next: Scene = {
      ...scene,
      objects: { ...scene.objects, [rectId]: { ...moved, x: 150 } },
    };
    const ops = boundArrowOps(next, [rectId]);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.path).toBe(`/objects/${arrowId}/data/points`);
    expect(ops[0]!.value).toEqual([50, 0, 100, 25]);
  });

  it('follows a baked resize', () => {
    const { scene, rectId } = boundScene();
    const moved = scene.objects[rectId]!;
    const next: Scene = {
      ...scene,
      objects: { ...scene.objects, [rectId]: { ...moved, width: 200, height: 100 } },
    };
    const ops = boundArrowOps(next, [rectId]);
    expect(ops[0]!.value).toEqual([100, 25, 100, 25]);
  });

  it('follows a rotation', () => {
    const { scene, rectId } = boundScene();
    const moved = scene.objects[rectId]!;
    const next: Scene = {
      ...scene,
      objects: { ...scene.objects, [rectId]: { ...moved, rotation: 90 } },
    };
    const ops = boundArrowOps(next, [rectId]);
    const points = ops[0]!.value as number[];
    // Anchor world becomes (100-25, 100+100) = (75, 200); arrow local is (-125, 75).
    expect(points[0]).toBeCloseTo(-125, 9);
    expect(points[1]).toBeCloseTo(75, 9);
    expect(points[2]).toBe(100);
    expect(points[3]).toBe(25);
  });

  it('re-derives both ends bound to the same shape in one patch', () => {
    const r = rect('rect_1', 100, 100);
    const a = arrow({
      id: 'arrow_1',
      x: 150,
      y: 150,
      points: [50, -25, 150, 25],
      start: { id: 'rect_1', x: 1, y: 0.5 },
      end: { id: 'rect_1', x: 0, y: 1 },
    });
    const scene = sceneFromObjects([r, a]);
    const moved = scene.objects['rect_1']!;
    const next: Scene = { ...scene, objects: { ...scene.objects, 'rect_1': { ...moved, x: 200 } } };
    const ops = boundArrowOps(next, ['rect_1']);
    expect(ops).toHaveLength(1);
    // start -> (300,125) local (150,-25); end -> (200,150) local (50,0).
    expect(ops[0]!.value).toEqual([150, -25, 50, 0]);
  });

  it('re-derives arrows bound to different shapes in the same call', () => {
    const r1 = rect('rect_1', 0, 0);
    const r2 = rect('rect_2', 300, 0);
    const a1 = arrow({ id: 'arrow_1', x: 100, y: 25, points: [0, 0, 100, 0], start: { id: 'rect_1', x: 1, y: 0.5 } });
    const a2 = arrow({ id: 'arrow_2', x: 200, y: 25, points: [0, 0, 100, 0], end: { id: 'rect_2', x: 0, y: 0.5 } });
    const scene = sceneFromObjects([r1, r2, a1, a2]);
    const next1 = scene.objects['rect_1']!;
    const next2 = scene.objects['rect_2']!;
    const next: Scene = {
      ...scene,
      objects: { ...scene.objects, 'rect_1': { ...next1, x: 50 }, 'rect_2': { ...next2, y: 80 } },
    };
    const ops = boundArrowOps(next, ['rect_1', 'rect_2']);
    expect(ops).toHaveLength(2);
  });

  it('touches only the first and last pair of a multi-point line', () => {
    const r = rect('rect_1', 100, 100);
    const line = makeObject({
      type: 'shape.line',
      id: 'line_1',
      x: 200,
      y: 125,
      width: 100,
      height: 25,
      data: { points: [0, 0, 40, 5, 70, -10, 100, 25], start: { id: 'rect_1', x: 1, y: 0.5 } },
    });
    const scene = sceneFromObjects([r, line]);
    const moved = scene.objects['rect_1']!;
    const next: Scene = { ...scene, objects: { ...scene.objects, 'rect_1': { ...moved, x: 150 } } };
    const ops = boundArrowOps(next, ['rect_1']);
    expect(ops[0]!.value).toEqual([50, 0, 40, 5, 70, -10, 100, 25]);
  });

  it('emits nothing when the bound target is missing from the scene', () => {
    const a = arrow({ id: 'arrow_1', x: 0, y: 0, points: [0, 0, 100, 0], start: { id: 'gone', x: 1, y: 0.5 } });
    const scene = sceneFromObjects([a]);
    expect(boundArrowOps(scene, ['gone'])).toEqual([]);
  });

  it('emits nothing for unbound connectors', () => {
    const a = arrow({ id: 'arrow_1', x: 0, y: 0, points: [0, 0, 100, 0] });
    const scene = sceneFromObjects([a, rect('rect_1', 0, 0)]);
    expect(boundArrowOps(scene, ['rect_1'])).toEqual([]);
  });
});

describe('binding: stripBindingOps', () => {
  it('strips only the end bound to the deleted target', () => {
    const r1 = rect('rect_1', 0, 0);
    const r2 = rect('rect_2', 300, 0);
    const a = arrow({
      id: 'arrow_1',
      x: 100,
      y: 25,
      points: [0, 0, 200, 0],
      start: { id: 'rect_1', x: 1, y: 0.5 },
      end: { id: 'rect_2', x: 0, y: 0.5 },
    });
    const scene = sceneFromObjects([r1, r2, a]);
    const ops = stripBindingOps(scene, ['rect_1']);
    expect(ops).toEqual([{ op: 'remove', path: '/objects/arrow_1/data/start' }]);
  });

  it('leaves unbound connectors untouched', () => {
    const a = arrow({ id: 'arrow_1', x: 0, y: 0, points: [0, 0, 100, 0] });
    const scene = sceneFromObjects([a, rect('rect_1', 0, 0)]);
    expect(stripBindingOps(scene, ['rect_1'])).toEqual([]);
  });

  it('does not reference a connector that is deleted with its target', () => {
    const r = rect('rect_1', 0, 0);
    const a = arrow({ id: 'arrow_1', x: 100, y: 25, points: [0, 0, 100, 0], start: { id: 'rect_1', x: 1, y: 0.5 } });
    const scene = sceneFromObjects([r, a]);
    expect(stripBindingOps(scene, ['rect_1', 'arrow_1'])).toEqual([]);
  });
});

describe('binding: store integration', () => {
  it('one transaction is one undo step that restores box and arrow together', () => {
    const { scene, rectId, arrowId } = boundScene();
    const store = createStore({ scene });
    const original = scene.objects[arrowId]!.data;

    store.transaction(
      (_s, tx) => {
        store.dispatch(tx.commit('object.move', updateObjectOps(rectId, { x: 150 }), { label: 'Move' }));
        const follow = boundArrowOps(store.getState(), [rectId]);
        expect(follow).toHaveLength(1);
        store.dispatch(tx.commit('object.update', follow, { label: 'Move' }));
      },
      { label: 'Move' },
    );

    expect(store.historyDepth().undo).toBe(1);
    const moved = store.getObject(arrowId)!;
    expect((moved.data as { points: number[] }).points).toEqual([50, 0, 100, 25]);

    store.undo();
    expect(store.getObject(rectId)!.x).toBe(100);
    expect(store.getObject(arrowId)!.data).toEqual(original);
  });

  it('undoing a delete restores the box and the stripped binding', () => {
    const { scene, rectId, arrowId } = boundScene();
    const store = createStore({ scene });

    store.transaction(
      (_s, tx) => {
        store.dispatch(tx.commit('object.delete', removeObjectOps(store.getState(), rectId), { label: 'Delete' }));
        const strip = stripBindingOps(store.getState(), [rectId]);
        expect(strip).toHaveLength(1);
        store.dispatch(tx.commit('object.update', strip, { label: 'Delete' }));
      },
      { label: 'Delete' },
    );

    const surviving = store.getObject(arrowId)!;
    expect(surviving).toBeDefined();
    expect('start' in surviving.data).toBe(false);
    // The stored points stand byte-for-byte while the target is gone.
    expect((surviving.data as { points: number[] }).points).toEqual([0, 0, 100, 25]);

    store.undo();
    expect(store.getObject(rectId)!.x).toBe(100);
    const restored = store.getObject(arrowId)!;
    expect((restored.data as { start?: { id: Id } }).start?.id).toBe(rectId);
  });
});

describe('binding: serialization', () => {
  it('round-trips start/end through serialize/deserialize', () => {
    const { scene } = boundScene();
    const restored = deserialize(serialize(scene));
    expect(restored).toEqual(scene);
    const arrowData = restored.objects['arrow_1']!.data as { start?: { id: Id } };
    expect(arrowData.start?.id).toBe('rect_1');
  });

  it('applies a points patch through the live patch engine', () => {
    const { scene, rectId, arrowId } = boundScene();
    const moved = scene.objects[rectId]!;
    const next: Scene = { ...scene, objects: { ...scene.objects, [rectId]: { ...moved, x: 150 } } };
    const ops = boundArrowOps(next, [rectId]);
    const patched = applyPatch(scene, ops);
    expect((patched.objects[arrowId]!.data as { points: number[] }).points).toEqual([50, 0, 100, 25]);
    // Untouched sub-trees are shared by reference — the binding field survives.
    expect((patched.objects[arrowId]!.data as { start?: { id: Id } }).start?.id).toBe(rectId);
  });
});
