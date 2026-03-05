import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwUpdateOrchestrator } from '../../src/app/sw_update_orchestrator.js';

const SW_MESSAGE_TYPES = Object.freeze({
  SYNC_DAILY_STATE: 'SW_SYNC_DAILY_STATE',
  SYNC_UPDATE_POLICY: 'SW_SYNC_UPDATE_POLICY',
  GET_UPDATE_POLICY: 'SW_GET_UPDATE_POLICY',
  RUN_DAILY_CHECK: 'SW_RUN_DAILY_CHECK',
  GET_HISTORY: 'SW_GET_NOTIFICATION_HISTORY',
  APPEND_SYSTEM_HISTORY: 'SW_APPEND_SYSTEM_HISTORY',
  CLEAR_UPDATE_HISTORY_ACTIONS: 'SW_CLEAR_UPDATE_HISTORY_ACTIONS',
  HISTORY_UPDATE: 'SW_NOTIFICATION_HISTORY',
});

const UPDATE_APPLY_STATUS = Object.freeze({
  APPLIED: 'applied',
  UNAVAILABLE: 'unavailable',
  ALREADY_PROMPTED: 'already-prompted',
  UPDATE_FAILED: 'update-failed',
  NO_WAITING: 'no-waiting',
});

const UPDATE_CHECK_DECISION = Object.freeze({
  APPLY: 'apply',
  NOTIFY: 'notify',
});

const createWindowMock = () => ({
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  location: {
    reload() { },
  },
  addEventListener() { },
});

const createDocumentMock = () => ({
  visibilityState: 'visible',
  addEventListener() { },
});

const createNavigatorMock = () => ({
  onLine: true,
  serviceWorker: {
    register: async () => null,
    ready: Promise.resolve(null),
    addEventListener() { },
  },
});

const createMessengerStub = (overrides = {}) => {
  let registration = overrides.registration || null;
  const postedMessages = [];
  const postReply = overrides.postReply || (async () => null);
  const flushCalls = [];
  return {
    postedMessages,
    flushCalls,
    messenger: {
      canUseServiceWorker: () => true,
      supportsNotifications: () => true,
      getRegistration: () => registration,
      setRegistration(nextRegistration) {
        registration = nextRegistration || null;
      },
      postMessage: async (message, options = {}) => {
        postedMessages.push({ message, options });
        return true;
      },
      postMessageWithReply: (...args) => postReply(...args),
      resolveUpdatePolicyTargets: () => overrides.policyTargets || [],
      flushPendingMessages: async () => {
        flushCalls.push(true);
      },
      bindHistoryUpdates: () => true,
    },
  };
};

const createResponse = ({ ok = true, json = null, text = '' } = {}) => ({
  ok,
  async json() {
    return json;
  },
  async text() {
    return text;
  },
});

const createOrchestrator = ({
  messenger,
  navigatorObj = createNavigatorMock(),
  windowObj = createWindowMock(),
  documentObj = createDocumentMock(),
  fetchImpl = async () => createResponse({ ok: false }),
  readAutoUpdateEnabledPreference = () => false,
  shouldResyncManualUpdatePolicy = () => false,
  setUpdateProgressOverlayActive = () => { },
  showInAppToast = () => { },
  readNotificationEnabledPreference = () => false,
  notificationPermission = 'default',
  now = () => Date.now(),
  updateApplyReloadFallbackMs = 25,
} = {}) => createSwUpdateOrchestrator({
  swMessenger: messenger,
  swMessageTypes: SW_MESSAGE_TYPES,
  updateApplyStatus: UPDATE_APPLY_STATUS,
  updateCheckDecision: UPDATE_CHECK_DECISION,
  localBuildNumber: 100,
  versionUrl: 'https://example.com/version.json',
  swBuildNumberRe: /BUILD_NUMBER\s*=\s*Number\.parseInt\(\s*['"](\d+)['"]\s*,\s*10\)/,
  resolveServiceWorkerRegistrationUrl: () => new URL('https://example.com/sw.js'),
  isLocalhostHostname: () => false,
  readAutoUpdateEnabledPreference,
  readNotificationEnabledPreference,
  readLastNotifiedRemoteBuildNumber: () => null,
  writeLastNotifiedRemoteBuildNumber: () => { },
  buildNotificationTextPayload: () => ({ newLevelTitle: 'new', newLevelBody: 'body' }),
  getLatestDailyState: () => ({
    dailyId: '2026-03-06',
    hardInvalidateAtUtcMs: 1000,
    dailySolvedDate: null,
  }),
  resolveUpdateCheckDecision: ({ autoUpdateEnabled }) => (
    autoUpdateEnabled
      ? UPDATE_CHECK_DECISION.APPLY
      : UPDATE_CHECK_DECISION.NOTIFY
  ),
  shouldResyncManualUpdatePolicy,
  showInAppToast,
  resolveNewVersionToastText: () => 'A new version is available.',
  resolveNewVersionTitleText: () => 'New version available',
  resolveNewVersionBodyText: () => 'Tap to update to the latest version.',
  resolveUpdateApplyFailureToastText: () => 'Could not apply update yet. Try again shortly.',
  setUpdateProgressOverlayActive,
  updateCheckThrottleMs: 5 * 60 * 1000,
  updateApplyReloadFallbackMs,
  dailyCheckTag: 'tether-daily-check',
  dailyNotificationWarningHours: 8,
  waitingWorkerTimeoutFirstMs: 20,
  waitingWorkerTimeoutRetryMs: 20,
  fetchImpl,
  windowObj,
  documentObj,
  navigatorObj,
  notificationApi: { permission: notificationPermission },
  now,
});

test('checkForNewBuild performs NOTIFY path when auto-update is disabled', async () => {
  const messengerHarness = createMessengerStub({ registration: {} });
  let toastCount = 0;
  const orchestrator = createOrchestrator({
    messenger: messengerHarness.messenger,
    readAutoUpdateEnabledPreference: () => false,
    showInAppToast: () => { toastCount += 1; },
    fetchImpl: async (url) => {
      if (url === 'https://example.com/version.json') {
        return createResponse({ json: { buildNumber: '101' } });
      }
      return createResponse({ text: 'const BUILD_NUMBER = Number.parseInt(\'101\', 10);' });
    },
  });

  await orchestrator.checkForNewBuild({ force: true });

  const historyPosts = messengerHarness.postedMessages.filter(
    ({ message }) => message.type === SW_MESSAGE_TYPES.APPEND_SYSTEM_HISTORY,
  );
  assert.equal(toastCount, 1);
  assert.equal(historyPosts.length, 1);
});

test('checkForNewBuild performs APPLY path when auto-update is enabled', async () => {
  const waitingWorkerMessages = [];
  const waitingWorker = {
    state: 'installed',
    addEventListener() { },
    removeEventListener() { },
    postMessage(message) {
      waitingWorkerMessages.push(message);
    },
  };
  const registration = {
    waiting: waitingWorker,
    installing: null,
    active: null,
    async update() { },
    addEventListener() { },
    removeEventListener() { },
  };
  const messengerHarness = createMessengerStub({ registration });

  const orchestrator = createOrchestrator({
    messenger: messengerHarness.messenger,
    readAutoUpdateEnabledPreference: () => true,
    fetchImpl: async (url) => {
      if (url === 'https://example.com/version.json') {
        return createResponse({ json: { buildNumber: '101' } });
      }
      return createResponse({ text: 'const BUILD_NUMBER = Number.parseInt(\'101\', 10);' });
    },
  });

  await orchestrator.checkForNewBuild({ force: true });

  assert.equal(waitingWorkerMessages.length, 1);
  assert.equal(waitingWorkerMessages[0].type, 'SW_SKIP_WAITING');
});

test('ensureServiceWorkerUpdatePolicyConsistency resyncs only when policy drift is detected', async () => {
  const target = { postMessage() { } };
  const messengerHarness = createMessengerStub({
    registration: {},
    policyTargets: [target],
    postReply: async () => ({
      ok: true,
      autoUpdateEnabled: true,
      pinnedBuildNumber: 100,
      servingBuildNumber: 100,
      swBuildNumber: 100,
      pinnedCacheUsable: true,
    }),
  });

  const orchestrator = createOrchestrator({
    messenger: messengerHarness.messenger,
    readAutoUpdateEnabledPreference: () => false,
    shouldResyncManualUpdatePolicy: ({ swPolicy }) => swPolicy?.autoUpdateEnabled === true,
  });

  await orchestrator.ensureServiceWorkerUpdatePolicyConsistency();

  const policyPosts = messengerHarness.postedMessages.filter(
    ({ message }) => message.type === SW_MESSAGE_TYPES.SYNC_UPDATE_POLICY,
  );
  assert.equal(policyPosts.length, 1);
});

test('registerServiceWorker runs sync flow and requests history', async () => {
  const registration = {
    waiting: null,
    installing: null,
    active: null,
    sync: {
      async register() { },
    },
    periodicSync: {
      async register() { },
    },
    async update() { },
    addEventListener() { },
    removeEventListener() { },
  };
  const navigatorObj = createNavigatorMock();
  navigatorObj.serviceWorker.register = async () => registration;
  navigatorObj.serviceWorker.ready = Promise.resolve(registration);

  const messengerHarness = createMessengerStub();
  const orchestrator = createOrchestrator({
    messenger: messengerHarness.messenger,
    navigatorObj,
    readNotificationEnabledPreference: () => true,
    notificationPermission: 'granted',
    fetchImpl: async () => createResponse({ ok: false }),
  });

  const out = await orchestrator.registerServiceWorker();
  assert.equal(out, registration);
  assert.equal(messengerHarness.flushCalls.length, 1);

  const types = messengerHarness.postedMessages.map(({ message }) => message.type);
  assert.equal(types.includes(SW_MESSAGE_TYPES.SYNC_DAILY_STATE), true);
  assert.equal(types.includes(SW_MESSAGE_TYPES.SYNC_UPDATE_POLICY), true);
  assert.equal(types.includes(SW_MESSAGE_TYPES.RUN_DAILY_CHECK), true);
  assert.equal(types.includes(SW_MESSAGE_TYPES.GET_HISTORY), true);
});

test('applyUpdateForBuild returns UNAVAILABLE when build is not applicable', async () => {
  const messengerHarness = createMessengerStub({ registration: null });
  const orchestrator = createOrchestrator({
    messenger: messengerHarness.messenger,
  });

  const result = await orchestrator.applyUpdateForBuild(100);
  assert.equal(result.applied, false);
  assert.equal(result.status, UPDATE_APPLY_STATUS.UNAVAILABLE);
});

test('applyUpdateForBuild returns NO_WAITING when no waiting worker is found', async () => {
  const registration = {
    waiting: null,
    installing: null,
    active: null,
    async update() { },
    addEventListener() { },
    removeEventListener() { },
  };
  const messengerHarness = createMessengerStub({ registration });
  const overlayCalls = [];
  const orchestrator = createOrchestrator({
    messenger: messengerHarness.messenger,
    setUpdateProgressOverlayActive: (value) => overlayCalls.push(value),
    windowObj: {
      ...createWindowMock(),
      setTimeout(fn) {
        fn();
        return 1;
      },
      clearTimeout() { },
    },
  });

  const result = await orchestrator.applyUpdateForBuild(101, { force: true });
  assert.equal(result.applied, false);
  assert.equal(result.status, UPDATE_APPLY_STATUS.NO_WAITING);
  assert.deepEqual(overlayCalls, [true, false]);
});
