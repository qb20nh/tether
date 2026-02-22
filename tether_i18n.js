import enMessages from './locales/en.js';
import itMessages from './locales/it.js';
import zhHansMessages from './locales/zh-Hans.js';
import zhHantMessages from './locales/zh-Hant.js';
import es419Messages from './locales/es-419.js';
import ptBrMessages from './locales/pt-BR.js';
import arMessages from './locales/ar.js';
import jaJPMessages from './locales/ja-JP.js';
import koKrMessages from './locales/ko-KR.js';
import deDeMessages from './locales/de-DE.js';
import frFrMessages from './locales/fr-FR.js';

const LOCALE_LABELS = {
  ko: '한국어',
  en: 'English',
  'en-US': 'English',
  'en-GB': 'English',
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

const LOCALE_MAP = {
  en: enMessages,
  it: itMessages,
  'zh-Hans': zhHansMessages,
  'zh-Hant': zhHantMessages,
  'es-419': es419Messages,
  'pt-BR': ptBrMessages,
  ar: arMessages,
  'ja-JP': jaJPMessages,
  'ko-KR': koKrMessages,
  'de-DE': deDeMessages,
  'fr-FR': frFrMessages,
};

const LOCALE_ALIASES = {
  'en': 'en',
  'en-us': 'en',
  'en-gb': 'en',
  'en-uk': 'en',
  it: 'it',
  'it-it': 'it',
  'zh': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-my': 'zh-Hans',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-tw': 'zh-Hant',
  'es': 'es-419',
  'es-419': 'es-419',
  'pt': 'pt-BR',
  'pt-br': 'pt-BR',
  'ar': 'ar',
  'ja': 'ja-JP',
  'ja-jp': 'ja-JP',
  'ko': 'ko-KR',
  'ko-kr': 'ko-KR',
  'de': 'de-DE',
  'de-de': 'de-DE',
  'fr': 'fr-FR',
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

const resolvePath = (obj, keyPath) => {
  return keyPath.split('.').reduce((acc, part) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return acc[part];
  }, obj);
};

const normalizeLocale = (value) => {
  if (!value || typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase().replace(/_/g, '-');
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
  const candidate = normalizeLocale(navigator.language || navigator.userLanguage || '');
  return candidate;
};

export const resolveLocale = (locale) => {
  const explicit = normalizeLocale(locale);
  if (explicit) return explicit;

  const fromStorage = readStoredLocale();
  if (fromStorage) return fromStorage;

  const fromNavigator = detectNavigatorLocale();
  if (fromNavigator) return fromNavigator;

  return DEFAULT_LOCALE;
};

export const setLocale = (locale) => {
  const resolved = resolveLocale(locale);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
  } catch {
    // localStorage might be unavailable in restricted contexts.
  }
  return resolved;
};

const interpolate = (template, vars = {}) => {
  if (!vars || Object.keys(vars).length === 0) return String(template);
  return String(template).replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
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
    for (let i = 0; i < fallbackOrder.length; i++) {
      const localeKey = fallbackOrder[i];
      const message = resolvePath(LOCALE_MAP[localeKey], key);
      if (message != null) return interpolate(message, vars);
    }
    return key;
  };
};

export const getLocale = () => resolveLocale();

export const getLocaleOptions = (locale) => {
  return SUPPORTED_LOCALES.map((code) => ({
    value: code,
    label: LOCALE_LABELS[code] || code,
  }));
};
