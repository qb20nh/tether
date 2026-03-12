import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocaleController } from '../../src/app/locale_controller.ts';

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createMemoryStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
};

test('createLocaleController initialize eagerly loads resolved initial locale and en', async () => {
  const loads = [];
  const controller = createLocaleController({
    navigatorObj: { onLine: true },
    storage: createMemoryStorage(),
    resolveLocale: (locale) => locale || 'fr-FR',
    loadLocaleMessages: async (locale) => {
      loads.push(locale);
    },
    createTranslator: (locale) => (key) => `${locale}:${key}`,
  });

  const locale = await controller.initialize('fr-FR');

  assert.equal(locale, 'fr-FR');
  assert.deepEqual(loads, ['fr-FR', 'en']);
  assert.equal(controller.translateNow('ui.language'), 'fr-FR:ui.language');
});

test('createLocaleController initialize deduplicates en boot loading', async () => {
  const loads = [];
  const controller = createLocaleController({
    navigatorObj: { onLine: true },
    storage: createMemoryStorage(),
    resolveLocale: () => 'en',
    loadLocaleMessages: async (locale) => {
      loads.push(locale);
    },
    createTranslator: (locale) => (key) => `${locale}:${key}`,
  });

  const locale = await controller.initialize();

  assert.equal(locale, 'en');
  assert.deepEqual(loads, ['en']);
});

test('createLocaleController falls back to en when the initial locale is unavailable offline', async () => {
  const availableLocales = new Set(['fr-FR']);
  const controller = createLocaleController({
    navigatorObj: { onLine: false },
    storage: createMemoryStorage(),
    resolveLocale: (locale) => locale || 'fr-FR',
    loadLocaleMessages: async (locale) => {
      if (locale === 'fr-FR') {
        throw new Error('offline');
      }
    },
    createTranslator: (locale) => (key) => `${locale}:${key}`,
    isLocaleAvailable: (locale) => availableLocales.has(locale),
    markLocaleUnavailable: (locale) => {
      availableLocales.delete(locale);
    },
  });

  const locale = await controller.initialize('fr-FR');

  assert.equal(locale, 'en');
  assert.equal(controller.getLocale(), 'en');
  assert.equal(availableLocales.has('fr-FR'), false);
});

test('createLocaleController persists only the latest async locale selection', async () => {
  const storage = createMemoryStorage();
  const writes = [];
  storage.setItem = (key, value) => {
    writes.push([key, String(value)]);
  };

  const pendingLoads = new Map();
  const loadLocaleMessages = (locale) => {
    if (locale === 'en') return Promise.resolve();
    const deferred = createDeferred();
    pendingLoads.set(locale, deferred);
    return deferred.promise;
  };

  const controller = createLocaleController({
    navigatorObj: { onLine: true },
    storage,
    resolveLocale: (locale) => locale || 'en',
    loadLocaleMessages,
    createTranslator: (locale) => (key) => `${locale}:${key}`,
  });

  await controller.initialize('en');

  const firstChange = controller.setLocale('fr-FR');
  const secondChange = controller.setLocale('de-DE');

  pendingLoads.get('de-DE').resolve();
  await secondChange;

  pendingLoads.get('fr-FR').resolve();
  const staleResolution = await firstChange;

  assert.equal(staleResolution, 'de-DE');
  assert.equal(controller.getLocale(), 'de-DE');
  assert.deepEqual(writes, [['tetherLocale', 'de-DE']]);
});

test('createLocaleController removes unavailable offline locales after a failed selection', async () => {
  const availableLocales = new Set(['fr-FR']);
  const controller = createLocaleController({
    navigatorObj: { onLine: false },
    storage: createMemoryStorage(),
    resolveLocale: (locale) => locale || 'en',
    loadLocaleMessages: async (locale) => {
      if (locale === 'fr-FR') {
        throw new Error('offline');
      }
    },
    createTranslator: (locale) => (key) => `${locale}:${key}`,
    isLocaleAvailable: (locale) => availableLocales.has(locale),
    markLocaleUnavailable: (locale) => {
      availableLocales.delete(locale);
    },
  });

  await controller.initialize('en');

  await assert.rejects(() => controller.setLocale('fr-FR'), /offline/);
  assert.equal(controller.getLocale(), 'en');
  assert.equal(availableLocales.has('fr-FR'), false);
});
