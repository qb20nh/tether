import type {
  GameSnapshot,
  GridPoint,
} from '../contracts/ports.ts';

const STITCH_BRIDGE_MIN_HALF_LEN_PX = 2;
const STITCH_BRIDGE_HALF_LEN_CELL_RATIO = 0.18;
const STITCH_BRIDGE_MIN_RADIUS_PX = 1;
const STITCH_BRIDGE_MIN_WIDTH_PX = 1;
const STITCH_BRIDGE_WIDTH_CELL_RATIO = 0.06;
const DEFAULT_CELL_SIZE_PX = 56;
const EPSILON = 1e-6;
const NEIGHBOR_OFFSETS: readonly [number, number][] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

interface PointerPoint {
  x: number;
  y: number;
}

interface PathDragCandidate extends GridPoint {
  isBacktrack: boolean;
}

interface SlipperyPathDragCandidate extends PathDragCandidate {
  center: PointerPoint;
  distance: number;
  dr: number;
  dc: number;
  isDiagonal: boolean;
  isPointerCell: boolean;
}

interface StitchBridgeSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface StitchBridgeDecision {
  shouldHold: boolean;
  step: GridPoint | null;
}

type PointerInteractionSnapshot = Pick<GameSnapshot, 'rows' | 'cols' | 'gridData' | 'visited'> & {
  stitchSet?: GameSnapshot['stitchSet'];
};

type CellPredicate = (snapshot: PointerInteractionSnapshot, r: number, c: number) => boolean;
type AdjacentMovePredicate = (
  snapshot: PointerInteractionSnapshot,
  from: GridPoint,
  to: GridPoint,
) => boolean;
type CellCenterResolver = (r: number, c: number) => PointerPoint;
type VisitedCellPredicate = (r: number, c: number) => boolean;

interface BuildReachableCandidateArgs {
  snapshot: PointerInteractionSnapshot;
  headNode: GridPoint;
  backtrackNode?: GridPoint | null;
  isUsableCell: CellPredicate;
  isAdjacentMove: AdjacentMovePredicate;
  isVisitedCell: VisitedCellPredicate;
  r: number;
  c: number;
}

interface BuildSlipperyCandidateArgs extends BuildReachableCandidateArgs {
  pointer: PointerPoint;
  pointerCell?: GridPoint | null;
  cellCenter: CellCenterResolver;
  dr: number;
  dc: number;
}

interface ResolveStitchBridgeMetrics {
  halfLen: number;
  symbolRadius: number;
}

interface ResolveStitchBridgeDecisionArgs {
  snapshot: PointerInteractionSnapshot;
  headNode: GridPoint;
  headCenter: PointerPoint;
  candidate: SlipperyPathDragCandidate;
  bridgePointer: PointerPoint;
  halfLen: number;
  symbolRadius: number;
}

interface BuildPathDragCandidatesArgs {
  snapshot?: PointerInteractionSnapshot | null;
  headNode?: GridPoint | null;
  backtrackNode?: GridPoint | null;
  isUsableCell: CellPredicate;
  isAdjacentMove: AdjacentMovePredicate;
}

interface ChoosePathDragCellArgs {
  headNode?: GridPoint | null;
  candidates?: readonly PathDragCandidate[] | null;
  pointer: PointerPoint;
  holdCell?: GridPoint | null;
  cellCenter: CellCenterResolver;
  size: number;
}

interface ChooseSlipperyPathDragStepArgs {
  snapshot?: PointerInteractionSnapshot | null;
  headNode?: GridPoint | null;
  backtrackNode?: GridPoint | null;
  pointer?: PointerPoint | null;
  rawPointer?: PointerPoint | null;
  pointerCell?: GridPoint | null;
  isUsableCell: CellPredicate;
  isAdjacentMove: AdjacentMovePredicate;
  cellCenter: CellCenterResolver;
  cellSize?: number | null;
}

const sameCell = (a?: GridPoint | null, b?: GridPoint | null): boolean =>
  Boolean(a && b && a.r === b.r && a.c === b.c);

const isInBounds = (snapshot: PointerInteractionSnapshot, r: number, c: number): boolean =>
  r >= 0 && r < snapshot.rows && c >= 0 && c < snapshot.cols;

const isBacktrackCell = (backtrackNode: GridPoint | null | undefined, r: number, c: number): boolean =>
  Boolean(backtrackNode && r === backtrackNode.r && c === backtrackNode.c);

const resolveCellSize = (cellSize: unknown): number => {
  const value = Number(cellSize);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_CELL_SIZE_PX;
};

const buildReachableCandidate = ({
  snapshot,
  headNode,
  backtrackNode,
  isUsableCell,
  isAdjacentMove,
  isVisitedCell,
  r,
  c,
}: BuildReachableCandidateArgs): PathDragCandidate | null => {
  const candidate = { r, c };
  if (!isAdjacentMove(snapshot, headNode, candidate)) return null;
  if (!isUsableCell(snapshot, r, c)) return null;

  const isBacktrack = isBacktrackCell(backtrackNode, r, c);
  if (!isBacktrack && isVisitedCell(r, c)) return null;
  return { ...candidate, isBacktrack };
};

const buildSlipperyCandidate = ({
  snapshot,
  headNode,
  backtrackNode,
  pointer,
  pointerCell,
  isUsableCell,
  isAdjacentMove,
  isVisitedCell,
  cellCenter,
  r,
  c,
  dr,
  dc,
}: BuildSlipperyCandidateArgs): SlipperyPathDragCandidate | null => {
  const candidate = buildReachableCandidate({
    snapshot,
    headNode,
    backtrackNode,
    isUsableCell,
    isAdjacentMove,
    isVisitedCell,
    r,
    c,
  });
  if (!candidate) return null;

  const center = cellCenter(r, c);
  return {
    ...candidate,
    center,
    distance: Math.hypot(pointer.x - center.x, pointer.y - center.y),
    dr,
    dc,
    isDiagonal: Math.abs(dr) === 1 && Math.abs(dc) === 1,
    isPointerCell: sameCell(pointerCell, candidate),
  };
};

const resolveStitchBridgeMetrics = (cellSize: unknown): ResolveStitchBridgeMetrics => {
  const resolvedCellSize = resolveCellSize(cellSize);
  const halfLen = Math.max(
    STITCH_BRIDGE_MIN_HALF_LEN_PX,
    resolvedCellSize * STITCH_BRIDGE_HALF_LEN_CELL_RATIO,
  );
  const symbolStrokeWidth = Math.max(
    STITCH_BRIDGE_MIN_WIDTH_PX,
    resolvedCellSize * STITCH_BRIDGE_WIDTH_CELL_RATIO,
  );
  return {
    halfLen,
    symbolRadius: Math.max(
      STITCH_BRIDGE_MIN_RADIUS_PX,
      (halfLen * Math.SQRT2) + (symbolStrokeWidth * 0.5),
    ),
  };
};

const resolveBridgePointer = (
  rawPointer: PointerPoint | null | undefined,
  pointer: PointerPoint,
): PointerPoint => {
  if (Number.isFinite(rawPointer?.x) && Number.isFinite(rawPointer?.y) && rawPointer) {
    return rawPointer;
  }
  return pointer;
};

const stitchKeyFor = (a: GridPoint, b: GridPoint): string =>
  `${Math.max(a.r, b.r)},${Math.max(a.c, b.c)}`;

const hasStitchedDiagonal = (
  snapshot: PointerInteractionSnapshot,
  headNode: GridPoint,
  candidate: SlipperyPathDragCandidate,
): boolean => Boolean(
  candidate.isDiagonal
    && snapshot.stitchSet?.size
    && snapshot.stitchSet.has(stitchKeyFor(headNode, candidate)),
);

const buildBridgeSegment = (center: PointerPoint, halfLen: number, usesDiagA: boolean): StitchBridgeSegment => ({
  startX: usesDiagA ? (center.x + halfLen) : (center.x - halfLen),
  startY: center.y - halfLen,
  endX: usesDiagA ? (center.x - halfLen) : (center.x + halfLen),
  endY: center.y + halfLen,
});

const pointSideOfBridge = (point: PointerPoint, segment: StitchBridgeSegment): number => (
  (point.x - segment.startX) * (segment.endY - segment.startY)
  - (point.y - segment.startY) * (segment.endX - segment.startX)
);

const resolveStitchBridgeDecision = ({
  snapshot,
  headNode,
  headCenter,
  candidate,
  bridgePointer,
  halfLen,
  symbolRadius,
}: ResolveStitchBridgeDecisionArgs): StitchBridgeDecision | null => {
  if (!hasStitchedDiagonal(snapshot, headNode, candidate)) return null;

  const bridgeCenter = {
    x: (headCenter.x + candidate.center.x) * 0.5,
    y: (headCenter.y + candidate.center.y) * 0.5,
  };
  if (Math.hypot(bridgePointer.x - bridgeCenter.x, bridgePointer.y - bridgeCenter.y) > symbolRadius) {
    return null;
  }

  const segment = buildBridgeSegment(bridgeCenter, halfLen, candidate.dr === candidate.dc);
  const headSide = pointSideOfBridge(headCenter, segment);
  if (Math.abs(headSide) <= EPSILON) return { shouldHold: true, step: null };

  const pointerSide = pointSideOfBridge(bridgePointer, segment);
  if ((headSide * pointerSide) <= 0) {
    return { shouldHold: true, step: { r: candidate.r, c: candidate.c } };
  }
  return { shouldHold: true, step: null };
};

const shouldPreferCandidate = (
  candidate: SlipperyPathDragCandidate,
  bestCandidate: SlipperyPathDragCandidate | null,
): boolean => {
  if (!bestCandidate) return true;
  if (candidate.distance < bestCandidate.distance - EPSILON) return true;

  const equalDistance = Math.abs(candidate.distance - bestCandidate.distance) <= EPSILON;
  return equalDistance && candidate.isPointerCell && !bestCandidate.isPointerCell;
};

const shouldAdvanceFromHold = (
  bestCandidate: SlipperyPathDragCandidate | null,
  holdDistance: number,
  holdIsPointerCell: boolean,
): boolean => {
  if (!bestCandidate) return false;
  if (bestCandidate.distance < holdDistance - EPSILON) return true;

  const equalDistance = Math.abs(bestCandidate.distance - holdDistance) <= EPSILON;
  return equalDistance && bestCandidate.isPointerCell && !holdIsPointerCell;
};

export function buildPathDragCandidates({
  snapshot,
  headNode,
  backtrackNode,
  isUsableCell,
  isAdjacentMove,
}: BuildPathDragCandidatesArgs): PathDragCandidate[] {
  if (!snapshot || !headNode) return [];

  const candidates: PathDragCandidate[] = [];
  for (const [dr, dc] of NEIGHBOR_OFFSETS) {
    const nr = headNode.r + dr;
    const nc = headNode.c + dc;
    if (!isInBounds(snapshot, nr, nc)) continue;

    const candidate = buildReachableCandidate({
      snapshot,
      headNode,
      backtrackNode,
      isUsableCell,
      isAdjacentMove,
      isVisitedCell: (r, c) => snapshot.visited.has(`${r},${c}`),
      r: nr,
      c: nc,
    });
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

export function choosePathDragCell({
  headNode,
  candidates,
  pointer,
  holdCell,
  cellCenter,
  size,
}: ChoosePathDragCellArgs): GridPoint | null {
  if (!headNode || !holdCell || !Array.isArray(candidates) || candidates.length === 0) {
    return holdCell || null;
  }

  const holdCenter = cellCenter(holdCell.r, holdCell.c);
  const holdDist = Math.hypot(pointer.x - holdCenter.x, pointer.y - holdCenter.y);

  let bestMoveCell: PathDragCandidate | null = null;
  let bestMoveDist = Infinity;

  for (const cand of candidates) {
    const center = cellCenter(cand.r, cand.c);
    let dist = Math.hypot(pointer.x - center.x, pointer.y - center.y);

    const isDiag = Math.abs(cand.r - headNode.r) === 1 && Math.abs(cand.c - headNode.c) === 1;
    if (isDiag) dist -= size * 0.18;

    if (dist < bestMoveDist) {
      bestMoveDist = dist;
      bestMoveCell = cand;
    }
  }

  if (!bestMoveCell) return holdCell;

  const hysteresis = bestMoveCell.isBacktrack ? size * 0.24 : size * 0.12;
  return bestMoveDist + hysteresis < holdDist
    ? { r: bestMoveCell.r, c: bestMoveCell.c }
    : holdCell;
}

export function chooseSlipperyPathDragStep({
  snapshot,
  headNode,
  backtrackNode,
  pointer,
  rawPointer,
  pointerCell,
  isUsableCell,
  isAdjacentMove,
  cellCenter,
  cellSize,
}: ChooseSlipperyPathDragStepArgs): GridPoint | null {
  if (!snapshot || !headNode || !pointer) return null;

  const headCenter = cellCenter(headNode.r, headNode.c);
  const holdDistance = Math.hypot(pointer.x - headCenter.x, pointer.y - headCenter.y);
  const holdIsPointerCell = sameCell(pointerCell, headNode);
  const { halfLen, symbolRadius } = resolveStitchBridgeMetrics(cellSize);
  const bridgePointer = resolveBridgePointer(rawPointer, pointer);
  let shouldHold = false;
  let bestCandidate: SlipperyPathDragCandidate | null = null;

  for (const [dr, dc] of NEIGHBOR_OFFSETS) {
    const nr = headNode.r + dr;
    const nc = headNode.c + dc;
    if (!isInBounds(snapshot, nr, nc)) continue;

    const candidate = buildSlipperyCandidate({
      snapshot,
      headNode,
      backtrackNode,
      pointer,
      pointerCell,
      isUsableCell,
      isAdjacentMove,
      isVisitedCell: (r, c) => snapshot.visited.has(`${r},${c}`),
      cellCenter,
      r: nr,
      c: nc,
      dr,
      dc,
    });
    if (!candidate) continue;

    const bridgeDecision = resolveStitchBridgeDecision({
      snapshot,
      headNode,
      headCenter,
      candidate,
      bridgePointer,
      halfLen,
      symbolRadius,
    });
    if (bridgeDecision) {
      shouldHold = bridgeDecision.shouldHold;
      if (bridgeDecision.step) return bridgeDecision.step;
    }

    if (shouldPreferCandidate(candidate, bestCandidate)) {
      bestCandidate = candidate;
    }
  }

  if (shouldHold || !shouldAdvanceFromHold(bestCandidate, holdDistance, holdIsPointerCell)) {
    return null;
  }
  if (!bestCandidate) return null;
  return { r: bestCandidate.r, c: bestCandidate.c };
}
