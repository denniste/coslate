import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  formatPath,
  getAtPath,
  invertPatch,
  joinPath,
  parsePath,
  PatchError,
  type JSONPatchOp,
} from '@coslate/core';

describe('jsonpatch: paths', () => {
  it('parses and formats RFC 6901 pointers', () => {
    expect(parsePath('/objects/abc/x')).toEqual(['objects', 'abc', 'x']);
    expect(parsePath('')).toEqual([]);
    expect(parsePath('/order/-')).toEqual(['order', '-']);
    expect(formatPath(['objects', 'a/b', 'x'])).toBe('/objects/a~1b/x');
    expect(joinPath('/objects/abc', 'data', 'text')).toBe('/objects/abc/data/text');
    expect(parsePath('/a~0b')).toEqual(['a~b']);
  });
});

describe('jsonpatch: apply', () => {
  const doc: { objects: Record<string, { x: number }>; order: string[] } = { objects: { a: { x: 1 } }, order: ['a'] };

  it('applies add / replace / remove immutably', () => {
    const added = applyPatch(doc, [{ op: 'add', path: '/objects/b', value: { x: 9 } }]);
    expect(added.objects.b).toEqual({ x: 9 });
    expect(doc.objects).not.toHaveProperty('b');

    const replaced = applyPatch(added, [{ op: 'replace', path: '/objects/a/x', value: 42 }]);
    expect(replaced.objects.a.x).toBe(42);
    expect(added.objects.a.x).toBe(1);

    const removed = applyPatch(replaced, [{ op: 'remove', path: '/objects/a' }]);
    expect(removed.objects).not.toHaveProperty('a');
  });

  it('appends with /order/- and inserts at an explicit index', () => {
    const appended = applyPatch(doc, [{ op: 'add', path: '/order/-', value: 'b' }]);
    expect(appended.order).toEqual(['a', 'b']);

    const inserted = applyPatch(appended, [{ op: 'add', path: '/order/0', value: 'c' }]);
    expect(inserted.order).toEqual(['c', 'a', 'b']);
    expect(appended.order).toEqual(['a', 'b']);
  });

  it('shares untouched sub-trees (structural sharing)', () => {
    const before = { objects: { a: { x: 1 }, b: { x: 2 } }, order: ['a', 'b'] };
    const after = applyPatch(before, [{ op: 'replace', path: '/objects/a/x', value: 5 }]);
    expect(after.objects.b).toBe(before.objects.b);
    expect(after.order).toBe(before.order);
    expect(after.objects).not.toBe(before.objects);
  });

  it('reads values and reports missing paths', () => {
    expect(getAtPath(doc, '/objects/a/x')).toBe(1);
    expect(() => getAtPath(doc, '/objects/zz/x')).toThrow(PatchError);
    try {
      getAtPath(doc, '/objects/zz/x');
    } catch (error) {
      expect((error as PatchError).code).toBe('PATH_NOT_FOUND');
    }
  });

  it('rejects malformed pointers and bad ops', () => {
    expect(() => applyPatch(doc, [{ op: 'remove', path: 'objects/a' }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'add', path: '/objects/a/x' }])).toThrow(/requires a value/);
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/objects/nope', value: 1 }])).toThrow(PatchError);
  });
});

describe('jsonpatch: invertPatch round-trip', () => {
  it('restores the original document exactly', () => {
    const original = {
      viewport: { x: 0, y: 0, scale: 1 },
      objects: { a: { x: 1, y: 2, data: { text: 'hi' } }, b: { x: 3, y: 4 } },
      order: ['a', 'b'],
    };
    const patch: JSONPatchOp[] = [
      { op: 'replace', path: '/objects/a/x', value: 100 },
      { op: 'add', path: '/objects/c', value: { x: 7 } },
      { op: 'add', path: '/order/-', value: 'c' },
      { op: 'remove', path: '/objects/b' },
      { op: 'remove', path: '/order/1' },
      { op: 'replace', path: '/objects/a/data/text', value: 'bye' },
      { op: 'add', path: '/order/0', value: 'c' },
    ];
    const inverse = invertPatch(original, patch);
    const forwarded = applyPatch(original, patch);
    const restored = applyPatch(forwarded, inverse);
    expect(restored).toEqual(original);
  });

  it('inverts an append with a concrete index', () => {
    const original = { order: ['a', 'b'] };
    const inverse = invertPatch(original, [{ op: 'add', path: '/order/-', value: 'c' }]);
    expect(inverse).toEqual([{ op: 'remove', path: '/order/2' }]);
  });

  it('re-applying the inverse of the inverse returns the patched document', () => {
    const original = { objects: { a: { x: 1 } }, order: ['a'] };
    const patch: JSONPatchOp[] = [{ op: 'replace', path: '/objects/a/x', value: 8 }];
    const forwarded = applyPatch(original, patch);
    const backAgain = applyPatch(forwarded, invertPatch(forwarded, invertPatch(original, patch)));
    expect(backAgain).toEqual(forwarded);
  });
});
