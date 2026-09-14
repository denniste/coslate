import { createI18n, type Direction, type I18n, type MessageParams } from '@coslate/core';
import type { ChromeI18n } from '@coslate/ui';
import { en, type DemoCatalog, type MessageKey } from './catalog-en.js';
import { zhCN } from './catalog-zh-CN.js';
import { zhHant } from './catalog-zh-Hant.js';
import { ar } from './catalog-ar.js';

/**
 * Demo i18n wiring.
 *
 * `@coslate/core` owns the mechanism — catalogs, BCP 47 matching, plurals,
 * formatting, direction. This file makes the product decisions core deliberately
 * refuses to make: which catalogs ship, where a choice is remembered, how the
 * browser's preference is detected, and which DOM attributes a switch updates.
 * A host embedding CoSlate would write its own version of exactly this file,
 * against the same `createI18n` contract.
 *
 * Detection order is the conventional one: `?lang=` (shareable and testable) →
 * remembered choice → `navigator.languages` → English.
 */

const STORAGE_KEY = 'coslate:locale:v1';
const URL_PARAM = 'lang';

/**
 * Catalogs the demo ships, keyed by BCP 47 tag. Declaration order only breaks
 * ties that likely subtags leave open — `zh-TW` resolves to `zh-Hant` on script
 * evidence, not on this order.
 */
const catalogs: Record<string, DemoCatalog> = {
  en,
  'zh-CN': zhCN,
  'zh-Hant': zhHant,
  ar,
};

export interface LanguageOption {
  tag: string;
  /** The language's name *in that language*, so the menu is readable to someone
   *  who cannot yet read the current UI language. */
  label: string;
}

export interface DemoI18n extends ChromeI18n<MessageKey> {
  /** The core translator, for the places that need more than the chrome does. */
  readonly i18n: I18n<DemoCatalog>;
  readonly languages: readonly LanguageOption[];
  readonly storageKey: string;
  /** Switch, remember, reflect into the URL, and update the document. */
  setLocale(tag: string): string;
}

declare global {
  interface Window {
    /** Documented test/debug surface, alongside `window.__scene`. */
    __i18n?: {
      locale: string;
      dir: Direction;
      available: readonly string[];
      languages: readonly LanguageOption[];
      storageKey: string;
      setLocale(tag: string): string;
      t(key: string, params?: MessageParams): string;
    };
  }
}

/** `zh-CN` → `中文`: a language's name in its own language, per CLDR. */
function endonym(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function storedLocale(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM) ?? localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    // Private mode, or a host that sandboxes storage: fall back to detection.
    return undefined;
  }
}

function browserLocales(): string[] {
  const languages = navigator.languages;
  if (Array.isArray(languages) && languages.length > 0) return [...languages];
  return navigator.language ? [navigator.language] : [];
}

/**
 * Reflect the locale onto the document. `lang` matters for screen readers,
 * hyphenation, font selection and `:lang()`; `dir` matters for the entire
 * layout, because the toolbar, the style pill and the status line are all flex
 * rows that mirror on their own once the writing direction flips. The title and
 * the description are user-visible metadata too, so they move with the locale.
 */
function applyDocument(i18n: I18n<DemoCatalog>): void {
  document.documentElement.lang = i18n.locale;
  document.documentElement.dir = i18n.dir;
  document.title = i18n.t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.t('app.description'));
}

export function installI18n(): DemoI18n {
  const explicit = storedLocale();
  const i18n = createI18n<DemoCatalog>({
    catalogs,
    locale: explicit,
    requested: browserLocales(),
    fallbackLocale: 'en',
  });

  const languages: LanguageOption[] = Object.keys(catalogs).map((tag) => ({ tag, label: endonym(tag) }));

  const api: DemoI18n = {
    i18n,
    languages,
    storageKey: STORAGE_KEY,
    // The chrome-facing surface: the same translator, plus the language menu's
    // options and the locale-change subscription. `@coslate/ui` never needs to
    // know that `@coslate/core` sits behind it.
    get locale() {
      return i18n.locale;
    },
    get dir() {
      return i18n.dir;
    },
    subscribe: (listener) => i18n.subscribe(listener),
    t: (key, params) => i18n.t(key, params),
    setLocale(tag) {
      const resolved = i18n.setLocale(tag);
      try {
        localStorage.setItem(STORAGE_KEY, resolved);
      } catch {
        /* the URL still carries the choice */
      }
      const url = new URL(window.location.href);
      url.searchParams.set(URL_PARAM, resolved);
      window.history.replaceState(null, '', url);
      applyDocument(i18n);
      return resolved;
    },
  };

  applyDocument(i18n);
  window.__i18n = {
    get locale() {
      return i18n.locale;
    },
    get dir() {
      return i18n.dir;
    },
    available: i18n.available,
    languages,
    storageKey: STORAGE_KEY,
    setLocale: (tag) => api.setLocale(tag),
    t: (key, params) => i18n.t(key as MessageKey, params),
  };
  return api;
}
