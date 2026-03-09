import { mountStyles } from './styles.js';
import { APP_SHELL_TEMPLATE, buildLegendTemplate } from './templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './icons.js';
import { ELEMENT_IDS } from './config.js';
import { createDefaultAdapters } from './runtime/default_adapters.js';
import { createRuntime } from './runtime/create_runtime.js';
import { uiActionIntent, UI_ACTIONS } from './runtime/intents.js';
import { mountRuntimePlugins, resolveServiceWorkerRegistrationUrl } from './plugins/runtime_plugins.js';
import { DAILY_PAYLOAD_FILE } from './shared/paths.js';
import { createUpdateFlow } from './app/update_flow.js';
import { resolveLatestUpdateBuildNumber as resolveLatestUpdateBuildNumberCore } from './app/update_build_resolver.js';
import {
  AUTO_UPDATE_ENABLED_KEY,
  NOTIFICATION_AUTO_PROMPT_DECISIONS,
  NOTIFICATION_ENABLED_KEY,
  createNotificationPreferences,
} from './app/notification_preferences.js';
import { createDailyPayloadService } from './app/daily_payload_service.js';
import { createNotificationCenter } from './app/notification_center.js';
import {
  UPDATE_APPLY_STATUS,
  UPDATE_CHECK_DECISION,
  resolveUpdateCheckDecision,
  shouldResyncManualUpdatePolicy,
} from './runtime/update_flow_policy.js';
import { createLocaleController } from './app/locale_controller.js';

const BUILD_NUMBER_META_NAME = 'tether-build-number';
const BUILD_LABEL_META_NAME = 'tether-build-label';
const BUILD_DATETIME_META_NAME = 'tether-build-datetime';
const VERSION_FILE = 'version.json';

const DAILY_HARD_INVALIDATE_GRACE_MS = 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;
const UPDATE_APPLY_RELOAD_FALLBACK_MS = 5 * 1000;
const DAILY_NOTIFICATION_WARNING_HOURS = 8;
const DAILY_CHECK_TAG = 'tether-daily-check';
const SW_BUILD_NUMBER_RE = /BUILD_NUMBER\s*=\s*Number\.parseInt\(\s*['"](\d+)['"]\s*,\s*10\)/;
const LAST_SEEN_BUILD_NUMBER_KEY = 'tetherLastSeenBuildNumber';
const LOW_POWER_HINT_SESSION_KEY = 'tetherLowPowerHintShown';
const APP_TOAST_ID = 'appToast';
const UPDATE_PROGRESS_OVERLAY_ID = 'updateProgressOverlay';
const APP_TOAST_VISIBLE_MS = 3200;
const BUILD_LABEL_HASH_RE = /\b[0-9a-f]{7,40}\b/i;

const SW_MESSAGE_TYPES = Object.freeze({
  SYNC_DAILY_STATE: 'SW_SYNC_DAILY_STATE',
  SYNC_UPDATE_POLICY: 'SW_SYNC_UPDATE_POLICY',
  GET_UPDATE_POLICY: 'SW_GET_UPDATE_POLICY',
  RUN_DAILY_CHECK: 'SW_RUN_DAILY_CHECK',
  GET_HISTORY: 'SW_GET_NOTIFICATION_HISTORY',
  APPEND_TOAST_HISTORY: 'SW_APPEND_TOAST_HISTORY',
  APPEND_SYSTEM_HISTORY: 'SW_APPEND_SYSTEM_HISTORY',
  CLEAR_UPDATE_HISTORY_ACTIONS: 'SW_CLEAR_UPDATE_HISTORY_ACTIONS',
  MARK_HISTORY_READ: 'SW_MARK_NOTIFICATION_HISTORY_READ',
  HISTORY_UPDATE: 'SW_NOTIFICATION_HISTORY',
});

let runtimeInstance = null;
let runtimeStateAdapter = null;
let runtimeCoreAdapter = null;
let updateProgressOverlayEl = null;
let updateProgressOverlayLabelEl = null;
let updateProgressOverlayActive = false;
let updateFlow = null;
const localeController = createLocaleController();

const readMetaContent = (metaName) => {
  const meta = document.querySelector(`meta[name="${metaName}"]`);
  const content = typeof meta?.content === 'string' ? meta.content.trim() : '';
  return content;
};

const localBuildNumber = (() => {
  const parsed = Number.parseInt(readMetaContent(BUILD_NUMBER_META_NAME), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
})();

const localBuildLabel = readMetaContent(BUILD_LABEL_META_NAME);

const localBuildDateTime = (() => {
  const explicitDateTime = readMetaContent(BUILD_DATETIME_META_NAME);
  if (explicitDateTime) return explicitDateTime;
  if (localBuildLabel && !Number.isNaN(Date.parse(localBuildLabel))) return localBuildLabel;
  return '';
})();

const resolveShortBuildHash = (buildLabel) => {
  if (typeof buildLabel !== 'string' || buildLabel.length === 0) return '';
  const match = buildLabel.match(BUILD_LABEL_HASH_RE);
  if (!match) return '';
  return match[0].slice(0, 7).toLowerCase();
};

const formatBuildDateTimeUtc = (rawValue) => {
  if (typeof rawValue !== 'string' || rawValue.length === 0) return '';
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return '';
  const iso = parsed.toISOString();
  return iso.slice(0, 16).replace('T', ' ');
};

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

const readLowPowerHintShown = () => {
  try {
    return window.sessionStorage.getItem(LOW_POWER_HINT_SESSION_KEY) === '1';
  } catch {
    // sessionStorage can be unavailable in restricted browser contexts.
  }
  return false;
};

const writeLowPowerHintShown = () => {
  try {
    window.sessionStorage.setItem(LOW_POWER_HINT_SESSION_KEY, '1');
  } catch {
    // sessionStorage can be unavailable in restricted browser contexts.
  }
};

const detectBuildUpgrade = () => {
  if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) return false;
  const previousBuild = readLastSeenBuildNumber();
  writeLastSeenBuildNumber(localBuildNumber);
  return Number.isInteger(previousBuild) && localBuildNumber > previousBuild;
};

const resolveUpdateApplyingOverlayText = () => {
  const localized = translateNow('ui.updateApplyingOverlay');
  if (localized !== 'ui.updateApplyingOverlay') return localized;
  return 'Updating to the latest version...';
};

const ensureUpdateProgressOverlay = () => {
  if (updateProgressOverlayEl?.isConnected) return updateProgressOverlayEl;
  if (!document.body) return null;

  const overlay = document.createElement('div');
  overlay.id = UPDATE_PROGRESS_OVERLAY_ID;
  overlay.className = 'updateProgressOverlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-atomic', 'true');

  const content = document.createElement('div');
  content.className = 'updateProgressOverlay__content';

  const spinner = document.createElement('span');
  spinner.className = 'updateProgressOverlay__spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'updateProgressOverlay__label';
  label.textContent = resolveUpdateApplyingOverlayText();

  content.appendChild(spinner);
  content.appendChild(label);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  updateProgressOverlayEl = overlay;
  updateProgressOverlayLabelEl = label;
  return updateProgressOverlayEl;
};

const setUpdateProgressOverlayActive = (active) => {
  const nextActive = active === true;
  const overlay = ensureUpdateProgressOverlay();
  if (!overlay) return;

  updateProgressOverlayActive = nextActive;
  overlay.hidden = !nextActive;
  if (updateProgressOverlayLabelEl) {
    updateProgressOverlayLabelEl.textContent = resolveUpdateApplyingOverlayText();
  }
  document.body.classList.toggle('isUpdateApplying', nextActive);
  if (nextActive) {
    document.body.setAttribute('aria-busy', 'true');
  } else {
    document.body.removeAttribute('aria-busy');
  }
};

const showInAppToast = (text, options = {}) => {
  if (typeof text !== 'string' || text.trim().length === 0) return;
  const { recordInHistory = true, kind = 'toast' } = options;

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
        kind,
        title: text.trim(),
        body: '',
      },
    }, { queueWhenUnavailable: true });
  }
};

const canUseServiceWorker = () => updateFlow?.canUseServiceWorker?.() === true;

const supportsNotifications = () => updateFlow?.supportsNotifications?.() === true;

const notificationPreferences = createNotificationPreferences({
  supportsNotifications,
});

const readAutoPromptDecision = () =>
  notificationPreferences.readAutoPromptDecision();

const writeAutoPromptDecision = (decision) =>
  notificationPreferences.writeAutoPromptDecision(decision);

const readNotificationEnabledPreference = () =>
  notificationPreferences.readNotificationEnabledPreference();

const writeNotificationEnabledPreference = (enabled) =>
  notificationPreferences.writeNotificationEnabledPreference(enabled);

const readAutoUpdateEnabledPreference = () =>
  notificationPreferences.readAutoUpdateEnabledPreference();

const writeAutoUpdateEnabledPreference = (enabled) =>
  notificationPreferences.writeAutoUpdateEnabledPreference(enabled);

const readLastNotifiedRemoteBuildNumber = () =>
  notificationPreferences.readLastNotifiedRemoteBuildNumber();

const writeLastNotifiedRemoteBuildNumber = (buildNumber) =>
  notificationPreferences.writeLastNotifiedRemoteBuildNumber(buildNumber);

const hasStoredNotificationEnabledPreference = () =>
  notificationPreferences.hasStoredNotificationEnabledPreference();

const refreshSettingsVersionUi = () => {
  const versionEl = document.getElementById(ELEMENT_IDS.SETTINGS_VERSION);
  if (!versionEl) return;

  const shortHash = resolveShortBuildHash(localBuildLabel);
  const versionText = shortHash || (Number.isInteger(localBuildNumber) && localBuildNumber > 0
    ? String(localBuildNumber)
    : '');
  const buildTimeText = formatBuildDateTimeUtc(localBuildDateTime);
  const text = [
    versionText,
    buildTimeText,
  ].filter((entry) => entry.length > 0).join(' · ');

  versionEl.hidden = text.length === 0;
  versionEl.textContent = text;
};

const translateNow = (key, vars = {}) => localeController.translateNow(key, vars);
const getLocale = () => localeController.getLocale();

const buildNotificationTextPayload = (locale = localeController.getLocale()) => {
  const translate = localeController.createTranslator(locale);
  return {
    unsolvedTitle: translate('ui.notificationUnsolvedTitle'),
    unsolvedBody: translate('ui.notificationUnsolvedBody'),
    newLevelTitle: translate('ui.notificationNewLevelTitle'),
    newLevelBody: translate('ui.notificationNewLevelBody'),
  };
};

const postMessageToServiceWorker = async (message, options = {}) =>
  updateFlow.postMessageToServiceWorker(message, options);

const syncDailyStateToServiceWorker = async () =>
  updateFlow.syncDailyStateToServiceWorker();

const syncUpdatePolicyToServiceWorker = async () =>
  updateFlow.syncUpdatePolicyToServiceWorker();

const ensureServiceWorkerUpdatePolicyConsistency = async () =>
  updateFlow.ensureServiceWorkerUpdatePolicyConsistency();

const requestServiceWorkerDailyCheck = async () =>
  updateFlow.requestServiceWorkerDailyCheck();

const registerBackgroundDailyCheck = async () =>
  updateFlow.registerBackgroundDailyCheck();

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

const clearAppliedUpdateHistoryActions = async (appliedBuildNumber = localBuildNumber) =>
  updateFlow.clearAppliedUpdateHistoryActions(appliedBuildNumber);

const isOpenDailyHistoryActionable = (entry) => {
  if (!entry || !entry.action || entry.action.type !== 'open-daily') return false;
  if (entry.kind !== 'new-level' && entry.kind !== 'unsolved-warning') return true;
  if (!latestDailyState.dailyId) return false;
  return entry.action.dailyId === latestDailyState.dailyId;
};

const resolveLatestUpdateBuildNumber = async (hintBuildNumber = null) => {
  return resolveLatestUpdateBuildNumberCore({
    hintBuildNumber,
    readLastNotifiedRemoteBuildNumber,
    notificationHistoryEntries: notificationCenter.getHistoryEntries(),
    fetchRemoteBuildNumber,
    resolveUpdatableRemoteBuildNumber,
    localBuildNumber,
  });
};

const notificationCenter = createNotificationCenter({
  elementIds: ELEMENT_IDS,
  swMessageTypes: SW_MESSAGE_TYPES,
  localBuildNumber,
  notificationEnabledKey: NOTIFICATION_ENABLED_KEY,
  autoUpdateEnabledKey: AUTO_UPDATE_ENABLED_KEY,
  notificationAutoPromptDecisions: NOTIFICATION_AUTO_PROMPT_DECISIONS,
  readAutoPromptDecision,
  writeAutoPromptDecision,
  readNotificationEnabledPreference,
  writeNotificationEnabledPreference,
  readAutoUpdateEnabledPreference,
  writeAutoUpdateEnabledPreference,
  hasStoredNotificationEnabledPreference,
  notificationPermissionState: notificationPreferences.notificationPermissionState,
  supportsNotifications,
  canUseServiceWorker,
  requestNotificationPermission,
  syncDailyStateToServiceWorker,
  syncUpdatePolicyToServiceWorker,
  registerBackgroundDailyCheck,
  requestServiceWorkerDailyCheck,
  postMessageToServiceWorker,
  clearAppliedUpdateHistoryActions,
  translateNow,
  getLocale,
  showInAppToast,
  isOpenDailyHistoryActionable,
  onApplyUpdateRequested: async ({ buildNumber, requestUpdateApplyConfirmation, closeHistoryPanel }) => {
    const latestBuildNumber = await resolveLatestUpdateBuildNumber(buildNumber);
    if (!Number.isInteger(latestBuildNumber) || latestBuildNumber <= localBuildNumber) {
      await clearAppliedUpdateHistoryActions(localBuildNumber);
      return;
    }
    const confirmed = await requestUpdateApplyConfirmation(latestBuildNumber);
    if (confirmed) {
      closeHistoryPanel();
      void applyLatestUpdateForAction(latestBuildNumber);
    }
  },
  onOpenDailyRequested: async ({ dailyId, kind, requestMoveDailyConfirmation, closeHistoryPanel }) => {
    const executed = await openDailyFromHistoryAction(dailyId, kind, requestMoveDailyConfirmation);
    if (executed) {
      closeHistoryPanel();
    }
  },
});

const maybeAutoPromptForNotifications = async () => notificationCenter.maybeAutoPromptForNotifications();

const hasUnsolvedPath = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.path)) return false;
  const pathLength = snapshot.path.length;
  if (pathLength <= 0) return false;
  const totalUsable = Number.parseInt(snapshot.totalUsable, 10);
  if (Number.isInteger(totalUsable) && totalUsable > 0 && pathLength >= totalUsable) return false;
  return true;
};

const openDailyFromHistoryAction = async (
  dailyId = '',
  kind = '',
  requestMoveDailyConfirmation = async () => true,
) => {
  if (!runtimeInstance || !runtimeCoreAdapter || !runtimeStateAdapter) return false;
  if (!latestDailyState.dailyId) return false;

  const snapshot = runtimeStateAdapter.getSnapshot();
  if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return false;

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
      return true;
    }
  }

  const isDailyLevel = typeof runtimeCoreAdapter.isDailyAbsIndex === 'function'
    && runtimeCoreAdapter.isDailyAbsIndex(snapshot.levelIndex);
  if (isDailyLevel) {
    return true;
  }

  const isInfiniteLevel = typeof runtimeCoreAdapter.isInfiniteAbsIndex === 'function'
    && runtimeCoreAdapter.isInfiniteAbsIndex(snapshot.levelIndex);
  const shouldConfirm = hasUnsolvedPath(snapshot) && (isInfiniteLevel || !isDailyLevel);
  if (shouldConfirm && !(await requestMoveDailyConfirmation())) return false;

  const dailyAbsIndex = typeof runtimeCoreAdapter.getDailyAbsIndex === 'function'
    ? runtimeCoreAdapter.getDailyAbsIndex()
    : null;
  if (!Number.isInteger(dailyAbsIndex)) return false;

  runtimeInstance.emitIntent(uiActionIntent(UI_ACTIONS.LEVEL_SELECT, {
    value: dailyAbsIndex,
    suppressFrozenTransition: kind === 'new-level',
  }));
  return true;
};

const bindServiceWorkerHistoryMessages = () => {
  updateFlow.bindServiceWorkerHistoryMessages({
    onPayload: (payload) => {
      notificationCenter.applyHistoryPayload(payload);
      notificationCenter.refreshHistoryUi();
    },
  });
};

const dailyPayloadService = createDailyPayloadService({
  dailyPayloadUrl: DAILY_PAYLOAD_URL,
  dailyHardInvalidateGraceMs: DAILY_HARD_INVALIDATE_GRACE_MS,
});

const fetchDailyPayload = (options = {}) =>
  dailyPayloadService.fetchDailyPayload(options);

const resolveDailyBootPayload = () =>
  dailyPayloadService.resolveDailyBootPayload();

const setupDailyHardInvalidationWatcher = (bootDaily) =>
  dailyPayloadService.setupDailyHardInvalidationWatcher(bootDaily);

const fetchRemoteBuildNumber = async () =>
  updateFlow.fetchRemoteBuildNumber();

const resolveUpdatableRemoteBuildNumber = async (remoteBuildNumber) =>
  updateFlow.resolveUpdatableRemoteBuildNumber(remoteBuildNumber);

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

const resolveLowPowerHintToastText = () => {
  const localized = translateNow('ui.lowPowerModeHintToast');
  if (localized !== 'ui.lowPowerModeHintToast') return localized;
  return 'Dragging looks slow. You can enable Low Power Mode in Settings for smoother play.';
};

updateFlow = createUpdateFlow({
  swMessageTypes: SW_MESSAGE_TYPES,
  updateApplyStatus: UPDATE_APPLY_STATUS,
  updateCheckDecision: UPDATE_CHECK_DECISION,
  localBuildNumber,
  versionUrl: VERSION_URL,
  swBuildNumberRe: SW_BUILD_NUMBER_RE,
  resolveServiceWorkerRegistrationUrl,
  isLocalhostHostname,
  readAutoUpdateEnabledPreference,
  readNotificationEnabledPreference,
  readLastNotifiedRemoteBuildNumber,
  writeLastNotifiedRemoteBuildNumber,
  buildNotificationTextPayload,
  getLatestDailyState: () => latestDailyState,
  resolveUpdateCheckDecision,
  shouldResyncManualUpdatePolicy,
  showInAppToast,
  resolveNewVersionToastText,
  resolveNewVersionTitleText,
  resolveNewVersionBodyText,
  resolveUpdateApplyFailureToastText,
  setUpdateProgressOverlayActive,
  updateCheckThrottleMs: UPDATE_CHECK_THROTTLE_MS,
  updateApplyReloadFallbackMs: UPDATE_APPLY_RELOAD_FALLBACK_MS,
  dailyCheckTag: DAILY_CHECK_TAG,
  dailyNotificationWarningHours: DAILY_NOTIFICATION_WARNING_HOURS,
});

const applyUpdateForBuild = async (remoteBuildNumber, options = {}) =>
  updateFlow.applyUpdateForBuild(remoteBuildNumber, options);

const applyLatestUpdateForAction = async (hintBuildNumber = null) => {
  const latestBuildNumber = await resolveLatestUpdateBuildNumber(hintBuildNumber);
  if (!Number.isInteger(latestBuildNumber) || latestBuildNumber <= localBuildNumber) {
    await clearAppliedUpdateHistoryActions(localBuildNumber);
    return false;
  }

  const result = await applyUpdateForBuild(latestBuildNumber, {
    force: true,
    toastOnFailure: false,
    approvedBuildNumber: latestBuildNumber,
  });
  if (result.applied) return true;

  showInAppToast(resolveUpdateApplyFailureToastText(), { recordInHistory: false });
  return false;
};

const checkForNewBuild = async (options = {}) =>
  updateFlow.checkForNewBuild(options);

const registerServiceWorker = async () =>
  updateFlow.registerServiceWorker();

const bindServiceWorkerRuntimeEvents = () =>
  updateFlow.bindServiceWorkerRuntimeEvents();

const bindConfigSync = () => {
  window.addEventListener('storage', (event) => {
    notificationCenter.handleStorageEvent(event.key);
  });
};

const refreshRuntimeLocaleAvailabilityUi = () => {
  if (!runtimeInstance || typeof runtimeInstance.refreshLocalizationUi !== 'function') return;
  runtimeInstance.refreshLocalizationUi();
};

const bindLocaleAvailabilitySync = () => {
  if (window._localeAvailabilitySyncBound) return;

  window.addEventListener('online', refreshRuntimeLocaleAvailabilityUi);
  window.addEventListener('offline', refreshRuntimeLocaleAvailabilityUi);
  window.addEventListener('appinstalled', () => {
    void (async () => {
      await localeController.preloadAllLocales();
      refreshRuntimeLocaleAvailabilityUi();
    })();
  });

  window._localeAvailabilitySyncBound = true;
};

export async function initTetherApp() {
  if (!window._unloadBlockerBound) {
    const hideBoard = () => {
      const wrap = document.getElementById(ELEMENT_IDS.BOARD_WRAP);
      if (wrap) {
        wrap.style.opacity = '0';
        wrap.style.transition = 'none';
      }
    };
    window.addEventListener('pagehide', hideBoard);
    window.addEventListener('beforeunload', hideBoard);
    window._unloadBlockerBound = true;
  }

  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;
  const didUpgradeBuild = detectBuildUpgrade();

  const bootDaily = await resolveDailyBootPayload();
  setupDailyHardInvalidationWatcher(bootDaily);
  latestDailyState.dailyId = bootDaily.dailyId;
  latestDailyState.hardInvalidateAtUtcMs = bootDaily.hardInvalidateAtUtcMs;

  const initialLocale = await localeController.initialize();
  const translate = localeController.createTranslator(initialLocale);

  appEl.innerHTML = APP_SHELL_TEMPLATE(
    translate,
    localeController.getLocaleOptions(initialLocale),
    initialLocale,
  );
  refreshSettingsVersionUi();

  notificationCenter.bind();
  bindConfigSync();
  bindLocaleAvailabilitySync();
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

  const setLocaleWithEffects = async (locale) => {
    const resolved = await localeController.setLocale(locale);
    notificationCenter.refreshToggleUi();
    notificationCenter.refreshLocalizedUi();
    if (updateProgressOverlayActive && updateProgressOverlayLabelEl) {
      updateProgressOverlayLabelEl.textContent = resolveUpdateApplyingOverlayText();
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
      getLocaleOptions: (locale) => localeController.getLocaleOptions(locale),
      getLocale: () => localeController.getLocale(),
      resolveLocale: localeController.resolveLocale,
      setLocale: setLocaleWithEffects,
      createTranslator: (locale) => localeController.createTranslator(locale),
    },
    ui: {
      buildLegendTemplate,
      badgeDefinitions: BADGE_DEFINITIONS,
      icons: ICONS,
      iconX: ICON_X,
    },
    dailyHardInvalidateAtUtcMs: bootDaily.hardInvalidateAtUtcMs,
    effects: {
      onDailySolvedDateChanged: (dailyId) => {
        latestDailyState.dailySolvedDate = dailyId;
        void syncDailyStateToServiceWorker();
        if (readAutoPromptDecision() === NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET) {
          void maybeAutoPromptForNotifications();
        }
      },
      shouldSuggestLowPowerMode: () => !readLowPowerHintShown(),
      onLowPowerModeSuggestion: () => {
        if (readLowPowerHintShown()) return;
        writeLowPowerHintShown();
        showInAppToast(resolveLowPowerHintToastText(), { kind: 'low-power-hint' });
      },
    },
  });

  runtimeInstance.start();
  notificationCenter.refreshToggleUi();
  notificationCenter.refreshHistoryUi();
  if (typeof __TETHER_DEV__ === 'boolean' ? __TETHER_DEV__ : true) {
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
  }
  if (didUpgradeBuild) {
    const toastText = translateNow('ui.updateAppliedToast');
    if (toastText !== 'ui.updateAppliedToast') {
      showInAppToast(toastText, { kind: 'update-applied' });
    }
  }

  if (!updateFlow.getRegistration()) {
    void registerServiceWorker();
  } else {
    void (async () => {
      await syncUpdatePolicyToServiceWorker();
      await ensureServiceWorkerUpdatePolicyConsistency();
    })();
    void postMessageToServiceWorker({ type: SW_MESSAGE_TYPES.GET_HISTORY }, { queueWhenUnavailable: true });
  }
}

void initTetherApp();
