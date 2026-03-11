export const NOTIFICATION_AUTO_PROMPT_KEY = 'tetherNotificationAutoPromptDecision';
export const NOTIFICATION_ENABLED_KEY = 'tetherNotificationsEnabled';
export const AUTO_UPDATE_ENABLED_KEY = 'tetherAutoUpdateEnabled';
export const LAST_NOTIFIED_REMOTE_BUILD_KEY = 'tetherLastNotifiedRemoteBuildNumber';

export const NOTIFICATION_AUTO_PROMPT_DECISIONS = Object.freeze({
  UNSET: 'unset',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

export function createNotificationPreferences(options = {}) {
  const {
    localStorageObj = typeof window === 'undefined' ? null : window.localStorage,
    supportsNotifications = () => false,
    notificationApi = typeof Notification === 'undefined' ? null : Notification,
  } = options;

  const readAutoPromptDecision = () => {
    try {
      const value = localStorageObj?.getItem(NOTIFICATION_AUTO_PROMPT_KEY);
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
      localStorageObj?.setItem(NOTIFICATION_AUTO_PROMPT_KEY, decision);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  };

  const notificationPermissionState = () => {
    if (!supportsNotifications()) return 'unsupported';
    return notificationApi?.permission;
  };

  const readNotificationEnabledPreference = () => {
    try {
      const raw = localStorageObj?.getItem(NOTIFICATION_ENABLED_KEY);
      if (raw === 'false') return false;
      if (raw === 'true') return true;
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
    return notificationPermissionState() === 'granted';
  };

  const writeNotificationEnabledPreference = (enabled) => {
    try {
      localStorageObj?.setItem(NOTIFICATION_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  };

  const readAutoUpdateEnabledPreference = () => {
    try {
      return localStorageObj?.getItem(AUTO_UPDATE_ENABLED_KEY) === 'true';
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
    return false;
  };

  const writeAutoUpdateEnabledPreference = (enabled) => {
    try {
      localStorageObj?.setItem(AUTO_UPDATE_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  };

  const readLastNotifiedRemoteBuildNumber = () => {
    try {
      const parsed = Number.parseInt(localStorageObj?.getItem(LAST_NOTIFIED_REMOTE_BUILD_KEY) || '', 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
    return null;
  };

  const writeLastNotifiedRemoteBuildNumber = (buildNumber) => {
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
    try {
      localStorageObj?.setItem(LAST_NOTIFIED_REMOTE_BUILD_KEY, String(buildNumber));
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  };

  const hasStoredNotificationEnabledPreference = () => {
    try {
      return localStorageObj?.getItem(NOTIFICATION_ENABLED_KEY) !== null;
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
    return false;
  };

  return {
    readAutoPromptDecision,
    writeAutoPromptDecision,
    readNotificationEnabledPreference,
    writeNotificationEnabledPreference,
    readAutoUpdateEnabledPreference,
    writeAutoUpdateEnabledPreference,
    readLastNotifiedRemoteBuildNumber,
    writeLastNotifiedRemoteBuildNumber,
    hasStoredNotificationEnabledPreference,
    notificationPermissionState,
  };
}
