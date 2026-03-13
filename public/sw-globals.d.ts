declare function importScripts(...urls: string[]): void;

interface TetherSwPluginMessageContext {
  event: ExtendableMessageEvent;
  data: Record<string, unknown>;
  payload: Record<string, unknown>;
  api: Record<string, unknown>;
}

interface TetherSwPluginApi extends Record<string, unknown> {}

interface TetherSwPluginHandlerMap {
  [messageType: string]: (context: TetherSwPluginMessageContext) => unknown;
}

interface TetherPeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string;
}

interface TetherNotificationClickEvent extends ExtendableEvent {
  readonly notification: Notification;
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis & {
  __tetherRegisterSwPlugin?: (messageHandlers: TetherSwPluginHandlerMap) => void;
  __tetherSwPluginApi?: TetherSwPluginApi;
};
