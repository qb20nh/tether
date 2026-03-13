import { CELL_TYPES } from '../config.ts';
import type {
  GameSnapshot,
  GridPoint,
  GridTuple,
  LevelDefinition,
  StateCommand,
  StatePort,
  StateTransition,
  StateTransitionMeta,
  StitchRequirement,
} from '../contracts/ports.ts';
import { parseCoordinatePair } from '../shared/coordinate_pair.ts';
import { buildStitchLookups } from '../shared/stitch_corner_geometry.ts';
import { inBounds, isAdjacentMove, keyOf, parseLevel } from '../utils.ts';
import { canDropWall as canDropWallOnSnapshot } from './snapshot_rules.ts';

type LevelSource = ((index: number) => LevelDefinition | null | undefined) | ArrayLike<LevelDefinition>;

interface ResetRestoreCandidate {
  path: GridPoint[];
  gridData: string[][];
}

interface RestoreMutableStatePayload {
  path?: unknown;
  movableWalls?: unknown;
  grid?: unknown;
}

interface PathStepPayload {
  r?: unknown;
  c?: unknown;
}

interface WallMovePayload {
  from?: GridPoint | null;
  to?: GridPoint | null;
}

interface GameStateStore extends StatePort {
  loadLevel: (levelIndex: number) => void;
  resetPath: () => StateTransitionMeta;
  undo: (deferInvalidate?: boolean) => boolean;
  startOrTryStep: (r: number, c: number, options?: { deferInvalidate?: boolean }) => boolean;
  startOrTryStepFromStart: (r: number, c: number, options?: { deferInvalidate?: boolean }) => boolean;
  applyPathDragSequence: (side: string, steps?: unknown[]) => boolean;
  finalizePathAfterPointerUp: () => boolean;
  reversePath: () => boolean;
  canDropWall: (from: GridPoint | null | undefined, to: GridPoint | null | undefined) => boolean;
  moveWall: (from: GridPoint | null | undefined, to: GridPoint | null | undefined) => boolean;
  isUsable: (r: number, c: number) => boolean;
  getCurrentLevel: () => LevelDefinition | null | undefined;
}

export function createGameStateStore(levelSource: LevelSource): GameStateStore {
  const getLevelByIndex = typeof levelSource === 'function'
    ? levelSource
    : (index: number) => levelSource[index];

  let levelIndex = 0;
  let rows = 0;
  let cols = 0;
  let totalUsable = 0;

  let path: GridPoint[] = [];
  let visited = new Set<string>();
  let gridData: string[][] = [];
  let baseGridData: string[][] = [];

  let stitches: GridTuple[] = [];
  let stitchSet = new Set<string>();
  let stitchReq = new Map<string, StitchRequirement>();
  let cornerCounts: Array<[number, number, number]> = [];
  let resetRestoreCandidate: ResetRestoreCandidate | null = null;
  let stateVersion = 0;
  let cachedSnapshot: GameSnapshot | null = null;
  let cachedSnapshotVersion = -1;

  const isWall = (r: number, c: number): boolean => {
    const ch = gridData[r][c];
    return ch === CELL_TYPES.WALL || ch === CELL_TYPES.MOVABLE_WALL;
  };

  const isUsable = (r: number, c: number): boolean => inBounds(rows, cols, r, c) && !isWall(r, c);

  const buildStitches = (): void => {
    ({ stitchSet, stitchReq } = buildStitchLookups(stitches));
  };

  const invalidateSnapshotCache = (): void => {
    stateVersion += 1;
    cachedSnapshot = null;
    cachedSnapshotVersion = -1;
  };

  const clonePath = (sourcePath: readonly GridPoint[]): GridPoint[] =>
    sourcePath.map((point) => ({ r: point.r, c: point.c }));
  const hasPathSegments = (sourcePath: readonly GridPoint[]): boolean => Array.isArray(sourcePath) && sourcePath.length > 1;

  const buildVisitedForPath = (sourcePath: readonly GridPoint[]): Set<string> => {
    const nextVisited = new Set<string>();
    for (const element of sourcePath) {
      const point = element;
      nextVisited.add(keyOf(point.r, point.c));
    }
    return nextVisited;
  };

  const clearResetRestoreCandidate = (): void => {
    resetRestoreCandidate = null;
  };

  const parsePair = (entry: unknown): GridTuple | null => {
    const parsed = parseCoordinatePair(
      entry as [unknown, unknown] | { r?: unknown; c?: unknown } | null | undefined,
    );
    return parsed ? [parsed.r, parsed.c] : null;
  };

  const isMutableCell = (cell: string): boolean => cell === CELL_TYPES.EMPTY || cell === CELL_TYPES.MOVABLE_WALL;

  const collectBaseMovableWalls = (): { baseMovableWalls: GridTuple[]; nextGrid: string[][] } => {
    const baseMovableWalls: GridTuple[] = [];
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

  const resolveMovableWallEntries = (
    rawMovableWalls: unknown,
    baseMovableWalls: GridTuple[],
  ): GridTuple[] | unknown[] | null => {
    if (rawMovableWalls === null || rawMovableWalls === undefined) {
      return baseMovableWalls;
    }
    return Array.isArray(rawMovableWalls) ? rawMovableWalls : null;
  };

  const normalizeMovableWalls = (movableEntries: GridTuple[] | unknown[] | null): GridTuple[] | null => {
    if (!Array.isArray(movableEntries)) return null;

    const nextMovableWalls: GridTuple[] = [];
    const seen = new Set<string>();
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

  const buildGridFromMovableWalls = (rawMovableWalls: unknown = null): string[][] | null => {
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

  const isLegacyGridCellValid = (baseCell: string, candidateCell: string): boolean => {
    if (!isMutableCell(baseCell)) return candidateCell === baseCell;
    return candidateCell === CELL_TYPES.EMPTY || candidateCell === CELL_TYPES.MOVABLE_WALL;
  };

  const parseLegacyGridRow = (rawRow: unknown, r: number): { row: string[]; movableCount: number; baseMovableCount: number } | null => {
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

  const buildGridFromLegacyState = (rawGrid: unknown): string[][] | null => {
    if (!Array.isArray(rawGrid) || rawGrid.length !== rows) return null;

    const nextGrid: string[][] = [];
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

  const resolveRestoredGrid = (saved: RestoreMutableStatePayload): string[][] | null => {
    if (Array.isArray(saved.movableWalls)) {
      return buildGridFromMovableWalls(saved.movableWalls);
    }
    if (Array.isArray(saved.grid)) {
      return buildGridFromLegacyState(saved.grid);
    }
    return buildGridFromMovableWalls(null);
  };

  const isPathUsableOnGrid = (nextGrid: string[][], r: number, c: number): boolean => {
    if (!inBounds(rows, cols, r, c)) return false;
    const ch = nextGrid[r][c];
    return ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
  };

  const buildRestoredPathState = (
    rawPath: unknown[],
    nextGrid: string[][],
  ): { path: GridPoint[]; visited: Set<string> } | null => {
    const nextPath: GridPoint[] = [];
    const nextVisited = new Set<string>();

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

  const loadLevel = (index: number): void => {
    const level = getLevelByIndex(index);
    if (!level) throw new Error(`Missing level at index ${index}`);
    const parsed = parseLevel(level as LevelDefinition & { grid: string[] });
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
    visited = new Set<string>();
    clearResetRestoreCandidate();
    invalidateSnapshotCache();
  };

  const restoreMutableState = (saved: RestoreMutableStatePayload): boolean => {
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

  const toSnapshot = (): GameSnapshot => {
    if (cachedSnapshot && cachedSnapshotVersion === stateVersion) {
      return cachedSnapshot;
    }

    const idxByKey = new Map<string, number>();
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

  const clearPath = (rememberResetCandidate = false): boolean => {
    if (path.length <= 0) return false;
    if (rememberResetCandidate && hasPathSegments(path)) {
      resetRestoreCandidate = {
        path: clonePath(path),
        gridData,
      };
    }
    path = [];
    visited = new Set<string>();
    invalidateSnapshotCache();
    return true;
  };

  const resetPath = (): StateTransitionMeta => {
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

  const commitPathMutation = (): void => {
    if (hasPathSegments(path)) {
      clearResetRestoreCandidate();
    }
    invalidateSnapshotCache();
  };

  const initializePath = (next: GridPoint, nextKey: string, deferInvalidate: boolean): boolean => {
    path = [next];
    visited = new Set([nextKey]);
    if (!deferInvalidate) commitPathMutation();
    return true;
  };

  const addPathTip = (next: GridPoint, nextKey: string, side: 'start' | 'end', deferInvalidate: boolean): boolean => {
    if (side === 'start') {
      path.unshift(next);
    } else {
      path.push(next);
    }
    visited.add(nextKey);
    if (!deferInvalidate) commitPathMutation();
    return true;
  };

  const removePathTip = (side: 'start' | 'end', deferInvalidate: boolean): boolean => {
    if (path.length === 0) return false;
    const removed = side === 'start' ? path.shift() : path.pop();
    if (!removed) return false;
    visited.delete(keyOf(removed.r, removed.c));
    if (!deferInvalidate) commitPathMutation();
    return true;
  };

  const undo = (deferInvalidate = false): boolean => removePathTip('end', deferInvalidate);

  const pathPointsMatch = (left?: GridPoint | null, right?: GridPoint | null): boolean => (
    left?.r === right?.r && left?.c === right?.c
  );

  const getPathTipForSide = (side: 'start' | 'end'): GridPoint | null => (
    side === 'start' ? path[0] || null : path[path.length - 1] || null
  );

  const getPathRetractNeighborForSide = (side: 'start' | 'end'): GridPoint | null => (
    side === 'start' ? path[1] || null : path[path.length - 2] || null
  );

  const startOrTryStepAtSide = (
    r: number,
    c: number,
    side: 'start' | 'end',
    options: { deferInvalidate?: boolean } = {},
  ): boolean => {
    const deferInvalidate = Boolean(options.deferInvalidate);
    if (!isUsable(r, c)) return false;

    const next = { r, c };
    const nextKey = keyOf(r, c);

    if (path.length === 0) {
      return initializePath(next, nextKey, deferInvalidate);
    }

    if (path.length >= 2) {
      const retractNeighbor = getPathRetractNeighborForSide(side);
      if (pathPointsMatch(next, retractNeighbor)) {
        return removePathTip(side, deferInvalidate);
      }
    }

    const tip = getPathTipForSide(side);
    if (!tip) return false;
    const isAdjacent = side === 'start'
      ? isAdjacentMove({ stitchSet }, next, tip)
      : isAdjacentMove({ stitchSet }, tip, next);
    if (!isAdjacent) return false;
    if (visited.has(nextKey)) return false;
    return addPathTip(next, nextKey, side, deferInvalidate);
  };

  const startOrTryStep = (r: number, c: number, options: { deferInvalidate?: boolean } = {}): boolean =>
    startOrTryStepAtSide(r, c, 'end', options);

  const startOrTryStepFromStart = (r: number, c: number, options: { deferInvalidate?: boolean } = {}): boolean =>
    startOrTryStepAtSide(r, c, 'start', options);

  const applyPathDragSequence = (side: string, steps: unknown[] = []): boolean => {
    let applyStep: ((r: number, c: number, options?: { deferInvalidate?: boolean }) => boolean) | null = null;
    if (side === 'start') {
      applyStep = startOrTryStepFromStart;
    } else if (side === 'end') {
      applyStep = startOrTryStep;
    }
    if (!applyStep || !Array.isArray(steps) || steps.length === 0) return false;

    let changed = false;
    for (const element of steps) {
      const step = element as PathStepPayload;
      if (!Number.isInteger(step?.r) || !Number.isInteger(step?.c)) break;
      const didChange = applyStep(Number(step.r), Number(step.c), { deferInvalidate: true });
      if (!didChange) break;
      changed = true;
    }

    if (changed) commitPathMutation();
    return changed;
  };

  const finalizePathAfterPointerUp = (): boolean => {
    if (path.length <= 1) {
      if (path.length > 0) {
        clearPath(false);
      }
      return true;
    }

    return false;
  };

  const reversePath = (): boolean => {
    if (path.length < 2) return false;
    path = [...path].reverse();
    commitPathMutation();
    return true;
  };

  const canDropWall = (from: GridPoint | null | undefined, to: GridPoint | null | undefined): boolean => {
    return canDropWallOnSnapshot({
      rows,
      cols,
      gridData,
      visited,
    }, from, to);
  };

  const moveWall = (from: GridPoint | null | undefined, to: GridPoint | null | undefined): boolean => {
    if (!canDropWall(from, to)) return false;
    if (!from || !to) return false;
    const nextGrid = gridData.map((row) => row.slice());
    nextGrid[from.r][from.c] = CELL_TYPES.EMPTY;
    nextGrid[to.r][to.c] = CELL_TYPES.MOVABLE_WALL;
    gridData = nextGrid;
    clearResetRestoreCandidate();
    invalidateSnapshotCache();
    return true;
  };

  const getCurrentLevel = (): LevelDefinition | null | undefined => getLevelByIndex(levelIndex);

  const makeTransition = (
    command: string,
    changed: boolean,
    rebuildGrid: boolean,
    validate: boolean,
    meta: StateTransitionMeta | null = null,
  ): StateTransition => ({
    changed: Boolean(changed),
    rebuildGrid: Boolean(rebuildGrid),
    validate: Boolean(validate),
    command,
    meta,
    snapshot: toSnapshot(),
  });

  const dispatch = (command: StateCommand): StateTransition => {
    const type = command?.type || '';
    const payload = (command?.payload || {}) as Record<string, unknown>;

    if (type === 'level/load') {
      if (!Number.isInteger(payload.levelIndex)) {
        return makeTransition(type, false, false, false);
      }
      loadLevel(Number(payload.levelIndex));
      return makeTransition(type, true, true, false);
    }

    if (type === 'path/start-or-step') {
      const changed = startOrTryStep(Number(payload.r), Number(payload.c));
      return makeTransition(type, changed, false, false);
    }

    if (type === 'path/start-or-step-from-start') {
      const changed = startOrTryStepFromStart(Number(payload.r), Number(payload.c));
      return makeTransition(type, changed, false, false);
    }

    if (type === 'path/apply-drag-sequence') {
      const changed = applyPathDragSequence(
        typeof payload.side === 'string' ? payload.side : '',
        Array.isArray(payload.steps) ? payload.steps : [],
      );
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
      const wallMove = payload as Record<string, unknown> & WallMovePayload;
      const changed = moveWall(wallMove.from, wallMove.to);
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

export function createGameState(levelSource: LevelSource): GameStateStore {
  return createGameStateStore(levelSource);
}
