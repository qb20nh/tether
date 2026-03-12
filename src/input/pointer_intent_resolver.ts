// @ts-nocheck
const STITCH_BRIDGE_MIN_HALF_LEN_PX = 2;
const STITCH_BRIDGE_HALF_LEN_CELL_RATIO = 0.18;
const STITCH_BRIDGE_MIN_RADIUS_PX = 1;
const STITCH_BRIDGE_MIN_WIDTH_PX = 1;
const STITCH_BRIDGE_WIDTH_CELL_RATIO = 0.06;
const DEFAULT_CELL_SIZE_PX = 56;
const EPSILON = 1e-6;
const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const sameCell = (a, b) =>
  Boolean(a && b && a.r === b.r && a.c === b.c);

const isInBounds = (snapshot, r, c) =>
  r >= 0 && r < snapshot.rows && c >= 0 && c < snapshot.cols;

const isBacktrackCell = (backtrackNode, r, c) =>
  Boolean(backtrackNode) && r === backtrackNode.r && c === backtrackNode.c;

const resolveCellSize = (cellSize) => {
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
}) => {
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
}) => {
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

const resolveStitchBridgeMetrics = (cellSize) => {
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

const resolveBridgePointer = (rawPointer, pointer) => (
  Number.isFinite(rawPointer?.x) && Number.isFinite(rawPointer?.y)
    ? rawPointer
    : pointer
);

const stitchKeyFor = (a, b) =>
  `${Math.max(a.r, b.r)},${Math.max(a.c, b.c)}`;

const hasStitchedDiagonal = (snapshot, headNode, candidate) =>
  Boolean(
    candidate.isDiagonal
      && snapshot?.stitchSet?.size > 0
      && snapshot.stitchSet.has(stitchKeyFor(headNode, candidate)),
  );

const buildBridgeSegment = (center, halfLen, usesDiagA) => ({
  startX: usesDiagA ? (center.x + halfLen) : (center.x - halfLen),
  startY: center.y - halfLen,
  endX: usesDiagA ? (center.x - halfLen) : (center.x + halfLen),
  endY: center.y + halfLen,
});

const pointSideOfBridge = (point, segment) => (
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
}) => {
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

const shouldPreferCandidate = (candidate, bestCandidate) => {
  if (!bestCandidate) return true;
  if (candidate.distance < bestCandidate.distance - EPSILON) return true;

  const equalDistance = Math.abs(candidate.distance - bestCandidate.distance) <= EPSILON;
  return equalDistance && candidate.isPointerCell && !bestCandidate.isPointerCell;
};

const shouldAdvanceFromHold = (bestCandidate, holdDistance, holdIsPointerCell) => {
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
}) {
  if (!snapshot || !headNode) return [];

  const candidates = [];
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
}) {
  if (!headNode || !holdCell || !Array.isArray(candidates) || candidates.length === 0) {
    return holdCell;
  }

  const holdCenter = cellCenter(holdCell.r, holdCell.c);
  const holdDist = Math.hypot(pointer.x - holdCenter.x, pointer.y - holdCenter.y);

  let bestMoveCell = null;
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
}) {
  if (!snapshot || !headNode || !pointer || typeof cellCenter !== 'function') return null;

  const headCenter = cellCenter(headNode.r, headNode.c);
  const holdDistance = Math.hypot(pointer.x - headCenter.x, pointer.y - headCenter.y);
  const holdIsPointerCell = sameCell(pointerCell, headNode);
  const { halfLen, symbolRadius } = resolveStitchBridgeMetrics(cellSize);
  const bridgePointer = resolveBridgePointer(rawPointer, pointer);
  let shouldHold = false;
  let bestCandidate = null;

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
      isVisitedCell: (r, c) => Boolean(snapshot.visited?.has?.(`${r},${c}`)),
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
  return { r: bestCandidate.r, c: bestCandidate.c };
}
