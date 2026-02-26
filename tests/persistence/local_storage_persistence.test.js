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
  assert.equal(boot.hiddenPanels.guide, false);
  assert.equal(boot.hiddenPanels.legend, true);
  assert.equal(boot.sessionBoard, null);

  persistence.writeTheme('light');
  persistence.writeHiddenPanel('guide', true);
  persistence.writeCampaignProgress(5);
  persistence.writeInfiniteProgress(3);
  persistence.writeSessionBoard({
    levelIndex: 4,
    path: [[0, 0], [0, 1], [1, 1]],
    movableWalls: [[2, 2]],
  });

  boot = persistence.readBootState();
  assert.equal(boot.theme, 'light');
  assert.equal(boot.hiddenPanels.guide, true);
  assert.equal(boot.campaignProgress, 5);
  assert.equal(boot.infiniteProgress, 3);
  assert.deepEqual(boot.sessionBoard.path, [[0, 0], [0, 1], [1, 1]]);

  const raw = storage.getItem(STORAGE_KEYS.SESSION_SAVE_KEY);
  const parsed = JSON.parse(raw);
  parsed.sig = '000000000000000000000000';
  storage.setItem(STORAGE_KEYS.SESSION_SAVE_KEY, JSON.stringify(parsed));

  boot = persistence.readBootState();
  assert.equal(boot.sessionBoard, null);
  assert.equal(storage.getItem(STORAGE_KEYS.SESSION_SAVE_KEY), null);
});
