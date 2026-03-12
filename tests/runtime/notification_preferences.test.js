import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_UPDATE_ENABLED_KEY,
  LAST_NOTIFIED_REMOTE_BUILD_KEY,
  NOTIFICATION_AUTO_PROMPT_DECISIONS,
  NOTIFICATION_ENABLED_KEY,
  createNotificationPreferences,
} from '../../src/app/notification_preferences.ts';

const createStorageMock = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
};

test('notification preferences read/write storage-backed settings', () => {
  const storage = createStorageMock();
  const prefs = createNotificationPreferences({
    localStorageObj: storage,
    supportsNotifications: () => true,
    notificationApi: { permission: 'default' },
  });

  assert.equal(prefs.readNotificationEnabledPreference(), false);
  prefs.writeNotificationEnabledPreference(true);
  assert.equal(storage.getItem(NOTIFICATION_ENABLED_KEY), 'true');
  assert.equal(prefs.readNotificationEnabledPreference(), true);

  prefs.writeAutoUpdateEnabledPreference(true);
  assert.equal(storage.getItem(AUTO_UPDATE_ENABLED_KEY), 'true');
  assert.equal(prefs.readAutoUpdateEnabledPreference(), true);

  assert.equal(prefs.readLastNotifiedRemoteBuildNumber(), null);
  prefs.writeLastNotifiedRemoteBuildNumber(321);
  assert.equal(storage.getItem(LAST_NOTIFIED_REMOTE_BUILD_KEY), '321');
  assert.equal(prefs.readLastNotifiedRemoteBuildNumber(), 321);
});

test('notification preferences fallback to permission when explicit toggle is unset', () => {
  const prefs = createNotificationPreferences({
    localStorageObj: createStorageMock(),
    supportsNotifications: () => true,
    notificationApi: { permission: 'granted' },
  });

  assert.equal(prefs.notificationPermissionState(), 'granted');
  assert.equal(prefs.readNotificationEnabledPreference(), true);
});

test('notification preferences honor prompt decision validation', () => {
  const storage = createStorageMock();
  const prefs = createNotificationPreferences({
    localStorageObj: storage,
    supportsNotifications: () => false,
    notificationApi: null,
  });

  assert.equal(prefs.readAutoPromptDecision(), NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET);
  prefs.writeAutoPromptDecision('invalid');
  assert.equal(prefs.readAutoPromptDecision(), NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET);

  prefs.writeAutoPromptDecision(NOTIFICATION_AUTO_PROMPT_DECISIONS.ACCEPTED);
  assert.equal(prefs.readAutoPromptDecision(), NOTIFICATION_AUTO_PROMPT_DECISIONS.ACCEPTED);
});

test('notification preferences handle localStorage access failures safely', () => {
  const throwingStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };

  const prefs = createNotificationPreferences({
    localStorageObj: throwingStorage,
    supportsNotifications: () => false,
    notificationApi: { permission: 'granted' },
  });

  assert.equal(prefs.notificationPermissionState(), 'unsupported');
  assert.equal(prefs.readAutoPromptDecision(), NOTIFICATION_AUTO_PROMPT_DECISIONS.UNSET);
  assert.equal(prefs.readNotificationEnabledPreference(), false);
  assert.equal(prefs.readAutoUpdateEnabledPreference(), false);
  assert.equal(prefs.readLastNotifiedRemoteBuildNumber(), null);
  assert.equal(prefs.hasStoredNotificationEnabledPreference(), false);

  assert.doesNotThrow(() => {
    prefs.writeAutoPromptDecision(NOTIFICATION_AUTO_PROMPT_DECISIONS.DECLINED);
    prefs.writeNotificationEnabledPreference(true);
    prefs.writeAutoUpdateEnabledPreference(true);
    prefs.writeLastNotifiedRemoteBuildNumber(123);
  });
});

test('notification preferences reject invalid remote build numbers', () => {
  const storage = createStorageMock();
  const prefs = createNotificationPreferences({
    localStorageObj: storage,
    supportsNotifications: () => true,
    notificationApi: { permission: 'default' },
  });

  prefs.writeLastNotifiedRemoteBuildNumber(0);
  prefs.writeLastNotifiedRemoteBuildNumber(-1);
  assert.equal(storage.getItem(LAST_NOTIFIED_REMOTE_BUILD_KEY), null);

  storage.setItem(LAST_NOTIFIED_REMOTE_BUILD_KEY, 'NaN');
  assert.equal(prefs.readLastNotifiedRemoteBuildNumber(), null);
});
