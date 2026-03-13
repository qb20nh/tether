import type {
  InputElementLike,
  NotificationToggleController,
} from '../contracts/ports.ts';
import {
  normalizeNotificationToggleOptions,
  type NotificationToggleOptionsInput,
} from './notification_options.ts';

export function createNotificationToggleController(
  options: NotificationToggleOptionsInput = {},
): NotificationToggleController {
  const notificationOptions = normalizeNotificationToggleOptions(options);
  const { elementIds } = notificationOptions;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationToggleController requires elementIds');
  }

  let notificationsToggleEl: InputElementLike | null = null;
  let notificationsToggleBound = false;
  let autoUpdateToggleEl: InputElementLike | null = null;
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
    if (!notificationOptions.windowObj) return;
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
    if (!notificationOptions.documentObj) return;
    notificationsToggleEl = notificationOptions.documentObj.getElementById(
      elementIds.NOTIFICATIONS_TOGGLE,
    ) as InputElementLike | null;

    if (!notificationsToggleEl || notificationsToggleBound) {
      refreshNotificationsToggleUi();
      return;
    }
    const toggleEl = notificationsToggleEl;
    toggleEl.addEventListener('change', () => {
      if (toggleEl.checked) {
        void requestAndEnableNotifications();
        return;
      }
      void disableNotificationsNow();
    });

    notificationsToggleBound = true;
    refreshNotificationsToggleUi();
  };

  const bindAutoUpdateToggle = () => {
    if (!notificationOptions.documentObj) return;
    autoUpdateToggleEl = notificationOptions.documentObj.getElementById(
      elementIds.AUTO_UPDATE_TOGGLE,
    ) as InputElementLike | null;

    if (!autoUpdateToggleEl || autoUpdateToggleBound) {
      refreshAutoUpdateToggleUi();
      return;
    }

    const toggleEl = autoUpdateToggleEl;
    toggleEl.addEventListener('change', () => {
      notificationOptions.writeAutoUpdateEnabledPreference(Boolean(toggleEl.checked));
      refreshAutoUpdateToggleUi();
      void notificationOptions.syncUpdatePolicyToServiceWorker();
    });

    autoUpdateToggleBound = true;
    refreshAutoUpdateToggleUi();
  };

  const handleStorageEvent = (storageKey?: string | null) => {
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
