/**
 * Editor style: what the next created object looks like, and what the current
 * selection is restyled to.
 *
 * Style is *not* part of the scene. It is editor state — the equivalent of a
 * brush in your hand — and it never belongs in an undo step.
 */

import { objectPath, type JSONPatchOp, type Paint, type SceneObject, type StrokeStyle } from '@coslate/core';

export interface EditorStyle {
  stroke: string;
  /** `null` means "no fill". */
  fill: Paint;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fontSize: number;
  fontFamily: string;
}

export const DEFAULT_STYLE: EditorStyle = {
  stroke: '#e8eaed',
  fill: null,
  strokeWidth: 2,
  strokeStyle: 'solid',
  fontSize: 20,
  fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
};

/** Dark-theme palette. Index 0 is the default ink. */
export const STROKE_PALETTE: readonly string[] = [
  '#e8eaed',
  '#ff6b6b',
  '#ffd43b',
  '#51cf66',
  '#4dabf7',
  '#b197fc',
  '#ff922b',
  '#f783ac',
];

export const STROKE_WIDTHS: readonly number[] = [1, 2, 4, 8];

/** Line-style options, in strip order. Index 0 is the default. */
export const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dashDot'];

/**
 * i18n keys the host catalog must cover for the font-family menu labels.
 * Kept as a literal union so the chrome's `t()` stays fully typed.
 */
export type FontFamilyLabelKey = 'style.font.sans' | 'style.font.serif' | 'style.font.mono' | 'style.font.hand';

/**
 * The font-family menu for text. Every option is a *generic system stack* —
 * the runtime ships no font files (AGENTS.md: nothing non-open-source may
 * ship), so each entry names a family class the host OS is expected to provide.
 * Index 0 is the default and matches {@link DEFAULT_STYLE}.
 */
export const FONT_FAMILIES: readonly { labelKey: FontFamilyLabelKey; value: string }[] = [
  { labelKey: 'style.font.sans', value: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif' },
  { labelKey: 'style.font.serif', value: 'Georgia, Cambria, Times New Roman, serif' },
  { labelKey: 'style.font.mono', value: 'SFMono-Regular, Consolas, Menlo, monospace' },
  { labelKey: 'style.font.hand', value: 'Segoe Print, Bradley Hand, Chalkboard SE, cursive' },
];

/**
 * The font-size menu for text, in strip order. Index 2 (20) is the default and
 * matches {@link DEFAULT_STYLE}; renderers treat a missing `fontSize` as 20
 * anyway, so old documents need no migration.
 */
export const FONT_SIZES: readonly number[] = [12, 16, 20, 28, 36, 48];

export function cloneStyle(style: EditorStyle): EditorStyle {
  return { ...style };
}

export type StyleKey = keyof EditorStyle;

/**
 * How a style maps onto one object's `data` bag. Each object type takes what it
 * can use — a stroke has no fill, text has no stroke width — which keeps the
 * "apply to selection" behaviour predictable across mixed selections.
 */
export function styleDataFor(object: SceneObject, style: EditorStyle, keys: readonly StyleKey[]): Record<string, unknown> {
  const wants = new Set<StyleKey>(keys);
  const data: Record<string, unknown> = {};
  switch (object.type) {
    case 'shape.rect':
    case 'shape.ellipse':
      if (wants.has('fill')) data.fill = style.fill;
      if (wants.has('stroke')) data.stroke = style.stroke;
      if (wants.has('strokeWidth')) data.strokeWidth = style.strokeWidth;
      if (wants.has('strokeStyle')) data.strokeStyle = style.strokeStyle;
      break;
    case 'shape.line':
    case 'shape.arrow':
    case 'freehand.stroke':
      if (wants.has('stroke')) data.stroke = style.stroke;
      if (wants.has('strokeWidth')) data.strokeWidth = style.strokeWidth;
      if (wants.has('strokeStyle')) data.strokeStyle = style.strokeStyle;
      break;
    case 'shape.text':
      if (wants.has('stroke')) data.fill = style.stroke;
      if (wants.has('fontSize')) data.fontSize = style.fontSize;
      if (wants.has('fontFamily')) data.fontFamily = style.fontFamily;
      break;
    default:
      break;
  }
  return data;
}

/** Turn a style change into document patches for one object. */
export function stylePatchOps(object: SceneObject, style: EditorStyle, keys: readonly StyleKey[]): JSONPatchOp[] {
  const data = styleDataFor(object, style, keys);
  return Object.entries(data).map(([key, value]) => ({
    op: 'replace' as const,
    path: objectPath(object.id, 'data', key),
    value,
  }));
}
