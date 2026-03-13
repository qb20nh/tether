import type {
  DocumentLike,
  NavigatorLike,
  NotificationPermissionState,
  ServiceWorkerMessage,
  WindowLike,
} from '../contracts/ports.ts';

interface LatestDailyStateLike {
  dailyId: string | null;
  hardInvalidateAtUtcMs: number | null;
  dailySolvedDate: string | null;
}

export interface NormalizedSwUpdateOptions {
  swMessageTypes: Record<string, string> | undefined;
  updateApplyStatus: Record<string, string> | undefined;
  updateCheckDecision: Record<string, string> | undefined;
  localBuildNumber: number;
  versionUrl: string;
  swBuildNumberRe: RegExp | null;
  resolveServiceWorkerRegistrationUrl?: ((isLocalhostHostname?: (hostname: string) => boolean) => URL) | undefined;
  isLocalhostHostname?: ((hostname: string) => boolean) | undefined;
  readAutoUpdateEnabledPreference: () => boolean;
  readNotificationEnabledPreference: () => boolean;
  readLastNotifiedRemoteBuildNumber: () => number | null;
  writeLastNotifiedRemoteBuildNumber: (buildNumber: number) => void;
  buildNotificationTextPayload: () => Record<string, unknown>;
  getLatestDailyState: () => LatestDailyStateLike;
  resolveUpdateCheckDecision: (payload: Record<string, unknown>) => string | null;
  shouldResyncManualUpdatePolicy: (payload: Record<string, unknown>) => boolean;
  showInAppToast: (payload?: Record<string, unknown>) => void;
  resolveNewVersionToastText: () => string;
  resolveNewVersionTitleText: () => string;
  resolveNewVersionBodyText: () => string;
  resolveUpdateApplyFailureToastText: () => string;
  setUpdateProgressOverlayActive: (active: boolean) => void;
  updateCheckThrottleMs: number;
  updateApplyReloadFallbackMs: number;
  dailyCheckTag: string;
  dailyNotificationWarningHours: number;
  waitingWorkerTimeoutFirstMs: number;
  waitingWorkerTimeoutRetryMs: number;
  fetchImpl: typeof fetch | null;
  windowObj: (WindowLike & {
    location?: { href?: string; hostname?: string; reload?: () => void };
    Notification?: unknown;
    isSecureContext?: boolean;
    setTimeout?: (handler: () => void, timeout?: number) => unknown;
    clearTimeout?: (id: unknown) => void;
  }) | undefined;
  documentObj: (DocumentLike & { visibilityState?: string }) | undefined;
  navigatorObj: (NavigatorLike & { serviceWorker?: unknown }) | undefined;
  notificationApi: { permission?: NotificationPermissionState } | undefined;
  now: () => number;
}

interface SwUpdateOptionsInput extends Record<string, unknown> {
  swMessageTypes?: Record<string, string>;
  updateApplyStatus?: Record<string, string>;
  updateCheckDecision?: Record<string, string>;
  localBuildNumber?: number;
  versionUrl?: string;
  swBuildNumberRe?: RegExp | null;
  resolveServiceWorkerRegistrationUrl?: (isLocalhostHostname?: (hostname: string) => boolean) => URL;
  isLocalhostHostname?: (hostname: string) => boolean;
  readAutoUpdateEnabledPreference?: () => boolean;
  readNotificationEnabledPreference?: () => boolean;
  readLastNotifiedRemoteBuildNumber?: () => number | null;
  writeLastNotifiedRemoteBuildNumber?: (buildNumber: number) => void;
  buildNotificationTextPayload?: () => Record<string, unknown>;
  getLatestDailyState?: () => LatestDailyStateLike;
  resolveUpdateCheckDecision?: (payload: Record<string, unknown>) => string | null;
  shouldResyncManualUpdatePolicy?: (payload: Record<string, unknown>) => boolean;
  showInAppToast?: (payload?: Record<string, unknown>) => void;
  resolveNewVersionToastText?: () => string;
  resolveNewVersionTitleText?: () => string;
  resolveNewVersionBodyText?: () => string;
  resolveUpdateApplyFailureToastText?: () => string;
  setUpdateProgressOverlayActive?: (active: boolean) => void;
  updateCheckThrottleMs?: number;
  updateApplyReloadFallbackMs?: number;
  dailyCheckTag?: string;
  dailyNotificationWarningHours?: number;
  waitingWorkerTimeoutFirstMs?: number;
  waitingWorkerTimeoutRetryMs?: number;
  fetchImpl?: typeof fetch | null;
  windowObj?: NormalizedSwUpdateOptions['windowObj'];
  documentObj?: NormalizedSwUpdateOptions['documentObj'];
  navigatorObj?: NormalizedSwUpdateOptions['navigatorObj'];
  notificationApi?: NormalizedSwUpdateOptions['notificationApi'];
  now?: () => number;
}

export const normalizeSwUpdateOptions = (
  options: SwUpdateOptionsInput = {},
): NormalizedSwUpdateOptions => {
  const {
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
    windowObj = typeof window === 'undefined'
      ? undefined
      : window as unknown as NormalizedSwUpdateOptions['windowObj'],
    documentObj = typeof document === 'undefined'
      ? undefined
      : document as unknown as NormalizedSwUpdateOptions['documentObj'],
    navigatorObj = typeof navigator === 'undefined'
      ? undefined
      : navigator as unknown as NormalizedSwUpdateOptions['navigatorObj'],
    notificationApi = typeof Notification === 'undefined'
      ? undefined
      : Notification as unknown as NormalizedSwUpdateOptions['notificationApi'],
    now = () => Date.now(),
  } = options;

  return {
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
  };
};
