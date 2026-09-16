/**
 * Text typography menus: the font-family / font-size option lists and how a
 * style change maps onto a text object.
 *
 * The data-level contract: the menu defaults match the default editor style
 * exactly, so a fresh editor shows index 0 in both menus; a font pick reaches
 * a text object's `fontFamily` / `fontSize` data fields (and nothing else),
 * and never leaks onto non-text objects. That the menus actually preset the
 * overlay and restyle a selection is proven at page level in `tests/e2e`
 * (check `ai`); a unit test cannot see a toolbar.
 */
import { describe, expect, it } from 'vitest';
import { defaultData, isObjectOfType, makeObject } from '@coslate/core';
import { DEFAULT_STYLE, FONT_FAMILIES, FONT_SIZES, styleDataFor } from '../../packages/konva/src/style.js';

describe('text typography model', () => {
  it('opens the font menu on the default stack', () => {
    expect(FONT_FAMILIES[0].value).toBe(DEFAULT_STYLE.fontFamily);
    expect(FONT_FAMILIES.length).toBeGreaterThanOrEqual(2);
    for (const option of FONT_FAMILIES) {
      expect(option.value).toMatch(/sans-serif|serif|monospace|cursive/);
    }
  });

  it('opens the size menu on the default size', () => {
    expect(FONT_SIZES).toContain(DEFAULT_STYLE.fontSize);
    for (const size of FONT_SIZES) expect(size).toBeGreaterThan(0);
  });

  it('text default data is a sans stack at the default size', () => {
    // NB: `defaultData` in core is the schema fallback; the editor styles real
    // text from the editor style, which is what the menu shows. They need not
    // be the identical string, only the same kind of default.
    const data = defaultData('shape.text');
    expect(data.fontFamily).toContain('sans-serif');
    expect(data.fontSize).toBe(DEFAULT_STYLE.fontSize);
  });

  it('a font pick reaches only the text data fields', () => {
    const object = makeObject({
      type: 'shape.text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      data: {},
    });
    if (!isObjectOfType(object, 'shape.text')) throw new Error('unreachable');
    const data = styleDataFor(object, { ...DEFAULT_STYLE, fontFamily: FONT_FAMILIES[1].value, fontSize: 36 }, [
      'fontFamily',
      'fontSize',
    ]);
    expect(data).toEqual({ fontFamily: FONT_FAMILIES[1].value, fontSize: 36 });
  });

  it('a font pick never leaks onto a stroked shape', () => {
    const object = makeObject({
      type: 'shape.rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      data: {},
    });
    const data = styleDataFor(object, DEFAULT_STYLE, ['fontFamily', 'fontSize']);
    expect(data).toEqual({});
  });
});
