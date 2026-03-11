export function createNotificationToggleController(options = {}) {
  const {
    elementIds,
    notificationEnabledKey,
    autoUpdateEnabledKey,
    notificationAutoPromptDecisions,
    readAutoPromptDecision = () => notificationAutoPromptDecisions?.UNSET,
    writeAutoPromptDecision = () => { },
    readNotificationEnabledPreference = () => false,
    writeNotificationEnabledPreference = () => { },
    readAutoUpdateEnabledPreference = () => false,
    writeAutoUpdateEnabledPreference = () => { },
    hasStoredNotificationEnabledPreference = () => false,
    notificationPermissionState = () => 'unsupported',
    supportsNotifications = () => false,
    canUseServiceWorker = () => false,
    requestNotificationPermission = async () => 'unsupported',
    syncDailyStateToServiceWorker = async () => { },
    syncUpdatePolicyToServiceWorker = async () => { },
    registerBackgroundDailyCheck = async () => { },
    requestServiceWorkerDailyCheck = async () => { },
    translateNow = (key) => key,
    showInAppToast = () => { },
    windowObj = typeof window === 'undefined' ? undefined : window,
    documentObj = typeof document === 'undefined' ? undefined : document,
  } = options;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationToggleController requires elementIds');
  }

  let notificationsToggleEl = null;
  let notificationsToggleBound = false;
  let autoUpdateToggleEl = null;
  let autoUpdateToggleBound = false;

  const refreshNotificationsToggleUi = () => {
    if (!notificationsToggleEl) return;
    const enabled = readNotificationEnabledPreference();
    const permission = notificationPermissionState();
    notificationsToggleEl.checked = enabled;
    notificationsToggleEl.disabled = permission === 'unsupported';
  };

  const refreshAutoUpdateToggleUi = () => {
    if (!autoUpdateToggleEl) return;
    autoUpdateToggleEl.checked = readAutoUpdateEnabledPreference();
  };

  const requestAndEnableNotifications = async () => {
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
    if (readAutoPromptDecision() !== notificationAutoPromptDecisions.UNSET) return;

    const confirmed = windowObj.confirm(translateNow('ui.notificationsAutoPromptConfirm'));
    if (!confirmed) {
      writeAutoPromptDecision(notificationAutoPromptDecisions.DECLINED);
      writeNotificationEnabledPreference(false);
      refreshNotificationsToggleUi();
      await syncDailyStateToServiceWorker();
      return;
    }

    writeAutoPromptDecision(notificationAutoPromptDecisions.ACCEPTED);
    await requestAndEnableNotifications();
  };

  const bindNotificationsToggle = () => {
    notificationsToggleEl = documentObj.getElementById(elementIds.NOTIFICATIONS_TOGGLE);

    if (!notificationsToggleEl || notificationsToggleBound) {
      refreshNotificationsToggleUi();
      return;
    }
    notificationsToggleEl.addEventListener('change', () => {
      if (notificationsToggleEl.checked) {
        void requestAndEnableNotifications();
        return;
      }
      void disableNotificationsNow();
    });

    notificationsToggleBound = true;
    refreshNotificationsToggleUi();
  };

  const bindAutoUpdateToggle = () => {
    autoUpdateToggleEl = documentObj.getElementById(elementIds.AUTO_UPDATE_TOGGLE);

    if (!autoUpdateToggleEl || autoUpdateToggleBound) {
      refreshAutoUpdateToggleUi();
      return;
    }

    autoUpdateToggleEl.addEventListener('change', () => {
      writeAutoUpdateEnabledPreference(autoUpdateToggleEl.checked);
      refreshAutoUpdateToggleUi();
      void syncUpdatePolicyToServiceWorker();
    });

    autoUpdateToggleBound = true;
    refreshAutoUpdateToggleUi();
  };

  const handleStorageEvent = (storageKey) => {
    if (storageKey === notificationEnabledKey) {
      refreshNotificationsToggleUi();
      void syncDailyStateToServiceWorker();
    } else if (storageKey === autoUpdateEnabledKey) {
      refreshAutoUpdateToggleUi();
      void syncUpdatePolicyToServiceWorker();
    }
  };

  const bind = () => {
    if (!documentObj || !windowObj) return;
    bindNotificationsToggle();
    bindAutoUpdateToggle();
  };

  return {
    bind,
    refreshUi: () => {
      refreshNotificationsToggleUi();
      refreshAutoUpdateToggleUi();
    },
    maybeAutoPromptForNotifications,
    handleStorageEvent,
  };
}
