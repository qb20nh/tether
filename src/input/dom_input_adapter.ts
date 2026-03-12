// @ts-nocheck
import { CELL_TYPES } from '../config.ts';
import {
  cellCenter,
  getCellSize,
  getGridGap,
  getGridPadding,
} from '../geometry.ts';
import {
  GAME_COMMANDS,
  INTENT_TYPES,
  INTERACTION_UPDATES,
  UI_ACTIONS,
} from '../runtime/intents.ts';
import {
  canDropWall,
  isUsableCell,
} from '../state/snapshot_rules.ts';
import { isAdjacentMove } from '../utils.ts';
import {
  chooseSlipperyPathDragStep,
} from './pointer_intent_resolver.ts';

export function createDomInputAdapter() {
  let refs = null;
  let readSnapshot = () => null;
  let readLayoutMetrics = () => null;
  let emitIntent = () => { };
  let listeners = [];

  let dragMode = null;
  let activePointerId = null;
  let wallDrag = null;
  let pathDrag = null;
  let dragGridMetrics = null;
  let wallDragFrame = 0;
  let wallDragQueuedPoint = null;
  const viewportScroll = { x: 0, y: 0 };
  let keyboardGamepadControlsEnabled = false;
  let boardControlSuppressed = false;
  let lastBoardNavLevelIndex = null;
  let lastBoardNavPayload = null;
  let gamepadPollFrame = 0;
  let keyboardDirectionFrame = 0;
  const boardNav = {
    cursor: null,
    selectionCursor: null,
    selectionKind: null,
    navActive: false,
    transientSelectionVisible: false,
    invalidMovePreviewDelta: null,
  };
  let keyboardWallPreviewVisible = false;
  const keyboardConfirmKeysPressed = {
    enter: false,
    space: false,
  };
  const keyboardDirectionsPressed = {
    up: false,
    down: false,
    left: false,
    right: false,
  };
  const keyboardDirectionPressOrder = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
  };
  let nextKeyboardDirectionPressOrder = 1;
  const keyboardDirectionState = {
    directionKey: null,
    nextActionAtMs: 0,
    hasDispatched: false,
  };
  let pendingKeyboardDiagonalReplacement = null;
  const gamepadButtonsPressed = {
    confirm: false,
    reverse: false,
    reset: false,
    prevLevel: false,
    nextLevel: false,
  };
  const gamepadDirectionState = {
    direction: null,
    nextRepeatAtMs: 0,
  };
  const BOARD_SELECTION_KINDS = Object.freeze({
    PATH_START: 'path-start',
    PATH_END: 'path-end',
    WALL: 'wall',
  });
  const DIRECTION_DELTAS = Object.freeze({
    up: { r: -1, c: 0 },
    down: { r: 1, c: 0 },
    left: { r: 0, c: -1 },
    right: { r: 0, c: 1 },
  });
  const KEYBOARD_DIRECTION_KEYS = Object.freeze({
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  });
  const GAMEPLAY_KEYBOARD_KEYS = new Set([
    ...Object.keys(KEYBOARD_DIRECTION_KEYS),
    'Enter',
    ' ',
    'Spacebar',
    'Backspace',
    'Delete',
    'r',
    'R',
    'PageUp',
    'PageDown',
  ]);
  const KEYBOARD_SHORTCUT_ACTIONS = Object.freeze({
    Backspace: 'reset',
    Delete: 'reset',
    r: 'reverse',
    R: 'reverse',
    PageUp: 'prevLevel',
    PageDown: 'nextLevel',
  });
  const GAMEPAD_BUTTON_INDEX = Object.freeze({
    confirm: 0,
    reverse: 2,
    reset: 3,
    prevLevel: 4,
    nextLevel: 5,
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
  });
  const GAMEPAD_STICK_DEADZONE = 0.55;
  const GAMEPAD_DIRECTION_INITIAL_DELAY_MS = 180;
  const GAMEPAD_DIRECTION_REPEAT_MS = 90;
  const KEYBOARD_DIRECTION_CHORD_DELAY_MS = 0;
  const KEYBOARD_DIRECTION_INITIAL_DELAY_MS = 180;
  const KEYBOARD_DIRECTION_REPEAT_MS = 90;

  const addListener = (target, event, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(event, handler, options);
    listeners.push({ target, event, handler, options });
  };

  const clearListeners = () => {
    listeners.forEach(({ target, event, handler, options }) => {
      target.removeEventListener(event, handler, options);
    });
    listeners = [];
  };

  const sendGameCommand = (commandType, payload = {}) => {
    emitIntent({
      type: INTENT_TYPES.GAME_COMMAND,
      payload: { commandType, ...payload },
    });
  };

  const sendUiAction = (actionType, payload = {}) => {
    emitIntent({
      type: INTENT_TYPES.UI_ACTION,
      payload: { actionType, ...payload },
    });
  };

  const sendInteractionUpdate = (updateType, payload = {}) => {
    emitIntent({
      type: INTENT_TYPES.INTERACTION_UPDATE,
      payload: { updateType, ...payload },
    });
  };

  const eventTargetWithin = (target, element) => (
    Boolean(target)
    && Boolean(element)
    && (
      target === element
      || (typeof element.contains === 'function' && element.contains(target))
    )
  );

  const queueWallDragGhostUpdate = (x, y) => {
    wallDragQueuedPoint = {
      x: Number(x) || 0,
      y: Number(y) || 0,
    };
    if (wallDragFrame) return;
    wallDragFrame = requestAnimationFrame(() => {
      wallDragFrame = 0;
      if (!wallDragQueuedPoint) return;
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: wallDragQueuedPoint.x,
        y: wallDragQueuedPoint.y,
        isWallDragging: true,
      });
    });
  };

  const clearQueuedWallDragGhostUpdate = () => {
    wallDragQueuedPoint = null;
    if (!wallDragFrame) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(wallDragFrame);
    }
    wallDragFrame = 0;
  };

  const readViewportScroll = () => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    return {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0,
    };
  };

  const syncViewportScroll = () => {
    const next = readViewportScroll();
    viewportScroll.x = next.x;
    viewportScroll.y = next.y;
    return viewportScroll;
  };

  const getViewportScroll = () => viewportScroll;

  const captureGridMetrics = (snapshot = null) => {
    if (!refs?.gridEl || !snapshot) return null;
    const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
    const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
    if (rows <= 0 || cols <= 0) return null;

    const rect = refs.gridEl.getBoundingClientRect();
    const size = getCellSize(refs.gridEl);
    const gap = getGridGap(refs.gridEl);
    const pad = getGridPadding(refs.gridEl);
    const step = size + gap;
    if (step <= 0) return null;
    const viewportScroll = getViewportScroll();

    return {
      version: 0,
      rows,
      cols,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      size,
      gap,
      step,
      pad,
      scrollX: viewportScroll.x,
      scrollY: viewportScroll.y,
    };
  };

  const isUsableGridMetrics = (metrics, snapshot = null) => {
    if (!metrics || !snapshot) return false;
    const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
    const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
    if (rows <= 0 || cols <= 0) return false;
    return (
      metrics.rows === rows
      && metrics.cols === cols
      && Number.isFinite(metrics.left)
      && Number.isFinite(metrics.top)
      && Number.isFinite(metrics.right)
      && Number.isFinite(metrics.bottom)
      && Number.isFinite(metrics.size)
      && Number.isFinite(metrics.step)
      && Number.isFinite(metrics.pad)
      && metrics.step > 0
    );
  };

  const readCachedGridMetrics = (snapshot = null) => {
    const metrics = readLayoutMetrics();
    if (!isUsableGridMetrics(metrics, snapshot)) return null;

    const currentScroll = getViewportScroll();
    const sourceScrollX = Number.isFinite(metrics.scrollX) ? metrics.scrollX : currentScroll.x;
    const sourceScrollY = Number.isFinite(metrics.scrollY) ? metrics.scrollY : currentScroll.y;
    const scrollDx = currentScroll.x - sourceScrollX;
    const scrollDy = currentScroll.y - sourceScrollY;
    if (!(scrollDx || scrollDy)) return metrics;

    return {
      ...metrics,
      left: metrics.left - scrollDx,
      right: metrics.right - scrollDx,
      top: metrics.top - scrollDy,
      bottom: metrics.bottom - scrollDy,
      scrollX: currentScroll.x,
      scrollY: currentScroll.y,
    };
  };

  const refreshDragGridMetrics = (snapshot = null, forceMeasure = false) => {
    const cachedMetrics = readCachedGridMetrics(snapshot);
    if (cachedMetrics) {
      dragGridMetrics = cachedMetrics;
      return dragGridMetrics;
    }
    if (!snapshot) {
      dragGridMetrics = null;
      return null;
    }
    if (forceMeasure || !isUsableGridMetrics(dragGridMetrics, snapshot)) {
      dragGridMetrics = captureGridMetrics(snapshot);
    }
    return dragGridMetrics;
  };

  const clampToRange = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  const nowMs = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  const cloneCursor = (cursor) => (
    Number.isInteger(cursor?.r) && Number.isInteger(cursor?.c)
      ? { r: cursor.r, c: cursor.c }
      : null
  );

  const cloneBoardSelection = (selectionKind, cursor) => (
    typeof selectionKind === 'string' && cloneCursor(cursor)
      ? { kind: selectionKind, r: cursor.r, c: cursor.c }
      : null
  );

  const cloneDirectionDelta = (delta) => (
    Number.isInteger(delta?.r) && Number.isInteger(delta?.c)
      ? { r: delta.r, c: delta.c }
      : null
  );

  const isBoardNavKeyboardPressActive = () => (
    isGridFocusedForKeyboardBoardInput()
    && (
      keyboardConfirmKeysPressed.enter
      || keyboardConfirmKeysPressed.space
      || keyboardDirectionsPressed.up
      || keyboardDirectionsPressed.down
      || keyboardDirectionsPressed.left
      || keyboardDirectionsPressed.right
    )
  );

  const boardNavPayloadsMatch = (left, right) => (
    Boolean(left?.isBoardNavActive) === Boolean(right?.isBoardNavActive)
    && (left?.boardCursor?.r ?? null) === (right?.boardCursor?.r ?? null)
    && (left?.boardCursor?.c ?? null) === (right?.boardCursor?.c ?? null)
    && (left?.boardSelection?.kind ?? null) === (right?.boardSelection?.kind ?? null)
    && (left?.boardSelection?.r ?? null) === (right?.boardSelection?.r ?? null)
    && (left?.boardSelection?.c ?? null) === (right?.boardSelection?.c ?? null)
    && Boolean(left?.isBoardNavPressing) === Boolean(right?.isBoardNavPressing)
    && (left?.boardSelectionInteractive ?? null) === (right?.boardSelectionInteractive ?? null)
    && (left?.boardNavPreviewDelta?.r ?? null) === (right?.boardNavPreviewDelta?.r ?? null)
    && (left?.boardNavPreviewDelta?.c ?? null) === (right?.boardNavPreviewDelta?.c ?? null)
  );

  const isGridFocusedForKeyboardBoardInput = () => (
    !boardControlSuppressed
    && Boolean(refs?.gridEl)
    && !refs?.themeSwitchDialog?.open
    && typeof document !== 'undefined'
    && document.activeElement === refs.gridEl
  );

  const getConnectedStandardGamepad = () => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    const pads = navigator.getGamepads();
    return Array.from(pads || []).find((candidate) => (
      candidate
      && candidate.connected !== false
      && candidate.mapping === 'standard'
    )) || null;
  };

  const canUseGamepadBoardInput = () => (
    keyboardGamepadControlsEnabled
    && !boardControlSuppressed
    && Boolean(getConnectedStandardGamepad())
    && !activeElementBlocksGamepadBoardInput()
  );

  const isBoardNavCurrentlyControllable = () => (
    keyboardGamepadControlsEnabled
    && !boardControlSuppressed
    && (isGridFocusedForKeyboardBoardInput() || canUseGamepadBoardInput())
  );

  const clearKeyboardWallPreviewInteraction = () => {
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
      visible: false,
      isWallDragging: false,
    });
  };

  const readBoardPreviewGridMetrics = (snapshot = null) => {
    const cachedMetrics = readCachedGridMetrics(snapshot);
    if (cachedMetrics) {
      dragGridMetrics = cachedMetrics;
      return cachedMetrics;
    }
    if (!snapshot) return null;
    dragGridMetrics = captureGridMetrics(snapshot);
    return dragGridMetrics;
  };

  const resolveKeyboardWallGhostPoint = (cursor, snapshot = readSnapshot()) => {
    if (!snapshot || !cloneCursor(cursor) || !refs?.gridEl) return null;
    const metrics = readBoardPreviewGridMetrics(snapshot);
    if (!metrics) return null;
    return {
      x: metrics.left + metrics.pad + (cursor.c * metrics.step) + (metrics.size * (2 / 3)),
      y: metrics.top + metrics.pad + (cursor.r * metrics.step) + (metrics.size * (2 / 3)),
    };
  };

  const refreshKeyboardWallPreview = (snapshot = readSnapshot()) => {
    if (
      !keyboardGamepadControlsEnabled
      || boardControlSuppressed
      || !keyboardWallPreviewVisible
      || boardNav.selectionKind !== BOARD_SELECTION_KINDS.WALL
    ) {
      clearKeyboardWallPreviewInteraction();
      return;
    }

    const cursor = cloneCursor(boardNav.cursor);
    const anchor = cloneCursor(boardNav.selectionCursor);
    if (!snapshot || !cursor || !anchor) {
      clearKeyboardWallPreviewInteraction();
      return;
    }

    const ghostPoint = resolveKeyboardWallGhostPoint(cursor, snapshot);
    if (ghostPoint) {
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: ghostPoint.x,
        y: ghostPoint.y,
        isWallDragging: false,
      });
    } else {
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: false,
        isWallDragging: false,
      });
    }

    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, {
      dropTarget: canDropWall(snapshot, anchor, cursor) ? cursor : null,
    });
  };

  const setKeyboardWallPreviewVisible = (visible, snapshot = readSnapshot()) => {
    keyboardWallPreviewVisible = Boolean(visible);
    refreshKeyboardWallPreview(snapshot);
  };

  const clearKeyboardWallPreviewState = (snapshot = readSnapshot()) => {
    const hadVisiblePreview = keyboardWallPreviewVisible;
    keyboardWallPreviewVisible = false;
    if (!hadVisiblePreview) return;
    refreshKeyboardWallPreview(snapshot);
  };

  const resolveBoardSelectionCursorForDisplay = (snapshot, cursor) => {
    if (typeof boardNav.selectionKind === 'string') {
      return cloneCursor(boardNav.selectionCursor) || cloneCursor(cursor);
    }
    if (
      boardNav.transientSelectionVisible
      && cloneCursor(cursor)
      && !isBoardCursorInteractive(snapshot, cursor)
    ) {
      return cloneCursor(cursor);
    }
    return null;
  };

  const emitBoardNavUpdate = () => {
    const snapshot = readSnapshot();
    const cursor = cloneCursor(boardNav.cursor);
    const selectionKind = resolveBoardSelectionKindForDisplay(snapshot, cursor);
    const selection = cloneBoardSelection(
      selectionKind,
      resolveBoardSelectionCursorForDisplay(snapshot, cursor),
    );
    const previewDelta = cloneDirectionDelta(boardNav.invalidMovePreviewDelta);
    const payload = {
      isBoardNavActive: Boolean(boardNav.navActive) && isBoardNavCurrentlyControllable(),
      boardCursor: cursor,
      boardSelection: selection,
      boardSelectionInteractive: selection ? isBoardCursorInteractive(snapshot, selection) : null,
    };
    if (isBoardNavKeyboardPressActive()) payload.isBoardNavPressing = true;
    if (previewDelta) payload.boardNavPreviewDelta = previewDelta;
    if (boardNavPayloadsMatch(payload, lastBoardNavPayload)) return;
    lastBoardNavPayload = payload;
    sendInteractionUpdate(INTERACTION_UPDATES.BOARD_NAV, payload);
  };

  const refreshBoardNavVisibility = () => {
    if (!keyboardGamepadControlsEnabled) return;
    emitBoardNavUpdate();
  };

  const commitBoardNavState = (nextState = {}) => {
    const nextCursor = Object.hasOwn(nextState, 'cursor')
      ? cloneCursor(nextState.cursor)
      : cloneCursor(boardNav.cursor);
    let nextSelectionKind = boardNav.selectionKind;
    if (Object.hasOwn(nextState, 'selectionKind')) {
      nextSelectionKind = typeof nextState.selectionKind === 'string'
        ? nextState.selectionKind
        : null;
    }
    const nextSelectionCursor = Object.hasOwn(nextState, 'selectionCursor')
      ? cloneCursor(nextState.selectionCursor)
      : cloneCursor(boardNav.selectionCursor);
    const normalizedSelectionCursor = nextSelectionKind
      ? (nextSelectionCursor || cloneCursor(nextCursor))
      : null;
    const nextNavActive = Object.hasOwn(nextState, 'navActive')
      ? Boolean(nextState.navActive)
      : boardNav.navActive;
    const changed = (
      (boardNav.cursor?.r ?? null) !== (nextCursor?.r ?? null)
      || (boardNav.cursor?.c ?? null) !== (nextCursor?.c ?? null)
      || (boardNav.selectionKind ?? null) !== (nextSelectionKind ?? null)
      || (boardNav.selectionCursor?.r ?? null) !== (normalizedSelectionCursor?.r ?? null)
      || (boardNav.selectionCursor?.c ?? null) !== (normalizedSelectionCursor?.c ?? null)
      || boardNav.navActive !== nextNavActive
    );
    const shouldRefreshKeyboardWallPreview = (
      keyboardWallPreviewVisible
      || boardNav.selectionKind === BOARD_SELECTION_KINDS.WALL
      || nextSelectionKind === BOARD_SELECTION_KINDS.WALL
    );
    if (!changed) {
      if (shouldRefreshKeyboardWallPreview) refreshKeyboardWallPreview();
      return false;
    }

    boardNav.cursor = nextCursor;
    boardNav.selectionCursor = normalizedSelectionCursor;
    boardNav.selectionKind = nextSelectionKind;
    boardNav.navActive = nextNavActive;
    boardNav.invalidMovePreviewDelta = null;
    if (shouldRefreshKeyboardWallPreview) refreshKeyboardWallPreview();
    emitBoardNavUpdate();
    return true;
  };

  const setTransientBoardSelectionVisible = (visible) => {
    const nextVisible = Boolean(visible);
    if (boardNav.transientSelectionVisible === nextVisible) return false;
    boardNav.transientSelectionVisible = nextVisible;
    emitBoardNavUpdate();
    return true;
  };

  const setBoardNavInvalidMovePreview = (directionOrDelta) => {
    const nextPreview = normalizeDirectionDelta(directionOrDelta);
    if (!nextPreview) return false;
    if (
      (boardNav.invalidMovePreviewDelta?.r ?? null) === nextPreview.r
      && (boardNav.invalidMovePreviewDelta?.c ?? null) === nextPreview.c
    ) {
      return false;
    }
    boardNav.invalidMovePreviewDelta = nextPreview;
    emitBoardNavUpdate();
    return true;
  };

  const clearBoardNavInvalidMovePreview = () => {
    if (!boardNav.invalidMovePreviewDelta) return false;
    boardNav.invalidMovePreviewDelta = null;
    emitBoardNavUpdate();
    return true;
  };

  const clearBoardNavState = () => {
    pendingKeyboardDiagonalReplacement = null;
    boardNav.transientSelectionVisible = false;
    boardNav.invalidMovePreviewDelta = null;
    clearKeyboardWallPreviewState();
    commitBoardNavState({
      cursor: null,
      selectionCursor: null,
      selectionKind: null,
      navActive: false,
    });
    lastBoardNavLevelIndex = null;
  };

  const isPointInBounds = (snapshot, point) => (
    Boolean(snapshot)
    && Number.isInteger(point?.r)
    && Number.isInteger(point?.c)
    && point.r >= 0
    && point.c >= 0
    && point.r < snapshot.rows
    && point.c < snapshot.cols
  );

  const resolveBoardOriginCursor = (snapshot) => (
    snapshot && snapshot.rows > 0 && snapshot.cols > 0
      ? { r: 0, c: 0 }
      : null
  );

  const pointsMatch = (left, right) => (
    Number.isInteger(left?.r)
    && Number.isInteger(left?.c)
    && Number.isInteger(right?.r)
    && Number.isInteger(right?.c)
    && left.r === right.r
    && left.c === right.c
  );

  const isPathEndpointSelectionKind = (selectionKind) => (
    selectionKind === BOARD_SELECTION_KINDS.PATH_START
    || selectionKind === BOARD_SELECTION_KINDS.PATH_END
  );

  const resolvePathSelectionSide = (selectionKind) => (
    selectionKind === BOARD_SELECTION_KINDS.PATH_START ? 'start' : 'end'
  );

  const isBoardCursorInteractive = (snapshot, cursor) => {
    if (!snapshot || !isPointInBounds(snapshot, cursor)) return false;
    if (snapshot.gridData?.[cursor.r]?.[cursor.c] === CELL_TYPES.MOVABLE_WALL) return true;

    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      return isUsableCell(snapshot, cursor.r, cursor.c);
    }

    const tail = snapshot.path[snapshot.path.length - 1] || null;
    if (tail && pointsMatch(cursor, tail)) return true;
    if (snapshot.path.length > 1) {
      const head = snapshot.path[0] || null;
      if (head && pointsMatch(cursor, head)) return true;
    }
    return false;
  };

  const resolveBoardSelectionKindForDisplay = (snapshot, cursor) => {
    if (typeof boardNav.selectionKind === 'string') return boardNav.selectionKind;
    if (
      boardNav.transientSelectionVisible
      && cloneCursor(cursor)
      && !isBoardCursorInteractive(snapshot, cursor)
    ) {
      return BOARD_SELECTION_KINDS.PATH_END;
    }
    return null;
  };

  const resolveSelectedPathEndpoint = (snapshot, selectionKind) => {
    if (!snapshot || !Array.isArray(snapshot.path) || snapshot.path.length === 0) return null;
    if (selectionKind === BOARD_SELECTION_KINDS.PATH_START && snapshot.path.length > 1) {
      return snapshot.path[0];
    }
    return snapshot.path[snapshot.path.length - 1];
  };

  const createBoardNavSyncState = (levelChanged) => ({
    selectionKind: levelChanged ? null : boardNav.selectionKind,
    selectionCursor: levelChanged ? null : cloneCursor(boardNav.selectionCursor),
    cursor: levelChanged ? null : cloneCursor(boardNav.cursor),
  });

  const clearSyncedBoardNavSelection = (state) => {
    state.selectionKind = null;
    state.selectionCursor = null;
    keyboardWallPreviewVisible = false;
  };

  const syncWallBoardNavSelection = (snapshot, state) => {
    if (
      !isPointInBounds(snapshot, state.selectionCursor)
      || snapshot.gridData?.[state.selectionCursor.r]?.[state.selectionCursor.c] !== CELL_TYPES.MOVABLE_WALL
    ) {
      clearSyncedBoardNavSelection(state);
      return;
    }
    if (!isPointInBounds(snapshot, state.cursor)) {
      state.cursor = cloneCursor(state.selectionCursor);
    }
  };

  const syncPathBoardNavSelection = (snapshot, state) => {
    keyboardWallPreviewVisible = false;
    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      state.selectionKind = null;
      state.selectionCursor = null;
      return;
    }
    if (snapshot.path.length <= 1) {
      state.selectionKind = BOARD_SELECTION_KINDS.PATH_END;
    }
    const endpoint = resolveSelectedPathEndpoint(snapshot, state.selectionKind);
    if (!endpoint) return;
    state.cursor = { r: endpoint.r, c: endpoint.c };
    state.selectionCursor = { r: endpoint.r, c: endpoint.c };
  };

  const syncBoardNavSnapshot = (snapshot = readSnapshot()) => {
    if (!keyboardGamepadControlsEnabled) return;
    if (!snapshot || snapshot.rows <= 0 || snapshot.cols <= 0) {
      clearBoardNavState();
      return;
    }

    const levelIndex = Number.isInteger(snapshot.levelIndex) ? snapshot.levelIndex : null;
    const levelChanged = levelIndex !== lastBoardNavLevelIndex;
    const nextState = createBoardNavSyncState(levelChanged);
    if (levelChanged) keyboardWallPreviewVisible = false;

    if (nextState.selectionKind === BOARD_SELECTION_KINDS.WALL) {
      syncWallBoardNavSelection(snapshot, nextState);
    } else if (isPathEndpointSelectionKind(nextState.selectionKind)) {
      syncPathBoardNavSelection(snapshot, nextState);
    } else {
      nextState.selectionCursor = null;
      keyboardWallPreviewVisible = false;
    }

    if (!nextState.cursor || !isPointInBounds(snapshot, nextState.cursor)) {
      nextState.cursor = resolveBoardOriginCursor(snapshot);
    }

    lastBoardNavLevelIndex = levelIndex;
    commitBoardNavState({
      cursor: nextState.cursor,
      selectionCursor: nextState.selectionCursor,
      selectionKind: nextState.selectionKind,
      navActive: Boolean(nextState.cursor),
    });
  };

  const currentBoardCursor = (snapshot = readSnapshot()) => {
    if (!snapshot) return null;
    const cursor = cloneCursor(boardNav.cursor);
    if (cursor && isPointInBounds(snapshot, cursor)) return cursor;
    return resolveBoardOriginCursor(snapshot);
  };

  const runGameCommand = (commandType, payload = {}) => {
    const beforeSnapshot = readSnapshot();
    sendGameCommand(commandType, payload);
    const afterSnapshot = readSnapshot();
    return {
      beforeSnapshot,
      afterSnapshot,
      changed: afterSnapshot?.version !== beforeSnapshot?.version,
    };
  };

  const runUiAction = (actionType, payload = {}) => {
    sendUiAction(actionType, payload);
    return readSnapshot();
  };

  const suspendBoardNavForPointerInteraction = () => {
    if (!keyboardGamepadControlsEnabled) return;
    boardNav.transientSelectionVisible = false;
    clearKeyboardWallPreviewState();
    commitBoardNavState({
      cursor: boardNav.cursor,
      selectionCursor: null,
      selectionKind: null,
      navActive: false,
    });
  };

  const createPathDragSimulation = (snapshot) => {
    if (!snapshot) return null;
    return {
      rows: snapshot.rows,
      cols: snapshot.cols,
      gridData: snapshot.gridData,
      stitchSet: snapshot.stitchSet,
      path: Array.isArray(snapshot.path) ? snapshot.path.slice() : [],
      visited: new Set(snapshot.visited || []),
    };
  };

  const removeVisitedSimulationPoint = (visited, point) => {
    if (!point) return;
    visited.delete(`${point.r},${point.c}`);
  };

  const applyPathStepToSimulationStart = (path, visited, nextStep, nextKey) => {
    const backtrackNode = path[1];
    if (pointsMatch(backtrackNode, nextStep)) {
      const removedHead = path[0];
      path.shift();
      removeVisitedSimulationPoint(visited, removedHead);
      return;
    }
    path.unshift({ r: nextStep.r, c: nextStep.c });
    visited.add(nextKey);
  };

  const applyPathStepToSimulationEnd = (path, visited, nextStep, nextKey) => {
    const backtrackNode = path[path.length - 2];
    if (pointsMatch(backtrackNode, nextStep)) {
      const removedTail = path[path.length - 1];
      path.pop();
      removeVisitedSimulationPoint(visited, removedTail);
      return;
    }
    path.push({ r: nextStep.r, c: nextStep.c });
    visited.add(nextKey);
  };

  const applyPathStepToSimulation = (snapshot, side, nextStep) => {
    if (!snapshot || !nextStep) return;
    const nextKey = `${nextStep.r},${nextStep.c}`;
    const nextVisited = snapshot.visited;
    const nextPath = snapshot.path;

    if (nextPath.length === 0) {
      nextPath.push({ r: nextStep.r, c: nextStep.c });
      nextVisited.add(nextKey);
      return;
    }
    if (side === 'start') {
      applyPathStepToSimulationStart(nextPath, nextVisited, nextStep, nextKey);
      return;
    }
    applyPathStepToSimulationEnd(nextPath, nextVisited, nextStep, nextKey);
  };

  const snapCellFromMetrics = (x, y, resolved) => {
    if (!resolved) return null;
    const localX = x - resolved.left - resolved.pad - (resolved.size * 0.5);
    const localY = y - resolved.top - resolved.pad - (resolved.size * 0.5);
    const c = clampToRange(Math.round(localX / resolved.step), 0, resolved.cols - 1);
    const r = clampToRange(Math.round(localY / resolved.step), 0, resolved.rows - 1);
    return { r, c };
  };

  const cellFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = el.closest('.cell');
    if (!cell) return null;
    return {
      r: Number.parseInt(cell.dataset.r, 10),
      c: Number.parseInt(cell.dataset.c, 10),
    };
  };

  const snapWallCellFromPoint = (x, y, snapshot, metrics = null) => {
    const resolved = metrics || captureGridMetrics(snapshot);
    if (!resolved) return null;

    const margin = Math.max(6, resolved.step * 0.5);
    if (
      x < resolved.left - margin
      || x > resolved.right + margin
      || y < resolved.top - margin
      || y > resolved.bottom + margin
    ) {
      return null;
    }
    return snapCellFromMetrics(x, y, resolved);
  };

  const snapPathCellFromPoint = (x, y, snapshot, metrics = null) => {
    const resolved = metrics || captureGridMetrics(snapshot);
    if (!resolved) return null;
    return snapCellFromMetrics(x, y, resolved);
  };

  const pathCellFromPoint = (x, y, snapshot, metrics = null) => {
    const resolved = metrics || readCachedGridMetrics(snapshot);
    if (resolved) {
      if (
        x < resolved.left
        || x > resolved.right
        || y < resolved.top
        || y > resolved.bottom
      ) {
        return null;
      }
      return snapCellFromMetrics(x, y, resolved);
    }
    return cellFromPoint(x, y);
  };

  const wallCellFromPoint = (x, y, snapshot, metrics = null) => {
    if (metrics) {
      const snapped = snapWallCellFromPoint(x, y, snapshot, metrics);
      if (snapped) return snapped;
    }
    const direct = cellFromPoint(x, y);
    if (direct) return direct;
    return snapWallCellFromPoint(x, y, snapshot, metrics);
  };

  const boardCursorOrDefault = (snapshot = readSnapshot()) => {
    const cursor = currentBoardCursor(snapshot);
    if (!cursor || !snapshot) return null;
    if (!boardNav.navActive || !boardNav.cursor) {
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: true,
      });
    }
    return cursor;
  };

  const normalizeDirectionDelta = (directionOrDelta) => {
    if (typeof directionOrDelta === 'string') {
      return DIRECTION_DELTAS[directionOrDelta] || null;
    }
    if (
      Number.isInteger(directionOrDelta?.r)
      && Number.isInteger(directionOrDelta?.c)
      && Math.abs(directionOrDelta.r) <= 1
      && Math.abs(directionOrDelta.c) <= 1
      && (directionOrDelta.r !== 0 || directionOrDelta.c !== 0)
    ) {
      return { r: directionOrDelta.r, c: directionOrDelta.c };
    }
    return null;
  };

  const moveFreeBoardCursor = (directionOrDelta, snapshot = readSnapshot()) => {
    const delta = normalizeDirectionDelta(directionOrDelta);
    const cursor = boardCursorOrDefault(snapshot);
    if (!delta || !snapshot || !cursor) return false;
    pendingKeyboardDiagonalReplacement = null;
    const nextCursor = {
      r: clampToRange(cursor.r + delta.r, 0, snapshot.rows - 1),
      c: clampToRange(cursor.c + delta.c, 0, snapshot.cols - 1),
    };
    return commitBoardNavState({
      cursor: nextCursor,
      selectionKind: null,
      navActive: true,
    });
  };

  const isOrthogonalDelta = (delta) => (
    Math.abs(delta?.r ?? 0) + Math.abs(delta?.c ?? 0) === 1
  );

  const commitBoardNavSelection = (cursor, selectionKind, selectionCursor = cursor) => commitBoardNavState({
    cursor,
    selectionCursor,
    selectionKind,
    navActive: true,
  });

  const clearBoardNavSelection = (cursor, snapshot = readSnapshot()) => {
    clearKeyboardWallPreviewState(snapshot);
    return commitBoardNavState({
      cursor,
      selectionKind: null,
      navActive: true,
    });
  };

  const finalizeBoardPathSelection = (cursor) => {
    const { afterSnapshot } = runGameCommand(GAME_COMMANDS.FINALIZE_PATH);
    clearBoardNavSelection(cursor, afterSnapshot);
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const tryMoveKeyboardWallSelection = (snapshot, cursor) => {
    const anchor = cloneCursor(boardNav.selectionCursor) || cursor;
    if (!anchor || !canDropWall(snapshot, anchor, cursor)) return false;
    const target = { r: cursor.r, c: cursor.c };
    const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.WALL_MOVE_ATTEMPT, {
      from: anchor,
      to: target,
    });
    if (!changed) return false;
    clearKeyboardWallPreviewState(afterSnapshot);
    commitBoardNavSelection(target, BOARD_SELECTION_KINDS.WALL, target);
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const startBoardPathFromCursor = (snapshot, cursor) => {
    if (!isUsableCell(snapshot, cursor.r, cursor.c)) return false;
    const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.START_OR_STEP, cursor);
    if (!changed) {
      syncBoardNavSnapshot(afterSnapshot);
      return false;
    }
    const endpoint = afterSnapshot?.path?.[afterSnapshot.path.length - 1] || cursor;
    commitBoardNavSelection(endpoint, BOARD_SELECTION_KINDS.PATH_END);
    return true;
  };

  const selectBoardPathEndpointAtCursor = (snapshot, cursor) => {
    const head = snapshot.path[0] || null;
    const tail = snapshot.path[snapshot.path.length - 1] || null;
    if (tail && pointsMatch(cursor, tail)) {
      return commitBoardNavSelection(cursor, BOARD_SELECTION_KINDS.PATH_END);
    }
    if (snapshot.path.length > 1 && head && pointsMatch(cursor, head)) {
      return commitBoardNavSelection(cursor, BOARD_SELECTION_KINDS.PATH_START);
    }
    return false;
  };

  const handleUnselectedBoardConfirm = (snapshot, cursor) => {
    const cellType = snapshot.gridData?.[cursor.r]?.[cursor.c];
    if (cellType === CELL_TYPES.MOVABLE_WALL) {
      setKeyboardWallPreviewVisible(true, snapshot);
      return commitBoardNavSelection(cursor, BOARD_SELECTION_KINDS.WALL);
    }
    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      return startBoardPathFromCursor(snapshot, cursor);
    }
    return selectBoardPathEndpointAtCursor(snapshot, cursor);
  };

  const handleBoardConfirmAction = () => {
    if (!keyboardGamepadControlsEnabled) return false;
    pendingKeyboardDiagonalReplacement = null;
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    if (!snapshot || !cursor) return false;

    const selectionKind = boardNav.selectionKind;
    if (isPathEndpointSelectionKind(selectionKind)) {
      return finalizeBoardPathSelection(cursor);
    }
    if (selectionKind === BOARD_SELECTION_KINDS.WALL) {
      if (tryMoveKeyboardWallSelection(snapshot, cursor)) return true;
      return clearBoardNavSelection(cursor, snapshot);
    }
    if (selectionKind) {
      return clearBoardNavSelection(cursor, snapshot);
    }
    return handleUnselectedBoardConfirm(snapshot, cursor);
  };

  const moveKeyboardWallSelection = (snapshot, cursor, delta) => {
    pendingKeyboardDiagonalReplacement = null;
    if (!isOrthogonalDelta(delta)) return false;
    const target = {
      r: cursor.r + delta.r,
      c: cursor.c + delta.c,
    };
    if (!isPointInBounds(snapshot, target)) return false;
    keyboardWallPreviewVisible = true;
    commitBoardNavState({
      cursor: target,
      selectionKind: BOARD_SELECTION_KINDS.WALL,
      navActive: true,
    });
    return true;
  };

  const tryApplyPendingKeyboardPathReplacement = (snapshot, selectionKind, delta) => {
    if (!canUsePendingKeyboardDiagonalReplacement(snapshot, selectionKind, delta)) return false;
    const replaceSourceTip = pendingKeyboardDiagonalReplacement?.sourceTip;
    const replacementTarget = {
      r: replaceSourceTip.r + delta.r,
      c: replaceSourceTip.c + delta.c,
    };
    pendingKeyboardDiagonalReplacement = null;
    const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE, {
      side: resolvePathSelectionSide(selectionKind),
      steps: [
        { r: replaceSourceTip.r, c: replaceSourceTip.c },
        replacementTarget,
      ],
    });
    if (!changed) return false;
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const rememberPendingKeyboardPathReplacement = (selectionKind, delta, source, afterSnapshot) => {
    if (!isOrthogonalDelta(delta)) {
      pendingKeyboardDiagonalReplacement = null;
      return;
    }
    pendingKeyboardDiagonalReplacement = {
      side: resolvePathSelectionSide(selectionKind),
      delta,
      sourceTip: { r: source.r, c: source.c },
      afterVersion: afterSnapshot?.version ?? null,
    };
  };

  const handleSelectedPathDirectionalAction = (snapshot, delta) => {
    const selectionKind = boardNav.selectionKind;
    const source = resolveSelectedPathEndpoint(snapshot, selectionKind);
    if (!source) {
      pendingKeyboardDiagonalReplacement = null;
      syncBoardNavSnapshot(snapshot);
      return false;
    }
    if (tryApplyPendingKeyboardPathReplacement(snapshot, selectionKind, delta)) {
      return true;
    }
    const target = {
      r: source.r + delta.r,
      c: source.c + delta.c,
    };
    if (!isPointInBounds(snapshot, target)) return false;
    const commandType = selectionKind === BOARD_SELECTION_KINDS.PATH_START
      ? GAME_COMMANDS.START_OR_STEP_FROM_START
      : GAME_COMMANDS.START_OR_STEP;
    const { afterSnapshot, changed } = runGameCommand(commandType, target);
    if (!changed) return false;
    rememberPendingKeyboardPathReplacement(selectionKind, delta, source, afterSnapshot);
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const handleBoardDirectionalAction = (directionOrDelta) => {
    if (!keyboardGamepadControlsEnabled) return false;
    const delta = normalizeDirectionDelta(directionOrDelta);
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    if (!delta || !snapshot || !cursor) return false;

    if (!boardNav.selectionKind) {
      return moveFreeBoardCursor(delta, snapshot);
    }
    if (boardNav.selectionKind === BOARD_SELECTION_KINDS.WALL) {
      return moveKeyboardWallSelection(snapshot, cursor, delta);
    }
    return handleSelectedPathDirectionalAction(snapshot, delta);
  };

  const handleBoardShortcutAction = (shortcut) => {
    if (!keyboardGamepadControlsEnabled) return false;
    pendingKeyboardDiagonalReplacement = null;
    const snapshot = readSnapshot();
    const cursor = currentBoardCursor(snapshot);

    if (shortcut === 'confirm') {
      return handleBoardConfirmAction();
    }

    if (shortcut === 'reset') {
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.RESET_CLICK));
      return true;
    }

    if (shortcut === 'reverse') {
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.REVERSE_CLICK));
      return true;
    }

    if (shortcut === 'nextLevel') {
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.NEXT_LEVEL_CLICK));
      return true;
    }

    if (shortcut === 'prevLevel') {
      if (!snapshot || !Number.isInteger(snapshot.levelIndex) || snapshot.levelIndex <= 0) return false;
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.LEVEL_SELECT, {
        value: snapshot.levelIndex - 1,
      }));
      return true;
    }

    return false;
  };

  const resolvePressedKeyboardDirection = () => {
    let vertical = 0;
    if (keyboardDirectionsPressed.up !== keyboardDirectionsPressed.down) {
      vertical = keyboardDirectionsPressed.up ? -1 : 1;
    }
    let horizontal = 0;
    if (keyboardDirectionsPressed.left !== keyboardDirectionsPressed.right) {
      horizontal = keyboardDirectionsPressed.left ? -1 : 1;
    }
    if (vertical === 0 && horizontal === 0) return null;
    return { r: vertical, c: horizontal };
  };

  const resolvePressedKeyboardDirectionComponents = () => {
    const components = [];
    if (keyboardDirectionsPressed.up !== keyboardDirectionsPressed.down) {
      const key = keyboardDirectionsPressed.up ? 'up' : 'down';
      components.push({
        key,
        order: keyboardDirectionPressOrder[key],
        delta: DIRECTION_DELTAS[key],
      });
    }
    if (keyboardDirectionsPressed.left !== keyboardDirectionsPressed.right) {
      const key = keyboardDirectionsPressed.left ? 'left' : 'right';
      components.push({
        key,
        order: keyboardDirectionPressOrder[key],
        delta: DIRECTION_DELTAS[key],
      });
    }
    components.sort((left, right) => left.order - right.order);
    return components;
  };

  const parseDirectionKeyDelta = (directionKey) => {
    if (typeof directionKey !== 'string') return null;
    const [rawR, rawC] = directionKey.split(',');
    const r = Number.parseInt(rawR, 10);
    const c = Number.parseInt(rawC, 10);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { r, c };
  };

  const canUsePendingKeyboardDiagonalReplacement = (snapshot, selectionKind, delta) => {
    if (!(Math.abs(delta?.r) === 1 && Math.abs(delta?.c) === 1)) return false;
    const replaceSide = selectionKind === BOARD_SELECTION_KINDS.PATH_START ? 'start' : 'end';
    const replaceDelta = pendingKeyboardDiagonalReplacement?.delta;
    const replaceSourceTip = pendingKeyboardDiagonalReplacement?.sourceTip;
    if (
      pendingKeyboardDiagonalReplacement?.side !== replaceSide
      || pendingKeyboardDiagonalReplacement.afterVersion !== snapshot?.version
      || !Number.isInteger(replaceSourceTip?.r)
      || !Number.isInteger(replaceSourceTip?.c)
      || (
        (replaceDelta?.r !== delta.r || replaceDelta?.c !== 0)
        && (replaceDelta?.r !== 0 || replaceDelta?.c !== delta.c)
      )
    ) {
      return false;
    }

    const replacementTarget = {
      r: replaceSourceTip.r + delta.r,
      c: replaceSourceTip.c + delta.c,
    };
    return (
      isPointInBounds(snapshot, replacementTarget)
      && isUsableCell(snapshot, replacementTarget.r, replacementTarget.c)
      && isAdjacentMove(snapshot, replaceSourceTip, replacementTarget)
    );
  };

  const canUseDirectKeyboardPathDiagonal = (snapshot, selectionKind, delta) => {
    if (!(Math.abs(delta?.r) === 1 && Math.abs(delta?.c) === 1)) return false;
    const source = resolveSelectedPathEndpoint(snapshot, selectionKind);
    if (!source) return false;
    const target = {
      r: source.r + delta.r,
      c: source.c + delta.c,
    };
    return (
      isPointInBounds(snapshot, target)
      && isUsableCell(snapshot, target.r, target.c)
      && isAdjacentMove(snapshot, source, target)
    );
  };

  const shouldSplitSelectedPathDiagonalChord = (snapshot, delta, components) => {
    if (components.length !== 2) return false;
    if (!(Math.abs(delta?.r) === 1 && Math.abs(delta?.c) === 1)) return false;
    if (
      boardNav.selectionKind !== BOARD_SELECTION_KINDS.PATH_START
      && boardNav.selectionKind !== BOARD_SELECTION_KINDS.PATH_END
    ) {
      return false;
    }
    return !(
      canUsePendingKeyboardDiagonalReplacement(snapshot, boardNav.selectionKind, delta)
      || canUseDirectKeyboardPathDiagonal(snapshot, boardNav.selectionKind, delta)
    );
  };

  const handleBoardDirectionalChord = (components = [], consumedDelta = null) => {
    let changed = false;
    for (const element of components) {
      if (
        Number.isInteger(consumedDelta?.r)
        && Number.isInteger(consumedDelta?.c)
        && element?.delta?.r === consumedDelta.r
        && element?.delta?.c === consumedDelta.c
      ) {
        continue;
      }
      const didChange = handleBoardDirectionalAction(element?.delta);
      changed = didChange || changed;
    }
    return changed;
  };

  const resetKeyboardDirectionState = () => {
    keyboardDirectionState.directionKey = null;
    keyboardDirectionState.nextActionAtMs = 0;
    keyboardDirectionState.hasDispatched = false;
  };

  const armHeldKeyboardDirectionForRepeat = (direction, timestamp = nowMs()) => {
    const normalized = normalizeDirectionDelta(direction);
    if (!normalized) {
      resetKeyboardDirectionState();
      return;
    }
    keyboardDirectionState.directionKey = `${normalized.r},${normalized.c}`;
    keyboardDirectionState.hasDispatched = true;
    keyboardDirectionState.nextActionAtMs = timestamp + KEYBOARD_DIRECTION_INITIAL_DELAY_MS;
  };

  const resolveConfirmKeyId = (key) => {
    if (key === 'Enter') return 'enter';
    if (key === ' ' || key === 'Spacebar') return 'space';
    return null;
  };

  const clearKeyboardConfirmPressed = () => {
    keyboardConfirmKeysPressed.enter = false;
    keyboardConfirmKeysPressed.space = false;
    setTransientBoardSelectionVisible(false);
  };

  const stopKeyboardDirectionPolling = () => {
    if (keyboardDirectionFrame && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(keyboardDirectionFrame);
    }
    keyboardDirectionFrame = 0;
    resetKeyboardDirectionState();
  };

  const clearKeyboardDirectionPressed = () => {
    keyboardDirectionsPressed.up = false;
    keyboardDirectionsPressed.down = false;
    keyboardDirectionsPressed.left = false;
    keyboardDirectionsPressed.right = false;
    keyboardDirectionPressOrder.up = 0;
    keyboardDirectionPressOrder.down = 0;
    keyboardDirectionPressOrder.left = 0;
    keyboardDirectionPressOrder.right = 0;
    pendingKeyboardDiagonalReplacement = null;
    stopKeyboardDirectionPolling();
    clearBoardNavInvalidMovePreview();
  };

  const scheduleKeyboardDirectionPolling = () => {
    if (
      !keyboardGamepadControlsEnabled
      || boardControlSuppressed
      || keyboardDirectionFrame
      || typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    keyboardDirectionFrame = requestAnimationFrame((timestamp) => {
      pollKeyboardDirectionFrame(timestamp);
    });
  };

  const resetKeyboardDirectionFrameState = () => {
    resetKeyboardDirectionState();
    clearBoardNavInvalidMovePreview();
    refreshBoardNavVisibility();
  };

  const syncHeldKeyboardDirectionState = (directionKey, previousDirectionKey, timestamp) => {
    if (directionKey === previousDirectionKey) return;
    const cameFromIdle = previousDirectionKey === null;
    keyboardDirectionState.directionKey = directionKey;
    keyboardDirectionState.hasDispatched = false;
    keyboardDirectionState.nextActionAtMs = cameFromIdle
      ? (timestamp + KEYBOARD_DIRECTION_CHORD_DELAY_MS)
      : timestamp;
  };

  const resolveHeldKeyboardDirectionAction = (
    snapshot,
    direction,
    directionComponents,
    consumedSplitAxisDelta,
  ) => {
    const shouldHandleChord = (
      shouldSplitSelectedPathDiagonalChord(snapshot, direction, directionComponents)
      || (
        !boardNav.selectionKind
        && consumedSplitAxisDelta
        && directionComponents.length === 2
      )
    );
    if (shouldHandleChord) {
      return handleBoardDirectionalChord(directionComponents, consumedSplitAxisDelta);
    }
    return handleBoardDirectionalAction(direction);
  };

  const resolveKeyboardDirectionRepeatDelay = (directionKey, previousDirectionKey) => (
    previousDirectionKey !== null && directionKey === previousDirectionKey
      ? KEYBOARD_DIRECTION_REPEAT_MS
      : KEYBOARD_DIRECTION_INITIAL_DELAY_MS
  );

  const dispatchHeldKeyboardDirection = (
    timestamp,
    direction,
    directionComponents,
    directionKey,
    previousDirectionKey,
    previousDirectionHadDispatched,
  ) => {
    if (timestamp < keyboardDirectionState.nextActionAtMs) return;
    const previouslyConsumedDelta = parseDirectionKeyDelta(previousDirectionKey);
    const consumedSplitAxisDelta = (
      directionKey !== previousDirectionKey
      && previousDirectionHadDispatched === true
      && isOrthogonalDelta(previouslyConsumedDelta)
    )
      ? previouslyConsumedDelta
      : null;
    const snapshot = readSnapshot();
    const handled = resolveHeldKeyboardDirectionAction(
      snapshot,
      direction,
      directionComponents,
      consumedSplitAxisDelta,
    );
    if (handled) clearBoardNavInvalidMovePreview();
    else setBoardNavInvalidMovePreview(direction);
    keyboardDirectionState.hasDispatched = true;
    keyboardDirectionState.nextActionAtMs = timestamp + resolveKeyboardDirectionRepeatDelay(
      directionKey,
      previousDirectionKey,
    );
  };

  const pollKeyboardDirectionFrame = (timestamp = nowMs()) => {
    keyboardDirectionFrame = 0;
    if (!isGridFocusedForKeyboardBoardInput()) {
      resetKeyboardDirectionFrameState();
      return;
    }

    const direction = resolvePressedKeyboardDirection();
    const directionComponents = resolvePressedKeyboardDirectionComponents();
    if (!direction) {
      resetKeyboardDirectionFrameState();
      return;
    }

    const directionKey = `${direction.r},${direction.c}`;
    const previousDirectionKey = keyboardDirectionState.directionKey;
    const previousDirectionHadDispatched = keyboardDirectionState.hasDispatched;
    syncHeldKeyboardDirectionState(directionKey, previousDirectionKey, timestamp);
    dispatchHeldKeyboardDirection(
      timestamp,
      direction,
      directionComponents,
      directionKey,
      previousDirectionKey,
      previousDirectionHadDispatched,
    );

    refreshBoardNavVisibility();
    scheduleKeyboardDirectionPolling();
  };

  const activeElementBlocksGamepadBoardInput = () => {
    if (refs?.themeSwitchDialog?.open) return true;
    if (typeof document === 'undefined') return false;
    const activeElement = document.activeElement;
    if (
      !activeElement
      || activeElement === refs?.gridEl
      || activeElement === document.body
      || activeElement === document.documentElement
      || eventTargetWithin(activeElement, refs?.gridEl)
    ) {
      return false;
    }
    if (typeof activeElement.closest === 'function' && activeElement.closest('dialog')) return true;
    const tagName = String(activeElement.tagName || '').toUpperCase();
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON' || tagName === 'A') {
      return true;
    }
    if (activeElement.isContentEditable) return true;
    return false;
  };

  const isGamepadButtonPressed = (button) => {
    if (!button) return false;
    if (typeof button === 'object') return button.pressed === true || button.value > 0.5;
    return Boolean(button);
  };

  const resolveGamepadDirection = (gamepad) => {
    if (!gamepad) return null;

    const dpadDirections = [];
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadUp])) dpadDirections.push('up');
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadDown])) dpadDirections.push('down');
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadLeft])) dpadDirections.push('left');
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadRight])) dpadDirections.push('right');
    if (dpadDirections.length === 1) return dpadDirections[0];
    if (dpadDirections.length > 1) return null;

    const axisX = Number(gamepad.axes?.[0]) || 0;
    const axisY = Number(gamepad.axes?.[1]) || 0;
    const absX = Math.abs(axisX);
    const absY = Math.abs(axisY);
    if (absX < GAMEPAD_STICK_DEADZONE && absY < GAMEPAD_STICK_DEADZONE) return null;
    if (absX >= GAMEPAD_STICK_DEADZONE && absY >= GAMEPAD_STICK_DEADZONE) return null;
    if (absX >= GAMEPAD_STICK_DEADZONE) return axisX < 0 ? 'left' : 'right';
    return axisY < 0 ? 'up' : 'down';
  };

  const resetGamepadState = () => {
    gamepadButtonsPressed.confirm = false;
    gamepadButtonsPressed.reverse = false;
    gamepadButtonsPressed.reset = false;
    gamepadButtonsPressed.prevLevel = false;
    gamepadButtonsPressed.nextLevel = false;
    gamepadDirectionState.direction = null;
    gamepadDirectionState.nextRepeatAtMs = 0;
  };

  const stopGamepadPolling = () => {
    if (gamepadPollFrame) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(gamepadPollFrame);
      }
      gamepadPollFrame = 0;
    }
    resetGamepadState();
  };

  const handleGamepadButtonEdge = (gamepad, key, index, handler) => {
    const pressed = isGamepadButtonPressed(gamepad?.buttons?.[index]);
    if (pressed && !gamepadButtonsPressed[key]) {
      handler();
    }
    gamepadButtonsPressed[key] = pressed;
  };

  const pollGamepadFrame = (timestamp = nowMs()) => {
    gamepadPollFrame = 0;
    if (!keyboardGamepadControlsEnabled || boardControlSuppressed) {
      refreshBoardNavVisibility();
      return;
    }

    const gamepad = getConnectedStandardGamepad();
    if (!gamepad || activeElementBlocksGamepadBoardInput()) {
      resetGamepadState();
      refreshBoardNavVisibility();
      scheduleGamepadPolling();
      return;
    }

    const direction = resolveGamepadDirection(gamepad);
    if (direction !== gamepadDirectionState.direction) {
      gamepadDirectionState.direction = direction;
      gamepadDirectionState.nextRepeatAtMs = 0;
      if (direction) {
        handleBoardDirectionalAction(direction);
        gamepadDirectionState.nextRepeatAtMs = timestamp + GAMEPAD_DIRECTION_INITIAL_DELAY_MS;
      }
    } else if (direction && timestamp >= gamepadDirectionState.nextRepeatAtMs) {
      handleBoardDirectionalAction(direction);
      gamepadDirectionState.nextRepeatAtMs = timestamp + GAMEPAD_DIRECTION_REPEAT_MS;
    }

    handleGamepadButtonEdge(gamepad, 'confirm', GAMEPAD_BUTTON_INDEX.confirm, () => {
      handleBoardShortcutAction('confirm');
    });
    handleGamepadButtonEdge(gamepad, 'reverse', GAMEPAD_BUTTON_INDEX.reverse, () => {
      handleBoardShortcutAction('reverse');
    });
    handleGamepadButtonEdge(gamepad, 'reset', GAMEPAD_BUTTON_INDEX.reset, () => {
      handleBoardShortcutAction('reset');
    });
    handleGamepadButtonEdge(gamepad, 'prevLevel', GAMEPAD_BUTTON_INDEX.prevLevel, () => {
      handleBoardShortcutAction('prevLevel');
    });
    handleGamepadButtonEdge(gamepad, 'nextLevel', GAMEPAD_BUTTON_INDEX.nextLevel, () => {
      handleBoardShortcutAction('nextLevel');
    });
    refreshBoardNavVisibility();
    scheduleGamepadPolling();
  };

  const scheduleGamepadPolling = () => {
    if (
      !keyboardGamepadControlsEnabled
      || boardControlSuppressed
      || gamepadPollFrame
      || typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    gamepadPollFrame = requestAnimationFrame((timestamp) => {
      pollGamepadFrame(timestamp);
    });
  };

  const pressKeyboardDirectionKey = (directionKey) => {
    if (!keyboardDirectionsPressed[directionKey]) {
      keyboardDirectionPressOrder[directionKey] = nextKeyboardDirectionPressOrder++;
    }
    keyboardDirectionsPressed[directionKey] = true;
    scheduleKeyboardDirectionPolling();
    refreshBoardNavVisibility();
  };

  const handleGridConfirmKeyDown = (event, confirmKeyId) => {
    keyboardConfirmKeysPressed[confirmKeyId] = true;
    if (event.repeat) return;
    const handled = handleBoardShortcutAction('confirm');
    if (handled) return;
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    setTransientBoardSelectionVisible(Boolean(cursor) && !isBoardCursorInteractive(snapshot, cursor));
  };

  const handleGridShortcutKeyDown = (key, repeat) => {
    if (repeat) return;
    const shortcut = KEYBOARD_SHORTCUT_ACTIONS[key] || null;
    if (!shortcut) return;
    handleBoardShortcutAction(shortcut);
  };

  const onGridKeyDown = (event) => {
    if (!keyboardGamepadControlsEnabled) return;
    if (!refs?.gridEl || event?.altKey || event?.ctrlKey || event?.metaKey) return;
    if (typeof document !== 'undefined' && document.activeElement !== refs.gridEl) return;

    const key = event.key;
    if (!GAMEPLAY_KEYBOARD_KEYS.has(key)) return;
    event.preventDefault?.();
    const directionKey = KEYBOARD_DIRECTION_KEYS[key];
    if (directionKey) {
      pressKeyboardDirectionKey(directionKey);
      return;
    }
    const confirmKeyId = resolveConfirmKeyId(key);
    if (confirmKeyId) {
      handleGridConfirmKeyDown(event, confirmKeyId);
      return;
    }
    handleGridShortcutKeyDown(key, event.repeat);
  };

  const onGridKeyUp = (event) => {
    if (!refs?.gridEl) return;
    const confirmKeyId = resolveConfirmKeyId(event.key);
    if (confirmKeyId) {
      keyboardConfirmKeysPressed[confirmKeyId] = false;
      if (!keyboardConfirmKeysPressed.enter && !keyboardConfirmKeysPressed.space) {
        setTransientBoardSelectionVisible(false);
      }
      refreshBoardNavVisibility();
      return;
    }

    if (event.key === 'ArrowUp') {
      keyboardDirectionsPressed.up = false;
      keyboardDirectionPressOrder.up = 0;
    } else if (event.key === 'ArrowDown') {
      keyboardDirectionsPressed.down = false;
      keyboardDirectionPressOrder.down = 0;
    } else if (event.key === 'ArrowLeft') {
      keyboardDirectionsPressed.left = false;
      keyboardDirectionPressOrder.left = 0;
    } else if (event.key === 'ArrowRight') {
      keyboardDirectionsPressed.right = false;
      keyboardDirectionPressOrder.right = 0;
    }
    else return;

    clearBoardNavInvalidMovePreview();
    const remainingDirection = resolvePressedKeyboardDirection();
    if (remainingDirection) {
      armHeldKeyboardDirectionForRepeat(remainingDirection);
      scheduleKeyboardDirectionPolling();
    } else {
      pendingKeyboardDiagonalReplacement = null;
      stopKeyboardDirectionPolling();
    }
    refreshBoardNavVisibility();
  };

  const onGridFocus = () => {
    refreshBoardNavVisibility();
  };

  const onGridBlur = () => {
    clearKeyboardDirectionPressed();
    clearKeyboardConfirmPressed();
    clearKeyboardWallPreviewState();
    refreshBoardNavVisibility();
    scheduleGamepadPolling();
  };

  const beginPathDrag = ({
    side,
    applyPathCommands,
    metrics,
    pointerId,
    originCell,
  }) => {
    pathDrag = {
      side,
      applyPathCommands,
      moved: false,
      origin: { r: originCell.r, c: originCell.c },
      lastCursorKey: `${originCell.r},${originCell.c}`,
      lastHoverKey: `${originCell.r},${originCell.c}`,
    };
    dragGridMetrics = metrics;
    dragMode = 'path';
    activePointerId = pointerId;
    refs.gridEl.setPointerCapture(pointerId);
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: true,
      pathDragSide: side,
      pathDragCursor: { r: originCell.r, c: originCell.c },
    });
  };

  const onPointerDown = (e) => {
    const snapshot = readSnapshot();
    const metrics = refreshDragGridMetrics(snapshot, true);
    const cell = pathCellFromPoint(e.clientX, e.clientY, snapshot, metrics);
    if (!cell) return;
    refs.gridEl.focus?.();
    suspendBoardNavForPointerInteraction();

    const ch = snapshot.gridData?.[cell.r]?.[cell.c];

    if (ch === CELL_TYPES.MOVABLE_WALL) {
      dragMode = 'wall';
      activePointerId = e.pointerId;
      wallDrag = {
        from: { r: cell.r, c: cell.c },
        hover: null,
      };
      dragGridMetrics = metrics;
      refs.gridEl.setPointerCapture(e.pointerId);
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: e.clientX,
        y: e.clientY,
        isWallDragging: true,
      });
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
      e.preventDefault();
      return;
    }

    if (!isUsableCell(snapshot, cell.r, cell.c)) return;

    if (snapshot.path.length === 0) {
      sendGameCommand(GAME_COMMANDS.START_OR_STEP, { r: cell.r, c: cell.c });
      const nextSnapshot = readSnapshot();
      if (nextSnapshot.path.length === 0) return;

      beginPathDrag({
        side: 'end',
        applyPathCommands: true,
        metrics: refreshDragGridMetrics(nextSnapshot, true),
        pointerId: e.pointerId,
        originCell: cell,
      });
      e.preventDefault();
      return;
    }

    const tail = snapshot.path[snapshot.path.length - 1];
    const head = snapshot.path[0];
    const isTail = tail.r === cell.r && tail.c === cell.c;
    const isHead = head.r === cell.r && head.c === cell.c;
    if (!isTail && !isHead) {
      beginPathDrag({
        side: null,
        applyPathCommands: false,
        metrics,
        pointerId: e.pointerId,
        originCell: cell,
      });
      e.preventDefault();
      return;
    }

    beginPathDrag({
      side: isHead ? 'start' : 'end',
      applyPathCommands: true,
      metrics,
      pointerId: e.pointerId,
      originCell: cell,
    });
    e.preventDefault();
  };

  const updatePathDragHover = (snapshot, pointerClientX, pointerClientY) => {
    if (!pathDrag) return;
    const hoverMetrics = refreshDragGridMetrics(snapshot, true);
    const hoverCell = snapPathCellFromPoint(pointerClientX, pointerClientY, snapshot, hoverMetrics);
    const hoverKey = hoverCell ? `${hoverCell.r},${hoverCell.c}` : '';
    if (pathDrag.lastHoverKey === hoverKey) return;
    pathDrag.lastHoverKey = hoverKey;
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: true,
      pathDragSide: pathDrag.side,
      pathDragCursor: cloneCursor(hoverCell),
    });
  };

  const readPathDragPointerContext = (snapshot, pointerClientX, pointerClientY) => {
    const metrics = refreshDragGridMetrics(snapshot, true);
    const rect = metrics
      ? null
      : refs.gridEl.getBoundingClientRect();
    return {
      px: metrics ? (pointerClientX - metrics.left) : (pointerClientX - rect.left),
      py: metrics ? (pointerClientY - metrics.top) : (pointerClientY - rect.top),
      pointerCell: snapPathCellFromPoint(pointerClientX, pointerClientY, snapshot, metrics),
      cellSize: metrics?.size ?? getCellSize(refs.gridEl),
      cellCenter: metrics
        ? ((r, c) => ({
          x: metrics.pad + (c * metrics.step) + (metrics.size * 0.5),
          y: metrics.pad + (r * metrics.step) + (metrics.size * 0.5),
        }))
        : ((r, c) => cellCenter(r, c, refs.gridEl)),
    };
  };

  const queuePathDragSteps = (snapshot, pointerContext) => {
    const stepSnapshot = createPathDragSimulation(snapshot);
    if (!stepSnapshot) return [];

    let stepCount = 0;
    const maxStepCount = Math.max(1, (stepSnapshot.rows * stepSnapshot.cols) + 1);
    const queuedSteps = [];

    while (stepCount < maxStepCount) {
      const headNode = pathDrag.side === 'start'
        ? stepSnapshot.path[0]
        : stepSnapshot.path[stepSnapshot.path.length - 1];
      const backtrackNode = pathDrag.side === 'start'
        ? stepSnapshot.path[1]
        : stepSnapshot.path[stepSnapshot.path.length - 2];
      if (!headNode) break;

      const nextStep = chooseSlipperyPathDragStep({
        snapshot: stepSnapshot,
        headNode,
        backtrackNode,
        pointer: { x: pointerContext.px, y: pointerContext.py },
        pointerCell: pointerContext.pointerCell,
        isUsableCell,
        isAdjacentMove,
        cellCenter: pointerContext.cellCenter,
        cellSize: pointerContext.cellSize,
      });
      if (!nextStep) break;

      pathDrag.moved = true;
      pathDrag.lastCursorKey = `${nextStep.r},${nextStep.c}`;
      queuedSteps.push({ r: nextStep.r, c: nextStep.c });
      stepCount += 1;
      applyPathStepToSimulation(stepSnapshot, pathDrag.side, nextStep);

      const nextHeadNode = pathDrag.side === 'start'
        ? stepSnapshot.path[0]
        : stepSnapshot.path[stepSnapshot.path.length - 1];
      if (
        !nextHeadNode
        || pointsMatch(nextHeadNode, headNode)
        || pointsMatch(nextHeadNode, pointerContext.pointerCell)
      ) {
        break;
      }
    }

    return queuedSteps;
  };

  const handleSlipperyPathPointerMove = (snapshot, pointerClientX, pointerClientY) => {
    const queuedSteps = queuePathDragSteps(
      snapshot,
      readPathDragPointerContext(snapshot, pointerClientX, pointerClientY),
    );
    if (queuedSteps.length === 0) return;
    sendGameCommand(GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE, {
      side: pathDrag.side === 'start' ? 'start' : 'end',
      steps: queuedSteps,
    });
  };

  const handleSimplePathPointerMove = (pointerClientX, pointerClientY) => {
    const cell = cellFromPoint(pointerClientX, pointerClientY);
    if (!cell) return;

    if (pathDrag && !pathDrag.moved) {
      if (pointsMatch(pathDrag.origin, cell)) return;
      pathDrag.moved = true;
    }

    const cursorKey = `${cell.r},${cell.c}`;
    const cursorChanged = pathDrag ? pathDrag.lastCursorKey !== cursorKey : true;
    if (!cursorChanged) return;

    if (pathDrag?.side === 'start') {
      sendGameCommand(GAME_COMMANDS.START_OR_STEP_FROM_START, { r: cell.r, c: cell.c });
    } else {
      sendGameCommand(GAME_COMMANDS.START_OR_STEP, { r: cell.r, c: cell.c });
    }

    if (pathDrag) pathDrag.lastCursorKey = cursorKey;
  };

  const handlePathPointerMove = (e) => {
    if (e.cancelable) e.preventDefault();
    const pointerClientX = e.clientX;
    const pointerClientY = e.clientY;
    const snapshotForInput = pathDrag ? readSnapshot() : null;

    updatePathDragHover(snapshotForInput, pointerClientX, pointerClientY);
    if (pathDrag && !pathDrag.applyPathCommands) return;
    if (pathDrag && snapshotForInput) {
      handleSlipperyPathPointerMove(snapshotForInput, pointerClientX, pointerClientY);
      return;
    }
    handleSimplePathPointerMove(pointerClientX, pointerClientY);
  };

  const updateWallDragHover = (snapshot, cell) => {
    const previousHover = wallDrag.hover;
    if (!cell) {
      if (!previousHover) return;
      wallDrag.hover = null;
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
      return;
    }

    if (canDropWall(snapshot, wallDrag.from, cell)) {
      if (pointsMatch(previousHover, cell)) return;
      wallDrag.hover = { r: cell.r, c: cell.c };
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: wallDrag.hover });
      return;
    }

    if (!previousHover) return;
    wallDrag.hover = null;
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
  };

  const handleWallPointerMove = (e) => {
    if (e.cancelable) e.preventDefault();
    queueWallDragGhostUpdate(e.clientX, e.clientY);
    const snapshot = readSnapshot();
    const metrics = refreshDragGridMetrics(snapshot, true);
    const cell = wallCellFromPoint(e.clientX, e.clientY, snapshot, metrics);
    updateWallDragHover(snapshot, cell);
  };

  const onPointerMove = (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;

    if (dragMode === 'path') {
      handlePathPointerMove(e);
      return;
    }

    if (dragMode === 'wall') {
      handleWallPointerMove(e);
    }
  };

  const onPointerUp = (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const finalMode = dragMode;
    const shouldFinalizePath = finalMode === 'path' && Boolean(pathDrag?.applyPathCommands);
    const wallMoveFrom = wallDrag?.from || null;
    const wallMoveTo = wallDrag?.hover || null;

    clearQueuedWallDragGhostUpdate();
    dragMode = null;
    activePointerId = null;
    wallDrag = null;
    pathDrag = null;
    dragGridMetrics = null;

    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
      visible: false,
      isWallDragging: false,
    });
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: false,
      pathDragSide: null,
      pathDragCursor: null,
    });

    if (finalMode === 'wall' && wallMoveFrom && wallMoveTo) {
      sendGameCommand(GAME_COMMANDS.WALL_MOVE_ATTEMPT, {
        from: wallMoveFrom,
        to: wallMoveTo,
      });
    }

    if (shouldFinalizePath) {
      sendGameCommand(GAME_COMMANDS.FINALIZE_PATH, {});
    }

    if (keyboardGamepadControlsEnabled) {
      syncBoardNavSnapshot(readSnapshot());
    }

    e.preventDefault();
  };

  return {
    bind({
      refs: nextRefs,
      readSnapshot: nextReadSnapshot,
      readLayoutMetrics: nextReadLayoutMetrics = () => null,
      emitIntent: nextEmitIntent,
    }) {
      refs = nextRefs;
      readSnapshot = nextReadSnapshot;
      readLayoutMetrics = nextReadLayoutMetrics;
      emitIntent = nextEmitIntent;
      syncViewportScroll();

      if (!refs?.gridEl) {
        throw new Error('createDomInputAdapter.bind requires refs.gridEl');
      }

      addListener(refs.boardFocusProxy, 'click', (e) => {
        e.preventDefault?.();
        refs.gridEl.focus?.();
      });

      addListener(refs.gridEl, 'pointerdown', onPointerDown);
      addListener(refs.gridEl, 'pointermove', onPointerMove, { passive: false });
      addListener(refs.gridEl, 'pointerup', onPointerUp, { passive: false });
      addListener(refs.gridEl, 'pointercancel', onPointerUp, { passive: false });
      addListener(window, 'scroll', syncViewportScroll, { passive: true });
      addListener(window?.visualViewport, 'scroll', syncViewportScroll, { passive: true });
      addListener(window?.visualViewport, 'resize', syncViewportScroll, { passive: true });

      addListener(refs.levelSel, 'change', (e) => {
        const value = Number.parseInt(e.target.value, 10);
        if (!Number.isInteger(value)) return;
        sendUiAction(UI_ACTIONS.LEVEL_SELECT, { value });
      });

      addListener(refs.infiniteSel, 'change', (e) => {
        sendUiAction(UI_ACTIONS.INFINITE_SELECT, { value: String(e.target.value || '') });
      });

      addListener(refs.langSel, 'change', (e) => {
        sendUiAction(UI_ACTIONS.LOCALE_CHANGE, { value: e.target.value });
      });

      addListener(refs.themeToggle, 'click', () => {
        sendUiAction(UI_ACTIONS.THEME_TOGGLE);
      });

      addListener(refs.lowPowerToggle, 'change', (e) => {
        sendUiAction(UI_ACTIONS.LOW_POWER_TOGGLE, { enabled: Boolean(e.target?.checked) });
      });

      addListener(refs.keyboardGamepadToggle, 'change', (e) => {
        sendUiAction(UI_ACTIONS.KEYBOARD_GAMEPAD_CONTROLS_TOGGLE, { enabled: Boolean(e.target?.checked) });
      });

      addListener(refs.settingsToggle, 'click', (e) => {
        e.stopPropagation();
        sendUiAction(UI_ACTIONS.SETTINGS_TOGGLE);
      });

      addListener(refs.settingsPanel, 'click', (e) => {
        e.stopPropagation();
      });

      addListener(document, 'pointerdown', (e) => {
        const target = e?.target;
        if (eventTargetWithin(target, refs.settingsToggle) || eventTargetWithin(target, refs.settingsPanel)) {
          return;
        }
        sendUiAction(UI_ACTIONS.SETTINGS_CLOSE);
      });

      addListener(document, 'click', () => {
        sendUiAction(UI_ACTIONS.SETTINGS_CLOSE);
      });

      addListener(document, 'keydown', (e) => {
        if (e.key === 'Escape') {
          sendUiAction(UI_ACTIONS.DOCUMENT_ESCAPE);
        }
      });
      addListener(document, 'focusin', () => {
        refreshBoardNavVisibility();
        scheduleGamepadPolling();
      });

      addListener(refs.gridEl, 'keydown', onGridKeyDown);
      addListener(refs.gridEl, 'keyup', onGridKeyUp);
      addListener(refs.gridEl, 'focus', onGridFocus);
      addListener(refs.gridEl, 'blur', onGridBlur);

      addListener(refs.resetBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.RESET_CLICK);
      });

      addListener(refs.reverseBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.REVERSE_CLICK);
      });

      addListener(refs.nextLevelBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.NEXT_LEVEL_CLICK);
      });

      addListener(refs.prevInfiniteBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.PREV_INFINITE_CLICK);
      });

      addListener(refs.guideToggleBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.PANEL_TOGGLE, { panel: 'guide' });
      });

      addListener(refs.legendToggleBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.PANEL_TOGGLE, { panel: 'legend' });
      });

      addListener(refs.themeSwitchDialog, 'close', () => {
        sendUiAction(UI_ACTIONS.THEME_DIALOG_CLOSE, {
          pendingTheme: refs.themeSwitchDialog?.dataset?.pendingTheme,
          returnValue: refs.themeSwitchDialog?.returnValue,
        });
      });
    },

    setKeyboardGamepadControlsEnabled(enabled) {
      const nextEnabled = Boolean(enabled);
      if (nextEnabled === keyboardGamepadControlsEnabled) return;
      keyboardGamepadControlsEnabled = nextEnabled;
      if (!keyboardGamepadControlsEnabled) {
        clearKeyboardDirectionPressed();
        clearKeyboardConfirmPressed();
        stopGamepadPolling();
        clearBoardNavState();
        return;
      }
      syncBoardNavSnapshot(readSnapshot());
      refreshBoardNavVisibility();
      scheduleGamepadPolling();
    },

    setBoardControlSuppressed(suppressed) {
      const nextSuppressed = Boolean(suppressed);
      if (nextSuppressed === boardControlSuppressed) return;
      boardControlSuppressed = nextSuppressed;
      clearKeyboardDirectionPressed();
      clearKeyboardConfirmPressed();
      clearKeyboardWallPreviewState();
      if (boardControlSuppressed) {
        stopGamepadPolling();
      } else if (keyboardGamepadControlsEnabled) {
        scheduleGamepadPolling();
      }
      refreshBoardNavVisibility();
    },

    syncSnapshot(snapshot = null) {
      if (!keyboardGamepadControlsEnabled) return;
      syncBoardNavSnapshot(snapshot || readSnapshot());
      refreshBoardNavVisibility();
      scheduleGamepadPolling();
    },

    unbind() {
      clearListeners();
      emitIntent = () => { };
      clearQueuedWallDragGhostUpdate();
      clearKeyboardDirectionPressed();
      clearKeyboardConfirmPressed();
      stopGamepadPolling();
      clearBoardNavState();
      dragMode = null;
      activePointerId = null;
      wallDrag = null;
      pathDrag = null;
      dragGridMetrics = null;
      keyboardGamepadControlsEnabled = false;
      boardControlSuppressed = false;
      refs = null;
      readSnapshot = () => null;
      readLayoutMetrics = () => null;
      lastBoardNavPayload = null;
      lastBoardNavLevelIndex = null;
    },
  };
}
