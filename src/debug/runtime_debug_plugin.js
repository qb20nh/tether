import { mountLocalDebugPanel } from './local_debug_panel.js';

const DEBUG_SW_MESSAGE_TYPES = Object.freeze({
  TRIGGER_NOTIFICATION: 'SW_DEBUG_TRIGGER_NOTIFICATION',
  CLEAR_NOTIFICATIONS: 'SW_DEBUG_CLEAR_NOTIFICATIONS',
  RUN_DAILY_CHECK: 'SW_RUN_DAILY_CHECK',
});

export const mountDebugRuntimePlugin = (host = {}) => {
  const canUseServiceWorker = typeof host.canUseServiceWorker === 'function'
    ? host.canUseServiceWorker
    : () => false;
  const postMessageToServiceWorker = typeof host.postMessageToServiceWorker === 'function'
    ? host.postMessageToServiceWorker
    : async () => false;
  const requestNotificationPermission = typeof host.requestNotificationPermission === 'function'
    ? host.requestNotificationPermission
    : async () => 'unsupported';
  const showToast = typeof host.showToast === 'function'
    ? host.showToast
    : () => {};
  const fetchDailyPayload = typeof host.fetchDailyPayload === 'function'
    ? host.fetchDailyPayload
    : async () => null;
  const readDailyDebugSnapshot = typeof host.readDailyDebugSnapshot === 'function'
    ? host.readDailyDebugSnapshot
    : () => null;
  const toggleForceDailyFrozenState = typeof host.toggleForceDailyFrozenState === 'function'
    ? host.toggleForceDailyFrozenState
    : () => null;
  const reloadApp = typeof host.reloadApp === 'function'
    ? host.reloadApp
    : () => window.location.reload();

  const triggerSystemNotification = async ({ kind = 'unsolved-warning' } = {}) => {
    if (!canUseServiceWorker()) return false;
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') return false;
    return postMessageToServiceWorker({
      type: DEBUG_SW_MESSAGE_TYPES.TRIGGER_NOTIFICATION,
      payload: {
        kind,
      },
    }, { queueWhenUnavailable: true });
  };

  const clearNotifications = async () => {
    if (!canUseServiceWorker()) return false;
    return postMessageToServiceWorker({
      type: DEBUG_SW_MESSAGE_TYPES.CLEAR_NOTIFICATIONS,
    }, { queueWhenUnavailable: true });
  };

  const runDailyCheck = async () => {
    if (!canUseServiceWorker()) return false;
    return postMessageToServiceWorker({
      type: DEBUG_SW_MESSAGE_TYPES.RUN_DAILY_CHECK,
    }, { queueWhenUnavailable: true });
  };

  mountLocalDebugPanel({
    requestNotificationPermission,
    showToast,
    triggerSystemNotification,
    clearNotifications,
    fetchDailyPayload,
    runDailyCheck,
    readDailyDebugSnapshot,
    toggleForceDailyFrozenState,
    reloadApp,
  });
};
