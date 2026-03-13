(() => {
  interface SwDebugDailyState {
    dailyId: string | null;
    newLevelDailyId?: string | null;
    warnedDailyId?: string | null;
  }

  interface SwDebugApi {
    isLocalhostHostname: (hostname: string) => boolean;
    normalizeString: (value: unknown, fallback: string) => string;
    normalizeSystemNotificationKind: (kind: string) => string;
    readDailyState: () => Promise<SwDebugDailyState>;
    emitSystemNotification: (state: SwDebugDailyState, kind: string) => Promise<boolean>;
    writeDailyState: (state: SwDebugDailyState) => Promise<void>;
    closeVisibleNotifications: () => Promise<void>;
    clearHistoryEntries: () => Promise<void>;
  }

  interface SwDebugPluginGlobals {
    __tetherRegisterSwPlugin?: (
      plugins: Record<string, (payload?: { payload?: Record<string, unknown> }) => Promise<boolean>>,
    ) => void;
    __tetherSwPluginApi?: SwDebugApi;
    location: { hostname: string };
    registration?: { showNotification?: (...args: unknown[]) => Promise<void> };
  }

  const swSelf = self as unknown as SwDebugPluginGlobals;
  const registerPlugin = swSelf.__tetherRegisterSwPlugin;
  const swApi = swSelf.__tetherSwPluginApi;
  if (typeof registerPlugin !== 'function' || !swApi) return;

  registerPlugin({
    SW_DEBUG_TRIGGER_NOTIFICATION: async ({ payload = {} } = {}) => {
      if (!swApi.isLocalhostHostname(swSelf.location.hostname)) return false;
      if (!swSelf.registration || typeof swSelf.registration.showNotification !== 'function') return false;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;

      const kindRaw = swApi.normalizeString(payload.kind, 'unsolved-warning');
      const kind = swApi.normalizeSystemNotificationKind(kindRaw);
      const state = await swApi.readDailyState();
      const notified = await swApi.emitSystemNotification(state, kind);
      if (!notified) return false;

      if (kind === 'new-level') {
        state.newLevelDailyId = state.dailyId;
      } else {
        state.warnedDailyId = state.dailyId;
      }
      await swApi.writeDailyState(state);
      return true;
    },
    SW_DEBUG_CLEAR_NOTIFICATIONS: async () => {
      if (!swApi.isLocalhostHostname(self.location.hostname)) return false;
      await swApi.closeVisibleNotifications();
      await swApi.clearHistoryEntries();
      return true;
    },
  });
})();

export {};
