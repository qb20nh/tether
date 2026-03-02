import { mountStyles } from './styles.js';
import { APP_SHELL_TEMPLATE, buildLegendTemplate } from './templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './icons.js';
import { ELEMENT_IDS } from './config.js';
import {
  getLocaleOptions,
  getLocale,
  resolveLocale,
  setLocale as setLocaleCore,
  t as createTranslator,
} from './i18n.js';
import { createDefaultAdapters } from './runtime/default_adapters.js';
import { createRuntime } from './runtime/create_runtime.js';

const BUILD_NUMBER_META_NAME = 'tether-build-number';
const DAILY_PAYLOAD_FILE = 'daily/today.json';
const VERSION_FILE = 'version.json';

const DAILY_HARD_INVALIDATE_GRACE_MS = 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;
const DAILY_NOTIFICATION_WARNING_HOURS = 8;
const DAILY_CHECK_TAG = 'tether-daily-check';
const LAST_SEEN_BUILD_NUMBER_KEY = 'tetherLastSeenBuildNumber';
const APP_TOAST_ID = 'appToast';
const APP_TOAST_VISIBLE_MS = 3200;

const NOTIFICATION_AUTO_PROMPT_KEY = 'tetherNotificationAutoPromptDecision';
const NOTIFICATION_ENABLED_KEY = 'tetherNotificationsEnabled';
const PATH_PREDICTION_ENABLED_KEY = 'tetherPathPredictionEnabled';
const NOTIFICATION_AUTO_PROMPT_DECISIONS = Object.freeze({
  UNSET: 'unset',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

let runtimeInstance = null;
let runtimeTeardownBound = false;
let swRegistration = null;
let swReloadOnControllerChangeArmed = false;
let swControllerChangeBound = false;
let updateCheckInFlight = false;
let lastUpdateCheckAtMs = 0;
let promptedRemoteBuildNumbers = new Set();
let notificationsToggleEl = null;
let notificationsToggleBound = false;
let pathPredictionToggleEl = null;
let pathPredictionToggleBound = false;

const localBuildNumber = (() => {
  const meta = document.querySelector(`meta[name="${BUILD_NUMBER_META_NAME}"]`);
  const parsed = Number.parseInt(meta?.content || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
})();

const resolveBaseUrl = () => {
  const baseUrl = typeof import.meta.env.BASE_URL === 'string' && import.meta.env.BASE_URL.length > 0
    ? import.meta.env.BASE_URL
    : './';
  return new URL(baseUrl, window.location.href);
};

const resolveDailyPayloadUrl = () => {
  const configured = typeof import.meta.env.VITE_DAILY_URL === 'string'
    ? import.meta.env.VITE_DAILY_URL.trim()
    : '';
  if (configured) {
    return new URL(configured, window.location.href).toString();
  }
  return new URL(DAILY_PAYLOAD_FILE, resolveBaseUrl()).toString();
};

const resolveVersionUrl = () => new URL(VERSION_FILE, resolveBaseUrl()).toString();

const DAILY_PAYLOAD_URL = resolveDailyPayloadUrl();
const VERSION_URL = resolveVersionUrl();

const latestDailyState = {
  dailyId: null,
  hardInvalidateAtUtcMs: null,
  dailySolvedDate: null,
};

const teardownRuntime = () => {
  if (!runtimeInstance) return;
  runtimeInstance.destroy();
  runtimeInstance = null;
};

const readLastSeenBuildNumber = () => {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_BUILD_NUMBER_KEY);
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return null;
};

const writeLastSeenBuildNumber = (buildNumber) => {
  if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
  try {
    window.localStorage.setItem(LAST_SEEN_BUILD_NUMBER_KEY, String(buildNumber));
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

const detectBuildUpgrade = () => {
  if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) return false;
  const previousBuild = readLastSeenBuildNumber();
  writeLastSeenBuildNumber(localBuildNumber);
  return Number.isInteger(previousBuild) && localBuildNumber > previousBuild;
};

const showInAppToast = (text) => {
  if (typeof text !== 'string' || text.trim().length === 0) return;

  const existing = document.getElementById(APP_TOAST_ID);
  if (existing) existing.remove();

  const toastEl = document.createElement('div');
  toastEl.id = APP_TOAST_ID;
  toastEl.className = 'appToast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.textContent = text.trim();

  document.body.appendChild(toastEl);
  window.requestAnimationFrame(() => {
    toastEl.classList.add('isVisible');
  });

  window.setTimeout(() => {
    toastEl.classList.remove('isVisible');
    window.setTimeout(() => {
      if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    }, 220);
  }, APP_TOAST_VISIBLE_MS);
};

const canUseServiceWorker = () =>
  typeof window !== 'undefined'
  && window.isSecureContext
  && typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator;

const supportsNotifications = () =>
  typeof window !== 'undefined'
  && 'Notification' in window;

const readAutoPromptDecision = () => {
  try {
    const value = window.localStorage.getItem(NOTIFICATION_AUTO_PROMPT_KEY);
    if (
      value === NOTIFICATION_AUTO_PROMPT_DECISIONS.ACCEPTED
      || value === NOTIFICATION_AUTO_PROMPT_DECISIONS.DECLINED
    ) {
      return value;
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET;
};

const writeAutoPromptDecision = (decision) => {
  if (
    decision !== NOTIFICATION_AUTO_PROMPT_DECISIONS.ACCEPTED
    && decision !== NOTIFICATION_AUTO_PROMPT_DECISIONS.DECLINED
  ) {
    return;
  }
  try {
    window.localStorage.setItem(NOTIFICATION_AUTO_PROMPT_KEY, decision);
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

const readNotificationEnabledPreference = () => {
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_ENABLED_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return notificationPermissionState() === 'granted';
};

const writeNotificationEnabledPreference = (enabled) => {
  try {
    window.localStorage.setItem(NOTIFICATION_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

const readPathPredictionEnabledPreference = () => {
  try {
    const raw = window.localStorage.getItem(PATH_PREDICTION_ENABLED_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return true;
};

const writePathPredictionEnabledPreference = (enabled) => {
  try {
    window.localStorage.setItem(PATH_PREDICTION_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

const hasStoredNotificationEnabledPreference = () => {
  try {
    return window.localStorage.getItem(NOTIFICATION_ENABLED_KEY) !== null;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return false;
};

const notificationPermissionState = () => {
  if (!supportsNotifications()) return 'unsupported';
  return Notification.permission;
};

const refreshNotificationsToggleUi = () => {
  if (!notificationsToggleEl) return;
  const enabled = readNotificationEnabledPreference();
  const permission = notificationPermissionState();
  notificationsToggleEl.checked = enabled;
  notificationsToggleEl.disabled = permission === 'unsupported';
};

const refreshPathPredictionToggleUi = () => {
  if (!pathPredictionToggleEl) return;
  pathPredictionToggleEl.checked = readPathPredictionEnabledPreference();
};

const translateNow = (key, vars = {}) => createTranslator(getLocale())(key, vars);

const buildNotificationTextPayload = (locale = getLocale()) => {
  const translate = createTranslator(locale);
  return {
    unsolvedTitle: translate('ui.notificationUnsolvedTitle'),
    unsolvedBody: translate('ui.notificationUnsolvedBody'),
    newLevelTitle: translate('ui.notificationNewLevelTitle'),
    newLevelBody: translate('ui.notificationNewLevelBody'),
  };
};

const postMessageToServiceWorker = async (message) => {
  if (!canUseServiceWorker()) return;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
    return;
  }
  if (!swRegistration) return;
  const fallbackWorker = swRegistration.active || swRegistration.waiting || swRegistration.installing;
  if (fallbackWorker) fallbackWorker.postMessage(message);
};

const syncDailyStateToServiceWorker = async () => {
  if (!canUseServiceWorker()) return;
  await postMessageToServiceWorker({
    type: 'SW_SYNC_DAILY_STATE',
    payload: {
      dailyId: latestDailyState.dailyId,
      hardInvalidateAtUtcMs: latestDailyState.hardInvalidateAtUtcMs,
      dailySolvedDate: latestDailyState.dailySolvedDate,
      notificationsEnabled: readNotificationEnabledPreference(),
      warningHours: DAILY_NOTIFICATION_WARNING_HOURS,
      notificationText: buildNotificationTextPayload(),
    },
  });
};

const requestServiceWorkerDailyCheck = async () => {
  if (!canUseServiceWorker()) return;
  await postMessageToServiceWorker({ type: 'SW_RUN_DAILY_CHECK' });
};

const registerBackgroundDailyCheck = async () => {
  if (!swRegistration || !supportsNotifications() || Notification.permission !== 'granted') return;
  if (!readNotificationEnabledPreference()) return;
  try {
    if (typeof swRegistration.sync?.register === 'function') {
      await swRegistration.sync.register(DAILY_CHECK_TAG);
    }
  } catch {
    // One-shot sync registration is best effort.
  }
  try {
    if (typeof swRegistration.periodicSync?.register === 'function') {
      await swRegistration.periodicSync.register(DAILY_CHECK_TAG, {
        minInterval: 12 * 60 * 60 * 1000,
      });
    }
  } catch {
    // Periodic sync support and permission are browser-dependent.
  }
};

const requestNotificationPermission = async () => {
  if (!supportsNotifications()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission || 'default';
  }
};

const enableNotificationsNow = async () => {
  writeNotificationEnabledPreference(true);
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    writeNotificationEnabledPreference(false);
    if (permission === 'denied') {
      const deniedText = translateNow('ui.notificationsBlockedToast');
      if (deniedText !== 'ui.notificationsBlockedToast') {
        showInAppToast(deniedText);
      }
    }
    refreshNotificationsToggleUi();
    await syncDailyStateToServiceWorker();
    return false;
  }

  refreshNotificationsToggleUi();
  await syncDailyStateToServiceWorker();
  await registerBackgroundDailyCheck();
  await requestServiceWorkerDailyCheck();
  return true;
};

const disableNotificationsNow = async () => {
  writeNotificationEnabledPreference(false);
  refreshNotificationsToggleUi();
  await syncDailyStateToServiceWorker();
};

const maybeAutoPromptForNotifications = async () => {
  if (!supportsNotifications() || !canUseServiceWorker()) return;
  if (hasStoredNotificationEnabledPreference() && !readNotificationEnabledPreference()) return;
  if (notificationPermissionState() === 'granted') return;
  if (readAutoPromptDecision() !== NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET) return;

  const confirmed = window.confirm(translateNow('ui.notificationsAutoPromptConfirm'));
  if (!confirmed) {
    writeAutoPromptDecision(NOTIFICATION_AUTO_PROMPT_DECISIONS.DECLINED);
    writeNotificationEnabledPreference(false);
    refreshNotificationsToggleUi();
    await syncDailyStateToServiceWorker();
    return;
  }

  writeAutoPromptDecision(NOTIFICATION_AUTO_PROMPT_DECISIONS.ACCEPTED);
  await enableNotificationsNow();
};

const bindNotificationsToggle = () => {
  notificationsToggleEl = document.getElementById(ELEMENT_IDS.NOTIFICATIONS_TOGGLE);

  if (!notificationsToggleEl || notificationsToggleBound) {
    refreshNotificationsToggleUi();
    return;
  }
  notificationsToggleEl.addEventListener('change', () => {
    if (notificationsToggleEl.checked) {
      void enableNotificationsNow();
      return;
    }
    void disableNotificationsNow();
  });

  notificationsToggleBound = true;
  refreshNotificationsToggleUi();
};

const bindPathPredictionToggle = () => {
  pathPredictionToggleEl = document.getElementById(ELEMENT_IDS.PATH_PREDICTION_TOGGLE);

  if (!pathPredictionToggleEl || pathPredictionToggleBound) {
    refreshPathPredictionToggleUi();
    return;
  }

  pathPredictionToggleEl.addEventListener('change', () => {
    writePathPredictionEnabledPreference(pathPredictionToggleEl.checked);
    refreshPathPredictionToggleUi();
  });

  pathPredictionToggleBound = true;
  refreshPathPredictionToggleUi();
};

const utcDateIdFromMs = (ms) => {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeGrid = (grid) => {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const out = [];
  let cols = null;
  for (const row of grid) {
    if (typeof row !== 'string' || row.length === 0) return null;
    if (cols === null) cols = row.length;
    if (row.length !== cols) return null;
    out.push(row);
  }
  return out;
};

const normalizePairs = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    out.push([a, b]);
  }
  return out;
};

const normalizeCornerCounts = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 3) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    const c = Number.parseInt(entry[2], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return null;
    out.push([a, b, c]);
  }
  return out;
};

const normalizeDailyPayload = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const dailyId = typeof raw.dailyId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyId)
    ? raw.dailyId
    : null;
  if (!dailyId) return null;

  const hardInvalidateAtUtcMs = Number.parseInt(raw.hardInvalidateAtUtcMs, 10);
  if (!Number.isInteger(hardInvalidateAtUtcMs) || hardInvalidateAtUtcMs <= 0) return null;

  const levelRaw = raw.level;
  if (!levelRaw || typeof levelRaw !== 'object') return null;
  const grid = normalizeGrid(levelRaw.grid);
  const stitches = normalizePairs(levelRaw.stitches);
  const cornerCounts = normalizeCornerCounts(levelRaw.cornerCounts);
  if (!grid || !stitches || !cornerCounts) return null;

  const dailySlot = Number.parseInt(raw.dailySlot, 10);
  const generatedAtUtcMs = Number.parseInt(raw.generatedAtUtcMs, 10);

  return {
    schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0,
    poolVersion: typeof raw.poolVersion === 'string' ? raw.poolVersion : '',
    dailyId,
    dailySlot: Number.isInteger(dailySlot) ? dailySlot : null,
    canonicalKey: typeof raw.canonicalKey === 'string' ? raw.canonicalKey : '',
    generatedAtUtcMs: Number.isInteger(generatedAtUtcMs) ? generatedAtUtcMs : null,
    hardInvalidateAtUtcMs,
    level: {
      name: typeof levelRaw.name === 'string' ? levelRaw.name : `Daily ${dailyId}`,
      grid,
      stitches,
      cornerCounts,
    },
  };
};

const fetchDailyPayload = async ({ bypassCache = false } = {}) => {
  try {
    const headers = bypassCache
      ? { 'x-bypass-cache': 'true' }
      : undefined;
    const response = await fetch(DAILY_PAYLOAD_URL, {
      cache: bypassCache ? 'no-store' : 'default',
      headers,
    });

    if (!response.ok) return null;
    const parsed = normalizeDailyPayload(await response.json());
    return parsed;
  } catch {
    return null;
  }
};

const resolveDailyBootPayload = async () => {
  const nowMs = Date.now();
  const todayId = utcDateIdFromMs(nowMs);

  let payload = await fetchDailyPayload();
  if (!payload) {
    return {
      dailyLevel: null,
      dailyId: null,
      hardInvalidateAtUtcMs: null,
      stalePayload: null,
    };
  }

  if (payload.dailyId > todayId) {
    return {
      dailyLevel: null,
      dailyId: null,
      hardInvalidateAtUtcMs: payload.hardInvalidateAtUtcMs,
      stalePayload: payload,
    };
  }

  if (payload.dailyId !== todayId && nowMs > (payload.hardInvalidateAtUtcMs + DAILY_HARD_INVALIDATE_GRACE_MS)) {
    const bypassPayload = await fetchDailyPayload({ bypassCache: true });
    if (bypassPayload) payload = bypassPayload;
  }

  if (payload.dailyId !== todayId) {
    return {
      dailyLevel: null,
      dailyId: null,
      hardInvalidateAtUtcMs: payload.hardInvalidateAtUtcMs,
      stalePayload: payload,
    };
  }

  return {
    dailyLevel: payload.level,
    dailyId: payload.dailyId,
    hardInvalidateAtUtcMs: payload.hardInvalidateAtUtcMs,
    stalePayload: null,
  };
};

const setupDailyHardInvalidationWatcher = (bootDaily) => {
  if (!bootDaily || !Number.isInteger(bootDaily.hardInvalidateAtUtcMs)) return;

  const thresholdMs = bootDaily.hardInvalidateAtUtcMs + DAILY_HARD_INVALIDATE_GRACE_MS;
  const shouldBypassNow = () => Date.now() > thresholdMs;

  const maybeRefetch = async () => {
    if (!shouldBypassNow()) return;

    const nowMs = Date.now();
    const todayId = utcDateIdFromMs(nowMs);
    const bypassPayload = await fetchDailyPayload({ bypassCache: true });
    if (!bypassPayload || bypassPayload.dailyId !== todayId) return;

    if (bootDaily.dailyId !== bypassPayload.dailyId) {
      window.location.reload();
    }
  };

  const delay = thresholdMs - Date.now();
  if (delay > 0) {
    window.setTimeout(() => {
      void maybeRefetch();
    }, delay + 25);
  } else {
    void maybeRefetch();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void maybeRefetch();
  });
};

const parseRemoteBuildNumber = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const parsed = Number.parseInt(payload.buildNumber, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const fetchRemoteBuildNumber = async () => {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    return parseRemoteBuildNumber(payload);
  } catch {
    return null;
  }
};

const armControllerChangeReload = () => {
  if (!canUseServiceWorker()) return;
  if (swControllerChangeBound) {
    swReloadOnControllerChangeArmed = true;
    return;
  }
  swControllerChangeBound = true;
  swReloadOnControllerChangeArmed = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swReloadOnControllerChangeArmed) return;
    swReloadOnControllerChangeArmed = false;
    window.location.reload();
  });
};

const waitForWaitingWorker = (registration, timeoutMs = 8000) =>
  new Promise((resolve) => {
    if (registration.waiting) {
      resolve(registration.waiting);
      return;
    }

    let settled = false;
    const cleanups = [];
    const finish = (worker = null) => {
      if (settled) return;
      settled = true;
      for (const fn of cleanups) fn();
      resolve(worker || registration.waiting || null);
    };

    const bindInstallingWorker = (worker) => {
      if (!worker) return;
      const onStateChange = () => {
        if (worker.state === 'installed') {
          finish(registration.waiting || worker);
        }
      };
      worker.addEventListener('statechange', onStateChange);
      cleanups.push(() => worker.removeEventListener('statechange', onStateChange));
    };

    bindInstallingWorker(registration.installing);

    const onUpdateFound = () => {
      bindInstallingWorker(registration.installing);
    };
    registration.addEventListener('updatefound', onUpdateFound);
    cleanups.push(() => registration.removeEventListener('updatefound', onUpdateFound));

    const timer = window.setTimeout(() => {
      finish(null);
    }, timeoutMs);
    cleanups.push(() => window.clearTimeout(timer));
  });

const maybeApplyUpdate = async (remoteBuildNumber) => {
  if (!swRegistration) return;
  if (promptedRemoteBuildNumbers.has(remoteBuildNumber)) return;

  try {
    await swRegistration.update();
  } catch {
    return;
  }

  const waitingWorker = await waitForWaitingWorker(swRegistration);
  if (!waitingWorker) return;

  promptedRemoteBuildNumbers.add(remoteBuildNumber);
  armControllerChangeReload();
  waitingWorker.postMessage({ type: 'SW_SKIP_WAITING' });
};

const checkForNewBuild = async ({ force = false } = {}) => {
  if (!canUseServiceWorker() || !swRegistration) return;
  if (!navigator.onLine) return;
  if (updateCheckInFlight) return;

  const nowMs = Date.now();
  if (!force && nowMs - lastUpdateCheckAtMs < UPDATE_CHECK_THROTTLE_MS) return;

  updateCheckInFlight = true;
  lastUpdateCheckAtMs = nowMs;
  try {
    const remoteBuildNumber = await fetchRemoteBuildNumber();
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return;
    await maybeApplyUpdate(remoteBuildNumber);
  } finally {
    updateCheckInFlight = false;
  }
};

const registerServiceWorker = async () => {
  if (!canUseServiceWorker()) return null;
  try {
    swRegistration = await navigator.serviceWorker.register(new URL('sw.js', window.location.href));
    await navigator.serviceWorker.ready;
    await syncDailyStateToServiceWorker();
    await registerBackgroundDailyCheck();
    await requestServiceWorkerDailyCheck();
    void checkForNewBuild({ force: true });
    return swRegistration;
  } catch {
    swRegistration = null;
    return null;
  }
};

const bindServiceWorkerRuntimeEvents = () => {
  if (!canUseServiceWorker()) return;

  window.addEventListener('online', () => {
    void checkForNewBuild();
    void requestServiceWorkerDailyCheck();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void checkForNewBuild();
    void requestServiceWorkerDailyCheck();
  });
};

const wrapPersistenceForDailySideEffects = (persistence) => {
  if (!persistence || typeof persistence.writeDailySolvedDate !== 'function') return;

  const originalWriteDailySolvedDate = persistence.writeDailySolvedDate.bind(persistence);
  persistence.writeDailySolvedDate = (dailyId) => {
    const previous = latestDailyState.dailySolvedDate;
    originalWriteDailySolvedDate(dailyId);
    if (typeof dailyId === 'string' && dailyId.length > 0) {
      latestDailyState.dailySolvedDate = dailyId;
    }

    const changed = previous !== latestDailyState.dailySolvedDate;
    if (changed) {
      void syncDailyStateToServiceWorker();
      if (readAutoPromptDecision() === NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET) {
        void maybeAutoPromptForNotifications();
      }
    }
  };
};

export async function initTetherApp() {
  if (!runtimeTeardownBound) {
    window.addEventListener('pagehide', teardownRuntime);
    window.addEventListener('beforeunload', teardownRuntime);
    runtimeTeardownBound = true;
  }

  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;
  const didUpgradeBuild = detectBuildUpgrade();

  const bootDaily = await resolveDailyBootPayload();
  setupDailyHardInvalidationWatcher(bootDaily);
  latestDailyState.dailyId = bootDaily.dailyId;
  latestDailyState.hardInvalidateAtUtcMs = bootDaily.hardInvalidateAtUtcMs;

  const initialLocale = resolveLocale();
  const translate = createTranslator(initialLocale);

  appEl.innerHTML = APP_SHELL_TEMPLATE(
    translate,
    getLocaleOptions(initialLocale),
    initialLocale,
  );

  bindPathPredictionToggle();
  bindNotificationsToggle();
  bindServiceWorkerRuntimeEvents();

  const adapters = createDefaultAdapters({
    icons: ICONS,
    iconX: ICON_X,
    dailyLevel: bootDaily.dailyLevel,
    dailyId: bootDaily.dailyId,
  });

  const bootState = adapters.persistence.readBootState();
  latestDailyState.dailySolvedDate = typeof bootState.dailySolvedDate === 'string'
    ? bootState.dailySolvedDate
    : null;
  wrapPersistenceForDailySideEffects(adapters.persistence);

  const setLocaleWithEffects = (locale) => {
    const resolved = setLocaleCore(locale);
    refreshNotificationsToggleUi();
    void syncDailyStateToServiceWorker();
    return resolved;
  };

  runtimeInstance = createRuntime({
    appEl,
    core: adapters.core,
    state: adapters.state,
    persistence: adapters.persistence,
    renderer: adapters.renderer,
    input: adapters.input,
    i18n: {
      getLocaleOptions,
      getLocale,
      resolveLocale,
      setLocale: setLocaleWithEffects,
      createTranslator,
    },
    ui: {
      buildLegendTemplate,
      badgeDefinitions: BADGE_DEFINITIONS,
      icons: ICONS,
      iconX: ICON_X,
    },
    dailyHardInvalidateAtUtcMs: bootDaily.hardInvalidateAtUtcMs,
  });

  runtimeInstance.start();
  refreshNotificationsToggleUi();
  if (didUpgradeBuild) {
    const toastText = translateNow('ui.updateAppliedToast');
    if (toastText !== 'ui.updateAppliedToast') {
      showInAppToast(toastText);
    }
  }

  if (!swRegistration) {
    void registerServiceWorker();
  }
}

void initTetherApp();
