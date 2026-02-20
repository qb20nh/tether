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

function makeEvaluators(snapshot) {
  return {
    hintStatus: evaluateHints(snapshot),
    stitchStatus: evaluateStitches(snapshot),
    rpsStatus: evaluateRPS(snapshot),
    blockedStatus: evaluateBlockedCells(snapshot),
  };
}

function updateWithEvaluation(refs, snapshot, evaluateResult, shouldValidate) {
  updateCells(snapshot, evaluateResult, refs);
  if (!shouldValidate) return;
  const completion = checkCompletion(snapshot, evaluateResult);
  setMessage(refs.msgEl, completion.kind, completion.message);
}

export function initTetherApp() {
  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;

  appEl.innerHTML = APP_SHELL_TEMPLATE;
  appEl.querySelector(`#${ELEMENT_IDS.LEGEND}`).innerHTML = buildLegendTemplate(
    BADGE_DEFINITIONS,
    ICONS,
    ICON_X,
  );

  const refs = cacheElements();
  const state = createGameState(LEVELS);
  setLegendIcons(ICONS, refs, ICON_X);

  refs.levelSel.innerHTML = LEVELS.map((lv, i) => `<option value="${i}">${lv.name}</option>`).join('');

  const refresh = (snapshot, validate = false) => {
    const evaluateResult = makeEvaluators(snapshot);
    updateWithEvaluation(refs, snapshot, evaluateResult, validate);
  };

  const showLevelGoal = (levelIndex) => {
    setMessage(refs.msgEl, null, baseGoalText(LEVELS[levelIndex]));
  };

  const loadLevel = (idx) => {
    refs.levelSel.value = String(idx);
    state.loadLevel(idx);
    const snapshot = state.getSnapshot();

    buildGrid(snapshot, refs, ICONS, ICON_X);
    resizeCanvas(refs);
    refresh(snapshot, false);
    showLevelGoal(idx);
  };

  bindInputHandlers(refs, state, (shouldValidate, options = {}) => {
    if (options.rebuildGrid) {
      const snapshotForGrid = state.getSnapshot();
      buildGrid(snapshotForGrid, refs, ICONS, ICON_X);
    }

    const snapshot = state.getSnapshot();
    refresh(snapshot, Boolean(shouldValidate));
  });

  refs.levelSel.addEventListener('change', (e) => {
    loadLevel(parseInt(e.target.value, 10));
  });

  refs.resetBtn.addEventListener('click', () => {
    state.resetPath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, false);
    showLevelGoal(parseInt(refs.levelSel.value, 10));
  });

  refs.undoBtn.addEventListener('click', () => {
    state.undo();
    const snapshot = state.getSnapshot();
    refresh(snapshot, false);
  });

  refs.reverseBtn.addEventListener('click', () => {
    state.reversePath();
    const snapshot = state.getSnapshot();
    refresh(snapshot, true);
  });

  refs.toggleIdxBtn.addEventListener('click', () => {
    document.body.classList.toggle('showIdx');
  });

  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      resizeCanvas(refs);
      const snapshot = state.getSnapshot();
      refresh(snapshot, false);
    });
  });

  loadLevel(DEFAULT_LEVEL_INDEX);
}

initTetherApp();
