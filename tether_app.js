import { mountStyles } from './tether_styles.js';
import { APP_SHELL_TEMPLATE, buildLegendTemplate } from './tether_templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './tether_icons.js';
import { DEFAULT_LEVEL_INDEX, LEVELS } from './tether_levels.js';
import { baseGoalText, ELEMENT_IDS } from './tether_config.js';
import { createGameState } from './tether_state.js';
import {
  cacheElements,
  buildGrid,
  updateCells,
  setLegendIcons,
  resizeCanvas,
  setMessage,
} from './tether_renderer.js';
import { bindInputHandlers } from './tether_input.js';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from './tether_rules.js';
import {
  getLocaleOptions,
  getLocale,
  resolveLocale,
  setLocale,
  t as createTranslator,
} from './tether_i18n.js';

const GUIDE_KEY = 'tetherGuideHidden';
const LEGEND_KEY = 'tetherLegendHidden';
const DEFAULT_HIDDEN_BY_KEY = {
  [GUIDE_KEY]: false,
  [LEGEND_KEY]: true,
};

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

const wirePanelToggle = (panelEl, buttonEl, storageKey, translate, onToggle = () => {}) => {
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

function makeEvaluators(snapshot) {
  return {
    hintStatus: evaluateHints(snapshot),
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
    setMessage(refs.msgEl, completion.kind, completion.message);
    return;
  }

  setMessage(refs.msgEl, null, baseGoalText(LEVELS[snapshot.levelIndex], translate));
}

export function initTetherApp() {
  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;

  const initialLocale = resolveLocale();
  let activeLocale = initialLocale;
  let translate = createTranslator(activeLocale);
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
      (lv, i) => `<option value="${i}">${resolveLevelName(lv, translate)}</option>`,
    ).join('');
    refs.levelSel.value = String(currentIndex);
  };

  const showLevelGoal = (levelIndex) => {
    setMessage(refs.msgEl, null, baseGoalText(LEVELS[levelIndex], translate));
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
  };

  const refresh = (snapshot, validate = false) => {
    const evaluateResult = makeEvaluators(snapshot);
    updateWithEvaluation(refs, snapshot, evaluateResult, validate, translate);
  };

  const runBoardLayout = (validate = false) => {
    const snapshot = state.getSnapshot();
    resizeCanvas(refs);
    refresh(snapshot, validate);
  };

  let layoutQueued = false;
  let pendingValidate = false;
  const queueBoardLayout = (validate = false) => {
    pendingValidate = pendingValidate || Boolean(validate);
    if (layoutQueued) return;
    layoutQueued = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        layoutQueued = false;
        const shouldValidate = pendingValidate;
        pendingValidate = false;
        runBoardLayout(shouldValidate);
      });
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
    queueBoardLayout(false);
  };

  bindInputHandlers(refs, state, (shouldValidate, options = {}) => {
    if (options.rebuildGrid) {
      const snapshotForGrid = state.getSnapshot();
      buildGrid(snapshotForGrid, refs, ICONS, ICON_X);
      queueBoardLayout(Boolean(shouldValidate));
      return;
    }

    const snapshot = state.getSnapshot();
    refresh(snapshot, Boolean(shouldValidate));
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
  loadLevel(DEFAULT_LEVEL_INDEX);
}

initTetherApp();
