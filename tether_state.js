import { CELL_TYPES, HINT_CODES } from './tether_config.js';
import { inBounds, isAdjacentMove, keyOf, parseLevel } from './tether_utils.js';

export function createGameState(levels) {
  let levelIndex = 0;
  let rows = 0;
  let cols = 0;
  let totalUsable = 0;

  let path = [];
  let visited = new Set();
  let gridData = [];

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
    const parsed = parseLevel(levels[index]);
    gridData = parsed.g;
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

  const getCurrentLevel = () => levels[levelIndex];

  return {
    loadLevel,
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
