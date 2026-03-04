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
  predictPathDragPointer,
} from './pointer_intent_resolver.js';
import {
  INTENT_TYPES,
  GAME_COMMANDS,
  UI_ACTIONS,
  INTERACTION_UPDATES,
} from '../runtime/intents.js';

export function createDomInputAdapter() {
  const PATH_PREDICTION_SAMPLE_WINDOW = 8;
  const PATH_PREDICTION_DEFAULT_FRAME_INTERVAL_MS = 16.67;
  const PATH_PREDICTION_MIN_FRAME_INTERVAL_MS = 8;
  const PATH_PREDICTION_MAX_FRAME_INTERVAL_MS = 50;
  const PATH_PREDICTION_FRAME_EMA_ALPHA = 0.2;

  let refs = null;
  let readSnapshot = () => null;
  let emitIntent = () => { };
  let listeners = [];

  let dragMode = null;
  let activePointerId = null;
  let wallDrag = null;
  let pathDrag = null;
  let dragGridMetrics = null;
  let wallDragFrame = 0;
  let wallDragQueuedPoint = null;
  let pathDragFrameTracker = null;

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
    cancelAnimationFrame(wallDragFrame);
    wallDragFrame = 0;
  };

  const startPathDragFrameTracker = () => {
    if (pathDragFrameTracker) return;
    if (typeof requestAnimationFrame !== 'function') return;

    const tracker = {
      frameId: 0,
      lastTs: NaN,
      emaFrameIntervalMs: PATH_PREDICTION_DEFAULT_FRAME_INTERVAL_MS,
    };

    const tick = (ts) => {
      if (!pathDragFrameTracker) return;
      const lastTs = Number(pathDragFrameTracker.lastTs);
      if (Number.isFinite(lastTs)) {
        const rawDt = Number(ts) - lastTs;
        if (Number.isFinite(rawDt) && rawDt > 0) {
          const clampedDt = Math.max(
            PATH_PREDICTION_MIN_FRAME_INTERVAL_MS,
            Math.min(PATH_PREDICTION_MAX_FRAME_INTERVAL_MS, rawDt),
          );
          pathDragFrameTracker.emaFrameIntervalMs = (
            pathDragFrameTracker.emaFrameIntervalMs * (1 - PATH_PREDICTION_FRAME_EMA_ALPHA)
          ) + (clampedDt * PATH_PREDICTION_FRAME_EMA_ALPHA);
        }
      }
      pathDragFrameTracker.lastTs = Number(ts);
      pathDragFrameTracker.frameId = requestAnimationFrame(tick);
    };

    tracker.frameId = requestAnimationFrame(tick);
    pathDragFrameTracker = tracker;
  };

  const stopPathDragFrameTracker = () => {
    if (!pathDragFrameTracker) return;
    if (pathDragFrameTracker.frameId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pathDragFrameTracker.frameId);
    }
    pathDragFrameTracker = null;
  };

  const readPathDragFrameIntervalMs = () => {
    const value = Number(pathDragFrameTracker?.emaFrameIntervalMs);
    if (Number.isFinite(value) && value > 0) {
      return Math.max(
        PATH_PREDICTION_MIN_FRAME_INTERVAL_MS,
        Math.min(PATH_PREDICTION_MAX_FRAME_INTERVAL_MS, value),
      );
    }
    return PATH_PREDICTION_DEFAULT_FRAME_INTERVAL_MS;
  };

  const readPathPredictionStrengthLevel = () => {
    const value = Number.parseInt(refs?.pathPredictionStrengthControl?.dataset?.level || '', 10);
    if (Number.isInteger(value) && value >= 0 && value <= 3) return value;
    return 1;
  };

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

    return {
      rows,
      cols,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      size,
      step,
      pad,
    };
  };

  const clampToRange = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

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

  const wallCellFromPoint = (x, y, snapshot, metrics = null) => {
    const direct = cellFromPoint(x, y);
    if (direct) return direct;
    return snapWallCellFromPoint(x, y, snapshot, metrics);
  };

  const isUsableCell = (snapshot, r, c) => {
    const ch = snapshot.gridData[r]?.[c];
    return ch && ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
  };

  const canDropWall = (snapshot, from, to) => {
    if (!snapshot || !from || !to) return false;
    if (from.r === to.r && from.c === to.c) return false;
    if (from.r < 0 || from.r >= snapshot.rows || from.c < 0 || from.c >= snapshot.cols) return false;
    if (to.r < 0 || to.r >= snapshot.rows || to.c < 0 || to.c >= snapshot.cols) return false;
    if (snapshot.gridData[from.r]?.[from.c] !== CELL_TYPES.MOVABLE_WALL) return false;
    if (snapshot.gridData[to.r]?.[to.c] !== CELL_TYPES.EMPTY) return false;
    if (snapshot.visited.has(`${to.r},${to.c}`)) return false;
    return true;
  };

  const appendPathPredictionSamples = (predictionState, event) => {
    if (!predictionState || !event) return;
    const rawCoalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : null;
    const sourceEvents = (rawCoalesced && rawCoalesced.length > 0)
      ? rawCoalesced
      : [event];

    for (let i = 0; i < sourceEvents.length; i += 1) {
      const sampleEvent = sourceEvents[i];
      const x = Number(sampleEvent?.clientX);
      const y = Number(sampleEvent?.clientY);
      const t = Number(sampleEvent?.timeStamp);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      predictionState.samples.push({
        x,
        y,
        t: Number.isFinite(t) ? t : Number(event.timeStamp) || Date.now(),
      });
    }

    if (predictionState.samples.length > PATH_PREDICTION_SAMPLE_WINDOW) {
      predictionState.samples.splice(0, predictionState.samples.length - PATH_PREDICTION_SAMPLE_WINDOW);
    }
  };

  const onPointerDown = (e) => {
    const snapshot = readSnapshot();
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;

    const ch = snapshot.gridData?.[cell.r]?.[cell.c];

    if (ch === CELL_TYPES.MOVABLE_WALL) {
      dragMode = 'wall';
      activePointerId = e.pointerId;
      wallDrag = {
        from: { r: cell.r, c: cell.c },
        hover: null,
      };
      dragGridMetrics = captureGridMetrics(snapshot);
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
        prediction: {
          samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
          emaErrorPx: 0,
          lastPredictedClient: null,
          frameIntervalMs: PATH_PREDICTION_DEFAULT_FRAME_INTERVAL_MS,
        },
      };
      dragGridMetrics = captureGridMetrics(nextSnapshot);
      activePointerId = e.pointerId;
      refs.gridEl.setPointerCapture(e.pointerId);
      startPathDragFrameTracker();
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
        prediction: {
          samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
          emaErrorPx: 0,
          lastPredictedClient: null,
          frameIntervalMs: PATH_PREDICTION_DEFAULT_FRAME_INTERVAL_MS,
        },
      };
      dragGridMetrics = captureGridMetrics(snapshot);
      dragMode = 'path';
      activePointerId = e.pointerId;
      refs.gridEl.setPointerCapture(e.pointerId);
      startPathDragFrameTracker();
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
      prediction: {
        samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
        emaErrorPx: 0,
        lastPredictedClient: null,
        frameIntervalMs: PATH_PREDICTION_DEFAULT_FRAME_INTERVAL_MS,
      },
    };
    dragGridMetrics = captureGridMetrics(snapshot);

    dragMode = 'path';
    activePointerId = e.pointerId;
    refs.gridEl.setPointerCapture(e.pointerId);
    startPathDragFrameTracker();
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: true,
      pathDragSide: pathDrag.side,
      pathDragCursor: { r: cell.r, c: cell.c },
    });
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;

    if (dragGridMetrics && refs?.gridEl) {
      const rect = refs.gridEl.getBoundingClientRect();
      dragGridMetrics.left = rect.left;
      dragGridMetrics.top = rect.top;
      dragGridMetrics.right = rect.right;
      dragGridMetrics.bottom = rect.bottom;
    }

    if (dragMode === 'path') {
      if (e.cancelable) e.preventDefault();
      const rawPointerClientX = e.clientX;
      const rawPointerClientY = e.clientY;
      let pointerClientX = rawPointerClientX;
      let pointerClientY = rawPointerClientY;
      const snapshotForInput = pathDrag ? readSnapshot() : null;

      if (pathDrag) {
        if (!pathDrag.prediction) {
          pathDrag.prediction = {
            samples: [],
            emaErrorPx: 0,
            lastPredictedClient: null,
          };
        }
        const predictionState = pathDrag.prediction;
        appendPathPredictionSamples(predictionState, e);
        predictionState.frameIntervalMs = readPathDragFrameIntervalMs();

        const predictionStrengthLevel = readPathPredictionStrengthLevel();
        const shouldPredict = predictionStrengthLevel > 0;
        if (shouldPredict) {
          const predicted = predictPathDragPointer({
            samples: predictionState.samples,
            cellSize: dragGridMetrics?.size ?? getCellSize(refs.gridEl),
            prevEmaErrorPx: predictionState.emaErrorPx,
            prevPredictedClient: predictionState.lastPredictedClient,
            frameIntervalMs: predictionState.frameIntervalMs,
            nowMs: Number.isFinite(Number(e.timeStamp)) ? Number(e.timeStamp) : undefined,
            predictionStrengthLevel,
          });
          pointerClientX = predicted.effectiveClient.x;
          pointerClientY = predicted.effectiveClient.y;
          predictionState.emaErrorPx = predicted.nextEmaErrorPx;
          predictionState.lastPredictedClient = predicted.nextPredictedClient;
        } else {
          predictionState.emaErrorPx = 0;
          predictionState.lastPredictedClient = null;
        }

        const hoverMetrics = dragGridMetrics || captureGridMetrics(snapshotForInput);
        if (hoverMetrics) dragGridMetrics = hoverMetrics;
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
        const metrics = dragGridMetrics || captureGridMetrics(snapshotForInput);
        if (metrics) dragGridMetrics = metrics;
        const rect = metrics
          ? null
          : refs.gridEl.getBoundingClientRect();
        const px = metrics ? (pointerClientX - metrics.left) : (pointerClientX - rect.left);
        const py = metrics ? (pointerClientY - metrics.top) : (pointerClientY - rect.top);
        const rawPx = metrics ? (rawPointerClientX - metrics.left) : (rawPointerClientX - rect.left);
        const rawPy = metrics ? (rawPointerClientY - metrics.top) : (rawPointerClientY - rect.top);
        const activeCellSize = metrics?.size ?? getCellSize(refs.gridEl);
        const centerOfCell = metrics
          ? ((r, c) => ({
            x: metrics.pad + (c * metrics.step) + (metrics.size * 0.5),
            y: metrics.pad + (r * metrics.step) + (metrics.size * 0.5),
          }))
          : ((r, c) => cellCenter(r, c, refs.gridEl));
        const pointerCell = snapPathCellFromPoint(
          rawPointerClientX,
          rawPointerClientY,
          snapshotForInput,
          metrics,
        ) || snapPathCellFromPoint(
          pointerClientX,
          pointerClientY,
          snapshotForInput,
          metrics,
        );
        const commandType = pathDrag.side === 'start'
          ? GAME_COMMANDS.START_OR_STEP_FROM_START
          : GAME_COMMANDS.START_OR_STEP;

        let stepSnapshot = snapshotForInput;
        let stepCount = 0;
        const maxStepCount = Math.max(1, (stepSnapshot.rows * stepSnapshot.cols) + 1);

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
            rawPointer: { x: rawPx, y: rawPy },
            pointerCell,
            isUsableCell,
            isAdjacentMove,
            cellCenter: centerOfCell,
            cellSize: activeCellSize,
          });
          if (!nextStep) break;

          pathDrag.moved = true;
          sendGameCommand(commandType, { r: nextStep.r, c: nextStep.c });
          pathDrag.lastCursorKey = `${nextStep.r},${nextStep.c}`;
          stepCount += 1;

          const nextSnapshot = readSnapshot();
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
      const metrics = dragGridMetrics || captureGridMetrics(snapshot);
      if (metrics) dragGridMetrics = metrics;
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
    stopPathDragFrameTracker();
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

    e.preventDefault();
  };

  return {
    bind({ refs: nextRefs, readSnapshot: nextReadSnapshot, emitIntent: nextEmitIntent }) {
      refs = nextRefs;
      readSnapshot = nextReadSnapshot;
      emitIntent = nextEmitIntent;

      if (!refs?.gridEl) {
        throw new Error('createDomInputAdapter.bind requires refs.gridEl');
      }

      addListener(refs.gridEl, 'pointerdown', onPointerDown);
      addListener(refs.gridEl, 'pointermove', onPointerMove, { passive: false });
      addListener(refs.gridEl, 'pointerup', onPointerUp, { passive: false });
      addListener(refs.gridEl, 'pointercancel', onPointerUp, { passive: false });

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

      addListener(refs.settingsToggle, 'click', (e) => {
        e.stopPropagation();
        sendUiAction(UI_ACTIONS.SETTINGS_TOGGLE);
      });

      addListener(refs.settingsPanel, 'click', (e) => {
        e.stopPropagation();
      });

      addListener(document, 'click', () => {
        sendUiAction(UI_ACTIONS.SETTINGS_CLOSE);
      });

      addListener(document, 'keydown', (e) => {
        if (e.key === 'Escape') {
          sendUiAction(UI_ACTIONS.DOCUMENT_ESCAPE);
        }
      });

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

    unbind() {
      clearListeners();
      clearQueuedWallDragGhostUpdate();
      stopPathDragFrameTracker();
      dragMode = null;
      activePointerId = null;
      wallDrag = null;
      pathDrag = null;
      dragGridMetrics = null;
    },
  };
}
