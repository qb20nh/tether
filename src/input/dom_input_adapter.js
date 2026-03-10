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
    cancelAnimationFrame(wallDragFrame);
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

  const onPointerDown = (e) => {
    const snapshot = readSnapshot();
    const metrics = refreshDragGridMetrics(snapshot, true);
    const cell = pathCellFromPoint(e.clientX, e.clientY, snapshot, metrics);
    if (!cell) return;

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
      dragMode = null;
      activePointerId = null;
      wallDrag = null;
      pathDrag = null;
      dragGridMetrics = null;
      readLayoutMetrics = () => null;
    },
  };
}
