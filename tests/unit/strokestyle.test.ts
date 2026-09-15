/**
 * Stroke style (line pattern): the `solid | dashed | dashDot` model field and
 * the pure mappings built on it.
 *
 * The data-level contract: every stroked object type carries the field with a
 * `solid` default; text (which has no stroke of its own) never receives one;
 * the canonical dash pattern scales with the stroke width so dashes stay
 * proportional to the line they travel on. That the editor actually renders
 * these patterns is proven at page level in `tests/e2e` (check `ag`); a unit
 * test cannot see a canvas.
 */
import { describe, expect, it } from 'vitest';
import { dashPattern, defaultData, isObjectOfType, makeObject } from '@coslate/core';
import { DEFAULT_STYLE, styleDataFor } from '../../packages/konva/src/style.js';

describe('stroke style model', () => {
  it('defaults every stroked type to solid', () => {
    for (const type of ['shape.rect', 'shape.ellipse', 'shape.line', 'shape.arrow', 'freehand.stroke'] as const) {
      expect(defaultData(type).strokeStyle, type).toBe('solid');
    }
  });

  it('defaults the editor style to solid', () => {
    expect(DEFAULT_STYLE.strokeStyle).toBe('solid');
  });

  it('round-trips through makeObject with an explicit pattern', () => {
    const object = makeObject({
      type: 'shape.line',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      data: { strokeStyle: 'dashDot' },
    });
    if (!isObjectOfType(object, 'shape.line')) throw new Error('unreachable');
    expect(object.data.strokeStyle).toBe('dashDot');
  });
});

describe('dashPattern', () => {
  it('solid (and a missing value, for documents predating the field) is an empty pattern', () => {
    expect(dashPattern('solid', 2)).toEqual([]);
    expect(dashPattern(undefined, 2)).toEqual([]);
  });

  it('dashes scale with the stroke width', () => {
    expect(dashPattern('dashed', 2)).toEqual([8, 6]);
    expect(dashPattern('dashed', 4)).toEqual([16, 12]);
  });

  it('dash-dot carries a dot narrower than its dashes', () => {
    expect(dashPattern('dashDot', 2)).toEqual([8, 4, 2, 4]);
  });

  it('clamps pathological widths instead of emitting negative or zero dashes', () => {
    expect(dashPattern('dashed', 0)).toEqual([2, 1.5]);
  });
});

describe('styleDataFor gates strokeStyle to stroked types', () => {
  const style = { ...DEFAULT_STYLE, strokeStyle: 'dashed' as const };

  it('maps it onto shapes, lines, arrows and ink', () => {
    for (const type of ['shape.rect', 'shape.ellipse', 'shape.line', 'shape.arrow', 'freehand.stroke'] as const) {
      const object = makeObject({ type, x: 0, y: 0, width: 10, height: 10 });
      const data = styleDataFor(object, style, ['strokeStyle']);
      expect(data.strokeStyle, type).toBe('dashed');
    }
  });

  it('never maps it onto text', () => {
    const object = makeObject({ type: 'shape.text', x: 0, y: 0, width: 10, height: 10 });
    const data = styleDataFor(object, style, ['strokeStyle']);
    expect(data).not.toHaveProperty('strokeStyle');
  });

  it('does not touch the field when the key is not requested', () => {
    const object = makeObject({ type: 'shape.rect', x: 0, y: 0, width: 10, height: 10 });
    const data = styleDataFor(object, style, ['stroke']);
    expect(data).not.toHaveProperty('strokeStyle');
  });
});
