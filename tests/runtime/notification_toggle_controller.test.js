import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTIFICATION_AUTO_PROMPT_DECISIONS } from '../../src/app/notification_preferences.js';
import { createNotificationToggleController } from '../../src/app/notification_toggle_controller.js';
import { ELEMENT_IDS } from '../../src/config.js';
import {
  FakeElement,
  createDocumentMock,
  createWindowMock,
} from './notification_test_harness.js';

const NOTIFICATION_KEY = 'notification-enabled-key';
const AUTO_UPDATE_KEY = 'auto-update-key';

const createHarness = (overrides = {}) => {
  const documentObj = createDocumentMock();
  const windowObj = createWindowMock();

  const notificationsToggleEl = documentObj.register(ELEMENT_IDS.NOTIFICATIONS_TOGGLE, new FakeElement('input'));
  const autoUpdateToggleEl = documentObj.register(ELEMENT_IDS.AUTO_UPDATE_TOGGLE, new FakeElement('input'));

  const calls = {
    writeAutoPromptDecision: [],
    writeNotificationEnabledPreference: [],
    writeAutoUpdateEnabledPreference: [],
    syncDaily: 0,
    syncUpdate: 0,
    registerBackground: 0,
    requestDailyCheck: 0,
    showToast: [],
  };

  const controller = createNotificationToggleController({
    elementIds: ELEMENT_IDS,
    notificationEnabledKey: NOTIFICATION_KEY,
    autoUpdateEnabledKey: AUTO_UPDATE_KEY,
    notificationAutoPromptDecisions: NOTIFICATION_AUTO_PROMPT_DECISIONS,
    readAutoPromptDecision: overrides.readAutoPromptDecision || (() => NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET),
    writeAutoPromptDecision: overrides.writeAutoPromptDecision || ((value) => calls.writeAutoPromptDecision.push(value)),
    readNotificationEnabledPreference: overrides.readNotificationEnabledPreference || (() => true),
    writeNotificationEnabledPreference: overrides.writeNotificationEnabledPreference || ((value) => calls.writeNotificationEnabledPreference.push(value)),
    readAutoUpdateEnabledPreference: overrides.readAutoUpdateEnabledPreference || (() => false),
    writeAutoUpdateEnabledPreference: overrides.writeAutoUpdateEnabledPreference || ((value) => calls.writeAutoUpdateEnabledPreference.push(value)),
    hasStoredNotificationEnabledPreference: overrides.hasStoredNotificationEnabledPreference || (() => true),
    notificationPermissionState: overrides.notificationPermissionState || (() => 'granted'),
    supportsNotifications: overrides.supportsNotifications || (() => true),
    canUseServiceWorker: overrides.canUseServiceWorker || (() => true),
    requestNotificationPermission: overrides.requestNotificationPermission || (async () => 'granted'),
    syncDailyStateToServiceWorker: overrides.syncDailyStateToServiceWorker || (async () => { calls.syncDaily += 1; }),
    syncUpdatePolicyToServiceWorker: overrides.syncUpdatePolicyToServiceWorker || (async () => { calls.syncUpdate += 1; }),
    registerBackgroundDailyCheck: overrides.registerBackgroundDailyCheck || (async () => { calls.registerBackground += 1; }),
    requestServiceWorkerDailyCheck: overrides.requestServiceWorkerDailyCheck || (async () => { calls.requestDailyCheck += 1; }),
    translateNow: overrides.translateNow || ((key) => key),
    showInAppToast: overrides.showInAppToast || ((text, options) => { calls.showToast.push({ text, options }); }),
    windowObj,
    documentObj,
  });

  return {
    controller,
    windowObj,
    notificationsToggleEl,
    autoUpdateToggleEl,
    calls,
  };
};

test('toggle controller binds and reflects notification/auto-update preference state', () => {
  const { controller, notificationsToggleEl, autoUpdateToggleEl } = createHarness({
    readNotificationEnabledPreference: () => true,
    notificationPermissionState: () => 'unsupported',
    readAutoUpdateEnabledPreference: () => true,
  });

  controller.bind();

  assert.equal(notificationsToggleEl.checked, true);
  assert.equal(notificationsToggleEl.disabled, true);
  assert.equal(autoUpdateToggleEl.checked, true);
});

test('toggle controller persists auto-update changes and syncs policy', async () => {
  const { controller, autoUpdateToggleEl, calls } = createHarness({
    readAutoUpdateEnabledPreference: () => false,
  });

  controller.bind();
  autoUpdateToggleEl.checked = true;
  autoUpdateToggleEl.dispatchEvent({ type: 'change' });

  assert.deepEqual(calls.writeAutoUpdateEnabledPreference, [true]);
  assert.equal(calls.syncUpdate, 1);
});

test('toggle controller auto-prompt decline path writes declined decision and disables notifications', async () => {
  const { controller, windowObj, calls } = createHarness({
    hasStoredNotificationEnabledPreference: () => false,
    notificationPermissionState: () => 'default',
  });

  controller.bind();
  windowObj.setConfirmValue(false);
  await controller.maybeAutoPromptForNotifications();

  assert.deepEqual(calls.writeAutoPromptDecision, [NOTIFICATION_AUTO_PROMPT_DECISIONS.DECLINED]);
  assert.deepEqual(calls.writeNotificationEnabledPreference, [false]);
  assert.equal(calls.syncDaily, 1);
  assert.equal(calls.registerBackground, 0);
  assert.equal(calls.requestDailyCheck, 0);
});

test('toggle controller auto-prompt accepted path enables notifications and background checks', async () => {
  const { controller, windowObj, calls } = createHarness({
    hasStoredNotificationEnabledPreference: () => false,
    notificationPermissionState: () => 'default',
    requestNotificationPermission: async () => 'granted',
  });

  controller.bind();
  windowObj.setConfirmValue(true);
  await controller.maybeAutoPromptForNotifications();

  assert.deepEqual(calls.writeAutoPromptDecision, [NOTIFICATION_AUTO_PROMPT_DECISIONS.ACCEPTED]);
  assert.deepEqual(calls.writeNotificationEnabledPreference, [true]);
  assert.equal(calls.syncDaily, 1);
  assert.equal(calls.registerBackground, 1);
  assert.equal(calls.requestDailyCheck, 1);
});

test('toggle controller denied permission path rolls back preference and shows denied toast', async () => {
  const { controller, windowObj, calls } = createHarness({
    hasStoredNotificationEnabledPreference: () => false,
    notificationPermissionState: () => 'default',
    requestNotificationPermission: async () => 'denied',
    translateNow: (key) => {
      if (key === 'ui.notificationsBlockedToast') return 'Notifications are blocked';
      return key;
    },
  });

  controller.bind();
  windowObj.setConfirmValue(true);
  await controller.maybeAutoPromptForNotifications();

  assert.deepEqual(calls.writeNotificationEnabledPreference, [true, false]);
  assert.equal(calls.syncDaily, 1);
  assert.equal(calls.showToast.length, 1);
  assert.equal(calls.showToast[0].text, 'Notifications are blocked');
  assert.equal(calls.showToast[0].options.recordInHistory, false);
  assert.equal(calls.registerBackground, 0);
  assert.equal(calls.requestDailyCheck, 0);
});

test('toggle controller handleStorageEvent refreshes corresponding toggle and syncs service worker', () => {
  let notificationEnabled = false;
  let autoUpdateEnabled = false;
  const { controller, notificationsToggleEl, autoUpdateToggleEl, calls } = createHarness({
    readNotificationEnabledPreference: () => notificationEnabled,
    readAutoUpdateEnabledPreference: () => autoUpdateEnabled,
    notificationPermissionState: () => 'granted',
  });

  controller.bind();

  notificationEnabled = true;
  controller.handleStorageEvent(NOTIFICATION_KEY);
  assert.equal(notificationsToggleEl.checked, true);
  assert.equal(calls.syncDaily, 1);

  autoUpdateEnabled = true;
  controller.handleStorageEvent(AUTO_UPDATE_KEY);
  assert.equal(autoUpdateToggleEl.checked, true);
  assert.equal(calls.syncUpdate, 1);
});
