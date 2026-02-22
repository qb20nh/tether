import { mountStyles } from './styles.js';
import { APP_SHELL_TEMPLATE, buildLegendTemplate } from './templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './icons.js';
import { LEVELS } from './levels.js';
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
const THEME_KEY = 'tetherTheme';
const DEFAULT_THEME = 'dark';
const DEFAULT_HIDDEN_BY_KEY = {
  [GUIDE_KEY]: false,
  [LEGEND_KEY]: true,
};
let levelProgress = null;
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
    return Math.min(Math.max(value.latestLevel, 0), LEVELS.length - 1);
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

const isLevelUnlocked = (index) => {
  const progress = readLevelProgress();
  return index <= progress;
};

const getLatestAvailableLevelIndex = () => {
  const progress = readLevelProgress();
  return Math.min(progress, LEVELS.length - 1);
};

const markLevelCleared = (index) => {
  const nextProgress = Math.max(readLevelProgress(), index + 1);
  if (nextProgress === levelProgress) return;
  levelProgress = nextProgress;
  writeLevelProgress();
};

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

function updateWithEvaluation(refs, snapshot, evaluateResult, shouldValidate, translate) {
  updateCells(snapshot, evaluateResult, refs);
  if (!shouldValidate) return;
  const completion = checkCompletion(snapshot, evaluateResult, translate);
  if (completion.kind === 'good') {
    markLevelCleared(snapshot.levelIndex);
    setMessage(refs.msgEl, completion.kind, completion.message);
    if (refs.nextLevelBtn) {
      refs.nextLevelBtn.hidden = snapshot.levelIndex >= LEVELS.length - 1;
    }
    return completion;
  }

  setMessage(refs.msgEl, null, baseGoalText(LEVELS[snapshot.levelIndex], translate));
  if (refs.nextLevelBtn) refs.nextLevelBtn.hidden = true;
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
  const state = createGameState(LEVELS);
  setLegendIcons(ICONS, refs, ICON_X);

  const refreshLevelOptions = () => {
    const currentIndex = state.getSnapshot().levelIndex;
    refs.levelSel.innerHTML = LEVELS.map(
      (lv, i) => {
        const disabled = !isLevelUnlocked(i);
        return `<option value="${i}" ${disabled ? 'disabled' : ''}${i === currentIndex ? 'selected' : ''}>${resolveLevelName(
          lv,
          translate,
        )}</option>`;
      },
    ).join('');
    refs.levelSel.value = String(currentIndex);
  };

  const showLevelGoal = (levelIndex) => {
    setMessage(refs.msgEl, null, baseGoalText(LEVELS[levelIndex], translate));
    if (refs.nextLevelBtn) refs.nextLevelBtn.hidden = true;
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
  };

  const refresh = (snapshot, validate = false, options = {}) => {
    const evaluateResult = makeEvaluators(snapshot, {
      suppressEndpointRequirement: Boolean(options.isPathDragging),
    });
    const completion = updateWithEvaluation(refs, snapshot, evaluateResult, validate, translate);
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
    refs.levelSel.value = String(idx);
    state.loadLevel(idx);
    const snapshot = state.getSnapshot();

    buildGrid(snapshot, refs, ICONS, ICON_X);
    showLevelGoal(idx);
    refreshLevelOptions();
    queueBoardLayout(false);
  };

  bindInputHandlers(refs, state, (shouldValidate, options = {}) => {
    const isPathDragging = Boolean(options.isPathDragging);
    if (options.rebuildGrid) {
      const snapshotForGrid = state.getSnapshot();
      buildGrid(snapshotForGrid, refs, ICONS, ICON_X);
      queueBoardLayout(Boolean(shouldValidate), { isPathDragging });
      return;
    }

    const snapshot = state.getSnapshot();
    queueBoardLayout(Boolean(shouldValidate), { isPathDragging });
  });

  refs.levelSel.addEventListener('change', (e) => {
    loadLevel(parseInt(e.target.value, 10));
  });

  refs.langSel.addEventListener('change', (e) => {
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
    const targetTheme = activeTheme === 'dark' ? 'light' : 'dark';
    if (targetTheme === 'light' && requestLightThemeConfirmation(targetTheme)) return;
    applyThemeState(targetTheme);
  });

  refs.resetBtn.addEventListener('click', () => {
    state.resetPath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, false);
    showLevelGoal(parseInt(refs.levelSel.value, 10));
  });

  refs.reverseBtn.addEventListener('click', () => {
    state.reversePath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, true);
  });

  refs.nextLevelBtn?.addEventListener('click', () => {
    const snapshot = state.getSnapshot();
    const nextIndex = snapshot.levelIndex + 1;
    if (nextIndex < LEVELS.length) {
      loadLevel(nextIndex);
    }
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
  const initialLevelIndex = getLatestAvailableLevelIndex();
  loadLevel(initialLevelIndex);
}

initTetherApp();
