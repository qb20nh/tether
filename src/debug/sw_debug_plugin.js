(() => {
  const registerPlugin = self.__tetherRegisterSwPlugin;
  const swApi = self.__tetherSwPluginApi;
  if (typeof registerPlugin !== 'function' || !swApi) return;

  registerPlugin({
    SW_DEBUG_TRIGGER_NOTIFICATION: async ({ payload = {} } = {}) => {
      if (!swApi.isLocalhostHostname(self.location.hostname)) return false;
      if (!self.registration || typeof self.registration.showNotification !== 'function') return false;
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
