import { INFINITE_MAX_LEVELS } from '../../src/infinite.js';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createDefaultCore } from '../../src/core/default_core.js';
import { hashString32, makeMulberry32Rng, mix32 } from '../../src/shared/hash32.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { isUsableCell } from '../../src/state/snapshot_rules.js';

const DEFAULT_SEED = 'render-drag-bench-v1';
const DEFAULT_POINTER_MOVES_PER_SEGMENT = 4;
const DEFAULT_MIN_PATH_LENGTH = 14;
const DEFAULT_MAX_PATH_LENGTH = 22;
const DEFAULT_MAX_BOARD_ATTEMPTS = 128;
const DEFAULT_MAX_SAMPLE_ATTEMPTS_FACTOR = 2048;
const ORTHOGONAL_DIRS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);

const keyOf = (r, c) => `${r},${c}`;

const createDeterministicRng = (seed) => {
  return makeMulberry32Rng(mix32(hashString32(String(seed))));
};

const randomInt = (rng, maxExclusive) => {
  if (!(maxExclusive > 0)) return 0;
  return Math.floor(rng() * maxExclusive);
};

const shuffleInPlace = (items, rng) => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const swapIndex = randomInt(rng, i + 1);
    const next = items[i];
    items[i] = items[swapIndex];
    items[swapIndex] = next;
  }
  return items;
};

const collectUsableCells = (snapshot) => {
  const cells = [];
  for (let r = 0; r < snapshot.rows; r += 1) {
    for (let c = 0; c < snapshot.cols; c += 1) {
      if (!isUsableCell(snapshot, r, c)) continue;
      cells.push([r, c]);
    }
  }
  return cells;
};

const collectOrthogonalTailNeighbors = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.path) || snapshot.path.length <= 0) return [];
  const tail = snapshot.path[snapshot.path.length - 1];
  if (!tail) return [];
  const neighbors = [];
  for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
    const [dr, dc] = ORTHOGONAL_DIRS[i];
    const nextR = tail.r + dr;
    const nextC = tail.c + dc;
    if (!isUsableCell(snapshot, nextR, nextC)) continue;
    if (snapshot.visited?.has?.(keyOf(nextR, nextC))) continue;
    neighbors.push([nextR, nextC]);
  }
  return neighbors;
};

const hasOrthogonalUsableNeighbor = (snapshot, r, c) => {
  for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
    const [dr, dc] = ORTHOGONAL_DIRS[i];
    if (isUsableCell(snapshot, r + dr, c + dc)) return true;
  }
  return false;
};

const chooseTargetPathLength = (snapshot, rng, minPathLength, maxPathLength) => {
  const usableCount = Number.isInteger(snapshot?.totalUsable) ? snapshot.totalUsable : 0;
  const cappedMax = Math.min(maxPathLength, usableCount);
  if (cappedMax < minPathLength) return null;
  return minPathLength + randomInt(rng, (cappedMax - minPathLength) + 1);
};

const createBoardHarness = () => {
  const levelProvider = createLevelProvider();
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((levelIndex) => core.getLevel(levelIndex));
  return { core, state };
};

const buildPathCase = (
  infiniteIndex,
  rng,
  {
    minPathLength,
    maxPathLength,
    maxBoardAttempts,
  },
) => {
  const { core, state } = createBoardHarness();
  const absoluteIndex = core.ensureInfiniteAbsIndex(infiniteIndex);

  for (let attempt = 0; attempt < maxBoardAttempts; attempt += 1) {
    state.loadLevel(absoluteIndex);
    const startingSnapshot = state.getSnapshot();
    const targetPathLength = chooseTargetPathLength(
      startingSnapshot,
      rng,
      minPathLength,
      maxPathLength,
    );
    if (!Number.isInteger(targetPathLength)) return null;

    const startCandidates = shuffleInPlace(collectUsableCells(startingSnapshot), rng);
    let didStart = false;
    for (let i = 0; i < startCandidates.length; i += 1) {
      const [startR, startC] = startCandidates[i];
      if (!hasOrthogonalUsableNeighbor(startingSnapshot, startR, startC)) continue;
      if (!state.startOrTryStep(startR, startC)) continue;
      didStart = true;
      break;
    }
    if (!didStart) continue;

    while (state.getSnapshot().path.length < targetPathLength) {
      const snapshot = state.getSnapshot();
      const tailNeighbors = collectOrthogonalTailNeighbors(snapshot);
      if (tailNeighbors.length === 0) break;
      shuffleInPlace(tailNeighbors, rng);
      const [nextR, nextC] = tailNeighbors[0];
      if (!state.startOrTryStep(nextR, nextC)) break;
    }

    const path = state.getSnapshot().path.map((point) => [point.r, point.c]);
    if (path.length < minPathLength || path.length > maxPathLength) continue;

    return {
      infiniteIndex,
      pathCells: path,
    };
  }

  return null;
};

export const createRenderDragWorkload = (options = {}) => {
  const seed = typeof options.seed === 'string' && options.seed.length > 0
    ? options.seed
    : DEFAULT_SEED;
  const boardCount = Number.isInteger(options.boards) && options.boards > 0
    ? options.boards
    : 10;
  const pointerMovesPerSegment = Number.isInteger(options.pointerMovesPerSegment)
    && options.pointerMovesPerSegment > 0
    ? options.pointerMovesPerSegment
    : DEFAULT_POINTER_MOVES_PER_SEGMENT;
  const minPathLength = Number.isInteger(options.minPathLength) && options.minPathLength > 0
    ? options.minPathLength
    : DEFAULT_MIN_PATH_LENGTH;
  const maxPathLength = Number.isInteger(options.maxPathLength) && options.maxPathLength >= minPathLength
    ? options.maxPathLength
    : DEFAULT_MAX_PATH_LENGTH;
  const maxBoardAttempts = Number.isInteger(options.maxBoardAttempts) && options.maxBoardAttempts > 0
    ? options.maxBoardAttempts
    : DEFAULT_MAX_BOARD_ATTEMPTS;

  const rng = createDeterministicRng(seed);
  const cases = [];
  const usedInfiniteIndices = new Set();
  const maxSampleAttempts = Math.max(
    boardCount * DEFAULT_MAX_SAMPLE_ATTEMPTS_FACTOR,
    DEFAULT_MAX_SAMPLE_ATTEMPTS_FACTOR,
  );

  for (let sampleAttempt = 0; cases.length < boardCount && sampleAttempt < maxSampleAttempts; sampleAttempt += 1) {
    const infiniteIndex = randomInt(rng, INFINITE_MAX_LEVELS);
    if (usedInfiniteIndices.has(infiniteIndex)) continue;
    usedInfiniteIndices.add(infiniteIndex);

    const nextCase = buildPathCase(infiniteIndex, rng, {
      minPathLength,
      maxPathLength,
      maxBoardAttempts,
    });
    if (!nextCase) continue;

    cases.push({
      caseId: `case-${String(cases.length).padStart(2, '0')}`,
      infiniteIndex: nextCase.infiniteIndex,
      pathCells: nextCase.pathCells,
    });
  }

  if (cases.length !== boardCount) {
    throw new Error(
      `Unable to build deterministic render-drag workload: ${cases.length}/${boardCount} cases`,
    );
  }

  return {
    version: 1,
    seed,
    pointerMovesPerSegment,
    cases,
  };
};

export const __TEST__ = Object.freeze({
  createDeterministicRng,
  collectUsableCells,
  collectOrthogonalTailNeighbors,
  hasOrthogonalUsableNeighbor,
});
