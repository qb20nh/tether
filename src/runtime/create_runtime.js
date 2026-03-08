import { INTENT_TYPES, UI_ACTIONS, INTERACTION_UPDATES, GAME_COMMANDS } from './intents.js';
import { applyTheme as applyThemeCore, refreshThemeButton as refreshThemeButtonCore, requestLightThemeConfirmation as requestLightThemeConfirmationCore, setThemeSwitchPrompt as setThemeSwitchPromptCore, refreshSettingsToggle as refreshSettingsToggleCore, normalizeTheme } from './theme_manager.js';
import { formatDailyDateLabel, formatDailyMonthDayLabel, formatCountdownHms, utcStartMsFromDateId } from './daily_timer.js';
import { createProgressManager } from './progress_manager.js';
import { SCORE_MODES, createScoreManager } from './score_manager.js';
import {
  buildSessionBoardFromSnapshot,
  markClearedLevel,
  registerSolvedSnapshot,
} from './solve_progress_helpers.js';
import { pointsMatch } from '../math.js';

const PATH_BRACKET_TUTORIAL_LEVEL_INDEX = 0;
const MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX = 7;

const INFINITE_PAGE_SIZE = 10;
const INFINITE_SELECTOR_ACTIONS = Object.freeze({
  first: '__first__',
  prev: '__prev_page__',
  next: '__next_page__',
  last: '__last__',
});
const isRtlLocale = (locale) => /^ar/i.test(locale || '');
const DAY_MS = 24 * 60 * 60 * 1000;
const EVALUATE_CACHE_LIMIT = 24;
const TUTORIAL_PRACTICE_NAME_PREFIX_RE = /^\s*.+?\d+\s*[)）]\s*/u;

const applyTextDirection = (locale) => {
  const direction = isRtlLocale(locale) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', direction);
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



export function createRuntime(options) {
  const {
    appEl,
    core,
    state,
    persistence,
    renderer,
    input,
    i18n,
    ui,
    dailyHardInvalidateAtUtcMs = null,
    effects = {},
  } = options;

  if (!appEl) throw new Error('createRuntime requires appEl');

  const campaignCount = core.getCampaignLevelCount();
  const maxInfiniteIndex = core.getInfiniteMaxIndex();
  const dailyAbsIndex = typeof core.getDailyAbsIndex === 'function'
    ? core.getDailyAbsIndex()
    : (campaignCount + maxInfiniteIndex + 1);
  const hasDailyLevel = typeof core.hasDailyLevel === 'function'
    ? core.hasDailyLevel()
    : false;
  const activeDailyId = typeof core.getDailyId === 'function'
    ? core.getDailyId()
    : null;
  const dailyResetUtcMs = Number.isInteger(dailyHardInvalidateAtUtcMs) && dailyHardInvalidateAtUtcMs > 0
    ? dailyHardInvalidateAtUtcMs
    : (
      activeDailyId
        ? (() => {
          const startMs = utcStartMsFromDateId(activeDailyId);
          return Number.isInteger(startMs) ? (startMs + DAY_MS) : null;
        })()
        : null
    );

  const bootState = persistence.readBootState();

  const progressManager = createProgressManager(bootState, campaignCount, maxInfiniteIndex, persistence);
  const {
    readCampaignProgress,
    readInfiniteProgress,
    isCampaignCompleted,
    markCampaignLevelCleared,
    markInfiniteLevelCleared,
    isCampaignLevelUnlocked,
  } = progressManager;
  const scoreManager = createScoreManager(bootState.scoreState, persistence);

  let dailySolvedDate = typeof bootState.dailySolvedDate === 'string' ? bootState.dailySolvedDate : null;
  let activeTheme = normalizeTheme(bootState.theme);

  const initialLocale = i18n.resolveLocale();
  let activeLocale = initialLocale;
  let translate = i18n.createTranslator(activeLocale);

  let currentMessageKind = null;
  let currentMessageHtml = '';

  let currentLevelCleared = false;
  let currentBoardSolved = false;
  let hasLoadedLevel = false;
  let sessionSaveQueued = false;
  let started = false;
  let destroyed = false;
  let layoutRafId = 0;
  let sessionSaveTimerId = 0;
  let boardResizeObserver = null;
  let windowResizeHandler = null;
  let beforeUnloadPersistHandler = null;
  let beforeUnloadObserverCleanupHandler = null;

  const interactionState = {
    isPathDragging: false,
    pathDragSide: null,
    pathDragCursor: null,
    pathTipArrivalHint: null,
    isWallDragging: false,
    wallGhost: {
      visible: false,
      x: 0,
      y: 0,
    },
    dropTarget: null,
  };

  let layoutQueued = false;
  let queuedLayoutOptions = {};
  let pendingValidate = false;
  let pendingResize = false;
  let pendingValidateSource = null;
  let settingsMenuOpen = false;
  let dailyCountdownTimer = 0;
  let dailyBoardLocked = false;
  let debugForceDailyFrozen = false;
  let evaluateCacheBoardVersion = 0;
  const evaluateCache = new Map();

  const sessionSaveData = {
    board: bootState.sessionBoard
      ? {
        levelIndex: bootState.sessionBoard.levelIndex,
        path: bootState.sessionBoard.path.map(([r, c]) => [r, c]),
        movableWalls: Array.isArray(bootState.sessionBoard.movableWalls)
          ? bootState.sessionBoard.movableWalls.map(([r, c]) => [r, c])
          : null,
        dailyId: typeof bootState.sessionBoard.dailyId === 'string'
          ? bootState.sessionBoard.dailyId
          : null,
      }
      : null,
  };

  let mutableBoardState = sessionSaveData.board
    ? {
      levelIndex: sessionSaveData.board.levelIndex,
      path: sessionSaveData.board.path.map(([r, c]) => [r, c]),
      movableWalls: Array.isArray(sessionSaveData.board.movableWalls)
        ? sessionSaveData.board.movableWalls.map(([r, c]) => [r, c])
        : null,
      dailyId: typeof sessionSaveData.board.dailyId === 'string'
        ? sessionSaveData.board.dailyId
        : null,
    }
    : null;

  const applyTheme = (theme) => {
    activeTheme = applyThemeCore(theme, persistence);
  };

  const setUiMessage = (kind, html) => {
    currentMessageKind = kind;
    currentMessageHtml = html;
  };

  const resolveLevelName = (level) => {
    const stripTutorialPracticePrefix = (value, nameKey) => {
      if (typeof nameKey !== 'string') return value;
      if (!nameKey.startsWith('level.tutorial_') && !nameKey.startsWith('level.pilot_')) return value;
      return value.replace(TUTORIAL_PRACTICE_NAME_PREFIX_RE, '').trim();
    };

    let name = '';
    if (level?.nameKey) {
      const translated = translate(level.nameKey);
      if (translated !== level.nameKey) {
        name = translated;
      }
    }
    if (!name) {
      name = level?.name || '';
    }

    const baseName = stripTutorialPracticePrefix(
      String(name || '').trim(),
      level?.nameKey,
    );
    return baseName;
  };

  const applyPanelVisibility = (panelEl, buttonEl, panel, isHidden) => {
    if (!panelEl || !buttonEl) return;
    panelEl.classList.toggle('is-hidden', isHidden);
    buttonEl.textContent = isHidden ? translate('ui.show') : translate('ui.hide');
    buttonEl.setAttribute('aria-expanded', String(!isHidden));
    persistence.writeHiddenPanel(panel, isHidden);
  };

  const setSettingsMenuOpen = (isOpen) => {
    settingsMenuOpen = Boolean(isOpen);
    const refs = renderer.getRefs();
    if (!refs?.settingsPanel || !refs?.settingsToggle) return;
    refs.settingsPanel.hidden = !settingsMenuOpen;
    refs.settingsToggle.classList.toggle('isOpen', settingsMenuOpen);
    refs.settingsToggle.setAttribute('aria-expanded', String(settingsMenuOpen));
  };

  const refreshThemeButton = () => refreshThemeButtonCore(activeTheme, renderer.getRefs(), translate);
  const setThemeSwitchPrompt = (nextTheme) => setThemeSwitchPromptCore(nextTheme, renderer.getRefs(), translate);
  const requestLightThemeConfirmation = (targetTheme) => requestLightThemeConfirmationCore(targetTheme, renderer.getRefs(), translate);
  const refreshSettingsToggle = () => refreshSettingsToggleCore(renderer.getRefs(), translate);

  const isDailyExpired = () =>
    debugForceDailyFrozen
    || (Number.isInteger(dailyResetUtcMs) && Date.now() >= dailyResetUtcMs);

  const applyDailyBoardLockState = (snapshot = null) => {
    const refs = renderer.getRefs();
    const activeSnapshot = snapshot || state.getSnapshot();
    const isDailySnapshot = Boolean(
      activeSnapshot
      && Number.isInteger(activeSnapshot.levelIndex)
      && typeof core.isDailyAbsIndex === 'function'
      && core.isDailyAbsIndex(activeSnapshot.levelIndex),
    );
    const nextLocked = Boolean(
      hasDailyLevel
      && activeDailyId
      && isDailySnapshot
      && isDailyExpired()
    );

    const changed = nextLocked !== dailyBoardLocked;
    dailyBoardLocked = nextLocked;

    if (nextLocked) {
      interactionState.isPathDragging = false;
      interactionState.pathDragSide = null;
      interactionState.pathDragCursor = null;
      interactionState.pathTipArrivalHint = null;
      interactionState.isWallDragging = false;
      interactionState.wallGhost = { visible: false, x: 0, y: 0 };
      interactionState.dropTarget = null;
      renderer.updateInteraction?.(interactionState);
    }

    if (refs?.boardWrap) refs.boardWrap.classList.toggle('isDailyLocked', nextLocked);
    if (refs?.gridEl) refs.gridEl.setAttribute('aria-disabled', String(nextLocked));
    if (refs?.resetBtn) refs.resetBtn.disabled = nextLocked;
    if (refs?.reverseBtn) refs.reverseBtn.disabled = nextLocked;

    return changed;
  };

  const clearDailyCountdownTimer = () => {
    if (!dailyCountdownTimer) return;
    clearInterval(dailyCountdownTimer);
    dailyCountdownTimer = 0;
  };

  const renderDailyMeta = () => {
    const refs = renderer.getRefs();
    if (!refs?.dailyMeta || !refs?.dailyDateValue || !refs?.dailyCountdownValue) return;
    const activeSnapshot = state.getSnapshot();
    const isDailySnapshot = Boolean(
      activeSnapshot
      && Number.isInteger(activeSnapshot.levelIndex)
      && isDailyLevelIndex(activeSnapshot.levelIndex),
    );

    if (!hasDailyLevel || !activeDailyId || !isDailySnapshot) {
      refs.dailyMeta.hidden = true;
      refs.dailyDateValue.textContent = '-';
      refs.dailyCountdownValue.textContent = formatCountdownHms(0, activeLocale);
      return;
    }

    refs.dailyMeta.hidden = false;
    refs.dailyDateValue.textContent = formatDailyDateLabel(activeDailyId, activeLocale);

    if (!Number.isInteger(dailyResetUtcMs)) {
      refs.dailyCountdownValue.textContent = formatCountdownHms(0, activeLocale);
      return;
    }

    const remainingMs = dailyResetUtcMs - Date.now();
    refs.dailyCountdownValue.textContent = remainingMs <= 0
      ? translate('ui.dailyResetNow')
      : formatCountdownHms(remainingMs, activeLocale);
  };

  const startDailyCountdown = () => {
    clearDailyCountdownTimer();
    const syncDailyUi = () => {
      renderDailyMeta();
      const lockChanged = applyDailyBoardLockState(state.getSnapshot());
      if (lockChanged) {
        queueBoardLayout(false, {
          isPathDragging: false,
          pathDragSide: null,
          pathDragCursor: null,
        });
      }
    };
    syncDailyUi();
    if (!hasDailyLevel || !activeDailyId || !Number.isInteger(dailyResetUtcMs)) return;
    dailyCountdownTimer = window.setInterval(() => {
      syncDailyUi();
    }, 1000);
  };

  const readDebugDailyFreezeState = () => ({
    forced: debugForceDailyFrozen,
    locked: dailyBoardLocked,
  });

  const setDebugForceDailyFrozen = (forced) => {
    debugForceDailyFrozen = Boolean(forced);
    renderDailyMeta();
    applyDailyBoardLockState(state.getSnapshot());
    queueBoardLayout(false, {
      isPathDragging: interactionState.isPathDragging,
      pathDragSide: interactionState.pathDragSide,
      pathDragCursor: interactionState.pathDragCursor,
    });
    return readDebugDailyFreezeState();
  };

  const toggleDebugForceDailyFrozen = () => setDebugForceDailyFrozen(!debugForceDailyFrozen);



  const isDailyLevelIndex = (levelIndex) =>
    typeof core.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex);

  const resolveNextButtonLabel = (levelIndex) => {
    if (isDailyLevelIndex(levelIndex)) {
      return translate('ui.dailyComplete');
    }
    if (core.isInfiniteAbsIndex(levelIndex)) {
      if (core.toInfiniteIndex(levelIndex) >= maxInfiniteIndex) return translate('ui.infiniteComplete');
      return translate('ui.nextInfinite');
    }
    if (levelIndex >= campaignCount - 1 && isCampaignCompleted()) return translate('ui.startInfinite');
    return translate('ui.nextLevel');
  };

  const resolveInfiniteModeLabel = () => {
    const raw = translate('ui.infiniteLevelOption', { n: '' });
    return raw.replace(/\s*#\s*$/, '').trim();
  };

  const resolveCampaignBuckets = () => {
    const tutorialIndices = [];
    const practiceIndices = [];

    for (let i = 0; i < campaignCount; i += 1) {
      const level = core.getLevel(i);
      const nameKey = typeof level?.nameKey === 'string' ? level.nameKey : '';
      if (nameKey.startsWith('level.tutorial_')) {
        tutorialIndices.push(i);
      } else if (nameKey.startsWith('level.pilot_')) {
        practiceIndices.push(i);
      }
    }

    return { tutorialIndices, practiceIndices };
  };

  const renderScoreMeta = () => {
    const refs = renderer.getRefs();
    if (!refs?.scoreMeta || !refs?.infiniteScoreValue || !refs?.dailyScoreValue) return;

    const snapshot = state.getSnapshot();
    const levelIndex = snapshot?.levelIndex;
    const totals = scoreManager.readTotals();
    const infiniteItem = refs.infiniteScoreLabel?.closest('.scoreMetaItem') || null;
    const dailyItem = refs.dailyScoreLabel?.closest('.scoreMetaItem') || null;
    const separator = refs.scoreMeta.querySelector('.scoreMetaSeparator');
    const setScoreMetaActive = (active) => {
      refs.scoreMeta.hidden = false;
      refs.scoreMeta.classList.toggle('isInactive', !active);
      refs.scoreMeta.setAttribute('aria-hidden', active ? 'false' : 'true');
    };

    if (isDailyLevelIndex(levelIndex)) {
      setScoreMetaActive(true);
      if (infiniteItem) infiniteItem.hidden = true;
      if (dailyItem) dailyItem.hidden = false;
      if (separator) separator.hidden = true;
      if (refs.dailyScoreLabel) refs.dailyScoreLabel.textContent = translate('ui.scoreDailyLabel');
      const distinctCount = scoreManager.readDistinctCount({
        mode: SCORE_MODES.DAILY,
        levelKey: activeDailyId,
      });
      refs.dailyScoreValue.textContent = `${totals.dailyTotal} (${distinctCount})`;
      return;
    }

    if (core.isInfiniteAbsIndex(levelIndex)) {
      setScoreMetaActive(true);
      if (infiniteItem) infiniteItem.hidden = false;
      if (dailyItem) dailyItem.hidden = true;
      if (separator) separator.hidden = true;
      if (refs.infiniteScoreLabel) refs.infiniteScoreLabel.textContent = translate('ui.scoreInfiniteLabel');
      const infiniteLevelKey = String(core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex)));
      const distinctCount = scoreManager.readDistinctCount({
        mode: SCORE_MODES.INFINITE,
        levelKey: infiniteLevelKey,
      });
      refs.infiniteScoreValue.textContent = `${totals.infiniteTotal} (${distinctCount})`;
      return;
    }

    setScoreMetaActive(false);
  };

  const registerSolvedScore = (snapshot) => {
    const result = registerSolvedSnapshot({
      snapshot,
      core,
      scoreManager,
    });
    renderScoreMeta();
    return result;
  };

  const appendScoreToCompletionMessage = (baseMessage, scoreResult) => {
    if (!scoreResult) return baseMessage;
    const modeLabel = scoreResult.mode === SCORE_MODES.INFINITE
      ? resolveInfiniteModeLabel()
      : translate('ui.dailyLevelOption');
    return `${baseMessage}<br><b>${modeLabel}: +${scoreResult.awarded}</b> (${scoreResult.modeTotal})`;
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
    if (isDailyLevelIndex(levelIndex)) return false;

    if (core.isInfiniteAbsIndex(levelIndex)) {
      const infiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex));
      if (infiniteIndex >= maxInfiniteIndex) return false;
      const latestUnlockedInfiniteIndex = core.clampInfiniteIndex(readInfiniteProgress());
      return infiniteIndex + 1 <= latestUnlockedInfiniteIndex;
    }

    const nextCampaignIndex = levelIndex + 1;
    if (nextCampaignIndex < campaignCount) return true;
    return isCampaignCompleted();
  };

  const isLevelPreviouslyCleared = (levelIndex) => {
    if (isDailyLevelIndex(levelIndex)) {
      return Boolean(activeDailyId) && activeDailyId === dailySolvedDate;
    }

    if (core.isInfiniteAbsIndex(levelIndex)) {
      const infiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex));
      return infiniteIndex < core.clampInfiniteIndex(readInfiniteProgress());
    }
    return levelIndex < readCampaignProgress();
  };

  const cloneBoardState = (stateValue) => ({
    levelIndex: stateValue.levelIndex,
    path: stateValue.path.map(([r, c]) => [r, c]),
    movableWalls: Array.isArray(stateValue.movableWalls)
      ? stateValue.movableWalls.map(([r, c]) => [r, c])
      : null,
    dailyId: typeof stateValue.dailyId === 'string' ? stateValue.dailyId : null,
  });

  const syncMutableBoardStateFromSnapshot = (snapshot) => {
    if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return false;

    const level = core.getLevel(snapshot.levelIndex);
    if (!level || !Array.isArray(level.grid)) return false;

    const serialized = buildSessionBoardFromSnapshot({
      snapshot,
      activeDailyId,
      isDailyLevelIndex,
    });
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

    if (!mutableBoardState) {
      persistence.clearSessionBoard();
      return;
    }

    const board = cloneBoardState(mutableBoardState);
    persistence.writeSessionBoard(board);
  };

  const queueSessionSave = () => {
    if (destroyed || sessionSaveQueued) return;
    sessionSaveQueued = true;
    sessionSaveTimerId = globalThis.setTimeout(() => {
      sessionSaveTimerId = 0;
      if (destroyed) {
        sessionSaveQueued = false;
        return;
      }
      sessionSaveQueued = false;
      persistSessionSave();
    }, 150);
  };

  const syncInfiniteNavigation = (levelIndex, isCleared = false) => {
    const refs = renderer.getRefs();

    if (isDailyLevelIndex(levelIndex) || !core.isInfiniteAbsIndex(levelIndex)) {
      if (refs?.prevInfiniteBtn) {
        refs.prevInfiniteBtn.hidden = true;
        refs.prevInfiniteBtn.disabled = false;
        setDisabledReasonTitle(refs.prevInfiniteBtn, null);
      }
    } else {
      const infiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex));
      if (refs?.prevInfiniteBtn) {
        refs.prevInfiniteBtn.hidden = false;
        refs.prevInfiniteBtn.disabled = infiniteIndex <= 0;
        setDisabledReasonTitle(
          refs.prevInfiniteBtn,
          refs.prevInfiniteBtn.disabled ? 'ui.prevInfiniteDisabledFirst' : null,
        );
      }
    }

    if (refs?.nextLevelBtn) {
      if (isDailyLevelIndex(levelIndex)) {
        refs.nextLevelBtn.hidden = true;
        refs.nextLevelBtn.disabled = true;
        setDisabledReasonTitle(refs.nextLevelBtn, null);
        return;
      }

      const nextAvailable = isNextLevelAvailable(levelIndex);
      const atInfiniteEnd = core.isInfiniteAbsIndex(levelIndex)
        && core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex)) >= maxInfiniteIndex;
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
    const { nextDailySolvedDate, changedDailySolvedDate } = markClearedLevel({
      levelIndex,
      core,
      activeDailyId,
      dailySolvedDate,
      onCampaignCleared: (campaignLevelIndex) => {
        markCampaignLevelCleared(campaignLevelIndex);
      },
      onInfiniteCleared: (infiniteLevelIndex) => {
        markInfiniteLevelCleared(infiniteLevelIndex);
      },
      onDailyCleared: (dailyId) => {
        persistence.writeDailySolvedDate(dailyId);
      },
    });
    dailySolvedDate = nextDailySolvedDate;
    if (changedDailySolvedDate) {
      effects.onDailySolvedDateChanged?.(nextDailySolvedDate);
    }
    currentBoardSolved = true;
    mutableBoardState = null;
    queueSessionSave();
  };

  const refreshLevelOptions = () => {
    const refs = renderer.getRefs();
    const currentIndex = state.getSnapshot().levelIndex;

    const campaignOptions = [];
    const modeOptions = [];
    const { tutorialIndices, practiceIndices } = resolveCampaignBuckets();
    const tutorialSet = new Set(tutorialIndices);
    const practiceSet = new Set(practiceIndices);
    const infiniteActive = core.isInfiniteAbsIndex(currentIndex);
    const dailyActive = isDailyLevelIndex(currentIndex);
    const campaignActive = !infiniteActive && !dailyActive;
    const firstTutorialIndex = tutorialIndices[0];
    const firstPracticeIndex = practiceIndices[0];
    const buildOption = (value, label, options = {}) => {
      const selected = options.selected ? 'selected' : '';
      const disabled = options.disabled ? 'disabled' : '';
      return `<option value="${value}" ${disabled} ${selected}>${label}</option>`;
    };
    const appendGroup = (labelKey, options) => {
      if (options.length === 0) return '';
      return `<optgroup label="${translate(labelKey)}">${options.join('')}</optgroup>`;
    };

    const selectorInfiniteIndex = core.isInfiniteAbsIndex(currentIndex)
      ? core.clampInfiniteIndex(core.toInfiniteIndex(currentIndex))
      : core.clampInfiniteIndex(readInfiniteProgress());
    const infiniteAbsIndex = core.ensureInfiniteAbsIndex(selectorInfiniteIndex);
    const selectedPrimaryValue = (() => {
      if (dailyActive) return dailyAbsIndex;
      if (infiniteActive) return infiniteAbsIndex;
      if (practiceSet.has(currentIndex) && Number.isInteger(firstPracticeIndex)) return firstPracticeIndex;
      if (tutorialSet.has(currentIndex) && Number.isInteger(firstTutorialIndex)) return firstTutorialIndex;
      if (Number.isInteger(firstTutorialIndex)) return firstTutorialIndex;
      if (Number.isInteger(firstPracticeIndex)) return firstPracticeIndex;
      return 0;
    })();

    if (Number.isInteger(firstTutorialIndex)) {
      campaignOptions.push(buildOption(firstTutorialIndex, translate('ui.levelGroupTutorial'), {
        disabled: !isCampaignLevelUnlocked(firstTutorialIndex),
        selected: selectedPrimaryValue === firstTutorialIndex,
      }));
    }
    if (Number.isInteger(firstPracticeIndex)) {
      campaignOptions.push(buildOption(firstPracticeIndex, translate('ui.levelGroupPractice'), {
        disabled: !isCampaignLevelUnlocked(firstPracticeIndex),
        selected: selectedPrimaryValue === firstPracticeIndex,
      }));
    }

    const translated = resolveInfiniteModeLabel();
    const fallback = resolveLevelName(core.getLevel(infiniteAbsIndex));
    const infiniteLabel = translated === 'ui.infiniteLevelOption' ? fallback : translated;
    modeOptions.push(buildOption(infiniteAbsIndex, infiniteLabel, {
      selected: selectedPrimaryValue === infiniteAbsIndex,
    }));

    const dailyLabel = (() => {
      if (!hasDailyLevel) return translate('ui.dailyUnavailable');
      const base = translate('ui.dailyLevelOption');
      if (!activeDailyId) return base;
      const date = formatDailyMonthDayLabel(activeDailyId, activeLocale);
      const templated = translate('ui.dailyLevelOptionWithDate', { label: base, date });
      if (templated !== 'ui.dailyLevelOptionWithDate') return templated;
      return `${base}(${date})`;
    })();
    modeOptions.push(buildOption(dailyAbsIndex, dailyLabel, {
      disabled: !hasDailyLevel,
      selected: selectedPrimaryValue === dailyAbsIndex,
    }));

    const optionHtml = [
      appendGroup('ui.levelGroupCampaign', campaignOptions),
      appendGroup('ui.levelGroupModes', modeOptions),
    ].join('');

    refs.levelSel.innerHTML = optionHtml;
    refs.levelSel.value = String(selectedPrimaryValue);

    if (refs.levelSelectGroup && refs.infiniteSel) {
      const secondaryActive = campaignActive || infiniteActive;

      refs.levelSelectGroup.classList.toggle('isCampaignActive', campaignActive);
      refs.levelSelectGroup.classList.toggle('isInfiniteActive', infiniteActive);
      refs.levelSelectGroup.classList.toggle('isDailyActive', dailyActive);
      if (refs.levelSelectGroup.parentElement) {
        refs.levelSelectGroup.parentElement.classList.toggle('isCampaignActive', campaignActive);
        refs.levelSelectGroup.parentElement.classList.toggle('isInfiniteActive', infiniteActive);
        refs.levelSelectGroup.parentElement.classList.toggle('isDailyActive', dailyActive);
      }

      refs.infiniteSel.hidden = !secondaryActive;
      refs.infiniteSel.disabled = !secondaryActive;

      if (!secondaryActive) {
        refs.infiniteSel.innerHTML = '';
      } else if (campaignActive) {
        const activeCampaignIndices = (
          practiceSet.has(currentIndex) && practiceIndices.length > 0
            ? practiceIndices
            : (tutorialIndices.length > 0 ? tutorialIndices : practiceIndices)
        );
        if (activeCampaignIndices.length === 0) {
          refs.infiniteSel.innerHTML = '';
          refs.infiniteSel.hidden = true;
          refs.infiniteSel.disabled = true;
        } else {
          const selectedCampaignIndex = activeCampaignIndices.includes(currentIndex)
            ? currentIndex
            : activeCampaignIndices[0];
          let campaignOptionHtml = '';
          for (let i = 0; i < activeCampaignIndices.length; i += 1) {
            const levelIndex = activeCampaignIndices[i];
            const disabled = !isCampaignLevelUnlocked(levelIndex) ? 'disabled' : '';
            const levelName = resolveLevelName(core.getLevel(levelIndex));
            const levelLabel = levelName ? `${i + 1}) ${levelName}` : String(i + 1);
            campaignOptionHtml += `<option value="${levelIndex}" ${levelIndex === selectedCampaignIndex ? 'selected' : ''} ${disabled}>${levelLabel}</option>`;
          }
          refs.infiniteSel.innerHTML = campaignOptionHtml;
          refs.infiniteSel.value = String(selectedCampaignIndex);
        }
      } else {
        const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(currentIndex));
        const latestUnlockedInfiniteIndex = Math.max(
          core.clampInfiniteIndex(readInfiniteProgress()),
          currentInfiniteIndex,
        );
        const pageStart = Math.floor(currentInfiniteIndex / INFINITE_PAGE_SIZE) * INFINITE_PAGE_SIZE;
        const pageEnd = Math.min(maxInfiniteIndex, pageStart + INFINITE_PAGE_SIZE - 1);
        const prevPageStart = Math.max(0, pageStart - INFINITE_PAGE_SIZE);
        const prevPageEnd = pageStart - 1;
        const nextPageStart = pageStart + INFINITE_PAGE_SIZE;
        const nextPageEnd = Math.min(maxInfiniteIndex, nextPageStart + INFINITE_PAGE_SIZE - 1);

        let infiniteOptionHtml = '';
        if (pageStart > 0) {
          infiniteOptionHtml += `<option value="${INFINITE_SELECTOR_ACTIONS.first}">&laquo; #1</option>`;
          infiniteOptionHtml += `<option value="${INFINITE_SELECTOR_ACTIONS.prev}">&lsaquo; #${prevPageStart + 1}-#${prevPageEnd + 1}</option>`;
        }

        for (let i = pageStart; i <= pageEnd; i += 1) {
          const disabled = i > latestUnlockedInfiniteIndex ? 'disabled' : '';
          infiniteOptionHtml += `<option value="${i}" ${i === currentInfiniteIndex ? 'selected' : ''} ${disabled}>${i + 1}</option>`;
        }

        if (pageEnd < maxInfiniteIndex) {
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
    const refs = renderer.getRefs();

    currentLevelCleared = isLevelPreviouslyCleared(levelIndex);
    currentBoardSolved = false;
    setUiMessage(null, core.goalText(levelIndex, translate));

    if (refs?.nextLevelBtn) {
      refs.nextLevelBtn.textContent = resolveNextButtonLabel(levelIndex);
      refs.nextLevelBtn.hidden = false;
    }
    if (refs?.prevInfiniteBtn) refs.prevInfiniteBtn.hidden = true;
    syncInfiniteNavigation(levelIndex, currentLevelCleared);
  };

  const resolveDraggedHintSuppressionKey = (snapshot) => {
    if (!interactionState.isPathDragging) return null;
    const side = interactionState.pathDragSide;
    if (side !== 'start' && side !== 'end') return null;
    if (snapshot.path.length === 0) return null;

    const endpoint = side === 'start'
      ? snapshot.path[0]
      : snapshot.path[snapshot.path.length - 1];
    if (!endpoint) return null;

    return `${endpoint.r},${endpoint.c}`;
  };

  const isPathDragCursorOnActiveEndpoint = (
    snapshot,
    isPathDragging,
    pathDragSide,
    pathDragCursor,
  ) => {
    if (!isPathDragging) return false;
    const side = pathDragSide;
    if (side !== 'start' && side !== 'end') return false;
    if (!snapshot || snapshot.path.length === 0) return false;

    const endpoint = side === 'start'
      ? snapshot.path[0]
      : snapshot.path[snapshot.path.length - 1];
    return Boolean(endpoint);
  };

  const resolvePathStepCommandSide = (commandType, payload = null) => {
    if (commandType === GAME_COMMANDS.START_OR_STEP_FROM_START) return 'start';
    if (commandType === GAME_COMMANDS.START_OR_STEP) return 'end';
    if (commandType === GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE) {
      return payload?.side === 'start' ? 'start' : (payload?.side === 'end' ? 'end' : null);
    }
    return null;
  };

  const clonePathPoint = (point) => ({ r: point.r, c: point.c });

  const pathsMatchForHint = (leftPath, rightPath) => {
    if (!Array.isArray(leftPath) || !Array.isArray(rightPath)) return false;
    if (leftPath.length !== rightPath.length) return false;
    for (let i = 0; i < leftPath.length; i += 1) {
      if (!pointsMatch(leftPath[i], rightPath[i])) return false;
    }
    return true;
  };

  const resolveDragSequenceTipArrivalHint = (side, prevSnapshot, nextSnapshot, payload) => {
    if (side !== 'start' && side !== 'end') return null;
    const steps = Array.isArray(payload?.steps) ? payload.steps : [];
    if (steps.length <= 0) return null;

    const prevPath = Array.isArray(prevSnapshot?.path) ? prevSnapshot.path : [];
    const nextPath = Array.isArray(nextSnapshot?.path) ? nextSnapshot.path : [];
    const workingPath = prevPath.map(clonePathPoint);
    let lastAdvanceHint = null;

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!Number.isInteger(step?.r) || !Number.isInteger(step?.c)) return null;

      if (side === 'start') {
        const currentTip = workingPath[0] || null;
        const retractNeighbor = workingPath[1] || null;
        const isRetract = Boolean(retractNeighbor && pointsMatch(retractNeighbor, step));
        if (isRetract) {
          workingPath.shift();
          lastAdvanceHint = null;
          continue;
        }
        if (currentTip) {
          lastAdvanceHint = {
            side,
            from: clonePathPoint(currentTip),
            to: { r: step.r, c: step.c },
          };
        } else {
          lastAdvanceHint = null;
        }
        workingPath.unshift({ r: step.r, c: step.c });
        continue;
      }

      const currentTip = workingPath[workingPath.length - 1] || null;
      const retractNeighbor = workingPath.length > 1
        ? workingPath[workingPath.length - 2]
        : null;
      const isRetract = Boolean(retractNeighbor && pointsMatch(retractNeighbor, step));
      if (isRetract) {
        workingPath.pop();
        lastAdvanceHint = null;
        continue;
      }
      if (currentTip) {
        lastAdvanceHint = {
          side,
          from: clonePathPoint(currentTip),
          to: { r: step.r, c: step.c },
        };
      } else {
        lastAdvanceHint = null;
      }
      workingPath.push({ r: step.r, c: step.c });
    }

    if (!pathsMatchForHint(workingPath, nextPath)) return null;
    return lastAdvanceHint;
  };

  const buildPathTipArrivalHint = (commandType, payload, prevSnapshot, nextSnapshot) => {
    const side = resolvePathStepCommandSide(commandType, payload);
    if (!side || !prevSnapshot || !nextSnapshot) return null;

    if (commandType === GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE) {
      return resolveDragSequenceTipArrivalHint(side, prevSnapshot, nextSnapshot, payload);
    }

    const prevPath = Array.isArray(prevSnapshot.path) ? prevSnapshot.path : [];
    const nextPath = Array.isArray(nextSnapshot.path) ? nextSnapshot.path : [];
    if (prevPath.length <= 0 || nextPath.length <= 0) return null;

    const prevTip = side === 'start'
      ? prevPath[0]
      : prevPath[prevPath.length - 1];
    const nextTip = side === 'start'
      ? nextPath[0]
      : nextPath[nextPath.length - 1];
    if (!prevTip || !nextTip) return null;
    if (prevTip.r === nextTip.r && prevTip.c === nextTip.c) return null;

    return {
      side,
      from: { r: prevTip.r, c: prevTip.c },
      to: { r: nextTip.r, c: nextTip.c },
    };
  };

  const invalidateEvaluateCache = () => {
    evaluateCacheBoardVersion += 1;
    evaluateCache.clear();
  };

  const buildEvaluateCacheKey = (snapshot, evaluateOptions = {}) => {
    const suppressEndpointRequirement = evaluateOptions.suppressEndpointRequirement ? '1' : '0';
    const suppressEndpointKey = typeof evaluateOptions.suppressEndpointKey === 'string'
      ? evaluateOptions.suppressEndpointKey
      : '';
    return `${evaluateCacheBoardVersion}|${suppressEndpointRequirement}|${suppressEndpointKey}|${snapshot.pathKey || ''}`;
  };

  const evaluateSnapshot = (snapshot, evaluateOptions = {}, useCache = false) => {
    if (!useCache) return core.evaluate(snapshot, evaluateOptions);
    const cacheKey = buildEvaluateCacheKey(snapshot, evaluateOptions);
    const cached = evaluateCache.get(cacheKey);
    if (cached) {
      evaluateCache.delete(cacheKey);
      evaluateCache.set(cacheKey, cached);
      return cached;
    }

    const result = core.evaluate(snapshot, evaluateOptions);
    evaluateCache.set(cacheKey, result);
    if (evaluateCache.size > EVALUATE_CACHE_LIMIT) {
      const oldestKey = evaluateCache.keys().next().value;
      evaluateCache.delete(oldestKey);
    }
    return result;
  };

  const renderSnapshot = (snapshot, evaluation, completion = null, options = {}) => {
    const completionAnimationTrigger = Boolean(options.completionAnimationTrigger);
    renderer.renderFrame({
      snapshot,
      evaluation,
      completion,
      uiModel: {
        messageKind: currentMessageKind,
        messageHtml: currentMessageHtml,
        isBoardSolved: currentBoardSolved,
        completionAnimationTrigger,
        tutorialFlags: {
          path: snapshot.levelIndex === PATH_BRACKET_TUTORIAL_LEVEL_INDEX,
          movable: snapshot.levelIndex === MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX,
        },
      },
      interactionModel: {
        isDailyLocked: dailyBoardLocked,
        isPathDragging: interactionState.isPathDragging,
        pathDragSide: interactionState.pathDragSide,
        pathDragCursor: interactionState.pathDragCursor,
        pathTipArrivalHint: interactionState.pathTipArrivalHint,
        isWallDragging: interactionState.isWallDragging,
        wallGhost: interactionState.wallGhost,
        dropTarget: interactionState.dropTarget,
      },
    });
  };

  const refresh = (snapshot, validate = false, options = {}) => {
    const draggedHintSuppressionKey = resolveDraggedHintSuppressionKey(snapshot);
    const evaluateOptions = {
      suppressEndpointRequirement: Boolean(draggedHintSuppressionKey),
      suppressEndpointKey: draggedHintSuppressionKey,
    };
    const shouldUseEvaluateCache = Boolean(interactionState.isPathDragging);
    const evaluateResult = evaluateSnapshot(snapshot, evaluateOptions, shouldUseEvaluateCache);

    let completion = null;
    if (validate) {
      completion = core.checkCompletion(snapshot, evaluateResult, translate);
      if (completion.kind === 'good') {
        const scoreResult = registerSolvedScore(snapshot);
        onLevelCleared(snapshot.levelIndex);
        setUiMessage(completion.kind, appendScoreToCompletionMessage(completion.message, scoreResult));
      } else {
        setUiMessage(null, core.goalText(snapshot.levelIndex, translate));
      }

      currentBoardSolved = completion.kind === 'good';
      currentLevelCleared = currentBoardSolved || isLevelPreviouslyCleared(snapshot.levelIndex);
      syncInfiniteNavigation(snapshot.levelIndex, currentLevelCleared);
      if (completion.kind === 'good') {
        refreshLevelOptions();
      }
    }

    applyDailyBoardLockState(snapshot);

    const completionAnimationTrigger = Boolean(
      completion?.kind === 'good'
      && options.validationSource === GAME_COMMANDS.FINALIZE_PATH,
    );
    renderSnapshot(snapshot, evaluateResult, completion, {
      completionAnimationTrigger,
    });
  };

  const runBoardLayout = (validate = false, options = {}) => {
    if (destroyed) return;
    const snapshot = state.getSnapshot();
    if (options.needsResize) renderer.resize();
    refresh(snapshot, validate, options);
    interactionState.pathTipArrivalHint = null;
  };

  const queueBoardLayout = (validate = false, optionsForInteraction = {}) => {
    if (destroyed) return;
    queuedLayoutOptions = {
      ...queuedLayoutOptions,
      ...optionsForInteraction,
    };

    if (Object.prototype.hasOwnProperty.call(queuedLayoutOptions, 'isPathDragging')) {
      interactionState.isPathDragging = Boolean(queuedLayoutOptions.isPathDragging);
    }
    if (Object.prototype.hasOwnProperty.call(queuedLayoutOptions, 'pathDragSide')) {
      interactionState.pathDragSide = queuedLayoutOptions.pathDragSide;
    }
    if (Object.prototype.hasOwnProperty.call(queuedLayoutOptions, 'pathDragCursor')) {
      interactionState.pathDragCursor = queuedLayoutOptions.pathDragCursor;
    }

    if (Boolean(validate)) {
      pendingValidateSource = optionsForInteraction.validationSource || null;
    }
    pendingValidate = pendingValidate || Boolean(validate);
    pendingResize = pendingResize || Boolean(optionsForInteraction.needsResize);
    if (layoutQueued) return;
    layoutQueued = true;
    layoutRafId = requestAnimationFrame(() => {
      layoutRafId = 0;
      if (destroyed) {
        layoutQueued = false;
        pendingValidate = false;
        pendingResize = false;
        pendingValidateSource = null;
        queuedLayoutOptions = {};
        return;
      }
      layoutQueued = false;
      const shouldValidate = pendingValidate;
      const needsResize = pendingResize;
      const validationSource = pendingValidateSource;
      pendingValidate = false;
      pendingResize = false;
      pendingValidateSource = null;
      queuedLayoutOptions = {};
      runBoardLayout(shouldValidate, { validationSource, needsResize });
    });
  };

  const loadLevel = (idx, options = {}) => {
    const suppressFrozenTransition = Boolean(options.suppressFrozenTransition);
    let targetIndex = Number.isInteger(idx) ? idx : 0;
    if (targetIndex < 0) targetIndex = 0;

    if (isDailyLevelIndex(targetIndex)) {
      if (!hasDailyLevel) {
        refreshLevelOptions();
        return;
      }
      targetIndex = dailyAbsIndex;
    } else if (core.isInfiniteAbsIndex(targetIndex)) {
      targetIndex = core.ensureInfiniteAbsIndex(core.clampInfiniteIndex(core.toInfiniteIndex(targetIndex)));
    } else {
      targetIndex = Math.min(targetIndex, campaignCount - 1);
    }

    if (hasLoadedLevel) {
      syncMutableBoardStateFromSnapshot(state.getSnapshot());
    }

    renderer.clearPathTransitionCompensation?.();

    const transition = state.dispatch({
      type: 'level/load',
      payload: { levelIndex: targetIndex },
    });

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
    if (transition.rebuildGrid) {
      invalidateEvaluateCache();
      renderer.rebuildGrid(snapshot);
    }

    showLevelGoal(targetIndex);
    applyDailyBoardLockState(snapshot);
    if (suppressFrozenTransition && typeof renderer.setPathFlowFreezeImmediate === 'function') {
      renderer.setPathFlowFreezeImmediate(dailyBoardLocked);
    }
    syncMutableBoardStateFromSnapshot(snapshot);
    refreshLevelOptions();
    renderScoreMeta();
    renderDailyMeta();
    queueBoardLayout(false, { needsResize: true });
    queueSessionSave();
    hasLoadedLevel = true;
  };

  const refreshStaticUiText = (opts = {}) => {
    const refs = renderer.getRefs();
    const locale = opts.locale || activeLocale;

    document.documentElement.lang = locale;
    applyTextDirection(locale);
    activeLocale = locale;
    translate = i18n.createTranslator(activeLocale);

    if (refs.langSel) {
      refs.langSel.innerHTML = i18n.getLocaleOptions(activeLocale)
        .map((item) => `<option value="${item.value}" ${item.value === activeLocale ? 'selected' : ''}>${item.label}</option>`)
        .join('');
      refs.langSel.value = activeLocale;
    }

    refreshLevelOptions();
    renderScoreMeta();

    applyDataAttributes(appEl, translate);
    renderDailyMeta();
    applyDailyBoardLockState(state.getSnapshot());
    applyPanelVisibility(refs.guidePanel, refs.guideToggleBtn, 'guide', refs.guidePanel.classList.contains('is-hidden'));
    applyPanelVisibility(refs.legendPanel, refs.legendToggleBtn, 'legend', refs.legendPanel.classList.contains('is-hidden'));

    const index = state.getSnapshot().levelIndex;
    showLevelGoal(index);

    if (refs.legend) {
      refs.legend.innerHTML = ui.buildLegendTemplate(
        ui.badgeDefinitions,
        ui.icons,
        ui.iconX,
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

  const applyThemeState = (nextTheme) => {
    applyTheme(nextTheme);
    refreshThemeButton();
    queueBoardLayout(false, { needsResize: true });
  };

  const handleSecondaryLevelSelect = (selectedValue) => {
    const snapshot = state.getSnapshot();
    if (!core.isInfiniteAbsIndex(snapshot.levelIndex)) {
      if (isDailyLevelIndex(snapshot.levelIndex)) {
        refreshLevelOptions();
        return;
      }
      const parsedCampaignIndex = parseInt(selectedValue, 10);
      if (
        !Number.isInteger(parsedCampaignIndex)
        || parsedCampaignIndex < 0
        || parsedCampaignIndex >= campaignCount
        || !isCampaignLevelUnlocked(parsedCampaignIndex)
      ) {
        refreshLevelOptions();
        return;
      }
      if (parsedCampaignIndex === snapshot.levelIndex) {
        refreshLevelOptions();
        return;
      }
      loadLevel(parsedCampaignIndex);
      return;
    }

    const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(snapshot.levelIndex));
    const latestUnlockedInfiniteIndex = Math.max(
      core.clampInfiniteIndex(readInfiniteProgress()),
      currentInfiniteIndex,
    );
    const currentPageStart = Math.floor(currentInfiniteIndex / INFINITE_PAGE_SIZE) * INFINITE_PAGE_SIZE;

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
      if (Number.isInteger(parsed)) targetInfiniteIndex = core.clampInfiniteIndex(parsed);
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

    loadLevel(core.ensureInfiniteAbsIndex(clampedTarget));
  };

  const handleUiAction = (payload) => {
    const refs = renderer.getRefs();
    const actionType = payload?.actionType;

    if (actionType === UI_ACTIONS.LEVEL_SELECT) {
      loadLevel(payload.value, {
        suppressFrozenTransition: Boolean(payload?.suppressFrozenTransition),
      });
      return;
    }

    if (actionType === UI_ACTIONS.INFINITE_SELECT) {
      handleSecondaryLevelSelect(payload.value);
      return;
    }

    if (actionType === UI_ACTIONS.LOCALE_CHANGE) {
      setSettingsMenuOpen(false);
      const nextLocale = i18n.setLocale(payload.value);
      refreshStaticUiText({ locale: nextLocale });
      queueBoardLayout(true, {
        isPathDragging: interactionState.isPathDragging,
        pathDragSide: interactionState.pathDragSide,
        pathDragCursor: interactionState.pathDragCursor,
        needsResize: true,
      });
      return;
    }

    if (actionType === UI_ACTIONS.THEME_TOGGLE) {
      setSettingsMenuOpen(false);
      const targetTheme = activeTheme === 'dark' ? 'light' : 'dark';
      if (targetTheme === 'light' && requestLightThemeConfirmation(targetTheme)) return;
      applyThemeState(targetTheme);
      return;
    }

    if (actionType === UI_ACTIONS.THEME_DIALOG_CLOSE) {
      const targetTheme = payload.pendingTheme;
      if (targetTheme === 'light' && payload.returnValue === 'confirm') {
        applyThemeState(targetTheme);
      }
      if (refs.themeSwitchDialog) {
        delete refs.themeSwitchDialog.dataset.pendingTheme;
        refs.themeSwitchDialog.returnValue = '';
      }
      return;
    }

    if (actionType === UI_ACTIONS.SETTINGS_TOGGLE) {
      setSettingsMenuOpen(!settingsMenuOpen);
      return;
    }

    if (actionType === UI_ACTIONS.SETTINGS_CLOSE || actionType === UI_ACTIONS.DOCUMENT_ESCAPE) {
      setSettingsMenuOpen(false);
      return;
    }

    if (actionType === UI_ACTIONS.PANEL_TOGGLE) {
      if (payload.panel === 'guide') {
        const hidden = !refs.guidePanel.classList.contains('is-hidden');
        applyPanelVisibility(refs.guidePanel, refs.guideToggleBtn, 'guide', hidden);
        queueBoardLayout(false, { needsResize: true });
      } else if (payload.panel === 'legend') {
        const hidden = !refs.legendPanel.classList.contains('is-hidden');
        applyPanelVisibility(refs.legendPanel, refs.legendToggleBtn, 'legend', hidden);
        queueBoardLayout(false, { needsResize: true });
      }
      return;
    }

    if (actionType === UI_ACTIONS.RESET_CLICK) {
      if (dailyBoardLocked) return;
      renderer.clearPathTransitionCompensation?.();
      state.dispatch({ type: 'path/reset', payload: {} });
      const snapshot = state.getSnapshot();
      refresh(snapshot, false);
      showLevelGoal(snapshot.levelIndex);
      mutableBoardState = null;
      queueSessionSave();
      return;
    }

    if (actionType === UI_ACTIONS.REVERSE_CLICK) {
      if (dailyBoardLocked) return;
      state.dispatch({ type: 'path/reverse', payload: {} });
      refresh(state.getSnapshot(), true, { validationSource: GAME_COMMANDS.FINALIZE_PATH });
      queueSessionSave();
      return;
    }

    if (actionType === UI_ACTIONS.NEXT_LEVEL_CLICK) {
      const snapshot = state.getSnapshot();
      if (isDailyLevelIndex(snapshot.levelIndex)) return;

      if (core.isInfiniteAbsIndex(snapshot.levelIndex)) {
        const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(snapshot.levelIndex));
        if (currentInfiniteIndex >= maxInfiniteIndex) return;
        const latestUnlockedInfiniteIndex = core.clampInfiniteIndex(readInfiniteProgress());
        const nextInfiniteIndex = Math.min(currentInfiniteIndex + 1, latestUnlockedInfiniteIndex, maxInfiniteIndex);
        if (nextInfiniteIndex <= currentInfiniteIndex) return;
        loadLevel(core.ensureInfiniteAbsIndex(nextInfiniteIndex));
        return;
      }

      const nextCampaignIndex = snapshot.levelIndex + 1;
      if (nextCampaignIndex < campaignCount) {
        loadLevel(nextCampaignIndex);
        return;
      }

      if (isCampaignCompleted()) {
        loadLevel(core.ensureInfiniteAbsIndex(core.clampInfiniteIndex(readInfiniteProgress())));
      }
      return;
    }

    if (actionType === UI_ACTIONS.PREV_INFINITE_CLICK) {
      const snapshot = state.getSnapshot();
      if (!core.isInfiniteAbsIndex(snapshot.levelIndex)) return;

      const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(snapshot.levelIndex));
      if (currentInfiniteIndex <= 0) return;

      loadLevel(core.ensureInfiniteAbsIndex(currentInfiniteIndex - 1));
    }
  };

  const handleInteractionUpdate = (payload) => {
    if (dailyBoardLocked) return;
    const updateType = payload?.updateType;

    if (updateType === INTERACTION_UPDATES.PATH_DRAG) {
      const nextIsPathDragging = Boolean(payload.isPathDragging);
      const nextPathDragSide = payload.pathDragSide ?? null;
      const rawCursor = payload.pathDragCursor;
      const nextPathDragCursor = (
        Number.isInteger(rawCursor?.r) && Number.isInteger(rawCursor?.c)
          ? { r: rawCursor.r, c: rawCursor.c }
          : null
      );
      const prevCursor = interactionState.pathDragCursor;
      const cursorChanged = (
        (prevCursor?.r ?? null) !== (nextPathDragCursor?.r ?? null)
        || (prevCursor?.c ?? null) !== (nextPathDragCursor?.c ?? null)
      );
      const stateChanged = (
        interactionState.isPathDragging !== nextIsPathDragging
        || interactionState.pathDragSide !== nextPathDragSide
        || cursorChanged
      );
      if (!stateChanged) return;

      const snapshot = state.getSnapshot();
      const prevSuppressEndpoint = isPathDragCursorOnActiveEndpoint(
        snapshot,
        interactionState.isPathDragging,
        interactionState.pathDragSide,
        interactionState.pathDragCursor,
      );
      const nextSuppressEndpoint = isPathDragCursorOnActiveEndpoint(
        snapshot,
        nextIsPathDragging,
        nextPathDragSide,
        nextPathDragCursor,
      );
      const shouldQueueLayout = (
        interactionState.isPathDragging !== nextIsPathDragging
        || interactionState.pathDragSide !== nextPathDragSide
        || prevSuppressEndpoint !== nextSuppressEndpoint
      );
      const endedPathDrag = interactionState.isPathDragging && !nextIsPathDragging;

      interactionState.isPathDragging = nextIsPathDragging;
      interactionState.pathDragSide = nextPathDragSide;
      interactionState.pathDragCursor = nextPathDragCursor;
      if (endedPathDrag) evaluateCache.clear();
      renderer.updateInteraction?.(interactionState);
      if (shouldQueueLayout) {
        queueBoardLayout(false, {
          isPathDragging: interactionState.isPathDragging,
          pathDragSide: interactionState.pathDragSide,
          pathDragCursor: interactionState.pathDragCursor,
        });
      }
      return;
    }

    if (updateType === INTERACTION_UPDATES.WALL_DRAG) {
      const nextWallDragging = Boolean(payload.isWallDragging);
      const nextVisible = Boolean(payload.visible);
      const nextX = Number.isFinite(payload.x) ? payload.x : interactionState.wallGhost.x;
      const nextY = Number.isFinite(payload.y) ? payload.y : interactionState.wallGhost.y;
      const stateChanged = (
        interactionState.isWallDragging !== nextWallDragging
        || interactionState.wallGhost.visible !== nextVisible
        || interactionState.wallGhost.x !== nextX
        || interactionState.wallGhost.y !== nextY
      );
      if (!stateChanged) return;

      interactionState.isWallDragging = nextWallDragging;
      interactionState.wallGhost = {
        visible: nextVisible,
        x: nextX,
        y: nextY,
      };
      renderer.updateInteraction?.(interactionState);
      return;
    }

    if (updateType === INTERACTION_UPDATES.WALL_DROP_TARGET) {
      const nextDropTarget = payload.dropTarget || null;
      const prevDropTarget = interactionState.dropTarget;
      const stateChanged = (
        (prevDropTarget?.r ?? null) !== (nextDropTarget?.r ?? null)
        || (prevDropTarget?.c ?? null) !== (nextDropTarget?.c ?? null)
      );
      if (!stateChanged) return;

      interactionState.dropTarget = nextDropTarget;
      renderer.updateInteraction?.(interactionState);
    }
  };

  const handleGameCommand = (payload) => {
    if (dailyBoardLocked) return;
    if (!payload?.commandType) return;
    const commandType = payload.commandType;
    const pathStepSide = resolvePathStepCommandSide(commandType, payload);
    const isPathStepCommand = pathStepSide === 'start' || pathStepSide === 'end';
    const previousSnapshot = isPathStepCommand ? state.getSnapshot() : null;

    const transition = state.dispatch({
      type: commandType,
      payload,
    });

    if (transition.changed && isPathStepCommand) {
      renderer.recordPathTransition?.(
        previousSnapshot,
        transition.snapshot,
        interactionState,
      );
      interactionState.pathTipArrivalHint = buildPathTipArrivalHint(
        commandType,
        payload,
        previousSnapshot,
        transition.snapshot,
      );
    } else if (!isPathStepCommand) {
      interactionState.pathTipArrivalHint = null;
    }

    if (
      commandType === GAME_COMMANDS.RESET_PATH
      || commandType === GAME_COMMANDS.LOAD_LEVEL
      || (!isPathStepCommand && transition.rebuildGrid)
    ) {
      renderer.clearPathTransitionCompensation?.();
    }

    if (transition.rebuildGrid) {
      invalidateEvaluateCache();
      renderer.rebuildGrid(transition.snapshot);
    }
    if (commandType === GAME_COMMANDS.WALL_MOVE_ATTEMPT && transition.changed) {
      invalidateEvaluateCache();
    }

    if (!transition.changed && !transition.validate && !transition.rebuildGrid) {
      return;
    }

    queueBoardLayout(transition.validate, {
      isPathDragging: interactionState.isPathDragging,
      pathDragSide: interactionState.pathDragSide,
      pathDragCursor: interactionState.pathDragCursor,
      validationSource: transition.validate ? commandType : null,
      needsResize: transition.rebuildGrid,
    });

    const shouldPersistInputState = Boolean(transition.validate) && !interactionState.isPathDragging;
    if (shouldPersistInputState) queueSessionSave();
  };

  const emitIntent = (intent) => {
    if (!intent || !intent.type) return;

    if (intent.type === INTENT_TYPES.UI_ACTION) {
      handleUiAction(intent.payload);
      return;
    }

    if (intent.type === INTENT_TYPES.INTERACTION_UPDATE) {
      handleInteractionUpdate(intent.payload);
      return;
    }

    if (intent.type === INTENT_TYPES.GAME_COMMAND) {
      handleGameCommand(intent.payload);
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    destroyed = false;
    applyTheme(activeTheme);
    document.documentElement.lang = activeLocale;
    applyTextDirection(activeLocale);

    renderer.mount();
    const refs = renderer.getRefs();

    if (refs.legend) {
      refs.legend.innerHTML = ui.buildLegendTemplate(
        ui.badgeDefinitions,
        ui.icons,
        ui.iconX,
        translate,
      );
    }

    if (refs.guidePanel && refs.guideToggleBtn) {
      applyPanelVisibility(refs.guidePanel, refs.guideToggleBtn, 'guide', Boolean(bootState.hiddenPanels?.guide));
    }
    if (refs.legendPanel && refs.legendToggleBtn) {
      applyPanelVisibility(refs.legendPanel, refs.legendToggleBtn, 'legend', Boolean(bootState.hiddenPanels?.legend));
    }

    input.bind({
      refs,
      readSnapshot: () => state.getSnapshot(),
      readLayoutMetrics: () => renderer.getLayoutMetrics?.() || null,
      emitIntent,
    });

    if (typeof ResizeObserver !== 'undefined' && refs.boardWrap) {
      boardResizeObserver = new ResizeObserver(() => {
        renderer.notifyResizeInteraction?.();
        queueBoardLayout(false, { needsResize: true });
      });
      boardResizeObserver.observe(refs.boardWrap);
    }

    if (!beforeUnloadObserverCleanupHandler) {
      beforeUnloadObserverCleanupHandler = () => {
        boardResizeObserver?.disconnect();
      };
    }
    if (!beforeUnloadPersistHandler) {
      beforeUnloadPersistHandler = () => {
        persistSessionSave();
      };
    }
    if (!windowResizeHandler) {
      windowResizeHandler = () => {
        renderer.notifyResizeInteraction?.();
        queueBoardLayout(false, { needsResize: true });
      };
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', beforeUnloadObserverCleanupHandler, { once: true });
      window.addEventListener('beforeunload', beforeUnloadPersistHandler);
      window.addEventListener('resize', windowResizeHandler);
    }

    refreshStaticUiText({ locale: i18n.getLocale() });
    startDailyCountdown();
    refreshLevelOptions();

    const fallbackInitialLevelIndex = isCampaignCompleted()
      ? core.ensureInfiniteAbsIndex(core.clampInfiniteIndex(readInfiniteProgress()))
      : Math.min(readCampaignProgress(), campaignCount - 1);

    const savedInitialLevelIndex = Number.isInteger(sessionSaveData.board?.levelIndex)
      ? sessionSaveData.board.levelIndex
      : null;
    const initialLevelIndex = savedInitialLevelIndex ?? fallbackInitialLevelIndex;

    loadLevel(initialLevelIndex);
  };

  const destroy = () => {
    destroyed = true;
    started = false;
    if (layoutRafId) {
      cancelAnimationFrame(layoutRafId);
      layoutRafId = 0;
    }
    if (sessionSaveTimerId) {
      clearTimeout(sessionSaveTimerId);
      sessionSaveTimerId = 0;
    }
    sessionSaveQueued = false;
    layoutQueued = false;
    pendingValidate = false;
    pendingResize = false;
    pendingValidateSource = null;
    queuedLayoutOptions = {};
    boardResizeObserver?.disconnect();
    boardResizeObserver = null;
    if (typeof window !== 'undefined') {
      if (beforeUnloadObserverCleanupHandler) {
        window.removeEventListener('beforeunload', beforeUnloadObserverCleanupHandler);
      }
      if (beforeUnloadPersistHandler) {
        window.removeEventListener('beforeunload', beforeUnloadPersistHandler);
      }
      if (windowResizeHandler) {
        window.removeEventListener('resize', windowResizeHandler);
      }
    }
    beforeUnloadObserverCleanupHandler = null;
    beforeUnloadPersistHandler = null;
    windowResizeHandler = null;
    clearDailyCountdownTimer();
    input.unbind();
    renderer.unmount();
  };

  return {
    start,
    destroy,
    emitIntent,
    readDebugDailyFreezeState,
    setDebugForceDailyFrozen,
    toggleDebugForceDailyFrozen,
  };
}

export function createHeadlessRuntime(options) {
  const {
    core,
    state,
    persistence,
    effects = {},
  } = options;

  if (!core || !state || !persistence) {
    throw new Error('createHeadlessRuntime requires core, state, and persistence');
  }

  const bootState = persistence.readBootState();
  let campaignProgress = Number.isInteger(bootState.campaignProgress) ? bootState.campaignProgress : 0;
  let infiniteProgress = Number.isInteger(bootState.infiniteProgress) ? bootState.infiniteProgress : 0;
  let dailySolvedDate = typeof bootState.dailySolvedDate === 'string' ? bootState.dailySolvedDate : null;
  const scoreManager = createScoreManager(bootState.scoreState, persistence);
  void effects;

  const evaluate = (validate = false) => {
    const snapshot = state.getSnapshot();
    const result = core.evaluate(snapshot, {});
    const completion = validate ? core.checkCompletion(snapshot, result, (k) => k) : null;
    if (completion?.kind === 'good') {
      registerSolvedSnapshot({
        snapshot,
        core,
        scoreManager,
      });
      const { nextDailySolvedDate } = markClearedLevel({
        levelIndex: snapshot.levelIndex,
        core,
        activeDailyId: typeof core.getDailyId === 'function' ? core.getDailyId() : null,
        dailySolvedDate,
        onCampaignCleared: (campaignLevelIndex) => {
          const next = Math.max(campaignProgress, campaignLevelIndex + 1);
          campaignProgress = Math.min(core.getCampaignLevelCount(), next);
          persistence.writeCampaignProgress(campaignProgress);
        },
        onInfiniteCleared: (infiniteLevelIndex) => {
          const next = Math.max(infiniteProgress, infiniteLevelIndex + 1);
          infiniteProgress = Math.min(core.getInfiniteMaxIndex(), next);
          persistence.writeInfiniteProgress(infiniteProgress);
        },
        onDailyCleared: (dailyId) => {
          persistence.writeDailySolvedDate(dailyId);
        },
      });
      dailySolvedDate = nextDailySolvedDate;
      persistence.clearSessionBoard();
    }
    return { snapshot, result, completion };
  };

  return {
    start(initialLevelIndex = 0) {
      state.dispatch({ type: 'level/load', payload: { levelIndex: initialLevelIndex } });
      if (bootState.sessionBoard && bootState.sessionBoard.levelIndex === initialLevelIndex) {
        state.restoreMutableState(bootState.sessionBoard);
      }
      return evaluate(false);
    },

    dispatch(commandType, payload = {}) {
      const transition = state.dispatch({ type: commandType, payload });
      const out = evaluate(Boolean(transition.validate));
      if (out.snapshot.path.length > 0) {
        const board = buildSessionBoardFromSnapshot({
          snapshot: out.snapshot,
          activeDailyId: typeof core.getDailyId === 'function' ? core.getDailyId() : null,
          isDailyLevelIndex: (levelIndex) => (
            typeof core.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex)
          ),
        });
        persistence.writeSessionBoard(board);
      }
      return { ...transition, ...out };
    },

    getProgress() {
      return { campaignProgress, infiniteProgress, dailySolvedDate };
    },

    getSnapshot() {
      return state.getSnapshot();
    },
  };
}
