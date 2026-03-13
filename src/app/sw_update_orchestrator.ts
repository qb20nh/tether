import type { RuntimeData } from '../contracts/ports.ts';
import type { SwMessenger } from './sw_messenger.ts';
import type { NormalizedSwUpdateOptions } from './sw_update_options.ts';
import { normalizeSwUpdateOptions } from './sw_update_options.ts';

interface SwUpdateOrchestratorOptions extends Partial<NormalizedSwUpdateOptions> {
  swMessenger?: SwMessenger;
  noWaitingReloadBuildStorageKey?: string;
}

interface WaitingWorkerLike {
  state: string;
  postMessage: (message: unknown) => void;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
}

interface SwUpdateRegistrationLike {
  waiting?: WaitingWorkerLike | null;
  installing?: WaitingWorkerLike | null;
  active?: { postMessage: (message: unknown) => void } | null;
  update: () => Promise<void>;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  sync?: { register?: (tag: string) => Promise<void> };
  periodicSync?: { register?: (tag: string, options: { minInterval: number }) => Promise<void> };
}

interface ServiceWorkerUpdatePolicy {
  autoUpdateEnabled: boolean;
  pinnedBuildNumber: number;
  servingBuildNumber: number;
  swBuildNumber: number;
  pinnedCacheUsable: boolean;
}

interface UpdateApplyOptions {
  force?: boolean;
  approvedBuildNumber?: number | null;
  toastOnFailure?: boolean;
}

interface UpdateCheckOptions {
  force?: boolean;
}

interface UpdateApplyResult {
  applied: boolean;
  status: string | undefined;
}

interface HistoryBindOptions {
  onPayload: (payload: unknown) => void;
}

const isPositiveInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value > 0
);

export const parseRemoteBuildNumber = (payload: unknown): number | null => {
  if (!payload || typeof payload !== 'object') return null;
  const parsed = Number.parseInt(String((payload as { buildNumber?: unknown }).buildNumber ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const parseServiceWorkerBuildNumber = (
  source: unknown,
  buildNumberRe: RegExp | null | undefined,
): number | null => {
  if (typeof source !== 'string' || source.length === 0) return null;
  if (!(buildNumberRe instanceof RegExp)) return null;
  const match = new RegExp(buildNumberRe).exec(source);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const waitForWaitingWorker = (
  registration: SwUpdateRegistrationLike,
  timeoutMs: number,
  windowObj: NonNullable<NormalizedSwUpdateOptions['windowObj']>,
): Promise<WaitingWorkerLike | null> =>
  new Promise((resolve) => {
    if (registration.waiting) {
      resolve(registration.waiting);
      return;
    }

    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (worker: WaitingWorkerLike | null = null): void => {
      if (settled) return;
      settled = true;
      for (const fn of cleanups) fn();
      resolve(worker || registration.waiting || null);
    };

    const bindInstallingWorker = (worker: WaitingWorkerLike | null | undefined): void => {
      if (!worker) return;
      if (worker.state === 'installed') {
        finish(registration.waiting || worker);
        return;
      }

      const onStateChange = () => {
        if (worker.state === 'installed') {
          finish(registration.waiting || worker);
        }
      };
      const removeStateChangeListener = () => {
        worker.removeEventListener('statechange', onStateChange);
      };
      worker.addEventListener('statechange', onStateChange);
      cleanups.push(removeStateChangeListener);
    };

    const onUpdateFound = () => {
      bindInstallingWorker(registration.installing);
    };
    const clearUpdateFoundListener = () => {
      registration.removeEventListener('updatefound', onUpdateFound);
    };
    const timer = windowObj.setTimeout!(() => {
      finish(null);
    }, timeoutMs);
    const clearTimer = () => {
      windowObj.clearTimeout!(timer);
    };

    bindInstallingWorker(registration.installing);
    registration.addEventListener('updatefound', onUpdateFound);
    cleanups.push(clearUpdateFoundListener, clearTimer);
  });

export function createSwUpdateOrchestrator(options: SwUpdateOrchestratorOptions = {}) {
  const {
    swMessenger,
    noWaitingReloadBuildStorageKey = 'tetherUpdateNoWaitingReloadBuild',
  } = options;
  const {
    swMessageTypes,
    updateApplyStatus,
    updateCheckDecision,
    localBuildNumber,
    versionUrl,
    swBuildNumberRe,
    resolveServiceWorkerRegistrationUrl,
    isLocalhostHostname,
    readAutoUpdateEnabledPreference,
    readNotificationEnabledPreference,
    readLastNotifiedRemoteBuildNumber,
    writeLastNotifiedRemoteBuildNumber,
    buildNotificationTextPayload,
    getLatestDailyState,
    resolveUpdateCheckDecision,
    shouldResyncManualUpdatePolicy,
    showInAppToast,
    resolveNewVersionToastText,
    resolveNewVersionTitleText,
    resolveNewVersionBodyText,
    resolveUpdateApplyFailureToastText,
    setUpdateProgressOverlayActive,
    updateCheckThrottleMs,
    updateApplyReloadFallbackMs,
    dailyCheckTag,
    dailyNotificationWarningHours,
    waitingWorkerTimeoutFirstMs,
    waitingWorkerTimeoutRetryMs,
    fetchImpl,
    windowObj,
    documentObj,
    navigatorObj,
    notificationApi,
    now,
  } = normalizeSwUpdateOptions(options as Record<string, unknown>);
  const messageTypes = (swMessageTypes || {}) as Record<string, string>;
  const applyStatus = (updateApplyStatus || {}) as Record<string, string>;
  const checkDecision = (updateCheckDecision || {}) as Record<string, string>;
  const runtimeWindow = windowObj as NonNullable<NormalizedSwUpdateOptions['windowObj']>;
  const runtimeDocument = documentObj as NonNullable<NormalizedSwUpdateOptions['documentObj']>;
  const runtimeNavigator = navigatorObj as NonNullable<NormalizedSwUpdateOptions['navigatorObj']>;
  const runtimeServiceWorker = runtimeNavigator.serviceWorker as {
    addEventListener?: (type: string, handler: () => void) => void;
    register?: (url: URL) => Promise<SwUpdateRegistrationLike | null>;
    ready?: Promise<unknown>;
  };
  const showToast = showInAppToast as unknown as (text: string, options?: Record<string, unknown>) => void;

  if (!swMessenger || typeof swMessenger.postMessage !== 'function') {
    throw new Error('createSwUpdateOrchestrator requires swMessenger');
  }
  if (typeof resolveServiceWorkerRegistrationUrl !== 'function') {
    throw new TypeError('createSwUpdateOrchestrator requires resolveServiceWorkerRegistrationUrl');
  }
  if (typeof isLocalhostHostname !== 'function') {
    throw new TypeError('createSwUpdateOrchestrator requires isLocalhostHostname');
  }

  let swReloadOnControllerChangeArmed = false;
  let swControllerChangeBound = false;
  let updateApplyReloadFallbackTimer: unknown = 0;
  let updateCheckInFlight = false;
  let lastUpdateCheckAtMs = 0;
  let noWaitingReloadGuardBuild: number | null = null;
  const promptedRemoteBuildNumbers = new Set<number>();
  const notifiedRemoteBuildNumbers = new Set<number>();

  const readServiceWorkerUpdatePolicy = async (target: unknown = null): Promise<ServiceWorkerUpdatePolicy | null> => {
    const reply = await swMessenger.postMessageWithReply({
      type: messageTypes.GET_UPDATE_POLICY,
    }, {
      target: target as { postMessage: (...args: unknown[]) => void } | null,
      timeoutMs: 2000,
    });
    if (reply?.ok !== true) return null;
    return {
      autoUpdateEnabled: reply.autoUpdateEnabled === true,
      pinnedBuildNumber: Number.parseInt(String(reply.pinnedBuildNumber ?? ''), 10),
      servingBuildNumber: Number.parseInt(String(reply.servingBuildNumber ?? ''), 10),
      swBuildNumber: Number.parseInt(String(reply.swBuildNumber ?? ''), 10),
      pinnedCacheUsable: reply.pinnedCacheUsable !== false,
    };
  };

  const syncDailyStateToServiceWorker = async () => {
    if (!swMessenger.canUseServiceWorker()) return;
    const latestDailyState = getLatestDailyState();
    await swMessenger.postMessage({
      type: messageTypes.SYNC_DAILY_STATE,
      payload: {
        dailyId: latestDailyState.dailyId,
        hardInvalidateAtUtcMs: latestDailyState.hardInvalidateAtUtcMs,
        dailySolvedDate: latestDailyState.dailySolvedDate,
        notificationsEnabled: readNotificationEnabledPreference(),
        warningHours: dailyNotificationWarningHours,
        notificationText: buildNotificationTextPayload(),
      },
    });
  };

  const syncUpdatePolicyToServiceWorker = async () => {
    if (!swMessenger.canUseServiceWorker()) return;
    await swMessenger.postMessage({
      type: messageTypes.SYNC_UPDATE_POLICY,
      payload: {
        autoUpdateEnabled: readAutoUpdateEnabledPreference(),
        currentBuildNumber: localBuildNumber,
      },
    }, { queueWhenUnavailable: true });
  };

  const ensureServiceWorkerUpdatePolicyConsistency = async () => {
    if (!swMessenger.canUseServiceWorker()) return;
    if (readAutoUpdateEnabledPreference()) return;
    if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) return;

    const targets = swMessenger.resolveUpdatePolicyTargets();
    if (targets.length === 0) return;

    let swPolicy: ServiceWorkerUpdatePolicy | null = null;
    for (const target of targets) {
      const policy = await readServiceWorkerUpdatePolicy(target);
      if (!policy) continue;
      swPolicy = policy;
      break;
    }

    if (!shouldResyncManualUpdatePolicy({
      localAutoUpdateEnabled: false,
      localBuildNumber,
      swPolicy,
    })) {
      return;
    }

    await syncUpdatePolicyToServiceWorker();
  };

  const requestServiceWorkerDailyCheck = async () => {
    if (!swMessenger.canUseServiceWorker()) return;
    await swMessenger.postMessage({ type: messageTypes.RUN_DAILY_CHECK });
  };

  const registerBackgroundDailyCheck = async () => {
    const registration = swMessenger.getRegistration() as SwUpdateRegistrationLike | null;
    if (
      !registration
      || !swMessenger.supportsNotifications()
      || notificationApi?.permission !== 'granted'
    ) {
      return;
    }
    if (!readNotificationEnabledPreference()) return;
    try {
      if (typeof registration.sync?.register === 'function') {
        await registration.sync.register(dailyCheckTag);
      }
    } catch {
      // One-shot sync registration is best effort.
    }
    try {
      if (typeof registration.periodicSync?.register === 'function') {
        await registration.periodicSync.register(dailyCheckTag, {
          minInterval: 12 * 60 * 60 * 1000,
        });
      }
    } catch {
      // Periodic sync support and permission are browser-dependent.
    }
  };

  const clearAppliedUpdateHistoryActions = async (appliedBuildNumber = localBuildNumber) => {
    if (!Number.isInteger(appliedBuildNumber) || appliedBuildNumber <= 0) return;
    await swMessenger.postMessage({
      type: messageTypes.CLEAR_UPDATE_HISTORY_ACTIONS,
      payload: {
        buildNumber: appliedBuildNumber,
      },
    }, { queueWhenUnavailable: true });
  };

  const fetchRemoteBuildNumber = async () => {
    if (typeof fetchImpl !== 'function') return null;
    try {
      const response = await fetchImpl(versionUrl, { cache: 'no-store' });
      if (!response.ok) return null;
      const payload = await response.json();
      return parseRemoteBuildNumber(payload);
    } catch {
      return null;
    }
  };

  const fetchRemoteServiceWorkerBuildNumber = async (buildHint: number | null = null): Promise<number | null> => {
    if (typeof fetchImpl !== 'function') return null;
    try {
      const swUrl = resolveServiceWorkerRegistrationUrl(isLocalhostHostname);
      if (Number.isInteger(buildHint) && buildHint !== null && buildHint > 0) {
        swUrl.searchParams.set('v', String(buildHint));
      }
      swUrl.searchParams.set('_swcb', String(now()));
      const response = await fetchImpl(swUrl.toString(), {
        cache: 'no-store',
        headers: {
          'x-bypass-cache': 'true',
        },
      });
      if (!response.ok) return null;
      return parseServiceWorkerBuildNumber(await response.text(), swBuildNumberRe);
    } catch {
      return null;
    }
  };

  const resolveUpdatableRemoteBuildNumber = async (remoteBuildNumber: number | null): Promise<number | null> => {
    if (!isPositiveInteger(remoteBuildNumber)) return null;
    const resolvedRemoteBuildNumber = remoteBuildNumber;
    const swBuildNumber = await fetchRemoteServiceWorkerBuildNumber(resolvedRemoteBuildNumber);
    if (!isPositiveInteger(swBuildNumber)) return null;
    const resolvedSwBuildNumber = swBuildNumber;
    if (resolvedSwBuildNumber < resolvedRemoteBuildNumber) return null;
    return resolvedSwBuildNumber;
  };

  const clearUpdateApplyReloadFallbackTimer = () => {
    if (!updateApplyReloadFallbackTimer) return;
    runtimeWindow.clearTimeout?.(updateApplyReloadFallbackTimer);
    updateApplyReloadFallbackTimer = 0;
  };

  const triggerAppliedUpdateReload = () => {
    if (!swReloadOnControllerChangeArmed) return false;
    swReloadOnControllerChangeArmed = false;
    clearUpdateApplyReloadFallbackTimer();
    runtimeWindow.location?.reload?.();
    return true;
  };

  const scheduleUpdateApplyReloadFallback = () => {
    clearUpdateApplyReloadFallbackTimer();
    updateApplyReloadFallbackTimer = runtimeWindow.setTimeout?.(() => {
      updateApplyReloadFallbackTimer = 0;
      triggerAppliedUpdateReload();
    }, updateApplyReloadFallbackMs);
  };

  const readNoWaitingReloadGuardBuild = () => {
    try {
      const raw = runtimeWindow?.sessionStorage?.getItem?.(noWaitingReloadBuildStorageKey);
      const parsed = Number.parseInt(raw || '', 10);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // sessionStorage can be unavailable in restricted browser contexts.
    }
    return Number.isInteger(noWaitingReloadGuardBuild) && noWaitingReloadGuardBuild !== null && noWaitingReloadGuardBuild > 0
      ? noWaitingReloadGuardBuild
      : null;
  };

  const writeNoWaitingReloadGuardBuild = (buildNumber: number): void => {
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
    noWaitingReloadGuardBuild = buildNumber;
    try {
      runtimeWindow?.sessionStorage?.setItem?.(noWaitingReloadBuildStorageKey, String(buildNumber));
    } catch {
      // sessionStorage can be unavailable in restricted browser contexts.
    }
  };

  const tryNoWaitingReloadFallback = (remoteBuildNumber: number): boolean => {
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return false;
    const guardedBuildNumber = readNoWaitingReloadGuardBuild();
    if (Number.isInteger(guardedBuildNumber) && guardedBuildNumber !== null && guardedBuildNumber >= remoteBuildNumber) {
      return false;
    }
    writeNoWaitingReloadGuardBuild(remoteBuildNumber);
    runtimeWindow.location?.reload?.();
    return true;
  };

  const observeWaitingWorkerActivation = (waitingWorker: WaitingWorkerLike | null | undefined): void => {
    if (!waitingWorker || typeof waitingWorker.addEventListener !== 'function') return;

    const clearWaitingWorkerObserver = () => {
      waitingWorker.removeEventListener('statechange', onStateChange);
    };

    const onStateChange = () => {
      if (waitingWorker.state === 'activated') {
        clearWaitingWorkerObserver();
        triggerAppliedUpdateReload();
        return;
      }
      if (waitingWorker.state === 'redundant') {
        clearWaitingWorkerObserver();
        clearUpdateApplyReloadFallbackTimer();
        swReloadOnControllerChangeArmed = false;
        setUpdateProgressOverlayActive(false);
      }
    };

    waitingWorker.addEventListener('statechange', onStateChange);
    if (waitingWorker.state === 'activated') {
      clearWaitingWorkerObserver();
      triggerAppliedUpdateReload();
      return;
    }
    if (waitingWorker.state === 'redundant') {
      clearWaitingWorkerObserver();
      clearUpdateApplyReloadFallbackTimer();
      swReloadOnControllerChangeArmed = false;
      setUpdateProgressOverlayActive(false);
    }
  };

  const armControllerChangeReload = () => {
    if (!swMessenger.canUseServiceWorker()) return;
    if (swControllerChangeBound) {
      swReloadOnControllerChangeArmed = true;
      return;
    }
    swControllerChangeBound = true;
    swReloadOnControllerChangeArmed = true;
    runtimeServiceWorker.addEventListener?.('controllerchange', () => {
      triggerAppliedUpdateReload();
    });
  };

  const hasNotifiedRemoteBuild = (remoteBuildNumber: number): boolean => {
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= 0) return true;
    if (notifiedRemoteBuildNumbers.has(remoteBuildNumber)) return true;
    const stored = readLastNotifiedRemoteBuildNumber();
    return Number.isInteger(stored) && stored !== null && stored >= remoteBuildNumber;
  };

  const markRemoteBuildNotified = (remoteBuildNumber: number): void => {
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= 0) return;
    notifiedRemoteBuildNumbers.add(remoteBuildNumber);
    writeLastNotifiedRemoteBuildNumber(remoteBuildNumber);
  };

  const notifyUpdateAvailable = async (remoteBuildNumber: number): Promise<void> => {
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return;
    if (hasNotifiedRemoteBuild(remoteBuildNumber)) return;

    markRemoteBuildNotified(remoteBuildNumber);
    showToast(resolveNewVersionToastText(), { recordInHistory: false });
    await swMessenger.postMessage({
      type: messageTypes.APPEND_SYSTEM_HISTORY,
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

  const maybeApplyUpdate = async (
    remoteBuildNumber: number,
    options: UpdateApplyOptions = {},
  ): Promise<UpdateApplyResult> => {
    const {
      force = false,
      approvedBuildNumber = null,
    } = options;
    const registration = swMessenger.getRegistration() as SwUpdateRegistrationLike | null;
    if (!registration) {
      return { applied: false, status: applyStatus.UNAVAILABLE };
    }
    if (!force && promptedRemoteBuildNumbers.has(remoteBuildNumber)) {
      return { applied: false, status: applyStatus.ALREADY_PROMPTED };
    }

    setUpdateProgressOverlayActive(true);
    let applied = false;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const waitingWorkerPromise = waitForWaitingWorker(
          registration,
          attempt === 0 ? waitingWorkerTimeoutFirstMs : waitingWorkerTimeoutRetryMs,
          runtimeWindow,
        );
        try {
          await registration.update();
        } catch {
          return { applied: false, status: applyStatus.UPDATE_FAILED };
        }

        const waitingWorker = await waitingWorkerPromise;
        if (!waitingWorker) continue;

        promptedRemoteBuildNumbers.add(remoteBuildNumber);
        armControllerChangeReload();
        waitingWorker.postMessage({
          type: 'SW_SKIP_WAITING',
          payload: Number.isInteger(approvedBuildNumber) && approvedBuildNumber !== null && approvedBuildNumber > 0
            ? { approvedBuildNumber: Number(approvedBuildNumber) }
            : {},
        });
        scheduleUpdateApplyReloadFallback();
        observeWaitingWorkerActivation(waitingWorker);
        applied = true;
        return { applied: true, status: applyStatus.APPLIED };
      }
    } finally {
      if (!applied) {
        setUpdateProgressOverlayActive(false);
      }
    }

    return { applied: false, status: applyStatus.NO_WAITING };
  };

  const applyUpdateForBuild = async (
    remoteBuildNumber: number,
    options: UpdateApplyOptions = {},
  ): Promise<UpdateApplyResult> => {
    const {
      force = false,
      toastOnFailure = false,
      approvedBuildNumber = null,
    } = options;
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) {
      return { applied: false, status: applyStatus.UNAVAILABLE };
    }
    const result = await maybeApplyUpdate(remoteBuildNumber, {
      force,
      approvedBuildNumber,
    });
    if (!result.applied && result.status === applyStatus.NO_WAITING) {
      if (tryNoWaitingReloadFallback(remoteBuildNumber)) {
        return {
          applied: true,
          status: applyStatus.APPLIED,
        };
      }
    }
    if (!result.applied && toastOnFailure) {
      showToast(resolveUpdateApplyFailureToastText(), { recordInHistory: false });
    }
    return result;
  };

  const checkForNewBuild = async ({ force = false }: UpdateCheckOptions = {}): Promise<void> => {
    if (!swMessenger.canUseServiceWorker() || !swMessenger.getRegistration()) return;
    if (!runtimeNavigator.onLine) return;
    if (updateCheckInFlight) return;

    const nowMs = now();
    if (!force && nowMs - lastUpdateCheckAtMs < updateCheckThrottleMs) return;

    updateCheckInFlight = true;
    lastUpdateCheckAtMs = nowMs;
    try {
      const remoteBuildNumber = await fetchRemoteBuildNumber();
      if (!isPositiveInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return;
      const resolvedRemoteBuildNumber = remoteBuildNumber;
      const updatableRemoteBuildNumber = await resolveUpdatableRemoteBuildNumber(resolvedRemoteBuildNumber);
      if (!isPositiveInteger(updatableRemoteBuildNumber) || updatableRemoteBuildNumber <= localBuildNumber) return;
      const resolvedUpdatableRemoteBuildNumber = updatableRemoteBuildNumber;
      const decision = resolveUpdateCheckDecision({
        localBuildNumber,
        updatableRemoteBuildNumber: resolvedUpdatableRemoteBuildNumber,
        autoUpdateEnabled: readAutoUpdateEnabledPreference(),
      });
      if (decision === checkDecision.APPLY) {
        await applyUpdateForBuild(resolvedUpdatableRemoteBuildNumber);
        return;
      }
      if (decision === checkDecision.NOTIFY) {
        await notifyUpdateAvailable(resolvedUpdatableRemoteBuildNumber);
        return;
      }
    } finally {
      updateCheckInFlight = false;
    }
  };

  const registerServiceWorker = async () => {
    if (!swMessenger.canUseServiceWorker()) return null;
    try {
      const registration = await runtimeServiceWorker.register?.(
        resolveServiceWorkerRegistrationUrl(isLocalhostHostname),
      );
      if (!registration) return null;
      swMessenger.setRegistration(registration);
      await runtimeServiceWorker.ready;
      await swMessenger.flushPendingMessages();
      await syncDailyStateToServiceWorker();
      await syncUpdatePolicyToServiceWorker();
      await ensureServiceWorkerUpdatePolicyConsistency();
      await registerBackgroundDailyCheck();
      await requestServiceWorkerDailyCheck();
      await swMessenger.postMessage({ type: messageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
      void checkForNewBuild({ force: true });
      return registration;
    } catch {
      swMessenger.setRegistration(null);
      return null;
    }
  };

  const bindRuntimeEvents = () => {
    if (!swMessenger.canUseServiceWorker()) return;

    runtimeWindow.addEventListener('online', () => {
      void checkForNewBuild();
      void requestServiceWorkerDailyCheck();
      void swMessenger.postMessage({ type: messageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
    });

    runtimeDocument.addEventListener('visibilitychange', () => {
      if (runtimeDocument.visibilityState !== 'visible') return;
      void checkForNewBuild();
      void requestServiceWorkerDailyCheck();
      void swMessenger.postMessage({ type: messageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
    });
  };

  const bindHistoryUpdates = ({ onPayload }: HistoryBindOptions) => swMessenger.bindHistoryUpdates({
    historyMessageType: messageTypes.HISTORY_UPDATE,
    onPayload,
  });

  return {
    getRegistration: () => swMessenger.getRegistration(),
    syncDailyStateToServiceWorker,
    syncUpdatePolicyToServiceWorker,
    ensureServiceWorkerUpdatePolicyConsistency,
    requestServiceWorkerDailyCheck,
    registerBackgroundDailyCheck,
    clearAppliedUpdateHistoryActions,
    fetchRemoteBuildNumber,
    resolveUpdatableRemoteBuildNumber,
    applyUpdateForBuild,
    checkForNewBuild,
    registerServiceWorker,
    bindRuntimeEvents,
    bindHistoryUpdates,
  };
}
