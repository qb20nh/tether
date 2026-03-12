// @ts-nocheck
const LOCALE_LABELS = {
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
];
export const DEFAULT_LOCALE = 'ko-KR';
export const FALLBACK_EN_LOCALE = 'en';
export const LOCALE_STORAGE_KEY = 'tetherLocale';
const LOCALE_ORDER_SEED_KEY = 'tetherLocaleOrderSeed';
const AVAILABLE_LOCALES_STORAGE_KEY = 'tetherAvailableLocales';

const LOCALE_LOADERS = {
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

const LOCALE_ALIASES = {
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

const FALLBACK_BY_BASE = {
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

const loadedLocaleMessages = new Map();
const localeLoadPromises = new Map();
let cachedLocaleOrderSeed = null;
let cachedAvailableLocales = null;

const normalizeSeed = (value) => {
  const candidate = Number.parseInt(value, 10);
  if (!Number.isFinite(candidate)) return null;
  return candidate >>> 0;
};

const generateLocaleOrderSeed = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return (Math.random() * 0x100000000) >>> 0;
};

const readLocaleOrderSeed = () => {
  try {
    return normalizeSeed(window.localStorage.getItem(LOCALE_ORDER_SEED_KEY));
  } catch {
    return null;
  }
};

const writeLocaleOrderSeed = (seed) => {
  try {
    window.localStorage.setItem(LOCALE_ORDER_SEED_KEY, String(seed >>> 0));
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
};

const getLocaleOrderSeed = () => {
  if (cachedLocaleOrderSeed !== null) return cachedLocaleOrderSeed;

  let seed = readLocaleOrderSeed();
  if (seed === null) {
    seed = generateLocaleOrderSeed();
    writeLocaleOrderSeed(seed);
  }
  cachedLocaleOrderSeed = seed >>> 0;
  return cachedLocaleOrderSeed;
};

const createSeededRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleBySeed = (items, seed) => {
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

const resolvePath = (obj, keyPath) => keyPath.split('.').reduce((acc, part) => {
  if (!acc || typeof acc !== 'object') return undefined;
  return acc[part];
}, obj);

const normalizeLocale = (value) => {
  if (!value || typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase().replaceAll('_', '-');
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === candidate);
  if (exact) return exact;

  const aliasMatch = LOCALE_ALIASES[candidate];
  if (aliasMatch) return aliasMatch;

  const base = candidate.split('-')[0];
  return FALLBACK_BY_BASE[base] || null;
};

const readStoredLocale = () => {
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const detectNavigatorLocale = () => {
  if (typeof navigator === 'undefined') return null;
  return normalizeLocale(navigator.language || navigator.userLanguage || '');
};

const readAvailableLocales = () => {
  if (cachedAvailableLocales) return new Set(cachedAvailableLocales);
  try {
    const raw = window.localStorage.getItem(AVAILABLE_LOCALES_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    const normalized = new Set(
      (Array.isArray(parsed) ? parsed : [])
        .map((entry) => normalizeLocale(entry))
        .filter(Boolean),
    );
    cachedAvailableLocales = normalized;
  } catch {
    cachedAvailableLocales = new Set();
  }
  return new Set(cachedAvailableLocales);
};

const writeAvailableLocales = (locales) => {
  const normalized = new Set(
    [...locales]
      .map((entry) => normalizeLocale(entry))
      .filter(Boolean),
  );
  cachedAvailableLocales = normalized;
  try {
    window.localStorage.setItem(AVAILABLE_LOCALES_STORAGE_KEY, JSON.stringify([...normalized]));
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
};

export const isLocaleAvailable = (locale) => {
  const resolved = resolveLocale(locale);
  if (!resolved) return false;
  return loadedLocaleMessages.has(resolved) || readAvailableLocales().has(resolved);
};

export const markLocaleUnavailable = (locale) => {
  const resolved = resolveLocale(locale);
  if (!resolved) return;
  const next = readAvailableLocales();
  next.delete(resolved);
  writeAvailableLocales(next);
};

const markLocaleAvailable = (locale) => {
  const resolved = resolveLocale(locale);
  if (!resolved) return;
  const next = readAvailableLocales();
  next.add(resolved);
  writeAvailableLocales(next);
};

export const loadLocaleMessages = async (locale) => {
  const resolved = resolveLocale(locale);
  if (!resolved) return null;
  if (loadedLocaleMessages.has(resolved)) return loadedLocaleMessages.get(resolved);
  if (localeLoadPromises.has(resolved)) return localeLoadPromises.get(resolved);

  const load = LOCALE_LOADERS[resolved];
  if (typeof load !== 'function') {
    throw new TypeError(`Unsupported locale loader: ${resolved}`);
  }

  const promise = load()
    .then((module) => {
      const messages = module?.default ?? module;
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

export const preloadLocales = async (locales = []) => {
  const queue = [];
  for (const locale of locales) {
    const resolved = resolveLocale(locale);
    if (!resolved || queue.includes(resolved)) continue;
    queue.push(resolved);
  }
  for (const locale of queue) {
    await loadLocaleMessages(locale);
  }
  return queue;
};

export const preloadAllLocales = async () => preloadLocales(SUPPORTED_LOCALES);

export const resolveLocale = (locale) => {
  const explicit = normalizeLocale(locale);
  if (explicit) return explicit;

  const fromStorage = readStoredLocale();
  if (fromStorage) return fromStorage;

  const fromNavigator = detectNavigatorLocale();
  if (fromNavigator) return fromNavigator;

  return DEFAULT_LOCALE;
};

export const setLocale = async (locale) => {
  const resolved = resolveLocale(locale);
  await loadLocaleMessages(resolved);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
  return resolved;
};

const interpolate = (template, vars = {}) => {
  if (!vars || Object.keys(vars).length === 0) return String(template);
  return String(template).replaceAll(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.hasOwn(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
};

export const t = (locale) => {
  const activeLocale = resolveLocale(locale);
  const fallback = new Set([activeLocale, DEFAULT_LOCALE, FALLBACK_EN_LOCALE]);
  const fallbackOrder = Array.from(fallback);

  return (key, vars = {}) => {
    for (const element of fallbackOrder) {
      const localeKey = element;
      const messages = loadedLocaleMessages.get(localeKey);
      if (!messages) continue;
      const message = resolvePath(messages, key);
      if (message != null) return interpolate(message, vars);
    }
    return key;
  };
};

export const getLocale = () => resolveLocale();

export const getLocaleOptions = (locale, options = {}) => {
  const localeList = shuffleBySeed(SUPPORTED_LOCALES, getLocaleOrderSeed());
  const preferred = resolveLocale(locale) || null;
  const ordered = preferred ? [...localeList] : localeList;
  const online = options.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  if (preferred) {
    const currentIndex = ordered.indexOf(preferred);
    if (currentIndex > 0) {
      ordered.splice(currentIndex, 1);
      ordered.unshift(preferred);
    }
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
