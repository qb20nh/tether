const BUILD_NUMBER = Number.parseInt('__TETHER_BUILD_NUMBER__', 10) || 0;
const BUILD_LABEL = '__TETHER_BUILD_LABEL__';

const APP_CACHE_PREFIX = 'tether-app-';
const DAILY_CACHE_PREFIX = 'tether-daily-';
const appCacheNameForBuild = (buildNumber) => `${APP_CACHE_PREFIX}${buildNumber}`;
const dailyCacheNameForBuild = (buildNumber) => `${DAILY_CACHE_PREFIX}${buildNumber}`;
const APP_CACHE = appCacheNameForBuild(BUILD_NUMBER);
const DAILY_CACHE = dailyCacheNameForBuild(BUILD_NUMBER);
const LEGACY_META_CACHE = 'tether-meta-v1';
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

const isLocalhostHostname = (hostname = '') =>
  hostname === 'localhost'
  || hostname === '127.0.0.1'
  || hostname === '[::1]'
  || hostname === '::1'
  || hostname.endsWith('.localhost');

const CURRENT_BUILD_CACHES = Object.freeze([APP_CACHE, DAILY_CACHE]);

const isCacheableResponse = (response) =>
  Boolean(response && response.ok && response.type === 'basic');

const isNavigationRequest = (request) =>
  request.mode === 'navigate' || request.destination === 'document';

const isVersionRequest = (url) => url.pathname.endsWith('/version.json');
const isDailyPayloadRequest = (url) => url.pathname.endsWith(DAILY_PAYLOAD_PATH_SUFFIX);

const isStaticAssetRequest = (request, url) => {
  if (url.origin !== self.location.origin) return false;
  if (request.method !== 'GET') return false;
  if (isVersionRequest(url) || isDailyPayloadRequest(url)) return false;
  const destination = request.destination;
  return destination === 'script'
    || destination === 'style'
    || destination === 'image'
    || destination === 'font'
    || destination === 'worker';
};

const resolveShellUrl = () => new URL('index.html', self.registration.scope).toString();
const resolveNotificationIconUrl = () => new URL('icons/icon-192.webp', self.registration.scope).toString();
const resolveNotificationBadgeUrl = () => new URL('icons/icon-96.webp', self.registration.scope).toString();

const openCache = (name) => caches.open(name);
const toRequestUrl = (requestOrUrl) => {
  try {
    if (requestOrUrl instanceof Request) return new URL(requestOrUrl.url);
    return new URL(String(requestOrUrl), self.location.href);
  } catch {
    return null;
  }
};

const resolveDailyCacheKey = (request) => {
  const url = toRequestUrl(request);
  if (!url) return request;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const isDailyCacheRequest = (request) => {
  const url = toRequestUrl(request);
  return Boolean(url && isDailyPayloadRequest(url));
};

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

const cleanupCurrentBuildCaches = async (retainedBuildCaches = CURRENT_BUILD_CACHES) => {
  const retainedSet = retainedBuildCaches instanceof Set
    ? retainedBuildCaches
    : new Set(Array.isArray(retainedBuildCaches) ? retainedBuildCaches : CURRENT_BUILD_CACHES);

  if (isLocalhostHostname(self.location.hostname)) {
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

const fetchFresh = (request, options = {}) => {
  const { bypassCache = false } = options;
  const headers = new Headers(request.headers || undefined);
  if (bypassCache) {
    headers.set('x-bypass-cache', 'true');
  }
  return fetch(new Request(request, { cache: 'no-store', headers }));
};

self.addEventListener('activate', (event) => {
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
    await self.clients.claim();
  })());
});

const networkOnlyVersion = async (request) => {
  return fetchFresh(request);
};

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

const cacheFirstRevalidateStatic = async (event, request, options = {}) => {
  const cacheName = normalizeString(options.cacheName, APP_CACHE);
  const pinned = normalizeBool(options.pinned, false);
  const cache = await openCache(cacheName);
  const cached = await cache.match(request);
  if (pinned && cached) return cached;

  if (pinned && !cached) {
    await failOpenPinnedBuildToLatest();
    return cacheFirstRevalidateStatic(event, request, {
      cacheName: APP_CACHE,
      pinned: false,
    });
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

const cacheFirstRevalidateNavigation = async (event, request) => {
  const plan = await resolveServingBuildPlan();
  const cache = await openCache(plan.appCacheName);
  const shellUrl = resolveShellUrl();
  const cachedExact = await cache.match(request, { ignoreSearch: true });
  const cachedShell = await cache.match(shellUrl, { ignoreSearch: true });

  if (plan.pinned) {
    if (cachedExact) return cachedExact;
    if (cachedShell) return cachedShell;
    await failOpenPinnedBuildToLatest();
    return cacheFirstRevalidateNavigation(event, request);
  }

  const networkPromise = fetchFresh(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        await cache.put(shellUrl, response.clone());
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isLocalhostHostname(self.location.hostname)) {
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

const normalizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeInt = (value, fallback = null) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
};

const normalizeBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

let metaDbPromise = null;

const openMetaDb = async () => {
  if (metaDbPromise) return metaDbPromise;
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable in service worker context.');
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

const waitForRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });

const waitForTransaction = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });

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

const normalizeUpdatePolicyPayload = (payload = {}) => {
  const pinnedParsed = normalizeInt(payload.pinnedBuildNumber, BUILD_NUMBER);
  const pinnedBuildNumber = Number.isInteger(pinnedParsed) && pinnedParsed > 0
    ? pinnedParsed
    : BUILD_NUMBER;
  return {
    version: UPDATE_POLICY_VERSION,
    updatedAtMs: Date.now(),
    autoUpdateEnabled: normalizeBool(payload.autoUpdateEnabled, false),
    pinnedBuildNumber,
  };
};

let updatePolicyState = normalizeUpdatePolicyPayload();
let updatePolicyLoaded = false;
let updatePolicyLoadPromise = null;
let pinnedShellCacheStatus = {
  buildNumber: null,
  hasShell: false,
};

const resetPinnedShellCacheStatus = () => {
  pinnedShellCacheStatus = {
    buildNumber: null,
    hasShell: false,
  };
};

const applyCachedUpdatePolicyState = (state) => {
  updatePolicyState = normalizeUpdatePolicyPayload(state);
  updatePolicyLoaded = true;
  resetPinnedShellCacheStatus();
  return updatePolicyState;
};

const readUpdatePolicyState = async () => {
  const stored = await readMetaRecord(META_RECORD_KEYS.UPDATE_POLICY);
  const payload = stored && typeof stored === 'object' ? stored : {};
  return normalizeUpdatePolicyPayload(payload);
};

const writeUpdatePolicyState = async (state) => {
  const normalized = normalizeUpdatePolicyPayload(state);
  await writeMetaRecord(META_RECORD_KEYS.UPDATE_POLICY, normalized);
  return applyCachedUpdatePolicyState(normalized);
};

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

const resolveServingBuildNumber = (state = updatePolicyState) => {
  const normalized = normalizeUpdatePolicyPayload(state);
  if (normalized.autoUpdateEnabled) return BUILD_NUMBER;
  if (!Number.isInteger(normalized.pinnedBuildNumber) || normalized.pinnedBuildNumber <= 0) {
    return BUILD_NUMBER;
  }
  if (normalized.pinnedBuildNumber > BUILD_NUMBER) return BUILD_NUMBER;
  return normalized.pinnedBuildNumber;
};

const hasPinnedShellCache = async (buildNumber) => {
  if (!Number.isInteger(buildNumber) || buildNumber <= 0 || buildNumber === BUILD_NUMBER) return true;
  if (pinnedShellCacheStatus.buildNumber === buildNumber) return pinnedShellCacheStatus.hasShell;
  const cache = await openCache(appCacheNameForBuild(buildNumber));
  const cachedShell = await cache.match(resolveShellUrl(), { ignoreSearch: true });
  const hasShell = Boolean(cachedShell);
  pinnedShellCacheStatus = {
    buildNumber,
    hasShell,
  };
  return hasShell;
};

const failOpenPinnedBuildToLatest = async () => {
  const current = await ensureUpdatePolicyState();
  if (resolveServingBuildNumber(current) === BUILD_NUMBER && current.pinnedBuildNumber === BUILD_NUMBER) {
    return current;
  }
  return writeUpdatePolicyState({
    ...current,
    pinnedBuildNumber: BUILD_NUMBER,
  });
};

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

  const pinnedUsable = await hasPinnedShellCache(servingBuildNumber);
  if (pinnedUsable) {
    return {
      servingBuildNumber,
      appCacheName: appCacheNameForBuild(servingBuildNumber),
      pinned: true,
    };
  }

  await failOpenPinnedBuildToLatest();
  return {
    servingBuildNumber: BUILD_NUMBER,
    appCacheName: APP_CACHE,
    pinned: false,
    failedOpen: true,
  };
};

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

const mergeUpdatePolicyPayload = (state, payload = {}) => {
  const next = {
    ...normalizeUpdatePolicyPayload(state),
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'autoUpdateEnabled')) {
    next.autoUpdateEnabled = normalizeBool(payload.autoUpdateEnabled, next.autoUpdateEnabled);
  }

  const currentBuildNumber = normalizeInt(payload.currentBuildNumber, null);
  if (!next.autoUpdateEnabled && Number.isInteger(currentBuildNumber) && currentBuildNumber > 0) {
    next.pinnedBuildNumber = currentBuildNumber;
  }
  if (next.autoUpdateEnabled) {
    next.pinnedBuildNumber = BUILD_NUMBER;
  }

  return normalizeUpdatePolicyPayload(next);
};

const confirmPinnedBuildUpdate = async (buildNumber) => {
  const state = await ensureUpdatePolicyState();
  const target = normalizeInt(buildNumber, null);
  if (!Number.isInteger(target) || target <= 0) return null;
  const nextPinnedBuildNumber = Math.min(target, BUILD_NUMBER);
  return writeUpdatePolicyState({
    ...state,
    pinnedBuildNumber: nextPinnedBuildNumber,
  });
};

const collectRetainedBuildCaches = (updatePolicy) => {
  const policy = normalizeUpdatePolicyForActivation(updatePolicy);
  const retained = new Set(CURRENT_BUILD_CACHES);
  const servingBuildNumber = resolveServingBuildNumber(policy);
  if (servingBuildNumber !== BUILD_NUMBER) {
    retained.add(appCacheNameForBuild(servingBuildNumber));
  }
  return retained;
};

const replyToMessagePort = (event, payload) => {
  const port = Array.isArray(event?.ports) ? event.ports[0] : null;
  if (!port || typeof port.postMessage !== 'function') return;
  try {
    port.postMessage(payload);
  } catch {
    // Message reply is best effort.
  }
};

const swPluginMessageHandlers = new Map();

self.__tetherRegisterSwPlugin = (messageHandlers = {}) => {
  if (!messageHandlers || typeof messageHandlers !== 'object') return;
  for (const [messageType, handler] of Object.entries(messageHandlers)) {
    if (typeof messageType !== 'string' || messageType.length === 0) continue;
    if (typeof handler !== 'function') continue;
    swPluginMessageHandlers.set(messageType, handler);
  }
};

const normalizeDailyStatePayload = (payload = {}) => {
  const warningHoursParsed = normalizeInt(payload.warningHours, DEFAULT_WARNING_HOURS);
  const warningHours = Number.isInteger(warningHoursParsed) && warningHoursParsed >= 0
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

const mergeDailyStatePayload = (state, payload) => {
  const next = {
    ...state,
    notificationText: {
      ...state.notificationText,
    },
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'dailyId')) {
    next.dailyId = payload.dailyId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'hardInvalidateAtUtcMs')) {
    next.hardInvalidateAtUtcMs = payload.hardInvalidateAtUtcMs;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'dailySolvedDate')) {
    next.dailySolvedDate = payload.dailySolvedDate;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'notificationsEnabled')) {
    next.notificationsEnabled = payload.notificationsEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'warningHours')) {
    next.warningHours = payload.warningHours;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'warnedDailyId')) {
    next.warnedDailyId = payload.warnedDailyId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'newLevelDailyId')) {
    next.newLevelDailyId = payload.newLevelDailyId;
  }

  if (payload.notificationText && typeof payload.notificationText === 'object') {
    const texts = payload.notificationText;
    if (Object.prototype.hasOwnProperty.call(texts, 'unsolvedTitle')) {
      next.notificationText.unsolvedTitle = texts.unsolvedTitle;
    }
    if (Object.prototype.hasOwnProperty.call(texts, 'unsolvedBody')) {
      next.notificationText.unsolvedBody = texts.unsolvedBody;
    }
    if (Object.prototype.hasOwnProperty.call(texts, 'newLevelTitle')) {
      next.notificationText.newLevelTitle = texts.newLevelTitle;
    }
    if (Object.prototype.hasOwnProperty.call(texts, 'newLevelBody')) {
      next.notificationText.newLevelBody = texts.newLevelBody;
    }
  }

  return normalizeDailyStatePayload(next);
};

const readDailyState = async () => {
  const stored = await readMetaRecord(META_RECORD_KEYS.DAILY_STATE);
  const payload = stored && typeof stored === 'object' ? stored : {};
  return normalizeDailyStatePayload(payload);
};

const writeDailyState = async (state) => {
  const normalized = normalizeDailyStatePayload(state);
  await writeMetaRecord(META_RECORD_KEYS.DAILY_STATE, normalized);
  return normalized;
};

const normalizeHistoryMarker = (value) => {
  if (value === HISTORY_MARKERS.UNREAD) return HISTORY_MARKERS.UNREAD;
  if (value === HISTORY_MARKERS.JUST_READ) return HISTORY_MARKERS.JUST_READ;
  return HISTORY_MARKERS.OLDER;
};

const normalizeHistoryAction = (action = null) => {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'apply-update') {
    const buildNumber = normalizeInt(action.buildNumber, null);
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return null;
    return {
      type: 'apply-update',
      buildNumber,
    };
  }
  if (action.type === 'open-daily') {
    const dailyId = normalizeString(action.dailyId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dailyId)) return null;
    return {
      type: 'open-daily',
      dailyId,
    };
  }
  return null;
};

const normalizeHistoryEntry = (entry = {}) => {
  const source = entry.source === 'system' ? 'system' : 'toast';
  return {
    id: normalizeString(entry.id, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    source,
    kind: normalizeString(entry.kind, source === 'system' ? 'unsolved-warning' : 'toast'),
    title: normalizeString(entry.title),
    body: normalizeString(entry.body),
    createdAtUtcMs: normalizeInt(entry.createdAtUtcMs, Date.now()),
    marker: normalizeHistoryMarker(entry.marker),
    action: normalizeHistoryAction(entry.action),
  };
};

const normalizeHistoryState = (payload = {}) => {
  const historyVersionParsed = normalizeInt(payload.historyVersion, HISTORY_VERSION_START);
  const historyVersion = Number.isInteger(historyVersionParsed) && historyVersionParsed >= HISTORY_VERSION_START
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

const readHistoryState = async () => {
  const stored = await readMetaRecord(META_RECORD_KEYS.HISTORY_STATE);
  const payload = stored && typeof stored === 'object' ? stored : {};
  return normalizeHistoryState(payload);
};

const writeHistoryState = async (state) => {
  const normalized = normalizeHistoryState(state);
  await writeMetaRecord(META_RECORD_KEYS.HISTORY_STATE, normalized);
  return normalized;
};

const buildHistoryPayload = (state) => ({
  historyVersion: state.historyVersion,
  entries: state.entries.map((entry) => ({ ...entry })),
});

const postHistoryPayloadToClient = (client, state) => {
  if (!client || typeof client.postMessage !== 'function') return;
  client.postMessage({
    type: 'SW_NOTIFICATION_HISTORY',
    payload: buildHistoryPayload(state),
  });
};

const broadcastHistoryPayload = async (state) => {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of clients) {
    postHistoryPayloadToClient(client, state);
  }
};

let dailyTaskChain = Promise.resolve();
let historyTaskChain = Promise.resolve();
let updatePolicyTaskChain = Promise.resolve();

const enqueueDailyTask = (task) => {
  dailyTaskChain = dailyTaskChain
    .catch(() => undefined)
    .then(task);
  return dailyTaskChain;
};

const enqueueHistoryTask = (task) => {
  historyTaskChain = historyTaskChain
    .catch(() => undefined)
    .then(task);
  return historyTaskChain;
};

const enqueueUpdatePolicyTask = (task) => {
  updatePolicyTaskChain = updatePolicyTaskChain
    .catch(() => undefined)
    .then(task);
  return updatePolicyTaskChain;
};

const syncUpdatePolicyFromApp = async (payload = {}) => {
  return enqueueUpdatePolicyTask(async () => {
    const current = await ensureUpdatePolicyState();
    const next = mergeUpdatePolicyPayload(current, payload);
    return writeUpdatePolicyState(next);
  });
};

const confirmUpdatePolicyBuild = async (buildNumber) => {
  return enqueueUpdatePolicyTask(async () => {
    return confirmPinnedBuildUpdate(buildNumber);
  });
};

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

const appendToastHistoryEntry = async (title, body) => {
  return appendHistoryEntry({
    source: 'toast',
    kind: 'toast',
    title,
    body,
    createdAtUtcMs: Date.now(),
    marker: HISTORY_MARKERS.UNREAD,
  });
};

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
  if (!self.registration || typeof self.registration.getNotifications !== 'function') return 0;
  const notifications = await self.registration.getNotifications();
  for (const notification of notifications) {
    notification.close();
  }
  return notifications.length;
};

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

const clearUpdateHistoryActions = async ({ buildNumber }) => {
  return enqueueHistoryTask(async () => {
    const targetBuildNumber = normalizeInt(buildNumber, null);
    if (!Number.isInteger(targetBuildNumber) || targetBuildNumber <= 0) return readHistoryState();

    const current = await readHistoryState();
    let changed = false;
    const nextEntries = current.entries.map((entry) => {
      if (!entry || entry.kind !== 'new-version-available') return entry;
      if (!entry.action || entry.action.type !== 'apply-update') return entry;
      if (!Number.isInteger(entry.action.buildNumber) || entry.action.buildNumber > targetBuildNumber) return entry;
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
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  return clients.some((client) => client && client.focused === true);
};

const normalizeSystemNotificationKind = (kindRaw) =>
  kindRaw === 'new-level' ? 'new-level' : 'unsolved-warning';

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

const showNotification = async (title, options) => {
  if (!self.registration || typeof self.registration.showNotification !== 'function') return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  await self.registration.showNotification(title, options);
  return true;
};

const runDailyCheck = async () => {
  let state = await readDailyState();
  if (!state.notificationsEnabled) return;
  if (!state.dailyId || !Number.isInteger(state.hardInvalidateAtUtcMs) || state.hardInvalidateAtUtcMs <= 0) {
    return;
  }

  const now = Date.now();
  const warningLeadMs = state.warningHours * 60 * 60 * 1000;
  const warningStartMs = state.hardInvalidateAtUtcMs - warningLeadMs;
  const unsolved = state.dailySolvedDate !== state.dailyId;
  const hasFocusedClient = await hasFocusedWindowClient();
  let changed = false;

  if (
    unsolved
    && now >= warningStartMs
    && now < state.hardInvalidateAtUtcMs
    && state.warnedDailyId !== state.dailyId
  ) {
    if (!hasFocusedClient) {
      const notified = await emitSystemNotification(state, 'unsolved-warning');
      if (notified) {
        state.warnedDailyId = state.dailyId;
        changed = true;
      }
    }
  }

  if (now >= state.hardInvalidateAtUtcMs && state.newLevelDailyId !== state.dailyId) {
    if (!hasFocusedClient) {
      const notified = await emitSystemNotification(state, 'new-level');
      if (notified) {
        state.newLevelDailyId = state.dailyId;
        changed = true;
      }
    }
  }

  if (changed) {
    state = await writeDailyState(state);
  }

  return state;
};

const registerPendingDailySync = async () => {
  if (typeof self.registration?.sync?.register === 'function') {
    try {
      await self.registration.sync.register(DAILY_CHECK_TAG);
    } catch {
      // Sync registration is best effort.
    }
  }
};

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
self.__tetherSwPluginApi = SW_PLUGIN_API;

const loadSwPlugins = () => {
  const pluginScriptUrl = (() => {
    try {
      const swUrl = new URL(self.location.href);
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

const dispatchPluginMessage = (event, data) => {
  const messageType = normalizeString(data?.type);
  const pluginHandler = swPluginMessageHandlers.get(messageType);
  if (typeof pluginHandler !== 'function') return false;

  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
  event.waitUntil(Promise.resolve(pluginHandler({
    event,
    data,
    payload,
    api: SW_PLUGIN_API,
  })));
  return true;
};

loadSwPlugins();

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== DAILY_CHECK_TAG) return;
  event.waitUntil(enqueueDailyTask(() => runDailyCheck()));
});

self.addEventListener('sync', (event) => {
  if (event.tag !== DAILY_CHECK_TAG) return;
  event.waitUntil(enqueueDailyTask(() => runDailyCheck()));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    if (allClients.length > 0) {
      const client = allClients[0];
      await client.focus();
      return;
    }
    await self.clients.openWindow(self.registration.scope);
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SW_SKIP_WAITING') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    const approvedBuildNumber = normalizeInt(payload.approvedBuildNumber, null);
    event.waitUntil((async () => {
      if (Number.isInteger(approvedBuildNumber) && approvedBuildNumber > 0) {
        await confirmUpdatePolicyBuild(approvedBuildNumber);
      }
      await self.skipWaiting();
    })());
    return;
  }

  if (data.type === 'SW_SYNC_UPDATE_POLICY') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    event.waitUntil(syncUpdatePolicyFromApp(payload));
    return;
  }

  if (data.type === 'SW_CONFIRM_BUILD_UPDATE') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    const buildNumber = normalizeInt(payload.buildNumber, null);
    event.waitUntil((async () => {
      try {
        const updated = await confirmUpdatePolicyBuild(buildNumber);
        replyToMessagePort(event, {
          ok: Boolean(updated),
          pinnedBuildNumber: Number.isInteger(updated?.pinnedBuildNumber)
            ? updated.pinnedBuildNumber
            : null,
        });
      } catch {
        replyToMessagePort(event, {
          ok: false,
          pinnedBuildNumber: null,
        });
      }
    })());
    return;
  }

  if (data.type === 'SW_SYNC_DAILY_STATE') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    event.waitUntil(enqueueDailyTask(async () => {
      const current = await readDailyState();
      await writeDailyState(mergeDailyStatePayload(current, payload));
      await registerPendingDailySync();
      await runDailyCheck();
    }));
    return;
  }

  if (data.type === 'SW_RUN_DAILY_CHECK') {
    event.waitUntil(enqueueDailyTask(async () => {
      await registerPendingDailySync();
      await runDailyCheck();
    }));
    return;
  }

  if (data.type === 'SW_GET_NOTIFICATION_HISTORY') {
    const sourceClient = event.source && typeof event.source.postMessage === 'function'
      ? event.source
      : null;
    event.waitUntil(enqueueHistoryTask(() => sendHistoryToSourceOrBroadcast(sourceClient)));
    return;
  }

  if (data.type === 'SW_APPEND_TOAST_HISTORY') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    const title = normalizeString(payload.title);
    const body = normalizeString(payload.body);
    if (!title && !body) return;
    event.waitUntil(appendToastHistoryEntry(title, body));
    return;
  }

  if (data.type === 'SW_APPEND_SYSTEM_HISTORY') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
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
    return;
  }

  if (data.type === 'SW_CLEAR_UPDATE_HISTORY_ACTIONS') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    event.waitUntil(clearUpdateHistoryActions({
      buildNumber: normalizeInt(payload.buildNumber, null),
    }));
    return;
  }

  if (data.type === 'SW_MARK_NOTIFICATION_HISTORY_READ') {
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    event.waitUntil(markHistoryRead({
      historyVersion: normalizeInt(payload.historyVersion, null),
      entryIds: Array.isArray(payload.entryIds) ? payload.entryIds : [],
    }));
    return;
  }

  dispatchPluginMessage(event, data);
});
