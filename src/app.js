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
const DEFAULT_THEME = 'dark';
const CAMPAIGN_LEVEL_COUNT = LEVELS.length;
const MAX_INFINITE_INDEX = INFINITE_MAX_LEVELS - 1;
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
      return;
    }
    markCampaignLevelCleared(levelIndex);
  };

  const state = createGameState(getLevelAtIndex);
  setLegendIcons(ICONS, refs, ICON_X);

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
      currentLevelCleared = completion.kind === 'good' || isLevelPreviouslyCleared(snapshot.levelIndex);
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

    state.loadLevel(targetIndex);
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
    refreshLevelOptions();
    queueBoardLayout(false);
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
      return;
    }

    queueBoardLayout(Boolean(shouldValidate), dragEvaluateOptions);
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
  });

  refs.reverseBtn.addEventListener('click', () => {
    state.reversePath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, true);
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

  window.addEventListener('resize', () => {
    queueBoardLayout(false);
  });

  refreshStaticUiText({ locale: getLocale() });
  refreshLevelOptions();
  const initialLevelIndex = isCampaignCompleted()
    ? ensureInfiniteLevel(clampInfiniteIndex(readInfiniteProgress()))
    : getLatestCampaignLevelIndex();
  loadLevel(initialLevelIndex);
}

initTetherApp();
