export function createSwMessenger(options = {}) {
  const {
    windowObj = typeof window === 'undefined' ? undefined : window,
    navigatorObj = typeof navigator === 'undefined' ? undefined : navigator,
    messageChannelFactory = () => (
      typeof MessageChannel === 'function'
        ? new MessageChannel()
        : null
    ),
  } = options;

  let registration = null;
  const pendingMessages = [];
  let historyListenerBound = false;

  const canUseServiceWorker = () =>
    windowObj !== undefined
    && windowObj?.isSecureContext
    && navigatorObj !== undefined
    && 'serviceWorker' in navigatorObj;

  const supportsNotifications = () =>
    windowObj !== undefined
    && 'Notification' in windowObj;

  const getRegistration = () => registration;

  const setRegistration = (nextRegistration) => {
    registration = nextRegistration || null;
  };

  const resolveMessageTarget = () => {
    if (!canUseServiceWorker()) return null;
    if (navigatorObj.serviceWorker.controller) {
      return navigatorObj.serviceWorker.controller;
    }
    if (!registration) return null;
    return registration.active || registration.waiting || registration.installing || null;
  };

  const resolveUpdatePolicyTargets = () => {
    if (!canUseServiceWorker()) return [];
    const ordered = [];
    const pushUnique = (target) => {
      if (!target) return;
      if (ordered.includes(target)) return;
      ordered.push(target);
    };

    if (registration) {
      pushUnique(registration.waiting);
      pushUnique(registration.active);
    }
    pushUnique(navigatorObj.serviceWorker.controller);
    if (registration) {
      pushUnique(registration.installing);
    }
    return ordered;
  };

  const postMessage = async (message, options = {}) => {
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

  const postMessageWithReply = async (message, options = {}) => {
    const {
      timeoutMs = 1500,
      target = null,
    } = options;

    if (!canUseServiceWorker()) return null;
    const messageTarget = target || resolveMessageTarget();
    if (!messageTarget) return null;

    const channel = messageChannelFactory();
    if (!channel?.port1 || !channel?.port2) return null;

    return new Promise((resolve) => {
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

      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const timer = windowObj.setTimeout(() => {
        finish(null);
      }, Math.max(250, Number(timeoutMs) || 1500));

      channel.port1.onmessage = (event) => {
        windowObj.clearTimeout(timer);
        finish(event?.data ?? null);
      };

      try {
        messageTarget.postMessage(message, [channel.port2]);
      } catch {
        windowObj.clearTimeout(timer);
        finish(null);
      }
    });
  };

  const flushPendingMessages = async () => {
    if (!canUseServiceWorker() || pendingMessages.length === 0) return;
    while (pendingMessages.length > 0) {
      const next = pendingMessages.shift();
      const posted = await postMessage(next, { queueWhenUnavailable: false });
      if (posted) continue;
      pendingMessages.unshift(next);
      break;
    }
  };

  const bindHistoryUpdates = ({ historyMessageType, onPayload }) => {
    if (!canUseServiceWorker()) return false;
    if (historyListenerBound) return false;
    if (typeof onPayload !== 'function') return false;

    navigatorObj.serviceWorker.addEventListener('message', (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== historyMessageType) return;
      onPayload(data.payload);
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
