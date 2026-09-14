import { describe, expect, it, vi } from 'vitest';
import {
  canonicalLocale,
  createI18n,
  localeDirection,
  lookupLocale,
  type Catalog,
  type Message,
} from '@coslate/core';

const en = {
  'greeting': 'Hello',
  'tool.pen': 'Pen',
  'item.one': '{count} item',
  'status.objects': { one: '{count} object', other: '{count} objects' },
} satisfies Catalog;

type EnKey = keyof typeof en;
type EnCatalog = Record<EnKey, Message>;

const zhCN: EnCatalog = {
  'greeting': '你好',
  'tool.pen': '画笔',
  'item.one': '{count} 个项目',
  'status.objects': { other: '{count} 个对象' },
};

const ar: EnCatalog = {
  'greeting': 'مرحبا',
  'tool.pen': 'قلم',
  'item.one': '{count} عنصر',
  'status.objects': {
    zero: 'لا عناصر',
    one: 'عنصر واحد',
    two: 'عنصران',
    few: '{count} عناصر',
    many: '{count} عنصرًا',
    other: '{count} عنصر',
  },
};

const catalogs = { en, 'zh-CN': zhCN, ar };

const makeI18n = (options: { locale?: string; requested?: readonly string[] } = {}) =>
  createI18n<EnCatalog>({ catalogs, fallbackLocale: 'en', ...options });

describe('i18n: tag canonicalization', () => {
  it('canonicalizes case and structure, and rejects nonsense', () => {
    expect(canonicalLocale('zh-cn')).toBe('zh-CN');
    expect(canonicalLocale('EN-us')).toBe('en-US');
    expect(canonicalLocale('ar')).toBe('ar');
    expect(canonicalLocale('not a tag')).toBeNull();
    expect(canonicalLocale('')).toBeNull();
  });
});

describe('i18n: RFC 4647 lookup', () => {
  const available = ['en', 'zh-CN', 'ar'];

  it('matches exactly, ignoring case and canonical form', () => {
    expect(lookupLocale(['en'], available)).toBe('en');
    expect(lookupLocale(['zh-cn'], available)).toBe('zh-CN');
    expect(lookupLocale(['ZH-CN'], available)).toBe('zh-CN');
  });

  it('truncates subtags until something matches', () => {
    // `zh-Hant-TW` exhausts its chain, then `zh` extends to the catalog that exists.
    expect(lookupLocale(['zh-Hant-TW'], available)).toBe('zh-CN');
    expect(lookupLocale(['en-GB'], available)).toBe('en');
  });

  it('honours the priority order of the requested chain', () => {
    // The first requested tag is exhausted before the next one is considered.
    expect(lookupLocale(['zh-TW', 'ar', 'en'], available)).toBe('zh-CN');
    expect(lookupLocale(['de', 'ar', 'en'], available)).toBe('ar');
  });

  it('lets a bare language match the region catalog it does have', () => {
    // Strict RFC 4647 would fall back to the default here; a browser asking for
    // `zh` wants the Chinese that exists.
    expect(lookupLocale(['zh'], available)).toBe('zh-CN');
  });

  it('uses CLDR likely subtags to tell Simplified from Traditional', () => {
    const chinese = ['en', 'zh-CN', 'zh-Hant', 'ar'];
    // `zh-TW` is really `zh-Hant-TW`, so it matches `zh-Hant` exactly.
    expect(lookupLocale(['zh-TW'], chinese)).toBe('zh-Hant');
    expect(lookupLocale(['zh-HK'], chinese)).toBe('zh-Hant');
    expect(lookupLocale(['zh-Hant'], chinese)).toBe('zh-Hant');
    expect(lookupLocale(['zh-CN'], chinese)).toBe('zh-CN');
    expect(lookupLocale(['zh-SG'], chinese)).toBe('zh-CN');
    // A bare `zh` is `zh-Hans-CN`, so Simplified wins on shared subtags — in
    // either declaration order, and without consulting the order at all.
    expect(lookupLocale(['zh'], chinese)).toBe('zh-CN');
    expect(lookupLocale(['zh'], [...chinese].reverse())).toBe('zh-CN');
  });

  it('falls back to the other Chinese catalog when only one exists', () => {
    expect(lookupLocale(['zh-TW'], ['en', 'zh-CN', 'ar'])).toBe('zh-CN');
    expect(lookupLocale(['zh-CN'], ['en', 'zh-Hant', 'ar'])).toBe('zh-Hant');
  });

  it('falls back when nothing matches, and never returns nothing', () => {
    expect(lookupLocale(['de', 'fr'], available, 'en')).toBe('en');
    expect(lookupLocale([], available, 'en')).toBe('en');
    expect(lookupLocale(['de'], [], 'en')).toBe('en');
    expect(lookupLocale(['de'], ['de-DE'], 'en')).toBe('de-DE');
  });
});

describe('i18n: direction', () => {
  it('knows right-to-left from left-to-right', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('he')).toBe('rtl');
    expect(localeDirection('fa-IR')).toBe('rtl');
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('zh-CN')).toBe('ltr');
  });

  it('follows the script when language and script disagree', () => {
    expect(localeDirection('ku-Latn')).toBe('ltr');
    expect(localeDirection('ku-Arab')).toBe('rtl');
  });

  it('defaults to ltr for tags it cannot parse', () => {
    expect(localeDirection('not a tag')).toBe('ltr');
    expect(localeDirection('')).toBe('ltr');
  });
});

describe('i18n: translation', () => {
  it('resolves the requested chain, then the fallback', () => {
    expect(makeI18n({ requested: ['zh-CN'] }).locale).toBe('zh-CN');
    expect(makeI18n({ requested: ['zh'] }).locale).toBe('zh-CN');
    expect(makeI18n({ requested: ['de-AT', 'ar'] }).locale).toBe('ar');
    expect(makeI18n({ requested: ['de-AT'] }).locale).toBe('en');
  });

  it('prefers an explicit locale over the requested chain', () => {
    expect(makeI18n({ locale: 'ar', requested: ['zh-CN'] }).locale).toBe('ar');
  });

  it('translates and interpolates string parameters', () => {
    const i18n = makeI18n({ locale: 'zh-CN' });
    expect(i18n.t('greeting')).toBe('你好');
    expect(i18n.t('tool.pen')).toBe('画笔');
    expect(makeI18n().t('item.one', { count: 'many' })).toBe('many item');
  });

  it('formats numeric parameters instead of stringifying them', () => {
    // 1234 arrives as "1,234": proof the value went through NumberFormat.
    expect(makeI18n().t('item.one', { count: 1234 })).toContain('1,234');
    const arabic = makeI18n({ locale: 'ar' }).t('item.one', { count: 1234 });
    expect(arabic).not.toContain('1234');
    expect(arabic).toContain('234');
  });

  it('selects the plural category the message declares', () => {
    const i18n = makeI18n();
    expect(i18n.t('status.objects', { count: 1 })).toBe('1 object');
    expect(i18n.t('status.objects', { count: 3 })).toBe('3 objects');
    // Chinese has a single category; Arabic has six and uses them.
    expect(makeI18n({ locale: 'zh-CN' }).t('status.objects', { count: 3 })).toBe('3 个对象');
    const arabic = makeI18n({ locale: 'ar' });
    expect(arabic.t('status.objects', { count: 0 })).toBe('لا عناصر');
    expect(arabic.t('status.objects', { count: 1 })).toBe('عنصر واحد');
    expect(arabic.t('status.objects', { count: 2 })).toBe('عنصران');
    expect(arabic.t('status.objects', { count: 3 })).toContain('عناصر');
    expect(arabic.t('status.objects', { count: 11 })).toContain('عنصرًا');
  });

  it('falls back to the `other` form when a category is missing', () => {
    // English selects `one` for 1, but this catalog only declares `other`.
    const onlyOther: EnCatalog = { ...en, 'status.objects': { other: '{count} things' } };
    const i18n = createI18n<EnCatalog>({ catalogs: { en: onlyOther }, locale: 'en' });
    expect(i18n.t('status.objects', { count: 1 })).toBe('1 things');
  });

  it('falls back per key, not per catalog', () => {
    const partial = { ...zhCN, greeting: undefined } as unknown as EnCatalog;
    const i18n = createI18n<EnCatalog>({ catalogs: { en, 'zh-CN': partial }, locale: 'zh-CN', fallbackLocale: 'en' });
    expect(i18n.t('greeting')).toBe('Hello');
    expect(i18n.t('tool.pen')).toBe('画笔');
  });

  it('returns the key when nothing defines it, rather than throwing or blanking', () => {
    const i18n = makeI18n();
    expect(i18n.t('missing.key' as EnKey)).toBe('missing.key');
    expect(i18n.t('missing.key' as EnKey, { count: 1 })).toBe('missing.key');
  });

  it('leaves an un-supplied placeholder in place', () => {
    expect(makeI18n().t('item.one')).toBe('{count} item');
  });

  it('reports whether a key would resolve', () => {
    const i18n = makeI18n({ locale: 'zh-CN' });
    expect(i18n.has('greeting')).toBe(true);
    expect(i18n.has('missing.key')).toBe(false);
  });
});

describe('i18n: switching', () => {
  it('switches locale and notifies subscribers once per real change', () => {
    const i18n = makeI18n();
    const seen = vi.fn();
    const unsubscribe = i18n.subscribe(seen);

    expect(i18n.setLocale('zh-CN')).toBe('zh-CN');
    expect(i18n.locale).toBe('zh-CN');
    expect(i18n.dir).toBe('ltr');
    expect(seen).toHaveBeenCalledTimes(1);

    i18n.setLocale('zh-CN');
    expect(seen).toHaveBeenCalledTimes(1);

    expect(i18n.setLocale('ar')).toBe('ar');
    expect(i18n.dir).toBe('rtl');
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenLastCalledWith('ar');

    unsubscribe();
    i18n.setLocale('en');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('resolves an unknown or malformed request instead of failing', () => {
    const i18n = makeI18n();
    expect(i18n.setLocale('de')).toBe('en');
    expect(i18n.setLocale('not a tag')).toBe('en');
    expect(i18n.locale).toBe('en');
  });

  it('requires at least one catalog', () => {
    expect(() => createI18n({ catalogs: {} })).toThrow(/at least one catalog/);
  });

  it('re-formats numbers and lists after a switch', () => {
    const i18n = makeI18n();
    expect(i18n.formatNumber(0.42, { style: 'percent' })).toBe('42%');
    expect(i18n.formatList(['a', 'b', 'c'])).toBe('a, b, and c');

    i18n.setLocale('ar');
    // CLDR's default numbering system for `ar` is Latin digits; asking for the
    // Arabic-Indic system is an explicit request, and it is honoured.
    expect(i18n.formatNumber(123, { numberingSystem: 'arab' })).toBe('١٢٣');
    expect(i18n.formatNumber(123)).toContain('123');
    expect(i18n.formatList(['أ', 'ب'])).not.toContain(' and ');
  });
});
