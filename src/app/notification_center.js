import { createNotificationDialogController } from './notification_dialog_controller.js';
import { createNotificationHistoryController } from './notification_history_controller.js';
import { createNotificationToggleController } from './notification_toggle_controller.js';

export function createNotificationCenter(options = {}) {
  const {
    elementIds,
    swMessageTypes,
    localBuildNumber = 0,
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
    postMessageToServiceWorker = async () => false,
    clearAppliedUpdateHistoryActions = async () => { },
    translateNow = (key) => key,
    getLocale = () => 'en',
    showInAppToast = () => { },
    onApplyUpdateRequested = async () => { },
    onOpenDailyRequested = async () => { },
    isOpenDailyHistoryActionable = () => true,
    windowObj = typeof window === 'undefined' ? undefined : window,
    documentObj = typeof document === 'undefined' ? undefined : document,
  } = options;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationCenter requires elementIds');
  }
  if (!swMessageTypes || typeof swMessageTypes !== 'object') {
    throw new Error('createNotificationCenter requires swMessageTypes');
  }

  const dialogController = createNotificationDialogController({
    elementIds,
    translateNow,
    windowObj,
    documentObj,
  });

  const toggleController = createNotificationToggleController({
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
  });

  const historyController = createNotificationHistoryController({
    elementIds,
    swMessageTypes,
    postMessageToServiceWorker,
    translateNow,
    getLocale,
    onApplyUpdateRequested,
    onOpenDailyRequested,
    isOpenDailyHistoryActionable,
    requestUpdateApplyConfirmation: dialogController.requestUpdateApplyConfirmation,
    requestMoveDailyConfirmation: dialogController.requestMoveDailyConfirmation,
    containsOpenDialogTarget: dialogController.containsOpenDialogTarget,
    windowObj,
    documentObj,
  });

  return {
    bind() {
      if (!documentObj || !windowObj) return;
      toggleController.bind();
      historyController.bind();
      dialogController.bind();
    },
    refreshLocalizedUi() {
      historyController.refreshUi();
      dialogController.refreshLocalizedUi();
    },
    refreshToggleUi() {
      toggleController.refreshUi();
    },
    refreshHistoryUi: historyController.refreshUi,
    maybeAutoPromptForNotifications: toggleController.maybeAutoPromptForNotifications,
    handleStorageEvent: toggleController.handleStorageEvent,
    applyHistoryPayload: historyController.applyHistoryPayload,
    getHistoryEntries: historyController.getEntries,
    closeHistoryPanel: historyController.closePanel,
    requestNotificationPermission,
    clearAppliedUpdateHistoryActions: (appliedBuildNumber = localBuildNumber) =>
      clearAppliedUpdateHistoryActions(appliedBuildNumber),
  };
}
