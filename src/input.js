import { CELL_TYPES } from './config.js';
import {
  clearDropTarget,
  setDropTarget,
  showWallDragGhost,
  moveWallDragGhost,
  hideWallDragGhost,
} from './renderer.js';
import { isAdjacentMove } from './utils.js';
import { cellCenter, getCellSize } from './geometry.js';

export function bindInputHandlers(refs, state, onStateChange = () => { }) {
  let dragMode = null;
  let activePointerId = null;
  let wallDrag = null;
  let pathDrag = null;
  const WALL_DRAGGING_CLASS = 'isWallDragging';
  const PATH_DRAGGING_CLASS = 'isPathDragging';

  const setWallDraggingCursor = (isDragging) => {
    document.body.classList.toggle(WALL_DRAGGING_CLASS, isDragging);
  };

  const setPathDraggingCursor = (isDragging) => {
    document.body.classList.toggle(PATH_DRAGGING_CLASS, isDragging);
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

  const isUsableCell = (snapshot, r, c) => {
    const ch = snapshot.gridData[r]?.[c];
    return ch && ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
  };

  const onPointerDown = (e) => {
    const snapshot = state.getSnapshot();
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
      setWallDraggingCursor(true);
      showWallDragGhost(e.clientX, e.clientY);
      refs.gridEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (!isUsableCell(snapshot, cell.r, cell.c)) return;

    if (snapshot.path.length === 0) {
      if (!state.startOrTryStep(cell.r, cell.c)) return;
      dragMode = 'path';
      pathDrag = {
        side: 'end',
        moved: false,
        origin: { r: cell.r, c: cell.c },
        lastCursorKey: `${cell.r},${cell.c}`,
      };
      activePointerId = e.pointerId;
      setPathDraggingCursor(true);
      refs.gridEl.setPointerCapture(e.pointerId);
      onStateChange(false, {
        rebuildGrid: false,
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
    setPathDraggingCursor(true);
    refs.gridEl.setPointerCapture(e.pointerId);
    onStateChange(false, {
      rebuildGrid: false,
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
        const snapshotForInput = state.getSnapshot();
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

            const candidates = [];
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = headNode.r + dr;
                const nc = headNode.c + dc;
                if (nr < 0 || nr >= snapshotForInput.rows || nc < 0 || nc >= snapshotForInput.cols) continue;

                const cand = { r: nr, c: nc };
                if (!isAdjacentMove(snapshotForInput, headNode, cand)) continue;
                if (!isUsableCell(snapshotForInput, cand.r, cand.c)) continue;

                const isBacktrack =
                  Boolean(backtrackNode) &&
                  cand.r === backtrackNode.r &&
                  cand.c === backtrackNode.c;
                const k = `${cand.r},${cand.c}`;
                if (!isBacktrack && snapshotForInput.visited.has(k)) continue;

                candidates.push({ ...cand, isBacktrack });
              }
            }

            const holdCenter = cellCenter(holdCell.r, holdCell.c, refs.gridEl);
            const holdDist = Math.hypot(px - holdCenter.x, py - holdCenter.y);

            let bestMoveCell = null;
            let bestMoveDist = Infinity;

            candidates.forEach((cand) => {
              const center = cellCenter(cand.r, cand.c, refs.gridEl);
              let dist = Math.hypot(px - center.x, py - center.y);

              const isDiag = Math.abs(cand.r - headNode.r) === 1 && Math.abs(cand.c - headNode.c) === 1;
              if (isDiag) {
                dist -= size * 0.18;
              }

              if (dist < bestMoveDist) {
                bestMoveDist = dist;
                bestMoveCell = cand;
              }
            });

            if (!bestMoveCell) {
              cell = holdCell;
            } else {
              const hysteresis = bestMoveCell.isBacktrack ? size * 0.24 : size * 0.12;
              cell = bestMoveDist + hysteresis < holdDist
                ? { r: bestMoveCell.r, c: bestMoveCell.c }
                : holdCell;
            }
          }
        }
      }

      if (!cell) return;

      if (pathDrag && !pathDrag.moved) {
        if (pathDrag.origin.r === cell.r && pathDrag.origin.c === cell.c) return;
        pathDrag.moved = true;
      }

      let touched = false;

      if (pathDrag && pathDrag.side === 'start') {
        touched = state.startOrTryStepFromStart(cell.r, cell.c);
      } else {
        touched = state.startOrTryStep(cell.r, cell.c);
      }

      const cursorKey = `${cell.r},${cell.c}`;
      const cursorChanged = pathDrag ? pathDrag.lastCursorKey !== cursorKey : false;

      if (touched || cursorChanged) {
        if (pathDrag) pathDrag.lastCursorKey = cursorKey;
        onStateChange(false, {
          rebuildGrid: false,
          isPathDragging: true,
          pathDragSide: pathDrag?.side || null,
          pathDragCursor: { r: cell.r, c: cell.c },
        });
      }
      return;
    }

    if (dragMode === 'wall') {
      if (e.cancelable) e.preventDefault();
      moveWallDragGhost(e.clientX, e.clientY);
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (!cell) {
        wallDrag.hover = null;
        clearDropTarget();
        return;
      }
      if (state.canDropWall(wallDrag.from, cell)) {
        wallDrag.hover = { r: cell.r, c: cell.c };
        setDropTarget(cell.r, cell.c);
      } else {
        wallDrag.hover = null;
        clearDropTarget();
      }
    }
  };

  const onPointerUp = (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const finalMode = dragMode;
    const hadWallMove = dragMode === 'wall' && wallDrag && wallDrag.hover;

    if (dragMode === 'wall') {
      clearDropTarget();
      if (wallDrag && wallDrag.hover) {
        state.moveWall(wallDrag.from, wallDrag.hover);
      }
    }

    dragMode = null;
    activePointerId = null;
    wallDrag = null;
    pathDrag = null;
    setWallDraggingCursor(false);
    setPathDraggingCursor(false);
    hideWallDragGhost();
    if (finalMode === 'path' && state.finalizePathAfterPointerUp) {
      state.finalizePathAfterPointerUp();
    }

    onStateChange(
      hadWallMove || finalMode === 'path',
      {
        // Grid cell contents are updated incrementally, so full rebuild is unnecessary.
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    );
    e.preventDefault();
  };

  refs.gridEl.addEventListener('pointerdown', onPointerDown);
  refs.gridEl.addEventListener('pointermove', onPointerMove, { passive: false });
  refs.gridEl.addEventListener('pointerup', onPointerUp, { passive: false });
  refs.gridEl.addEventListener('pointercancel', onPointerUp, { passive: false });

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
