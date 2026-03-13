import type {
  RuntimeData,
  ServiceWorkerMessage,
  ServiceWorkerMessageOptions,
} from '../contracts/ports.ts';

interface MessageTargetLike {
  postMessage: (message: unknown, ports?: unknown[]) => void;
}

interface MessageEventLike {
  data?: unknown;
}

interface MessagePortLike {
  onmessage?: ((event?: MessageEventLike) => void) | null;
  close: () => void;
}

interface MessageChannelLike {
  port1: MessagePortLike;
  port2: MessagePortLike;
}

interface ServiceWorkerControllerLike {
  controller?: MessageTargetLike | null;
  addEventListener: (type: string, handler: (event?: MessageEventLike) => void) => void;
}

interface ServiceWorkerRegistrationLike {
  active?: MessageTargetLike | null;
  waiting?: MessageTargetLike | null;
  installing?: (MessageTargetLike & {
    state?: string;
    addEventListener?: (type: string, handler: () => void) => void;
    removeEventListener?: (type: string, handler: () => void) => void;
  }) | null;
}

interface SwMessengerWindowLike {
  isSecureContext?: boolean;
  Notification?: unknown;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

interface SwMessengerNavigatorLike {
  serviceWorker?: ServiceWorkerControllerLike;
}

interface PostMessageWithReplyOptions {
  timeoutMs?: number;
  target?: MessageTargetLike | null;
}

interface BindHistoryUpdatesOptions {
  historyMessageType: string;
  onPayload: (payload: unknown) => void;
}

export interface SwMessenger {
  canUseServiceWorker: () => boolean;
  supportsNotifications: () => boolean;
  getRegistration: () => ServiceWorkerRegistrationLike | null;
  setRegistration: (nextRegistration: ServiceWorkerRegistrationLike | null) => void;
  postMessage: (message: ServiceWorkerMessage, options?: ServiceWorkerMessageOptions) => Promise<boolean>;
  postMessageWithReply: (
    message: ServiceWorkerMessage,
    options?: PostMessageWithReplyOptions,
  ) => Promise<RuntimeData | null>;
  flushPendingMessages: () => Promise<void>;
  resolveUpdatePolicyTargets: () => MessageTargetLike[];
  bindHistoryUpdates: (options: BindHistoryUpdatesOptions) => boolean;
}

interface SwMessengerOptions {
  windowObj?: SwMessengerWindowLike | undefined;
  navigatorObj?: SwMessengerNavigatorLike | undefined;
  messageChannelFactory?: () => MessageChannelLike | null;
}

export function createSwMessenger(options: SwMessengerOptions = {}): SwMessenger {
  const {
    windowObj = typeof window === 'undefined' ? undefined : window as unknown as SwMessengerWindowLike,
    navigatorObj = typeof navigator === 'undefined' ? undefined : navigator as unknown as SwMessengerNavigatorLike,
    messageChannelFactory = () => (
      typeof MessageChannel === 'function'
        ? new MessageChannel()
        : null
    ),
  } = options;

  let registration: ServiceWorkerRegistrationLike | null = null;
  const pendingMessages: ServiceWorkerMessage[] = [];
  let historyListenerBound = false;

  const canUseServiceWorker = (): boolean => Boolean(
    windowObj !== undefined
    && windowObj.isSecureContext
    && navigatorObj !== undefined
    && 'serviceWorker' in navigatorObj
  );

  const supportsNotifications = (): boolean =>
    Boolean(windowObj !== undefined && 'Notification' in windowObj);

  const getRegistration = () => registration;

  const setRegistration = (nextRegistration: ServiceWorkerRegistrationLike | null): void => {
    registration = nextRegistration || null;
  };

  const resolveMessageTarget = (): MessageTargetLike | null => {
    const serviceWorker = navigatorObj?.serviceWorker;
    if (!canUseServiceWorker()) return null;
    if (serviceWorker?.controller) {
      return serviceWorker.controller;
    }
    if (!registration) return null;
    return registration.active || registration.waiting || registration.installing || null;
  };

  const resolveUpdatePolicyTargets = (): MessageTargetLike[] => {
    const serviceWorker = navigatorObj?.serviceWorker;
    if (!canUseServiceWorker()) return [];
    const ordered: MessageTargetLike[] = [];
    const pushUnique = (target: MessageTargetLike | null | undefined): void => {
      if (!target) return;
      if (ordered.includes(target)) return;
      ordered.push(target);
    };

    if (registration) {
      pushUnique(registration.waiting);
      pushUnique(registration.active);
    }
    pushUnique(serviceWorker?.controller);
    if (registration) {
      pushUnique(registration.installing);
    }
    return ordered;
  };

  const postMessage = async (
    message: ServiceWorkerMessage,
    options: ServiceWorkerMessageOptions = {},
  ): Promise<boolean> => {
    const { queueWhenUnavailable = false } = options;
    if (!canUseServiceWorker()) return false;
    const target = resolveMessageTarget();
    if (target) {
      target.postMessage(message);
      return true;
    }
    if (!registration) {
      if (queueWhenUnavailable) pendingMessages.push(message);
      return false;
    }
    if (queueWhenUnavailable) {
      pendingMessages.push(message);
    }
    return false;
  };

  const postMessageWithReply = async (
    message: ServiceWorkerMessage,
    options: PostMessageWithReplyOptions = {},
  ): Promise<RuntimeData | null> => {
    const {
      timeoutMs = 1500,
      target = null,
    } = options;

    if (!canUseServiceWorker()) return null;
    const messageTarget = target || resolveMessageTarget();
    if (!messageTarget) return null;

    const channel = messageChannelFactory();
    if (!channel?.port1 || !channel?.port2) return null;
    if (!windowObj) return null;

    return new Promise<RuntimeData | null>((resolve) => {
      let settled = false;

      const cleanup = () => {
        channel.port1.onmessage = null;
        try {
          channel.port1.close();
        } catch {
          // no-op
        }
        try {
          channel.port2.close();
        } catch {
          // no-op
        }
      };

      const finish = (value: RuntimeData | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const timer = windowObj.setTimeout(() => {
        finish(null);
      }, Math.max(250, Number(timeoutMs) || 1500));

      channel.port1.onmessage = (event?: MessageEventLike) => {
        windowObj.clearTimeout(timer);
        finish((event?.data as RuntimeData | null | undefined) ?? null);
      };

      try {
        messageTarget.postMessage(message, [channel.port2]);
      } catch {
        windowObj.clearTimeout(timer);
        finish(null);
      }
    });
  };

  const flushPendingMessages = async (): Promise<void> => {
    if (!canUseServiceWorker() || pendingMessages.length === 0) return;
    while (pendingMessages.length > 0) {
      const next = pendingMessages.shift();
      if (!next) break;
      const posted = await postMessage(next, { queueWhenUnavailable: false });
      if (posted) continue;
      pendingMessages.unshift(next);
      break;
    }
  };

  const bindHistoryUpdates = ({ historyMessageType, onPayload }: BindHistoryUpdatesOptions): boolean => {
    const serviceWorker = navigatorObj?.serviceWorker;
    if (!canUseServiceWorker()) return false;
    if (historyListenerBound) return false;
    if (typeof onPayload !== 'function') return false;
    if (!serviceWorker) return false;

    serviceWorker.addEventListener('message', (event?: MessageEventLike) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      const payload = data as { type?: string; payload?: unknown };
      if (payload.type !== historyMessageType) return;
      onPayload(payload.payload);
    });

    historyListenerBound = true;
    return true;
  };

  return {
    canUseServiceWorker,
    supportsNotifications,
    getRegistration,
    setRegistration,
    postMessage,
    postMessageWithReply,
    flushPendingMessages,
    resolveUpdatePolicyTargets,
    bindHistoryUpdates,
  };
}
