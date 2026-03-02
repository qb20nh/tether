const BUILD_NUMBER = Number.parseInt('__TETHER_BUILD_NUMBER__', 10) || 0;
const BUILD_LABEL = '__TETHER_BUILD_LABEL__';

const APP_CACHE = `tether-app-${BUILD_NUMBER}`;
const DAILY_CACHE = `tether-daily-${BUILD_NUMBER}`;
const META_CACHE = 'tether-meta-v1';

const DAILY_CHECK_TAG = 'tether-daily-check';
const DEFAULT_WARNING_HOURS = 8;

const notificationDefaults = Object.freeze({
  unsolvedTitle: 'Daily level ending soon',
  unsolvedBody: 'Your daily level is still unsolved. Time is running out.',
  newLevelTitle: 'New daily level available',
  newLevelBody: 'A new daily level is ready to play.',
});

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

const buildCaches = Object.freeze([APP_CACHE, DAILY_CACHE, META_CACHE]);

const resolveShellUrl = () => new URL('index.html', self.registration.scope).toString();
const resolveMetaStateUrl = () => new URL('__tether_internal__/daily-state', self.registration.scope).toString();

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
  let changed = false;

  if (
    unsolved
    && now >= warningStartMs
    && now < state.hardInvalidateAtUtcMs
    && state.warnedDailyId !== state.dailyId
  ) {
    await showNotification(state.notificationText.unsolvedTitle, {
      body: state.notificationText.unsolvedBody,
      tag: `tether-unsolved-${state.dailyId}`,
      renotify: false,
      data: {
        type: 'unsolved-warning',
        dailyId: state.dailyId,
        buildNumber: BUILD_NUMBER,
      },
    });
    state.warnedDailyId = state.dailyId;
    changed = true;
  }

  if (now >= state.hardInvalidateAtUtcMs && state.newLevelDailyId !== state.dailyId) {
    await showNotification(state.notificationText.newLevelTitle, {
      body: state.notificationText.newLevelBody,
      tag: `tether-new-level-${state.dailyId}`,
      renotify: false,
      data: {
        type: 'new-level',
        dailyId: state.dailyId,
        buildNumber: BUILD_NUMBER,
      },
    });
    state.newLevelDailyId = state.dailyId;
    changed = true;
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

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== DAILY_CHECK_TAG) return;
  event.waitUntil(runDailyCheck());
});

self.addEventListener('sync', (event) => {
  if (event.tag !== DAILY_CHECK_TAG) return;
  event.waitUntil(runDailyCheck());
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
    event.waitUntil((async () => {
      await writeDailyState(payload);
      await registerPendingDailySync();
      await runDailyCheck();
    })());
    return;
  }

  if (data.type === 'SW_RUN_DAILY_CHECK') {
    event.waitUntil((async () => {
      await registerPendingDailySync();
      await runDailyCheck();
    })());
  }
});
