import {
  FALLBACK_EN_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocaleOptions as getLocaleOptionsCore,
  isLocaleAvailable as isLocaleAvailableCore,
  loadLocaleMessages as loadLocaleMessagesCore,
  markLocaleUnavailable as markLocaleUnavailableCore,
  preloadAllLocales as preloadAllLocalesCore,
  resolveLocale as resolveLocaleCore,
  t as createTranslatorCore,
} from '../i18n.js';

export function createLocaleController(options = {}) {
  const navigatorObj = options.navigatorObj || (typeof navigator !== 'undefined' ? navigator : undefined);
  const storage = options.storage || (typeof window !== 'undefined' ? window.localStorage : null);
  const resolveLocale = options.resolveLocale || resolveLocaleCore;
  const loadLocaleMessages = options.loadLocaleMessages || loadLocaleMessagesCore;
  const preloadAllLocales = options.preloadAllLocales || preloadAllLocalesCore;
  const createTranslator = options.createTranslator || createTranslatorCore;
  const isLocaleAvailable = options.isLocaleAvailable || isLocaleAvailableCore;
  const markLocaleUnavailable = options.markLocaleUnavailable || markLocaleUnavailableCore;
  let activeLocale = resolveLocale(options.initialLocale);
  let activeTranslator = (key) => key;
  let localeChangeToken = 0;

  const isOnline = () => navigatorObj?.onLine !== false;

  const refreshTranslator = () => {
    activeTranslator = createTranslator(activeLocale);
  };

  const persistLocale = (locale) => {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // localStorage might be unavailable in restricted contexts.
    }
  };

  const handleLocaleLoadFailure = (locale) => {
    if (!isOnline() && isLocaleAvailable(locale)) {
      markLocaleUnavailable(locale);
    }
  };

  const initialize = async (locale) => {
    const resolvedInitialLocale = resolveLocale(locale);
    const eagerLocales = resolvedInitialLocale === FALLBACK_EN_LOCALE
      ? [FALLBACK_EN_LOCALE]
      : [resolvedInitialLocale, FALLBACK_EN_LOCALE];
    const loadedLocales = new Set();

    for (const code of eagerLocales) {
      try {
        await loadLocaleMessages(code);
        loadedLocales.add(code);
      } catch {
        handleLocaleLoadFailure(code);
      }
    }

    activeLocale = loadedLocales.has(resolvedInitialLocale)
      ? resolvedInitialLocale
      : (loadedLocales.has(FALLBACK_EN_LOCALE) ? FALLBACK_EN_LOCALE : resolvedInitialLocale);
    refreshTranslator();
    return activeLocale;
  };

  const getLocaleOptions = (locale = activeLocale) =>
    getLocaleOptionsCore(locale, { online: isOnline() });

  const setLocale = async (locale) => {
    const resolved = resolveLocale(locale);
    const requestToken = ++localeChangeToken;
    try {
      await loadLocaleMessages(resolved);
    } catch (error) {
      handleLocaleLoadFailure(resolved);
      throw error;
    }
    if (requestToken !== localeChangeToken) return activeLocale;
    persistLocale(resolved);
    activeLocale = resolved;
    refreshTranslator();
    return activeLocale;
  };

  const preloadAll = async () => {
    await preloadAllLocales();
    refreshTranslator();
    return getLocaleOptions();
  };

  refreshTranslator();

  return {
    initialize,
    getLocale: () => activeLocale,
    resolveLocale,
    getLocaleOptions,
    setLocale,
    createTranslator: (locale = activeLocale) => createTranslator(locale),
    translateNow: (key, vars = {}) => activeTranslator(key, vars),
    preloadAllLocales: preloadAll,
    isOnline,
  };
}
