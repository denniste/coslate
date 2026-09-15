/**
 * Inline SVG icons for the chrome. (Moved verbatim out of the demo: icons are
 * chrome, not application code.)
 *
 * Hand-written 24×24 stroke glyphs drawn in `currentColor`, so a button's icon
 * inherits hover / active / disabled colour from plain CSS. No icon font, no
 * sprite sheet, no dependency: the whole set is a few hundred bytes of source
 * and it tree-shakes with the rest of the package.
 *
 * Parsing through `DOMParser` (rather than assigning `innerHTML` to an <svg>)
 * keeps the markup creation on one well-defined path and gives a real
 * `SVGSVGElement` back.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  // tools
  select: '<path d="M5.5 3.4 18.6 11l-6 1.4 3.1 6.6-2.2 1-3.1-6.6-4.9 4.4Z"/>',
  pen: '<path d="M4.5 19.5 5.6 15.4 16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.6 18.4Z"/><path d="M14.8 6.2l3 3"/><path d="M4.5 19.5l4.1-1.1"/>',
  eraser:
    '<path d="M7.6 19.4 4.1 15.9a1.8 1.8 0 0 1 0-2.5l8.5-8.5a1.8 1.8 0 0 1 2.5 0l3.5 3.5a1.8 1.8 0 0 1 0 2.5l-8.5 8.5a1.8 1.8 0 0 1-2.5 0Z"/><path d="M8.9 8.5l7 7"/><path d="M8.4 19.4H20"/>',
  rect: '<rect x="4" y="5.5" width="16" height="13" rx="2.2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6.6"/>',
  line: '<path d="M5.6 18.4 18.4 5.6"/><circle cx="5.6" cy="18.4" r="1.5"/><circle cx="18.4" cy="5.6" r="1.5"/>',
  arrow: '<path d="M5 19 17.6 6.4"/><path d="M11.4 6.4h6.2v6.2"/>',
  text: '<path d="M5 7V4.8h14V7"/><path d="M12 4.8v14.4"/><path d="M8.6 19.2h6.8"/>',

  // history
  undo: '<path d="M4.5 9.5h10a5.5 5.5 0 0 1 0 11H9"/><path d="M8 5.5 4 9.5l4 4"/>',
  redo: '<path d="M19.5 9.5h-10a5.5 5.5 0 0 0 0 11H15"/><path d="M16 5.5l4 4-4 4"/>',

  // zoom
  zoomIn:
    '<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20.5 20.5"/><path d="M10.5 7.8v5.4M7.8 10.5h5.4"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20.5 20.5"/><path d="M7.8 10.5h5.4"/>',
  zoomFit:
    '<path d="M4 9.5V4.5h5"/><path d="M20 9.5V4.5h-5"/><path d="M4 14.5v5h5"/><path d="M20 14.5v5h-5"/>',

  // object actions
  trash:
    '<path d="M4.5 6.8h15"/><path d="M9.6 6.8V5a1.2 1.2 0 0 1 1.2-1.2h2.4A1.2 1.2 0 0 1 14.4 5v1.8"/><path d="M6.6 6.8l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12.2"/><path d="M10.4 10.6v6M13.6 10.6v6"/>',
  duplicate:
    '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 5.8a2.3 2.3 0 0 0-2.3-2.3H6.3A2.3 2.3 0 0 0 4 5.8v6.9a2.3 2.3 0 0 0 2.3 2.3"/>',
  front: '<path d="M5 4h14"/><path d="M12 20V8.2"/><path d="M8 12.2 12 8.2l4 4"/>',
  back: '<path d="M5 20h14"/><path d="M12 4v11.8"/><path d="M8 11.8 12 15.8l4-4"/>',

  // files
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="8.6" cy="10" r="1.5"/><path d="M4.5 16.6l4.6-4.2 3.9 3.4 3.1-2.6 3.4 3.2"/>',
  download: '<path d="M12 4v10.6"/><path d="M8 11l4 4 4-4"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 20V9.4"/><path d="M8 13l4-4 4 4"/><path d="M5 4.5h14"/>',
  // Two stacked panes: the snapshot/baseline glyph — "a copy of the board".
  baseline: '<rect x="7" y="7" width="12.5" height="12.5" rx="2.2"/><rect x="4.5" y="4.5" width="12.5" height="12.5" rx="2.2"/>',
  clearBoard:
    '<rect x="4" y="5.5" width="16" height="13" rx="2.2"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',

  // chrome
  globe:
    '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.2 2.4 3.3 5.2 3.3 8.2s-1.1 5.8-3.3 8.2c-2.2-2.4-3.3-5.2-3.3-8.2S9.8 6.2 12 3.8Z"/>',

  // Board surface (white board / black board): a little board drawn in theme-proof colours.
  // The white board is a white sheet outlined in currentColor (readable on
  // both chrome themes); the black board is a currentColor slab — the text
  // colour itself, so it reads dark on the light chrome and light on the dark.
  boardWhite:
    '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5z" fill="#ffffff"/><path d="M8 19.5h8"/>',
  boardBlack:
    '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5z" fill="currentColor" stroke="none"/><path d="M8 19.5h8"/>',

  // Line-style samples for the style strip: one glyph per pattern, drawn as a
  // horizontal rule at stroke width so the button previews the dash it sets.
  lineSolid: '<path d="M4 12h16"/>',
  lineDashed: '<path d="M4 12h4M11 12h4M18 12h2.5"/>',
  lineDashDot: '<path d="M4 12h4M11.5 12h2M17 12h4"/>',
  // The custom stroke picker: an unfilled square — stroke reads as the
  // border (iconfont source, native 1024 grid scaled into the 24px viewBox).
  // Grey on the neutral panel; the chrome turns the frame white and lets the
  // swatch background carry the chosen colour when a custom stroke is active.
  strokeBox:
    '<g transform="scale(0.0234375)">' +
    '<path class="stroke-frame" fill="#959AA4" stroke="none" ' +
    'd="M880 112H144a32 32 0 0 0-32 32v736c0 17.706667 14.293333 32 32 32h736' +
    'a32 32 0 0 0 32-32V144a32 32 0 0 0-32-32z ' +
    'm-40.021333 728.021333H184.021333V184.021333h656v656z"/>' +
    '</g>',

  // The custom fill picker: a framed square with a solid centre (iconfont
  // source, same treatment). The centre is a separate element so the chrome
  // can paint it with the current custom colour — it changes with every pick;
  // the frame stays grey and the swatch background stays neutral, so the
  // colour reads once, in the place the fill actually goes.
  fillBox:
    '<g transform="scale(0.0234375)">' +
    '<path class="fill-frame" fill="#959AA4" stroke="none" ' +
    'd="M1024 1024H0V0h1024v1024zM102.4 921.6h819.2V102.4H102.4z"/>' +
    '<path class="fill-centre" fill="#959AA4" stroke="none" ' +
    'd="M204.8 819.2V204.8h614.4v614.4z"/>' +
    '</g>',
} as const;

export type IconName = keyof typeof ICONS;

/** Build one icon as a live SVG node sized in CSS pixels. */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const markup =
    `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
}
