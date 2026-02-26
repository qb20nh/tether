import { CELL_TYPES, HINT_CODES } from '../config.js';
import { inBounds, isAdjacentMove, keyOf, parseLevel } from '../utils.js';

export function createGameStateStore(levelSource) {
  const getLevelByIndex = typeof levelSource === 'function'
    ? levelSource
    : (index) => levelSource[index];

  let levelIndex = 0;
  let rows = 0;
  let cols = 0;
  let totalUsable = 0;

  let path = [];
  let visited = new Set();
  let gridData = [];
  let baseGridData = [];

  let stitches = [];
  let stitchSet = new Set();
  let stitchReq = new Map();
  let cornerCounts = [];

  const isWall = (r, c) => {
    const ch = gridData[r][c];
    return ch === CELL_TYPES.WALL || ch === CELL_TYPES.MOVABLE_WALL;
  };

  const isUsable = (r, c) => inBounds(rows, cols, r, c) && !isWall(r, c);
  const isHintCell = (r, c) =>
    inBounds(rows, cols, r, c) && HINT_CODES.has(gridData[r][c]);

  const buildStitches = () => {
    stitchSet = new Set();
    stitchReq = new Map();

    for (const [vr, vc] of stitches) {
      const vk = `${vr},${vc}`;
      stitchSet.add(vk);
      stitchReq.set(vk, {
        nw: { r: vr - 1, c: vc - 1 },
        ne: { r: vr - 1, c: vc },
        sw: { r: vr, c: vc - 1 },
        se: { r: vr, c: vc },
      });
    }
  };

  const loadLevel = (index) => {
    const level = getLevelByIndex(index);
    if (!level) throw new Error(`Missing level at index ${index}`);
    const parsed = parseLevel(level);
    baseGridData = parsed.g.map((row) => row.slice());
    gridData = baseGridData.map((row) => row.slice());
    rows = parsed.rows;
    cols = parsed.cols;
    totalUsable = parsed.usable;
    stitches = parsed.stitches;
    cornerCounts = parsed.cornerCounts;
    levelIndex = index;

    buildStitches();
    path = [];
    visited = new Set();
  };

  const restoreMutableState = (saved) => {
    if (!saved || typeof saved !== 'object') return false;
    if (rows <= 0 || cols <= 0) return false;
    const parsePair = (entry) => {
      const r = Array.isArray(entry) ? entry[0] : entry?.r;
      const c = Array.isArray(entry) ? entry[1] : entry?.c;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
      return [r, c];
    };

    const buildGridFromMovableWalls = (rawMovableWalls = null) => {
      const baseMovableWalls = [];
      const nextGrid = baseGridData.map((row) => row.slice());
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (baseGridData[r][c] === CELL_TYPES.MOVABLE_WALL) {
            baseMovableWalls.push([r, c]);
            nextGrid[r][c] = CELL_TYPES.EMPTY;
          }
        }
      }

      let movableEntries = rawMovableWalls;
      if (movableEntries === null || movableEntries === undefined) {
        movableEntries = baseMovableWalls;
      }
      if (!Array.isArray(movableEntries)) return null;

      const nextMovableWalls = [];
      const seen = new Set();
      for (let i = 0; i < movableEntries.length; i++) {
        const pair = parsePair(movableEntries[i]);
        if (!pair) return null;

        const [r, c] = pair;
        if (!inBounds(rows, cols, r, c)) return null;

        const k = keyOf(r, c);
        if (seen.has(k)) return null;
        seen.add(k);

        const baseCell = baseGridData[r][c];
        if (baseCell !== CELL_TYPES.EMPTY && baseCell !== CELL_TYPES.MOVABLE_WALL) return null;

        nextMovableWalls.push(pair);
      }

      if (nextMovableWalls.length !== baseMovableWalls.length) return null;
      for (let i = 0; i < nextMovableWalls.length; i++) {
        const [r, c] = nextMovableWalls[i];
        nextGrid[r][c] = CELL_TYPES.MOVABLE_WALL;
      }

      return nextGrid;
    };

    const buildGridFromLegacyState = (rawGrid) => {
      if (!Array.isArray(rawGrid) || rawGrid.length !== rows) return null;

      const nextGrid = [];
      let movableCount = 0;
      let baseMovableCount = 0;

      for (let r = 0; r < rows; r++) {
        const rawRow = rawGrid[r];
        if (typeof rawRow !== 'string' || rawRow.length !== cols) return null;
        const row = rawRow.split('');
        for (let c = 0; c < cols; c++) {
          const baseCell = baseGridData[r][c];
          const candidateCell = row[c];
          const canChange = baseCell === CELL_TYPES.EMPTY || baseCell === CELL_TYPES.MOVABLE_WALL;

          if (baseCell === CELL_TYPES.MOVABLE_WALL) baseMovableCount += 1;
          if (candidateCell === CELL_TYPES.MOVABLE_WALL) movableCount += 1;

          if (canChange) {
            if (candidateCell !== CELL_TYPES.EMPTY && candidateCell !== CELL_TYPES.MOVABLE_WALL) return null;
          } else if (candidateCell !== baseCell) {
            return null;
          }
        }
        nextGrid.push(row);
      }

      if (movableCount !== baseMovableCount) return null;
      return nextGrid;
    };

    let nextGrid = null;
    if (Array.isArray(saved.movableWalls)) {
      nextGrid = buildGridFromMovableWalls(saved.movableWalls);
    } else if (Array.isArray(saved.grid)) {
      nextGrid = buildGridFromLegacyState(saved.grid);
    } else {
      nextGrid = buildGridFromMovableWalls(null);
    }
    if (!nextGrid) return false;

    const rawPath = Array.isArray(saved.path) ? saved.path : [];
    const nextPath = [];
    const nextVisited = new Set();

    const isPathUsable = (r, c) => {
      if (!inBounds(rows, cols, r, c)) return false;
      const ch = nextGrid[r][c];
      return ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
    };

    for (let i = 0; i < rawPath.length; i++) {
      const pair = parsePair(rawPath[i]);
      if (!pair) return false;
      const [r, c] = pair;
      if (!isPathUsable(r, c)) return false;

      const point = { r, c };
      const k = keyOf(r, c);
      if (nextVisited.has(k)) return false;

      const prev = nextPath[nextPath.length - 1];
      if (prev && !isAdjacentMove({ stitchSet }, prev, point)) return false;

      nextPath.push(point);
      nextVisited.add(k);
    }

    gridData = nextGrid;
    path = nextPath;
    visited = nextVisited;
    return true;
  };

  const toSnapshot = () => {
    const idxByKey = new Map();
    for (let i = 0; i < path.length; i++) {
      idxByKey.set(keyOf(path[i].r, path[i].c), i);
    }

    return {
      levelIndex,
      rows,
      cols,
      totalUsable,
      path: path.slice(),
      visited,
      gridData,
      stitches,
      cornerCounts,
      stitchSet,
      stitchReq,
      idxByKey,
    };
  };

  const resetPath = () => {
    path = [];
    visited = new Set();
  };

  const undo = () => {
    if (path.length === 0) return false;
    const last = path.pop();
    visited.delete(keyOf(last.r, last.c));
    return true;
  };

  const startOrTryStep = (r, c) => {
    if (!isUsable(r, c)) return false;

    const next = { r, c };
    const nextKey = keyOf(r, c);

    if (path.length === 0) {
      path = [next];
      visited = new Set([nextKey]);
      return true;
    }

    const last = path[path.length - 1];
    if (path.length >= 2) {
      const prev = path[path.length - 2];
      if (next.r === prev.r && next.c === prev.c) {
        undo();
        return true;
      }
    }

    if (!isAdjacentMove({ stitchSet }, last, next)) return false;
    if (visited.has(nextKey)) return false;

    path.push(next);
    visited.add(nextKey);
    return true;
  };

  const startOrTryStepFromStart = (r, c) => {
    if (!isUsable(r, c)) return false;

    const next = { r, c };
    const nextKey = keyOf(r, c);

    if (path.length === 0) {
      path = [next];
      visited = new Set([nextKey]);
      return true;
    }

    const head = path[0];
    if (path.length >= 2) {
      const nextFromStart = path[1];
      if (next.r === nextFromStart.r && next.c === nextFromStart.c) {
        path.shift();
        visited.delete(keyOf(head.r, head.c));
        return true;
      }
    }

    if (!isAdjacentMove({ stitchSet }, next, head)) return false;
    if (visited.has(nextKey)) return false;

    path.unshift(next);
    visited.add(nextKey);
    return true;
  };

  const finalizePathAfterPointerUp = () => {
    if (path.length <= 1) {
      if (path.length > 0) {
        resetPath();
      }
      return true;
    }

    return false;
  };

  const reversePath = () => {
    if (path.length < 2) return false;
    path = [...path].reverse();
    return true;
  };

  const canDropWall = (from, to) => {
    if (!from || !to) return false;
    if (!inBounds(rows, cols, from.r, from.c) || !inBounds(rows, cols, to.r, to.c)) return false;
    if (gridData[from.r][from.c] !== CELL_TYPES.MOVABLE_WALL) return false;
    if (from.r === to.r && from.c === to.c) return false;
    if (gridData[to.r][to.c] !== CELL_TYPES.EMPTY) return false;
    if (visited.has(keyOf(to.r, to.c))) return false;
    return true;
  };

  const moveWall = (from, to) => {
    if (!canDropWall(from, to)) return false;
    gridData[from.r][from.c] = CELL_TYPES.EMPTY;
    gridData[to.r][to.c] = CELL_TYPES.MOVABLE_WALL;
    return true;
  };

  const getCurrentLevel = () => getLevelByIndex(levelIndex);

  const makeTransition = (command, changed, rebuildGrid, validate) => ({
    changed: Boolean(changed),
    rebuildGrid: Boolean(rebuildGrid),
    validate: Boolean(validate),
    command,
    snapshot: toSnapshot(),
  });

  const dispatch = (command) => {
    const type = command?.type || '';
    const payload = command?.payload || {};

    if (type === 'level/load') {
      loadLevel(payload.levelIndex);
      return makeTransition(type, true, true, false);
    }

    if (type === 'path/start-or-step') {
      const changed = startOrTryStep(payload.r, payload.c);
      return makeTransition(type, changed, false, false);
    }

    if (type === 'path/start-or-step-from-start') {
      const changed = startOrTryStepFromStart(payload.r, payload.c);
      return makeTransition(type, changed, false, false);
    }

    if (type === 'path/finalize-after-pointer') {
      const changed = finalizePathAfterPointerUp();
      return makeTransition(type, changed, false, true);
    }

    if (type === 'path/reset') {
      const changed = path.length > 0;
      resetPath();
      return makeTransition(type, changed, false, false);
    }

    if (type === 'path/reverse') {
      const changed = reversePath();
      return makeTransition(type, changed, false, true);
    }

    if (type === 'wall/move-attempt') {
      const changed = moveWall(payload.from, payload.to);
      return makeTransition(type, changed, false, changed);
    }

    return makeTransition(type || 'unknown', false, false, false);
  };

  return {
    dispatch,
    loadLevel,
    restoreMutableState,
    resetPath,
    undo,
    startOrTryStep,
    startOrTryStepFromStart,
    finalizePathAfterPointerUp,
    reversePath,
    canDropWall,
    moveWall,
    isUsable,
    getSnapshot: toSnapshot,
    getCurrentLevel,
  };
}

export function createGameState(levelSource) {
  return createGameStateStore(levelSource);
}
