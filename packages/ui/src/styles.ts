/**
 * The chrome's stylesheet, shipped with the package and injected once.
 *
 * A host mounts the chrome and gets its look with no CSS pipeline: no file to
 * import, no build step, no global reset. Every rule is scoped under the
 * package-owned root class `.coslate-ui`, which the chrome puts on each mount
 * point, so nothing here can leak into the host page.
 *
 * Layout contract
 * ---------------
 * The toolbar and the status bar fill 100% of the element the host hands them
 * (never the viewport), and all responsive density is driven by **container
 * queries** on those roots — so the same chrome is correct in a 320px side
 * panel and in a 4K window, without the host resizing anything. The roots carry
 * `container-type: inline-size`, which also gives each root its own stacking
 * context.
 *
 * z-index contract
 * ----------------
 *   --coslate-z-chrome    30   the chrome roots (toolbar + status bar)
 *   --coslate-z-tooltip   40   the shared tooltip layer, above the chrome
 *      0 .. 29                 host page content and the embedded canvas
 *     41 ..  ∞                 host overlays (modals, menus) — above the tooltip
 *
 * A host that needs to sit above the chrome sets its own z-index above
 * `--coslate-z-tooltip`; it never has to know a class name or a magic number.
 *
 * Theme contract
 * --------------
 * Every colour and radius below reads from a `--coslate-*` custom property
 * defined on `.coslate-ui` and overridable per instance through the `theme`
 * option. The twelve named in `ChromeTheme` are the public set; the rest are
 * derived surfaces, still `--coslate-*` and still overridable.
 */

const STYLE_ELEMENT_ID = 'coslate-ui-styles';

const STYLESHEET = `
.coslate-ui {
  /* --- ChromeTheme: the public, host-overridable set --------------------- */
  --coslate-bg: #0f1115;
  --coslate-panel: #161a20;
  --coslate-panel-alt: #1c2129;
  --coslate-border: #262c36;
  --coslate-text: #e8eaed;
  --coslate-muted: #9aa4b2;
  --coslate-accent: #4dabf7;
  --coslate-accent-soft: rgba(77, 171, 247, 0.16);
  --coslate-danger: #ff6b6b;
  --coslate-radius: 10px;
  --coslate-z-chrome: 30;
  --coslate-z-tooltip: 40;

  /* --- Derived surfaces: still --coslate-*, still overridable ------------ */
  --coslate-toolbar-from: #171b22;
  --coslate-toolbar-to: #131720;
  --coslate-hover: #29313d;
  --coslate-hover-text: #ffffff;
  --coslate-accent-ring: rgba(77, 171, 247, 0.35);
  --coslate-accent-soft-strong: rgba(77, 171, 247, 0.24);
  --coslate-swatch-ring: rgba(0, 0, 0, 0.5);
  --coslate-tooltip-bg: #0b0e13;
  --coslate-tooltip-border: #2c333f;
  --coslate-tooltip-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
  --coslate-kbd-bg: #1a2028;

  /* One themed radius, a small scale derived from it. */
  --coslate-radius-sm: calc(var(--coslate-radius) - 4px);
  --coslate-radius-md: calc(var(--coslate-radius) - 3px);
  --coslate-radius-lg: calc(var(--coslate-radius) - 2px);
  --coslate-radius-xs: calc(var(--coslate-radius) - 6px);

  position: relative;
  z-index: var(--coslate-z-chrome);
  box-sizing: border-box;
  color-scheme: dark;
  color: var(--coslate-text);
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
}

.coslate-ui *,
.coslate-ui *::before,
.coslate-ui *::after {
  box-sizing: border-box;
}

/* The mini state: both mount points collapse, so the host's layout gives the
   canvas everything back. The attribute selector outranks the display rules. */
.coslate-ui.coslate-toolbar[hidden],
.coslate-ui.coslate-statusbar[hidden] {
  display: none;
}

/* ---------------------------------------------------------------- toolbar --
   The root only carries the container and the stacking context; the inner
   wrapper carries the chrome, so a container query measures the true width. */

.coslate-ui.coslate-toolbar {
  display: block;
  width: 100%;
  container-type: inline-size;
  user-select: none;
}

.coslate-ui .coslate-toolbar-inner {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 10px;
  background: linear-gradient(180deg, var(--coslate-toolbar-from), var(--coslate-toolbar-to));
  border-bottom: 1px solid var(--coslate-border);
}

.coslate-ui .toolbar-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* Grouped pill, tldraw-style: related controls share one rounded container, so
   the bar reads as a handful of clusters instead of twenty loose buttons.
   \`flex-wrap\` + \`max-width\` are the narrow-screen escape hatch: when a group no
   longer fits the container it wraps *inside* its pill rather than running off
   an edge that the host's \`overflow: hidden\` makes unreachable. */
.coslate-ui .toolbar-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  max-width: 100%;
  gap: 2px;
  padding: 3px;
  background: var(--coslate-panel-alt);
  border: 1px solid var(--coslate-border);
  border-radius: var(--coslate-radius);
}

/* The style cluster is reference, not action, so it sits on its own line and
   keeps its natural width instead of stretching across the bar. */
.coslate-ui .toolbar-style {
  align-self: flex-start;
  gap: 6px;
}

.coslate-ui .sep {
  width: 1px;
  height: 18px;
  background: var(--coslate-border);
  margin: 0 4px;
}

.coslate-ui button {
  font: inherit;
  color: var(--coslate-text);
  background: var(--coslate-panel-alt);
  border: 1px solid var(--coslate-border);
  border-radius: var(--coslate-radius-sm);
  padding: 5px 9px;
  cursor: pointer;
  line-height: 1.1;
}

.coslate-ui button:focus-visible {
  outline: 2px solid var(--coslate-accent);
  outline-offset: 1px;
}

.coslate-ui button:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Controls inside a group stay flat until hovered, so the group reads as one unit. */
.coslate-ui .toolbar-group > button {
  background: transparent;
  border-color: transparent;
}

.coslate-ui .icon-button {
  width: 32px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--coslate-radius-md);
}

.coslate-ui .icon-button svg {
  display: block;
}

.coslate-ui .icon-button:hover:not(:disabled) {
  background: var(--coslate-hover);
  color: var(--coslate-hover-text);
}

.coslate-ui .icon-button[aria-pressed='true'] {
  background: var(--coslate-accent-soft);
  color: var(--coslate-accent);
  box-shadow: inset 0 0 0 1px var(--coslate-accent-ring);
}

.coslate-ui .icon-button[aria-pressed='true']:hover:not(:disabled) {
  background: var(--coslate-accent-soft-strong);
}

.coslate-ui .swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px var(--coslate-swatch-ring);
  transition: transform 90ms ease-out;
}

.coslate-ui .swatch:hover {
  transform: translateY(-1px);
}

.coslate-ui .swatch[aria-pressed='true'] {
  border-color: var(--coslate-accent);
  box-shadow:
    inset 0 0 0 1px var(--coslate-swatch-ring),
    0 0 0 2px var(--coslate-accent-soft);
}

.coslate-ui .swatch-none {
  background:
    linear-gradient(45deg, transparent 44%, var(--coslate-danger) 44%, var(--coslate-danger) 56%, transparent 56%),
    var(--coslate-panel-alt);
}

.coslate-ui .width-button {
  min-width: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--coslate-radius-md);
}

.coslate-ui .width-button:hover:not(:disabled) {
  background: var(--coslate-hover);
}

.coslate-ui .width-button[aria-pressed='true'] {
  background: var(--coslate-accent-soft);
  color: var(--coslate-accent);
  box-shadow: inset 0 0 0 1px var(--coslate-accent-ring);
}

.coslate-ui .width-dot {
  display: block;
  border-radius: 50%;
  background: currentColor;
}

.coslate-ui .toolbar-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  color: var(--coslate-muted);
}

.coslate-ui .toolbar-glyph svg {
  display: block;
}

/* A native <select>: keyboard navigation, screen-reader support and the mobile
   picker come for free, which is exactly what a language menu needs. */
.coslate-ui .language-select {
  height: 30px;
  max-width: 132px;
  padding: 0 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--coslate-radius-md);
  color: var(--coslate-text);
  font: inherit;
  cursor: pointer;
}

.coslate-ui .language-select:hover {
  background: var(--coslate-hover);
}

.coslate-ui .language-select option {
  background: var(--coslate-panel-alt);
  color: var(--coslate-text);
}

.coslate-ui .zoom-label {
  min-width: 50px;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--coslate-radius-md);
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--coslate-muted);
}

.coslate-ui .zoom-label:hover:not(:disabled) {
  background: var(--coslate-hover);
  color: var(--coslate-text);
}

/* ------------------------------------------------------------- status bar -- */

.coslate-ui.coslate-statusbar {
  display: block;
  width: 100%;
  container-type: inline-size;
}

.coslate-ui .coslate-statusbar-inner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 6px 10px;
  background: var(--coslate-panel);
  border-top: 1px solid var(--coslate-border);
  color: var(--coslate-muted);
  font-size: 12px;
  user-select: none;
}

.coslate-ui .coslate-statusbar-inner strong {
  color: var(--coslate-text);
  font-weight: 600;
}

/* Counters keep their line; the debug hint (a developer affordance) is the only
   thing allowed to shorten. \`flex-basis: 0\` matters: flexbox breaks lines using
   the base size, so a content-sized hint would jump to a second row instead of
   ellipsizing. */
.coslate-ui .coslate-statusbar-inner > span {
  white-space: nowrap;
}

.coslate-ui .status-hint {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  opacity: 0.75;
  text-align: end;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Long messages (a load failure, say) shorten instead of reflowing the bar. */
.coslate-ui .status-message {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------------------------------------------------------------- tooltip --
   One fixed-position node shared by every control. It sits on the document
   body (so no host container can clip it) but still wears .coslate-ui, which is
   why these rules are written as \`.coslate-ui.tooltip\` rather than nested. */

.coslate-ui.tooltip {
  position: fixed;
  z-index: var(--coslate-z-tooltip);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 280px;
  padding: 5px 9px;
  background: var(--coslate-tooltip-bg);
  border: 1px solid var(--coslate-tooltip-border);
  border-radius: var(--coslate-radius-lg);
  box-shadow: var(--coslate-tooltip-shadow);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  animation: coslate-tooltip-in 90ms ease-out;
}

.coslate-ui.tooltip[hidden] {
  display: none;
}

.coslate-ui .tooltip-hint {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--coslate-muted);
  background: var(--coslate-kbd-bg);
  border: 1px solid var(--coslate-border);
  border-radius: var(--coslate-radius-xs);
  padding: 1px 5px;
}

@keyframes coslate-tooltip-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ------------------------------------------------------- narrow containers --
   Measured against the toolbar/status-bar container, never the viewport. Below
   ~560px the pills stop paying for themselves: each one costs padding and a
   border, and an atomic pill that does not fit the next row leaves a whole row
   half empty. So narrow mode drops the pill chrome and packs every control into
   one dense wrapped flow, keeping clusters apart with whitespace instead. The
   controls also give back a few pixels each, and the debug hint — a developer
   affordance, not a control — stops competing with the live counters for width. */

@container (max-width: 560px) {
  .coslate-ui .coslate-toolbar-inner {
    padding: 6px 8px;
    gap: 6px;
  }

  .coslate-ui .toolbar-main {
    gap: 6px 12px;
  }

  .coslate-ui .toolbar-group {
    padding: 0;
    background: transparent;
    border-color: transparent;
    border-radius: 0;
    gap: 4px;
  }

  .coslate-ui .toolbar-style {
    gap: 8px;
  }

  .coslate-ui .sep {
    height: 16px;
    margin: 0 2px;
  }

  .coslate-ui .icon-button {
    width: 30px;
    height: 28px;
  }

  .coslate-ui .zoom-label {
    min-width: 46px;
    height: 28px;
    padding: 0 6px;
  }

  .coslate-ui .width-button {
    min-width: 28px;
    height: 28px;
  }

  .coslate-ui .swatch {
    width: 20px;
    height: 20px;
  }

  .coslate-ui .language-select {
    height: 28px;
    max-width: 108px;
  }

  .coslate-ui .status-hint {
    display: none;
  }
}

/* Below ~400px a 28px control is the difference between two rows and three: the
   eight-tool cluster plus undo/redo fits one line only if each button gives back
   another 2px. Still comfortably above the 24px minimum target size. */
@container (max-width: 400px) {
  .coslate-ui .coslate-toolbar-inner {
    padding: 5px 7px;
  }

  .coslate-ui .toolbar-main {
    gap: 5px 10px;
  }

  .coslate-ui .icon-button {
    width: 28px;
    height: 26px;
  }

  .coslate-ui .icon-button svg {
    width: 18px;
    height: 18px;
  }

  .coslate-ui .zoom-label {
    min-width: 42px;
    height: 26px;
  }

  .coslate-ui .width-button {
    min-width: 26px;
    height: 26px;
  }

  .coslate-ui .swatch {
    width: 18px;
    height: 18px;
  }
}
`;

const injected = new WeakSet<Document>();

/**
 * Inject the chrome stylesheet into `doc`, once. Idempotent across calls and
 * across instances in the same document; safe to call from a host before
 * mounting, and called automatically by {@link createChrome}.
 */
export function ensureChromeStyles(doc: Document = document): void {
  if (injected.has(doc)) return;
  if (!doc.getElementById(STYLE_ELEMENT_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = STYLESHEET;
    (doc.head ?? doc.documentElement).append(style);
  }
  injected.add(doc);
}
