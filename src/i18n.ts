import type {
  LocaleOption,
  TranslateVars,
  Translator,
} from './contracts/ports.ts';

type LocaleMessages = Record<string, unknown>;
type LocaleModule = LocaleMessages | { default?: LocaleMessages };
type LocaleAvailabilityOptions = { online?: boolean };

interface NavigatorWithUserLanguage extends Navigator {
  userLanguage?: string;
}

const LOCALE_LABELS: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  it: 'Italiano',
  'it-IT': 'Italiano',
  'zh-Hans': '中文（简体）',
  'zh-Hant': '中文（繁體）',
  'es-419': 'Español (Latinoamérica)',
  'pt-BR': 'Português (Brasil)',
  ar: 'العربية',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
};

export const SUPPORTED_LOCALES = [
  'en',
  'it',
  'zh-Hans',
  'zh-Hant',
  'es-419',
  'pt-BR',
  'ar',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
] as const;
type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: SupportedLocale = 'ko-KR';
export const FALLBACK_EN_LOCALE: SupportedLocale = 'en';
export const LOCALE_STORAGE_KEY = 'tetherLocale';
const LOCALE_ORDER_SEED_KEY = 'tetherLocaleOrderSeed';
const AVAILABLE_LOCALES_STORAGE_KEY = 'tetherAvailableLocales';

const LOCALE_LOADERS: Record<SupportedLocale, () => Promise<LocaleModule>> = {
  en: () => import('../locales/en.js'),
  it: () => import('../locales/it.js'),
  'zh-Hans': () => import('../locales/zh-Hans.js'),
  'zh-Hant': () => import('../locales/zh-Hant.js'),
  'es-419': () => import('../locales/es-419.js'),
  'pt-BR': () => import('../locales/pt-BR.js'),
  ar: () => import('../locales/ar.js'),
  'ja-JP': () => import('../locales/ja-JP.js'),
  'ko-KR': () => import('../locales/ko-KR.js'),
  'de-DE': () => import('../locales/de-DE.js'),
  'fr-FR': () => import('../locales/fr-FR.js'),
};

const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  'en-uk': 'en',
  it: 'it',
  'it-it': 'it',
  zh: 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-my': 'zh-Hans',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-tw': 'zh-Hant',
  es: 'es-419',
  'es-419': 'es-419',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  ar: 'ar',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  ko: 'ko-KR',
  'ko-kr': 'ko-KR',
  de: 'de-DE',
  'de-de': 'de-DE',
  fr: 'fr-FR',
  'fr-fr': 'fr-FR',
};

const FALLBACK_BY_BASE: Record<string, SupportedLocale> = {
  en: 'en',
  it: 'it',
  zh: 'zh-Hans',
  es: 'es-419',
  pt: 'pt-BR',
  ar: 'ar',
  ja: 'ja-JP',
  ko: 'ko-KR',
  de: 'de-DE',
  fr: 'fr-FR',
};

const loadedLocaleMessages = new Map<SupportedLocale, LocaleMessages>();
const localeLoadPromises = new Map<SupportedLocale, Promise<LocaleMessages>>();
let cachedLocaleOrderSeed: number | null = null;
let cachedAvailableLocales: Set<SupportedLocale> | null = null;

const normalizeSeed = (value: unknown): number | null => {
  const candidate = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(candidate)) return null;
  return candidate >>> 0;
};

const generateLocaleOrderSeed = (): number => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return (Math.random() * 0x100000000) >>> 0;
};

const readLocaleOrderSeed = (): number | null => {
  try {
    return normalizeSeed(window.localStorage.getItem(LOCALE_ORDER_SEED_KEY));
  } catch {
    return null;
  }
};

const writeLocaleOrderSeed = (seed: number): void => {
  try {
    window.localStorage.setItem(LOCALE_ORDER_SEED_KEY, String(seed >>> 0));
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
};

const getLocaleOrderSeed = (): number => {
  if (cachedLocaleOrderSeed !== null) return cachedLocaleOrderSeed;

  let seed = readLocaleOrderSeed();
  if (seed === null) {
    seed = generateLocaleOrderSeed();
    writeLocaleOrderSeed(seed);
  }
  cachedLocaleOrderSeed = seed >>> 0;
  return cachedLocaleOrderSeed;
};

const createSeededRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleBySeed = <T>(items: readonly T[], seed: number): T[] => {
  const copy = [...items];
  const next = createSeededRng(seed);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
};

const resolvePath = (obj: unknown, keyPath: string): unknown =>
  keyPath.split('.').reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);

const normalizeLocale = (value: unknown): SupportedLocale | null => {
  if (!value || typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase().replaceAll('_', '-');
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === candidate);
  if (exact) return exact;

  const aliasMatch = LOCALE_ALIASES[candidate];
  if (aliasMatch) return aliasMatch;

  const base = candidate.split('-')[0];
  return FALLBACK_BY_BASE[base] || null;
};

const readStoredLocale = (): SupportedLocale | null => {
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const detectNavigatorLocale = (): SupportedLocale | null => {
  if (typeof navigator === 'undefined') return null;
  const navigatorWithUserLanguage = navigator as NavigatorWithUserLanguage;
  return normalizeLocale(navigatorWithUserLanguage.language || navigatorWithUserLanguage.userLanguage || '');
};

const readAvailableLocales = (): Set<SupportedLocale> => {
  if (cachedAvailableLocales) return new Set(cachedAvailableLocales);
  try {
    const raw = window.localStorage.getItem(AVAILABLE_LOCALES_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    const normalized = new Set<SupportedLocale>(
      (Array.isArray(parsed) ? parsed : [])
        .map((entry) => normalizeLocale(entry))
        .filter((entry): entry is SupportedLocale => entry !== null),
    );
    cachedAvailableLocales = normalized;
  } catch {
    cachedAvailableLocales = new Set<SupportedLocale>();
  }
  return new Set(cachedAvailableLocales);
};

const writeAvailableLocales = (locales: Iterable<unknown>): void => {
  const normalized = new Set<SupportedLocale>(
    [...locales]
      .map((entry) => normalizeLocale(entry))
      .filter((entry): entry is SupportedLocale => entry !== null),
  );
  cachedAvailableLocales = normalized;
  try {
    window.localStorage.setItem(AVAILABLE_LOCALES_STORAGE_KEY, JSON.stringify([...normalized]));
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
};

export const isLocaleAvailable = (locale: string): boolean => {
  const resolved = resolveLocale(locale);
  return loadedLocaleMessages.has(resolved) || readAvailableLocales().has(resolved);
};

export const markLocaleUnavailable = (locale: string): void => {
  const resolved = resolveLocale(locale);
  const next = readAvailableLocales();
  next.delete(resolved);
  writeAvailableLocales(next);
};

const markLocaleAvailable = (locale: string): void => {
  const resolved = resolveLocale(locale);
  const next = readAvailableLocales();
  next.add(resolved);
  writeAvailableLocales(next);
};

const resolveLocaleMessages = (module: LocaleModule): LocaleMessages => {
  if (module && typeof module === 'object' && 'default' in module) {
    const defaultExport = (module as { default?: LocaleMessages }).default;
    if (defaultExport && typeof defaultExport === 'object') return defaultExport;
  }
  return (module && typeof module === 'object' ? module : {}) as LocaleMessages;
};

export const loadLocaleMessages = async (locale: string): Promise<LocaleMessages | null> => {
  const resolved = resolveLocale(locale);
  if (loadedLocaleMessages.has(resolved)) return loadedLocaleMessages.get(resolved) || null;
  if (localeLoadPromises.has(resolved)) return localeLoadPromises.get(resolved) || null;

  const load = LOCALE_LOADERS[resolved];
  const promise = load()
    .then((module) => {
      const messages = resolveLocaleMessages(module);
      loadedLocaleMessages.set(resolved, messages);
      markLocaleAvailable(resolved);
      return messages;
    })
    .finally(() => {
      localeLoadPromises.delete(resolved);
    });

  localeLoadPromises.set(resolved, promise);
  return promise;
};

export const preloadLocales = async (locales: readonly unknown[] = []): Promise<SupportedLocale[]> => {
  const queue: SupportedLocale[] = [];
  for (const locale of locales) {
    const resolved = resolveLocale(typeof locale === 'string' ? locale : null);
    if (queue.includes(resolved)) continue;
    queue.push(resolved);
  }
  for (const locale of queue) {
    await loadLocaleMessages(locale);
  }
  return queue;
};

export const preloadAllLocales = async (): Promise<SupportedLocale[]> => preloadLocales(SUPPORTED_LOCALES);

export const resolveLocale = (locale?: string | null): SupportedLocale => {
  const explicit = normalizeLocale(locale);
  if (explicit) return explicit;

  const fromStorage = readStoredLocale();
  if (fromStorage) return fromStorage;

  const fromNavigator = detectNavigatorLocale();
  if (fromNavigator) return fromNavigator;

  return DEFAULT_LOCALE;
};

export const setLocale = async (locale: string): Promise<SupportedLocale> => {
  const resolved = resolveLocale(locale);
  await loadLocaleMessages(resolved);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
  return resolved;
};

const interpolate = (template: unknown, vars: TranslateVars = {}): string => {
  if (Object.keys(vars).length === 0) return String(template);
  return String(template).replaceAll(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.hasOwn(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
};

export const t = (locale?: string | null): Translator => {
  const activeLocale = resolveLocale(locale);
  const fallbackOrder = Array.from(new Set<SupportedLocale>([
    activeLocale,
    DEFAULT_LOCALE,
    FALLBACK_EN_LOCALE,
  ]));

  return (key: string, vars: TranslateVars = {}): string => {
    for (const localeKey of fallbackOrder) {
      const messages = loadedLocaleMessages.get(localeKey);
      if (!messages) continue;
      const message = resolvePath(messages, key);
      if (message != null) return interpolate(message, vars);
    }
    return key;
  };
};

export const getLocale = (): SupportedLocale => resolveLocale();

export const getLocaleOptions = (
  locale?: string | null,
  options: LocaleAvailabilityOptions = {},
): LocaleOption[] => {
  const localeList = shuffleBySeed(SUPPORTED_LOCALES, getLocaleOrderSeed());
  const preferred = resolveLocale(locale);
  const ordered = [...localeList];
  const online = options.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  const currentIndex = ordered.indexOf(preferred);
  if (currentIndex > 0) {
    ordered.splice(currentIndex, 1);
    ordered.unshift(preferred);
  }

  return ordered.map((code) => {
    const available = isLocaleAvailable(code);
    return {
      value: code,
      label: LOCALE_LABELS[code] || code,
      available,
      disabled: !online && !available,
    };
  });
};
