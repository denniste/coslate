import type { ChromeTheme } from './types.js';

/**
 * Theme plumbing.
 *
 * The theme IS the set of `--coslate-*` custom properties; the stylesheet
 * defines one default per variable on the package root, and the `theme` option
 * overrides any subset on the mounted roots. Nothing here decides a look — it
 * only moves strings from a typed option object onto the DOM.
 */

/** The CSS custom property behind each {@link ChromeTheme} field. */
export const CHROME_THEME_VARS: Record<keyof ChromeTheme, string> = {
  bg: '--coslate-bg',
  panel: '--coslate-panel',
  panelAlt: '--coslate-panel-alt',
  border: '--coslate-border',
  text: '--coslate-text',
  muted: '--coslate-muted',
  accent: '--coslate-accent',
  accentSoft: '--coslate-accent-soft',
  danger: '--coslate-danger',
  radius: '--coslate-radius',
  zChrome: '--coslate-z-chrome',
  zTooltip: '--coslate-z-tooltip',
};

function entries(theme: Partial<ChromeTheme>): [keyof ChromeTheme, string][] {
  const pairs: [keyof ChromeTheme, string][] = [];
  for (const [key, value] of Object.entries(theme)) {
    if (value !== undefined) pairs.push([key as keyof ChromeTheme, value]);
  }
  return pairs;
}

/** Apply a partial theme to each root. Roots are separate elements, so each one gets it. */
export function applyTheme(roots: readonly HTMLElement[], theme: Partial<ChromeTheme> | undefined): void {
  if (!theme) return;
  for (const root of roots) {
    for (const [key, value] of entries(theme)) root.style.setProperty(CHROME_THEME_VARS[key], value);
  }
}

/** Undo {@link applyTheme}, so a destroyed chrome leaves the host's DOM as it found it. */
export function clearTheme(roots: readonly HTMLElement[], theme: Partial<ChromeTheme> | undefined): void {
  if (!theme) return;
  for (const root of roots) {
    for (const [key] of entries(theme)) root.style.removeProperty(CHROME_THEME_VARS[key]);
  }
}
