/**
 * Page appearance: the visual contract between the runtime and its host.
 *
 * The page background and the grid are **view state, never document state** —
 * the same rule that keeps the camera out of `Scene` (see `docs/INVARIANTS.md`
 * I4). A shared document must not carry one participant's taste in grid lines,
 * and a stored baseline must not restore somebody else's page colour. These
 * values exist as constructor options and renderer settings only; they never
 * appear in a serialized scene, in a delta, or in an undo step.
 *
 * The defaults are the dark page this runtime has always drawn. A host whose
 * surface differs — the first host's board is white and ungridded — overrides
 * them at construction or at runtime, and the PNG export follows the same
 * configuration, because the export paints the very same page layer.
 */

/** One configurable aspect of the drawn grid. */
export interface GridAppearance {
  /** Whether the grid is drawn at all. */
  visible: boolean;
  /** Colour of the minor grid lines — any colour string a canvas accepts. */
  color: string;
  /** Colour of the major lines, drawn every fifth step. */
  majorColor: string;
  /**
   * Base spacing between minor lines, in world units. The drawn step adapts to
   * the zoom level so a line stays legible on screen (roughly 24–96 screen
   * pixels); this is the seed that adaptation halves and doubles from.
   */
  spacing: number;
}

/** The page colour drawn when a host does not choose one. */
export const DEFAULT_BACKGROUND = '#14161a';

/** The grid drawn when a host does not configure one: faint white on dark. */
export const DEFAULT_GRID: Readonly<GridAppearance> = {
  visible: true,
  color: 'rgba(255, 255, 255, 0.05)',
  majorColor: 'rgba(255, 255, 255, 0.09)',
  spacing: 20,
};

const isColor = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * Fill a partial grid configuration over `base` (the defaults when omitted).
 *
 * This is the single place a partial option becomes a complete grid, so a
 * renderer never has to reason about half-specified state. A value that cannot
 * be drawn falls back to the base instead of throwing: an appearance setting
 * must never be able to break constructing a page. The result is a fresh
 * object, and the input is never mutated.
 */
export function resolveGrid(
  partial: Partial<GridAppearance> = {},
  base: GridAppearance = { ...DEFAULT_GRID },
): GridAppearance {
  const spacing = partial.spacing;
  return {
    visible: typeof partial.visible === 'boolean' ? partial.visible : base.visible,
    color: isColor(partial.color) ? partial.color : base.color,
    majorColor: isColor(partial.majorColor) ? partial.majorColor : base.majorColor,
    spacing:
      typeof spacing === 'number' && Number.isFinite(spacing) && spacing > 0 ? spacing : base.spacing,
  };
}
