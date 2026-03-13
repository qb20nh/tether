import { normalizeScoreState } from '../runtime/score_manager.ts';
import { hashString32, mix32 } from '../shared/hash32.ts';
import type {
  BootState,
  GridTuple,
  PersistencePort,
  RuntimeData,
  RuntimeTheme,
  SessionBoardState,
  StorageLike,
} from '../contracts/ports.ts';

const normalizeScoreStateTyped = normalizeScoreState as unknown as (value: unknown) => RuntimeData;

const GUIDE_KEY = 'tetherGuideHidden';
const LEGEND_KEY = 'tetherLegendHidden';
const LEVEL_PROGRESS_KEY = 'tetherLevelProgress';
const LEVEL_PROGRESS_VERSION = 1;
const INFINITE_PROGRESS_KEY = 'tetherInfiniteProgress';
const INFINITE_PROGRESS_VERSION = 1;
const DAILY_SOLVED_KEY = 'tetherDailySolved';
const DAILY_SOLVED_VERSION = 1;
const SCORE_STATE_KEY = 'tetherScoreState';
const SCORE_STATE_VERSION = 1;
const THEME_KEY = 'tetherTheme';
const LOW_POWER_MODE_KEY = 'tetherLowPowerMode';
const KEYBOARD_GAMEPAD_CONTROLS_KEY = 'tetherKeyboardGamepadControls';
const SESSION_SAVE_KEY = 'tetherSessionSave';
const SESSION_SEAL_KEY = 'tetherSessionSeal';
const SESSION_SAVE_VERSION = 3;
const SESSION_SIG_HEX_LEN = 24;
const DEFAULT_THEME: RuntimeTheme = 'dark';
type PanelName = 'guide' | 'legend';
type PathDirToken = keyof typeof PATH_DELTA_FROM_DIR;
type SavedPathEntry = GridTuple;
type SavedMutableState = Pick<SessionBoardState, 'path' | 'movableWalls'>;

interface SignedPersistedBoardEnvelope {
  version: number;
  board: unknown;
  sig: unknown;
}

interface PersistedBoardRecord {
  levelIndex?: unknown;
  path?: unknown;
  movableWalls?: unknown;
  dailyId?: unknown;
}

interface StorageWindowLike {
  localStorage?: StorageLike | null;
  matchMedia?: (query: string) => { matches: boolean };
  crypto?: {
    getRandomValues?: (array: Uint8Array) => Uint8Array | void;
  };
}

interface CreateLocalStoragePersistenceOptions {
  windowObj?: StorageWindowLike | null;
  storage?: StorageLike | null;
  campaignLevelCount?: number;
  maxInfiniteIndex?: number;
  dailyAbsIndex?: number | null;
  activeDailyId?: string | null;
}

const PANEL_KEY_BY_NAME: Readonly<Record<PanelName, string>> = Object.freeze({
  guide: GUIDE_KEY,
  legend: LEGEND_KEY,
});

const DEFAULT_HIDDEN_BY_PANEL: Readonly<Record<PanelName, boolean>> = Object.freeze({
  guide: false,
  legend: true,
});

const PATH_DIR_FROM_DELTA: Readonly<Record<string, PathDirToken>> = Object.freeze({
  '-1,0': 'u',
  '1,0': 'd',
  '0,-1': 'l',
  '0,1': 'r',
  '-1,-1': 'q',
  '-1,1': 'e',
  '1,-1': 'z',
  '1,1': 'c',
});

const PATH_DELTA_FROM_DIR: Readonly<Record<string, GridTuple>> = Object.freeze({
  u: [-1, 0],
  d: [1, 0],
  l: [0, -1],
  r: [0, 1],
  q: [-1, -1],
  e: [-1, 1],
  z: [1, -1],
  c: [1, 1],
});

const normalizeTheme = (theme: unknown): RuntimeTheme | null => (
  theme === 'light' || theme === 'dark' ? theme : null
);

const toHex32 = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');

const secureEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.codePointAt(i) || 0) ^ (b.codePointAt(i) || 0);
  }
  return diff === 0;
};

const normalizeSavedPathEntry = (entry: unknown): SavedPathEntry | null => {
  const entryRecord = (!Array.isArray(entry) && entry && typeof entry === 'object')
    ? entry as { r?: unknown; c?: unknown }
    : null;
  const r = Array.isArray(entry) ? entry[0] : entryRecord?.r;
  const c = Array.isArray(entry) ? entry[1] : entryRecord?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return [r, c];
};

const getPathSegmentCount = (path: unknown): number => (Array.isArray(path) ? Math.max(0, path.length - 1) : 0);
const canonicalizeSessionPath = (path: SavedPathEntry[]): SavedPathEntry[] => (
  getPathSegmentCount(path) <= 0 ? [] : path
);

const encodePathCompact = (path: unknown): string => {
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

const decodePathCompact = (value: unknown): SavedPathEntry[] | null => {
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

  const points: SavedPathEntry[] = [[startR, startC]];
  let r = startR;
  let c = startC;

  for (const element of dirs) {
    const delta = PATH_DELTA_FROM_DIR[element];
    if (!delta) return null;
    r += delta[0];
    c += delta[1];
    points.push([r, c]);
  }

  return points;
};

const detectSystemTheme = (windowObj: StorageWindowLike | null | undefined): RuntimeTheme => {
  try {
    if (windowObj?.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    if (windowObj?.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // Unsupported environment.
  }
  return DEFAULT_THEME;
};

const randomHex = (windowObj: StorageWindowLike | null | undefined, byteLength = 16): string => {
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

export function createLocalStoragePersistence(
  options: CreateLocalStoragePersistenceOptions = {},
): PersistencePort {
  const windowObj: StorageWindowLike | null = options.windowObj || (
    typeof window === 'undefined'
      ? null
      : window as unknown as StorageWindowLike
  );
  const storage = options.storage || windowObj?.localStorage || null;
  const campaignLevelCount = Number.isInteger(options.campaignLevelCount)
    ? Number(options.campaignLevelCount)
    : 0;
  const maxInfiniteIndex = Number.isInteger(options.maxInfiniteIndex)
    ? Number(options.maxInfiniteIndex)
    : 0;
  const dailyAbsIndex = Number.isInteger(options.dailyAbsIndex)
    ? Number(options.dailyAbsIndex)
    : null;
  const activeDailyId = typeof options.activeDailyId === 'string' && options.activeDailyId.length > 0
    ? options.activeDailyId
    : null;

  let campaignProgressCache: number | null = null;
  let infiniteProgressCache: number | null = null;
  let dailySolvedDateCache: string | null = null;
  let scoreStateCache: RuntimeData | null = null;
  let cachedTheme: RuntimeTheme | null = null;
  let cachedLowPowerModeEnabled: boolean | null = null;
  let cachedKeyboardGamepadControlsEnabled: boolean | null = null;
  let cachedSessionSeal: string | null = null;
  let volatileSessionSeal: string | null = null;

  const readStorage = (key: string): string | null => {
    if (!storage) return null;
    try {
      return storage.getItem?.(key) ?? null;
    } catch {
      return null;
    }
  };

  const writeStorage = (key: string, value: string): void => {
    if (!storage) return;
    try {
      storage.setItem?.(key, value);
    } catch {
      // localStorage might be unavailable.
    }
  };

  const removeStorage = (key: string): void => {
    if (!storage) return;
    try {
      storage.removeItem?.(key);
    } catch {
      // localStorage might be unavailable.
    }
  };

  const clampCampaignProgress = (value: unknown): number => {
    if (!Number.isInteger(value)) return 0;
    const resolvedValue = Number(value);
    return Math.min(Math.max(resolvedValue, 0), campaignLevelCount);
  };

  const clampInfiniteProgress = (value: unknown): number => {
    if (!Number.isInteger(value)) return 0;
    const resolvedValue = Number(value);
    return Math.min(Math.max(resolvedValue, 0), maxInfiniteIndex);
  };

  const clampSavedLevelIndex = (value: unknown): number | null => {
    if (!Number.isInteger(value)) return null;
    const resolvedValue = Number(value);
    const maxIndex = Number.isInteger(dailyAbsIndex)
      ? Number(dailyAbsIndex)
      : (campaignLevelCount + maxInfiniteIndex);
    return Math.min(Math.max(resolvedValue, 0), maxIndex);
  };

  const readVersionedLevelProgress = (
    key: string,
    version: number,
    clampValue: (value: unknown) => number,
  ): number => {
    try {
      const raw = readStorage(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return 0;
      if (Object.hasOwn(parsed, 'version') && parsed.version !== version) {
        return 0;
      }
      return clampValue(parsed.latestLevel);
    } catch {
      return 0;
    }
  };

  const readCampaignProgress = (): number => {
    if (campaignProgressCache !== null) return campaignProgressCache;
    campaignProgressCache = readVersionedLevelProgress(
      LEVEL_PROGRESS_KEY,
      LEVEL_PROGRESS_VERSION,
      clampCampaignProgress,
    );
    return campaignProgressCache;
  };

  const readInfiniteProgress = (): number => {
    if (infiniteProgressCache !== null) return infiniteProgressCache;
    infiniteProgressCache = readVersionedLevelProgress(
      INFINITE_PROGRESS_KEY,
      INFINITE_PROGRESS_VERSION,
      clampInfiniteProgress,
    );
    return infiniteProgressCache;
  };

  const readDailySolvedDate = (): string => {
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
      return dailySolvedDateCache || '';
    } catch {
      dailySolvedDateCache = '';
      return dailySolvedDateCache;
    }
  };

  const readScoreState = (): RuntimeData => {
    if (scoreStateCache !== null) return normalizeScoreStateTyped(scoreStateCache);
    try {
      const raw = readStorage(SCORE_STATE_KEY);
      if (!raw) {
        scoreStateCache = normalizeScoreStateTyped({});
        return normalizeScoreStateTyped(scoreStateCache);
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        scoreStateCache = normalizeScoreStateTyped({});
        return normalizeScoreStateTyped(scoreStateCache);
      }
      if (Number.isInteger(parsed.version) && parsed.version !== SCORE_STATE_VERSION) {
        scoreStateCache = normalizeScoreStateTyped({});
        return normalizeScoreStateTyped(scoreStateCache);
      }
      scoreStateCache = normalizeScoreStateTyped(parsed);
      return normalizeScoreStateTyped(scoreStateCache);
    } catch {
      scoreStateCache = normalizeScoreStateTyped({});
      return normalizeScoreStateTyped(scoreStateCache);
    }
  };

  const getHiddenPanel = (panel: PanelName): boolean => {
    const key = PANEL_KEY_BY_NAME[panel];
    const raw = readStorage(key);
    if (raw === null) return DEFAULT_HIDDEN_BY_PANEL[panel] === true;
    return raw === '1';
  };

  const readTheme = (): RuntimeTheme => {
    if (cachedTheme) return cachedTheme;
    const stored = normalizeTheme(readStorage(THEME_KEY));
    if (stored) {
      cachedTheme = stored;
      return cachedTheme;
    }
    cachedTheme = detectSystemTheme(windowObj);
    return cachedTheme;
  };

  const readLowPowerModeEnabled = (): boolean => {
    if (cachedLowPowerModeEnabled !== null) return cachedLowPowerModeEnabled;
    cachedLowPowerModeEnabled = readStorage(LOW_POWER_MODE_KEY) === '1';
    return cachedLowPowerModeEnabled;
  };

  const readKeyboardGamepadControlsEnabled = (): boolean => {
    if (cachedKeyboardGamepadControlsEnabled !== null) return cachedKeyboardGamepadControlsEnabled;
    cachedKeyboardGamepadControlsEnabled = readStorage(KEYBOARD_GAMEPAD_CONTROLS_KEY) === '1';
    return cachedKeyboardGamepadControlsEnabled;
  };

  const getSessionSeal = (): string => {
    if (cachedSessionSeal) return cachedSessionSeal;
    const isHex = (value: unknown): value is string => (
      typeof value === 'string' && /^[0-9a-f]{16,128}$/i.test(value)
    );

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

  const isSavedLevelAllowed = (levelIndex: unknown): boolean => {
    if (!Number.isInteger(levelIndex)) return false;
    const resolvedLevelIndex = Number(levelIndex);

    if (Number.isInteger(dailyAbsIndex) && resolvedLevelIndex === dailyAbsIndex) {
      return Boolean(activeDailyId);
    }

    if (resolvedLevelIndex < campaignLevelCount) {
      return resolvedLevelIndex <= readCampaignProgress();
    }

    const infiniteIndex = resolvedLevelIndex - campaignLevelCount;
    if (!Number.isInteger(infiniteIndex) || infiniteIndex < 0) return false;
    return infiniteIndex <= clampInfiniteProgress(readInfiniteProgress());
  };

  const normalizeSavedMutableState = (value: unknown): SavedMutableState | null => {
    if (!value || typeof value !== 'object') return null;
    const source = value as PersistedBoardRecord;

    let rawPath: unknown = [];
    if (typeof source.path === 'string') {
      rawPath = decodePathCompact(source.path);
    } else if (Array.isArray(source.path)) {
      rawPath = source.path;
    }
    if (!Array.isArray(rawPath)) return null;

    const path: SavedPathEntry[] = [];
    for (const element of rawPath) {
      const normalized = normalizeSavedPathEntry(element);
      if (!normalized) return null;
      path.push(normalized);
    }

    let movableWalls: SavedPathEntry[] | null = null;
    if (source.movableWalls !== undefined) {
      if (!Array.isArray(source.movableWalls)) return null;
      movableWalls = [];
      for (const element of source.movableWalls) {
        const normalized = normalizeSavedPathEntry(element);
        if (!normalized) return null;
        movableWalls.push(normalized);
      }
    }

    return { path, movableWalls };
  };

  const normalizeSavedSingleBoard = (value: unknown): SessionBoardState | null => {
    if (!value || typeof value !== 'object') return null;
    const source = value as PersistedBoardRecord;
    const levelIndex = clampSavedLevelIndex(source.levelIndex);
    if (levelIndex === null) return null;
    const mutable = normalizeSavedMutableState(value);
    if (!mutable) return null;
    return {
      levelIndex,
      path: mutable.path,
      movableWalls: mutable.movableWalls,
      dailyId: typeof source.dailyId === 'string' ? source.dailyId : null,
    };
  };

  const buildBoardSignaturePayload = (board: unknown): string => {
    if (!board || typeof board !== 'object') return '';
    const source = board as PersistedBoardRecord;
    const levelIndex = Number.isInteger(source.levelIndex) ? source.levelIndex : -1;
    const pathEntries = Array.isArray(source.path)
      ? source.path
          .map((entry: unknown) => normalizeSavedPathEntry(entry))
          .filter((entry): entry is SavedPathEntry => entry !== null)
      : [];
    const path = pathEntries.length > 0
      ? pathEntries
        .map(([r, c]: SavedPathEntry) => `${r},${c}`)
        .join(';')
      : '';
    const movableEntries = Array.isArray(source.movableWalls)
      ? source.movableWalls
          .map((entry: unknown) => normalizeSavedPathEntry(entry))
          .filter((entry): entry is SavedPathEntry => entry !== null)
      : [];
    const movableWalls = movableEntries.length > 0
      ? movableEntries
        .map(([r, c]: SavedPathEntry) => `${r},${c}`)
        .sort()
        .join(';')
      : '';
    const dailyId = typeof source.dailyId === 'string' ? source.dailyId : '';
    return `v=${SESSION_SAVE_VERSION}|l=${levelIndex}|p=${path}|m=${movableWalls}|d=${dailyId}`;
  };

  const computeBoardSignature = (board: SessionBoardState, seal: string | null): string => {
    if (!seal) return '';
    const payload = buildBoardSignaturePayload(board);
    const laneA = mix32(hashString32(`${seal}|${payload}|a`));
    const laneB = mix32(hashString32(`${payload}|${seal}|b`));
    const laneC = mix32(hashString32(`${seal.length}:${payload}|c`));
    return `${toHex32(laneA)}${toHex32(laneB)}${toHex32(laneC)}`;
  };

  const signBoard = (board: SessionBoardState): string => computeBoardSignature(board, getSessionSeal());

  const verifyBoardSignature = (board: SessionBoardState, signature: unknown): boolean => {
    if (typeof signature !== 'string') return false;
    const normalizedSig = signature.trim().toLowerCase();
    if (!/^[0-9a-f]+$/i.test(normalizedSig)) return false;
    if (normalizedSig.length !== SESSION_SIG_HEX_LEN) return false;
    const expected = signBoard(board);
    return secureEqual(expected, normalizedSig);
  };

  const toPersistedBoardState = (board: SessionBoardState) => ({
    levelIndex: board.levelIndex,
    path: encodePathCompact(board.path),
    movableWalls: Array.isArray(board.movableWalls)
      ? board.movableWalls.map(([r, c]: SavedPathEntry): SavedPathEntry => [r, c])
      : null,
    dailyId: typeof board.dailyId === 'string' ? board.dailyId : null,
  });

  const persistSignedBoard = (board: SessionBoardState): void => {
    const persistedBoard = toPersistedBoardState(board);
    writeStorage(
      SESSION_SAVE_KEY,
      JSON.stringify({
        version: SESSION_SAVE_VERSION,
        board: persistedBoard,
        sig: signBoard(board),
      }),
    );
  };

  const readSessionSave = (): SessionBoardState | null => {
    const emptyResult: SessionBoardState | null = null;

    try {
      const reject = (clear = false): SessionBoardState | null => {
        if (clear) removeStorage(SESSION_SAVE_KEY);
        return emptyResult;
      };

      const raw = readStorage(SESSION_SAVE_KEY);
      if (!raw) return emptyResult;

      const parsed = JSON.parse(raw) as Partial<SignedPersistedBoardEnvelope> | null;
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

      const normalizedPath = canonicalizeSessionPath(board.path);
      if (normalizedPath !== board.path) {
        const sanitizedBoard = {
          ...board,
          path: normalizedPath,
        };
        persistSignedBoard(sanitizedBoard);
        return sanitizedBoard;
      }

      return board;
    } catch {
      removeStorage(SESSION_SAVE_KEY);
      return emptyResult;
    }
  };

  const writeCampaignProgress = (value: number): void => {
    campaignProgressCache = clampCampaignProgress(value);
    const payload = { version: LEVEL_PROGRESS_VERSION, latestLevel: campaignProgressCache };
    writeStorage(LEVEL_PROGRESS_KEY, JSON.stringify(payload));
  };

  const writeInfiniteProgress = (value: number): void => {
    infiniteProgressCache = clampInfiniteProgress(value);
    const payload = { version: INFINITE_PROGRESS_VERSION, latestLevel: infiniteProgressCache };
    writeStorage(INFINITE_PROGRESS_KEY, JSON.stringify(payload));
  };

  const writeTheme = (theme: string): void => {
    const normalized = normalizeTheme(theme) || DEFAULT_THEME;
    cachedTheme = normalized;
    writeStorage(THEME_KEY, normalized);
  };

  const writeLowPowerModeEnabled = (enabled: boolean): void => {
    cachedLowPowerModeEnabled = Boolean(enabled);
    writeStorage(LOW_POWER_MODE_KEY, cachedLowPowerModeEnabled ? '1' : '0');
  };

  const writeKeyboardGamepadControlsEnabled = (enabled: boolean): void => {
    cachedKeyboardGamepadControlsEnabled = Boolean(enabled);
    writeStorage(KEYBOARD_GAMEPAD_CONTROLS_KEY, cachedKeyboardGamepadControlsEnabled ? '1' : '0');
  };

  const writeDailySolvedDate = (dailyId: string): void => {
    dailySolvedDateCache = typeof dailyId === 'string' ? dailyId : '';
    const payload = {
      version: DAILY_SOLVED_VERSION,
      dailyId: dailySolvedDateCache,
    };
    writeStorage(DAILY_SOLVED_KEY, JSON.stringify(payload));
  };

  const writeScoreState = (scoreState: RuntimeData): void => {
    scoreStateCache = normalizeScoreStateTyped(scoreState);
    const payload = {
      version: SCORE_STATE_VERSION,
      ...scoreStateCache,
    };
    writeStorage(SCORE_STATE_KEY, JSON.stringify(payload));
  };

  const writeHiddenPanel = (panel: PanelName, hidden: boolean): void => {
    const key = PANEL_KEY_BY_NAME[panel];
    writeStorage(key, hidden ? '1' : '0');
  };

  const writeSessionBoard = (board: SessionBoardState): void => {
    if (!board) {
      removeStorage(SESSION_SAVE_KEY);
      return;
    }

    const normalized = normalizeSavedSingleBoard(board);
    if (!normalized) {
      removeStorage(SESSION_SAVE_KEY);
      return;
    }
    const normalizedPath = canonicalizeSessionPath(normalized.path);

    const persistedState = {
      ...normalized,
      path: normalizedPath,
      dailyId: (
        Number.isInteger(dailyAbsIndex)
        && normalized.levelIndex === dailyAbsIndex
        && activeDailyId
      )
        ? activeDailyId
        : null,
    };
    persistSignedBoard(persistedState);
  };

  const clearSessionBoard = (): void => {
    removeStorage(SESSION_SAVE_KEY);
  };

  const readBootState = (): BootState => {
    const campaignProgress = readCampaignProgress();
    const infiniteProgress = readInfiniteProgress();

    return {
      theme: readTheme(),
      lowPowerModeEnabled: readLowPowerModeEnabled(),
      keyboardGamepadControlsEnabled: readKeyboardGamepadControlsEnabled(),
      hiddenPanels: {
        guide: getHiddenPanel('guide'),
        legend: getHiddenPanel('legend'),
      },
      campaignProgress,
      infiniteProgress,
      dailySolvedDate: readDailySolvedDate() || null,
      scoreState: readScoreState(),
      sessionBoard: readSessionSave(),
    };
  };

  return {
    readBootState,
    writeTheme,
    writeLowPowerModeEnabled,
    writeKeyboardGamepadControlsEnabled,
    writeHiddenPanel,
    writeCampaignProgress,
    writeInfiniteProgress,
    writeDailySolvedDate,
    writeScoreState,
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
  SCORE_STATE_KEY,
  THEME_KEY,
  LOW_POWER_MODE_KEY,
  KEYBOARD_GAMEPAD_CONTROLS_KEY,
  SESSION_SAVE_KEY,
  SESSION_SEAL_KEY,
});

export const STORAGE_DEFAULTS = Object.freeze({
  DEFAULT_THEME,
  DAILY_SOLVED_VERSION,
  SCORE_STATE_VERSION,
  SESSION_SAVE_VERSION,
  SESSION_SIG_HEX_LEN,
  DEFAULT_HIDDEN_BY_PANEL,
});
