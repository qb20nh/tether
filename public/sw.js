const BUILD_NUMBER = Number.parseInt('__TETHER_BUILD_NUMBER__', 10) || 0;
const BUILD_LABEL = '__TETHER_BUILD_LABEL__';

const APP_CACHE_PREFIX = 'tether-app-';
const DAILY_CACHE_PREFIX = 'tether-daily-';
/** @param {number} buildNumber */
const appCacheNameForBuild = (buildNumber) => `${APP_CACHE_PREFIX}${buildNumber}`;
/** @param {number} buildNumber */
const dailyCacheNameForBuild = (buildNumber) => `${DAILY_CACHE_PREFIX}${buildNumber}`;
const APP_CACHE = appCacheNameForBuild(BUILD_NUMBER);
const DAILY_CACHE = dailyCacheNameForBuild(BUILD_NUMBER);
const LEGACY_META_CACHE = 'tether-meta-v1';
const UPDATE_POLICY_META_CACHE = 'sw-update-policy-meta-v1';
const META_DB_NAME = 'tether-meta-v1';
const META_DB_VERSION = 1;
const META_STORE_NAME = 'meta';
const APP_CACHE_MAX_ENTRIES = 180;
const DAILY_CACHE_MAX_ENTRIES = 2;
const UPDATE_POLICY_VERSION = 1;

const DAILY_CHECK_TAG = 'tether-daily-check';
const DEFAULT_WARNING_HOURS = 8;
const HISTORY_MAX_ENTRIES = 10;
const HISTORY_VERSION_START = 1;
const SW_PLUGIN_QUERY_PARAM = 'plugin';
const DAILY_PAYLOAD_PATH_SUFFIX = '__TETHER_DAILY_PAYLOAD_PATH__';
const META_RECORD_KEYS = Object.freeze({
  DAILY_STATE: 'daily-state',
  HISTORY_STATE: 'notification-history',
  UPDATE_POLICY: 'update-policy',
});

const notificationDefaults = Object.freeze({
  unsolvedTitle: 'Daily level ending soon',
  unsolvedBody: 'Your daily level is still unsolved. Time is running out.',
  newLevelTitle: 'New daily level available',
  newLevelBody: 'A new daily level is ready to play.',
});

const HISTORY_MARKERS = Object.freeze({
  UNREAD: 'unread',
  JUST_READ: 'just-read',
  OLDER: 'older',
});

/**
 * @typedef {{ bypassCache?: boolean }} FetchFreshOptions
 * @typedef {{ bypassCache?: boolean, shellResponse?: Response | null }} CacheShellAssetOptions
 * @typedef {{ matcher?: ((request: Request) => boolean) | null }} TrimCacheOptions
 * @typedef {{ cacheName?: string, pinned?: boolean }} CacheFirstRevalidateOptions
 * @typedef {{ version?: unknown, updatedAtMs?: unknown, autoUpdateEnabled?: unknown, pinnedBuildNumber?: unknown, currentBuildNumber?: unknown }} UpdatePolicyPayload
 * @typedef {{ version: number, updatedAtMs: number, autoUpdateEnabled: boolean, pinnedBuildNumber: number }} UpdatePolicyState
 * @typedef {{ servingBuildNumber: number, appCacheName: string, pinned: boolean, pinnedCacheUsable?: boolean }} ServingBuildPlan
 * @typedef {{ unsolvedTitle: string, unsolvedBody: string, newLevelTitle: string, newLevelBody: string }} NotificationTextState
 * @typedef {{ dailyId?: unknown, hardInvalidateAtUtcMs?: unknown, dailySolvedDate?: unknown, notificationsEnabled?: unknown, warningHours?: unknown, warnedDailyId?: unknown, newLevelDailyId?: unknown, notificationText?: { unsolvedTitle?: unknown, unsolvedBody?: unknown, newLevelTitle?: unknown, newLevelBody?: unknown } | null }} DailyStatePayload
 * @typedef {{ buildNumber: number, buildLabel: string, updatedAtMs: number, dailyId: string, hardInvalidateAtUtcMs: number | null, dailySolvedDate: string, notificationsEnabled: boolean, warningHours: number, warnedDailyId: string, newLevelDailyId: string, notificationText: NotificationTextState }} DailyState
 * @typedef {'unread' | 'just-read' | 'older'} HistoryMarker
 * @typedef {{ type: 'apply-update', buildNumber: number } | { type: 'open-daily', dailyId: string } | null} HistoryAction
 * @typedef {{ id?: unknown, source?: unknown, kind?: unknown, title?: unknown, body?: unknown, createdAtUtcMs?: unknown, marker?: unknown, action?: unknown, dailyId?: unknown }} HistoryEntryInput
 * @typedef {{ id: string, source: 'system' | 'toast', kind: string, title: string, body: string, createdAtUtcMs: number, marker: HistoryMarker, action: HistoryAction }} HistoryEntry
 * @typedef {{ historyVersion?: unknown, entries?: unknown }} HistoryStatePayload
 * @typedef {{ updatedAtMs: number, historyVersion: number, entries: HistoryEntry[] }} HistoryState
 * @typedef {{ type?: unknown, payload?: unknown }} SwMessageData
 * @typedef {Record<string, unknown>} SwPayload
 * @typedef {{
 *   isLocalhostHostname: (hostname?: string) => boolean,
 *   normalizeString: (value: unknown, fallback?: string) => string,
 *   readDailyState: () => Promise<DailyState>,
 *   writeDailyState: (state: DailyState | DailyStatePayload) => Promise<DailyState>,
 *   normalizeSystemNotificationKind: (kindRaw: unknown) => 'new-level' | 'unsolved-warning',
 *   emitSystemNotification: (state: DailyState, kind: unknown) => Promise<boolean>,
 *   clearHistoryEntries: () => Promise<HistoryState>,
 *   closeVisibleNotifications: () => Promise<number>,
 * }} SwPluginApi
 * @typedef {(context: { event: ExtendableMessageEvent, data: SwMessageData, payload: SwPayload, api: SwPluginApi }) => unknown | Promise<unknown>} SwPluginMessageHandler
 * @typedef {(event: ExtendableMessageEvent, payload: SwPayload) => void} SwSystemMessageHandler
 */

const sw = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (globalThis);

const isLocalhostHostname = (hostname = '') =>
  hostname === 'localhost'
  || hostname === '127.0.0.1'
  || hostname === '[::1]'
  || hostname === '::1'
  || hostname.endsWith('.localhost');

const CURRENT_BUILD_CACHES = Object.freeze([APP_CACHE, DAILY_CACHE]);

/** @param {Response | null | undefined} response */
const isCacheableResponse = (response) =>
  Boolean(response?.ok && response.type === 'basic');

/** @param {Request} request */
const isNavigationRequest = (request) =>
  request.mode === 'navigate' || request.destination === 'document';

/** @param {URL} url */
const isVersionRequest = (url) => url.pathname.endsWith('/version.json');
/** @param {URL} url */
const isDailyPayloadRequest = (url) => url.pathname.endsWith(DAILY_PAYLOAD_PATH_SUFFIX);

/**
 * @param {Request} request
 * @param {URL} url
 */
const isStaticAssetRequest = (request, url) => {
  if (url.origin !== sw.location.origin) return false;
  if (request.method !== 'GET') return false;
  if (isVersionRequest(url) || isDailyPayloadRequest(url)) return false;
  const destination = request.destination;
  return destination === 'script'
    || destination === 'style'
    || destination === 'image'
    || destination === 'font'
    || destination === 'worker';
};

const resolveShellUrl = () => new URL('index.html', sw.registration.scope).toString();
const resolveNotificationIconUrl = () => new URL('icons/icon-192.webp', sw.registration.scope).toString();
const resolveNotificationBadgeUrl = () => new URL('icons/icon-96.webp', sw.registration.scope).toString();

/** @param {string} name */
const openCache = (name) => caches.open(name);
/**
 * @param {Request | URL | string} requestOrUrl
 * @returns {URL | null}
 */
const toRequestUrl = (requestOrUrl) => {
  try {
    if (requestOrUrl instanceof Request) return new URL(requestOrUrl.url);
    return new URL(String(requestOrUrl), sw.location.href);
  } catch {
    return null;
  }
};

/** @param {Request | URL | string} request */
const resolveDailyCacheKey = (request) => {
  const url = toRequestUrl(request);
  if (!url) return request;
  url.search = '';
  url.hash = '';
  return url.toString();
};

/** @param {Request | URL | string} request */
const isDailyCacheRequest = (request) => {
  const url = toRequestUrl(request);
  return Boolean(url && isDailyPayloadRequest(url));
};

/**
 * @param {string} cacheName
 * @param {number} maxEntries
 * @param {TrimCacheOptions} [options]
 */
const trimCacheEntries = async (cacheName, maxEntries, { matcher = null } = {}) => {
  if (!Number.isInteger(maxEntries) || maxEntries < 0) return;
  const cache = await openCache(cacheName);
  const keys = await cache.keys();
  const matched = typeof matcher === 'function' ? keys.filter((request) => matcher(request)) : keys;
  if (matched.length <= maxEntries) return;
  const deleteCount = matched.length - maxEntries;
  for (let i = 0; i < deleteCount; i += 1) {
    await cache.delete(matched[i]);
  }
};

/**
 * @param {readonly string[] | Set<string>} [retainedBuildCaches]
 */
const cleanupCurrentBuildCaches = async (retainedBuildCaches = CURRENT_BUILD_CACHES) => {
  const retainedCacheNames = Array.isArray(retainedBuildCaches)
    ? retainedBuildCaches
    : CURRENT_BUILD_CACHES;
  const retainedSet = retainedBuildCaches instanceof Set
    ? retainedBuildCaches
    : new Set(retainedCacheNames);

  if (isLocalhostHostname(sw.location.hostname)) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('tether-'))
        .map((key) => caches.delete(key)),
    );
    return;
  }

  const trimTasks = [];
  for (const cacheName of retainedSet) {
    if (cacheName.startsWith(APP_CACHE_PREFIX)) {
      trimTasks.push(trimCacheEntries(cacheName, APP_CACHE_MAX_ENTRIES));
      continue;
    }
    if (cacheName.startsWith(DAILY_CACHE_PREFIX)) {
      trimTasks.push(trimCacheEntries(cacheName, DAILY_CACHE_MAX_ENTRIES, {
        matcher: (request) => isDailyCacheRequest(request),
      }));
    }
  }
  await Promise.all(trimTasks);
};

/**
 * @param {Request | string} request
 * @param {FetchFreshOptions} [options]
 */
const fetchFresh = (request, options = {}) => {
  const { bypassCache = false } = options;
  const sourceRequest = request instanceof Request
    ? request
    : new Request(request);
  const headers = new Headers(sourceRequest.headers);
  if (bypassCache) {
    headers.set('x-bypass-cache', 'true');
  }
  return fetch(new Request(sourceRequest, { cache: 'no-store', headers }));
};

/**
 * @param {string} tagSource
 * @param {string} attributeName
 */
const readHtmlTagAttribute = (tagSource, attributeName) => {
  if (typeof tagSource !== 'string' || typeof attributeName !== 'string') return '';
  const re = new RegExp(String.raw`${attributeName}\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`, 'i');
  const match = new RegExp(re).exec(tagSource);
  if (!match) return '';
  const raw = match[1];
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith('\'') && raw.endsWith('\''))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
};

/**
 * @param {unknown} rawValue
 * @param {string} [baseUrl]
 */
const resolveLocalShellAssetUrl = (rawValue, baseUrl = resolveShellUrl()) => {
  const value = normalizeString(rawValue);
  if (!value) return '';
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.origin !== sw.location.origin) return '';
    return resolved.toString();
  } catch {
    return '';
  }
};

/**
 * @param {string} shellHtml
 * @param {string} [shellUrl]
 * @returns {string[]}
 */
const collectCriticalShellAssetUrls = (shellHtml, shellUrl = resolveShellUrl()) => {
  if (typeof shellHtml !== 'string' || shellHtml.length === 0) return [];
  /** @type {string[]} */
  const urls = [];
  const seen = new Set();
  /** @param {unknown} rawValue */
  const pushUnique = (rawValue) => {
    const resolved = resolveLocalShellAssetUrl(rawValue, shellUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    urls.push(resolved);
  };

  const tagRe = /<(script|link)\b[^>]*>/gi;
  for (const tagMatch of shellHtml.matchAll(tagRe)) {
    const tag = tagMatch[0];
    const tagName = String(tagMatch[1] || '').toLowerCase();
    if (tagName === 'script') {
      const scriptType = readHtmlTagAttribute(tag, 'type').toLowerCase();
      const scriptSrc = readHtmlTagAttribute(tag, 'src');
      if (scriptType === 'module' && scriptSrc) {
        pushUnique(scriptSrc);
      }
    } else if (tagName === 'link') {
      const href = readHtmlTagAttribute(tag, 'href');
      const relTokens = readHtmlTagAttribute(tag, 'rel').toLowerCase().split(/\s+/);
      if (href && relTokens.includes('stylesheet')) {
        pushUnique(href);
      }
    }
  }

  return urls;
};

/**
 * @param {string} cacheName
 * @param {CacheShellAssetOptions} [options]
 */
const cacheShellAssetDependencies = async (cacheName, options = {}) => {
  const cache = await openCache(cacheName);
  const shellUrl = resolveShellUrl();
  const bypassCache = normalizeBool(options.bypassCache, true);
  const responseFromNavigation = options.shellResponse ?? null;

  let shellHtml = '';
  let shellCached = false;

  if (responseFromNavigation && isCacheableResponse(responseFromNavigation)) {
    await cache.put(shellUrl, responseFromNavigation.clone());
    shellCached = true;
    try {
      shellHtml = await responseFromNavigation.clone().text();
    } catch {
      shellHtml = '';
    }
  }

  if (shellHtml.length === 0) {
    try {
      const fetchedShell = await fetchFresh(shellUrl, { bypassCache });
      if (isCacheableResponse(fetchedShell)) {
        await cache.put(shellUrl, fetchedShell.clone());
        shellCached = true;
        shellHtml = await fetchedShell.clone().text();
      }
    } catch {
      // Best effort warmup.
    }
  }

  if (!shellCached || shellHtml.length === 0) return false;

  const criticalAssetUrls = collectCriticalShellAssetUrls(shellHtml, shellUrl);
  if (criticalAssetUrls.length === 0) return false;

  let allAssetsCached = true;
  for (const assetUrl of criticalAssetUrls) {
    try {
      const response = await fetchFresh(assetUrl, { bypassCache });
      if (!isCacheableResponse(response)) {
        allAssetsCached = false;
        continue;
      }
      await cache.put(assetUrl, response.clone());
    } catch {
      allAssetsCached = false;
    }
  }

  await trimCacheEntries(cacheName, APP_CACHE_MAX_ENTRIES);
  return allAssetsCached;
};

/** @param {string} cacheName */
const hasCompleteCachedShellAssets = async (cacheName) => {
  const cache = await openCache(cacheName);
  const shellUrl = resolveShellUrl();
  const cachedShell = await cache.match(shellUrl, { ignoreSearch: true });
  if (!cachedShell) return false;

  let shellHtml = '';
  try {
    shellHtml = await cachedShell.clone().text();
  } catch {
    return false;
  }

  const criticalAssetUrls = collectCriticalShellAssetUrls(shellHtml, shellUrl);
  if (criticalAssetUrls.length === 0) return false;

  for (const assetUrl of criticalAssetUrls) {
    const cached = await cache.match(assetUrl, { ignoreSearch: true });
    if (!cached) return false;
  }
  return true;
};

/** @param {string} cacheName */
const collectCachedCriticalShellAssetUrls = async (cacheName) => {
  const cache = await openCache(cacheName);
  const shellUrl = resolveShellUrl();
  const cachedShell = await cache.match(shellUrl, { ignoreSearch: true });
  if (!cachedShell) return [];
  try {
    const shellHtml = await cachedShell.clone().text();
    return collectCriticalShellAssetUrls(shellHtml, shellUrl);
  } catch {
    return [];
  }
};

/**
 * @param {string} cacheName
 * @param {Request | URL | string} request
 */
const isPinnedCriticalAssetRequest = async (cacheName, request) => {
  const requestUrl = toRequestUrl(request);
  if (!requestUrl) return false;
  requestUrl.hash = '';
  const requestHref = requestUrl.toString();
  const criticalAssetUrls = await collectCachedCriticalShellAssetUrls(cacheName);
  if (criticalAssetUrls.length === 0) return false;
  return criticalAssetUrls.includes(requestHref);
};

sw.addEventListener('install', /** @param {ExtendableEvent} event */ (event) => {
  event.waitUntil((async () => {
    if (isLocalhostHostname(sw.location.hostname)) return;
    await cacheShellAssetDependencies(APP_CACHE, { bypassCache: true });
  })());
});

sw.addEventListener('activate', /** @param {ExtendableEvent} event */ (event) => {
  event.waitUntil((async () => {
    const updatePolicy = normalizeUpdatePolicyForActivation(await ensureUpdatePolicyState());
    await writeUpdatePolicyState(updatePolicy);
    const retainedBuildCaches = collectRetainedBuildCaches(updatePolicy);
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('tether-') && !retainedBuildCaches.has(key))
        .map((key) => caches.delete(key)),
    );
    await cleanupCurrentBuildCaches(retainedBuildCaches);
    await caches.delete(LEGACY_META_CACHE);
    await sw.clients.claim();
  })());
});

/** @param {Request} request */
const networkOnlyVersion = async (request) => {
  return fetchFresh(request);
};

/** @param {Request} request */
const networkFirstDaily = async (request) => {
  const cache = await openCache(DAILY_CACHE);
  const cacheKey = resolveDailyCacheKey(request);
  try {
    const response = await fetchFresh(request, { bypassCache: true });
    if (isCacheableResponse(response)) {
      await cache.put(cacheKey, response.clone());
      await trimCacheEntries(DAILY_CACHE, DAILY_CACHE_MAX_ENTRIES, {
        matcher: (cacheRequest) => isDailyCacheRequest(cacheRequest),
      });
    }
    return response;
  } catch {
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Offline' });
  }
};

/**
 * @param {FetchEvent} event
 * @param {Request} request
 * @param {CacheFirstRevalidateOptions} [options]
 */
const cacheFirstRevalidateStatic = async (event, request, options = {}) => {
  const cacheName = normalizeString(options.cacheName, APP_CACHE);
  const pinned = normalizeBool(options.pinned, false);
  const cache = await openCache(cacheName);
  const cached = await cache.match(request);
  if (pinned && cached) return cached;

  if (pinned && !cached) {
    const critical = await isPinnedCriticalAssetRequest(cacheName, request);
    try {
      const response = await fetchFresh(request);
      if (critical && isCacheableResponse(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  }

  const networkPromise = fetchFresh(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(networkPromise);
  if (cached) return cached;

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return new Response('', { status: 503, statusText: 'Offline' });
};

/**
 * @param {FetchEvent} event
 * @param {Request} request
 */
const cacheFirstRevalidateNavigation = async (event, request) => {
  const plan = await resolveServingBuildPlan();
  const cache = await openCache(plan.appCacheName);
  const shellUrl = resolveShellUrl();
  const cachedExact = await cache.match(request, { ignoreSearch: true });
  const cachedShell = await cache.match(shellUrl, { ignoreSearch: true });

  if (plan.pinned) {
    if (cachedExact) return cachedExact;
    if (cachedShell) return cachedShell;
    return new Response('', { status: 503, statusText: 'Pinned build unavailable' });
  }

  const networkPromise = fetchFresh(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        await cache.put(shellUrl, response.clone());
        await cacheShellAssetDependencies(plan.appCacheName, {
          shellResponse: response.clone(),
          bypassCache: true,
        });
        await trimCacheEntries(plan.appCacheName, APP_CACHE_MAX_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(networkPromise);

  if (cachedExact) return cachedExact;
  if (cachedShell) return cachedShell;

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return new Response('', { status: 503, statusText: 'Offline' });
};

sw.addEventListener('fetch', /** @param {FetchEvent} event */ (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (isLocalhostHostname(sw.location.hostname)) {
    if (isVersionRequest(url)) {
      event.respondWith(networkOnlyVersion(request));
      return;
    }
    if (isDailyPayloadRequest(url)) {
      event.respondWith(fetchFresh(request, { bypassCache: true }));
      return;
    }
    return;
  }

  if (isVersionRequest(url)) {
    event.respondWith(networkOnlyVersion(request));
    return;
  }

  if (isDailyPayloadRequest(url)) {
    event.respondWith(networkFirstDaily(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(cacheFirstRevalidateNavigation(event, request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith((async () => {
      const plan = await resolveServingBuildPlan();
      return cacheFirstRevalidateStatic(event, request, {
        cacheName: plan.appCacheName,
        pinned: plan.pinned,
      });
    })());
  }
});

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
const normalizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

/**
 * @param {unknown} value
 * @param {number | null} [fallback]
 * @returns {number | null}
 */
const normalizeInt = (value, fallback = null) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
};

/**
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
const normalizeBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

/** @type {Promise<IDBDatabase> | null} */
let metaDbPromise = null;

/** @returns {Promise<IDBDatabase>} */
const openMetaDb = async () => {
  if (metaDbPromise) return metaDbPromise;
  if (typeof indexedDB === 'undefined') {
    throw new TypeError('IndexedDB is unavailable in service worker context.');
  }

  metaDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(META_DB_NAME, META_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        metaDbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open metadata database.'));
    };

    request.onblocked = () => {
      reject(new Error('Opening metadata database was blocked.'));
    };
  });

  try {
    return await metaDbPromise;
  } catch (error) {
    metaDbPromise = null;
    throw error;
  }
};

/**
 * @param {IDBRequest<any>} request
 * @returns {Promise<any>}
 */
const waitForRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });

/** @param {IDBTransaction} transaction */
const waitForTransaction = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(undefined);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });

/** @param {string} key */
const readMetaRecord = async (key) => {
  try {
    const db = await openMetaDb();
    const transaction = db.transaction(META_STORE_NAME, 'readonly');
    const store = transaction.objectStore(META_STORE_NAME);
    const value = await waitForRequest(store.get(key));
    await waitForTransaction(transaction);
    return value ?? null;
  } catch {
    return null;
  }
};

/**
 * @param {string} key
 * @param {unknown} value
 */
const writeMetaRecord = async (key, value) => {
  try {
    const db = await openMetaDb();
    const transaction = db.transaction(META_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(META_STORE_NAME);
    await waitForRequest(store.put(value, key));
    await waitForTransaction(transaction);
    return true;
  } catch {
    return false;
  }
};

const resolveUpdatePolicyMetaRequestUrl = () =>
  new URL('__tether_update_policy__.json', sw.registration.scope).toString();

const readUpdatePolicyMetaFallback = async () => {
  try {
    const cache = await openCache(UPDATE_POLICY_META_CACHE);
    const cached = await cache.match(resolveUpdatePolicyMetaRequestUrl(), { ignoreSearch: true });
    if (!cached) return null;
    const parsed = await cached.json();
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** @param {unknown} value */
const writeUpdatePolicyMetaFallback = async (value) => {
  try {
    const cache = await openCache(UPDATE_POLICY_META_CACHE);
    const response = new Response(`${JSON.stringify(value)}\n`, {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    await cache.put(resolveUpdatePolicyMetaRequestUrl(), response);
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} [payload]
 * @returns {UpdatePolicyState}
 */
const normalizeUpdatePolicyPayload = (payload = {}) => {
  const pinnedParsed = normalizeInt(payload.pinnedBuildNumber, BUILD_NUMBER);
  const pinnedBuildNumber = typeof pinnedParsed === 'number' && pinnedParsed > 0
    ? pinnedParsed
    : BUILD_NUMBER;
  return {
    version: UPDATE_POLICY_VERSION,
    updatedAtMs: Date.now(),
    autoUpdateEnabled: normalizeBool(payload.autoUpdateEnabled, false),
    pinnedBuildNumber,
  };
};

/** @type {UpdatePolicyState} */
let updatePolicyState = normalizeUpdatePolicyPayload();
let updatePolicyLoaded = false;
/** @type {Promise<UpdatePolicyState> | null} */
let updatePolicyLoadPromise = null;
/** @type {{ buildNumber: number | null, usable: boolean }} */
let pinnedBuildCacheStatus = {
  buildNumber: null,
  usable: false,
};

const resetPinnedBuildCacheStatus = () => {
  pinnedBuildCacheStatus = {
    buildNumber: null,
    usable: false,
  };
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} state
 * @returns {UpdatePolicyState}
 */
const applyCachedUpdatePolicyState = (state) => {
  updatePolicyState = normalizeUpdatePolicyPayload(state);
  updatePolicyLoaded = true;
  resetPinnedBuildCacheStatus();
  return updatePolicyState;
};

/** @returns {Promise<UpdatePolicyState>} */
const readUpdatePolicyState = async () => {
  const stored = /** @type {UpdatePolicyPayload | null} */ (await readMetaRecord(META_RECORD_KEYS.UPDATE_POLICY));
  if (stored && typeof stored === 'object') {
    return normalizeUpdatePolicyPayload(stored);
  }
  const fallback = await readUpdatePolicyMetaFallback();
  if (fallback && typeof fallback === 'object') {
    return normalizeUpdatePolicyPayload(fallback);
  }
  return normalizeUpdatePolicyPayload();
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} state
 * @returns {Promise<UpdatePolicyState>}
 */
const writeUpdatePolicyState = async (state) => {
  const normalized = normalizeUpdatePolicyPayload(state);
  await Promise.all([
    writeMetaRecord(META_RECORD_KEYS.UPDATE_POLICY, normalized),
    writeUpdatePolicyMetaFallback(normalized),
  ]);
  return applyCachedUpdatePolicyState(normalized);
};

/** @returns {Promise<UpdatePolicyState>} */
const ensureUpdatePolicyState = async () => {
  if (updatePolicyLoaded) return updatePolicyState;
  if (updatePolicyLoadPromise) return updatePolicyLoadPromise;
  updatePolicyLoadPromise = (async () => {
    const loaded = await readUpdatePolicyState();
    return applyCachedUpdatePolicyState(loaded);
  })();
  try {
    return await updatePolicyLoadPromise;
  } finally {
    updatePolicyLoadPromise = null;
  }
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} [state]
 * @returns {number}
 */
const resolveServingBuildNumber = (state = updatePolicyState) => {
  const normalized = normalizeUpdatePolicyPayload(state);
  if (normalized.autoUpdateEnabled) return BUILD_NUMBER;
  if (!Number.isInteger(normalized.pinnedBuildNumber) || normalized.pinnedBuildNumber <= 0) {
    return BUILD_NUMBER;
  }
  if (normalized.pinnedBuildNumber > BUILD_NUMBER) return BUILD_NUMBER;
  return normalized.pinnedBuildNumber;
};

/**
 * @param {number | null} buildNumber
 * @returns {Promise<boolean>}
 */
const isPinnedBuildCacheUsable = async (buildNumber) => {
  if (typeof buildNumber !== 'number' || !Number.isInteger(buildNumber) || buildNumber <= 0) return false;
  const normalizedBuildNumber = /** @type {number} */ (buildNumber);
  if (normalizedBuildNumber === BUILD_NUMBER) return true;
  if (pinnedBuildCacheStatus.buildNumber === normalizedBuildNumber) return pinnedBuildCacheStatus.usable;
  const usable = await hasCompleteCachedShellAssets(appCacheNameForBuild(normalizedBuildNumber));
  pinnedBuildCacheStatus = {
    buildNumber: normalizedBuildNumber,
    usable,
  };
  return usable;
};

/** @returns {Promise<ServingBuildPlan>} */
const resolveServingBuildPlan = async () => {
  const policy = await ensureUpdatePolicyState();
  const servingBuildNumber = resolveServingBuildNumber(policy);
  const pinned = !policy.autoUpdateEnabled && servingBuildNumber !== BUILD_NUMBER;
  if (!pinned) {
    return {
      servingBuildNumber: BUILD_NUMBER,
      appCacheName: APP_CACHE,
      pinned: false,
    };
  }

  const pinnedUsable = await isPinnedBuildCacheUsable(servingBuildNumber);
  if (!pinnedUsable) {
    await writeUpdatePolicyState({
      ...policy,
      pinnedBuildNumber: BUILD_NUMBER,
    });
    return {
      servingBuildNumber: BUILD_NUMBER,
      appCacheName: APP_CACHE,
      pinned: false,
      pinnedCacheUsable: true,
    };
  }

  return {
    servingBuildNumber,
    appCacheName: appCacheNameForBuild(servingBuildNumber),
    pinned: true,
    pinnedCacheUsable: pinnedUsable,
  };
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} state
 * @returns {UpdatePolicyState}
 */
const normalizeUpdatePolicyForActivation = (state) => {
  const normalized = normalizeUpdatePolicyPayload(state);
  if (normalized.autoUpdateEnabled) {
    return normalizeUpdatePolicyPayload({
      ...normalized,
      pinnedBuildNumber: BUILD_NUMBER,
    });
  }
  if (!Number.isInteger(normalized.pinnedBuildNumber) || normalized.pinnedBuildNumber <= 0) {
    return normalizeUpdatePolicyPayload({
      ...normalized,
      pinnedBuildNumber: BUILD_NUMBER,
    });
  }
  if (normalized.pinnedBuildNumber > BUILD_NUMBER) {
    return normalizeUpdatePolicyPayload({
      ...normalized,
      pinnedBuildNumber: BUILD_NUMBER,
    });
  }
  return normalized;
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} state
 * @param {UpdatePolicyPayload} [payload]
 * @returns {UpdatePolicyState}
 */
const mergeUpdatePolicyPayload = (state, payload = {}) => {
  const next = {
    ...normalizeUpdatePolicyPayload(state),
  };

  if (Object.hasOwn(payload, 'autoUpdateEnabled')) {
    next.autoUpdateEnabled = normalizeBool(payload.autoUpdateEnabled, next.autoUpdateEnabled);
  }

  const currentBuildNumber = normalizeInt(payload.currentBuildNumber, null);
  if (!next.autoUpdateEnabled && typeof currentBuildNumber === 'number' && currentBuildNumber > 0) {
    next.pinnedBuildNumber = currentBuildNumber;
  }
  if (next.autoUpdateEnabled) {
    next.pinnedBuildNumber = BUILD_NUMBER;
  }

  return normalizeUpdatePolicyPayload(next);
};

/**
 * @param {unknown} buildNumber
 * @returns {Promise<UpdatePolicyState | null>}
 */
const confirmPinnedBuildUpdate = async (buildNumber) => {
  const state = await ensureUpdatePolicyState();
  const target = normalizeInt(buildNumber, null);
  if (typeof target !== 'number' || !Number.isInteger(target) || target <= 0) return null;
  const nextPinnedBuildNumber = Math.min(/** @type {number} */ (target), BUILD_NUMBER);
  return writeUpdatePolicyState({
    ...state,
    pinnedBuildNumber: nextPinnedBuildNumber,
  });
};

/**
 * @param {UpdatePolicyPayload | Partial<UpdatePolicyState>} updatePolicy
 * @returns {Set<string>}
 */
const collectRetainedBuildCaches = (updatePolicy) => {
  const policy = normalizeUpdatePolicyForActivation(updatePolicy);
  const retained = new Set(CURRENT_BUILD_CACHES);
  const servingBuildNumber = resolveServingBuildNumber(policy);
  if (servingBuildNumber !== BUILD_NUMBER) {
    retained.add(appCacheNameForBuild(servingBuildNumber));
  }
  return retained;
};

/**
 * @param {{ ports?: ReadonlyArray<MessagePort> | null }} event
 * @param {unknown} payload
 */
const replyToMessagePort = (event, payload) => {
  const port = Array.isArray(event?.ports) ? event.ports[0] : null;
  if (!port || typeof port.postMessage !== 'function') return;
  try {
    port.postMessage(payload);
  } catch {
    // Message reply is best effort.
  }
};

/** @type {Map<string, SwPluginMessageHandler>} */
const swPluginMessageHandlers = new Map();

/** @type {(messageHandlers?: Record<string, SwPluginMessageHandler>) => void} */
(/** @type {any} */ (sw).__tetherRegisterSwPlugin) = (messageHandlers = {}) => {
  if (!messageHandlers || typeof messageHandlers !== 'object') return;
  for (const [messageType, handler] of Object.entries(messageHandlers)) {
    if (typeof messageType !== 'string' || messageType.length === 0) continue;
    if (typeof handler !== 'function') continue;
    swPluginMessageHandlers.set(messageType, handler);
  }
};

/**
 * @param {DailyStatePayload | Partial<DailyState>} [payload]
 * @returns {DailyState}
 */
const normalizeDailyStatePayload = (payload = {}) => {
  const warningHoursParsed = normalizeInt(payload.warningHours, DEFAULT_WARNING_HOURS);
  const warningHours = typeof warningHoursParsed === 'number' && warningHoursParsed >= 0
    ? warningHoursParsed
    : DEFAULT_WARNING_HOURS;

  const texts = payload.notificationText && typeof payload.notificationText === 'object'
    ? payload.notificationText
    : {};

  return {
    buildNumber: BUILD_NUMBER,
    buildLabel: BUILD_LABEL,
    updatedAtMs: Date.now(),
    dailyId: normalizeString(payload.dailyId),
    hardInvalidateAtUtcMs: normalizeInt(payload.hardInvalidateAtUtcMs, null),
    dailySolvedDate: normalizeString(payload.dailySolvedDate),
    notificationsEnabled: normalizeBool(payload.notificationsEnabled, true),
    warningHours,
    warnedDailyId: normalizeString(payload.warnedDailyId),
    newLevelDailyId: normalizeString(payload.newLevelDailyId),
    notificationText: {
      unsolvedTitle: normalizeString(texts.unsolvedTitle, notificationDefaults.unsolvedTitle),
      unsolvedBody: normalizeString(texts.unsolvedBody, notificationDefaults.unsolvedBody),
      newLevelTitle: normalizeString(texts.newLevelTitle, notificationDefaults.newLevelTitle),
      newLevelBody: normalizeString(texts.newLevelBody, notificationDefaults.newLevelBody),
    },
  };
};

/**
 * @param {DailyState} state
 * @param {DailyStatePayload} payload
 * @returns {DailyState}
 */
const mergeDailyStatePayload = (state, payload) => {
  const next = {
    ...state,
    notificationText: {
      ...state.notificationText,
    },
  };

  /** @type {Array<'dailyId' | 'hardInvalidateAtUtcMs' | 'dailySolvedDate' | 'notificationsEnabled' | 'warningHours' | 'warnedDailyId' | 'newLevelDailyId'>} */
  const keys = [
    'dailyId',
    'hardInvalidateAtUtcMs',
    'dailySolvedDate',
    'notificationsEnabled',
    'warningHours',
    'warnedDailyId',
    'newLevelDailyId',
  ];

  const nextRecord = /** @type {Record<string, unknown>} */ (next);
  const payloadRecord = /** @type {Record<string, unknown>} */ (payload);
  for (const key of keys) {
    if (Object.hasOwn(payload, key)) {
      nextRecord[key] = payloadRecord[key];
    }
  }

  if (payload.notificationText && typeof payload.notificationText === 'object') {
    const texts = /** @type {Record<string, unknown>} */ (payload.notificationText);
    const notificationText = /** @type {Record<string, string>} */ (next.notificationText);
    /** @type {Array<'unsolvedTitle' | 'unsolvedBody' | 'newLevelTitle' | 'newLevelBody'>} */
    const textKeys = ['unsolvedTitle', 'unsolvedBody', 'newLevelTitle', 'newLevelBody'];
    for (const key of textKeys) {
      if (Object.hasOwn(texts, key)) {
        notificationText[key] = normalizeString(texts[key], notificationText[key]);
      }
    }
  }

  return normalizeDailyStatePayload(next);
};

/** @returns {Promise<DailyState>} */
const readDailyState = async () => {
  const stored = /** @type {DailyStatePayload | null} */ (await readMetaRecord(META_RECORD_KEYS.DAILY_STATE));
  const payload = stored && typeof stored === 'object' ? stored : {};
  return normalizeDailyStatePayload(payload);
};

/**
 * @param {DailyState | DailyStatePayload} state
 * @returns {Promise<DailyState>}
 */
const writeDailyState = async (state) => {
  const normalized = normalizeDailyStatePayload(state);
  await writeMetaRecord(META_RECORD_KEYS.DAILY_STATE, normalized);
  return normalized;
};

/**
 * @param {unknown} value
 * @returns {HistoryMarker}
 */
const normalizeHistoryMarker = (value) => {
  if (value === HISTORY_MARKERS.UNREAD) return HISTORY_MARKERS.UNREAD;
  if (value === HISTORY_MARKERS.JUST_READ) return HISTORY_MARKERS.JUST_READ;
  return HISTORY_MARKERS.OLDER;
};

/**
 * @param {unknown} [action]
 * @returns {HistoryAction}
 */
const normalizeHistoryAction = (action = null) => {
  if (!action || typeof action !== 'object') return null;
  const normalizedAction = /** @type {{ type?: unknown, buildNumber?: unknown, dailyId?: unknown }} */ (action);
  if (normalizedAction.type === 'apply-update') {
    const buildNumber = normalizeInt(normalizedAction.buildNumber, null);
    if (typeof buildNumber !== 'number' || !Number.isInteger(buildNumber) || buildNumber <= 0) return null;
    return {
      type: 'apply-update',
      buildNumber: /** @type {number} */ (buildNumber),
    };
  }
  if (normalizedAction.type === 'open-daily') {
    const dailyId = normalizeString(normalizedAction.dailyId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dailyId)) return null;
    return {
      type: 'open-daily',
      dailyId,
    };
  }
  return null;
};

/**
 * @param {HistoryEntryInput | Partial<HistoryEntry>} [entry]
 * @returns {HistoryEntry}
 */
const normalizeHistoryEntry = (entry = {}) => {
  const source = entry.source === 'system' ? 'system' : 'toast';
  const createdAtUtcMs = normalizeInt(entry.createdAtUtcMs, Date.now());
  return {
    id: normalizeString(entry.id, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    source,
    kind: normalizeString(entry.kind, source === 'system' ? 'unsolved-warning' : 'toast'),
    title: normalizeString(entry.title),
    body: normalizeString(entry.body),
    createdAtUtcMs: typeof createdAtUtcMs === 'number' ? createdAtUtcMs : Date.now(),
    marker: normalizeHistoryMarker(entry.marker),
    action: normalizeHistoryAction(entry.action),
  };
};

/**
 * @param {HistoryStatePayload | Partial<HistoryState>} [payload]
 * @returns {HistoryState}
 */
const normalizeHistoryState = (payload = {}) => {
  const historyVersionParsed = normalizeInt(payload.historyVersion, HISTORY_VERSION_START);
  const historyVersion = typeof historyVersionParsed === 'number' && historyVersionParsed >= HISTORY_VERSION_START
    ? historyVersionParsed
    : HISTORY_VERSION_START;

  const inputEntries = Array.isArray(payload.entries) ? payload.entries : [];
  const entries = inputEntries
    .map((entry) => normalizeHistoryEntry(entry))
    .slice(0, HISTORY_MAX_ENTRIES);

  return {
    updatedAtMs: Date.now(),
    historyVersion,
    entries,
  };
};

/** @returns {Promise<HistoryState>} */
const readHistoryState = async () => {
  const stored = /** @type {HistoryStatePayload | null} */ (await readMetaRecord(META_RECORD_KEYS.HISTORY_STATE));
  const payload = stored && typeof stored === 'object' ? stored : {};
  return normalizeHistoryState(payload);
};

/**
 * @param {HistoryState | HistoryStatePayload} state
 * @returns {Promise<HistoryState>}
 */
const writeHistoryState = async (state) => {
  const normalized = normalizeHistoryState(state);
  await writeMetaRecord(META_RECORD_KEYS.HISTORY_STATE, normalized);
  return normalized;
};

/** @param {HistoryState} state */
const buildHistoryPayload = (state) => ({
  historyVersion: state.historyVersion,
  entries: state.entries.map((entry) => ({ ...entry })),
});

/**
 * @param {Client | WindowClient | MessagePort | ServiceWorker | null} client
 * @param {HistoryState} state
 */
const postHistoryPayloadToClient = (client, state) => {
  if (!client || typeof client.postMessage !== 'function') return;
  client.postMessage({
    type: 'SW_NOTIFICATION_HISTORY',
    payload: buildHistoryPayload(state),
  });
};

/**
 * @param {HistoryState} state
 * @returns {Promise<void>}
 */
const broadcastHistoryPayload = async (state) => {
  const clients = await sw.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of clients) {
    postHistoryPayloadToClient(client, state);
  }
};

/** @type {Promise<unknown>} */
let dailyTaskChain = Promise.resolve();
/** @type {Promise<unknown>} */
let historyTaskChain = Promise.resolve();
/** @type {Promise<unknown>} */
let updatePolicyTaskChain = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T> | T} task
 * @returns {Promise<T>}
 */
const enqueueDailyTask = (task) => {
  dailyTaskChain = dailyTaskChain
    .catch(() => undefined)
    .then(() => task());
  return /** @type {Promise<T>} */ (dailyTaskChain);
};

/**
 * @template T
 * @param {() => Promise<T> | T} task
 * @returns {Promise<T>}
 */
const enqueueHistoryTask = (task) => {
  historyTaskChain = historyTaskChain
    .catch(() => undefined)
    .then(() => task());
  return /** @type {Promise<T>} */ (historyTaskChain);
};

/**
 * @template T
 * @param {() => Promise<T> | T} task
 * @returns {Promise<T>}
 */
const enqueueUpdatePolicyTask = (task) => {
  updatePolicyTaskChain = updatePolicyTaskChain
    .catch(() => undefined)
    .then(() => task());
  return /** @type {Promise<T>} */ (updatePolicyTaskChain);
};

/**
 * @param {UpdatePolicyPayload} [payload]
 * @returns {Promise<UpdatePolicyState>}
 */
const syncUpdatePolicyFromApp = async (payload = {}) => {
  return enqueueUpdatePolicyTask(async () => {
    const current = await ensureUpdatePolicyState();
    const next = mergeUpdatePolicyPayload(current, payload);
    return writeUpdatePolicyState(next);
  });
};

/**
 * @param {unknown} buildNumber
 * @returns {Promise<UpdatePolicyState | null>}
 */
const confirmUpdatePolicyBuild = async (buildNumber) => {
  return enqueueUpdatePolicyTask(async () => {
    return confirmPinnedBuildUpdate(buildNumber);
  });
};

const readUpdatePolicyReplyPayload = async () => {
  const state = await ensureUpdatePolicyState();
  const servingBuildNumber = resolveServingBuildNumber(state);
  const pinned = !state.autoUpdateEnabled && servingBuildNumber !== BUILD_NUMBER;
  const pinnedCacheUsable = pinned
    ? await isPinnedBuildCacheUsable(servingBuildNumber)
    : true;
  return {
    ok: true,
    autoUpdateEnabled: state.autoUpdateEnabled === true,
    pinnedBuildNumber: Number.isInteger(state.pinnedBuildNumber)
      ? state.pinnedBuildNumber
      : null,
    swBuildNumber: BUILD_NUMBER,
    servingBuildNumber: Number.isInteger(servingBuildNumber)
      ? servingBuildNumber
      : BUILD_NUMBER,
    pinnedCacheUsable,
  };
};

/**
 * @param {HistoryEntryInput | Partial<HistoryEntry>} entryInput
 * @returns {Promise<HistoryState>}
 */
const appendHistoryEntry = async (entryInput) => {
  return enqueueHistoryTask(async () => {
    const nextEntry = normalizeHistoryEntry(entryInput);
    const current = await readHistoryState();
    const entries = [nextEntry, ...current.entries].slice(0, HISTORY_MAX_ENTRIES);
    const nextState = await writeHistoryState({
      historyVersion: current.historyVersion + 1,
      entries,
    });
    await broadcastHistoryPayload(nextState);
    return nextState;
  });
};

/**
 * @param {string} kind
 * @param {string} title
 * @param {string} body
 * @param {string} dailyId
 * @param {HistoryAction} [action]
 * @returns {Promise<HistoryState>}
 */
const appendSystemHistoryEntry = async (kind, title, body, dailyId, action = null) => {
  return appendHistoryEntry({
    source: 'system',
    kind,
    title,
    body,
    createdAtUtcMs: Date.now(),
    marker: HISTORY_MARKERS.UNREAD,
    dailyId,
    action: normalizeHistoryAction(action),
  });
};

/**
 * @param {string} title
 * @param {string} body
 * @param {string} [kind]
 * @returns {Promise<HistoryState>}
 */
const appendToastHistoryEntry = async (title, body, kind = 'toast') => {
  return appendHistoryEntry({
    source: 'toast',
    kind,
    title,
    body,
    createdAtUtcMs: Date.now(),
    marker: HISTORY_MARKERS.UNREAD,
  });
};

/** @returns {Promise<HistoryState>} */
const clearHistoryEntries = async () => {
  return enqueueHistoryTask(async () => {
    const current = await readHistoryState();
    if (!Array.isArray(current.entries) || current.entries.length === 0) {
      await broadcastHistoryPayload(current);
      return current;
    }

    const nextState = await writeHistoryState({
      historyVersion: current.historyVersion + 1,
      entries: [],
    });
    await broadcastHistoryPayload(nextState);
    return nextState;
  });
};

const closeVisibleNotifications = async () => {
  if (!sw.registration || typeof sw.registration.getNotifications !== 'function') return 0;
  const notifications = await sw.registration.getNotifications();
  for (const notification of notifications) {
    notification.close();
  }
  return notifications.length;
};

/**
 * @param {{ historyVersion: number | null, entryIds: unknown[] }} params
 * @returns {Promise<HistoryState>}
 */
const markHistoryRead = async ({ historyVersion, entryIds }) => {
  return enqueueHistoryTask(async () => {
    const current = await readHistoryState();
    if (!Number.isInteger(historyVersion) || historyVersion !== current.historyVersion) {
      await broadcastHistoryPayload(current);
      return current;
    }

    const allowedIds = new Set(
      Array.isArray(entryIds)
        ? entryIds
          .map((entryId) => normalizeString(entryId))
          .filter((entryId) => entryId.length > 0)
        : [],
    );
    if (allowedIds.size === 0) {
      return current;
    }

    let changed = false;
    const nextEntries = current.entries.map((entry) => {
      if (entry.marker === HISTORY_MARKERS.JUST_READ) {
        changed = true;
        return {
          ...entry,
          marker: HISTORY_MARKERS.OLDER,
        };
      }

      if (entry.marker === HISTORY_MARKERS.UNREAD && allowedIds.has(entry.id)) {
        changed = true;
        return {
          ...entry,
          marker: HISTORY_MARKERS.JUST_READ,
        };
      }

      return entry;
    });

    if (!changed) {
      return current;
    }

    const nextState = await writeHistoryState({
      historyVersion: current.historyVersion + 1,
      entries: nextEntries,
    });
    await broadcastHistoryPayload(nextState);
    return nextState;
  });
};

/**
 * @param {{ buildNumber: number | null }} params
 * @returns {Promise<HistoryState>}
 */
const clearUpdateHistoryActions = async ({ buildNumber }) => {
  return enqueueHistoryTask(async () => {
    const targetBuildNumber = normalizeInt(buildNumber, null);
    if (typeof targetBuildNumber !== 'number' || !Number.isInteger(targetBuildNumber) || targetBuildNumber <= 0) return readHistoryState();
    const normalizedTargetBuildNumber = /** @type {number} */ (targetBuildNumber);

    const current = await readHistoryState();
    let changed = false;
    const nextEntries = current.entries.map((entry) => {
      if (entry?.kind !== 'new-version-available') return entry;
      if (entry.action?.type !== 'apply-update') return entry;
      if (!Number.isInteger(entry.action.buildNumber) || entry.action.buildNumber > normalizedTargetBuildNumber) return entry;
      changed = true;
      return {
        ...entry,
        action: null,
      };
    });

    if (!changed) return current;

    const nextState = await writeHistoryState({
      historyVersion: current.historyVersion + 1,
      entries: nextEntries,
    });
    await broadcastHistoryPayload(nextState);
    return nextState;
  });
};

/**
 * @param {Client | WindowClient | MessagePort | ServiceWorker | null} [sourceClient]
 * @returns {Promise<HistoryState>}
 */
const sendHistoryToSourceOrBroadcast = async (sourceClient = null) => {
  const state = await readHistoryState();
  if (sourceClient && typeof sourceClient.postMessage === 'function') {
    postHistoryPayloadToClient(sourceClient, state);
    return state;
  }
  await broadcastHistoryPayload(state);
  return state;
};

const hasFocusedWindowClient = async () => {
  const clients = await sw.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  return clients.some((client) => client?.focused === true);
};

/**
 * @param {unknown} kindRaw
 * @returns {'new-level' | 'unsolved-warning'}
 */
const normalizeSystemNotificationKind = (kindRaw) =>
  kindRaw === 'new-level' ? 'new-level' : 'unsolved-warning';

/**
 * @param {DailyState} state
 * @param {unknown} kind
 * @returns {Promise<boolean>}
 */
const emitSystemNotification = async (state, kind) => {
  const dailyId = normalizeString(state?.dailyId);
  if (!dailyId) return false;

  const normalizedKind = normalizeSystemNotificationKind(kind);
  const isNewLevel = normalizedKind === 'new-level';
  const title = isNewLevel
    ? state.notificationText.newLevelTitle
    : state.notificationText.unsolvedTitle;
  const body = isNewLevel
    ? state.notificationText.newLevelBody
    : state.notificationText.unsolvedBody;
  const tag = isNewLevel
    ? `tether-new-level-${dailyId}`
    : `tether-unsolved-${dailyId}`;

  try {
    await appendSystemHistoryEntry(normalizedKind, title, body, dailyId, {
      type: 'open-daily',
      dailyId,
    });
  } catch {
    return false;
  }

  try {
    await showNotification(title, {
      body,
      icon: resolveNotificationIconUrl(),
      badge: resolveNotificationBadgeUrl(),
      tag,
      renotify: false,
      data: {
        type: normalizedKind,
        dailyId,
        buildNumber: BUILD_NUMBER,
      },
    });
  } catch {
    // Notification API errors are best effort after history append.
  }

  return true;
};

/**
 * @param {string} title
 * @param {NotificationOptions & { renotify?: boolean }} options
 * @returns {Promise<boolean>}
 */
const showNotification = async (title, options) => {
  if (!sw.registration || typeof sw.registration.showNotification !== 'function') return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  await sw.registration.showNotification(title, options);
  return true;
};

/** @returns {Promise<DailyState | undefined>} */
const runDailyCheck = async () => {
  let state = await readDailyState();
  if (!state.notificationsEnabled) return;
  const hardInvalidateAtUtcMs = state.hardInvalidateAtUtcMs;
  if (!state.dailyId || typeof hardInvalidateAtUtcMs !== 'number' || !Number.isInteger(hardInvalidateAtUtcMs) || hardInvalidateAtUtcMs <= 0) {
    return;
  }
  const hardInvalidateAt = /** @type {number} */ (hardInvalidateAtUtcMs);

  const now = Date.now();
  const warningLeadMs = state.warningHours * 60 * 60 * 1000;
  const warningStartMs = hardInvalidateAt - warningLeadMs;
  const unsolved = state.dailySolvedDate !== state.dailyId;

  if (await hasFocusedWindowClient()) {
    return state;
  }

  let changed = false;

  if (
    unsolved
    && now >= warningStartMs
    && now < hardInvalidateAt
    && state.warnedDailyId !== state.dailyId
  ) {
    const notified = await emitSystemNotification(state, 'unsolved-warning');
    if (notified) {
      state.warnedDailyId = state.dailyId;
      changed = true;
    }
  }

  if (now >= hardInvalidateAt && state.newLevelDailyId !== state.dailyId) {
    const notified = await emitSystemNotification(state, 'new-level');
    if (notified) {
      state.newLevelDailyId = state.dailyId;
      changed = true;
    }
  }

  if (changed) {
    state = await writeDailyState(state);
  }

  return state;
};

const registerPendingDailySync = async () => {
  const syncManager = /** @type {{ register?: (tag: string) => Promise<void> } | undefined} */ (
    /** @type {any} */ (sw.registration)?.sync
  );
  if (typeof syncManager?.register === 'function') {
    try {
      await syncManager.register(DAILY_CHECK_TAG);
    } catch {
      // Sync registration is best effort.
    }
  }
};

/** @type {SwPluginApi} */
const SW_PLUGIN_API = Object.freeze({
  isLocalhostHostname,
  normalizeString,
  readDailyState,
  writeDailyState,
  normalizeSystemNotificationKind,
  emitSystemNotification,
  clearHistoryEntries,
  closeVisibleNotifications,
});
(/** @type {any} */ (sw)).__tetherSwPluginApi = SW_PLUGIN_API;

const loadSwPlugins = () => {
  const pluginScriptUrl = (() => {
    try {
      const swUrl = new URL(sw.location.href);
      return normalizeString(swUrl.searchParams.get(SW_PLUGIN_QUERY_PARAM));
    } catch {
      return '';
    }
  })();

  if (!pluginScriptUrl) return;
  if (typeof importScripts !== 'function') return;

  try {
    importScripts(pluginScriptUrl);
  } catch {
    // Plugin scripts are best effort and only used by local runtime plugins.
  }
};

/**
 * @param {ExtendableMessageEvent} event
 * @param {SwMessageData} data
 */
const dispatchPluginMessage = (event, data) => {
  const messageType = normalizeString(data?.type);
  const pluginHandler = swPluginMessageHandlers.get(messageType);
  if (typeof pluginHandler !== 'function') return false;

  const payload = /** @type {SwPayload} */ (
    data.payload && typeof data.payload === 'object' ? data.payload : {}
  );
  event.waitUntil(Promise.resolve(pluginHandler({
    event,
    data,
    payload,
    api: SW_PLUGIN_API,
  })));
  return true;
};

loadSwPlugins();

sw.addEventListener('periodicsync', /** @param {any} event */ (event) => {
  if (event.tag !== DAILY_CHECK_TAG) return;
  event.waitUntil(enqueueDailyTask(() => runDailyCheck()));
});

sw.addEventListener('sync', /** @param {any} event */ (event) => {
  if (event.tag !== DAILY_CHECK_TAG) return;
  event.waitUntil(enqueueDailyTask(() => runDailyCheck()));
});

sw.addEventListener('notificationclick', /** @param {any} event */ (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await sw.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    if (allClients.length > 0) {
      const client = allClients[0];
      await client.focus();
      return;
    }
    await sw.clients.openWindow(sw.registration.scope);
  })());
});

/** @type {Record<string, SwSystemMessageHandler>} */
const systemMessageHandlers = {
  SW_SKIP_WAITING: (event, payload) => {
    const approvedBuildNumber = normalizeInt(payload.approvedBuildNumber, null);
    event.waitUntil((async () => {
      if (typeof approvedBuildNumber === 'number' && approvedBuildNumber > 0) {
        await confirmUpdatePolicyBuild(approvedBuildNumber);
      }
      await sw.skipWaiting();
    })());
  },
  SW_SYNC_UPDATE_POLICY: (event, payload) => {
    event.waitUntil(syncUpdatePolicyFromApp(payload));
  },
  SW_GET_UPDATE_POLICY: (event) => {
    event.waitUntil((async () => {
      try {
        const payload = await readUpdatePolicyReplyPayload();
        replyToMessagePort(event, payload);
      } catch {
        replyToMessagePort(event, {
          ok: false,
          autoUpdateEnabled: false,
          pinnedBuildNumber: null,
          swBuildNumber: BUILD_NUMBER,
          servingBuildNumber: BUILD_NUMBER,
          pinnedCacheUsable: false,
        });
      }
    })());
  },
  SW_CONFIRM_BUILD_UPDATE: (event, payload) => {
    const buildNumber = normalizeInt(payload.buildNumber, null);
    event.waitUntil((async () => {
      try {
        const updated = await confirmUpdatePolicyBuild(buildNumber);
        const pinnedBuildNumber = updated && Number.isInteger(updated.pinnedBuildNumber)
          ? updated.pinnedBuildNumber
          : null;
        replyToMessagePort(event, {
          ok: Boolean(updated),
          pinnedBuildNumber,
        });
      } catch {
        replyToMessagePort(event, {
          ok: false,
          pinnedBuildNumber: null,
        });
      }
    })());
  },
  SW_SYNC_DAILY_STATE: (event, payload) => {
    event.waitUntil(enqueueDailyTask(async () => {
      const current = await readDailyState();
      await writeDailyState(mergeDailyStatePayload(current, payload));
      await registerPendingDailySync();
      await runDailyCheck();
    }));
  },
  SW_RUN_DAILY_CHECK: (event) => {
    event.waitUntil(enqueueDailyTask(async () => {
      await registerPendingDailySync();
      await runDailyCheck();
    }));
  },
  SW_GET_NOTIFICATION_HISTORY: (event) => {
    const sourceClient = event.source && typeof event.source.postMessage === 'function'
      ? event.source
      : null;
    event.waitUntil(enqueueHistoryTask(() => sendHistoryToSourceOrBroadcast(sourceClient)));
  },
  SW_APPEND_TOAST_HISTORY: (event, payload) => {
    const kind = normalizeString(payload.kind, 'toast');
    const title = normalizeString(payload.title);
    const body = normalizeString(payload.body);
    if (!title && !body) return;
    event.waitUntil(appendToastHistoryEntry(title, body, kind));
  },
  SW_APPEND_SYSTEM_HISTORY: (event, payload) => {
    const kind = normalizeString(payload.kind, 'system');
    const title = normalizeString(payload.title);
    const body = normalizeString(payload.body);
    if (!title && !body) return;
    event.waitUntil(appendSystemHistoryEntry(
      kind,
      title,
      body,
      normalizeString(payload.dailyId),
      normalizeHistoryAction(payload.action),
    ));
  },
  SW_CLEAR_UPDATE_HISTORY_ACTIONS: (event, payload) => {
    event.waitUntil(clearUpdateHistoryActions({
      buildNumber: normalizeInt(payload.buildNumber, null),
    }));
  },
  SW_MARK_NOTIFICATION_HISTORY_READ: (event, payload) => {
    event.waitUntil(markHistoryRead({
      historyVersion: normalizeInt(payload.historyVersion, null),
      entryIds: Array.isArray(payload.entryIds) ? payload.entryIds : [],
    }));
  },
};

sw.addEventListener('message', /** @param {ExtendableMessageEvent} event */ (event) => {
  if (event.origin !== sw.location.origin) return;

  const data = /** @type {SwMessageData} */ (event.data);
  if (!data || typeof data !== 'object') return;

  const messageType = normalizeString(data.type);
  const handler = systemMessageHandlers[messageType];
  if (handler) {
    const payload = /** @type {SwPayload} */ (
      data.payload && typeof data.payload === 'object' ? data.payload : {}
    );
    handler(event, payload);
    return;
  }

  dispatchPluginMessage(event, data);
});
