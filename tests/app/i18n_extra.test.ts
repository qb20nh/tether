import assert from 'node:assert/strict';
import test from '../test.ts';
import { vi } from 'vitest';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const createStorage = (initial: Record<string, string> = {}): StorageLike => {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
};

const loadI18nModule = async (
  caseId: 'a' | 'b',
  initialStorage: Record<string, string> = {},
  navigatorLanguage = 'fr-FR',
) => {
  vi.resetModules();
  vi.stubGlobal('window', {
    localStorage: createStorage(initialStorage),
  });
  vi.stubGlobal('navigator', {
    language: navigatorLanguage,
  });
  vi.stubGlobal('crypto', {
    getRandomValues(values: Uint32Array) {
      values[0] = 7;
      return values;
    },
  });
  if (caseId === 'a') {
    const modulePath = '../../src/i18n.ts?case=a';
    return import(modulePath);
  }
  const modulePath = '../../src/i18n.ts?case=b';
  return import(modulePath);
};

test('i18n resolves locales, stores availability, and translates nested keys', async (t) => {
  const mod = await loadI18nModule('a', {
    tetherLocale: 'es',
    tetherAvailableLocales: JSON.stringify(['en', 'fr-FR']),
  }, 'zh-TW');
  t.after(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  assert.equal(mod.resolveLocale('ko'), 'ko-KR');
  assert.equal(mod.resolveLocale('zh-TW'), 'zh-Hant');
  assert.equal(mod.resolveLocale('unknown'), 'es-419');
  assert.equal(mod.getLocale(), 'es-419');
  assert.equal(mod.isLocaleAvailable('fr-FR'), true);
  mod.markLocaleUnavailable('fr-FR');
  assert.equal(mod.isLocaleAvailable('fr-FR'), false);

  const loaded = await mod.loadLocaleMessages('en');
  assert.equal(typeof loaded?.ui, 'object');
  const translator = mod.t('en');
  assert.notEqual(translator('ui.theme'), 'ui.theme');
  assert.equal(translator('ui.themeSwitchPrompt', { theme: 'Light' }).includes('Light'), true);
});

test('i18n preloads locales and exposes locale options with offline awareness', async (t) => {
  const mod = await loadI18nModule('b', {}, 'en-US');
  t.after(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const preloaded = await mod.preloadLocales(['en', 'fr-FR', 'bad-locale', 'en']);
  assert.deepEqual(preloaded.sort(), ['en', 'fr-FR']);

  const all = await mod.preloadAllLocales();
  assert.equal(all.includes('ko-KR'), true);

  await mod.setLocale('fr-FR');
  const options = mod.getLocaleOptions('fr-FR', { online: false });
  assert.equal(options.some((option: { value: string; disabled?: boolean }) => option.value === 'fr-FR' && option.disabled === false), true);
  assert.equal(options.some((option: { value: string }) => option.value === 'ko-KR'), true);
  assert.equal(mod.DEFAULT_LOCALE, 'ko-KR');
  assert.equal(mod.FALLBACK_EN_LOCALE, 'en');
});
