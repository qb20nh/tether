export const parseRemoteBuildNumber = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const parsed = Number.parseInt(payload.buildNumber, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const parseServiceWorkerBuildNumber = (source, buildNumberRe) => {
  if (typeof source !== 'string' || source.length === 0) return null;
  if (!(buildNumberRe instanceof RegExp)) return null;
  const match = new RegExp(buildNumberRe).exec(source);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const waitForWaitingWorker = (registration, timeoutMs, windowObj) =>
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
    const timer = windowObj.setTimeout(() => {
      finish(null);
    }, timeoutMs);
    const clearTimer = () => {
      windowObj.clearTimeout(timer);
    };

    bindInstallingWorker(registration.installing);
    registration.addEventListener('updatefound', onUpdateFound);
    cleanups.push(clearUpdateFoundListener, clearTimer);
  });

export function createSwUpdateOrchestrator(options = {}) {
  const {
    swMessenger,
    swMessageTypes,
    updateApplyStatus,
    updateCheckDecision,
    localBuildNumber = 0,
    versionUrl = '',
    swBuildNumberRe = null,
    resolveServiceWorkerRegistrationUrl,
    isLocalhostHostname,
    readAutoUpdateEnabledPreference = () => false,
    readNotificationEnabledPreference = () => false,
    readLastNotifiedRemoteBuildNumber = () => null,
    writeLastNotifiedRemoteBuildNumber = () => { },
    buildNotificationTextPayload = () => ({}),
    getLatestDailyState = () => ({
      dailyId: null,
      hardInvalidateAtUtcMs: null,
      dailySolvedDate: null,
    }),
    resolveUpdateCheckDecision = () => null,
    shouldResyncManualUpdatePolicy = () => false,
    showInAppToast = () => { },
    resolveNewVersionToastText = () => '',
    resolveNewVersionTitleText = () => '',
    resolveNewVersionBodyText = () => '',
    resolveUpdateApplyFailureToastText = () => '',
    setUpdateProgressOverlayActive = () => { },
    updateCheckThrottleMs = 5 * 60 * 1000,
    updateApplyReloadFallbackMs = 5 * 1000,
    dailyCheckTag = 'tether-daily-check',
    dailyNotificationWarningHours = 8,
    waitingWorkerTimeoutFirstMs = 8000,
    waitingWorkerTimeoutRetryMs = 4000,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    windowObj = typeof window === 'undefined' ? undefined : window,
    documentObj = typeof document === 'undefined' ? undefined : document,
    navigatorObj = typeof navigator === 'undefined' ? undefined : navigator,
    notificationApi = typeof Notification === 'undefined' ? undefined : Notification,
    now = () => Date.now(),
    noWaitingReloadBuildStorageKey = 'tetherUpdateNoWaitingReloadBuild',
  } = options;

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
  let updateApplyReloadFallbackTimer = 0;
  let updateCheckInFlight = false;
  let lastUpdateCheckAtMs = 0;
  let noWaitingReloadGuardBuild = null;
  const promptedRemoteBuildNumbers = new Set();
  const notifiedRemoteBuildNumbers = new Set();

  const readServiceWorkerUpdatePolicy = async (target = null) => {
    const reply = await swMessenger.postMessageWithReply({
      type: swMessageTypes.GET_UPDATE_POLICY,
    }, { target, timeoutMs: 2000 });
    if (reply?.ok !== true) return null;
    return {
      autoUpdateEnabled: reply.autoUpdateEnabled === true,
      pinnedBuildNumber: Number.parseInt(reply.pinnedBuildNumber, 10),
      servingBuildNumber: Number.parseInt(reply.servingBuildNumber, 10),
      swBuildNumber: Number.parseInt(reply.swBuildNumber, 10),
      pinnedCacheUsable: reply.pinnedCacheUsable !== false,
    };
  };

  const syncDailyStateToServiceWorker = async () => {
    if (!swMessenger.canUseServiceWorker()) return;
    const latestDailyState = getLatestDailyState();
    await swMessenger.postMessage({
      type: swMessageTypes.SYNC_DAILY_STATE,
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
      type: swMessageTypes.SYNC_UPDATE_POLICY,
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

    let swPolicy = null;
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
    await swMessenger.postMessage({ type: swMessageTypes.RUN_DAILY_CHECK });
  };

  const registerBackgroundDailyCheck = async () => {
    const registration = swMessenger.getRegistration();
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
      type: swMessageTypes.CLEAR_UPDATE_HISTORY_ACTIONS,
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

  const fetchRemoteServiceWorkerBuildNumber = async (buildHint = null) => {
    if (typeof fetchImpl !== 'function') return null;
    try {
      const swUrl = resolveServiceWorkerRegistrationUrl(isLocalhostHostname);
      if (Number.isInteger(buildHint) && buildHint > 0) {
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

  const resolveUpdatableRemoteBuildNumber = async (remoteBuildNumber) => {
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= 0) return null;
    const swBuildNumber = await fetchRemoteServiceWorkerBuildNumber(remoteBuildNumber);
    if (!Number.isInteger(swBuildNumber) || swBuildNumber <= 0) return null;
    if (swBuildNumber < remoteBuildNumber) return null;
    return swBuildNumber;
  };

  const clearUpdateApplyReloadFallbackTimer = () => {
    if (!updateApplyReloadFallbackTimer) return;
    windowObj.clearTimeout(updateApplyReloadFallbackTimer);
    updateApplyReloadFallbackTimer = 0;
  };

  const triggerAppliedUpdateReload = () => {
    if (!swReloadOnControllerChangeArmed) return false;
    swReloadOnControllerChangeArmed = false;
    clearUpdateApplyReloadFallbackTimer();
    windowObj.location.reload();
    return true;
  };

  const scheduleUpdateApplyReloadFallback = () => {
    clearUpdateApplyReloadFallbackTimer();
    updateApplyReloadFallbackTimer = windowObj.setTimeout(() => {
      updateApplyReloadFallbackTimer = 0;
      triggerAppliedUpdateReload();
    }, updateApplyReloadFallbackMs);
  };

  const readNoWaitingReloadGuardBuild = () => {
    try {
      const raw = windowObj?.sessionStorage?.getItem(noWaitingReloadBuildStorageKey);
      const parsed = Number.parseInt(raw || '', 10);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // sessionStorage can be unavailable in restricted browser contexts.
    }
    return Number.isInteger(noWaitingReloadGuardBuild) && noWaitingReloadGuardBuild > 0
      ? noWaitingReloadGuardBuild
      : null;
  };

  const writeNoWaitingReloadGuardBuild = (buildNumber) => {
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
    noWaitingReloadGuardBuild = buildNumber;
    try {
      windowObj?.sessionStorage?.setItem(noWaitingReloadBuildStorageKey, String(buildNumber));
    } catch {
      // sessionStorage can be unavailable in restricted browser contexts.
    }
  };

  const tryNoWaitingReloadFallback = (remoteBuildNumber) => {
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return false;
    const guardedBuildNumber = readNoWaitingReloadGuardBuild();
    if (Number.isInteger(guardedBuildNumber) && guardedBuildNumber >= remoteBuildNumber) {
      return false;
    }
    writeNoWaitingReloadGuardBuild(remoteBuildNumber);
    windowObj.location.reload();
    return true;
  };

  const observeWaitingWorkerActivation = (waitingWorker) => {
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
    navigatorObj.serviceWorker.addEventListener('controllerchange', () => {
      triggerAppliedUpdateReload();
    });
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
    await swMessenger.postMessage({
      type: swMessageTypes.APPEND_SYSTEM_HISTORY,
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
    const {
      force = false,
      approvedBuildNumber = null,
    } = options;
    const registration = swMessenger.getRegistration();
    if (!registration) {
      return { applied: false, status: updateApplyStatus.UNAVAILABLE };
    }
    if (!force && promptedRemoteBuildNumbers.has(remoteBuildNumber)) {
      return { applied: false, status: updateApplyStatus.ALREADY_PROMPTED };
    }

    setUpdateProgressOverlayActive(true);
    let applied = false;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const waitingWorkerPromise = waitForWaitingWorker(
          registration,
          attempt === 0 ? waitingWorkerTimeoutFirstMs : waitingWorkerTimeoutRetryMs,
          windowObj,
        );
        try {
          await registration.update();
        } catch {
          return { applied: false, status: updateApplyStatus.UPDATE_FAILED };
        }

        const waitingWorker = await waitingWorkerPromise;
        if (!waitingWorker) continue;

        promptedRemoteBuildNumbers.add(remoteBuildNumber);
        armControllerChangeReload();
        waitingWorker.postMessage({
          type: 'SW_SKIP_WAITING',
          payload: Number.isInteger(approvedBuildNumber) && approvedBuildNumber > 0
            ? { approvedBuildNumber }
            : {},
        });
        scheduleUpdateApplyReloadFallback();
        observeWaitingWorkerActivation(waitingWorker);
        applied = true;
        return { applied: true, status: updateApplyStatus.APPLIED };
      }
    } finally {
      if (!applied) {
        setUpdateProgressOverlayActive(false);
      }
    }

    return { applied: false, status: updateApplyStatus.NO_WAITING };
  };

  const applyUpdateForBuild = async (remoteBuildNumber, options = {}) => {
    const {
      force = false,
      toastOnFailure = false,
      approvedBuildNumber = null,
    } = options;
    if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) {
      return { applied: false, status: updateApplyStatus.UNAVAILABLE };
    }
    const result = await maybeApplyUpdate(remoteBuildNumber, {
      force,
      approvedBuildNumber,
    });
    if (!result.applied && result.status === updateApplyStatus.NO_WAITING) {
      if (tryNoWaitingReloadFallback(remoteBuildNumber)) {
        return {
          applied: true,
          status: updateApplyStatus.APPLIED,
        };
      }
    }
    if (!result.applied && toastOnFailure) {
      showInAppToast(resolveUpdateApplyFailureToastText(), { recordInHistory: false });
    }
    return result;
  };

  const checkForNewBuild = async ({ force = false } = {}) => {
    if (!swMessenger.canUseServiceWorker() || !swMessenger.getRegistration()) return;
    if (!navigatorObj.onLine) return;
    if (updateCheckInFlight) return;

    const nowMs = now();
    if (!force && nowMs - lastUpdateCheckAtMs < updateCheckThrottleMs) return;

    updateCheckInFlight = true;
    lastUpdateCheckAtMs = nowMs;
    try {
      const remoteBuildNumber = await fetchRemoteBuildNumber();
      if (!Number.isInteger(remoteBuildNumber) || remoteBuildNumber <= localBuildNumber) return;
      const updatableRemoteBuildNumber = await resolveUpdatableRemoteBuildNumber(remoteBuildNumber);
      if (!Number.isInteger(updatableRemoteBuildNumber) || updatableRemoteBuildNumber <= localBuildNumber) return;
      const decision = resolveUpdateCheckDecision({
        localBuildNumber,
        updatableRemoteBuildNumber,
        autoUpdateEnabled: readAutoUpdateEnabledPreference(),
      });
      if (decision === updateCheckDecision.APPLY) {
        await applyUpdateForBuild(updatableRemoteBuildNumber);
        return;
      }
      if (decision === updateCheckDecision.NOTIFY) {
        await notifyUpdateAvailable(updatableRemoteBuildNumber);
        return;
      }
    } finally {
      updateCheckInFlight = false;
    }
  };

  const registerServiceWorker = async () => {
    if (!swMessenger.canUseServiceWorker()) return null;
    try {
      const registration = await navigatorObj.serviceWorker.register(
        resolveServiceWorkerRegistrationUrl(isLocalhostHostname),
      );
      swMessenger.setRegistration(registration);
      await navigatorObj.serviceWorker.ready;
      await swMessenger.flushPendingMessages();
      await syncDailyStateToServiceWorker();
      await syncUpdatePolicyToServiceWorker();
      await ensureServiceWorkerUpdatePolicyConsistency();
      await registerBackgroundDailyCheck();
      await requestServiceWorkerDailyCheck();
      await swMessenger.postMessage({ type: swMessageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
      void checkForNewBuild({ force: true });
      return registration;
    } catch {
      swMessenger.setRegistration(null);
      return null;
    }
  };

  const bindRuntimeEvents = () => {
    if (!swMessenger.canUseServiceWorker()) return;

    windowObj.addEventListener('online', () => {
      void checkForNewBuild();
      void requestServiceWorkerDailyCheck();
      void swMessenger.postMessage({ type: swMessageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
    });

    documentObj.addEventListener('visibilitychange', () => {
      if (documentObj.visibilityState !== 'visible') return;
      void checkForNewBuild();
      void requestServiceWorkerDailyCheck();
      void swMessenger.postMessage({ type: swMessageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
    });
  };

  const bindHistoryUpdates = ({ onPayload }) => swMessenger.bindHistoryUpdates({
    historyMessageType: swMessageTypes.HISTORY_UPDATE,
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
