/**
 * Editor style: what the next created object looks like, and what the current
 * selection is restyled to.
 *
 * Style is *not* part of the scene. It is editor state — the equivalent of a
 * brush in your hand — and it never belongs in an undo step.
 */

import { objectPath, type JSONPatchOp, type Paint, type SceneObject } from '@coslate/core';

export interface EditorStyle {
  stroke: string;
  /** `null` means "no fill". */
  fill: Paint;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
}

export const DEFAULT_STYLE: EditorStyle = {
  stroke: '#e8eaed',
  fill: null,
  strokeWidth: 2,
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
      break;
    case 'shape.line':
    case 'shape.arrow':
    case 'freehand.stroke':
      if (wants.has('stroke')) data.stroke = style.stroke;
      if (wants.has('strokeWidth')) data.strokeWidth = style.strokeWidth;
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
