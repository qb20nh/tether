import test from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_IDS } from '../../src/config.js';
import { createNotificationHistoryController } from '../../src/app/notification_history_controller.js';
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
  const settingsToggleEl = documentObj.register(ELEMENT_IDS.SETTINGS_TOGGLE, new FakeElement('button'));
  void settingsToggleEl;

  const calls = {
    postMessages: [],
    applyRequests: [],
    openRequests: [],
  };

  const controller = createNotificationHistoryController({
    elementIds: ELEMENT_IDS,
    swMessageTypes: SW_MESSAGE_TYPES,
    postMessageToServiceWorker: overrides.postMessageToServiceWorker || (async (message, options = {}) => {
      calls.postMessages.push({ message, options });
      return true;
    }),
    translateNow: overrides.translateNow || ((key) => key),
    getLocale: overrides.getLocale || (() => 'en'),
    onApplyUpdateRequested: overrides.onApplyUpdateRequested || (async (payload) => {
      calls.applyRequests.push(payload);
    }),
    onOpenDailyRequested: overrides.onOpenDailyRequested || (async (payload) => {
      calls.openRequests.push(payload);
    }),
    isOpenDailyHistoryActionable: overrides.isOpenDailyHistoryActionable || (() => true),
    requestUpdateApplyConfirmation: overrides.requestUpdateApplyConfirmation || (async () => true),
    requestMoveDailyConfirmation: overrides.requestMoveDailyConfirmation || (async () => true),
    containsOpenDialogTarget: overrides.containsOpenDialogTarget || (() => false),
    windowObj,
    documentObj,
  });

  return {
    controller,
    documentObj,
    windowObj,
    listEl,
    panelEl,
    toggleEl,
    badgeEl,
    calls,
  };
};

test('history controller normalizes payload and truncates entries to max limit', () => {
  const { controller } = createHarness();

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

  controller.applyHistoryPayload({ historyVersion: 4, entries });
  assert.equal(controller.getEntries().length, 10);
  assert.equal(controller.getEntries()[0].id, 'id-0');
  assert.equal(controller.getEntries()[9].id, 'id-9');
});

test('history controller refreshes unread badge state from system unread entries', () => {
  const { controller, badgeEl, toggleEl } = createHarness();
  controller.bind();

  controller.applyHistoryPayload({
    historyVersion: 2,
    entries: [
      {
        id: 'sys-unread',
        source: 'system',
        kind: 'new-level',
        title: 'x',
        body: 'y',
        createdAtUtcMs: Date.UTC(2026, 2, 7, 1, 0, 0),
        marker: 'unread',
      },
    ],
  });
  controller.refreshUi();

  assert.equal(badgeEl.hidden, false);
  assert.equal(toggleEl.classList.contains('hasUnread'), true);
});

test('history controller dispatches apply-update and open-daily row actions', async () => {
  const { controller, listEl, calls } = createHarness();
  controller.bind();

  controller.applyHistoryPayload({
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
  controller.refreshUi();

  const rows = listEl.querySelectorAll('.notificationHistoryItem');
  listEl.dispatchEvent({ type: 'click', target: rows[0] });
  listEl.dispatchEvent({ type: 'click', target: rows[1] });
  await flushMicrotasks();

  assert.equal(calls.applyRequests.length, 1);
  assert.equal(calls.applyRequests[0].buildNumber, 123);
  assert.equal(typeof calls.applyRequests[0].requestUpdateApplyConfirmation, 'function');
  assert.equal(typeof calls.applyRequests[0].closeHistoryPanel, 'function');

  assert.equal(calls.openRequests.length, 1);
  assert.equal(calls.openRequests[0].dailyId, '2026-03-07');
  assert.equal(calls.openRequests[0].kind, 'new-level');
  assert.equal(typeof calls.openRequests[0].requestMoveDailyConfirmation, 'function');
});

test('history controller read-ack posts once per history version and skips duplicates', async () => {
  const { controller, toggleEl, calls } = createHarness();
  controller.bind();

  const unreadEntries = [
    {
      id: 'sys-ack-1',
      source: 'system',
      kind: 'new-level',
      title: 'new',
      body: 'body',
      createdAtUtcMs: Date.UTC(2026, 2, 7, 3, 0, 0),
      marker: 'unread',
    },
  ];

  controller.applyHistoryPayload({ historyVersion: 10, entries: unreadEntries });
  toggleEl.dispatchEvent({ type: 'click' });
  await flushMicrotasks();

  const markCallsAfterOpen = calls.postMessages.filter(
    ({ message }) => message.type === SW_MESSAGE_TYPES.MARK_HISTORY_READ,
  );
  assert.equal(markCallsAfterOpen.length, 1);

  controller.refreshUi();
  await flushMicrotasks();

  const markCallsAfterRefresh = calls.postMessages.filter(
    ({ message }) => message.type === SW_MESSAGE_TYPES.MARK_HISTORY_READ,
  );
  assert.equal(markCallsAfterRefresh.length, 1);

  controller.applyHistoryPayload({ historyVersion: 11, entries: unreadEntries });
  controller.refreshUi();
  await flushMicrotasks();

  const markCallsAfterVersionChange = calls.postMessages.filter(
    ({ message }) => message.type === SW_MESSAGE_TYPES.MARK_HISTORY_READ,
  );
  assert.equal(markCallsAfterVersionChange.length, 2);
});

test('history controller closes panel on outside click and Escape', async () => {
  const { controller, documentObj, panelEl, toggleEl } = createHarness();
  controller.bind();

  toggleEl.dispatchEvent({ type: 'click' });
  await flushMicrotasks();
  assert.equal(panelEl.hidden, false);

  const outsideTarget = new FakeElement('div');
  documentObj.body.appendChild(outsideTarget);
  documentObj.dispatchEvent({ type: 'click', target: outsideTarget });
  assert.equal(panelEl.hidden, true);

  toggleEl.dispatchEvent({ type: 'click' });
  await flushMicrotasks();
  assert.equal(panelEl.hidden, false);

  documentObj.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(panelEl.hidden, true);
});
