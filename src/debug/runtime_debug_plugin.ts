// @ts-nocheck
import { mountLocalDebugPanel } from './local_debug_panel.ts';

const DEBUG_SW_MESSAGE_TYPES = Object.freeze({
  TRIGGER_NOTIFICATION: 'SW_DEBUG_TRIGGER_NOTIFICATION',
  CLEAR_NOTIFICATIONS: 'SW_DEBUG_CLEAR_NOTIFICATIONS',
  RUN_DAILY_CHECK: 'SW_RUN_DAILY_CHECK',
});

const resolveFunction = (value, fallback) => (
  typeof value === 'function' ? value : fallback
);

const resolveRuntimeDebugHost = (host = {}) => ({
  canUseServiceWorker: resolveFunction(host.canUseServiceWorker, () => false),
  postMessageToServiceWorker: resolveFunction(host.postMessageToServiceWorker, async () => false),
  requestNotificationPermission: resolveFunction(host.requestNotificationPermission, async () => 'unsupported'),
  showToast: resolveFunction(host.showToast, () => {}),
  fetchDailyPayload: resolveFunction(host.fetchDailyPayload, async () => null),
  readDailyDebugSnapshot: resolveFunction(host.readDailyDebugSnapshot, () => null),
  toggleForceDailyFrozenState: resolveFunction(host.toggleForceDailyFrozenState, () => null),
  reloadApp: resolveFunction(host.reloadApp, () => window.location.reload()),
});

export const mountDebugRuntimePlugin = (host = {}) => {
  const {
    canUseServiceWorker,
    postMessageToServiceWorker,
    requestNotificationPermission,
    showToast,
    fetchDailyPayload,
    readDailyDebugSnapshot,
    toggleForceDailyFrozenState,
    reloadApp,
  } = resolveRuntimeDebugHost(host);

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
