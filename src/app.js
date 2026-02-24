import { mountStyles } from './styles.js';
import { APP_SHELL_TEMPLATE, buildLegendTemplate } from './templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './icons.js';
import { LEVELS } from './levels.js';
import { INFINITE_MAX_LEVELS, generateInfiniteLevel } from './infinite.js';
import { baseGoalText, ELEMENT_IDS } from './config.js';
import { createGameState } from './state.js';
import {
  cacheElements,
  buildGrid,
  updateCells,
  setLegendIcons,
  resizeCanvas,
  setMessage,
} from './renderer.js';
import { bindInputHandlers } from './input.js';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from './rules.js';
import {
  getLocaleOptions,
  getLocale,
  resolveLocale,
  setLocale,
  t as createTranslator,
} from './i18n.js';

const GUIDE_KEY = 'tetherGuideHidden';
const LEGEND_KEY = 'tetherLegendHidden';
const LEVEL_PROGRESS_KEY = 'tetherLevelProgress';
const LEVEL_PROGRESS_VERSION = 1;
const INFINITE_PROGRESS_KEY = 'tetherInfiniteProgress';
const INFINITE_PROGRESS_VERSION = 1;
const THEME_KEY = 'tetherTheme';
const SESSION_SAVE_KEY = 'tetherSessionSave';
const SESSION_SEAL_KEY = 'tetherSessionSeal';
const SESSION_SAVE_VERSION = 2;
const SESSION_SIG_HEX_LEN = 24;
const DEFAULT_THEME = 'dark';
const CAMPAIGN_LEVEL_COUNT = LEVELS.length;
const MAX_INFINITE_INDEX = INFINITE_MAX_LEVELS - 1;
const MAX_ABSOLUTE_LEVEL_INDEX = CAMPAIGN_LEVEL_COUNT + MAX_INFINITE_INDEX;
const INFINITE_LEVEL_CACHE_LIMIT = 48;
const PATH_BRACKET_TUTORIAL_LEVEL_INDEX = 0;
const MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX = 7;
const DEFAULT_HIDDEN_BY_KEY = {
  [GUIDE_KEY]: false,
  [LEGEND_KEY]: true,
};
let levelProgress = null;
let infiniteProgress = null;
let cachedTheme = null;

const getHiddenState = (key) => {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return DEFAULT_HIDDEN_BY_KEY[key] === true;
    return value === '1';
  } catch {
    return DEFAULT_HIDDEN_BY_KEY[key] === true;
  }
};

const setHiddenState = (key, value) => {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // localStorage might be unavailable in restricted environments.
  }
};

const normalizeTheme = (theme) => (theme === 'light' || theme === 'dark' ? theme : null);

const detectSystemTheme = () => {
  try {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // No media access or unsupported browser.
  }
  return DEFAULT_THEME;
};

const readTheme = () => {
  if (cachedTheme) return cachedTheme;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    const normalized = normalizeTheme(stored);
    if (normalized) {
      cachedTheme = normalized;
      return cachedTheme;
    }
  } catch {
    // localStorage might be unavailable in restricted environments.
  }
  cachedTheme = detectSystemTheme();
  return cachedTheme;
};

const writeTheme = (theme) => {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage might be unavailable in restricted environments.
  }
};

const applyTheme = (theme) => {
  const normalized = normalizeTheme(theme) || DEFAULT_THEME;
  cachedTheme = normalized;
  const root = document.documentElement;
  root.dataset.theme = normalized;
  root.classList.toggle('theme-light', normalized === 'light');
  writeTheme(normalized);
};

const normalizeProgressState = (value) => {
  if (!value || typeof value !== 'object') return 0;
  if (Number.isInteger(value.latestLevel)) {
    return Math.min(Math.max(value.latestLevel, 0), CAMPAIGN_LEVEL_COUNT);
  }
  return 0;
};

const readLevelProgress = () => {
  if (levelProgress !== null) return levelProgress;

  try {
    const raw = window.localStorage.getItem(LEVEL_PROGRESS_KEY);
    if (!raw) {
      levelProgress = 0;
      return levelProgress;
    }
    const parsed = JSON.parse(raw);
    levelProgress = normalizeProgressState(parsed);
    return levelProgress;
  } catch {
    levelProgress = 0;
    return levelProgress;
  }
};

const writeLevelProgress = () => {
  try {
    const payload = { version: LEVEL_PROGRESS_VERSION, latestLevel: levelProgress };
    window.localStorage.setItem(LEVEL_PROGRESS_KEY, JSON.stringify(payload));
  } catch {
    // localStorage might be unavailable in restricted environments.
  }
};

const normalizeInfiniteProgressState = (value) => {
  if (!value || typeof value !== 'object') return 0;
  if (Number.isInteger(value.latestLevel)) {
    return Math.min(Math.max(value.latestLevel, 0), MAX_INFINITE_INDEX);
  }
  return 0;
};

const readInfiniteProgress = () => {
  if (infiniteProgress !== null) return infiniteProgress;

  try {
    const raw = window.localStorage.getItem(INFINITE_PROGRESS_KEY);
    if (!raw) {
      infiniteProgress = 0;
      return infiniteProgress;
    }
    const parsed = JSON.parse(raw);
    infiniteProgress = normalizeInfiniteProgressState(parsed);
    return infiniteProgress;
  } catch {
    infiniteProgress = 0;
    return infiniteProgress;
  }
};

const writeInfiniteProgress = () => {
  try {
    const payload = { version: INFINITE_PROGRESS_VERSION, latestLevel: infiniteProgress };
    window.localStorage.setItem(INFINITE_PROGRESS_KEY, JSON.stringify(payload));
  } catch {
    // localStorage might be unavailable in restricted environments.
  }
};

const isSavedLevelAllowed = (levelIndex) => {
  if (!Number.isInteger(levelIndex)) return false;

  if (levelIndex < CAMPAIGN_LEVEL_COUNT) {
    return levelIndex <= readLevelProgress();
  }

  if (readLevelProgress() < CAMPAIGN_LEVEL_COUNT) return false;
  const infiniteIndex = levelIndex - CAMPAIGN_LEVEL_COUNT;
  if (!Number.isInteger(infiniteIndex) || infiniteIndex < 0) return false;
  return infiniteIndex <= Math.min(Math.max(readInfiniteProgress(), 0), MAX_INFINITE_INDEX);
};

const clampSavedLevelIndex = (value) => {
  if (!Number.isInteger(value)) return null;
  return Math.min(Math.max(value, 0), MAX_ABSOLUTE_LEVEL_INDEX);
};

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

const randomHex = (byteLength = 16) => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let out = '';
  for (let i = 0; i < byteLength * 2; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
};

let cachedSessionSeal = null;
let volatileSessionSeal = null;

const getSessionSeal = () => {
  if (cachedSessionSeal) return cachedSessionSeal;

  const isHex = (value) => typeof value === 'string' && /^[0-9a-f]{16,128}$/i.test(value);
  try {
    const stored = window.localStorage.getItem(SESSION_SEAL_KEY);
    if (isHex(stored)) {
      cachedSessionSeal = stored.toLowerCase();
      return cachedSessionSeal;
    }

    const created = randomHex(24);
    window.localStorage.setItem(SESSION_SEAL_KEY, created);
    cachedSessionSeal = created;
    return cachedSessionSeal;
  } catch {
    if (!volatileSessionSeal) volatileSessionSeal = randomHex(24);
    return volatileSessionSeal;
  }
};

const normalizeSavedPathEntry = (entry) => {
  const r = Array.isArray(entry) ? entry[0] : entry?.r;
  const c = Array.isArray(entry) ? entry[1] : entry?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return [r, c];
};

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

  return {
    path,
    movableWalls,
  };
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
  return `v=${SESSION_SAVE_VERSION}|l=${levelIndex}|p=${path}|m=${movableWalls}`;
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
});

const readSessionSave = () => {
  const emptyResult = {
    hasData: false,
    board: null,
  };

  try {
    const reject = (clear = false) => {
      if (clear) {
        try {
          window.localStorage.removeItem(SESSION_SAVE_KEY);
        } catch {
          // localStorage might be unavailable in restricted environments.
        }
      }
      return emptyResult;
    };

    const raw = window.localStorage.getItem(SESSION_SAVE_KEY);
    if (!raw) return emptyResult;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyResult;
    const parsedVersion = Number.isInteger(parsed.version) ? parsed.version : null;
    if (parsedVersion !== SESSION_SAVE_VERSION) return reject(true);

    const board = normalizeSavedSingleBoard(parsed.board);
    if (!board) return reject(true);
    if (!verifyBoardSignature(board, parsed.sig)) return reject(true);
    if (!isSavedLevelAllowed(board.levelIndex)) return reject(true);

    return {
      hasData: true,
      board,
    };
  } catch {
    try {
      window.localStorage.removeItem(SESSION_SAVE_KEY);
    } catch {
      // localStorage might be unavailable in restricted environments.
    }
    return emptyResult;
  }
};

const isCampaignLevelUnlocked = (index) => {
  const progress = readLevelProgress();
  return index <= progress;
};

const getLatestCampaignLevelIndex = () => {
  const progress = readLevelProgress();
  return Math.min(progress, CAMPAIGN_LEVEL_COUNT - 1);
};

const markCampaignLevelCleared = (index) => {
  const nextProgress = Math.max(readLevelProgress(), index + 1);
  const clampedProgress = Math.min(nextProgress, CAMPAIGN_LEVEL_COUNT);
  if (clampedProgress === levelProgress) return false;
  levelProgress = clampedProgress;
  writeLevelProgress();
  return true;
};

const markInfiniteLevelCleared = (infiniteIndex) => {
  const nextProgress = Math.min(MAX_INFINITE_INDEX, Math.max(readInfiniteProgress(), infiniteIndex + 1));
  if (nextProgress === infiniteProgress) return false;
  infiniteProgress = nextProgress;
  writeInfiniteProgress();
  return true;
};

const isCampaignCompleted = () => readLevelProgress() >= CAMPAIGN_LEVEL_COUNT;

const isRtlLocale = (locale) => /^ar/i.test(locale || '');

const applyTextDirection = (locale) => {
  const direction = isRtlLocale(locale) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', direction);
};

const resolveLevelName = (level, translate) => {
  if (level?.nameKey) {
    const translated = translate(level.nameKey);
    if (translated !== level.nameKey) return translated;
  }
  return level?.name || '';
};

const applyPanelVisibility = (panelEl, buttonEl, isHidden, translate) => {
  if (!panelEl || !buttonEl) return;
  panelEl.classList.toggle('is-hidden', isHidden);
  buttonEl.textContent = isHidden ? translate('ui.show') : translate('ui.hide');
  buttonEl.setAttribute('aria-expanded', String(!isHidden));
};

const wirePanelToggle = (panelEl, buttonEl, storageKey, translate, onToggle = () => { }) => {
  if (!panelEl || !buttonEl) return;

  const initialHidden = getHiddenState(storageKey);
  applyPanelVisibility(panelEl, buttonEl, initialHidden, translate);

  buttonEl.addEventListener('click', () => {
    const nextHidden = !panelEl.classList.contains('is-hidden');
    applyPanelVisibility(panelEl, buttonEl, nextHidden, translate);
    setHiddenState(storageKey, nextHidden);
    onToggle(nextHidden);
  });
};

const applyDataAttributes = (appEl, translate) => {
  if (!appEl) return;

  appEl.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = translate(key);
  });

  appEl.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', translate(key));
  });

  appEl.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', translate(key));
  });
};

function makeEvaluators(snapshot, evaluateOptions = {}) {
  return {
    hintStatus: evaluateHints(snapshot, evaluateOptions),
    stitchStatus: evaluateStitches(snapshot),
    rpsStatus: evaluateRPS(snapshot),
    blockedStatus: evaluateBlockedCells(snapshot),
  };
}

function updateWithEvaluation(refs, snapshot, evaluateResult, shouldValidate, translate, options = {}) {
  const {
    getLevelForIndex = () => null,
    onLevelCleared = () => { },
  } = options;

  updateCells(snapshot, evaluateResult, refs);
  if (!shouldValidate) return null;
  const completion = checkCompletion(snapshot, evaluateResult, translate);
  if (completion.kind === 'good') {
    onLevelCleared(snapshot.levelIndex);
    setMessage(refs.msgEl, completion.kind, completion.message);
    return completion;
  }

  setMessage(refs.msgEl, null, baseGoalText(getLevelForIndex(snapshot.levelIndex), translate));
  return completion;
}

export function initTetherApp() {
  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;

  const initialLocale = resolveLocale();
  let activeLocale = initialLocale;
  let activeTheme = readTheme();
  let translate = createTranslator(activeLocale);
  applyTheme(activeTheme);
  document.documentElement.lang = activeLocale;
  applyTextDirection(activeLocale);

  appEl.innerHTML = APP_SHELL_TEMPLATE(translate, getLocaleOptions(activeLocale), activeLocale);
  appEl.querySelector(`#${ELEMENT_IDS.LEGEND}`).innerHTML = buildLegendTemplate(
    BADGE_DEFINITIONS,
    ICONS,
    ICON_X,
    translate,
  );

  const refs = cacheElements();
  const infiniteLevelCache = new Map();
  const INFINITE_PAGE_SIZE = 10;
  const INFINITE_SELECTOR_ACTIONS = Object.freeze({
    first: '__first__',
    prev: '__prev_page__',
    next: '__next_page__',
    last: '__last__',
  });

  const isInfiniteAbsIndex = (index) => index >= CAMPAIGN_LEVEL_COUNT;
  const toInfiniteIndex = (index) => index - CAMPAIGN_LEVEL_COUNT;
  const clampInfiniteIndex = (index) => Math.min(Math.max(index, 0), MAX_INFINITE_INDEX);
  const infinitePageStart = (index) => Math.floor(index / INFINITE_PAGE_SIZE) * INFINITE_PAGE_SIZE;

  const getCachedInfiniteLevel = (infiniteIndex) => {
    const cached = infiniteLevelCache.get(infiniteIndex);
    if (!cached) return null;
    infiniteLevelCache.delete(infiniteIndex);
    infiniteLevelCache.set(infiniteIndex, cached);
    return cached;
  };

  const putCachedInfiniteLevel = (infiniteIndex, level) => {
    if (infiniteLevelCache.has(infiniteIndex)) {
      infiniteLevelCache.delete(infiniteIndex);
    }
    infiniteLevelCache.set(infiniteIndex, level);
    while (infiniteLevelCache.size > INFINITE_LEVEL_CACHE_LIMIT) {
      const oldest = infiniteLevelCache.keys().next().value;
      infiniteLevelCache.delete(oldest);
    }
  };

  const ensureInfiniteLevel = (infiniteIndex) => {
    const normalizedIndex = clampInfiniteIndex(Number.isInteger(infiniteIndex) ? infiniteIndex : 0);
    const cached = getCachedInfiniteLevel(normalizedIndex);
    if (!cached) {
      putCachedInfiniteLevel(normalizedIndex, generateInfiniteLevel(normalizedIndex));
    }
    return CAMPAIGN_LEVEL_COUNT + normalizedIndex;
  };

  const getLevelAtIndex = (index) => {
    if (!isInfiniteAbsIndex(index)) {
      return LEVELS[index] || null;
    }
    const infiniteIndex = clampInfiniteIndex(toInfiniteIndex(index));
    const cached = getCachedInfiniteLevel(infiniteIndex);
    if (cached) return cached;
    const generated = generateInfiniteLevel(infiniteIndex);
    putCachedInfiniteLevel(infiniteIndex, generated);
    return generated;
  };

  const resolveNextButtonLabel = (levelIndex) => {
    if (isInfiniteAbsIndex(levelIndex)) {
      if (toInfiniteIndex(levelIndex) >= MAX_INFINITE_INDEX) return translate('ui.infiniteComplete');
      return translate('ui.nextInfinite');
    }
    if (levelIndex >= CAMPAIGN_LEVEL_COUNT - 1 && isCampaignCompleted()) return translate('ui.startInfinite');
    return translate('ui.nextLevel');
  };

  const resolveInfiniteModeLabel = () => {
    const raw = translate('ui.infiniteLevelOption', { n: '' });
    return raw.replace(/\s*#\s*$/, '').trim();
  };

  const setDisabledReasonTitle = (buttonEl, reasonKey) => {
    if (!buttonEl) return;
    if (reasonKey) {
      buttonEl.setAttribute('title', translate(reasonKey));
      return;
    }
    buttonEl.removeAttribute('title');
  };

  const isNextLevelAvailable = (levelIndex) => {
    if (isInfiniteAbsIndex(levelIndex)) {
      const infiniteIndex = clampInfiniteIndex(toInfiniteIndex(levelIndex));
      if (infiniteIndex >= MAX_INFINITE_INDEX) return false;
      const latestUnlockedInfiniteIndex = clampInfiniteIndex(readInfiniteProgress());
      return infiniteIndex + 1 <= latestUnlockedInfiniteIndex;
    }

    const nextCampaignIndex = levelIndex + 1;
    if (nextCampaignIndex < CAMPAIGN_LEVEL_COUNT) return true;
    return isCampaignCompleted();
  };

  const isLevelPreviouslyCleared = (levelIndex) => {
    if (isInfiniteAbsIndex(levelIndex)) {
      const infiniteIndex = clampInfiniteIndex(toInfiniteIndex(levelIndex));
      return infiniteIndex < clampInfiniteIndex(readInfiniteProgress());
    }
    return levelIndex < readLevelProgress();
  };

  let currentLevelCleared = false;
  let currentBoardSolved = false;

  const syncInfiniteNavigation = (levelIndex, isCleared = false) => {
    if (!isInfiniteAbsIndex(levelIndex)) {
      if (refs.prevInfiniteBtn) {
        refs.prevInfiniteBtn.hidden = true;
        refs.prevInfiniteBtn.disabled = false;
        setDisabledReasonTitle(refs.prevInfiniteBtn, null);
      }
    } else {
      const infiniteIndex = clampInfiniteIndex(toInfiniteIndex(levelIndex));
      if (refs.prevInfiniteBtn) {
        refs.prevInfiniteBtn.hidden = false;
        refs.prevInfiniteBtn.disabled = infiniteIndex <= 0;
        setDisabledReasonTitle(
          refs.prevInfiniteBtn,
          refs.prevInfiniteBtn.disabled ? 'ui.prevInfiniteDisabledFirst' : null,
        );
      }
    }

    if (refs.nextLevelBtn) {
      const nextAvailable = isNextLevelAvailable(levelIndex);
      const atInfiniteEnd = isInfiniteAbsIndex(levelIndex)
        && clampInfiniteIndex(toInfiniteIndex(levelIndex)) >= MAX_INFINITE_INDEX;
      let nextDisabledReasonKey = null;
      if (!isCleared) nextDisabledReasonKey = 'ui.nextDisabledUncleared';
      else if (!nextAvailable && atInfiniteEnd) nextDisabledReasonKey = 'ui.nextDisabledInfiniteEnd';

      refs.nextLevelBtn.hidden = false;
      refs.nextLevelBtn.textContent = resolveNextButtonLabel(levelIndex);
      refs.nextLevelBtn.disabled = !isCleared || !nextAvailable;
      setDisabledReasonTitle(refs.nextLevelBtn, nextDisabledReasonKey);
    }
  };

  const onLevelCleared = (levelIndex) => {
    if (isInfiniteAbsIndex(levelIndex)) {
      markInfiniteLevelCleared(toInfiniteIndex(levelIndex));
    } else {
      markCampaignLevelCleared(levelIndex);
    }
    currentBoardSolved = true;
    mutableBoardState = null;
    queueSessionSave();
  };

  const sessionSaveData = readSessionSave();
  let mutableBoardState = sessionSaveData.board
    ? {
      levelIndex: sessionSaveData.board.levelIndex,
      path: sessionSaveData.board.path.map(([r, c]) => [r, c]),
      movableWalls: Array.isArray(sessionSaveData.board.movableWalls)
        ? sessionSaveData.board.movableWalls.map(([r, c]) => [r, c])
        : null,
    }
    : null;
  const state = createGameState(getLevelAtIndex);
  setLegendIcons(ICONS, refs, ICON_X);
  let hasLoadedLevel = false;
  let sessionSaveQueued = false;

  const resolveLoadableLevelIndex = (index) => {
    const normalized = clampSavedLevelIndex(index);
    if (!Number.isInteger(normalized)) return null;
    if (isInfiniteAbsIndex(normalized)) {
      return ensureInfiniteLevel(clampInfiniteIndex(toInfiniteIndex(normalized)));
    }
    return Math.min(normalized, CAMPAIGN_LEVEL_COUNT - 1);
  };

  const cloneBoardState = (stateValue) => ({
    levelIndex: stateValue.levelIndex,
    path: stateValue.path.map(([r, c]) => [r, c]),
    movableWalls: Array.isArray(stateValue.movableWalls)
      ? stateValue.movableWalls.map(([r, c]) => [r, c])
      : null,
  });

  const serializeMutableBoardState = (snapshot) => {
    if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return null;

    const level = getLevelAtIndex(snapshot.levelIndex);
    if (!level || !Array.isArray(level.grid)) return null;

    const path = snapshot.path.map((point) => [point.r, point.c]);
    if (path.length === 0) return null;

    const collectMovableWalls = (gridRows) => {
      const walls = [];
      for (let r = 0; r < gridRows.length; r++) {
        const row = gridRows[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] === 'm') walls.push([r, c]);
        }
      }
      return walls;
    };

    const currentMovableWalls = collectMovableWalls(snapshot.gridData);

    return {
      levelIndex: snapshot.levelIndex,
      path,
      movableWalls: currentMovableWalls,
    };
  };

  const syncMutableBoardStateFromSnapshot = (snapshot) => {
    const serialized = serializeMutableBoardState(snapshot);
    if (!serialized) return false;
    mutableBoardState = serialized;
    return true;
  };

  const persistSessionSave = () => {
    const snapshot = state.getSnapshot();
    const didSync = syncMutableBoardStateFromSnapshot(snapshot);
    if (
      !didSync
      && mutableBoardState
      && mutableBoardState.levelIndex === snapshot.levelIndex
    ) {
      mutableBoardState = null;
    }

    try {
      if (!mutableBoardState) {
        window.localStorage.removeItem(SESSION_SAVE_KEY);
        return;
      }
      const board = cloneBoardState(mutableBoardState);
      const persistedBoard = toPersistedBoardState(board);
      window.localStorage.setItem(
        SESSION_SAVE_KEY,
        JSON.stringify({
          version: SESSION_SAVE_VERSION,
          board: persistedBoard,
          sig: signBoard(board),
        }),
      );
    } catch {
      // localStorage might be unavailable in restricted environments.
    }
  };

  const queueSessionSave = () => {
    if (sessionSaveQueued) return;
    sessionSaveQueued = true;

    window.setTimeout(() => {
      sessionSaveQueued = false;
      persistSessionSave();
    }, 150);
  };

  const refreshLevelOptions = () => {
    const currentIndex = state.getSnapshot().levelIndex;
    let optionHtml = LEVELS.map(
      (lv, i) => {
        const disabled = !isCampaignLevelUnlocked(i);
        return `<option value="${i}" ${disabled ? 'disabled' : ''}${i === currentIndex ? 'selected' : ''}>${resolveLevelName(
          lv,
          translate,
        )}</option>`;
      },
    ).join('');

    if (isCampaignCompleted()) {
      const selectorInfiniteIndex = isInfiniteAbsIndex(currentIndex)
        ? clampInfiniteIndex(toInfiniteIndex(currentIndex))
        : clampInfiniteIndex(readInfiniteProgress());
      const infiniteAbsIndex = ensureInfiniteLevel(selectorInfiniteIndex);
      const translated = resolveInfiniteModeLabel();
      const fallback = resolveLevelName(getLevelAtIndex(infiniteAbsIndex), translate);
      const infiniteLabel = translated === 'ui.infiniteLevelOption' ? fallback : translated;
      optionHtml += `<option value="${infiniteAbsIndex}" ${infiniteAbsIndex === currentIndex ? 'selected' : ''}>${infiniteLabel}</option>`;
    }

    refs.levelSel.innerHTML = optionHtml;
    refs.levelSel.value = String(currentIndex);

    if (refs.levelSelectGroup && refs.infiniteSel) {
      const infiniteActive = isInfiniteAbsIndex(currentIndex);
      refs.levelSelectGroup.classList.toggle('isInfiniteActive', infiniteActive);
      refs.infiniteSel.hidden = !infiniteActive;
      refs.infiniteSel.disabled = !infiniteActive;

      if (!infiniteActive) {
        refs.infiniteSel.innerHTML = '';
      } else {
        const currentInfiniteIndex = clampInfiniteIndex(toInfiniteIndex(currentIndex));
        const latestUnlockedInfiniteIndex = Math.max(
          clampInfiniteIndex(readInfiniteProgress()),
          currentInfiniteIndex,
        );
        const pageStart = infinitePageStart(currentInfiniteIndex);
        const pageEnd = Math.min(MAX_INFINITE_INDEX, pageStart + INFINITE_PAGE_SIZE - 1);
        const prevPageStart = Math.max(0, pageStart - INFINITE_PAGE_SIZE);
        const prevPageEnd = pageStart - 1;
        const nextPageStart = pageStart + INFINITE_PAGE_SIZE;
        const nextPageEnd = Math.min(MAX_INFINITE_INDEX, nextPageStart + INFINITE_PAGE_SIZE - 1);

        let infiniteOptionHtml = '';
        if (pageStart > 0) {
          infiniteOptionHtml += `<option value="${INFINITE_SELECTOR_ACTIONS.first}">&laquo; #1</option>`;
          infiniteOptionHtml += `<option value="${INFINITE_SELECTOR_ACTIONS.prev}">&lsaquo; #${prevPageStart + 1}-#${prevPageEnd + 1}</option>`;
        }

        for (let i = pageStart; i <= pageEnd; i += 1) {
          const disabled = i > latestUnlockedInfiniteIndex ? 'disabled' : '';
          infiniteOptionHtml += `<option value="${i}" ${i === currentInfiniteIndex ? 'selected' : ''} ${disabled}>${i + 1}</option>`;
        }

        if (pageEnd < MAX_INFINITE_INDEX) {
          const nextDisabled = nextPageStart > latestUnlockedInfiniteIndex ? 'disabled' : '';
          const lastDisabled = latestUnlockedInfiniteIndex <= pageEnd ? 'disabled' : '';
          infiniteOptionHtml += `<option value="${INFINITE_SELECTOR_ACTIONS.next}" ${nextDisabled}>#${nextPageStart + 1}-#${nextPageEnd + 1} &rsaquo;</option>`;
          infiniteOptionHtml += `<option value="${INFINITE_SELECTOR_ACTIONS.last}" ${lastDisabled}>#${latestUnlockedInfiniteIndex + 1} &raquo;</option>`;
        }

        refs.infiniteSel.innerHTML = infiniteOptionHtml;
        refs.infiniteSel.value = String(currentInfiniteIndex);
      }
    }
  };

  const showLevelGoal = (levelIndex) => {
    currentLevelCleared = isLevelPreviouslyCleared(levelIndex);
    currentBoardSolved = false;
    setMessage(refs.msgEl, null, baseGoalText(getLevelAtIndex(levelIndex), translate));
    if (refs.nextLevelBtn) {
      refs.nextLevelBtn.textContent = resolveNextButtonLabel(levelIndex);
      refs.nextLevelBtn.hidden = false;
    }
    if (refs.prevInfiniteBtn) refs.prevInfiniteBtn.hidden = true;
    syncInfiniteNavigation(levelIndex, currentLevelCleared);
  };

  const resolveDraggedHintSuppressionKey = (snapshot, options = {}) => {
    if (!options?.isPathDragging) return null;
    const side = options.pathDragSide;
    const cursor = options.pathDragCursor;
    if (side !== 'start' && side !== 'end') return null;
    if (!cursor || !Number.isInteger(cursor.r) || !Number.isInteger(cursor.c)) return null;
    if (snapshot.path.length === 0) return null;

    const endpoint = side === 'start'
      ? snapshot.path[0]
      : snapshot.path[snapshot.path.length - 1];
    if (!endpoint || endpoint.r !== cursor.r || endpoint.c !== cursor.c) return null;

    return `${cursor.r},${cursor.c}`;
  };

  const applyThemeState = (nextTheme) => {
    activeTheme = nextTheme;
    applyTheme(activeTheme);
    refreshThemeButton();
  };

  const setThemeSwitchPrompt = (nextTheme) => {
    if (!refs.themeSwitchMessage) return;
    const targetLabel = nextTheme === 'light' ? translate('ui.themeLight') : translate('ui.themeDark');
    const fallback = targetLabel ? `Switch to ${targetLabel}?` : translate('ui.themeLight');
    refs.themeSwitchMessage.textContent = translate('ui.themeSwitchPrompt', { theme: targetLabel || '' }) || fallback;
  };

  const requestLightThemeConfirmation = (targetTheme) => {
    if (!refs.themeSwitchDialog || typeof refs.themeSwitchDialog.showModal !== 'function') {
      return false;
    }
    if (refs.themeSwitchDialog.open) return true;

    refs.themeSwitchDialog.dataset.pendingTheme = targetTheme;
    setThemeSwitchPrompt(targetTheme);

    try {
      refs.themeSwitchDialog.showModal();
      return true;
    } catch {
      delete refs.themeSwitchDialog.dataset.pendingTheme;
      return false;
    }
  };

  const refreshThemeButton = () => {
    if (!refs.themeToggle) return;
    const isDark = activeTheme === 'dark';
    const nextLabel = isDark ? translate('ui.themeLight') : translate('ui.themeDark');
    refs.themeToggle.textContent = nextLabel;
    refs.themeToggle.setAttribute('aria-label', nextLabel);
    refs.themeToggle.setAttribute('title', nextLabel);
  };

  const setSettingsMenuOpen = (isOpen) => {
    if (!refs.settingsPanel || !refs.settingsToggle) return;
    refs.settingsPanel.hidden = !isOpen;
    refs.settingsToggle.classList.toggle('isOpen', isOpen);
    refs.settingsToggle.setAttribute('aria-expanded', String(isOpen));
  };

  const closeSettingsMenu = () => {
    setSettingsMenuOpen(false);
  };

  const refreshSettingsToggle = () => {
    if (!refs.settingsToggle) return;
    const label = `${translate('ui.language')} / ${translate('ui.theme')}`;
    refs.settingsToggle.setAttribute('aria-label', label);
    refs.settingsToggle.setAttribute('title', label);
  };

  const refreshStaticUiText = (opts = {}) => {
    const locale = opts.locale || activeLocale;
    document.documentElement.lang = locale;
    applyTextDirection(locale);
    activeLocale = locale;
    translate = createTranslator(activeLocale);

    if (refs.langSel) {
      refs.langSel.innerHTML = getLocaleOptions(activeLocale)
        .map((item) => `<option value="${item.value}" ${item.value === activeLocale ? 'selected' : ''}>${item.label}</option>`)
        .join('');
      refs.langSel.value = activeLocale;
    }

    refreshLevelOptions();

    applyDataAttributes(appEl, translate);
    if (refs.guidePanel && refs.guideToggleBtn) {
      applyPanelVisibility(
        refs.guidePanel,
        refs.guideToggleBtn,
        refs.guidePanel.classList.contains('is-hidden'),
        translate,
      );
    }
    if (refs.legendPanel && refs.legendToggleBtn) {
      applyPanelVisibility(
        refs.legendPanel,
        refs.legendToggleBtn,
        refs.legendPanel.classList.contains('is-hidden'),
        translate,
      );
    }

    const index = state.getSnapshot().levelIndex;
    showLevelGoal(index);

    if (refs.legend) {
      refs.legend.innerHTML = buildLegendTemplate(
        BADGE_DEFINITIONS,
        ICONS,
        ICON_X,
        translate,
      );
    }

    if (refs.themeSwitchMessage && refs.themeSwitchDialog) {
      const pendingTheme = refs.themeSwitchDialog.dataset.pendingTheme;
      if (pendingTheme === 'light' || pendingTheme === 'dark') {
        setThemeSwitchPrompt(pendingTheme);
      } else {
        setThemeSwitchPrompt(activeTheme === 'dark' ? 'light' : 'dark');
      }
    }

    refreshThemeButton();
    refreshSettingsToggle();
  };

  const refresh = (snapshot, validate = false, options = {}) => {
    const draggedHintSuppressionKey = resolveDraggedHintSuppressionKey(snapshot, options);
    const evaluateResult = makeEvaluators(snapshot, {
      suppressEndpointRequirement: Boolean(draggedHintSuppressionKey),
      suppressEndpointKey: draggedHintSuppressionKey,
    });
    const completion = updateWithEvaluation(refs, snapshot, evaluateResult, validate, translate, {
      getLevelForIndex: getLevelAtIndex,
      onLevelCleared,
    });
    if (completion) {
      currentBoardSolved = completion.kind === 'good';
      currentLevelCleared = currentBoardSolved || isLevelPreviouslyCleared(snapshot.levelIndex);
    }
    syncInfiniteNavigation(snapshot.levelIndex, currentLevelCleared);
    if (completion?.kind === 'good') {
      refreshLevelOptions();
    }
  };

  const runBoardLayout = (validate = false, options = {}) => {
    const snapshot = state.getSnapshot();
    resizeCanvas(refs);
    refresh(snapshot, validate, options);
  };

  let layoutQueued = false;
  let queuedLayoutOptions = {};
  let pendingValidate = false;
  const queueBoardLayout = (validate = false, options = {}) => {
    queuedLayoutOptions = {
      ...queuedLayoutOptions,
      ...options,
    };
    pendingValidate = pendingValidate || Boolean(validate);
    if (layoutQueued) return;
    layoutQueued = true;

    requestAnimationFrame(() => {
      layoutQueued = false;
      const shouldValidate = pendingValidate;
      const nextOptions = queuedLayoutOptions;
      pendingValidate = false;
      queuedLayoutOptions = {};
      runBoardLayout(shouldValidate, nextOptions);
    });
  };

  wirePanelToggle(refs.guidePanel, refs.guideToggleBtn, GUIDE_KEY, translate, () => {
    queueBoardLayout(false);
  });
  wirePanelToggle(refs.legendPanel, refs.legendToggleBtn, LEGEND_KEY, translate, () => {
    queueBoardLayout(false);
  });

  const loadLevel = (idx) => {
    let targetIndex = Number.isInteger(idx) ? idx : 0;
    if (targetIndex < 0) targetIndex = 0;

    if (isInfiniteAbsIndex(targetIndex)) {
      targetIndex = ensureInfiniteLevel(clampInfiniteIndex(toInfiniteIndex(targetIndex)));
    } else {
      targetIndex = Math.min(targetIndex, CAMPAIGN_LEVEL_COUNT - 1);
    }

    if (hasLoadedLevel) {
      syncMutableBoardStateFromSnapshot(state.getSnapshot());
    }

    state.loadLevel(targetIndex);
    const savedBoardState = mutableBoardState && mutableBoardState.levelIndex === targetIndex
      ? mutableBoardState
      : null;
    if (savedBoardState) {
      const restored = state.restoreMutableState(savedBoardState);
      if (!restored) {
        mutableBoardState = null;
      }
    }
    const snapshot = state.getSnapshot();

    if (refs.boardWrap) {
      refs.boardWrap.classList.toggle(
        'tutorialPathBrackets',
        snapshot.levelIndex === PATH_BRACKET_TUTORIAL_LEVEL_INDEX,
      );
      refs.boardWrap.classList.toggle(
        'tutorialMovableBrackets',
        snapshot.levelIndex === MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX,
      );
    }

    buildGrid(snapshot, refs, ICONS, ICON_X);
    showLevelGoal(targetIndex);
    syncMutableBoardStateFromSnapshot(snapshot);
    refreshLevelOptions();
    queueBoardLayout(false);
    queueSessionSave();
    hasLoadedLevel = true;
  };

  bindInputHandlers(refs, state, (shouldValidate, options = {}) => {
    const isPathDragging = Boolean(options.isPathDragging);
    const dragEvaluateOptions = {
      isPathDragging,
      pathDragSide: options.pathDragSide ?? null,
      pathDragCursor: options.pathDragCursor ?? null,
    };
    if (options.rebuildGrid) {
      const snapshotForGrid = state.getSnapshot();
      buildGrid(snapshotForGrid, refs, ICONS, ICON_X);
      queueBoardLayout(Boolean(shouldValidate), dragEvaluateOptions);
      queueSessionSave();
      return;
    }

    queueBoardLayout(Boolean(shouldValidate), dragEvaluateOptions);
    queueSessionSave();
  });

  refs.levelSel.addEventListener('change', (e) => {
    const selected = parseInt(e.target.value, 10);
    if (!Number.isInteger(selected)) return;
    loadLevel(selected);
  });

  refs.infiniteSel?.addEventListener('change', (e) => {
    const snapshot = state.getSnapshot();
    if (!isInfiniteAbsIndex(snapshot.levelIndex)) return;

    const selectedValue = String(e.target.value || '');
    const currentInfiniteIndex = clampInfiniteIndex(toInfiniteIndex(snapshot.levelIndex));
    const latestUnlockedInfiniteIndex = Math.max(
      clampInfiniteIndex(readInfiniteProgress()),
      currentInfiniteIndex,
    );
    const currentPageStart = infinitePageStart(currentInfiniteIndex);

    let targetInfiniteIndex = null;
    if (selectedValue === INFINITE_SELECTOR_ACTIONS.first) {
      targetInfiniteIndex = 0;
    } else if (selectedValue === INFINITE_SELECTOR_ACTIONS.prev) {
      targetInfiniteIndex = Math.max(0, currentPageStart - INFINITE_PAGE_SIZE);
    } else if (selectedValue === INFINITE_SELECTOR_ACTIONS.next) {
      targetInfiniteIndex = Math.min(latestUnlockedInfiniteIndex, currentPageStart + INFINITE_PAGE_SIZE);
    } else if (selectedValue === INFINITE_SELECTOR_ACTIONS.last) {
      targetInfiniteIndex = latestUnlockedInfiniteIndex;
    } else {
      const parsed = parseInt(selectedValue, 10);
      if (Number.isInteger(parsed)) targetInfiniteIndex = clampInfiniteIndex(parsed);
    }

    if (!Number.isInteger(targetInfiniteIndex)) {
      refreshLevelOptions();
      return;
    }

    const clampedTarget = Math.min(Math.max(targetInfiniteIndex, 0), latestUnlockedInfiniteIndex);
    if (clampedTarget === currentInfiniteIndex) {
      refreshLevelOptions();
      return;
    }

    loadLevel(ensureInfiniteLevel(clampedTarget));
  });

  refs.langSel.addEventListener('change', (e) => {
    closeSettingsMenu();
    const nextLocale = setLocale(e.target.value);
    refreshStaticUiText({ locale: nextLocale });
    const snapshot = state.getSnapshot();
    refresh(snapshot, true);
  });

  if (refs.themeSwitchDialog) {
    refs.themeSwitchDialog.addEventListener('close', () => {
      const targetTheme = refs.themeSwitchDialog?.dataset?.pendingTheme;
      if (targetTheme === 'light' && refs.themeSwitchDialog.returnValue === 'confirm') {
        applyThemeState(targetTheme);
      }
      delete refs.themeSwitchDialog.dataset.pendingTheme;
      refs.themeSwitchDialog.returnValue = '';
    });
  }

  refs.themeToggle?.addEventListener('click', () => {
    closeSettingsMenu();
    const targetTheme = activeTheme === 'dark' ? 'light' : 'dark';
    if (targetTheme === 'light' && requestLightThemeConfirmation(targetTheme)) return;
    applyThemeState(targetTheme);
  });

  refs.settingsToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = refs.settingsPanel ? !refs.settingsPanel.hidden : false;
    setSettingsMenuOpen(!isOpen);
  });

  refs.settingsPanel?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('click', () => {
    closeSettingsMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettingsMenu();
  });

  refs.resetBtn.addEventListener('click', () => {
    state.resetPath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, false);
    showLevelGoal(snapshot.levelIndex);
    mutableBoardState = null;
    queueSessionSave();
  });

  refs.reverseBtn.addEventListener('click', () => {
    state.reversePath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, true);
    queueSessionSave();
  });

  refs.nextLevelBtn?.addEventListener('click', () => {
    const snapshot = state.getSnapshot();
    if (isInfiniteAbsIndex(snapshot.levelIndex)) {
      const currentInfiniteIndex = clampInfiniteIndex(toInfiniteIndex(snapshot.levelIndex));
      if (currentInfiniteIndex >= MAX_INFINITE_INDEX) return;
      const latestUnlockedInfiniteIndex = clampInfiniteIndex(readInfiniteProgress());
      const nextInfiniteIndex = Math.min(currentInfiniteIndex + 1, latestUnlockedInfiniteIndex, MAX_INFINITE_INDEX);
      if (nextInfiniteIndex <= currentInfiniteIndex) return;
      loadLevel(ensureInfiniteLevel(nextInfiniteIndex));
      return;
    }

    const nextCampaignIndex = snapshot.levelIndex + 1;
    if (nextCampaignIndex < CAMPAIGN_LEVEL_COUNT) {
      loadLevel(nextCampaignIndex);
      return;
    }

    if (isCampaignCompleted()) {
      loadLevel(ensureInfiniteLevel(clampInfiniteIndex(readInfiniteProgress())));
    }
  });

  refs.prevInfiniteBtn?.addEventListener('click', () => {
    const snapshot = state.getSnapshot();
    if (!isInfiniteAbsIndex(snapshot.levelIndex)) return;

    const currentInfiniteIndex = clampInfiniteIndex(toInfiniteIndex(snapshot.levelIndex));
    if (currentInfiniteIndex <= 0) return;

    loadLevel(ensureInfiniteLevel(currentInfiniteIndex - 1));
  });

  let boardResizeObserver = null;
  if (typeof ResizeObserver !== 'undefined' && refs.boardWrap) {
    boardResizeObserver = new ResizeObserver(() => {
      queueBoardLayout(false);
    });
    boardResizeObserver.observe(refs.boardWrap);

    window.addEventListener('beforeunload', () => {
      if (boardResizeObserver) boardResizeObserver.disconnect();
    }, { once: true });
  }

  window.addEventListener('beforeunload', () => {
    persistSessionSave();
  });

  window.addEventListener('resize', () => {
    queueBoardLayout(false);
  });

  refreshStaticUiText({ locale: getLocale() });
  refreshLevelOptions();
  const fallbackInitialLevelIndex = isCampaignCompleted()
    ? ensureInfiniteLevel(clampInfiniteIndex(readInfiniteProgress()))
    : getLatestCampaignLevelIndex();
  const savedInitialLevelIndex = resolveLoadableLevelIndex(sessionSaveData.board?.levelIndex);
  const initialLevelIndex = savedInitialLevelIndex ?? fallbackInitialLevelIndex;
  loadLevel(initialLevelIndex);
}

initTetherApp();
