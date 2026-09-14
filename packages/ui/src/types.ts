import type { WhiteboardEditor } from '@coslate/konva';

/**
 * Public types for `@coslate/ui`.
 *
 * The chrome is a *client* of the host's translator and of `WhiteboardEditor`.
 * It owns no copy of its own: every label, hint, accessible name and status
 * message is a key the host resolves, and every colour/radius is a custom
 * property the host can override.
 */

/** Values interpolated into a message. `{count}` numbers are locale-formatted. */
export type ChromeParams = Record<string, string | number>;

/**
 * Every message key the chrome itself asks for.
 *
 * The generic `K` on {@link ChromeI18n} is the host's own (usually larger) key
 * union; this package-owned subset is what the chrome *requires* a host catalog
 * to cover. Declaring it here means a host whose catalog is missing a key fails
 * to type-check instead of showing a raw key at runtime, while the chrome still
 * never hard-codes a sentence.
 */
export type ChromeMessageKey =
  // Toolbar group names — the `aria-label`s of the pills.
  | 'group.tools'
  | 'group.history'
  | 'group.zoom'
  | 'group.selection'
  | 'group.file'
  | 'group.style'
  | 'group.language'
  // Tools. The shortcut badge beside each is a key name, never translated.
  | 'tool.select.label'
  | 'tool.pen.label'
  | 'tool.eraser.label'
  | 'tool.rect.label'
  | 'tool.ellipse.label'
  | 'tool.line.label'
  | 'tool.arrow.label'
  | 'tool.text.label'
  // History and object actions.
  | 'action.undo'
  | 'action.redo'
  | 'action.delete'
  | 'action.duplicate'
  | 'action.front'
  | 'action.back'
  // Camera.
  | 'zoom.out'
  | 'zoom.in'
  | 'zoom.fit'
  | 'zoom.reset'
  // File.
  | 'file.exportPng'
  | 'file.saveJson'
  | 'file.loadJson'
  | 'file.clear'
  // Style.
  | 'style.stroke'
  | 'style.width'
  | 'style.fill.none'
  | 'style.fill.white'
  | 'style.fill.panel'
  // Status bar: the four counter labels, the initial message and the two the
  // chrome raises itself (a load that worked, a load that did not).
  | 'status.tool'
  | 'status.selection'
  | 'status.objects'
  | 'status.zoom'
  | 'status.newScene'
  | 'status.loaded'
  | 'status.loadFailed'
  // The language menu's accessible name.
  | 'language.label';

/**
 * The translator the host injects.
 *
 * Structurally this is what `@coslate/core`'s `I18n` already provides plus the
 * language menu's `languages` list, so a host can hand over its own wrapper
 * without adapting anything but the `t` union. The chrome never calls
 * `Intl`-backed methods other than through `t`; numbers it formats itself from
 * `locale`, so it does not depend on any formatter the host happens to expose.
 */
export interface ChromeI18n<K extends string = string> {
  t(key: K, params?: ChromeParams): string;
  readonly locale: string;
  readonly dir: 'ltr' | 'rtl';
  readonly languages: readonly { tag: string; label: string }[];
  setLocale(tag: string): string;
  subscribe(listener: (locale: string) => void): () => void;
}

/**
 * The chrome's theme, one CSS custom property per field.
 *
 * A partial theme only overrides what it names; every other value keeps the
 * package default from the injected stylesheet, so a host that cares about two
 * colours does not have to restate the other ten.
 */
export interface ChromeTheme {
  bg: string;
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  danger: string;
  radius: string;
  zChrome: string;
  zTooltip: string;
}

export interface ChromeOptions<K extends string = string> {
  toolbar: HTMLElement;
  statusbar: HTMLElement;
  editor: WhiteboardEditor;
  /** The host injects all copy; see {@link ChromeMessageKey} for what is asked. */
  i18n: ChromeI18n<K>;
  /** CSS custom properties, applied per instance. */
  theme?: Partial<ChromeTheme>;
  /** `'none'` is the mini state: the canvas fills the layout and no chrome shows. */
  chrome?: 'full' | 'none';
  /**
   * Optional developer hint for the status bar — a code sample, not prose, so it
   * deliberately stays a host string rather than a catalog key. Omit it and the
   * hint element is simply empty.
   */
  statusHint?: string;
}

export interface Chrome<K extends string = string> {
  /** Re-read the editor and re-render every translated string. */
  sync(): void;
  /** Set the status message by *key*, so it re-renders on a locale change. */
  setStatus(key: K, params?: ChromeParams): void;
  /** Toggle the whole chrome; `false` leaves the canvas alone in the layout. */
  setChromeVisible(visible: boolean): void;
  isChromeVisible(): boolean;
  /** Unbind every listener and remove everything the chrome added. */
  destroy(): void;
}
