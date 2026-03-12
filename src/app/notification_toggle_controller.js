import { normalizeNotificationToggleOptions } from './notification_options.js';

export function createNotificationToggleController(options = {}) {
  const notificationOptions = normalizeNotificationToggleOptions(options);
  const { elementIds } = notificationOptions;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationToggleController requires elementIds');
  }

  let notificationsToggleEl = null;
  let notificationsToggleBound = false;
  let autoUpdateToggleEl = null;
  let autoUpdateToggleBound = false;

  const refreshNotificationsToggleUi = () => {
    if (!notificationsToggleEl) return;
    const enabled = notificationOptions.readNotificationEnabledPreference();
    const permission = notificationOptions.notificationPermissionState();
    notificationsToggleEl.checked = enabled;
    notificationsToggleEl.disabled = permission === 'unsupported';
  };

  const refreshAutoUpdateToggleUi = () => {
    if (!autoUpdateToggleEl) return;
    autoUpdateToggleEl.checked = notificationOptions.readAutoUpdateEnabledPreference();
  };

  const requestAndEnableNotifications = async () => {
    notificationOptions.writeNotificationEnabledPreference(true);
    const permission = await notificationOptions.requestNotificationPermission();
    if (permission !== 'granted') {
      notificationOptions.writeNotificationEnabledPreference(false);
      if (permission === 'denied') {
        const deniedText = notificationOptions.translateNow('ui.notificationsBlockedToast');
        if (deniedText !== 'ui.notificationsBlockedToast') {
          notificationOptions.showInAppToast(deniedText, { recordInHistory: false });
        }
      }
      refreshNotificationsToggleUi();
      await notificationOptions.syncDailyStateToServiceWorker();
      return false;
    }

    refreshNotificationsToggleUi();
    await notificationOptions.syncDailyStateToServiceWorker();
    await notificationOptions.registerBackgroundDailyCheck();
    await notificationOptions.requestServiceWorkerDailyCheck();
    return true;
  };

  const disableNotificationsNow = async () => {
    notificationOptions.writeNotificationEnabledPreference(false);
    refreshNotificationsToggleUi();
    await notificationOptions.syncDailyStateToServiceWorker();
  };

  const maybeAutoPromptForNotifications = async () => {
    if (!notificationOptions.supportsNotifications() || !notificationOptions.canUseServiceWorker()) return;
    if (
      notificationOptions.hasStoredNotificationEnabledPreference()
      && !notificationOptions.readNotificationEnabledPreference()
    ) {
      return;
    }
    if (notificationOptions.notificationPermissionState() === 'granted') return;
    if (
      notificationOptions.readAutoPromptDecision()
      !== notificationOptions.notificationAutoPromptDecisions.UNSET
    ) {
      return;
    }

    const confirmed = notificationOptions.windowObj.confirm(
      notificationOptions.translateNow('ui.notificationsAutoPromptConfirm'),
    );
    if (!confirmed) {
      notificationOptions.writeAutoPromptDecision(
        notificationOptions.notificationAutoPromptDecisions.DECLINED,
      );
      notificationOptions.writeNotificationEnabledPreference(false);
      refreshNotificationsToggleUi();
      await notificationOptions.syncDailyStateToServiceWorker();
      return;
    }

    notificationOptions.writeAutoPromptDecision(
      notificationOptions.notificationAutoPromptDecisions.ACCEPTED,
    );
    await requestAndEnableNotifications();
  };

  const bindNotificationsToggle = () => {
    notificationsToggleEl = notificationOptions.documentObj.getElementById(elementIds.NOTIFICATIONS_TOGGLE);

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
    autoUpdateToggleEl = notificationOptions.documentObj.getElementById(elementIds.AUTO_UPDATE_TOGGLE);

    if (!autoUpdateToggleEl || autoUpdateToggleBound) {
      refreshAutoUpdateToggleUi();
      return;
    }

    autoUpdateToggleEl.addEventListener('change', () => {
      notificationOptions.writeAutoUpdateEnabledPreference(autoUpdateToggleEl.checked);
      refreshAutoUpdateToggleUi();
      void notificationOptions.syncUpdatePolicyToServiceWorker();
    });

    autoUpdateToggleBound = true;
    refreshAutoUpdateToggleUi();
  };

  const handleStorageEvent = (storageKey) => {
    if (storageKey === notificationOptions.notificationEnabledKey) {
      refreshNotificationsToggleUi();
      void notificationOptions.syncDailyStateToServiceWorker();
    } else if (storageKey === notificationOptions.autoUpdateEnabledKey) {
      refreshAutoUpdateToggleUi();
      void notificationOptions.syncUpdatePolicyToServiceWorker();
    }
  };

  const bind = () => {
    if (!notificationOptions.documentObj || !notificationOptions.windowObj) return;
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
