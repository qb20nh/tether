import test from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_IDS } from '../../src/config.js';
import { NOTIFICATION_AUTO_PROMPT_DECISIONS } from '../../src/app/notification_preferences.js';
import { createNotificationCenter } from '../../src/app/notification_center.js';

const SW_MESSAGE_TYPES = Object.freeze({
  GET_HISTORY: 'SW_GET_NOTIFICATION_HISTORY',
  MARK_HISTORY_READ: 'SW_MARK_NOTIFICATION_HISTORY_READ',
});

class FakeStyle {
  constructor() {
    this.map = new Map();
  }

  setProperty(name, value) {
    this.map.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.map.get(name) || '';
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  add(...names) {
    for (const name of names) this.owner._classSet.add(name);
  }

  remove(...names) {
    for (const name of names) this.owner._classSet.delete(name);
  }

  contains(name) {
    return this.owner._classSet.has(name);
  }

  toggle(name, force) {
    if (force === true) {
      this.owner._classSet.add(name);
      return true;
    }
    if (force === false) {
      this.owner._classSet.delete(name);
      return false;
    }
    if (this.owner._classSet.has(name)) {
      this.owner._classSet.delete(name);
      return false;
    }
    this.owner._classSet.add(name);
    return true;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.id = '';
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.returnValue = '';
    this.style = new FakeStyle();
    this._textContent = '';
    this._classSet = new Set();
    this.classList = new FakeClassList(this);
    this.isConnected = true;
  }

  get className() {
    return Array.from(this._classSet).join(' ');
  }

  set className(value) {
    this._classSet = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
      child.isConnected = false;
    }
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(eventName, handler) {
    const key = String(eventName);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }

  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    const handlers = this.listeners.get(payload.type) || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }

  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  closest(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    let current = this;
    while (current) {
      if (current.classList.contains(className)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const out = [];
    if (!selector.startsWith('.')) return out;
    const className = selector.slice(1);

    const walk = (node) => {
      for (const child of node.children) {
        if (child.classList.contains(className)) out.push(child);
        walk(child);
      }
    };

    walk(this);
    return out;
  }
}

const createDocumentMock = () => {
  const elements = new Map();
  const listeners = new Map();
  const documentObj = {
    visibilityState: 'visible',
    body: new FakeElement('body'),
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener(eventName, handler) {
      const key = String(eventName);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) handler(event);
    },
    register(id, element) {
      element.id = id;
      elements.set(id, element);
      documentObj.body.appendChild(element);
      return element;
    },
  };

  return documentObj;
};

const createWindowMock = (overrides = {}) => {
  let confirmValue = overrides.confirmValue ?? true;
  const confirmMessages = [];
  return {
    confirm(message) {
      confirmMessages.push(String(message));
      return confirmValue;
    },
    setConfirmValue(value) {
      confirmValue = value;
    },
    getConfirmMessages() {
      return confirmMessages;
    },
    setInterval() {
      return 1;
    },
    clearInterval() { },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() { },
    getComputedStyle() {
      return {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      };
    },
  };
};

const createHarness = (overrides = {}) => {
  const documentObj = createDocumentMock();
  const windowObj = createWindowMock();

  const listEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_LIST, new FakeElement('div'));
  const panelEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL, new FakeElement('div'));
  panelEl.appendChild(listEl);

  const toggleEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_TOGGLE, new FakeElement('button'));
  const badgeEl = documentObj.register(ELEMENT_IDS.NOTIFICATION_HISTORY_BADGE, new FakeElement('span'));
  const notificationsToggleEl = documentObj.register(ELEMENT_IDS.NOTIFICATIONS_TOGGLE, new FakeElement('input'));
  const autoUpdateToggleEl = documentObj.register(ELEMENT_IDS.AUTO_UPDATE_TOGGLE, new FakeElement('input'));
  const settingsToggleEl = documentObj.register(ELEMENT_IDS.SETTINGS_TOGGLE, new FakeElement('button'));
  void toggleEl;
  void badgeEl;
  void notificationsToggleEl;
  void autoUpdateToggleEl;
  void settingsToggleEl;

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

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
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
