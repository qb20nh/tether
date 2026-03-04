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
import { uiActionIntent, UI_ACTIONS } from './runtime/intents.js';
import { mountRuntimePlugins, resolveServiceWorkerRegistrationUrl } from './plugins/runtime_plugins.js';
import {
  HISTORY_DOT_COLORS,
  formatHistoryAbsoluteTime,
  formatHistoryRelativeTime,
  hasUnreadSystemHistory,
  historyEntryDotColor,
  normalizeHistoryAction,
} from './runtime/notification_history.js';

const BUILD_NUMBER_META_NAME = 'tether-build-number';
const DAILY_PAYLOAD_FILE = 'daily/today.json';
const VERSION_FILE = 'version.json';

const DAILY_HARD_INVALIDATE_GRACE_MS = 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;
const DAILY_NOTIFICATION_WARNING_HOURS = 8;
const DAILY_CHECK_TAG = 'tether-daily-check';
const SW_BUILD_NUMBER_RE = /BUILD_NUMBER\s*=\s*Number\.parseInt\(\s*['"](\d+)['"]\s*,\s*10\)/;
const LAST_SEEN_BUILD_NUMBER_KEY = 'tetherLastSeenBuildNumber';
const APP_TOAST_ID = 'appToast';
const APP_TOAST_VISIBLE_MS = 3200;
const HISTORY_RELATIVE_TIME_REFRESH_MS = 60 * 1000;
const HISTORY_MAX_ENTRIES = 10;
const HISTORY_DYING_START_INDEX = 5;
const HISTORY_EMPTY_PLACEHOLDER_TEXT = 'No notifications yet.';

const SW_MESSAGE_TYPES = Object.freeze({
  SYNC_DAILY_STATE: 'SW_SYNC_DAILY_STATE',
  RUN_DAILY_CHECK: 'SW_RUN_DAILY_CHECK',
  GET_HISTORY: 'SW_GET_NOTIFICATION_HISTORY',
  APPEND_TOAST_HISTORY: 'SW_APPEND_TOAST_HISTORY',
  APPEND_SYSTEM_HISTORY: 'SW_APPEND_SYSTEM_HISTORY',
  CLEAR_UPDATE_HISTORY_ACTIONS: 'SW_CLEAR_UPDATE_HISTORY_ACTIONS',
  MARK_HISTORY_READ: 'SW_MARK_NOTIFICATION_HISTORY_READ',
  HISTORY_UPDATE: 'SW_NOTIFICATION_HISTORY',
});

const NOTIFICATION_AUTO_PROMPT_KEY = 'tetherNotificationAutoPromptDecision';
const NOTIFICATION_ENABLED_KEY = 'tetherNotificationsEnabled';
const PATH_PREDICTION_ENABLED_KEY = 'tetherPathPredictionEnabled';
const AUTO_UPDATE_ENABLED_KEY = 'tetherAutoUpdateEnabled';
const LAST_NOTIFIED_REMOTE_BUILD_KEY = 'tetherLastNotifiedRemoteBuildNumber';
const NOTIFICATION_AUTO_PROMPT_DECISIONS = Object.freeze({
  UNSET: 'unset',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

let runtimeInstance = null;
let runtimeStateAdapter = null;
let runtimeCoreAdapter = null;
let runtimeTeardownBound = false;
let swRegistration = null;
let swReloadOnControllerChangeArmed = false;
let swControllerChangeBound = false;
let updateCheckInFlight = false;
let lastUpdateCheckAtMs = 0;
let promptedRemoteBuildNumbers = new Set();
let notificationsToggleEl = null;
let notificationsToggleBound = false;
let autoUpdateToggleEl = null;
let autoUpdateToggleBound = false;
let pathPredictionToggleEl = null;
let pathPredictionToggleBound = false;
let notificationHistoryToggleEl = null;
let notificationHistoryBadgeEl = null;
let notificationHistoryPanelEl = null;
let notificationHistoryListEl = null;
let notificationHistoryToggleBound = false;
let notificationHistoryOpen = false;
let notificationHistoryRefreshTimer = 0;
let notificationHistoryReadAckInFlight = false;
let notificationHistoryReadAckVersion = null;
let notificationHistoryValidationFrame = 0;
let updateApplyDialogEl = null;
let updateApplyMessageEl = null;
let updateApplyDialogBound = false;
let moveDailyDialogEl = null;
let moveDailyMessageEl = null;
let moveDailyDialogBound = false;
let moveDailyDialogResolver = null;
const notifiedRemoteBuildNumbers = new Set();
let swMessageListenerBound = false;
const pendingSwMessages = [];
const notificationHistoryState = {
  historyVersion: 1,
  entries: [],
};

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

const isLocalhostHostname = (hostname = '') =>
  hostname === 'localhost'
  || hostname === '127.0.0.1'
  || hostname === '[::1]'
  || hostname === '::1'
  || hostname.endsWith('.localhost');

const teardownRuntime = () => {
  if (!runtimeInstance) return;
  runtimeInstance.destroy();
  runtimeInstance = null;
  runtimeStateAdapter = null;
  runtimeCoreAdapter = null;
  moveDailyDialogResolver = null;
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

const showInAppToast = (text, options = {}) => {
  if (typeof text !== 'string' || text.trim().length === 0) return;
  const { recordInHistory = true } = options;

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

  if (recordInHistory) {
    void postMessageToServiceWorker({
      type: SW_MESSAGE_TYPES.APPEND_TOAST_HISTORY,
      payload: {
        title: text.trim(),
        body: '',
      },
    }, { queueWhenUnavailable: true });
  }
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

const readAutoUpdateEnabledPreference = () => {
  try {
    return window.localStorage.getItem(AUTO_UPDATE_ENABLED_KEY) === 'true';
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return false;
};

const writeAutoUpdateEnabledPreference = (enabled) => {
  try {
    window.localStorage.setItem(AUTO_UPDATE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

const readLastNotifiedRemoteBuildNumber = () => {
  try {
    const parsed = Number.parseInt(window.localStorage.getItem(LAST_NOTIFIED_REMOTE_BUILD_KEY) || '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return null;
};

const writeLastNotifiedRemoteBuildNumber = (buildNumber) => {
  if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
  try {
    window.localStorage.setItem(LAST_NOTIFIED_REMOTE_BUILD_KEY, String(buildNumber));
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

const refreshAutoUpdateToggleUi = () => {
  if (!autoUpdateToggleEl) return;
  autoUpdateToggleEl.checked = readAutoUpdateEnabledPreference();
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

const flushPendingSwMessages = async () => {
  if (!canUseServiceWorker() || pendingSwMessages.length === 0) return;
  while (pendingSwMessages.length > 0) {
    const next = pendingSwMessages.shift();
    const posted = await postMessageToServiceWorker(next, { queueWhenUnavailable: false });
    if (posted) continue;
    pendingSwMessages.unshift(next);
    break;
  }
};

const postMessageToServiceWorker = async (message, options = {}) => {
  const { queueWhenUnavailable = false } = options;
  if (!canUseServiceWorker()) return false;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
    return true;
  }
  if (!swRegistration) {
    if (queueWhenUnavailable) pendingSwMessages.push(message);
    return false;
  }
  const fallbackWorker = swRegistration.active || swRegistration.waiting || swRegistration.installing;
  if (fallbackWorker) {
    fallbackWorker.postMessage(message);
    return true;
  }
  if (queueWhenUnavailable) {
    pendingSwMessages.push(message);
  }
  return false;
};

const syncDailyStateToServiceWorker = async () => {
  if (!canUseServiceWorker()) return;
  await postMessageToServiceWorker({
    type: SW_MESSAGE_TYPES.SYNC_DAILY_STATE,
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
  await postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.RUN_DAILY_CHECK });
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
        showInAppToast(deniedText, { recordInHistory: false });
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

const bindAutoUpdateToggle = () => {
  autoUpdateToggleEl = document.getElementById(ELEMENT_IDS.AUTO_UPDATE_TOGGLE);

  if (!autoUpdateToggleEl || autoUpdateToggleBound) {
    refreshAutoUpdateToggleUi();
    return;
  }

  autoUpdateToggleEl.addEventListener('change', () => {
    writeAutoUpdateEnabledPreference(autoUpdateToggleEl.checked);
    refreshAutoUpdateToggleUi();
  });

  autoUpdateToggleBound = true;
  refreshAutoUpdateToggleUi();
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

const normalizeHistoryEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) return null;
  const source = entry.source === 'system' ? 'system' : 'toast';
  const kind = typeof entry.kind === 'string' ? entry.kind.trim() : (source === 'system' ? 'unsolved-warning' : 'toast');
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const body = typeof entry.body === 'string' ? entry.body.trim() : '';
  const createdAtUtcMs = Number.parseInt(entry.createdAtUtcMs, 10);
  const marker = entry.marker === 'unread' || entry.marker === 'just-read' || entry.marker === 'older'
    ? entry.marker
    : 'older';
  const action = normalizeHistoryAction(entry.action);
  return {
    id,
    source,
    kind,
    title,
    body,
    createdAtUtcMs: Number.isInteger(createdAtUtcMs) ? createdAtUtcMs : Date.now(),
    marker,
    action,
  };
};

const applyNotificationHistoryPayload = (payload) => {
  const prevVersion = notificationHistoryState.historyVersion;
  const historyVersion = Number.parseInt(payload?.historyVersion, 10);
  const entries = Array.isArray(payload?.entries)
    ? payload.entries.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean).slice(0, HISTORY_MAX_ENTRIES)
    : [];
  notificationHistoryState.historyVersion = Number.isInteger(historyVersion) ? historyVersion : 1;
  notificationHistoryState.entries = entries;

  if (notificationHistoryState.historyVersion !== prevVersion) {
    notificationHistoryReadAckVersion = null;
  }
};

const clearAppliedUpdateHistoryActions = async (appliedBuildNumber = localBuildNumber) => {
  if (!Number.isInteger(appliedBuildNumber) || appliedBuildNumber <= 0) return;
  await postMessageToServiceWorker({
    type: SW_MESSAGE_TYPES.CLEAR_UPDATE_HISTORY_ACTIONS,
    payload: {
      buildNumber: appliedBuildNumber,
    },
  }, { queueWhenUnavailable: true });
};

const refreshNotificationHistoryBadgeUi = () => {
  if (!notificationHistoryToggleEl || !notificationHistoryBadgeEl) return;
  const hasUnreadSystem = hasUnreadSystemHistory(notificationHistoryState.entries);
  notificationHistoryBadgeEl.hidden = !hasUnreadSystem;
  notificationHistoryToggleEl.classList.toggle('hasUnread', hasUnreadSystem);
};

const resolveNotificationHistoryEntryText = (entry) => {
  let title = entry?.title || '-';
  let body = entry?.body || '';

  if (!entry || entry.source !== 'system') {
    return { title, body };
  }

  if (entry.kind === 'unsolved-warning') {
    const localizedTitle = translateNow('ui.notificationUnsolvedTitle');
    const localizedBody = translateNow('ui.notificationUnsolvedBody');
    if (localizedTitle !== 'ui.notificationUnsolvedTitle') title = localizedTitle;
    if (localizedBody !== 'ui.notificationUnsolvedBody') body = localizedBody;
    return { title, body };
  }

  if (entry.kind === 'new-level') {
    const localizedTitle = translateNow('ui.notificationNewLevelTitle');
    const localizedBody = translateNow('ui.notificationNewLevelBody');
    if (localizedTitle !== 'ui.notificationNewLevelTitle') title = localizedTitle;
    if (localizedBody !== 'ui.notificationNewLevelBody') body = localizedBody;
    return { title, body };
  }

  if (entry.kind === 'new-version-available') {
    const localizedTitle = translateNow('ui.newVersionAvailableTitle');
    const localizedBody = translateNow('ui.newVersionAvailableBody');
    if (localizedTitle !== 'ui.newVersionAvailableTitle') title = localizedTitle;
    if (localizedBody !== 'ui.newVersionAvailableBody') body = localizedBody;
    return { title, body };
  }

  return { title, body };
};

const isOpenDailyHistoryActionable = (entry) => {
  if (!entry || !entry.action || entry.action.type !== 'open-daily') return false;
  if (entry.kind !== 'new-level' && entry.kind !== 'unsolved-warning') return true;
  if (!latestDailyState.dailyId) return false;
  return entry.action.dailyId === latestDailyState.dailyId;
};

const renderNotificationHistoryRelativeTimes = () => {
  if (!notificationHistoryListEl) return;
  const locale = getLocale();
  const rows = notificationHistoryListEl.querySelectorAll('.notificationHistoryItem');
  for (const row of rows) {
    const tsRaw = row.getAttribute('data-created-at');
    const createdAtUtcMs = Number.parseInt(tsRaw || '', 10);
    const timeEl = row.querySelector('.notificationHistoryItem__time');
    if (!timeEl || !Number.isInteger(createdAtUtcMs)) continue;
    timeEl.textContent = formatHistoryRelativeTime(createdAtUtcMs, locale);
    timeEl.setAttribute('title', formatHistoryAbsoluteTime(createdAtUtcMs, locale));
  }
};

const renderNotificationHistoryList = () => {
  if (!notificationHistoryListEl) return;
  const entries = notificationHistoryState.entries;
  notificationHistoryListEl.textContent = '';

  if (entries.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'notificationHistoryEmpty';
    const localized = translateNow('ui.notificationHistoryEmpty');
    placeholder.textContent = localized === 'ui.notificationHistoryEmpty'
      ? HISTORY_EMPTY_PLACEHOLDER_TEXT
      : localized;
    notificationHistoryListEl.appendChild(placeholder);
    return;
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const row = document.createElement('div');
    row.className = 'notificationHistoryItem';
    row.setAttribute('data-entry-id', entry.id);
    row.setAttribute('data-entry-kind', entry.kind);
    row.setAttribute('data-created-at', String(entry.createdAtUtcMs));
    row.removeAttribute('data-action-type');
    row.removeAttribute('data-action-build-number');
    row.removeAttribute('data-action-daily-id');

    const actionableEntry = (
      entry.action?.type === 'open-daily'
        ? (isOpenDailyHistoryActionable(entry) ? entry.action : null)
        : entry.action
    );

    if (actionableEntry) {
      row.classList.add('isActionable');
      row.setAttribute('data-action-type', actionableEntry.type);
      if (actionableEntry.type === 'apply-update') {
        row.setAttribute('data-action-build-number', String(actionableEntry.buildNumber));
      } else if (actionableEntry.type === 'open-daily') {
        row.setAttribute('data-action-daily-id', actionableEntry.dailyId);
      }
    }

    const deathRank = (
      entries.length > HISTORY_DYING_START_INDEX && i >= HISTORY_DYING_START_INDEX
        ? (i - HISTORY_DYING_START_INDEX)
        : -1
    );
    if (deathRank >= 0) {
      row.classList.add('isDying');
      row.style.setProperty('--death-rank', String(deathRank));
    }

    const dot = document.createElement('span');
    dot.className = 'notificationHistoryItem__dot';
    const dotColor = historyEntryDotColor(entry);
    if (dotColor === HISTORY_DOT_COLORS.RED) {
      dot.classList.add('isRed');
    } else if (dotColor === HISTORY_DOT_COLORS.BLUE) {
      dot.classList.add('isBlue');
    }
    if (entry.marker === 'older') {
      dot.classList.add('isOlder');
    }

    const content = document.createElement('div');
    content.className = 'notificationHistoryItem__content';

    const localizedEntry = resolveNotificationHistoryEntryText(entry);

    const title = document.createElement('div');
    title.className = 'notificationHistoryItem__title';
    title.textContent = localizedEntry.title;

    const body = document.createElement('div');
    body.className = 'notificationHistoryItem__body';
    body.textContent = localizedEntry.body;

    const time = document.createElement('div');
    time.className = 'notificationHistoryItem__time';
    time.textContent = formatHistoryRelativeTime(entry.createdAtUtcMs, getLocale());
    time.setAttribute('title', formatHistoryAbsoluteTime(entry.createdAtUtcMs, getLocale()));

    content.appendChild(title);
    content.appendChild(body);
    content.appendChild(time);
    row.appendChild(dot);
    row.appendChild(content);
    notificationHistoryListEl.appendChild(row);
  }
};

const stopNotificationHistoryRefreshTimer = () => {
  if (!notificationHistoryRefreshTimer) return;
  window.clearInterval(notificationHistoryRefreshTimer);
  notificationHistoryRefreshTimer = 0;
};

const startNotificationHistoryRefreshTimer = () => {
  stopNotificationHistoryRefreshTimer();
  notificationHistoryRefreshTimer = window.setInterval(() => {
    if (!notificationHistoryOpen) return;
    renderNotificationHistoryRelativeTimes();
    void validateAndMarkNotificationHistoryRead();
  }, HISTORY_RELATIVE_TIME_REFRESH_MS);
};

const closeNotificationHistoryPanel = () => {
  notificationHistoryOpen = false;
  stopNotificationHistoryRefreshTimer();
  if (!notificationHistoryPanelEl || !notificationHistoryToggleEl) return;
  notificationHistoryPanelEl.hidden = true;
  notificationHistoryToggleEl.classList.remove('isOpen');
  notificationHistoryToggleEl.setAttribute('aria-expanded', 'false');
};

const openNotificationHistoryPanel = async () => {
  notificationHistoryOpen = true;
  if (notificationHistoryPanelEl && notificationHistoryToggleEl) {
    notificationHistoryPanelEl.hidden = false;
    notificationHistoryToggleEl.classList.add('isOpen');
    notificationHistoryToggleEl.setAttribute('aria-expanded', 'true');
  }
  startNotificationHistoryRefreshTimer();
  await postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.GET_HISTORY }, { queueWhenUnavailable: true });
  renderNotificationHistoryList();
  refreshNotificationHistoryBadgeUi();
  void validateAndMarkNotificationHistoryRead();
};

const toggleNotificationHistoryPanel = () => {
  if (notificationHistoryOpen) {
    closeNotificationHistoryPanel();
    return;
  }
  void openNotificationHistoryPanel();
};

const validateAndMarkNotificationHistoryRead = async () => {
  if (!notificationHistoryOpen || !notificationHistoryListEl) return;
  if (notificationHistoryReadAckInFlight) return;
  if (notificationHistoryReadAckVersion === notificationHistoryState.historyVersion) return;

  const unreadEntries = notificationHistoryState.entries.filter((entry) => entry.marker === 'unread');
  if (unreadEntries.length === 0) return;

  const entryIds = [];
  for (const entry of unreadEntries) {
    const row = Array.from(notificationHistoryListEl.querySelectorAll('.notificationHistoryItem'))
      .find((candidate) => candidate.getAttribute('data-entry-id') === entry.id);
    if (!row || !row.isConnected) return;

    const titleEl = row.querySelector('.notificationHistoryItem__title');
    const bodyEl = row.querySelector('.notificationHistoryItem__body');
    const timeEl = row.querySelector('.notificationHistoryItem__time');
    if (!titleEl || !bodyEl || !timeEl) return;
    const localizedEntry = resolveNotificationHistoryEntryText(entry);
    if (titleEl.textContent !== localizedEntry.title) return;
    if (bodyEl.textContent !== localizedEntry.body) return;
    if (!timeEl.textContent || !timeEl.textContent.trim()) return;

    const style = window.getComputedStyle(row);
    if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') === 0) {
      return;
    }

    entryIds.push(entry.id);
  }

  notificationHistoryReadAckInFlight = true;
  notificationHistoryReadAckVersion = notificationHistoryState.historyVersion;
  const posted = await postMessageToServiceWorker({
    type: SW_MESSAGE_TYPES.MARK_HISTORY_READ,
    payload: {
      historyVersion: notificationHistoryState.historyVersion,
      entryIds,
    },
  }, { queueWhenUnavailable: true });
  notificationHistoryReadAckInFlight = false;
  if (!posted) {
    notificationHistoryReadAckVersion = null;
  }
};

const scheduleNotificationHistoryReadValidation = () => {
  if (notificationHistoryValidationFrame) {
    window.cancelAnimationFrame(notificationHistoryValidationFrame);
    notificationHistoryValidationFrame = 0;
  }
  notificationHistoryValidationFrame = window.requestAnimationFrame(() => {
    notificationHistoryValidationFrame = 0;
    void validateAndMarkNotificationHistoryRead();
  });
};

const refreshNotificationHistoryUi = () => {
  renderNotificationHistoryList();
  refreshNotificationHistoryBadgeUi();
  if (notificationHistoryOpen) {
    renderNotificationHistoryRelativeTimes();
    scheduleNotificationHistoryReadValidation();
  }
};

const resolveUpdateApplyDialogPromptText = (buildNumber = null) => {
  const prompt = translateNow('ui.updateApplyDialogPrompt');
  if (prompt !== 'ui.updateApplyDialogPrompt') return prompt;
  if (Number.isInteger(buildNumber) && buildNumber > 0) {
    return `Install build ${buildNumber}?`;
  }
  return 'Install the latest version now?';
};

const openUpdateApplyDialog = (buildNumber) => {
  if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
  if (!updateApplyDialogEl || typeof updateApplyDialogEl.showModal !== 'function') {
    if (window.confirm(resolveUpdateApplyDialogPromptText(buildNumber))) {
      void applyLatestUpdateForAction(buildNumber);
    }
    return;
  }
  if (updateApplyDialogEl.open) return;
  updateApplyDialogEl.dataset.pendingBuildNumber = String(buildNumber);
  if (updateApplyMessageEl) {
    updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(buildNumber);
  }
  try {
    updateApplyDialogEl.showModal();
  } catch {
    delete updateApplyDialogEl.dataset.pendingBuildNumber;
  }
};

const resolveLatestUpdateBuildNumber = async (hintBuildNumber = null) => {
  let latest = Number.isInteger(hintBuildNumber) ? hintBuildNumber : 0;

  const storedNotifiedBuild = readLastNotifiedRemoteBuildNumber();
  if (Number.isInteger(storedNotifiedBuild) && storedNotifiedBuild > latest) {
    latest = storedNotifiedBuild;
  }

  for (const entry of notificationHistoryState.entries) {
    if (!entry || entry.kind !== 'new-version-available') continue;
    const action = entry.action;
    if (!action || action.type !== 'apply-update') continue;
    if (Number.isInteger(action.buildNumber) && action.buildNumber > latest) {
      latest = action.buildNumber;
    }
  }

  const remoteBuildNumber = await fetchRemoteBuildNumber();
  if (Number.isInteger(remoteBuildNumber) && remoteBuildNumber > latest) {
    latest = remoteBuildNumber;
  }

  const updatableBuildNumber = await resolveUpdatableRemoteBuildNumber(latest);
  if (!Number.isInteger(updatableBuildNumber) || updatableBuildNumber <= localBuildNumber) return null;
  return updatableBuildNumber;
};

const resolveMoveDailyDialogPromptText = () => {
  const localized = translateNow('ui.moveDailyDialogPrompt');
  if (localized !== 'ui.moveDailyDialogPrompt') return localized;
  return 'You have an unfinished level. Move to Daily level anyway?';
};

const requestMoveDailyConfirmation = async () => {
  const promptText = resolveMoveDailyDialogPromptText();
  if (!moveDailyDialogEl || typeof moveDailyDialogEl.showModal !== 'function') {
    return window.confirm(promptText);
  }
  if (moveDailyDialogEl.open || moveDailyDialogResolver) return false;

  if (moveDailyMessageEl) {
    moveDailyMessageEl.textContent = promptText;
  }

  return new Promise((resolve) => {
    moveDailyDialogResolver = resolve;
    try {
      moveDailyDialogEl.showModal();
    } catch {
      moveDailyDialogResolver = null;
      resolve(window.confirm(promptText));
    }
  });
};

const hasUnsolvedPath = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.path)) return false;
  const pathLength = snapshot.path.length;
  if (pathLength <= 0) return false;
  const totalUsable = Number.parseInt(snapshot.totalUsable, 10);
  if (Number.isInteger(totalUsable) && totalUsable > 0 && pathLength >= totalUsable) return false;
  return true;
};

const openDailyFromHistoryAction = async (dailyId = '', kind = '') => {
  if (!runtimeInstance || !runtimeCoreAdapter || !runtimeStateAdapter) return;
  if (!latestDailyState.dailyId) return;

  const snapshot = runtimeStateAdapter.getSnapshot();
  if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return;

  if (kind === 'new-level') {
    const latestPayload = await fetchDailyPayload({ bypassCache: true });
    if (
      latestPayload?.dailyId
      && (
        !latestDailyState.dailyId
        || latestPayload.dailyId > latestDailyState.dailyId
      )
    ) {
      window.location.reload();
      return;
    }
  }

  const isDailyLevel = typeof runtimeCoreAdapter.isDailyAbsIndex === 'function'
    && runtimeCoreAdapter.isDailyAbsIndex(snapshot.levelIndex);
  if (isDailyLevel) return;

  const isInfiniteLevel = typeof runtimeCoreAdapter.isInfiniteAbsIndex === 'function'
    && runtimeCoreAdapter.isInfiniteAbsIndex(snapshot.levelIndex);
  const shouldConfirm = hasUnsolvedPath(snapshot) && (isInfiniteLevel || !isDailyLevel);
  if (shouldConfirm && !(await requestMoveDailyConfirmation())) return;

  const dailyAbsIndex = typeof runtimeCoreAdapter.getDailyAbsIndex === 'function'
    ? runtimeCoreAdapter.getDailyAbsIndex()
    : null;
  if (!Number.isInteger(dailyAbsIndex)) return;

  runtimeInstance.emitIntent(uiActionIntent(UI_ACTIONS.LEVEL_SELECT, {
    value: dailyAbsIndex,
    suppressFrozenTransition: kind === 'new-level',
  }));
};

const handleNotificationHistoryItemAction = (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest('.notificationHistoryItem');
  if (!row || !notificationHistoryListEl?.contains(row)) return;
  const actionType = row.getAttribute('data-action-type') || '';
  if (actionType === 'apply-update') {
    const buildNumber = Number.parseInt(row.getAttribute('data-action-build-number') || '', 10);
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
    void (async () => {
      const latestBuildNumber = await resolveLatestUpdateBuildNumber(buildNumber);
      if (!Number.isInteger(latestBuildNumber) || latestBuildNumber <= localBuildNumber) {
        await clearAppliedUpdateHistoryActions(localBuildNumber);
        return;
      }
      openUpdateApplyDialog(latestBuildNumber);
    })();
    return;
  }
  if (actionType === 'open-daily') {
    const dailyId = row.getAttribute('data-action-daily-id') || '';
    const kind = row.getAttribute('data-entry-kind') || '';
    if (!isOpenDailyHistoryActionable({
      kind,
      action: { type: 'open-daily', dailyId },
    })) {
      return;
    }
    void openDailyFromHistoryAction(dailyId, kind);
  }
};

const bindNotificationHistoryPanel = () => {
  notificationHistoryToggleEl = document.getElementById(ELEMENT_IDS.NOTIFICATION_HISTORY_TOGGLE);
  notificationHistoryBadgeEl = document.getElementById(ELEMENT_IDS.NOTIFICATION_HISTORY_BADGE);
  notificationHistoryPanelEl = document.getElementById(ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL);
  notificationHistoryListEl = document.getElementById(ELEMENT_IDS.NOTIFICATION_HISTORY_LIST);

  if (!notificationHistoryToggleEl || !notificationHistoryPanelEl || !notificationHistoryListEl || notificationHistoryToggleBound) {
    refreshNotificationHistoryUi();
    return;
  }

  notificationHistoryToggleEl.addEventListener('click', () => {
    toggleNotificationHistoryPanel();
  });
  notificationHistoryListEl.addEventListener('click', handleNotificationHistoryItemAction);

  const settingsToggle = document.getElementById(ELEMENT_IDS.SETTINGS_TOGGLE);
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      closeNotificationHistoryPanel();
    });
  }

  document.addEventListener('click', (event) => {
    if (!notificationHistoryOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (updateApplyDialogEl?.open && updateApplyDialogEl.contains(target)) return;
    if (moveDailyDialogEl?.open && moveDailyDialogEl.contains(target)) return;
    if (notificationHistoryToggleEl.contains(target) || notificationHistoryPanelEl.contains(target)) return;
    closeNotificationHistoryPanel();
  });

  document.addEventListener('keydown', (event) => {
    if (!notificationHistoryOpen) return;
    if (event.key === 'Escape') {
      closeNotificationHistoryPanel();
    }
  });

  notificationHistoryToggleBound = true;
  refreshNotificationHistoryUi();
};

const bindUpdateApplyDialog = () => {
  updateApplyDialogEl = document.getElementById(ELEMENT_IDS.UPDATE_APPLY_DIALOG);
  updateApplyMessageEl = document.getElementById(ELEMENT_IDS.UPDATE_APPLY_MESSAGE);

  if (!updateApplyDialogEl || updateApplyDialogBound) return;

  updateApplyDialogEl.addEventListener('close', () => {
    const buildNumber = Number.parseInt(updateApplyDialogEl?.dataset?.pendingBuildNumber || '', 10);
    const shouldApply = updateApplyDialogEl?.returnValue === 'confirm';
    delete updateApplyDialogEl.dataset.pendingBuildNumber;
    updateApplyDialogEl.returnValue = '';
    if (!shouldApply) return;
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
    void applyLatestUpdateForAction(buildNumber);
  });

  updateApplyDialogBound = true;
};

const bindMoveDailyDialog = () => {
  moveDailyDialogEl = document.getElementById(ELEMENT_IDS.MOVE_DAILY_DIALOG);
  moveDailyMessageEl = document.getElementById(ELEMENT_IDS.MOVE_DAILY_MESSAGE);

  if (!moveDailyDialogEl || moveDailyDialogBound) return;

  moveDailyDialogEl.addEventListener('close', () => {
    const confirmed = moveDailyDialogEl?.returnValue === 'confirm';
    moveDailyDialogEl.returnValue = '';
    const resolve = moveDailyDialogResolver;
    moveDailyDialogResolver = null;
    if (typeof resolve === 'function') {
      resolve(confirmed);
    }
  });

  moveDailyDialogBound = true;
};

const bindServiceWorkerHistoryMessages = () => {
  if (!canUseServiceWorker() || swMessageListenerBound) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== SW_MESSAGE_TYPES.HISTORY_UPDATE) return;
    applyNotificationHistoryPayload(data.payload);
    refreshNotificationHistoryUi();
  });
  swMessageListenerBound = true;
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

const resolveDailyPayloadRequestUrl = ({ bypassCache = false } = {}) => {
  const url = new URL(DAILY_PAYLOAD_URL);
  url.searchParams.set('_daily', new Date().toISOString().slice(0, 10));
  if (bypassCache) {
    url.searchParams.set('_dailycb', String(Date.now()));
  }
  return url.toString();
};

const fetchDailyPayload = async ({ bypassCache = false } = {}) => {
  try {
    const response = await fetch(resolveDailyPayloadRequestUrl({ bypassCache }), {
      cache: 'no-store',
      headers: {
        'x-bypass-cache': 'true',
      },
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

const parseServiceWorkerBuildNumber = (source) => {
  if (typeof source !== 'string' || source.length === 0) return null;
  const match = source.match(SW_BUILD_NUMBER_RE);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const fetchRemoteServiceWorkerBuildNumber = async (buildHint = null) => {
  try {
    const swUrl = resolveServiceWorkerRegistrationUrl(isLocalhostHostname);
    if (Number.isInteger(buildHint) && buildHint > 0) {
      swUrl.searchParams.set('v', String(buildHint));
    }
    swUrl.searchParams.set('_swcb', String(Date.now()));
    const response = await fetch(swUrl.toString(), {
      cache: 'no-store',
      headers: {
        'x-bypass-cache': 'true',
      },
    });
    if (!response.ok) return null;
    return parseServiceWorkerBuildNumber(await response.text());
  } catch {
    return null;
  }
};

const resolveUpdatableRemoteBuildNumber = async (remoteBuildNumber) => {
  if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= 0) return null;
  const swBuildNumber = await fetchRemoteServiceWorkerBuildNumber(remoteBuildNumber);
  if (!Number.isInteger(swBuildNumber) || swBuildNumber <= 0) return null;
  if (swBuildNumber < remoteBuildNumber) return null;
  return swBuildNumber;
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

const resolveNewVersionToastText = () => {
  const localized = translateNow('ui.newVersionAvailableToast');
  if (localized !== 'ui.newVersionAvailableToast') return localized;
  return 'A new version is available.';
};

const resolveNewVersionTitleText = () => {
  const localized = translateNow('ui.newVersionAvailableTitle');
  if (localized !== 'ui.newVersionAvailableTitle') return localized;
  return 'New version available';
};

const resolveNewVersionBodyText = () => {
  const localized = translateNow('ui.newVersionAvailableBody');
  if (localized !== 'ui.newVersionAvailableBody') return localized;
  return 'Tap to update to the latest version.';
};

const resolveUpdateApplyFailureToastText = () => {
  const localized = translateNow('ui.updateApplyFailedToast');
  if (localized !== 'ui.updateApplyFailedToast') return localized;
  return 'Could not apply update yet. Try again shortly.';
};

const hasNotifiedRemoteBuild = (remoteBuildNumber) => {
  if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= 0) return true;
  if (notifiedRemoteBuildNumbers.has(remoteBuildNumber)) return true;
  const stored = readLastNotifiedRemoteBuildNumber();
  return Number.isInteger(stored) && stored >= remoteBuildNumber;
};

const markRemoteBuildNotified = (remoteBuildNumber) => {
  if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= 0) return;
  notifiedRemoteBuildNumbers.add(remoteBuildNumber);
  writeLastNotifiedRemoteBuildNumber(remoteBuildNumber);
};

const notifyUpdateAvailable = async (remoteBuildNumber) => {
  if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return;
  if (hasNotifiedRemoteBuild(remoteBuildNumber)) return;

  markRemoteBuildNotified(remoteBuildNumber);
  showInAppToast(resolveNewVersionToastText(), { recordInHistory: false });
  await postMessageToServiceWorker({
    type: SW_MESSAGE_TYPES.APPEND_SYSTEM_HISTORY,
    payload: {
      kind: 'new-version-available',
      title: resolveNewVersionTitleText(),
      body: resolveNewVersionBodyText(),
      action: {
        type: 'apply-update',
        buildNumber: remoteBuildNumber,
      },
    },
  }, { queueWhenUnavailable: true });
};

const maybeApplyUpdate = async (remoteBuildNumber, options = {}) => {
  const { force = false } = options;
  if (!swRegistration) return false;
  if (!force && promptedRemoteBuildNumbers.has(remoteBuildNumber)) return false;

  try {
    await swRegistration.update();
  } catch {
    return false;
  }

  const waitingWorker = await waitForWaitingWorker(swRegistration);
  if (!waitingWorker) return false;

  promptedRemoteBuildNumbers.add(remoteBuildNumber);
  armControllerChangeReload();
  waitingWorker.postMessage({ type: 'SW_SKIP_WAITING' });
  return true;
};

const applyUpdateForBuild = async (remoteBuildNumber, options = {}) => {
  const { force = false, toastOnFailure = false } = options;
  if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return false;
  const applied = await maybeApplyUpdate(remoteBuildNumber, { force });
  if (!applied && toastOnFailure) {
    showInAppToast(resolveUpdateApplyFailureToastText(), { recordInHistory: false });
  }
  return applied;
};

const applyLatestUpdateForAction = async (hintBuildNumber = null) => {
  const latestBuildNumber = await resolveLatestUpdateBuildNumber(hintBuildNumber);
  if (!Number.isInteger(latestBuildNumber) || latestBuildNumber <= localBuildNumber) {
    await clearAppliedUpdateHistoryActions(localBuildNumber);
    return false;
  }
  return applyUpdateForBuild(latestBuildNumber, { force: false, toastOnFailure: true });
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
    const updatableRemoteBuildNumber = await resolveUpdatableRemoteBuildNumber(remoteBuildNumber);
    if (!Number.isInteger(updatableRemoteBuildNumber) || updatableRemoteBuildNumber <= localBuildNumber) return;
    if (readAutoUpdateEnabledPreference()) {
      await applyUpdateForBuild(updatableRemoteBuildNumber);
      return;
    }
    await notifyUpdateAvailable(updatableRemoteBuildNumber);
  } finally {
    updateCheckInFlight = false;
  }
};

const registerServiceWorker = async () => {
  if (!canUseServiceWorker()) return null;
  try {
    swRegistration = await navigator.serviceWorker.register(
      resolveServiceWorkerRegistrationUrl(isLocalhostHostname),
    );
    await navigator.serviceWorker.ready;
    await flushPendingSwMessages();
    await syncDailyStateToServiceWorker();
    await registerBackgroundDailyCheck();
    await requestServiceWorkerDailyCheck();
    await postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.GET_HISTORY }, { queueWhenUnavailable: true });
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
    void postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.GET_HISTORY }, { queueWhenUnavailable: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void checkForNewBuild();
    void requestServiceWorkerDailyCheck();
    void postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.GET_HISTORY }, { queueWhenUnavailable: true });
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

  bindNotificationsToggle();
  bindAutoUpdateToggle();
  bindPathPredictionToggle();
  bindNotificationHistoryPanel();
  bindUpdateApplyDialog();
  bindMoveDailyDialog();
  bindServiceWorkerHistoryMessages();
  bindServiceWorkerRuntimeEvents();
  void clearAppliedUpdateHistoryActions(localBuildNumber);

  const adapters = createDefaultAdapters({
    icons: ICONS,
    iconX: ICON_X,
    dailyLevel: bootDaily.dailyLevel,
    dailyId: bootDaily.dailyId,
  });
  runtimeStateAdapter = adapters.state;
  runtimeCoreAdapter = adapters.core;

  const bootState = adapters.persistence.readBootState();
  latestDailyState.dailySolvedDate = typeof bootState.dailySolvedDate === 'string'
    ? bootState.dailySolvedDate
    : null;
  wrapPersistenceForDailySideEffects(adapters.persistence);

  const setLocaleWithEffects = (locale) => {
    const resolved = setLocaleCore(locale);
    refreshNotificationsToggleUi();
    refreshAutoUpdateToggleUi();
    refreshNotificationHistoryUi();
    if (updateApplyMessageEl) {
      updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(
        Number.parseInt(updateApplyDialogEl?.dataset?.pendingBuildNumber || '', 10),
      );
    }
    if (moveDailyMessageEl) {
      moveDailyMessageEl.textContent = resolveMoveDailyDialogPromptText();
    }
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
  refreshAutoUpdateToggleUi();
  refreshNotificationHistoryUi();
  void mountRuntimePlugins({
    isLocalhostHostname,
    canUseServiceWorker,
    requestNotificationPermission,
    postMessageToServiceWorker,
    fetchDailyPayload,
    readDailyDebugSnapshot: () => ({
      nowIsoUtc: new Date().toISOString(),
      dailyPayloadUrl: DAILY_PAYLOAD_URL,
      versionUrl: VERSION_URL,
      localBuildNumber,
      runtimeDailyFreezeState: (
        runtimeInstance && typeof runtimeInstance.readDebugDailyFreezeState === 'function'
          ? runtimeInstance.readDebugDailyFreezeState()
          : null
      ),
      latestDailyState: {
        dailyId: latestDailyState.dailyId,
        hardInvalidateAtUtcMs: latestDailyState.hardInvalidateAtUtcMs,
        dailySolvedDate: latestDailyState.dailySolvedDate,
      },
    }),
    toggleForceDailyFrozenState: () => (
      runtimeInstance && typeof runtimeInstance.toggleDebugForceDailyFrozen === 'function'
        ? runtimeInstance.toggleDebugForceDailyFrozen()
        : null
    ),
    reloadApp: () => window.location.reload(),
    showToast: (text, options = {}) => showInAppToast(text, options),
  });
  if (didUpgradeBuild) {
    const toastText = translateNow('ui.updateAppliedToast');
    if (toastText !== 'ui.updateAppliedToast') {
      showInAppToast(toastText);
    }
  }

  if (!swRegistration) {
    void registerServiceWorker();
  } else {
    void postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.GET_HISTORY }, { queueWhenUnavailable: true });
  }
}

void initTetherApp();
