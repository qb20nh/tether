import type {
  ElementLike,
  GameSnapshot,
  GridPoint,
} from '../contracts/ports.ts';
import type {
  GridMetrics,
} from './dom_input_adapter_metrics.ts';

export interface PathDragSimulationSnapshot {
  rows: number;
  cols: number;
  gridData: GameSnapshot['gridData'];
  stitchSet: GameSnapshot['stitchSet'];
  path: GridPoint[];
  visited: Set<string>;
  version?: number;
}

export interface PathPointerContext {
  px: number;
  py: number;
  pointerCell: GridPoint | null;
  cellSize: number;
  cellCenter: (r: number, c: number) => { x: number; y: number };
}

export interface ReadPathDragPointerContextOptions {
  snapshot: GameSnapshot | null | undefined;
  pointerClientX: number;
  pointerClientY: number;
  metrics: GridMetrics | null;
  gridEl: ElementLike | null | undefined;
  snapPathCellFromPoint: (
    x: number,
    y: number,
    snapshot: GameSnapshot | null | undefined,
    metrics?: GridMetrics | null,
  ) => GridPoint | null;
  getCellSize: (scope?: unknown) => number;
  cellCenter: (r: number, c: number, scope?: unknown) => { x: number; y: number };
}

export interface QueuedPathDragStepsResult {
  steps: GridPoint[];
  moved: boolean;
  lastCursorKey: string | null;
}

export interface ChoosePathDragStepPayload {
  snapshot: PathDragSimulationSnapshot;
  headNode: GridPoint;
  backtrackNode?: GridPoint | null;
  pointer: { x: number; y: number };
  pointerCell?: GridPoint | null;
  isUsableCell: (snapshot: PathDragSimulationSnapshot, r: number, c: number) => boolean;
  isAdjacentMove: (
    snapshot: PathDragSimulationSnapshot,
    a: GridPoint,
    b: GridPoint,
  ) => boolean;
  cellCenter: (r: number, c: number) => { x: number; y: number };
  cellSize: number;
}

export type ChoosePathDragStep = (payload: ChoosePathDragStepPayload) => GridPoint | null;

export const createPathDragSimulation = (
  snapshot: GameSnapshot | null | undefined,
): PathDragSimulationSnapshot | null => {
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

const removeVisitedSimulationPoint = (
  visited: Set<string>,
  point: GridPoint | null | undefined,
): void => {
  if (!point) return;
  visited.delete(`${point.r},${point.c}`);
};

const applyPathStepToSimulationStart = (
  path: GridPoint[],
  visited: Set<string>,
  nextStep: GridPoint,
  nextKey: string,
  pointsMatch: (left: GridPoint | null | undefined, right: GridPoint | null | undefined) => boolean,
): void => {
  const backtrackNode = path[1];
  if (pointsMatch(backtrackNode, nextStep)) {
    const removedHead = path[0];
    path.shift();
    removeVisitedSimulationPoint(visited, removedHead);
    return;
  }
  path.unshift({ r: nextStep.r, c: nextStep.c });
  visited.add(nextKey);
};

const applyPathStepToSimulationEnd = (
  path: GridPoint[],
  visited: Set<string>,
  nextStep: GridPoint,
  nextKey: string,
  pointsMatch: (left: GridPoint | null | undefined, right: GridPoint | null | undefined) => boolean,
): void => {
  const backtrackNode = path[path.length - 2];
  if (pointsMatch(backtrackNode, nextStep)) {
    const removedTail = path[path.length - 1];
    path.pop();
    removeVisitedSimulationPoint(visited, removedTail);
    return;
  }
  path.push({ r: nextStep.r, c: nextStep.c });
  visited.add(nextKey);
};

export const applyPathStepToSimulation = ({
  snapshot,
  side,
  nextStep,
  pointsMatch,
}: {
  snapshot: PathDragSimulationSnapshot | null | undefined;
  side: 'start' | 'end';
  nextStep: GridPoint | null | undefined;
  pointsMatch: (left: GridPoint | null | undefined, right: GridPoint | null | undefined) => boolean;
}): void => {
  if (!snapshot || !nextStep) return;
  const nextKey = `${nextStep.r},${nextStep.c}`;
  const nextVisited = snapshot.visited;
  const nextPath = snapshot.path;

  if (nextPath.length === 0) {
    nextPath.push({ r: nextStep.r, c: nextStep.c });
    nextVisited.add(nextKey);
    return;
  }
  if (side === 'start') {
    applyPathStepToSimulationStart(nextPath, nextVisited, nextStep, nextKey, pointsMatch);
    return;
  }
  applyPathStepToSimulationEnd(nextPath, nextVisited, nextStep, nextKey, pointsMatch);
};

export const queuePathDragSteps = ({
  snapshot,
  side,
  pointerContext,
  chooseStep,
  isUsableCell,
  isAdjacentMove,
  pointsMatch,
}: {
  snapshot: GameSnapshot | null | undefined;
  side: 'start' | 'end';
  pointerContext: PathPointerContext;
  chooseStep: ChoosePathDragStep;
  isUsableCell: (snapshot: PathDragSimulationSnapshot, r: number, c: number) => boolean;
  isAdjacentMove: (
    snapshot: PathDragSimulationSnapshot,
    a: GridPoint,
    b: GridPoint,
  ) => boolean;
  pointsMatch: (left: GridPoint | null | undefined, right: GridPoint | null | undefined) => boolean;
}): QueuedPathDragStepsResult => {
  const stepSnapshot = createPathDragSimulation(snapshot);
  if (!stepSnapshot) {
    return {
      steps: [],
      moved: false,
      lastCursorKey: null,
    };
  }

  let stepCount = 0;
  const maxStepCount = Math.max(1, (stepSnapshot.rows * stepSnapshot.cols) + 1);
  const queuedSteps: GridPoint[] = [];
  let moved = false;
  let lastCursorKey: string | null = null;

  while (stepCount < maxStepCount) {
    const headNode = side === 'start'
      ? stepSnapshot.path[0]
      : stepSnapshot.path[stepSnapshot.path.length - 1];
    const backtrackNode = side === 'start'
      ? stepSnapshot.path[1]
      : stepSnapshot.path[stepSnapshot.path.length - 2];
    if (!headNode) break;

    const nextStep = chooseStep({
      snapshot: stepSnapshot,
      headNode,
      backtrackNode,
      pointer: { x: pointerContext.px, y: pointerContext.py },
      pointerCell: pointerContext.pointerCell,
      isUsableCell,
      isAdjacentMove,
      cellCenter: pointerContext.cellCenter,
      cellSize: pointerContext.cellSize,
    });
    if (!nextStep) break;

    moved = true;
    lastCursorKey = `${nextStep.r},${nextStep.c}`;
    queuedSteps.push({ r: nextStep.r, c: nextStep.c });
    stepCount += 1;
    applyPathStepToSimulation({
      snapshot: stepSnapshot,
      side,
      nextStep,
      pointsMatch,
    });

    const nextHeadNode = side === 'start'
      ? stepSnapshot.path[0]
      : stepSnapshot.path[stepSnapshot.path.length - 1];
    if (
      !nextHeadNode
      || pointsMatch(nextHeadNode, headNode)
      || pointsMatch(nextHeadNode, pointerContext.pointerCell)
    ) {
      break;
    }
  }

  return {
    steps: queuedSteps,
    moved,
    lastCursorKey,
  };
};

export const readPathDragPointerContext = ({
  snapshot,
  pointerClientX,
  pointerClientY,
  metrics,
  gridEl,
  snapPathCellFromPoint,
  getCellSize,
  cellCenter,
}: ReadPathDragPointerContextOptions): PathPointerContext => {
  const rect = metrics
    ? null
    : gridEl?.getBoundingClientRect();

  return {
    px: metrics ? (pointerClientX - metrics.left) : (pointerClientX - (rect?.left ?? 0)),
    py: metrics ? (pointerClientY - metrics.top) : (pointerClientY - (rect?.top ?? 0)),
    pointerCell: snapPathCellFromPoint(pointerClientX, pointerClientY, snapshot, metrics),
    cellSize: metrics?.size ?? getCellSize(gridEl),
    cellCenter: metrics
      ? ((r, c) => ({
        x: metrics.pad + (c * metrics.step) + (metrics.size * 0.5),
        y: metrics.pad + (r * metrics.step) + (metrics.size * 0.5),
      }))
      : ((r, c) => cellCenter(r, c, gridEl)),
  };
};
