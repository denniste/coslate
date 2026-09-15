/**
 * Board themes (白板 / 黑板): the named page-appearance presets a chrome can
 * offer as one switch.
 *
 * The contract: the black preset is exactly the documented default look, so
 * flipping to it from any state restores the published contract; the white
 * preset inverts it (white page, faint dark grid). Both are view
 * configuration — they pair a background with *partial* grid colours that
 * merge over the current grid, never re-enabling a grid the user hid. The
 * chrome wiring that applies them is proven at page level in `tests/e2e`
 * (check `ah`); here it is the pure data.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_THEMES, DEFAULT_BACKGROUND, DEFAULT_GRID, resolveGrid } from '@coslate/core';

describe('BOARD_THEMES', () => {
  it('offers exactly the white and black boards', () => {
    expect(Object.keys(BOARD_THEMES).sort()).toEqual(['black', 'white']);
  });

  it('black is exactly the documented default look', () => {
    expect(BOARD_THEMES.black.background).toBe(DEFAULT_BACKGROUND);
    expect(BOARD_THEMES.black.grid.color).toBe(DEFAULT_GRID.color);
    expect(BOARD_THEMES.black.grid.majorColor).toBe(DEFAULT_GRID.majorColor);
  });

  it('white inverts the default: white page, faint dark grid', () => {
    const { background, grid } = BOARD_THEMES.white;
    expect(background).toBe('#ffffff');
    expect(background).not.toBe(DEFAULT_BACKGROUND);
    expect(grid.color).not.toBe(DEFAULT_GRID.color);
    expect(grid.majorColor).not.toBe(DEFAULT_GRID.majorColor);
    // Faint-on-white, like the defaults are faint-on-dark: the lines must be
    // alpha-blended, not solid, or the board reads as ruled paper.
    for (const line of [grid.color, grid.majorColor]) {
      expect(line.startsWith('rgba'), line).toBe(true);
      const alpha = Number(line.replace(/rgba\([^)]*,\s*([0-9.]+)\)/, '$1'));
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(0.5);
    }
    // The major line must read stronger than the minor one.
    const alphaOf = (c: string) => Number(c.replace(/rgba\([^)]*,\s*([0-9.]+)\)/, '$1'));
    expect(alphaOf(grid.majorColor)).toBeGreaterThan(alphaOf(grid.color));
  });

  it('grid parts merge over the current grid without touching visibility or spacing', () => {
    // A user who hid their grid keeps it hidden after a board flip.
    const hidden = resolveGrid({ visible: false, spacing: 45 }, resolveGrid(BOARD_THEMES.white.grid));
    expect(hidden.visible).toBe(false);
    expect(hidden.spacing).toBe(45);
    expect(hidden.color).toBe(BOARD_THEMES.white.grid.color);
    expect(hidden.majorColor).toBe(BOARD_THEMES.white.grid.majorColor);
    // The renderer's own merge path: partial over defaults.
    const merged = resolveGrid(BOARD_THEMES.black.grid);
    expect(merged.visible).toBe(DEFAULT_GRID.visible);
    expect(merged.spacing).toBe(DEFAULT_GRID.spacing);
  });
});
