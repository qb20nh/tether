const BUILD_NUMBER = Number.parseInt('__TETHER_BUILD_NUMBER__', 10) || 0;
const BUILD_LABEL = '__TETHER_BUILD_LABEL__';

const APP_CACHE = `tether-app-${BUILD_NUMBER}`;
const DAILY_CACHE = `tether-daily-${BUILD_NUMBER}`;
const META_CACHE = 'tether-meta-v1';

const DAILY_CHECK_TAG = 'tether-daily-check';
const DEFAULT_WARNING_HOURS = 8;
const HISTORY_MAX_ENTRIES = 20;
const HISTORY_VERSION_START = 1;
const SW_PLUGIN_QUERY_PARAM = 'plugin';

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

const buildCaches = Object.freeze([APP_CACHE, DAILY_CACHE, META_CACHE]);

const isCacheableResponse = (response) =>
  Boolean(response && response.ok && response.type === 'basic');

const isNavigationRequest = (request) =>
  request.mode === 'navigate' || request.destination === 'document';

const isVersionRequest = (url) => url.pathname.endsWith('/version.json');
const isDailyPayloadRequest = (url) => url.pathname.endsWith('/daily/today.json');

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
const resolveMetaStateUrl = () => new URL('__tether_internal__/daily-state', self.registration.scope).toString();
const resolveMetaHistoryUrl = () => new URL('__tether_internal__/notification-history', self.registration.scope).toString();
const resolveNotificationIconUrl = () => new URL('icons/icon-192.webp', self.registration.scope).toString();
const resolveNotificationBadgeUrl = () => new URL('icons/icon-96.webp', self.registration.scope).toString();

const openCache = (name) => caches.open(name);
const fetchFresh = (request) => fetch(new Request(request, { cache: 'no-store' }));

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('tether-') && !buildCaches.includes(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

const networkOnlyVersion = async (request) => {
  return fetchFresh(request);
};

const networkFirstDaily = async (request) => {
  const cache = await openCache(DAILY_CACHE);
  try {
    const response = await fetchFresh(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Offline' });
  }
};

const cacheFirstRevalidateStatic = async (event, request) => {
  const cache = await openCache(APP_CACHE);
  const cached = await cache.match(request);
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
  const cache = await openCache(APP_CACHE);
  const shellUrl = resolveShellUrl();
  const cachedExact = await cache.match(request, { ignoreSearch: true });
  const cachedShell = await cache.match(shellUrl, { ignoreSearch: true });

  const networkPromise = fetchFresh(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        await cache.put(shellUrl, response.clone());
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
    event.respondWith(cacheFirstRevalidateStatic(event, request));
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
  const cache = await openCache(META_CACHE);
  const response = await cache.match(resolveMetaStateUrl(), { ignoreSearch: true });
  if (!response) {
    return normalizeDailyStatePayload({});
  }

  try {
    const parsed = await response.json();
    return normalizeDailyStatePayload(parsed);
  } catch {
    return normalizeDailyStatePayload({});
  }
};

const writeDailyState = async (state) => {
  const cache = await openCache(META_CACHE);
  const normalized = normalizeDailyStatePayload(state);
  const body = `${JSON.stringify(normalized)}\n`;
  await cache.put(
    resolveMetaStateUrl(),
    new Response(body, {
      headers: { 'content-type': 'application/json' },
    }),
  );
  return normalized;
};

const normalizeHistoryMarker = (value) => {
  if (value === HISTORY_MARKERS.UNREAD) return HISTORY_MARKERS.UNREAD;
  if (value === HISTORY_MARKERS.JUST_READ) return HISTORY_MARKERS.JUST_READ;
  return HISTORY_MARKERS.OLDER;
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
  const cache = await openCache(META_CACHE);
  const response = await cache.match(resolveMetaHistoryUrl(), { ignoreSearch: true });
  if (!response) {
    return normalizeHistoryState({});
  }

  try {
    const parsed = await response.json();
    return normalizeHistoryState(parsed);
  } catch {
    return normalizeHistoryState({});
  }
};

const writeHistoryState = async (state) => {
  const cache = await openCache(META_CACHE);
  const normalized = normalizeHistoryState(state);
  const body = `${JSON.stringify(normalized)}\n`;
  await cache.put(
    resolveMetaHistoryUrl(),
    new Response(body, {
      headers: { 'content-type': 'application/json' },
    }),
  );
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

const appendSystemHistoryEntry = async (kind, title, body, dailyId) => {
  return appendHistoryEntry({
    source: 'system',
    kind,
    title,
    body,
    createdAtUtcMs: Date.now(),
    marker: HISTORY_MARKERS.UNREAD,
    dailyId,
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
  await appendSystemHistoryEntry(normalizedKind, title, body, dailyId);
  return true;
};

const showNotification = async (title, options) => {
  if (!self.registration || typeof self.registration.showNotification !== 'function') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  await self.registration.showNotification(title, options);
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
    event.waitUntil(self.skipWaiting());
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
