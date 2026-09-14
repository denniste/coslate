/**
 * Locale primitives: typed catalogs, BCP 47 matching, plural selection, localized
 * formatting and text direction.
 *
 * Core ships the *mechanism*, never the language: there is not one user-visible
 * string in this file. A host supplies catalogs, asks for a locale, and gets a
 * translator back. That split is what keeps principle 9 intact — no DOM here, so
 * the same catalog can drive a canvas, an HTML chrome, a worker or a server-side
 * thumbnail — and it means `@coslate/core` still has zero dependencies.
 *
 * Standards this leans on, rather than reinventing: BCP 47 tags, RFC 4647 lookup,
 * and the `Intl` objects (`Locale`, `PluralRules`, `NumberFormat`, `ListFormat`)
 * for everything locale-dependent. The three places those are not enough — a
 * missing key, a missing plural form, a runtime without `textInfo` — are handled
 * here, explicitly, instead of being papered over by a library.
 */

/** Writing direction of a locale's script. */
export type Direction = 'ltr' | 'rtl';

/** Values interpolated into a message: `{count}` may be numeric or a string. */
export type MessageParams = Record<string, string | number>;

/**
 * One message in every plural form the locale's `Intl.PluralRules` can select.
 * A locale only needs the categories it actually uses — Chinese needs `other`,
 * Arabic needs six — and a missing category falls back to `other`.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;

/** A plain string, or plural forms keyed by CLDR plural category. */
export type Message = string | PluralForms;

/** A flat `key → message` map. Dots namespace keys: `tool.pen.label`. */
export type Catalog = Record<string, Message>;

/** Used when the host asks for nothing, or asks for something nobody ships. */
export const DEFAULT_LOCALE = 'en';

/** Canonical BCP 47 form (`zh-cn` → `zh-CN`), or `null` for an invalid tag. */
export function canonicalLocale(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

// Scripts and languages written right-to-left. Only consulted when the runtime
// cannot answer: `Intl.Locale.prototype.textInfo` (ES2024) is authoritative and
// knows things a table cannot, e.g. that Kurdish in Latin script is LTR.
const RTL_SCRIPTS = new Set(['adlm', 'arab', 'hebr', 'nkoo', 'rohg', 'syrc', 'thaa', 'yezi']);
const LTR_SCRIPTS = new Set(['cyrl', 'deva', 'grek', 'hang', 'hans', 'hant', 'hira', 'kana', 'latn', 'thai']);
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'ha', 'he', 'khw', 'ks', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi']);

/** Writing direction for a locale tag; defaults to `ltr` for anything unknown. */
export function localeDirection(tag: string): Direction {
  try {
    const locale = new Intl.Locale(tag) as Intl.Locale & { textInfo?: { direction?: string } };
    const direction = locale.textInfo?.direction;
    if (direction === 'rtl' || direction === 'ltr') return direction;
  } catch {
    // Invalid tag: the table below still gets a chance.
  }
  const subtags = tag.toLowerCase().split('-').filter(Boolean);
  if (subtags.some((part) => RTL_SCRIPTS.has(part))) return 'rtl';
  if (subtags.some((part) => LTR_SCRIPTS.has(part))) return 'ltr';
  return RTL_LANGUAGES.has(subtags[0] ?? '') ? 'rtl' : 'ltr';
}

/** `zh-Hant-TW` → `['zh-Hant-TW', 'zh-Hant', 'zh']`; empty for an invalid tag. */
function truncationChain(tag: string): string[] {
  let current = canonicalLocale(tag);
  const chain: string[] = [];
  while (current) {
    chain.push(current);
    const cut = current.lastIndexOf('-');
    if (cut <= 0) break;
    current = current.slice(0, cut);
  }
  return chain;
}

/**
 * CLDR *likely subtags* via `Intl.Locale.prototype.maximize()`: `zh-TW` is really
 * `zh-Hant-TW`, and `zh` is really `zh-Hans-CN`. Without this, a Traditional
 * Chinese reader asking for `zh-TW` can only be matched by guessing which Chinese
 * catalog happens to be listed first.
 */
function maximize(tag: string): string {
  try {
    return new Intl.Locale(tag).maximize().toString();
  } catch {
    return tag;
  }
}

/** Leading subtags two tags share, case-insensitively: `zh-Hant-TW`/`zh-Hant-HK` → 2. */
function sharedPrefix(a: string, b: string): number {
  const left = a.toLowerCase().split('-');
  const right = b.toLowerCase().split('-');
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
  return shared;
}

/**
 * RFC 4647 *lookup*, plus CLDR likely subtags, plus one deliberate extension.
 *
 * Lookup proper walks each requested tag's truncation chain (`zh-Hant-TW` →
 * `zh-Hant` → `zh`) looking for an exact match. That is correct and, on its own,
 * useless in the common case: a browser asking for `zh` finds nothing when the
 * only catalog is `zh-CN`, and falls all the way back to English.
 *
 * So each requested tag is tried three ways, in order:
 *
 * 1. its truncation chain, exactly as RFC 4647 says;
 * 2. the truncation chain of its *maximized* form, so `zh-TW` finds a `zh-Hant`
 *    catalog exactly rather than by guessing;
 * 3. nearest catalog by shared leading subtags of the maximized forms, requiring
 *    at least the primary language to match — so `zh` prefers `zh-CN` over
 *    `zh-Hant` because `zh-Hans-CN` shares more with it, whatever the order the
 *    catalogs were declared in.
 *
 * A requested tag is exhausted before the next one is considered, so a user who
 * asked for `zh-TW` gets Chinese rather than the Arabic they listed second.
 */
export function lookupLocale(
  requested: readonly string[],
  available: readonly string[],
  fallback: string = DEFAULT_LOCALE,
): string {
  const entries = available.map((tag) => {
    const canonical = canonicalLocale(tag) ?? tag;
    return { tag, canonical, maximized: maximize(canonical) };
  });
  const find = (tag: string): string | undefined =>
    entries.find((entry) => entry.canonical.toLowerCase() === tag.toLowerCase())?.tag;

  for (const want of requested) {
    for (const tag of truncationChain(want)) {
      const exact = find(tag);
      if (exact) return exact;
    }
    for (const tag of truncationChain(maximize(want))) {
      const exact = find(tag);
      if (exact) return exact;
    }
    const target = maximize(want);
    let best: string | undefined;
    let bestScore = 0;
    for (const entry of entries) {
      const score = sharedPrefix(entry.maximized, target);
      if (score > bestScore) {
        bestScore = score;
        best = entry.tag;
      }
    }
    if (best) return best;
  }

  const canonicalFallback = canonicalLocale(fallback)?.toLowerCase();
  return (
    entries.find((entry) => entry.canonical.toLowerCase() === canonicalFallback)?.tag ?? available[0] ?? fallback
  );
}

export interface I18nOptions<TCatalog extends Catalog> {
  /** Every catalog the host ships, keyed by BCP 47 tag (`en`, `zh-CN`, `ar`). */
  catalogs: Record<string, TCatalog>;
  /** An explicit choice — a user preference. Wins over `requested`. */
  locale?: string;
  /** Preference chain, typically `navigator.languages`, used when `locale` is unset. */
  requested?: readonly string[];
  /** Second chance for matching *and* for missing keys. Defaults to `'en'`. */
  fallbackLocale?: string;
}

export interface I18n<TCatalog extends Catalog = Catalog> {
  /** The resolved catalog tag — always one of `available`, never a failed request. */
  readonly locale: string;
  readonly dir: Direction;
  readonly available: readonly string[];
  readonly fallbackLocale: string;
  /** Translate. A key that resolves to nothing returns the key itself. */
  t(key: keyof TCatalog & string, params?: MessageParams): string;
  /** Whether `t(key)` would return a real message rather than the key. */
  has(key: string): boolean;
  /** Switch locale; returns the tag actually resolved. */
  setLocale(locale: string): string;
  /** Observe locale changes; returns an unsubscribe function. */
  subscribe(listener: (locale: string) => void): () => void;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatList(items: readonly string[], options?: Intl.ListFormatOptions): string;
}

/**
 * Build a translator over a set of catalogs.
 *
 * The returned object is deliberately small and host-agnostic: applying
 * `document.documentElement.lang`/`dir`, persisting a choice and rendering a
 * language menu are product decisions, so they stay in the application.
 */
export function createI18n<TCatalog extends Catalog>(options: I18nOptions<TCatalog>): I18n<TCatalog> {
  const available = Object.keys(options.catalogs);
  if (available.length === 0) throw new Error('createI18n: at least one catalog is required');

  const fallbackLocale = lookupLocale([options.fallbackLocale ?? DEFAULT_LOCALE], available, available[0]!);
  const resolve = (tag: string): string => lookupLocale([tag], available, fallbackLocale);

  let locale = options.locale ? resolve(options.locale) : lookupLocale(options.requested ?? [], available, fallbackLocale);
  const listeners = new Set<(locale: string) => void>();

  const pluralCache = new Map<string, Intl.PluralRules>();
  const numberCache = new Map<string, Intl.NumberFormat>();
  const listCache = new Map<string, Intl.ListFormat>();

  function pluralRulesFor(tag: string): Intl.PluralRules {
    let rules = pluralCache.get(tag);
    if (!rules) {
      rules = new Intl.PluralRules(tag);
      pluralCache.set(tag, rules);
    }
    return rules;
  }

  function interpolate(message: string, params: MessageParams | undefined): string {
    if (params === undefined) return message;
    return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      if (value === undefined) return placeholder;
      // Numbers go through the locale's formatter, so `{count}` is `١٢` in Arabic
      // rather than a stringified 12.
      return typeof value === 'number' ? numberFormat(value) : value;
    });
  }

  /** The text one catalog has for a key, before falling back to another catalog. */
  function pick(key: string, params: MessageParams | undefined, tag: string): string | undefined {
    const message = options.catalogs[tag]?.[key];
    if (message === undefined) return undefined;
    if (typeof message === 'string') return message;
    const count = typeof params?.count === 'number' ? params.count : Number(params?.count ?? 0);
    return message[pluralRulesFor(tag).select(count)] ?? message.other;
  }

  function chain(): readonly string[] {
    return locale === fallbackLocale ? [locale] : [locale, fallbackLocale];
  }

  function numberFormat(value: number, formatOptions?: Intl.NumberFormatOptions): string {
    const cacheKey = formatOptions ? `${locale}|${JSON.stringify(formatOptions)}` : locale;
    let formatter = numberCache.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, formatOptions);
      numberCache.set(cacheKey, formatter);
    }
    return formatter.format(value);
  }

  return {
    get locale() {
      return locale;
    },
    get dir() {
      return localeDirection(locale);
    },
    available,
    fallbackLocale,

    t(key, params) {
      for (const tag of chain()) {
        const text = pick(key, params, tag);
        if (text !== undefined) return interpolate(text, params);
      }
      // Never blank and never a throw: an untranslated string has to be visible
      // in the UI, or nobody ever notices it is missing.
      return key;
    },

    has(key) {
      return chain().some((tag) => pick(key, undefined, tag) !== undefined);
    },

    setLocale(next) {
      const resolved = resolve(next);
      if (resolved === locale) return locale;
      locale = resolved;
      for (const listener of [...listeners]) listener(locale);
      return locale;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    formatNumber(value, formatOptions) {
      return numberFormat(value, formatOptions);
    },

    formatList(items, formatOptions) {
      const options = formatOptions ?? { style: 'long', type: 'conjunction' };
      const cacheKey = `${locale}|${JSON.stringify(options)}`;
      let formatter = listCache.get(cacheKey);
      if (!formatter) {
        formatter = new Intl.ListFormat(locale, options);
        listCache.set(cacheKey, formatter);
      }
      return formatter.format([...items]);
    },
  };
}
