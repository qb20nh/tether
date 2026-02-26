const GUIDE_KEY = 'tetherGuideHidden';
const LEGEND_KEY = 'tetherLegendHidden';
const LEVEL_PROGRESS_KEY = 'tetherLevelProgress';
const LEVEL_PROGRESS_VERSION = 1;
const INFINITE_PROGRESS_KEY = 'tetherInfiniteProgress';
const INFINITE_PROGRESS_VERSION = 1;
const DAILY_SOLVED_KEY = 'tetherDailySolved';
const DAILY_SOLVED_VERSION = 1;
const THEME_KEY = 'tetherTheme';
const SESSION_SAVE_KEY = 'tetherSessionSave';
const SESSION_SEAL_KEY = 'tetherSessionSeal';
const SESSION_SAVE_VERSION = 3;
const SESSION_SIG_HEX_LEN = 24;
const DEFAULT_THEME = 'dark';

const PANEL_KEY_BY_NAME = Object.freeze({
  guide: GUIDE_KEY,
  legend: LEGEND_KEY,
});

const DEFAULT_HIDDEN_BY_PANEL = Object.freeze({
  guide: false,
  legend: true,
});

const PATH_DIR_FROM_DELTA = Object.freeze({
  '-1,0': 'u',
  '1,0': 'd',
  '0,-1': 'l',
  '0,1': 'r',
  '-1,-1': 'q',
  '-1,1': 'e',
  '1,-1': 'z',
  '1,1': 'c',
});

const PATH_DELTA_FROM_DIR = Object.freeze({
  u: [-1, 0],
  d: [1, 0],
  l: [0, -1],
  r: [0, 1],
  q: [-1, -1],
  e: [-1, 1],
  z: [1, -1],
  c: [1, 1],
});

const normalizeTheme = (theme) => (theme === 'light' || theme === 'dark' ? theme : null);

const hashString32 = (input) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const mix32 = (input) => {
  let x = input >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
};

const toHex32 = (value) => (value >>> 0).toString(16).padStart(8, '0');

const secureEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const normalizeSavedPathEntry = (entry) => {
  const r = Array.isArray(entry) ? entry[0] : entry?.r;
  const c = Array.isArray(entry) ? entry[1] : entry?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return [r, c];
};

const encodePathCompact = (path) => {
  if (!Array.isArray(path) || path.length === 0) return '';

  const first = normalizeSavedPathEntry(path[0]);
  if (!first) return '';

  const [startR, startC] = first;
  let encodedDirs = '';
  let prevR = startR;
  let prevC = startC;

  for (let i = 1; i < path.length; i++) {
    const point = normalizeSavedPathEntry(path[i]);
    if (!point) return '';
    const [r, c] = point;
    const dr = r - prevR;
    const dc = c - prevC;
    const dir = PATH_DIR_FROM_DELTA[`${dr},${dc}`];
    if (!dir) return '';
    encodedDirs += dir;
    prevR = r;
    prevC = c;
  }

  return `${startR.toString(36)}.${startC.toString(36)}:${encodedDirs}`;
};

const decodePathCompact = (value) => {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return [];

  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0) return null;
  const head = value.slice(0, colonIndex);
  const dirs = value.slice(colonIndex + 1);

  const dotIndex = head.indexOf('.');
  if (dotIndex <= 0 || dotIndex >= head.length - 1) return null;
  const rRaw = head.slice(0, dotIndex);
  const cRaw = head.slice(dotIndex + 1);
  const startR = Number.parseInt(rRaw, 36);
  const startC = Number.parseInt(cRaw, 36);
  if (!Number.isInteger(startR) || !Number.isInteger(startC)) return null;

  const points = [[startR, startC]];
  let r = startR;
  let c = startC;

  for (let i = 0; i < dirs.length; i++) {
    const delta = PATH_DELTA_FROM_DIR[dirs[i]];
    if (!delta) return null;
    r += delta[0];
    c += delta[1];
    points.push([r, c]);
  }

  return points;
};

const detectSystemTheme = (windowObj) => {
  try {
    if (windowObj?.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    if (windowObj?.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // Unsupported environment.
  }
  return DEFAULT_THEME;
};

const randomHex = (windowObj, byteLength = 16) => {
  const cryptoApi = windowObj?.crypto || globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteLength);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let out = '';
  for (let i = 0; i < byteLength * 2; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
};

export function createLocalStoragePersistence(options = {}) {
  const windowObj = options.windowObj || (typeof window !== 'undefined' ? window : null);
  const storage = options.storage || windowObj?.localStorage || null;
  const campaignLevelCount = Number.isInteger(options.campaignLevelCount)
    ? options.campaignLevelCount
    : 0;
  const maxInfiniteIndex = Number.isInteger(options.maxInfiniteIndex)
    ? options.maxInfiniteIndex
    : 0;
  const dailyAbsIndex = Number.isInteger(options.dailyAbsIndex)
    ? options.dailyAbsIndex
    : null;
  const activeDailyId = typeof options.activeDailyId === 'string' && options.activeDailyId.length > 0
    ? options.activeDailyId
    : null;

  let campaignProgressCache = null;
  let infiniteProgressCache = null;
  let dailySolvedDateCache = null;
  let cachedTheme = null;
  let cachedSessionSeal = null;
  let volatileSessionSeal = null;

  const readStorage = (key) => {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };

  const writeStorage = (key, value) => {
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch {
      // localStorage might be unavailable.
    }
  };

  const removeStorage = (key) => {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // localStorage might be unavailable.
    }
  };

  const clampCampaignProgress = (value) => {
    if (!Number.isInteger(value)) return 0;
    return Math.min(Math.max(value, 0), campaignLevelCount);
  };

  const clampInfiniteProgress = (value) => {
    if (!Number.isInteger(value)) return 0;
    return Math.min(Math.max(value, 0), maxInfiniteIndex);
  };

  const clampSavedLevelIndex = (value) => {
    if (!Number.isInteger(value)) return null;
    const maxIndex = Number.isInteger(dailyAbsIndex)
      ? dailyAbsIndex
      : (campaignLevelCount + maxInfiniteIndex);
    return Math.min(Math.max(value, 0), maxIndex);
  };

  const readCampaignProgress = () => {
    if (campaignProgressCache !== null) return campaignProgressCache;
    try {
      const raw = readStorage(LEVEL_PROGRESS_KEY);
      if (!raw) {
        campaignProgressCache = 0;
        return campaignProgressCache;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        campaignProgressCache = 0;
        return campaignProgressCache;
      }
      campaignProgressCache = clampCampaignProgress(parsed.latestLevel);
      return campaignProgressCache;
    } catch {
      campaignProgressCache = 0;
      return campaignProgressCache;
    }
  };

  const readInfiniteProgress = () => {
    if (infiniteProgressCache !== null) return infiniteProgressCache;
    try {
      const raw = readStorage(INFINITE_PROGRESS_KEY);
      if (!raw) {
        infiniteProgressCache = 0;
        return infiniteProgressCache;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        infiniteProgressCache = 0;
        return infiniteProgressCache;
      }
      infiniteProgressCache = clampInfiniteProgress(parsed.latestLevel);
      return infiniteProgressCache;
    } catch {
      infiniteProgressCache = 0;
      return infiniteProgressCache;
    }
  };

  const readDailySolvedDate = () => {
    if (dailySolvedDateCache !== null) return dailySolvedDateCache;
    try {
      const raw = readStorage(DAILY_SOLVED_KEY);
      if (!raw) {
        dailySolvedDateCache = '';
        return dailySolvedDateCache;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        dailySolvedDateCache = '';
        return dailySolvedDateCache;
      }
      if (Number.isInteger(parsed.version) && parsed.version !== DAILY_SOLVED_VERSION) {
        dailySolvedDateCache = '';
        return dailySolvedDateCache;
      }
      dailySolvedDateCache = typeof parsed.dailyId === 'string' ? parsed.dailyId : '';
      return dailySolvedDateCache;
    } catch {
      dailySolvedDateCache = '';
      return dailySolvedDateCache;
    }
  };

  const getHiddenPanel = (panel) => {
    const key = PANEL_KEY_BY_NAME[panel];
    if (!key) return false;
    const raw = readStorage(key);
    if (raw === null) return DEFAULT_HIDDEN_BY_PANEL[panel] === true;
    return raw === '1';
  };

  const readTheme = () => {
    if (cachedTheme) return cachedTheme;
    const stored = normalizeTheme(readStorage(THEME_KEY));
    if (stored) {
      cachedTheme = stored;
      return cachedTheme;
    }
    cachedTheme = detectSystemTheme(windowObj);
    return cachedTheme;
  };

  const getSessionSeal = () => {
    if (cachedSessionSeal) return cachedSessionSeal;
    const isHex = (value) => typeof value === 'string' && /^[0-9a-f]{16,128}$/i.test(value);

    const stored = readStorage(SESSION_SEAL_KEY);
    if (isHex(stored)) {
      cachedSessionSeal = stored.toLowerCase();
      return cachedSessionSeal;
    }

    const created = randomHex(windowObj, 24);
    writeStorage(SESSION_SEAL_KEY, created);
    if (storage) {
      cachedSessionSeal = created;
      return cachedSessionSeal;
    }
    if (!volatileSessionSeal) volatileSessionSeal = created;
    return volatileSessionSeal;
  };

  const isSavedLevelAllowed = (levelIndex) => {
    if (!Number.isInteger(levelIndex)) return false;

    if (Number.isInteger(dailyAbsIndex) && levelIndex === dailyAbsIndex) {
      return Boolean(activeDailyId);
    }

    if (levelIndex < campaignLevelCount) {
      return levelIndex <= readCampaignProgress();
    }

    if (readCampaignProgress() < campaignLevelCount) return false;
    const infiniteIndex = levelIndex - campaignLevelCount;
    if (!Number.isInteger(infiniteIndex) || infiniteIndex < 0) return false;
    return infiniteIndex <= clampInfiniteProgress(readInfiniteProgress());
  };

  const normalizeSavedMutableState = (value) => {
    if (!value || typeof value !== 'object') return null;

    const rawPath = typeof value.path === 'string'
      ? decodePathCompact(value.path)
      : (Array.isArray(value.path) ? value.path : []);
    if (!Array.isArray(rawPath)) return null;

    const path = [];
    for (let i = 0; i < rawPath.length; i++) {
      const normalized = normalizeSavedPathEntry(rawPath[i]);
      if (!normalized) return null;
      path.push(normalized);
    }

    let movableWalls = null;
    if (value.movableWalls !== undefined) {
      if (!Array.isArray(value.movableWalls)) return null;
      movableWalls = [];
      for (let i = 0; i < value.movableWalls.length; i++) {
        const normalized = normalizeSavedPathEntry(value.movableWalls[i]);
        if (!normalized) return null;
        movableWalls.push(normalized);
      }
    }

    return { path, movableWalls };
  };

  const normalizeSavedSingleBoard = (value) => {
    if (!value || typeof value !== 'object') return null;
    const levelIndex = clampSavedLevelIndex(value.levelIndex);
    if (!Number.isInteger(levelIndex)) return null;
    const mutable = normalizeSavedMutableState(value);
    if (!mutable) return null;
    return {
      levelIndex,
      path: mutable.path,
      movableWalls: mutable.movableWalls,
      dailyId: typeof value.dailyId === 'string' ? value.dailyId : null,
    };
  };

  const buildBoardSignaturePayload = (board) => {
    if (!board || typeof board !== 'object') return '';
    const levelIndex = Number.isInteger(board.levelIndex) ? board.levelIndex : -1;
    const path = Array.isArray(board.path)
      ? board.path
        .map((entry) => normalizeSavedPathEntry(entry))
        .filter(Boolean)
        .map(([r, c]) => `${r},${c}`)
        .join(';')
      : '';
    const movableWalls = Array.isArray(board.movableWalls)
      ? board.movableWalls
        .map((entry) => normalizeSavedPathEntry(entry))
        .filter(Boolean)
        .map(([r, c]) => `${r},${c}`)
        .sort()
        .join(';')
      : '';
    const dailyId = typeof board.dailyId === 'string' ? board.dailyId : '';
    return `v=${SESSION_SAVE_VERSION}|l=${levelIndex}|p=${path}|m=${movableWalls}|d=${dailyId}`;
  };

  const computeBoardSignature = (board, seal) => {
    if (!seal) return '';
    const payload = buildBoardSignaturePayload(board);
    const laneA = mix32(hashString32(`${seal}|${payload}|a`));
    const laneB = mix32(hashString32(`${payload}|${seal}|b`));
    const laneC = mix32(hashString32(`${seal.length}:${payload}|c`));
    return `${toHex32(laneA)}${toHex32(laneB)}${toHex32(laneC)}`;
  };

  const signBoard = (board) => computeBoardSignature(board, getSessionSeal());

  const verifyBoardSignature = (board, signature) => {
    if (typeof signature !== 'string') return false;
    const normalizedSig = signature.trim().toLowerCase();
    if (!/^[0-9a-f]+$/i.test(normalizedSig)) return false;
    if (normalizedSig.length !== SESSION_SIG_HEX_LEN) return false;
    const expected = signBoard(board);
    return secureEqual(expected, normalizedSig);
  };

  const toPersistedBoardState = (board) => ({
    levelIndex: board.levelIndex,
    path: encodePathCompact(board.path),
    movableWalls: Array.isArray(board.movableWalls)
      ? board.movableWalls.map(([r, c]) => [r, c])
      : null,
    dailyId: typeof board.dailyId === 'string' ? board.dailyId : null,
  });

  const readSessionSave = () => {
    const emptyResult = null;

    try {
      const reject = (clear = false) => {
        if (clear) removeStorage(SESSION_SAVE_KEY);
        return emptyResult;
      };

      const raw = readStorage(SESSION_SAVE_KEY);
      if (!raw) return emptyResult;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyResult;
      const parsedVersion = Number.isInteger(parsed.version) ? parsed.version : null;
      if (parsedVersion !== SESSION_SAVE_VERSION) return reject(true);

      const board = normalizeSavedSingleBoard(parsed.board);
      if (!board) return reject(true);
      if (!verifyBoardSignature(board, parsed.sig)) return reject(true);
      if (!isSavedLevelAllowed(board.levelIndex)) return reject(true);
      if (
        Number.isInteger(dailyAbsIndex)
        && board.levelIndex === dailyAbsIndex
        && board.dailyId !== activeDailyId
      ) {
        return reject(true);
      }

      return board;
    } catch {
      removeStorage(SESSION_SAVE_KEY);
      return emptyResult;
    }
  };

  const writeCampaignProgress = (value) => {
    campaignProgressCache = clampCampaignProgress(value);
    const payload = { version: LEVEL_PROGRESS_VERSION, latestLevel: campaignProgressCache };
    writeStorage(LEVEL_PROGRESS_KEY, JSON.stringify(payload));
  };

  const writeInfiniteProgress = (value) => {
    infiniteProgressCache = clampInfiniteProgress(value);
    const payload = { version: INFINITE_PROGRESS_VERSION, latestLevel: infiniteProgressCache };
    writeStorage(INFINITE_PROGRESS_KEY, JSON.stringify(payload));
  };

  const writeTheme = (theme) => {
    const normalized = normalizeTheme(theme) || DEFAULT_THEME;
    cachedTheme = normalized;
    writeStorage(THEME_KEY, normalized);
  };

  const writeDailySolvedDate = (dailyId) => {
    dailySolvedDateCache = typeof dailyId === 'string' ? dailyId : '';
    const payload = {
      version: DAILY_SOLVED_VERSION,
      dailyId: dailySolvedDateCache,
    };
    writeStorage(DAILY_SOLVED_KEY, JSON.stringify(payload));
  };

  const writeHiddenPanel = (panel, hidden) => {
    const key = PANEL_KEY_BY_NAME[panel];
    if (!key) return;
    writeStorage(key, hidden ? '1' : '0');
  };

  const writeSessionBoard = (board) => {
    if (!board) {
      removeStorage(SESSION_SAVE_KEY);
      return;
    }

    const normalized = normalizeSavedSingleBoard(board);
    if (!normalized) {
      removeStorage(SESSION_SAVE_KEY);
      return;
    }

    const persistedState = {
      ...normalized,
      dailyId: (
        Number.isInteger(dailyAbsIndex)
        && normalized.levelIndex === dailyAbsIndex
        && activeDailyId
      )
        ? activeDailyId
        : null,
    };

    const persistedBoard = toPersistedBoardState(persistedState);
    writeStorage(
      SESSION_SAVE_KEY,
      JSON.stringify({
        version: SESSION_SAVE_VERSION,
        board: persistedBoard,
        sig: signBoard(persistedState),
      }),
    );
  };

  const clearSessionBoard = () => {
    removeStorage(SESSION_SAVE_KEY);
  };

  const readBootState = () => {
    const campaignProgress = readCampaignProgress();
    const infiniteProgress = readInfiniteProgress();

    return {
      theme: readTheme(),
      hiddenPanels: {
        guide: getHiddenPanel('guide'),
        legend: getHiddenPanel('legend'),
      },
      campaignProgress,
      infiniteProgress,
      dailySolvedDate: readDailySolvedDate() || null,
      sessionBoard: readSessionSave(),
    };
  };

  return {
    readBootState,
    writeTheme,
    writeHiddenPanel,
    writeCampaignProgress,
    writeInfiniteProgress,
    writeDailySolvedDate,
    writeSessionBoard,
    clearSessionBoard,
  };
}

export const STORAGE_KEYS = Object.freeze({
  GUIDE_KEY,
  LEGEND_KEY,
  LEVEL_PROGRESS_KEY,
  INFINITE_PROGRESS_KEY,
  DAILY_SOLVED_KEY,
  THEME_KEY,
  SESSION_SAVE_KEY,
  SESSION_SEAL_KEY,
});

export const STORAGE_DEFAULTS = Object.freeze({
  DEFAULT_THEME,
  DAILY_SOLVED_VERSION,
  SESSION_SAVE_VERSION,
  SESSION_SIG_HEX_LEN,
  DEFAULT_HIDDEN_BY_PANEL,
});
