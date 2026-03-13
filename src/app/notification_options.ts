import type {
  DocumentLike,
  NotificationAutoPromptDecisions,
  NotificationPermissionState,
  NotificationToggleOptionFields,
  RuntimeData,
  Translator,
  WindowLike,
} from '../contracts/ports.ts';

export interface NotificationToggleOptionsInput {
  elementIds?: Record<string, string>;
  notificationEnabledKey?: string;
  autoUpdateEnabledKey?: string;
  notificationAutoPromptDecisions?: NotificationAutoPromptDecisions;
  readAutoPromptDecision?: () => string;
  writeAutoPromptDecision?: (value: string) => void;
  readNotificationEnabledPreference?: () => boolean;
  writeNotificationEnabledPreference?: (enabled: boolean) => void;
  readAutoUpdateEnabledPreference?: () => boolean;
  writeAutoUpdateEnabledPreference?: (enabled: boolean) => void;
  hasStoredNotificationEnabledPreference?: () => boolean;
  notificationPermissionState?: () => NotificationPermissionState;
  supportsNotifications?: () => boolean;
  canUseServiceWorker?: () => boolean;
  requestNotificationPermission?: () => Promise<NotificationPermissionState>;
  syncDailyStateToServiceWorker?: () => Promise<void>;
  syncUpdatePolicyToServiceWorker?: () => Promise<void>;
  registerBackgroundDailyCheck?: () => Promise<void>;
  requestServiceWorkerDailyCheck?: () => Promise<void>;
  translateNow?: Translator;
  showInAppToast?: (text: string, options?: RuntimeData) => void;
  windowObj?: WindowLike;
  documentObj?: DocumentLike;
}

const DEFAULT_NOTIFICATION_AUTO_PROMPT_DECISIONS: NotificationAutoPromptDecisions = {
  UNSET: 'unset',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
};

export const normalizeNotificationToggleOptions = (
  options: NotificationToggleOptionsInput = {},
): NotificationToggleOptionFields => {
  const {
    elementIds = {},
    notificationEnabledKey,
    autoUpdateEnabledKey,
    notificationAutoPromptDecisions = DEFAULT_NOTIFICATION_AUTO_PROMPT_DECISIONS,
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
    translateNow = (key: string) => key,
    showInAppToast = () => { },
    windowObj = (typeof window === 'undefined' ? undefined : window) as WindowLike | undefined,
    documentObj = (typeof document === 'undefined' ? undefined : document) as DocumentLike | undefined,
  } = options;

  return {
    elementIds,
    notificationEnabledKey,
    autoUpdateEnabledKey,
    notificationAutoPromptDecisions,
    readAutoPromptDecision,
    writeAutoPromptDecision,
    readNotificationEnabledPreference,
    writeNotificationEnabledPreference,
    readAutoUpdateEnabledPreference,
    writeAutoUpdateEnabledPreference,
    hasStoredNotificationEnabledPreference,
    notificationPermissionState,
    supportsNotifications,
    canUseServiceWorker,
    requestNotificationPermission,
    syncDailyStateToServiceWorker,
    syncUpdatePolicyToServiceWorker,
    registerBackgroundDailyCheck,
    requestServiceWorkerDailyCheck,
    translateNow,
    showInAppToast,
    windowObj,
    documentObj,
  };
};
