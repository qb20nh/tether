import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalStoragePersistence,
  STORAGE_KEYS,
} from '../../src/persistence/local_storage_persistence.js';

const createFakeStorage = () => {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return map;
    },
  };
};

test('localStorage persistence round-trips and validates session signature', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  let boot = persistence.readBootState();
  assert.equal(boot.theme, 'dark');
  assert.equal(boot.lowPowerModeEnabled, false);
  assert.equal(boot.keyboardGamepadControlsEnabled, false);
  assert.equal(boot.hiddenPanels.guide, false);
  assert.equal(boot.hiddenPanels.legend, true);
  assert.equal(boot.dailySolvedDate, null);
  assert.deepEqual(boot.scoreState, {
    infiniteTotal: 0,
    dailyTotal: 0,
    infiniteByLevel: {},
    dailyByDate: {},
  });
  assert.equal(boot.sessionBoard, null);

  persistence.writeTheme('light');
  persistence.writeLowPowerModeEnabled(true);
  persistence.writeKeyboardGamepadControlsEnabled(true);
  persistence.writeHiddenPanel('guide', true);
  persistence.writeCampaignProgress(5);
  persistence.writeInfiniteProgress(3);
  persistence.writeDailySolvedDate('2026-02-27');
  persistence.writeScoreState({
    infiniteTotal: 3,
    dailyTotal: 1,
    infiniteByLevel: {
      4: ['sig-a', 'sig-b'],
    },
    dailyByDate: {
      '2026-02-27': ['sig-x'],
    },
  });
  persistence.writeSessionBoard({
    levelIndex: 4,
    path: [[0, 0], [0, 1], [1, 1]],
    movableWalls: [[2, 2]],
  });

  boot = persistence.readBootState();
  assert.equal(boot.theme, 'light');
  assert.equal(boot.lowPowerModeEnabled, true);
  assert.equal(boot.keyboardGamepadControlsEnabled, true);
  assert.equal(boot.hiddenPanels.guide, true);
  assert.equal(boot.campaignProgress, 5);
  assert.equal(boot.infiniteProgress, 3);
  assert.equal(boot.dailySolvedDate, '2026-02-27');
  assert.deepEqual(boot.scoreState, {
    infiniteTotal: 3,
    dailyTotal: 1,
    infiniteByLevel: {
      4: ['sig-a', 'sig-b'],
    },
    dailyByDate: {
      '2026-02-27': ['sig-x'],
    },
  });
  assert.deepEqual(boot.sessionBoard.path, [[0, 0], [0, 1], [1, 1]]);

  const raw = storage.getItem(STORAGE_KEYS.SESSION_SAVE_KEY);
  const parsed = JSON.parse(raw);
  parsed.sig = '000000000000000000000000';
  storage.setItem(STORAGE_KEYS.SESSION_SAVE_KEY, JSON.stringify(parsed));

  boot = persistence.readBootState();
  assert.equal(boot.sessionBoard, null);
  assert.equal(storage.getItem(STORAGE_KEYS.SESSION_SAVE_KEY), null);
});

test('low power mode falls back to disabled when stored value is invalid', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  storage.setItem(STORAGE_KEYS.LOW_POWER_MODE_KEY, 'maybe');

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  const boot = persistence.readBootState();
  assert.equal(boot.lowPowerModeEnabled, false);
  assert.equal(boot.keyboardGamepadControlsEnabled, false);
});

test('keyboard / gamepad controls fall back to disabled when stored value is invalid', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  storage.setItem(STORAGE_KEYS.KEYBOARD_GAMEPAD_CONTROLS_KEY, 'maybe');

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  const boot = persistence.readBootState();
  assert.equal(boot.keyboardGamepadControlsEnabled, false);
});

test('score state falls back to defaults when payload is malformed', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  storage.setItem(STORAGE_KEYS.SCORE_STATE_KEY, JSON.stringify({
    version: 999,
    infiniteTotal: 999,
    dailyTotal: 999,
    infiniteByLevel: { 1: ['x'] },
    dailyByDate: { '2026-03-01': ['y'] },
  }));

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  const boot = persistence.readBootState();
  assert.deepEqual(boot.scoreState, {
    infiniteTotal: 0,
    dailyTotal: 0,
    infiniteByLevel: {},
    dailyByDate: {},
  });
});

test('campaign progress accepts legacy payloads without version', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  storage.setItem(STORAGE_KEYS.LEVEL_PROGRESS_KEY, JSON.stringify({
    latestLevel: 7,
  }));

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  const boot = persistence.readBootState();
  assert.equal(boot.campaignProgress, 7);
});

test('campaign progress resets to default on version mismatch', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  storage.setItem(STORAGE_KEYS.LEVEL_PROGRESS_KEY, JSON.stringify({
    version: 999,
    latestLevel: 7,
  }));

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  const boot = persistence.readBootState();
  assert.equal(boot.campaignProgress, 0);
});

test('infinite progress resets to default on version mismatch', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  storage.setItem(STORAGE_KEYS.INFINITE_PROGRESS_KEY, JSON.stringify({
    version: 999,
    latestLevel: 5,
  }));

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  const boot = persistence.readBootState();
  assert.equal(boot.infiniteProgress, 0);
});

test('daily session save is rejected when saved dailyId does not match active daily', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  const dailyAbsIndex = 30;

  const firstPersistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
    dailyAbsIndex,
    activeDailyId: '2026-02-27',
  });

  firstPersistence.writeSessionBoard({
    levelIndex: dailyAbsIndex,
    path: [[0, 0], [0, 1]],
    movableWalls: null,
  });

  const secondPersistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
    dailyAbsIndex,
    activeDailyId: '2026-02-28',
  });

  const boot = secondPersistence.readBootState();
  assert.equal(boot.sessionBoard, null);
  assert.equal(storage.getItem(STORAGE_KEYS.SESSION_SAVE_KEY), null);
});

test('infinite session save restores even before campaign completion', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  const campaignLevelCount = 10;
  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount,
    maxInfiniteIndex: 20,
  });

  persistence.writeCampaignProgress(0);
  persistence.writeInfiniteProgress(2);
  persistence.writeSessionBoard({
    levelIndex: campaignLevelCount + 2,
    path: [[0, 0], [0, 1]],
    movableWalls: [],
  });

  const boot = persistence.readBootState();
  assert.deepEqual(boot.sessionBoard, {
    levelIndex: campaignLevelCount + 2,
    path: [[0, 0], [0, 1]],
    movableWalls: [],
    dailyId: null,
  });
});

test('session save round-trips with empty path to preserve current level', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  persistence.writeCampaignProgress(3);
  persistence.writeSessionBoard({
    levelIndex: 3,
    path: [],
    movableWalls: [],
  });

  const boot = persistence.readBootState();
  assert.deepEqual(boot.sessionBoard, {
    levelIndex: 3,
    path: [],
    movableWalls: [],
    dailyId: null,
  });
});

test('session save canonicalizes zero-segment path while preserving opened level', () => {
  const storage = createFakeStorage();
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
      },
    },
  };

  const persistence = createLocalStoragePersistence({
    windowObj: fakeWindow,
    campaignLevelCount: 10,
    maxInfiniteIndex: 20,
  });

  persistence.writeCampaignProgress(3);
  persistence.writeSessionBoard({
    levelIndex: 3,
    path: [[1, 1]],
    movableWalls: [],
  });
  assert.notEqual(storage.getItem(STORAGE_KEYS.SESSION_SAVE_KEY), null);

  const boot = persistence.readBootState();
  assert.deepEqual(boot.sessionBoard, {
    levelIndex: 3,
    path: [],
    movableWalls: [],
    dailyId: null,
  });
});
