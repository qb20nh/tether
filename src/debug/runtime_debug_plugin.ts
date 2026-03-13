import { mountLocalDebugPanel } from './local_debug_panel.ts';

const DEBUG_SW_MESSAGE_TYPES = Object.freeze({
  TRIGGER_NOTIFICATION: 'SW_DEBUG_TRIGGER_NOTIFICATION',
  CLEAR_NOTIFICATIONS: 'SW_DEBUG_CLEAR_NOTIFICATIONS',
  RUN_DAILY_CHECK: 'SW_RUN_DAILY_CHECK',
} as const);

interface RuntimeDebugHost {
  canUseServiceWorker?: () => boolean;
  postMessageToServiceWorker?: (message: Record<string, unknown>, options?: Record<string, unknown>) => Promise<boolean>;
  requestNotificationPermission?: () => Promise<string>;
  showToast?: (payload?: Record<string, unknown>) => void;
  fetchDailyPayload?: () => Promise<unknown>;
  readDailyDebugSnapshot?: () => unknown;
  toggleForceDailyFrozenState?: () => unknown;
  reloadApp?: () => void;
}

interface ResolvedRuntimeDebugHost {
  canUseServiceWorker: () => boolean;
  postMessageToServiceWorker: (message: Record<string, unknown>, options?: Record<string, unknown>) => Promise<boolean>;
  requestNotificationPermission: () => Promise<string>;
  showToast: (payload?: Record<string, unknown>) => void;
  fetchDailyPayload: () => Promise<unknown>;
  readDailyDebugSnapshot: () => unknown;
  toggleForceDailyFrozenState: () => unknown;
  reloadApp: () => void;
}

interface LocalDebugPanelOptions {
  requestNotificationPermission: () => Promise<string>;
  showToast: (payload?: Record<string, unknown>) => void;
  triggerSystemNotification: (options?: { kind?: string }) => Promise<boolean>;
  clearNotifications: () => Promise<boolean>;
  fetchDailyPayload: () => Promise<unknown>;
  runDailyCheck: () => Promise<boolean>;
  readDailyDebugSnapshot: () => unknown;
  toggleForceDailyFrozenState: () => unknown;
  reloadApp: () => void;
}

const mountLocalDebugPanelTyped = mountLocalDebugPanel as unknown as (options: LocalDebugPanelOptions) => void;

const resolveFunction = <T extends (...args: never[]) => unknown>(value: unknown, fallback: T): T => (
  typeof value === 'function' ? value as T : fallback
);

const resolveRuntimeDebugHost = (host: RuntimeDebugHost = {}): ResolvedRuntimeDebugHost => ({
  canUseServiceWorker: resolveFunction(host.canUseServiceWorker, () => false),
  postMessageToServiceWorker: resolveFunction(host.postMessageToServiceWorker, async () => false),
  requestNotificationPermission: resolveFunction(host.requestNotificationPermission, async () => 'unsupported'),
  showToast: resolveFunction(host.showToast, () => {}),
  fetchDailyPayload: resolveFunction(host.fetchDailyPayload, async () => null),
  readDailyDebugSnapshot: resolveFunction(host.readDailyDebugSnapshot, () => null),
  toggleForceDailyFrozenState: resolveFunction(host.toggleForceDailyFrozenState, () => null),
  reloadApp: resolveFunction(host.reloadApp, () => window.location.reload()),
});

export const mountDebugRuntimePlugin = (host: RuntimeDebugHost = {}): void => {
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

  const triggerSystemNotification = async ({ kind = 'unsolved-warning' }: { kind?: string } = {}): Promise<boolean> => {
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

  const clearNotifications = async (): Promise<boolean> => {
    if (!canUseServiceWorker()) return false;
    return postMessageToServiceWorker({
      type: DEBUG_SW_MESSAGE_TYPES.CLEAR_NOTIFICATIONS,
    }, { queueWhenUnavailable: true });
  };

  const runDailyCheck = async (): Promise<boolean> => {
    if (!canUseServiceWorker()) return false;
    return postMessageToServiceWorker({
      type: DEBUG_SW_MESSAGE_TYPES.RUN_DAILY_CHECK,
    }, { queueWhenUnavailable: true });
  };

  mountLocalDebugPanelTyped({
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
