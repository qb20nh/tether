import { INTENT_TYPES, UI_ACTIONS, INTERACTION_UPDATES, GAME_COMMANDS } from './intents.js';

const PATH_BRACKET_TUTORIAL_LEVEL_INDEX = 0;
const MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX = 7;

const INFINITE_PAGE_SIZE = 10;
const INFINITE_SELECTOR_ACTIONS = Object.freeze({
  first: '__first__',
  prev: '__prev_page__',
  next: '__next_page__',
  last: '__last__',
});

const normalizeTheme = (theme) => (theme === 'light' || theme === 'dark' ? theme : 'dark');
const isRtlLocale = (locale) => /^ar/i.test(locale || '');

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

  const bootState = persistence.readBootState();

  let campaignProgress = Number.isInteger(bootState.campaignProgress) ? bootState.campaignProgress : 0;
  let infiniteProgress = Number.isInteger(bootState.infiniteProgress) ? bootState.infiniteProgress : 0;
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

  const interactionState = {
    isPathDragging: false,
    pathDragSide: null,
    pathDragCursor: null,
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
  let pendingValidateSource = null;
  let settingsMenuOpen = false;

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
    activeTheme = normalizeTheme(theme);
    const root = document.documentElement;
    root.dataset.theme = activeTheme;
    root.classList.toggle('theme-light', activeTheme === 'light');
    persistence.writeTheme(activeTheme);
  };

  const readCampaignProgress = () => campaignProgress;
  const readInfiniteProgress = () => infiniteProgress;
  const isCampaignCompleted = () => campaignProgress >= campaignCount;

  const setUiMessage = (kind, html) => {
    currentMessageKind = kind;
    currentMessageHtml = html;
  };

  const resolveLevelName = (level) => {
    if (level?.nameKey) {
      const translated = translate(level.nameKey);
      if (translated !== level.nameKey) return translated;
    }
    return level?.name || '';
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

  const refreshThemeButton = () => {
    const refs = renderer.getRefs();
    if (!refs?.themeToggle) return;
    const isDark = activeTheme === 'dark';
    const nextLabel = isDark ? translate('ui.themeLight') : translate('ui.themeDark');
    refs.themeToggle.textContent = nextLabel;
    refs.themeToggle.setAttribute('aria-label', nextLabel);
    refs.themeToggle.setAttribute('title', nextLabel);
  };

  const setThemeSwitchPrompt = (nextTheme) => {
    const refs = renderer.getRefs();
    if (!refs?.themeSwitchMessage) return;
    const targetLabel = nextTheme === 'light' ? translate('ui.themeLight') : translate('ui.themeDark');
    const fallback = targetLabel ? `Switch to ${targetLabel}?` : translate('ui.themeLight');
    refs.themeSwitchMessage.textContent =
      translate('ui.themeSwitchPrompt', { theme: targetLabel || '' }) || fallback;
  };

  const requestLightThemeConfirmation = (targetTheme) => {
    const refs = renderer.getRefs();
    if (!refs?.themeSwitchDialog || typeof refs.themeSwitchDialog.showModal !== 'function') {
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

  const refreshSettingsToggle = () => {
    const refs = renderer.getRefs();
    if (!refs?.settingsToggle) return;
    const label = `${translate('ui.language')} / ${translate('ui.theme')}`;
    refs.settingsToggle.setAttribute('aria-label', label);
    refs.settingsToggle.setAttribute('title', label);
  };

  const isCampaignLevelUnlocked = (index) => index <= readCampaignProgress();

  const markCampaignLevelCleared = (index) => {
    const nextProgress = Math.max(readCampaignProgress(), index + 1);
    const clampedProgress = Math.min(nextProgress, campaignCount);
    if (clampedProgress === campaignProgress) return false;
    campaignProgress = clampedProgress;
    persistence.writeCampaignProgress(campaignProgress);
    return true;
  };

  const markInfiniteLevelCleared = (infiniteIndex) => {
    const nextProgress = Math.min(maxInfiniteIndex, Math.max(readInfiniteProgress(), infiniteIndex + 1));
    if (nextProgress === infiniteProgress) return false;
    infiniteProgress = nextProgress;
    persistence.writeInfiniteProgress(infiniteProgress);
    return true;
  };

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

  const serializeMutableBoardState = (snapshot) => {
    if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return null;

    const level = core.getLevel(snapshot.levelIndex);
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
      dailyId: isDailyLevelIndex(snapshot.levelIndex) ? activeDailyId : null,
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

    if (!mutableBoardState) {
      persistence.clearSessionBoard();
      return;
    }

    const board = cloneBoardState(mutableBoardState);
    persistence.writeSessionBoard(board);
  };

  const queueSessionSave = () => {
    if (sessionSaveQueued) return;
    sessionSaveQueued = true;

    window.setTimeout(() => {
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
    if (isDailyLevelIndex(levelIndex)) {
      if (activeDailyId) {
        dailySolvedDate = activeDailyId;
        persistence.writeDailySolvedDate(activeDailyId);
      }
    } else if (core.isInfiniteAbsIndex(levelIndex)) {
      markInfiniteLevelCleared(core.toInfiniteIndex(levelIndex));
    } else {
      markCampaignLevelCleared(levelIndex);
    }
    currentBoardSolved = true;
    mutableBoardState = null;
    queueSessionSave();
  };

  const refreshLevelOptions = () => {
    const refs = renderer.getRefs();
    const currentIndex = state.getSnapshot().levelIndex;

    let optionHtml = '';
    for (let i = 0; i < campaignCount; i++) {
      const level = core.getLevel(i);
      const disabled = !isCampaignLevelUnlocked(i);
      optionHtml += `<option value="${i}" ${disabled ? 'disabled' : ''}${i === currentIndex ? 'selected' : ''}>${resolveLevelName(level)}</option>`;
    }

    if (isCampaignCompleted()) {
      const selectorInfiniteIndex = core.isInfiniteAbsIndex(currentIndex)
        ? core.clampInfiniteIndex(core.toInfiniteIndex(currentIndex))
        : core.clampInfiniteIndex(readInfiniteProgress());
      const infiniteAbsIndex = core.ensureInfiniteAbsIndex(selectorInfiniteIndex);
      const translated = resolveInfiniteModeLabel();
      const fallback = resolveLevelName(core.getLevel(infiniteAbsIndex));
      const infiniteLabel = translated === 'ui.infiniteLevelOption' ? fallback : translated;
      optionHtml += `<option value="${infiniteAbsIndex}" ${infiniteAbsIndex === currentIndex ? 'selected' : ''}>${infiniteLabel}</option>`;
    }

    const dailyLabel = hasDailyLevel
      ? translate('ui.dailyLevelOption')
      : translate('ui.dailyUnavailable');
    const dailyDisabled = hasDailyLevel ? '' : 'disabled';
    optionHtml += `<option value="${dailyAbsIndex}" ${dailyDisabled} ${dailyAbsIndex === currentIndex ? 'selected' : ''}>${dailyLabel}</option>`;

    refs.levelSel.innerHTML = optionHtml;
    refs.levelSel.value = String(currentIndex);

    if (refs.levelSelectGroup && refs.infiniteSel) {
      const infiniteActive = core.isInfiniteAbsIndex(currentIndex);
      refs.levelSelectGroup.classList.toggle('isInfiniteActive', infiniteActive);
      refs.infiniteSel.hidden = !infiniteActive;
      refs.infiniteSel.disabled = !infiniteActive;

      if (!infiniteActive) {
        refs.infiniteSel.innerHTML = '';
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
    const cursor = interactionState.pathDragCursor;
    if (side !== 'start' && side !== 'end') return null;
    if (!cursor || !Number.isInteger(cursor.r) || !Number.isInteger(cursor.c)) return null;
    if (snapshot.path.length === 0) return null;

    const endpoint = side === 'start'
      ? snapshot.path[0]
      : snapshot.path[snapshot.path.length - 1];
    if (!endpoint || endpoint.r !== cursor.r || endpoint.c !== cursor.c) return null;

    return `${cursor.r},${cursor.c}`;
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
        isPathDragging: interactionState.isPathDragging,
        pathDragSide: interactionState.pathDragSide,
        pathDragCursor: interactionState.pathDragCursor,
        isWallDragging: interactionState.isWallDragging,
        wallGhost: interactionState.wallGhost,
        dropTarget: interactionState.dropTarget,
      },
    });
  };

  const refresh = (snapshot, validate = false, options = {}) => {
    const draggedHintSuppressionKey = resolveDraggedHintSuppressionKey(snapshot);
    const evaluateResult = core.evaluate(snapshot, {
      suppressEndpointRequirement: Boolean(draggedHintSuppressionKey),
      suppressEndpointKey: draggedHintSuppressionKey,
    });

    let completion = null;
    if (validate) {
      completion = core.checkCompletion(snapshot, evaluateResult, translate);
      if (completion.kind === 'good') {
        onLevelCleared(snapshot.levelIndex);
        setUiMessage(completion.kind, completion.message);
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

    const completionAnimationTrigger = Boolean(
      completion?.kind === 'good'
      && options.validationSource === GAME_COMMANDS.FINALIZE_PATH,
    );
    renderSnapshot(snapshot, evaluateResult, completion, {
      completionAnimationTrigger,
    });
  };

  const runBoardLayout = (validate = false, options = {}) => {
    const snapshot = state.getSnapshot();
    renderer.resize();
    refresh(snapshot, validate, options);
  };

  const queueBoardLayout = (validate = false, optionsForInteraction = {}) => {
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
    if (layoutQueued) return;
    layoutQueued = true;

    requestAnimationFrame(() => {
      layoutQueued = false;
      const shouldValidate = pendingValidate;
      const validationSource = pendingValidateSource;
      pendingValidate = false;
      pendingValidateSource = null;
      queuedLayoutOptions = {};
      runBoardLayout(shouldValidate, { validationSource });
    });
  };

  const loadLevel = (idx) => {
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
      renderer.rebuildGrid(snapshot);
    }

    showLevelGoal(targetIndex);
    syncMutableBoardStateFromSnapshot(snapshot);
    refreshLevelOptions();
    queueBoardLayout(false);
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

    applyDataAttributes(appEl, translate);
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
  };

  const handleInfiniteSelect = (selectedValue) => {
    const snapshot = state.getSnapshot();
    if (!core.isInfiniteAbsIndex(snapshot.levelIndex)) return;

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
      loadLevel(payload.value);
      return;
    }

    if (actionType === UI_ACTIONS.INFINITE_SELECT) {
      handleInfiniteSelect(payload.value);
      return;
    }

    if (actionType === UI_ACTIONS.LOCALE_CHANGE) {
      setSettingsMenuOpen(false);
      const nextLocale = i18n.setLocale(payload.value);
      refreshStaticUiText({ locale: nextLocale });
      refresh(state.getSnapshot(), true);
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
        queueBoardLayout(false);
      } else if (payload.panel === 'legend') {
        const hidden = !refs.legendPanel.classList.contains('is-hidden');
        applyPanelVisibility(refs.legendPanel, refs.legendToggleBtn, 'legend', hidden);
        queueBoardLayout(false);
      }
      return;
    }

    if (actionType === UI_ACTIONS.RESET_CLICK) {
      state.dispatch({ type: 'path/reset', payload: {} });
      const snapshot = state.getSnapshot();
      refresh(snapshot, false);
      showLevelGoal(snapshot.levelIndex);
      mutableBoardState = null;
      queueSessionSave();
      return;
    }

    if (actionType === UI_ACTIONS.REVERSE_CLICK) {
      state.dispatch({ type: 'path/reverse', payload: {} });
      refresh(state.getSnapshot(), true);
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
    const updateType = payload?.updateType;

    if (updateType === INTERACTION_UPDATES.PATH_DRAG) {
      interactionState.isPathDragging = Boolean(payload.isPathDragging);
      interactionState.pathDragSide = payload.pathDragSide ?? null;
      interactionState.pathDragCursor = payload.pathDragCursor ?? null;
      queueBoardLayout(false, {
        isPathDragging: interactionState.isPathDragging,
        pathDragSide: interactionState.pathDragSide,
        pathDragCursor: interactionState.pathDragCursor,
      });
      return;
    }

    if (updateType === INTERACTION_UPDATES.WALL_DRAG) {
      interactionState.isWallDragging = Boolean(payload.isWallDragging);
      interactionState.wallGhost = {
        visible: Boolean(payload.visible),
        x: Number.isFinite(payload.x) ? payload.x : interactionState.wallGhost.x,
        y: Number.isFinite(payload.y) ? payload.y : interactionState.wallGhost.y,
      };
      queueBoardLayout(false);
      return;
    }

    if (updateType === INTERACTION_UPDATES.WALL_DROP_TARGET) {
      interactionState.dropTarget = payload.dropTarget || null;
      queueBoardLayout(false);
    }
  };

  const handleGameCommand = (payload) => {
    if (!payload?.commandType) return;

    const transition = state.dispatch({
      type: payload.commandType,
      payload,
    });

    if (transition.rebuildGrid) {
      renderer.rebuildGrid(transition.snapshot);
    }

    queueBoardLayout(transition.validate, {
      isPathDragging: interactionState.isPathDragging,
      pathDragSide: interactionState.pathDragSide,
      pathDragCursor: interactionState.pathDragCursor,
      validationSource: transition.validate ? payload.commandType : null,
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
      emitIntent,
    });

    if (typeof ResizeObserver !== 'undefined' && refs.boardWrap) {
      const boardResizeObserver = new ResizeObserver(() => {
        queueBoardLayout(false);
      });
      boardResizeObserver.observe(refs.boardWrap);

      window.addEventListener('beforeunload', () => {
        boardResizeObserver.disconnect();
      }, { once: true });
    }

    window.addEventListener('beforeunload', () => {
      persistSessionSave();
    });

    window.addEventListener('resize', () => {
      queueBoardLayout(false);
    });

    refreshStaticUiText({ locale: i18n.getLocale() });
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
    input.unbind();
    renderer.unmount();
  };

  return {
    start,
    destroy,
    emitIntent,
  };
}

export function createHeadlessRuntime(options) {
  const {
    core,
    state,
    persistence,
  } = options;

  if (!core || !state || !persistence) {
    throw new Error('createHeadlessRuntime requires core, state, and persistence');
  }

  const bootState = persistence.readBootState();
  let campaignProgress = Number.isInteger(bootState.campaignProgress) ? bootState.campaignProgress : 0;
  let infiniteProgress = Number.isInteger(bootState.infiniteProgress) ? bootState.infiniteProgress : 0;
  let dailySolvedDate = typeof bootState.dailySolvedDate === 'string' ? bootState.dailySolvedDate : null;

  const markCleared = (levelIndex) => {
    if (typeof core.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex)) {
      const dailyId = typeof core.getDailyId === 'function' ? core.getDailyId() : null;
      if (dailyId) {
        dailySolvedDate = dailyId;
        persistence.writeDailySolvedDate(dailyId);
      }
      return;
    }

    if (core.isInfiniteAbsIndex(levelIndex)) {
      const next = Math.max(infiniteProgress, core.toInfiniteIndex(levelIndex) + 1);
      infiniteProgress = Math.min(core.getInfiniteMaxIndex(), next);
      persistence.writeInfiniteProgress(infiniteProgress);
      return;
    }
    const next = Math.max(campaignProgress, levelIndex + 1);
    campaignProgress = Math.min(core.getCampaignLevelCount(), next);
    persistence.writeCampaignProgress(campaignProgress);
  };

  const evaluate = (validate = false) => {
    const snapshot = state.getSnapshot();
    const result = core.evaluate(snapshot, {});
    const completion = validate ? core.checkCompletion(snapshot, result, (k) => k) : null;
    if (completion?.kind === 'good') {
      markCleared(snapshot.levelIndex);
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
        const board = {
          levelIndex: out.snapshot.levelIndex,
          path: out.snapshot.path.map((p) => [p.r, p.c]),
          movableWalls: out.snapshot.gridData
            .flatMap((row, r) => row.map((cell, c) => (cell === 'm' ? [r, c] : null)))
            .filter(Boolean),
        };
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
