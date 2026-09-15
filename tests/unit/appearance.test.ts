/**
 * The page's visual contract (R11): the background a host paints and the grid
 * it configures.
 *
 * These are the pure halves of the contract — the defaults a host is promised,
 * and the single resolution function the renderer feeds on. That the renderer
 * actually *paints* per configuration, and that the PNG export follows the same
 * choice, is proven at page level in `tests/e2e` (checks `y` and `z`); a unit
 * test cannot see a canvas.
 */
import { describe, expect, it } from 'vitest';
import {
  createEmptyScene,
  DEFAULT_BACKGROUND,
  DEFAULT_GRID,
  resolveGrid,
  serialize,
} from '@coslate/core';

describe('appearance: the documented defaults', () => {
  it('are the dark page and the faint white grid this runtime has always drawn', () => {
    expect(DEFAULT_BACKGROUND).toBe('#14161a');
    expect(DEFAULT_GRID).toEqual({
      visible: true,
      color: 'rgba(255, 255, 255, 0.05)',
      majorColor: 'rgba(255, 255, 255, 0.09)',
      spacing: 20,
    });
  });
});

describe('appearance: resolveGrid', () => {
  it('returns a fresh copy of the defaults when nothing is asked', () => {
    const resolved = resolveGrid();
    expect(resolved).toEqual(DEFAULT_GRID);
    expect(resolved).not.toBe(DEFAULT_GRID);
    // Mutating the result must not poison the published constant.
    resolved.spacing = 999;
    expect(DEFAULT_GRID.spacing).toBe(20);
  });

  it('fills only what a host overrides', () => {
    expect(resolveGrid({ visible: false })).toEqual({ ...DEFAULT_GRID, visible: false });
    expect(resolveGrid({ color: '#dddddd' }).spacing).toBe(DEFAULT_GRID.spacing);
    expect(resolveGrid({ spacing: 50 }).majorColor).toBe(DEFAULT_GRID.majorColor);
  });

  it('accepts the full restyle of a white, ungridded host', () => {
    expect(resolveGrid({ visible: false, color: '#e0e0e0', majorColor: '#c0c0c0', spacing: 25 })).toEqual({
      visible: false,
      color: '#e0e0e0',
      majorColor: '#c0c0c0',
      spacing: 25,
    });
  });

  it('merges an update over the current grid, not over the package defaults', () => {
    // A host restyles to grey lines, then switches the grid off: switching off
    // must keep the grey lines, so turning it back on restores the host's look.
    const grey = resolveGrid({ color: 'rgba(0,0,0,0.06)', majorColor: 'rgba(0,0,0,0.12)' });
    const off = resolveGrid({ visible: false }, grey);
    expect(off).toEqual({ ...grey, visible: false });
  });

  it('falls back per field instead of throwing on values that cannot be drawn', () => {
    expect(resolveGrid({ spacing: 0 }).spacing).toBe(DEFAULT_GRID.spacing);
    expect(resolveGrid({ spacing: -10 }).spacing).toBe(DEFAULT_GRID.spacing);
    expect(resolveGrid({ spacing: Number.NaN }).spacing).toBe(DEFAULT_GRID.spacing);
    expect(resolveGrid({ spacing: Number.POSITIVE_INFINITY }).spacing).toBe(DEFAULT_GRID.spacing);
    expect(resolveGrid({ color: '' }).color).toBe(DEFAULT_GRID.color);
    expect(resolveGrid({ color: '   ' }).color).toBe(DEFAULT_GRID.color);
    expect(resolveGrid({ color: 42 as unknown as string }).color).toBe(DEFAULT_GRID.color);
    expect(resolveGrid({ visible: 1 as unknown as boolean }).visible).toBe(DEFAULT_GRID.visible);
  });

  it('never lets an appearance value reach the document', () => {
    // The background and the grid are view state (the rule behind I4, which put
    // the camera out of the document): the serialized scene carries exactly the
    // four keys below, so neither can hide inside it.
    expect(Object.keys(createEmptyScene()).sort()).toEqual(['format', 'objects', 'order', 'version']);
    const text = serialize(createEmptyScene());
    expect(text).not.toContain(DEFAULT_BACKGROUND);
    expect(text).not.toContain('grid');
    expect(text).not.toContain('background');
  });
});
