import { CELL_TYPES } from '../config.js';
import { isAdjacentMove } from '../utils.js';
import {
  cellCenter,
  getCellSize,
  getGridGap,
  getGridPadding,
} from '../geometry.js';
import {
  chooseSlipperyPathDragStep,
} from './pointer_intent_resolver.js';
import {
  canDropWall,
  isUsableCell,
} from '../state/snapshot_rules.js';
import {
  INTENT_TYPES,
  GAME_COMMANDS,
  UI_ACTIONS,
  INTERACTION_UPDATES,
} from '../runtime/intents.js';

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
    selectionKind: null,
    navActive: false,
    transientSelectionVisible: false,
    invalidMovePreviewDelta: null,
  };
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
  const keyboardDirectionState = {
    directionKey: null,
    nextActionAtMs: 0,
    hasDispatched: false,
  };
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
    if (!(step > 0)) return null;
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

  const boardNavPayloadsMatch = (left, right) => (
    Boolean(left?.isBoardNavActive) === Boolean(right?.isBoardNavActive)
    && (left?.boardCursor?.r ?? null) === (right?.boardCursor?.r ?? null)
    && (left?.boardCursor?.c ?? null) === (right?.boardCursor?.c ?? null)
    && (left?.boardSelection?.kind ?? null) === (right?.boardSelection?.kind ?? null)
    && (left?.boardSelection?.r ?? null) === (right?.boardSelection?.r ?? null)
    && (left?.boardSelection?.c ?? null) === (right?.boardSelection?.c ?? null)
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

  const emitBoardNavUpdate = () => {
    const snapshot = readSnapshot();
    const cursor = cloneCursor(boardNav.cursor);
    const selection = cloneBoardSelection(
      resolveBoardSelectionKindForDisplay(snapshot, cursor),
      cursor,
    );
    const previewDelta = cloneDirectionDelta(boardNav.invalidMovePreviewDelta);
    const payload = {
      isBoardNavActive: Boolean(boardNav.navActive) && isBoardNavCurrentlyControllable(),
      boardCursor: cursor,
      boardSelection: selection,
      boardSelectionInteractive: selection ? isBoardCursorInteractive(snapshot, selection) : null,
    };
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
    const nextCursor = Object.prototype.hasOwnProperty.call(nextState, 'cursor')
      ? cloneCursor(nextState.cursor)
      : cloneCursor(boardNav.cursor);
    const nextSelectionKind = Object.prototype.hasOwnProperty.call(nextState, 'selectionKind')
      ? (typeof nextState.selectionKind === 'string' ? nextState.selectionKind : null)
      : boardNav.selectionKind;
    const nextNavActive = Object.prototype.hasOwnProperty.call(nextState, 'navActive')
      ? Boolean(nextState.navActive)
      : boardNav.navActive;
    const changed = (
      (boardNav.cursor?.r ?? null) !== (nextCursor?.r ?? null)
      || (boardNav.cursor?.c ?? null) !== (nextCursor?.c ?? null)
      || (boardNav.selectionKind ?? null) !== (nextSelectionKind ?? null)
      || boardNav.navActive !== nextNavActive
    );
    if (!changed) return false;

    boardNav.cursor = nextCursor;
    boardNav.selectionKind = nextSelectionKind;
    boardNav.navActive = nextNavActive;
    boardNav.invalidMovePreviewDelta = null;
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
    boardNav.transientSelectionVisible = false;
    boardNav.invalidMovePreviewDelta = null;
    commitBoardNavState({
      cursor: null,
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

  const findFirstUsableBoardCursor = (snapshot) => {
    if (!snapshot) return null;
    for (let r = 0; r < snapshot.rows; r += 1) {
      for (let c = 0; c < snapshot.cols; c += 1) {
        if (isUsableCell(snapshot, r, c)) {
          return { r, c };
        }
      }
    }
    return null;
  };

  const pointsMatch = (left, right) => (
    Number.isInteger(left?.r)
    && Number.isInteger(left?.c)
    && Number.isInteger(right?.r)
    && Number.isInteger(right?.c)
    && left.r === right.r
    && left.c === right.c
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

  const syncBoardNavSnapshot = (snapshot = readSnapshot()) => {
    if (!keyboardGamepadControlsEnabled) return;
    if (!snapshot || snapshot.rows <= 0 || snapshot.cols <= 0) {
      clearBoardNavState();
      return;
    }

    const levelIndex = Number.isInteger(snapshot.levelIndex) ? snapshot.levelIndex : null;
    const levelChanged = levelIndex !== lastBoardNavLevelIndex;
    let nextSelectionKind = levelChanged ? null : boardNav.selectionKind;
    let nextCursor = levelChanged ? null : cloneCursor(boardNav.cursor);

    if (nextSelectionKind === BOARD_SELECTION_KINDS.WALL) {
      if (!isPointInBounds(snapshot, nextCursor) || snapshot.gridData?.[nextCursor.r]?.[nextCursor.c] !== CELL_TYPES.MOVABLE_WALL) {
        nextSelectionKind = null;
      }
    } else if (
      nextSelectionKind === BOARD_SELECTION_KINDS.PATH_START
      || nextSelectionKind === BOARD_SELECTION_KINDS.PATH_END
    ) {
      if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
        nextSelectionKind = null;
      } else if (snapshot.path.length <= 1) {
        nextSelectionKind = BOARD_SELECTION_KINDS.PATH_END;
      }
      const endpoint = resolveSelectedPathEndpoint(snapshot, nextSelectionKind);
      if (endpoint) {
        nextCursor = { r: endpoint.r, c: endpoint.c };
      }
    }

    if (!nextCursor || !isPointInBounds(snapshot, nextCursor)) {
      nextCursor = findFirstUsableBoardCursor(snapshot);
    }

    lastBoardNavLevelIndex = levelIndex;
    commitBoardNavState({
      cursor: nextCursor,
      selectionKind: nextSelectionKind,
      navActive: Boolean(nextCursor),
    });
  };

  const currentBoardCursor = (snapshot = readSnapshot()) => {
    if (!snapshot) return null;
    const cursor = cloneCursor(boardNav.cursor);
    if (cursor && isPointInBounds(snapshot, cursor)) return cursor;
    return findFirstUsableBoardCursor(snapshot);
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
    commitBoardNavState({
      cursor: boardNav.cursor,
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

  const applyPathStepToSimulation = (snapshot, side, nextStep) => {
    if (!snapshot || !nextStep) return snapshot;
    const nextKey = `${nextStep.r},${nextStep.c}`;
    const nextVisited = snapshot.visited;
    const nextPath = snapshot.path;

    if (nextPath.length === 0) {
      nextPath.push({ r: nextStep.r, c: nextStep.c });
      nextVisited.add(nextKey);
    } else if (side === 'start') {
      const backtrackNode = nextPath[1];
      if (backtrackNode && backtrackNode.r === nextStep.r && backtrackNode.c === nextStep.c) {
        const removedHead = nextPath[0];
        nextPath.shift();
        if (removedHead) nextVisited.delete(`${removedHead.r},${removedHead.c}`);
      } else {
        nextPath.unshift({ r: nextStep.r, c: nextStep.c });
        nextVisited.add(nextKey);
      }
    } else {
      const backtrackNode = nextPath[nextPath.length - 2];
      if (backtrackNode && backtrackNode.r === nextStep.r && backtrackNode.c === nextStep.c) {
        const removedTail = nextPath[nextPath.length - 1];
        nextPath.pop();
        if (removedTail) nextVisited.delete(`${removedTail.r},${removedTail.c}`);
      } else {
        nextPath.push({ r: nextStep.r, c: nextStep.c });
        nextVisited.add(nextKey);
      }
    }

    return snapshot;
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
      r: parseInt(cell.dataset.r, 10),
      c: parseInt(cell.dataset.c, 10),
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

  const pointMatches = (left, right) => (
    Number.isInteger(left?.r)
    && Number.isInteger(left?.c)
    && Number.isInteger(right?.r)
    && Number.isInteger(right?.c)
    && left.r === right.r
    && left.c === right.c
  );

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

  const handleBoardConfirmAction = () => {
    if (!keyboardGamepadControlsEnabled) return false;
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    if (!snapshot || !cursor) return false;

    if (boardNav.selectionKind) {
      if (
        (boardNav.selectionKind === BOARD_SELECTION_KINDS.PATH_START
          || boardNav.selectionKind === BOARD_SELECTION_KINDS.PATH_END)
        && Array.isArray(snapshot.path)
        && snapshot.path.length <= 1
      ) {
        const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.FINALIZE_PATH);
        syncBoardNavSnapshot(afterSnapshot);
        return changed;
      }
      return commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: true,
      });
    }

    const cellType = snapshot.gridData?.[cursor.r]?.[cursor.c];
    if (cellType === CELL_TYPES.MOVABLE_WALL) {
      return commitBoardNavState({
        cursor,
        selectionKind: BOARD_SELECTION_KINDS.WALL,
        navActive: true,
      });
    }

    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      if (!isUsableCell(snapshot, cursor.r, cursor.c)) return false;
      const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.START_OR_STEP, cursor);
      if (!changed) {
        syncBoardNavSnapshot(afterSnapshot);
        return false;
      }
      const endpoint = afterSnapshot?.path?.[afterSnapshot.path.length - 1] || cursor;
      commitBoardNavState({
        cursor: endpoint,
        selectionKind: BOARD_SELECTION_KINDS.PATH_END,
        navActive: true,
      });
      return true;
    }

    const head = snapshot.path[0] || null;
    const tail = snapshot.path[snapshot.path.length - 1] || null;
    if (tail && pointMatches(cursor, tail)) {
      return commitBoardNavState({
        cursor,
        selectionKind: BOARD_SELECTION_KINDS.PATH_END,
        navActive: true,
      });
    }
    if (snapshot.path.length > 1 && head && pointMatches(cursor, head)) {
      return commitBoardNavState({
        cursor,
        selectionKind: BOARD_SELECTION_KINDS.PATH_START,
        navActive: true,
      });
    }

    return false;
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
      if (Math.abs(delta.r) + Math.abs(delta.c) !== 1) return false;
      const target = {
        r: cursor.r + delta.r,
        c: cursor.c + delta.c,
      };
      if (!isPointInBounds(snapshot, target)) return false;
      const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.WALL_MOVE_ATTEMPT, {
        from: cursor,
        to: target,
      });
      if (!changed) return false;
      commitBoardNavState({
        cursor: target,
        selectionKind: BOARD_SELECTION_KINDS.WALL,
        navActive: true,
      });
      syncBoardNavSnapshot(afterSnapshot);
      return true;
    }

    const source = resolveSelectedPathEndpoint(snapshot, boardNav.selectionKind);
    if (!source) {
      syncBoardNavSnapshot(snapshot);
      return false;
    }

    const target = {
      r: source.r + delta.r,
      c: source.c + delta.c,
    };
    if (!isPointInBounds(snapshot, target)) return false;

    const commandType = boardNav.selectionKind === BOARD_SELECTION_KINDS.PATH_START
      ? GAME_COMMANDS.START_OR_STEP_FROM_START
      : GAME_COMMANDS.START_OR_STEP;
    const { afterSnapshot, changed } = runGameCommand(commandType, target);
    if (!changed) return false;
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const handleBoardShortcutAction = (shortcut) => {
    if (!keyboardGamepadControlsEnabled) return false;
    const snapshot = readSnapshot();
    const cursor = currentBoardCursor(snapshot);

    if (shortcut === 'confirm') {
      return handleBoardConfirmAction();
    }

    if (shortcut === 'reset') {
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.RESET_CLICK));
      return true;
    }

    if (shortcut === 'reverse') {
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.REVERSE_CLICK));
      return true;
    }

    if (shortcut === 'nextLevel') {
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
    const vertical = keyboardDirectionsPressed.up === keyboardDirectionsPressed.down
      ? 0
      : (keyboardDirectionsPressed.up ? -1 : 1);
    const horizontal = keyboardDirectionsPressed.left === keyboardDirectionsPressed.right
      ? 0
      : (keyboardDirectionsPressed.left ? -1 : 1);
    if (vertical === 0 && horizontal === 0) return null;
    return { r: vertical, c: horizontal };
  };

  const resetKeyboardDirectionState = () => {
    keyboardDirectionState.directionKey = null;
    keyboardDirectionState.nextActionAtMs = 0;
    keyboardDirectionState.hasDispatched = false;
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

  const pollKeyboardDirectionFrame = (timestamp = nowMs()) => {
    keyboardDirectionFrame = 0;
    if (!isGridFocusedForKeyboardBoardInput()) {
      resetKeyboardDirectionState();
      clearBoardNavInvalidMovePreview();
      refreshBoardNavVisibility();
      return;
    }

    const direction = resolvePressedKeyboardDirection();
    if (!direction) {
      resetKeyboardDirectionState();
      clearBoardNavInvalidMovePreview();
      refreshBoardNavVisibility();
      return;
    }

    const directionKey = `${direction.r},${direction.c}`;
    const previousDirectionKey = keyboardDirectionState.directionKey;
    if (directionKey !== previousDirectionKey) {
      const cameFromIdle = previousDirectionKey === null;
      keyboardDirectionState.directionKey = directionKey;
      keyboardDirectionState.hasDispatched = false;
      keyboardDirectionState.nextActionAtMs = cameFromIdle
        ? (timestamp + KEYBOARD_DIRECTION_CHORD_DELAY_MS)
        : timestamp;
    }

    if (timestamp >= keyboardDirectionState.nextActionAtMs) {
      const handled = handleBoardDirectionalAction(direction);
      if (!handled) setBoardNavInvalidMovePreview(direction);
      else clearBoardNavInvalidMovePreview();
      keyboardDirectionState.hasDispatched = true;
      keyboardDirectionState.nextActionAtMs = timestamp + (
        previousDirectionKey === null
          ? KEYBOARD_DIRECTION_INITIAL_DELAY_MS
          : (
            directionKey !== previousDirectionKey
              ? KEYBOARD_DIRECTION_INITIAL_DELAY_MS
              : KEYBOARD_DIRECTION_REPEAT_MS
          )
      );
    }

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

  const onGridKeyDown = (event) => {
    if (!keyboardGamepadControlsEnabled) return;
    if (!refs?.gridEl || event?.altKey || event?.ctrlKey || event?.metaKey) return;
    if (typeof document !== 'undefined' && document.activeElement !== refs.gridEl) return;

    const key = event.key;
    const isGameplayKey = (
      key === 'ArrowUp'
      || key === 'ArrowDown'
      || key === 'ArrowLeft'
      || key === 'ArrowRight'
      || key === 'Enter'
      || key === ' '
      || key === 'Spacebar'
      || key === 'Backspace'
      || key === 'Delete'
      || key === 'r'
      || key === 'R'
      || key === 'PageUp'
      || key === 'PageDown'
    );
    let handled = false;
    const confirmKeyId = resolveConfirmKeyId(key);

    if (key === 'ArrowUp') {
      keyboardDirectionsPressed.up = true;
      scheduleKeyboardDirectionPolling();
      handled = true;
    } else if (key === 'ArrowDown') {
      keyboardDirectionsPressed.down = true;
      scheduleKeyboardDirectionPolling();
      handled = true;
    } else if (key === 'ArrowLeft') {
      keyboardDirectionsPressed.left = true;
      scheduleKeyboardDirectionPolling();
      handled = true;
    } else if (key === 'ArrowRight') {
      keyboardDirectionsPressed.right = true;
      scheduleKeyboardDirectionPolling();
      handled = true;
    } else if (confirmKeyId) {
      keyboardConfirmKeysPressed[confirmKeyId] = true;
      if (!event.repeat) {
        handled = handleBoardShortcutAction('confirm');
        if (!handled) {
          const snapshot = readSnapshot();
          const cursor = boardCursorOrDefault(snapshot);
          setTransientBoardSelectionVisible(Boolean(cursor) && !isBoardCursorInteractive(snapshot, cursor));
        }
      }
    } else if ((key === 'Backspace' || key === 'Delete') && !event.repeat) handled = handleBoardShortcutAction('reset');
    else if ((key === 'r' || key === 'R') && !event.repeat) handled = handleBoardShortcutAction('reverse');
    else if (key === 'PageUp' && !event.repeat) handled = handleBoardShortcutAction('prevLevel');
    else if (key === 'PageDown' && !event.repeat) handled = handleBoardShortcutAction('nextLevel');

    if (!isGameplayKey) return;
    event.preventDefault?.();
    if (!handled) return;
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

    if (event.key === 'ArrowUp') keyboardDirectionsPressed.up = false;
    else if (event.key === 'ArrowDown') keyboardDirectionsPressed.down = false;
    else if (event.key === 'ArrowLeft') keyboardDirectionsPressed.left = false;
    else if (event.key === 'ArrowRight') keyboardDirectionsPressed.right = false;
    else return;

    clearBoardNavInvalidMovePreview();
    if (resolvePressedKeyboardDirection()) {
      scheduleKeyboardDirectionPolling();
    } else {
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
    refreshBoardNavVisibility();
    scheduleGamepadPolling();
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

      dragMode = 'path';
      pathDrag = {
        side: 'end',
        applyPathCommands: true,
        moved: false,
        origin: { r: cell.r, c: cell.c },
        lastCursorKey: `${cell.r},${cell.c}`,
        lastHoverKey: `${cell.r},${cell.c}`,
      };
      dragGridMetrics = refreshDragGridMetrics(nextSnapshot, true);
      activePointerId = e.pointerId;
      refs.gridEl.setPointerCapture(e.pointerId);
      sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
        isPathDragging: true,
        pathDragSide: pathDrag.side,
        pathDragCursor: { r: cell.r, c: cell.c },
      });
      e.preventDefault();
      return;
    }

    const tail = snapshot.path[snapshot.path.length - 1];
    const head = snapshot.path[0];
    const isTail = tail.r === cell.r && tail.c === cell.c;
    const isHead = head.r === cell.r && head.c === cell.c;
    if (!isTail && !isHead) {
      pathDrag = {
        side: null,
        applyPathCommands: false,
        moved: false,
        origin: { r: cell.r, c: cell.c },
        lastCursorKey: `${cell.r},${cell.c}`,
        lastHoverKey: `${cell.r},${cell.c}`,
      };
      dragGridMetrics = metrics;
      dragMode = 'path';
      activePointerId = e.pointerId;
      refs.gridEl.setPointerCapture(e.pointerId);
      sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
        isPathDragging: true,
        pathDragSide: null,
        pathDragCursor: { r: cell.r, c: cell.c },
      });
      e.preventDefault();
      return;
    }

    pathDrag = {
      side: isHead ? 'start' : 'end',
      applyPathCommands: true,
      moved: false,
      origin: { r: cell.r, c: cell.c },
      lastCursorKey: `${cell.r},${cell.c}`,
      lastHoverKey: `${cell.r},${cell.c}`,
    };
    dragGridMetrics = metrics;

    dragMode = 'path';
    activePointerId = e.pointerId;
    refs.gridEl.setPointerCapture(e.pointerId);
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: true,
      pathDragSide: pathDrag.side,
      pathDragCursor: { r: cell.r, c: cell.c },
    });
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;

    if (dragMode === 'path') {
      if (e.cancelable) e.preventDefault();
      const pointerClientX = e.clientX;
      const pointerClientY = e.clientY;
      const snapshotForInput = pathDrag ? readSnapshot() : null;

      if (pathDrag) {
        const hoverMetrics = refreshDragGridMetrics(snapshotForInput, true);
        const hoverCell = snapPathCellFromPoint(e.clientX, e.clientY, snapshotForInput, hoverMetrics);
        const hoverKey = hoverCell ? `${hoverCell.r},${hoverCell.c}` : '';
        if (pathDrag.lastHoverKey !== hoverKey) {
          pathDrag.lastHoverKey = hoverKey;
          sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
            isPathDragging: true,
            pathDragSide: pathDrag.side,
            pathDragCursor: hoverCell ? { r: hoverCell.r, c: hoverCell.c } : null,
          });
        }
      }

      if (pathDrag && !pathDrag.applyPathCommands) return;

      if (pathDrag && snapshotForInput) {
        const metrics = refreshDragGridMetrics(snapshotForInput, true);
        const rect = metrics
          ? null
          : refs.gridEl.getBoundingClientRect();
        const px = metrics ? (pointerClientX - metrics.left) : (pointerClientX - rect.left);
        const py = metrics ? (pointerClientY - metrics.top) : (pointerClientY - rect.top);
        const activeCellSize = metrics?.size ?? getCellSize(refs.gridEl);
        const centerOfCell = metrics
          ? ((r, c) => ({
            x: metrics.pad + (c * metrics.step) + (metrics.size * 0.5),
            y: metrics.pad + (r * metrics.step) + (metrics.size * 0.5),
          }))
          : ((r, c) => cellCenter(r, c, refs.gridEl));
        const pointerCell = snapPathCellFromPoint(
          pointerClientX,
          pointerClientY,
          snapshotForInput,
          metrics,
        );
        const dragCommandSide = pathDrag.side === 'start' ? 'start' : 'end';

        let stepSnapshot = createPathDragSimulation(snapshotForInput);
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
            pointer: { x: px, y: py },
            pointerCell,
            isUsableCell,
            isAdjacentMove,
            cellCenter: centerOfCell,
            cellSize: activeCellSize,
          });
          if (!nextStep) break;

          pathDrag.moved = true;
          pathDrag.lastCursorKey = `${nextStep.r},${nextStep.c}`;
          queuedSteps.push({ r: nextStep.r, c: nextStep.c });
          stepCount += 1;
          const nextSnapshot = applyPathStepToSimulation(stepSnapshot, pathDrag.side, nextStep);
          const nextHeadNode = pathDrag.side === 'start'
            ? nextSnapshot?.path?.[0]
            : nextSnapshot?.path?.[nextSnapshot?.path?.length - 1];
          if (
            !nextHeadNode
            || (nextHeadNode.r === headNode.r && nextHeadNode.c === headNode.c)
          ) {
            break;
          }

          stepSnapshot = nextSnapshot;
          if (
            pointerCell
            && nextHeadNode.r === pointerCell.r
            && nextHeadNode.c === pointerCell.c
          ) {
            break;
          }
        }

        if (queuedSteps.length > 0) {
          sendGameCommand(GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE, {
            side: dragCommandSide,
            steps: queuedSteps,
          });
        }

        return;
      }

      const cell = cellFromPoint(pointerClientX, pointerClientY);
      if (!cell) return;

      if (pathDrag && !pathDrag.moved) {
        if (pathDrag.origin.r === cell.r && pathDrag.origin.c === cell.c) return;
        pathDrag.moved = true;
      }

      const cursorKey = `${cell.r},${cell.c}`;
      const cursorChanged = pathDrag ? pathDrag.lastCursorKey !== cursorKey : true;
      if (!cursorChanged) return;

      if (pathDrag && pathDrag.side === 'start') {
        sendGameCommand(GAME_COMMANDS.START_OR_STEP_FROM_START, { r: cell.r, c: cell.c });
      } else {
        sendGameCommand(GAME_COMMANDS.START_OR_STEP, { r: cell.r, c: cell.c });
      }

      if (pathDrag) pathDrag.lastCursorKey = cursorKey;
      return;
    }

    if (dragMode === 'wall') {
      if (e.cancelable) e.preventDefault();
      queueWallDragGhostUpdate(e.clientX, e.clientY);

      const snapshot = readSnapshot();
      const metrics = refreshDragGridMetrics(snapshot, true);
      const cell = wallCellFromPoint(e.clientX, e.clientY, snapshot, metrics);
      const previousHover = wallDrag.hover;
      if (!cell) {
        if (previousHover) {
          wallDrag.hover = null;
          sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
        }
        return;
      }

      if (canDropWall(snapshot, wallDrag.from, cell)) {
        const sameHover = previousHover && previousHover.r === cell.r && previousHover.c === cell.c;
        if (!sameHover) {
          wallDrag.hover = { r: cell.r, c: cell.c };
          sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: wallDrag.hover });
        }
      } else {
        if (previousHover) {
          wallDrag.hover = null;
          sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
        }
      }
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

      addListener(refs.gridEl, 'pointerdown', onPointerDown);
      addListener(refs.gridEl, 'pointermove', onPointerMove, { passive: false });
      addListener(refs.gridEl, 'pointerup', onPointerUp, { passive: false });
      addListener(refs.gridEl, 'pointercancel', onPointerUp, { passive: false });
      addListener(window, 'scroll', syncViewportScroll, { passive: true });
      addListener(window?.visualViewport, 'scroll', syncViewportScroll, { passive: true });
      addListener(window?.visualViewport, 'resize', syncViewportScroll, { passive: true });

      addListener(refs.levelSel, 'change', (e) => {
        const value = parseInt(e.target.value, 10);
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
