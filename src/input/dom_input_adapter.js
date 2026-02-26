import { CELL_TYPES } from '../config.js';
import { isAdjacentMove } from '../utils.js';
import {
  cellCenter,
  getCellSize,
  getGridGap,
  getGridPadding,
} from '../geometry.js';
import {
  buildPathDragCandidates,
  choosePathDragCell,
} from './pointer_intent_resolver.js';
import {
  INTENT_TYPES,
  GAME_COMMANDS,
  UI_ACTIONS,
  INTERACTION_UPDATES,
} from '../runtime/intents.js';

export function createDomInputAdapter() {
  let refs = null;
  let readSnapshot = () => null;
  let emitIntent = () => { };
  let listeners = [];

  let dragMode = null;
  let activePointerId = null;
  let wallDrag = null;
  let pathDrag = null;

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

  const snapWallCellFromPoint = (x, y, snapshot) => {
    if (!refs.gridEl || !snapshot) return null;

    const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
    const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
    if (rows <= 0 || cols <= 0) return null;

    const rect = refs.gridEl.getBoundingClientRect();
    const size = getCellSize(refs.gridEl);
    const gap = getGridGap(refs.gridEl);
    const pad = getGridPadding(refs.gridEl);
    const step = size + gap;
    if (!(step > 0)) return null;

    const margin = Math.max(6, step * 0.5);
    if (x < rect.left - margin || x > rect.right + margin || y < rect.top - margin || y > rect.bottom + margin) {
      return null;
    }

    const localX = x - rect.left - pad - (size * 0.5);
    const localY = y - rect.top - pad - (size * 0.5);

    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    const c = clamp(Math.round(localX / step), 0, cols - 1);
    const r = clamp(Math.round(localY / step), 0, rows - 1);
    return { r, c };
  };

  const wallCellFromPoint = (x, y, snapshot) => {
    const direct = cellFromPoint(x, y);
    if (direct) return direct;
    return snapWallCellFromPoint(x, y, snapshot);
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
        moved: false,
        origin: { r: cell.r, c: cell.c },
        lastCursorKey: `${cell.r},${cell.c}`,
      };
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
    if (!isTail && !isHead) return;

    pathDrag = {
      side: isHead ? 'start' : 'end',
      moved: false,
      origin: { r: cell.r, c: cell.c },
      lastCursorKey: `${cell.r},${cell.c}`,
    };

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
      let cell = cellFromPoint(e.clientX, e.clientY);

      if (pathDrag) {
        const snapshotForInput = readSnapshot();
        const headNode = pathDrag.side === 'start'
          ? snapshotForInput.path[0]
          : snapshotForInput.path[snapshotForInput.path.length - 1];
        const backtrackNode = pathDrag.side === 'start'
          ? snapshotForInput.path[1]
          : snapshotForInput.path[snapshotForInput.path.length - 2];

        if (headNode) {
          const drRaw = cell ? Math.abs(cell.r - headNode.r) : 0;
          const dcRaw = cell ? Math.abs(cell.c - headNode.c) : 0;
          const shouldResolveByPointer = !cell || (drRaw <= 1 && dcRaw <= 1);

          if (shouldResolveByPointer) {
            const rect = refs.gridEl.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const size = getCellSize(refs.gridEl);
            const holdCell = { r: headNode.r, c: headNode.c };

            const candidates = buildPathDragCandidates({
              snapshot: snapshotForInput,
              headNode,
              backtrackNode,
              isUsableCell,
              isAdjacentMove,
            });

            cell = choosePathDragCell({
              headNode,
              candidates,
              pointer: { x: px, y: py },
              holdCell,
              size,
              cellCenter: (r, c) => cellCenter(r, c, refs.gridEl),
            });
          }
        }
      }

      if (!cell) return;

      if (pathDrag && !pathDrag.moved) {
        if (pathDrag.origin.r === cell.r && pathDrag.origin.c === cell.c) return;
        pathDrag.moved = true;
      }

      if (pathDrag && pathDrag.side === 'start') {
        sendGameCommand(GAME_COMMANDS.START_OR_STEP_FROM_START, { r: cell.r, c: cell.c });
      } else {
        sendGameCommand(GAME_COMMANDS.START_OR_STEP, { r: cell.r, c: cell.c });
      }

      const cursorKey = `${cell.r},${cell.c}`;
      const cursorChanged = pathDrag ? pathDrag.lastCursorKey !== cursorKey : false;

      if (cursorChanged) {
        if (pathDrag) pathDrag.lastCursorKey = cursorKey;
        sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
          isPathDragging: true,
          pathDragSide: pathDrag?.side || null,
          pathDragCursor: { r: cell.r, c: cell.c },
        });
      }
      return;
    }

    if (dragMode === 'wall') {
      if (e.cancelable) e.preventDefault();
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: e.clientX,
        y: e.clientY,
        isWallDragging: true,
      });

      const snapshot = readSnapshot();
      const cell = wallCellFromPoint(e.clientX, e.clientY, snapshot);
      if (!cell) {
        wallDrag.hover = null;
        sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
        return;
      }

      if (canDropWall(snapshot, wallDrag.from, cell)) {
        wallDrag.hover = { r: cell.r, c: cell.c };
        sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: wallDrag.hover });
      } else {
        wallDrag.hover = null;
        sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
      }
    }
  };

  const onPointerUp = (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const finalMode = dragMode;
    const wallMoveFrom = wallDrag?.from || null;
    const wallMoveTo = wallDrag?.hover || null;

    dragMode = null;
    activePointerId = null;
    wallDrag = null;
    pathDrag = null;

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

    if (finalMode === 'path') {
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
      dragMode = null;
      activePointerId = null;
      wallDrag = null;
      pathDrag = null;
    },
  };
}
