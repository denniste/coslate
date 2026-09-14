import { describe, expect, it } from 'vitest';
import { makeObject, sceneFromObjects, type Scene } from '@coslate/core';
import {
  contentBounds,
  hitTest,
  hitTestObject,
  localToWorld,
  normalizePoints,
  objectsInBounds,
  worldToLocal,
} from '../../packages/konva/src/geometry';

/**
 * Hit testing is scene-model geometry, not renderer behaviour, so it is unit
 * tested here without a canvas anywhere in sight.
 */

function rect(id: string, x: number, y: number, width = 100, height = 50): ReturnType<typeof makeObject> {
  return makeObject({ type: 'shape.rect', id, x, y, width, height });
}

function stroke(id: string, x: number, y: number, points: number[], strokeWidth = 4): ReturnType<typeof makeObject> {
  return makeObject({ type: 'freehand.stroke', id, x, y, width: 100, height: 100, data: { points, strokeWidth } });
}

describe('geometry: transforms', () => {
  it('round-trips local <-> world', () => {
    const object = { x: 10, y: 20, rotation: 30, scaleX: 2, scaleY: 0.5 };
    const local = { x: 12, y: -7 };
    const world = localToWorld(object, local);
    const back = worldToLocal(object, world);
    expect(back.x).toBeCloseTo(local.x, 9);
    expect(back.y).toBeCloseTo(local.y, 9);
  });

  it('rotates around the object origin', () => {
    const world = localToWorld({ x: 5, y: 5, rotation: 90, scaleX: 1, scaleY: 1 }, { x: 10, y: 0 });
    expect(world.x).toBeCloseTo(5, 9);
    expect(world.y).toBeCloseTo(15, 9);
  });
});

describe('geometry: hit testing', () => {
  it('hits a rect anywhere inside it, even with no fill', () => {
    const object = rect('r', 0, 0);
    expect(hitTestObject(object, { x: 50, y: 25 })).toBe(true);
    expect(hitTestObject(object, { x: -20, y: 25 })).toBe(false);
    expect(hitTestObject(object, { x: 50, y: 90 })).toBe(false);
  });

  it('respects rotation', () => {
    // 90 degrees clockwise about the object's top-left origin: the 100-wide box
    // now extends downwards, and its 10px height sticks out to the left.
    const object = makeObject({ type: 'shape.rect', id: 'r', x: 0, y: 0, width: 100, height: 10, rotation: 90 });
    expect(hitTestObject(object, { x: -5, y: 50 })).toBe(true);
    expect(hitTestObject(object, { x: 5, y: 50 })).toBe(false);
  });

  it('hits a stroke near its path only', () => {
    const object = stroke('s', 0, 0, [0, 0, 100, 0]);
    expect(hitTestObject(object, { x: 50, y: 1 })).toBe(true);
    expect(hitTestObject(object, { x: 50, y: 30 })).toBe(false);
  });

  it('ignores hidden and locked objects', () => {
    const hidden = makeObject({ type: 'shape.rect', id: 'h', x: 0, y: 0, width: 10, height: 10, visible: false });
    const locked = makeObject({ type: 'shape.rect', id: 'l', x: 0, y: 0, width: 10, height: 10, locked: true });
    expect(hitTestObject(hidden, { x: 5, y: 5 })).toBe(false);
    expect(hitTestObject(locked, { x: 5, y: 5 })).toBe(false);
    expect(hitTestObject(locked, { x: 5, y: 5 }, { includeLocked: true })).toBe(true);
  });

  it('returns the topmost object in paint order', () => {
    const scene: Scene = sceneFromObjects([rect('bottom', 0, 0), rect('top', 0, 0)]);
    expect(hitTest(scene, { x: 10, y: 10 })?.id).toBe('top');
    const reversed: Scene = { ...scene, order: ['top', 'bottom'] };
    expect(hitTest(reversed, { x: 10, y: 10 })?.id).toBe('bottom');
  });

  it('selects objects intersecting a marquee', () => {
    const scene = sceneFromObjects([rect('a', 0, 0), rect('b', 500, 500), rect('c', 60, 20, 10, 10)]);
    const found = objectsInBounds(scene, { x: -10, y: -10, width: 200, height: 200 }).map((o) => o.id);
    expect(found).toEqual(['a', 'c']);
  });
});

describe('geometry: point normalisation', () => {
  it('re-origins a point list to its bounding box', () => {
    const result = normalizePoints([10, 20, 30, 40, 20, 60]);
    expect(result.bounds).toEqual({ x: 10, y: 20, width: 20, height: 40 });
    expect(result.offset).toEqual({ x: 10, y: 20 });
    expect(result.points).toEqual([0, 0, 20, 20, 10, 40]);
  });

  it('handles a degenerate point list', () => {
    expect(normalizePoints([]).bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('geometry: content bounds', () => {
  it('unions every visible object', () => {
    const scene = sceneFromObjects([rect('a', 0, 0), rect('b', 200, 100, 50, 50)]);
    expect(contentBounds(scene)).toEqual({ x: 0, y: 0, width: 250, height: 150 });
  });

  it('returns null for an empty scene', () => {
    expect(contentBounds(sceneFromObjects([]))).toBeNull();
  });
});
