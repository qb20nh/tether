import assert from 'node:assert/strict';
import test from 'node:test';
import { createSwMessenger } from '../../src/app/sw_messenger.js';

const createWindowMock = () => ({
  isSecureContext: true,
  Notification: {},
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
});

const createNavigatorMock = () => {
  const listeners = new Map();
  const serviceWorker = {
    controller: null,
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
  };
  return {
    navigatorObj: { serviceWorker },
    emit(event, payload) {
      const handlers = listeners.get(event) || [];
      for (const handler of handlers) {
        handler(payload);
      }
    },
  };
};

test('postMessage queues and flushes pending messages when target becomes available', async () => {
  const { navigatorObj } = createNavigatorMock();
  const messenger = createSwMessenger({
    windowObj: createWindowMock(),
    navigatorObj,
  });

  const payload = { type: 'TEST_MESSAGE', payload: { x: 1 } };
  const queued = await messenger.postMessage(payload, { queueWhenUnavailable: true });
  assert.equal(queued, false);

  const posted = [];
  const target = {
    postMessage(message) {
      posted.push(message);
    },
  };
  messenger.setRegistration({
    active: target,
    waiting: null,
    installing: null,
  });

  await messenger.flushPendingMessages();
  assert.deepEqual(posted, [payload]);
});

test('postMessageWithReply returns response payload from message target', async () => {
  const { navigatorObj } = createNavigatorMock();
  const messenger = createSwMessenger({
    windowObj: createWindowMock(),
    navigatorObj,
    messageChannelFactory: () => {
      const channel = {
        port1: {
          onmessage: null,
          close() { },
        },
        port2: {
          close() { },
          dispatch(data) {
            if (typeof channel.port1.onmessage === 'function') {
              channel.port1.onmessage({ data });
            }
          },
        },
      };
      return channel;
    },
  });

  messenger.setRegistration({
    active: {
      postMessage(message, ports) {
        ports[0].dispatch({ ok: true, received: message.type });
      },
    },
    waiting: null,
    installing: null,
  });

  const reply = await messenger.postMessageWithReply({ type: 'PING' });
  assert.deepEqual(reply, { ok: true, received: 'PING' });
});

test('postMessageWithReply returns null on timeout/failure', async () => {
  const { navigatorObj } = createNavigatorMock();
  const messenger = createSwMessenger({
    windowObj: {
      isSecureContext: true,
      Notification: {},
      setTimeout(fn) {
        fn();
        return 1;
      },
      clearTimeout() { },
    },
    navigatorObj,
    messageChannelFactory: () => ({
      port1: {
        onmessage: null,
        close() { },
      },
      port2: {
        close() { },
      },
    }),
  });

  messenger.setRegistration({
    active: {
      postMessage() { },
    },
    waiting: null,
    installing: null,
  });

  const reply = await messenger.postMessageWithReply({ type: 'PING' }, { timeoutMs: 10 });
  assert.equal(reply, null);
});

test('bindHistoryUpdates handles only matching type and binds once', () => {
  const harness = createNavigatorMock();
  const payloads = [];
  const messenger = createSwMessenger({
    windowObj: createWindowMock(),
    navigatorObj: harness.navigatorObj,
  });

  const firstBind = messenger.bindHistoryUpdates({
    historyMessageType: 'SW_NOTIFICATION_HISTORY',
    onPayload: (payload) => payloads.push(payload),
  });
  const secondBind = messenger.bindHistoryUpdates({
    historyMessageType: 'SW_NOTIFICATION_HISTORY',
    onPayload: (payload) => payloads.push(payload),
  });

  harness.emit('message', { data: { type: 'OTHER', payload: { id: 0 } } });
  harness.emit('message', { data: { type: 'SW_NOTIFICATION_HISTORY', payload: { id: 1 } } });

  assert.equal(firstBind, true);
  assert.equal(secondBind, false);
  assert.deepEqual(payloads, [{ id: 1 }]);
});
