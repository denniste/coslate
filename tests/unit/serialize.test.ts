import { describe, expect, it } from 'vitest';
import {
  cloneScene,
  createEmptyScene,
  deserialize,
  makeObject,
  migrate,
  registerMigration,
  sceneFromObjects,
  SceneSerializationError,
  serialize,
  validateScene,
  type Scene,
} from '@coslate/core';

function sampleScene(): Scene {
  return sceneFromObjects(
    [
      makeObject({ type: 'shape.rect', id: 'r1', x: 10, y: 20, width: 120, height: 80, data: { stroke: '#fff' } }),
      makeObject({
        type: 'freehand.stroke',
        id: 's1',
        x: 0,
        y: 0,
        width: 30,
        height: 30,
        data: { points: [0, 0, 10, 10, 20, 20], strokeWidth: 4 },
      }),
      makeObject({ type: 'shape.text', id: 't1', x: 5, y: 5, width: 100, height: 24, data: { text: 'hello' } }),
    ],
    { x: -5, y: 12.5, scale: 1.25 },
  );
}

describe('serialize: round-trip', () => {
  it('deserialize(serialize(scene)) deep-equals the original', () => {
    const scene = sampleScene();
    const restored = deserialize(serialize(scene));
    expect(restored).toEqual(scene);
    expect(restored).not.toBe(scene);
    expect(cloneScene(scene)).toEqual(scene);
  });

  it('survives a pretty-printed round-trip', () => {
    const scene = sampleScene();
    const text = serialize(scene, { pretty: true });
    expect(text).toContain('\n  "format"');
    expect(deserialize(text)).toEqual(scene);
  });

  it('preserves free-form meta without a schema change', () => {
    const scene = sampleScene();
    const withMeta: Scene = {
      ...scene,
      meta: { title: 'Board', nested: { anything: [1, 2, { deep: true }] } },
      objects: {
        ...scene.objects,
        r1: { ...scene.objects.r1!, meta: { author: 'ai', confidence: 0.42 } },
      },
    };
    const restored = deserialize(serialize(withMeta));
    expect(restored).toEqual(withMeta);
    expect(restored.objects.r1?.meta).toEqual({ author: 'ai', confidence: 0.42 });
  });

  it('accepts an already-parsed object as well as text', () => {
    const scene = sampleScene();
    expect(deserialize(JSON.parse(serialize(scene)) as unknown)).toEqual(scene);
  });
});

describe('serialize: failure modes', () => {
  it('throws a typed error on malformed JSON', () => {
    try {
      deserialize('{not json');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SceneSerializationError);
      expect((error as SceneSerializationError).code).toBe('INVALID_JSON');
    }
  });

  it('throws FUTURE_VERSION on a document from a newer build', () => {
    const future = {
      format: 'coslate/scene',
      version: 99,
      viewport: { x: 0, y: 0, scale: 1 },
      objects: {},
      order: [],
    };
    try {
      deserialize(JSON.stringify(future));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SceneSerializationError);
      expect((error as SceneSerializationError).code).toBe('FUTURE_VERSION');
      expect((error as SceneSerializationError).message).toMatch(/newer than this build/);
    }
    expect(() => migrate(future)).toThrow(SceneSerializationError);
  });

  it('rejects an unknown format tag', () => {
    const foreign = { format: 'excalidraw/scene', version: 1, viewport: { x: 0, y: 0, scale: 1 }, objects: {}, order: [] };
    try {
      deserialize(foreign);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SceneSerializationError).code).toBe('UNKNOWN_FORMAT');
    }
  });

  it('rejects structurally corrupt scenes instead of half-loading them', () => {
    const base = createEmptyScene();
    const cases: unknown[] = [
      { ...base, objects: { a: { ...makeObject({ type: 'shape.rect', id: 'b', x: 0, y: 0, width: 1, height: 1 }) } } },
      { ...base, order: ['ghost'] },
      { ...base, objects: { a: makeObject({ type: 'shape.rect', id: 'a', x: 0, y: 0, width: 1, height: 1 }) }, order: [] },
      { ...base, order: ['x', 'x'] },
      { ...base, viewport: { x: 0, y: 0, scale: 0 } },
      { ...base, viewport: { x: 0, y: 'nope', scale: 1 } },
    ];
    for (const candidate of cases) {
      expect(() => validateScene(candidate)).toThrow(SceneSerializationError);
    }
  });

  it('rejects a scene with an unknown object type', () => {
    const scene = createEmptyScene();
    expect(() =>
      deserialize(
        JSON.stringify({
          ...scene,
          objects: { a: { ...makeObject({ type: 'shape.rect', id: 'a', x: 0, y: 0, width: 1, height: 1 }), type: 'shape.hexagon' } },
          order: ['a'],
        }),
      ),
    ).toThrow(/not a known object type/);
  });

  it('refuses to serialize a non-finite number', () => {
    const scene = sampleScene();
    const broken: Scene = { ...scene, objects: { ...scene.objects, r1: { ...scene.objects.r1!, x: Number.POSITIVE_INFINITY } } };
    expect(() => serialize(broken)).toThrow(SceneSerializationError);
  });
});

describe('serialize: migrations', () => {
  const base = {
    format: 'coslate/scene',
    version: 1,
    viewport: { x: 0, y: 0, scale: 1 },
    objects: {},
    order: [],
  };

  it('walks a document forward through the migration chain', () => {
    registerMigration(1, (document) => ({ ...document, meta: { migratedFrom: 1 } }));
    const migrated = migrate({ ...base, version: 1 }, 2);
    expect(migrated.version).toBe(2);
    expect(migrated.meta).toEqual({ migratedFrom: 1 });
  });

  it('throws UNSUPPORTED_VERSION when a migration step is missing', () => {
    try {
      migrate({ ...base, version: 7 }, 9);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SceneSerializationError);
      expect((error as SceneSerializationError).code).toBe('UNSUPPORTED_VERSION');
    }
  });

  it('leaves a current-version document untouched', () => {
    expect(deserialize(JSON.stringify(base))).toEqual(createEmptyScene());
  });
});
