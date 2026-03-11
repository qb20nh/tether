import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationCenter } from '../../src/app/notification_center.js';
import { NOTIFICATION_AUTO_PROMPT_DECISIONS } from '../../src/app/notification_preferences.js';
import { ELEMENT_IDS } from '../../src/config.js';
import {
  FakeElement,
  createDocumentMock,
  createWindowMock,
  flushMicrotasks,
} from './notification_test_harness.js';

const SW_MESSAGE_TYPES = Object.freeze({
  GET_HISTORY: 'SW_GET_NOTIFICATION_HISTORY',
  MARK_HISTORY_READ: 'SW_MARK_NOTIFICATION_HISTORY_READ',
});

const createHarness = (overrides = {}) => {
  const documentObj = createDocumentMock();
  const windowObj = createWindowMock();

  const listEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_LIST, new FakeElement('div'));
  const panelEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL, new FakeElement('div'));
  panelEl.appendChild(listEl);

  const toggleEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_TOGGLE, new FakeElement('button'));
  const badgeEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_BADGE, new FakeElement('span'));
  documentObj.register(ELEMENT_IDS.NOTIFICATIONS_TOGGLE, new FakeElement('input'));
  documentObj.register(ELEMENT_IDS.AUTO_UPDATE_TOGGLE, new FakeElement('input'));
  documentObj.register(ELEMENT_IDS.SETTINGS_TOGGLE, new FakeElement('button'));
  documentObj.register(ELEMENT_IDS.UPDATE_APPLY_DIALOG, new FakeElement('dialog'));
  documentObj.register(ELEMENT_IDS.UPDATE_APPLY_MESSAGE, new FakeElement('div'));
  documentObj.register(ELEMENT_IDS.MOVE_DAILY_DIALOG, new FakeElement('dialog'));
  documentObj.register(ELEMENT_IDS.MOVE_DAILY_MESSAGE, new FakeElement('div'));

  let applyCalls = [];
  let openCalls = [];

  const center = createNotificationCenter({
    elementIds: ELEMENT_IDS,
    swMessageTypes: SW_MESSAGE_TYPES,
    localBuildNumber: 100,
    notificationEnabledKey: 'k-notification-enabled',
    autoUpdateEnabledKey: 'k-auto-update-enabled',
    notificationAutoPromptDecisions: NOTIFICATION_AUTO_PROMPT_DECISIONS,
    readAutoPromptDecision: () => NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET,
    writeAutoPromptDecision: () => { },
    readNotificationEnabledPreference: () => true,
    writeNotificationEnabledPreference: () => { },
    readAutoUpdateEnabledPreference: () => false,
    writeAutoUpdateEnabledPreference: () => { },
    hasStoredNotificationEnabledPreference: () => true,
    notificationPermissionState: () => 'granted',
    supportsNotifications: () => true,
    canUseServiceWorker: () => true,
    requestNotificationPermission: async () => 'granted',
    syncDailyStateToServiceWorker: async () => { },
    syncUpdatePolicyToServiceWorker: async () => { },
    registerBackgroundDailyCheck: async () => { },
    requestServiceWorkerDailyCheck: async () => { },
    postMessageToServiceWorker: async () => true,
    clearAppliedUpdateHistoryActions: async () => { },
    translateNow: overrides.translateNow || ((key) => key),
    getLocale: () => 'en',
    showInAppToast: () => { },
    isOpenDailyHistoryActionable: overrides.isOpenDailyHistoryActionable || (() => true),
    onApplyUpdateRequested: overrides.onApplyUpdateRequested || (async (payload) => {
      applyCalls.push(payload);
    }),
    onOpenDailyRequested: overrides.onOpenDailyRequested || (async (payload) => {
      openCalls.push(payload);
    }),
    windowObj,
    documentObj,
  });

  return {
    center,
    documentObj,
    windowObj,
    listEl,
    panelEl,
    toggleEl,
    badgeEl,
    getApplyCalls: () => applyCalls,
    getOpenCalls: () => openCalls,
  };
};

test('notification center normalizes and truncates history payloads to max entries', () => {
  const { center } = createHarness();

  const entries = [];
  for (let i = 0; i < 12; i += 1) {
    entries.push({
      id: `id-${i}`,
      source: i % 2 === 0 ? 'system' : 'toast',
      kind: 'new-level',
      title: `title-${i}`,
      body: `body-${i}`,
      createdAtUtcMs: Date.UTC(2026, 2, 7, 0, i, 0),
      marker: i === 0 ? 'unread' : 'older',
      action: i % 2 === 0 ? { type: 'open-daily', dailyId: '2026-03-07' } : null,
    });
  }

  center.applyHistoryPayload({ historyVersion: 4, entries });
  assert.equal(center.getHistoryEntries().length, 10);
  assert.equal(center.getHistoryEntries()[0].id, 'id-0');
  assert.equal(center.getHistoryEntries()[9].id, 'id-9');
});

test('notification center refresh updates unread badge based on system unread entries', () => {
  const { center, badgeEl, toggleEl } = createHarness();
  center.bind();

  center.applyHistoryPayload({
    historyVersion: 2,
    entries: [
      {
        id: 'sys-1',
        source: 'system',
        kind: 'new-level',
        title: 'x',
        body: 'y',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 1, 0, 0),
        marker: 'unread',
      },
    ],
  });
  center.refreshHistoryUi();

  assert.equal(badgeEl.hidden, false);
  assert.equal(toggleEl.classList.contains('hasUnread'), true);
});

test('notification center dispatches history row actions to callbacks', async () => {
  const applyPayloads = [];
  const openPayloads = [];
  const { center, listEl } = createHarness({
    onApplyUpdateRequested: async (payload) => {
      applyPayloads.push(payload);
    },
    onOpenDailyRequested: async (payload) => {
      openPayloads.push(payload);
    },
  });

  center.bind();
  center.applyHistoryPayload({
    historyVersion: 3,
    entries: [
      {
        id: 'apply-1',
        source: 'system',
        kind: 'new-version-available',
        title: 'update',
        body: 'available',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 2, 0, 0),
        marker: 'older',
        action: { type: 'apply-update', buildNumber: 123 },
      },
      {
        id: 'daily-1',
        source: 'system',
        kind: 'new-level',
        title: 'daily',
        body: 'open',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 2, 1, 0),
        marker: 'older',
        action: { type: 'open-daily', dailyId: '2026-03-07' },
      },
    ],
  });
  center.refreshHistoryUi();

  const rows = listEl.querySelectorAll('.notificationHistoryItem');
  listEl.dispatchEvent({ type: 'click', target: rows[0] });
  listEl.dispatchEvent({ type: 'click', target: rows[1] });
  await flushMicrotasks();

  assert.equal(applyPayloads.length, 1);
  assert.equal(applyPayloads[0].buildNumber, 123);
  assert.equal(typeof applyPayloads[0].requestUpdateApplyConfirmation, 'function');
  assert.equal(typeof applyPayloads[0].closeHistoryPanel, 'function');

  assert.equal(openPayloads.length, 1);
  assert.equal(openPayloads[0].dailyId, '2026-03-07');
  assert.equal(openPayloads[0].kind, 'new-level');
  assert.equal(typeof openPayloads[0].requestMoveDailyConfirmation, 'function');
});

test('notification center dialog helpers fall back to window.confirm when modal APIs are unavailable', async () => {
  let capturedApply = null;
  let capturedOpenDaily = null;

  const { center, listEl, windowObj } = createHarness({
    onApplyUpdateRequested: async (payload) => {
      capturedApply = payload;
    },
    onOpenDailyRequested: async (payload) => {
      capturedOpenDaily = payload;
    },
  });

  center.bind();
  center.applyHistoryPayload({
    historyVersion: 5,
    entries: [
      {
        id: 'apply-2',
        source: 'system',
        kind: 'new-version-available',
        title: 'u',
        body: 'v',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 3, 0, 0),
        marker: 'older',
        action: { type: 'apply-update', buildNumber: 222 },
      },
      {
        id: 'open-2',
        source: 'system',
        kind: 'new-level',
        title: 'd',
        body: 'e',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 3, 1, 0),
        marker: 'older',
        action: { type: 'open-daily', dailyId: '2026-03-07' },
      },
    ],
  });
  center.refreshHistoryUi();

  const rows = listEl.querySelectorAll('.notificationHistoryItem');
  listEl.dispatchEvent({ type: 'click', target: rows[0] });
  listEl.dispatchEvent({ type: 'click', target: rows[1] });
  await flushMicrotasks();

  windowObj.setConfirmValue(true);
  assert.equal(await capturedApply.requestUpdateApplyConfirmation(222), true);
  assert.equal(await capturedOpenDaily.requestMoveDailyConfirmation(), true);

  const messages = windowObj.getConfirmMessages();
  assert.equal(messages.some((entry) => entry.includes('Install build 222?')), true);
  assert.equal(messages.some((entry) => entry.includes('Move to Daily level anyway?')), true);
});

test('notification center refreshLocalizedUi re-renders history text using active locale translation', () => {
  let locale = 'en';
  const translations = {
    en: {
      'ui.notificationNewLevelTitle': 'New level',
      'ui.notificationNewLevelBody': 'Play today',
    },
    ko: {
      'ui.notificationNewLevelTitle': '새 레벨',
      'ui.notificationNewLevelBody': '오늘 도전',
    },
  };

  const { center, listEl } = createHarness({
    translateNow: (key) => translations[locale][key] || key,
  });

  center.bind();
  center.applyHistoryPayload({
    historyVersion: 6,
    entries: [
      {
        id: 'sys-locale',
        source: 'system',
        kind: 'new-level',
        title: 'ignored',
        body: 'ignored',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 4, 0, 0),
        marker: 'older',
      },
    ],
  });

  center.refreshHistoryUi();
  const titleBefore = listEl.querySelector('.notificationHistoryItem__title');
  const bodyBefore = listEl.querySelector('.notificationHistoryItem__body');
  assert.equal(titleBefore.textContent, 'New level');
  assert.equal(bodyBefore.textContent, 'Play today');

  locale = 'ko';
  center.refreshLocalizedUi();

  const titleAfter = listEl.querySelector('.notificationHistoryItem__title');
  const bodyAfter = listEl.querySelector('.notificationHistoryItem__body');
  assert.equal(titleAfter.textContent, '새 레벨');
  assert.equal(bodyAfter.textContent, '오늘 도전');
});
