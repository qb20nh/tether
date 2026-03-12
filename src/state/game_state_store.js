import { CELL_TYPES } from '../config.js';
import { inBounds, isAdjacentMove, keyOf, parseLevel } from '../utils.js';
import { canDropWall as canDropWallOnSnapshot } from './snapshot_rules.js';

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
  let resetRestoreCandidate = null;
  let stateVersion = 0;
  let cachedSnapshot = null;
  let cachedSnapshotVersion = -1;

  const isWall = (r, c) => {
    const ch = gridData[r][c];
    return ch === CELL_TYPES.WALL || ch === CELL_TYPES.MOVABLE_WALL;
  };

  const isUsable = (r, c) => inBounds(rows, cols, r, c) && !isWall(r, c);

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

  const invalidateSnapshotCache = () => {
    stateVersion += 1;
    cachedSnapshot = null;
    cachedSnapshotVersion = -1;
  };

  const clonePath = (sourcePath) => sourcePath.map((point) => ({ r: point.r, c: point.c }));
  const hasPathSegments = (sourcePath) => Array.isArray(sourcePath) && sourcePath.length > 1;

  const buildVisitedForPath = (sourcePath) => {
    const nextVisited = new Set();
    for (const element of sourcePath) {
      const point = element;
      nextVisited.add(keyOf(point.r, point.c));
    }
    return nextVisited;
  };

  const clearResetRestoreCandidate = () => {
    resetRestoreCandidate = null;
  };

  const parsePair = (entry) => {
    const r = Array.isArray(entry) ? entry[0] : entry?.r;
    const c = Array.isArray(entry) ? entry[1] : entry?.c;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return [r, c];
  };

  const isMutableCell = (cell) => {
    return cell === CELL_TYPES.EMPTY || cell === CELL_TYPES.MOVABLE_WALL;
  };

  const collectBaseMovableWalls = () => {
    const baseMovableWalls = [];
    const nextGrid = baseGridData.map((row) => row.slice());

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (baseGridData[r][c] !== CELL_TYPES.MOVABLE_WALL) continue;
        baseMovableWalls.push([r, c]);
        nextGrid[r][c] = CELL_TYPES.EMPTY;
      }
    }

    return { baseMovableWalls, nextGrid };
  };

  const resolveMovableWallEntries = (rawMovableWalls, baseMovableWalls) => {
    if (rawMovableWalls === null || rawMovableWalls === undefined) {
      return baseMovableWalls;
    }
    return Array.isArray(rawMovableWalls) ? rawMovableWalls : null;
  };

  const normalizeMovableWalls = (movableEntries) => {
    if (!Array.isArray(movableEntries)) return null;

    const nextMovableWalls = [];
    const seen = new Set();
    for (const element of movableEntries) {
      const pair = parsePair(element);
      if (!pair) return null;

      const [r, c] = pair;
      if (!inBounds(rows, cols, r, c)) return null;

      const k = keyOf(r, c);
      if (seen.has(k)) return null;
      if (!isMutableCell(baseGridData[r][c])) return null;

      seen.add(k);
      nextMovableWalls.push(pair);
    }

    return nextMovableWalls;
  };

  const buildGridFromMovableWalls = (rawMovableWalls = null) => {
    const { baseMovableWalls, nextGrid } = collectBaseMovableWalls();
    const movableEntries = resolveMovableWallEntries(rawMovableWalls, baseMovableWalls);
    const nextMovableWalls = normalizeMovableWalls(movableEntries);
    if (nextMovableWalls?.length !== baseMovableWalls.length) return null;

    for (const element of nextMovableWalls) {
      const [r, c] = element;
      nextGrid[r][c] = CELL_TYPES.MOVABLE_WALL;
    }

    return nextGrid;
  };

  const isLegacyGridCellValid = (baseCell, candidateCell) => {
    if (!isMutableCell(baseCell)) return candidateCell === baseCell;
    return candidateCell === CELL_TYPES.EMPTY || candidateCell === CELL_TYPES.MOVABLE_WALL;
  };

  const parseLegacyGridRow = (rawRow, r) => {
    if (typeof rawRow !== 'string' || rawRow.length !== cols) return null;

    const row = rawRow.split('');
    let movableCount = 0;
    let baseMovableCount = 0;

    for (let c = 0; c < cols; c++) {
      const baseCell = baseGridData[r][c];
      const candidateCell = row[c];
      if (!isLegacyGridCellValid(baseCell, candidateCell)) return null;
      if (baseCell === CELL_TYPES.MOVABLE_WALL) baseMovableCount += 1;
      if (candidateCell === CELL_TYPES.MOVABLE_WALL) movableCount += 1;
    }

    return { row, movableCount, baseMovableCount };
  };

  const buildGridFromLegacyState = (rawGrid) => {
    if (!Array.isArray(rawGrid) || rawGrid.length !== rows) return null;

    const nextGrid = [];
    let movableCount = 0;
    let baseMovableCount = 0;

    for (let r = 0; r < rows; r++) {
      const parsedRow = parseLegacyGridRow(rawGrid[r], r);
      if (!parsedRow) return null;
      nextGrid.push(parsedRow.row);
      movableCount += parsedRow.movableCount;
      baseMovableCount += parsedRow.baseMovableCount;
    }

    if (movableCount !== baseMovableCount) return null;
    return nextGrid;
  };

  const resolveRestoredGrid = (saved) => {
    if (Array.isArray(saved.movableWalls)) {
      return buildGridFromMovableWalls(saved.movableWalls);
    }
    if (Array.isArray(saved.grid)) {
      return buildGridFromLegacyState(saved.grid);
    }
    return buildGridFromMovableWalls(null);
  };

  const isPathUsableOnGrid = (nextGrid, r, c) => {
    if (!inBounds(rows, cols, r, c)) return false;
    const ch = nextGrid[r][c];
    return ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
  };

  const buildRestoredPathState = (rawPath, nextGrid) => {
    const nextPath = [];
    const nextVisited = new Set();

    for (const element of rawPath) {
      const pair = parsePair(element);
      if (!pair) return null;

      const [r, c] = pair;
      if (!isPathUsableOnGrid(nextGrid, r, c)) return null;

      const point = { r, c };
      const k = keyOf(r, c);
      if (nextVisited.has(k)) return null;

      const prev = nextPath.at(-1);
      if (prev && !isAdjacentMove({ stitchSet }, prev, point)) return null;

      nextPath.push(point);
      nextVisited.add(k);
    }

    return {
      path: nextPath,
      visited: nextVisited,
    };
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
    clearResetRestoreCandidate();
    invalidateSnapshotCache();
  };

  const restoreMutableState = (saved) => {
    if (!saved || typeof saved !== 'object') return false;
    if (rows <= 0 || cols <= 0) return false;
    const nextGrid = resolveRestoredGrid(saved);
    if (!nextGrid) return false;

    const rawPath = Array.isArray(saved.path) ? saved.path : [];
    const restoredPathState = buildRestoredPathState(rawPath, nextGrid);
    if (!restoredPathState) return false;

    gridData = nextGrid;
    path = restoredPathState.path;
    visited = restoredPathState.visited;
    clearResetRestoreCandidate();
    invalidateSnapshotCache();
    return true;
  };

  const toSnapshot = () => {
    if (cachedSnapshot && cachedSnapshotVersion === stateVersion) {
      return cachedSnapshot;
    }

    const idxByKey = new Map();
    const snapshotPath = path.slice();
    let pathKey = '';
    for (let i = 0; i < snapshotPath.length; i++) {
      const point = snapshotPath[i];
      const key = keyOf(point.r, point.c);
      idxByKey.set(key, i);
      pathKey += `${key};`;
    }

    cachedSnapshot = {
      version: stateVersion,
      levelIndex,
      rows,
      cols,
      totalUsable,
      pathKey,
      path: snapshotPath,
      visited,
      gridData,
      stitches,
      cornerCounts,
      stitchSet,
      stitchReq,
      idxByKey,
    };
    cachedSnapshotVersion = stateVersion;
    return cachedSnapshot;
  };

  const clearPath = (rememberResetCandidate = false) => {
    if (path.length <= 0) return false;
    if (rememberResetCandidate && hasPathSegments(path)) {
      resetRestoreCandidate = {
        path: clonePath(path),
        gridData,
      };
    }
    path = [];
    visited = new Set();
    invalidateSnapshotCache();
    return true;
  };

  const resetPath = () => {
    const storedResetCandidate = hasPathSegments(path);
    if (clearPath(true)) {
      return {
        resetMode: 'cleared',
        storedResetCandidate,
      };
    }

    if (
      gridData === resetRestoreCandidate?.gridData
    ) {
      path = clonePath(resetRestoreCandidate.path);
      visited = buildVisitedForPath(path);
      clearResetRestoreCandidate();
      invalidateSnapshotCache();
      return {
        resetMode: 'restored',
        storedResetCandidate: false,
      };
    }

    clearResetRestoreCandidate();
    return {
      resetMode: 'noop',
      storedResetCandidate: false,
    };
  };

  const commitPathMutation = () => {
    if (hasPathSegments(path)) {
      clearResetRestoreCandidate();
    }
    invalidateSnapshotCache();
  };

  const initializePath = (next, nextKey, deferInvalidate) => {
    path = [next];
    visited = new Set([nextKey]);
    if (!deferInvalidate) commitPathMutation();
    return true;
  };

  const addPathTip = (next, nextKey, side, deferInvalidate) => {
    if (side === 'start') {
      path.unshift(next);
    } else {
      path.push(next);
    }
    visited.add(nextKey);
    if (!deferInvalidate) commitPathMutation();
    return true;
  };

  const undo = (deferInvalidate = false) => {
    if (path.length === 0) return false;
    const last = path.pop();
    visited.delete(keyOf(last.r, last.c));
    if (!deferInvalidate) commitPathMutation();
    return true;
  };

  const startOrTryStep = (r, c, options = {}) => {
    const deferInvalidate = Boolean(options.deferInvalidate);
    if (!isUsable(r, c)) return false;

    const next = { r, c };
    const nextKey = keyOf(r, c);

    if (path.length === 0) {
      return initializePath(next, nextKey, deferInvalidate);
    }

    const last = path.at(-1);
    if (path.length >= 2) {
      const prev = path.at(-2);
      if (next.r === prev.r && next.c === prev.c) {
        undo(deferInvalidate);
        return true;
      }
    }

    if (!isAdjacentMove({ stitchSet }, last, next)) return false;
    if (visited.has(nextKey)) return false;
    return addPathTip(next, nextKey, 'end', deferInvalidate);
  };

  const startOrTryStepFromStart = (r, c, options = {}) => {
    const deferInvalidate = Boolean(options.deferInvalidate);
    if (!isUsable(r, c)) return false;

    const next = { r, c };
    const nextKey = keyOf(r, c);

    if (path.length === 0) {
      return initializePath(next, nextKey, deferInvalidate);
    }

    const head = path[0];
    if (path.length >= 2) {
      const nextFromStart = path[1];
      if (next.r === nextFromStart.r && next.c === nextFromStart.c) {
        path.shift();
        visited.delete(keyOf(head.r, head.c));
        if (!deferInvalidate) commitPathMutation();
        return true;
      }
    }

    if (!isAdjacentMove({ stitchSet }, next, head)) return false;
    if (visited.has(nextKey)) return false;
    return addPathTip(next, nextKey, 'start', deferInvalidate);
  };

  const applyPathDragSequence = (side, steps = []) => {
    let applyStep = null;
    if (side === 'start') {
      applyStep = startOrTryStepFromStart;
    } else if (side === 'end') {
      applyStep = startOrTryStep;
    }
    if (!applyStep || !Array.isArray(steps) || steps.length === 0) return false;

    let changed = false;
    for (const element of steps) {
      const step = element;
      if (!Number.isInteger(step?.r) || !Number.isInteger(step?.c)) break;
      const didChange = applyStep(step.r, step.c, { deferInvalidate: true });
      if (!didChange) break;
      changed = true;
    }

    if (changed) commitPathMutation();
    return changed;
  };

  const finalizePathAfterPointerUp = () => {
    if (path.length <= 1) {
      if (path.length > 0) {
        clearPath(false);
      }
      return true;
    }

    return false;
  };

  const reversePath = () => {
    if (path.length < 2) return false;
    path = [...path].reverse();
    commitPathMutation();
    return true;
  };

  const canDropWall = (from, to) => {
    return canDropWallOnSnapshot({
      rows,
      cols,
      gridData,
      visited,
    }, from, to);
  };

  const moveWall = (from, to) => {
    if (!canDropWall(from, to)) return false;
    const nextGrid = gridData.map((row) => row.slice());
    nextGrid[from.r][from.c] = CELL_TYPES.EMPTY;
    nextGrid[to.r][to.c] = CELL_TYPES.MOVABLE_WALL;
    gridData = nextGrid;
    clearResetRestoreCandidate();
    invalidateSnapshotCache();
    return true;
  };

  const getCurrentLevel = () => getLevelByIndex(levelIndex);

  const makeTransition = (command, changed, rebuildGrid, validate, meta = null) => ({
    changed: Boolean(changed),
    rebuildGrid: Boolean(rebuildGrid),
    validate: Boolean(validate),
    command,
    meta,
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

    if (type === 'path/apply-drag-sequence') {
      const changed = applyPathDragSequence(payload.side, payload.steps);
      return makeTransition(type, changed, false, false);
    }

    if (type === 'path/finalize-after-pointer') {
      const changed = finalizePathAfterPointerUp();
      return makeTransition(type, changed, false, true);
    }

    if (type === 'path/reset') {
      const resetState = resetPath();
      return makeTransition(
        type,
        resetState.resetMode !== 'noop',
        false,
        false,
        resetState,
      );
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
    applyPathDragSequence,
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
