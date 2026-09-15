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
  // The custom-colour pickers: a painter's palette and brush (iconfont
  // source), kept on its native 1024 grid and scaled into our 24px viewBox —
  // the glyph fills the swatch at icon size, where the earlier hand-drawn
  // palette read small. Board, dabs and brush are separate elements so the
  // chrome can colour foreground and background independently: the dabs are
  // the holes in the board and read as the secondary colour.
  palette:
    '<g transform="scale(0.0234375)">' +
    '<path class="palette-body" fill="currentColor" stroke="none" ' +
    'd="M835.642431 684.038119c117.19469 150.218096-37.528924 305.760896-255.636999 335.097969' +
    'l-11.724589 1.433574 1.945565-1.843167a276.987014 276.987014 0 0 0 71.67871-195.734077' +
    'l34.559378-14.079746a298.132234 298.132234 0 0 0 159.075537-124.925752z"/>' +
    '<path class="palette-body" fill="currentColor" stroke="none" ' +
    'd="M507.763532 0.018432c172.2337-1.382375 306.272887 76.030631 348.92172 170.236935' +
    'l-168.444968 147.965337q-66.200408 58.162153-131.069641 117.75788' +
    'c-82.78891 77.310608-90.161577 129.021678-108.695643 218.108074' +
    'a239.611687 239.611687 0 0 0-189.743785 139.159096' +
    'c-37.119332 63.230862-69.42595 66.558802-138.237512 48.383129' +
    'A511.990784 511.990784 0 0 1 507.814732 0.018432z"/>' +
    '<path class="palette-dab" fill="currentColor" stroke="none" ' +
    'd="M214.03442 458.966971a85.246466 85.246466 0 1 0 60.619708 24.524358' +
    ' 85.297665 85.297665 0 0 0-60.619708-24.524358z"/>' +
    '<path class="palette-dab" fill="currentColor" stroke="none" ' +
    'd="M299.536881 202.971579a85.092868 85.092868 0 1 0 60.414912 24.473159' +
    ' 85.092868 85.092868 0 0 0-60.414912-24.473159z"/>' +
    '<path class="palette-dab" fill="currentColor" stroke="none" ' +
    'd="M555.532273 117.673914a85.195266 85.195266 0 1 0 60.466111 24.370761' +
    ' 85.297665 85.297665 0 0 0-60.466111-24.268363z"/>' +
    '<path class="palette-body" fill="currentColor" stroke="none" ' +
    'd="M477.300081 737.89955l78.385789 65.432422' +
    'c19.558048 236.283747-269.409551 288.967599-385.068269 127.997696' +
    ' 195.682878 16.383705 125.591339-191.535752 306.68248-193.430118z"/>' +
    '</g>',

  // The custom stroke picker: a colour wheel under an eyedropper (iconfont
  // source), on its native 1024 grid scaled into the 24px viewBox. The wheel
  // segments and the eyedropper ship literal fills — the colours are the
  // glyph's meaning — tagged by role so the chrome can recolour them in the
  // active state (white on the chosen colour, dark accents).
  colorWheel:
    '<g transform="scale(0.0234375)">' +
    '<path class="picker-wheel" fill="#FB3A82" stroke="none" ' +
    'd="M823.154 512c0 171.852-139.302 311.154-311.154 311.154l-24.724 95.976' +
    'L512 1024c282.778 0 512-229.222 512-512l-104.822-24.724z"/>' +
    '<path class="picker-wheel" fill="#27D1B3" stroke="none" ' +
    'd="M512 0C229.222 0 0 229.222 0 512l93.71 12.362L200.846 512' +
    'c0-171.852 139.302-311.154 311.154-311.154l12.362-103.222z"/>' +
    '<path class="picker-wheel" fill="#31A7FB" stroke="none" ' +
    'd="M0 512c0 282.778 229.222 512 512 512V823.154' +
    'c-171.852 0-311.154-139.302-311.154-311.154z"/>' +
    '<path class="picker-wheel" fill="#FC9744" stroke="none" ' +
    'd="M1024 512C1024 229.222 794.778 0 512 0v200.846' +
    'c171.852 0 311.154 139.302 311.154 311.154z"/>' +
    '<path class="picker-wheel" fill="#FB8627" stroke="none" ' +
    'd="M1024 512h-83.176c0-254.476-185.598-465.56-428.824-505.284V0' +
    'c282.784 0 512 229.216 512 512z"/>' +
    '<path class="picker-wheel" fill="#FB8627" stroke="none" ' +
    'd="M917.582 255.424c24.56 29.236 23.096 73.04-4.388 100.526' +
    '-14.072 14.052-32.78 21.798-52.662 21.798-13.124 0-25.734-3.38-36.818-9.724' +
    'l-24.374 24.374a311.38 311.38 0 0 0-68.198-101.288l142.516-141.546' +
    'a513.416 513.416 0 0 1 67.168 82.62z"/>' +
    '<path class="picker-wheel" fill="#FB1466" stroke="none" ' +
    'd="M1024 512c0 282.784-229.216 512-512 512v-6.716' +
    'C755.226 977.56 940.824 766.476 940.824 512z"/>' +
    '<path class="picker-dropper" fill="#CBE5E7" stroke="none" ' +
    'd="M725.932 188.392L460.014 454.308c-15.696 15.696-15.696 41.146 0 56.844' +
    'l-42.162 42.162c-14.294 14.294-15.354 37.584-1.576 52.378' +
    ' 14.464 15.53 38.79 15.856 53.668 0.978l42.794-42.794' +
    'c15.698 15.698 41.146 15.698 56.844 0L835.5 297.96z"/>' +
    '<path class="picker-dropper" fill="#A9D3D8" stroke="none" ' +
    'd="M787.36 346.1l48.14-48.14-109.568-109.568-48.14 48.14 109.568 109.568z"/>' +
    '<path class="picker-dropper" fill="#A9D3D8" stroke="none" ' +
    'd="M835.498 297.97L569.588 563.88a40.068 40.068 0 0 1-28.412 11.786' +
    ' 40.072 40.072 0 0 1-28.432-11.786l-42.794 42.794' +
    'c-14.876 14.876-39.208 14.546-53.672-0.99-6.388-6.84-9.58-15.514-9.746-24.25' +
    'a37.12 37.12 0 0 0 27.28-10.9l34.532-34.532c4.296-4.294 10.966-5.194 16.188-2.09' +
    'a40.122 40.122 0 0 0 20.506 5.616 40.064 40.064 0 0 0 28.412-11.786L799.36 261.832z"/>' +
    '<path class="picker-dark" fill="#3F5959" stroke="none" ' +
    'd="M884.046 279.764c-13.548-13.548-13.548-35.516 0-49.064l55.666-55.666' +
    'c25.088-25.088 25.088-65.766 0-90.856-25.088-25.088-65.766-25.088-90.854 0' +
    'l-55.666 55.666c-13.548 13.548-35.516 13.548-49.064 0-12.99-12.99-34.052-12.99-47.042 0' +
    '-12.99 12.99-12.99 34.052 0 47.042l139.92 139.92c12.99 12.99 34.052 12.99 47.042 0' +
    ' 12.99-12.99 12.99-34.052-0.002-47.042z"/>' +
    '<path class="picker-dark" fill="#384848" stroke="none" ' +
    'd="M884.04 230.698c-13.536 13.558-13.536 35.52 0 49.058 6.49 6.51 9.746 15.02 9.746 23.53' +
    's-3.256 17.018-9.746 23.53c-12.98 12.98-34.038 12.98-47.038 0l-41.928-41.928' +
    'c13 12.98 34.058 12.98 47.038 0 6.51-6.49 9.746-15.02 9.746-23.53' +
    's-3.234-17.04-9.746-23.53c-13.536-13.536-13.536-35.5 0-49.058l55.672-55.672' +
    'c17.534-17.514 22.808-42.65 15.844-64.758a63.804 63.804 0 0 1 26.084 15.844' +
    'c25.096 25.074 25.096 65.766 0 90.842z"/>' +
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
