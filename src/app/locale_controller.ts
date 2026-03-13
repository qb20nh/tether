import {
  FALLBACK_EN_LOCALE,
  LOCALE_STORAGE_KEY,
  t as createTranslatorCore,
  getLocaleOptions as getLocaleOptionsCore,
  isLocaleAvailable as isLocaleAvailableCore,
  loadLocaleMessages as loadLocaleMessagesCore,
  markLocaleUnavailable as markLocaleUnavailableCore,
  preloadAllLocales as preloadAllLocalesCore,
  resolveLocale as resolveLocaleCore,
} from '../i18n.ts';
import type {
  LocaleControllerPort,
  LocaleOption,
  NavigatorLike,
  StorageLike,
  Translator,
} from '../contracts/ports.ts';

type ResolveLocale = (locale?: string | null) => string;
type LoadLocaleMessages = (locale: string) => Promise<unknown>;
type PreloadAllLocales = () => Promise<unknown>;
type CreateTranslator = (locale: string) => Translator;
type IsLocaleAvailable = (locale: string) => boolean;
type MarkLocaleUnavailable = (locale: string) => void;

export interface LocaleControllerOptions {
  navigatorObj?: NavigatorLike;
  storage?: StorageLike | null;
  initialLocale?: string;
  resolveLocale?: ResolveLocale;
  loadLocaleMessages?: LoadLocaleMessages;
  preloadAllLocales?: PreloadAllLocales;
  createTranslator?: CreateTranslator;
  isLocaleAvailable?: IsLocaleAvailable;
  markLocaleUnavailable?: MarkLocaleUnavailable;
}

export function createLocaleController(
  options: LocaleControllerOptions = {},
): LocaleControllerPort {
  const navigatorObj = options.navigatorObj || (typeof navigator === 'undefined' ? undefined : navigator);
  const storage = options.storage || (typeof window === 'undefined' ? null : window.localStorage);
  const resolveLocale = (options.resolveLocale || resolveLocaleCore) as ResolveLocale;
  const loadLocaleMessages = (options.loadLocaleMessages || loadLocaleMessagesCore) as LoadLocaleMessages;
  const preloadAllLocales = (options.preloadAllLocales || preloadAllLocalesCore) as PreloadAllLocales;
  const buildTranslator = (options.createTranslator || createTranslatorCore) as CreateTranslator;
  const isLocaleAvailable = (options.isLocaleAvailable || isLocaleAvailableCore) as IsLocaleAvailable;
  const markLocaleUnavailable = (options.markLocaleUnavailable || markLocaleUnavailableCore) as MarkLocaleUnavailable;
  let activeLocale = resolveLocale(options.initialLocale);
  let activeTranslator: Translator = (key) => key;
  let localeChangeToken = 0;

  const isOnline = () => navigatorObj?.onLine !== false;

  const refreshTranslator = () => {
    activeTranslator = buildTranslator(activeLocale);
  };

  const persistLocale = (locale: string) => {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // localStorage might be unavailable in restricted contexts.
    }
  };

  const handleLocaleLoadFailure = (locale: string) => {
    if (!isOnline() && isLocaleAvailable(locale)) {
      markLocaleUnavailable(locale);
    }
  };

  const initialize = async (locale?: string) => {
    const resolvedInitialLocale = resolveLocale(locale);
    const eagerLocales = resolvedInitialLocale === FALLBACK_EN_LOCALE
      ? [FALLBACK_EN_LOCALE]
      : [resolvedInitialLocale, FALLBACK_EN_LOCALE];
    const loadedLocales = new Set<string>();

    for (const code of eagerLocales) {
      try {
        await loadLocaleMessages(code);
        loadedLocales.add(code);
      } catch {
        handleLocaleLoadFailure(code);
      }
    }

    const fallbackLocale = loadedLocales.has(FALLBACK_EN_LOCALE)
      ? FALLBACK_EN_LOCALE
      : resolvedInitialLocale;
    activeLocale = loadedLocales.has(resolvedInitialLocale)
      ? resolvedInitialLocale
      : fallbackLocale;
    refreshTranslator();
    return activeLocale;
  };

  const getLocaleOptions = (locale = activeLocale): LocaleOption[] =>
    getLocaleOptionsCore(locale, { online: isOnline() }) as LocaleOption[];

  const setLocale = async (locale: string) => {
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
    createTranslator: (locale = activeLocale) => buildTranslator(locale),
    translateNow: (key, vars = {}) => activeTranslator(key, vars),
    preloadAllLocales: preloadAll,
    isOnline,
  };
}
