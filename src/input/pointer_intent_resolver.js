const STITCH_BRIDGE_MIN_HALF_LEN_PX = 2;
const STITCH_BRIDGE_HALF_LEN_CELL_RATIO = 0.18;
const STITCH_BRIDGE_MIN_RADIUS_PX = 1;
const STITCH_BRIDGE_MIN_WIDTH_PX = 1;
const STITCH_BRIDGE_WIDTH_CELL_RATIO = 0.06;
const DEFAULT_CELL_SIZE_PX = 56;

const isDiagonalNeighbor = (a, b) =>
  Math.abs((a?.r ?? 0) - (b?.r ?? 0)) === 1 && Math.abs((a?.c ?? 0) - (b?.c ?? 0)) === 1;

const sameCell = (a, b) =>
  Boolean(a && b && a.r === b.r && a.c === b.c);

const pointSideOfLine = (point, a, b) => (
  ((Number(point?.x) || 0) - (Number(a?.x) || 0)) * ((Number(b?.y) || 0) - (Number(a?.y) || 0))
  - ((Number(point?.y) || 0) - (Number(a?.y) || 0)) * ((Number(b?.x) || 0) - (Number(a?.x) || 0))
);

const resolveCellSize = (cellSize) => {
  const value = Number(cellSize);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_CELL_SIZE_PX;
};

const resolveStitchBridgeCrossingStep = ({
  snapshot,
  headNode,
  headCenter,
  candidates,
  pointer,
  rawPointer,
  cellCenter,
  cellSize,
}) => {
  if (!snapshot?.stitchSet || !headNode || !headCenter || !pointer) return null;
  if (!Array.isArray(candidates) || candidates.length <= 0) return null;

  const resolvedCellSize = resolveCellSize(cellSize);
  const halfLen = Math.max(STITCH_BRIDGE_MIN_HALF_LEN_PX, resolvedCellSize * STITCH_BRIDGE_HALF_LEN_CELL_RATIO);
  const symbolStrokeWidth = Math.max(STITCH_BRIDGE_MIN_WIDTH_PX, resolvedCellSize * STITCH_BRIDGE_WIDTH_CELL_RATIO);
  const symbolRadius = Math.max(
    STITCH_BRIDGE_MIN_RADIUS_PX,
    (halfLen * Math.SQRT2) + (symbolStrokeWidth * 0.5),
  );
  const bridgePointer = (
    Number.isFinite(rawPointer?.x) && Number.isFinite(rawPointer?.y)
      ? rawPointer
      : pointer
  );
  let shouldHold = false;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!isDiagonalNeighbor(headNode, candidate)) continue;

    const stitchKey = `${Math.max(headNode.r, candidate.r)},${Math.max(headNode.c, candidate.c)}`;
    if (!snapshot.stitchSet.has(stitchKey)) continue;

    const candidateCenter = cellCenter(candidate.r, candidate.c);
    const centerX = (headCenter.x + candidateCenter.x) * 0.5;
    const centerY = (headCenter.y + candidateCenter.y) * 0.5;
    const diagAStart = { x: centerX - halfLen, y: centerY - halfLen };
    const diagAEnd = { x: centerX + halfLen, y: centerY + halfLen };
    const diagBStart = { x: centerX + halfLen, y: centerY - halfLen };
    const diagBEnd = { x: centerX - halfLen, y: centerY + halfLen };
    if (Math.hypot(bridgePointer.x - centerX, bridgePointer.y - centerY) > symbolRadius) continue;

    shouldHold = true;
    const dr = candidate.r - headNode.r;
    const dc = candidate.c - headNode.c;
    const usesDiagA = dr === dc;
    const bridgeStart = usesDiagA ? diagBStart : diagAStart;
    const bridgeEnd = usesDiagA ? diagBEnd : diagAEnd;

    const headSide = pointSideOfLine(headCenter, bridgeStart, bridgeEnd);
    if (Math.abs(headSide) <= 1e-6) continue;
    const pointerSide = pointSideOfLine(bridgePointer, bridgeStart, bridgeEnd);
    if ((headSide * pointerSide) <= 0) {
      return {
        step: { r: candidate.r, c: candidate.c },
        hold: false,
      };
    }
  }

  return shouldHold ? { step: null, hold: true } : null;
};

const resolveBestMoveCandidate = ({
  candidates,
  pointer,
  pointerCell,
  headNode,
  headCenter,
  cellCenter,
}) => {
  if (!Array.isArray(candidates) || candidates.length <= 0) return null;
  if (!pointer || !headNode || !headCenter || typeof cellCenter !== 'function') return null;

  const holdDistance = Math.hypot(pointer.x - headCenter.x, pointer.y - headCenter.y);
  const holdIsPointerCell = sameCell(pointerCell, headNode);
  const rankedCandidates = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const center = cellCenter(candidate.r, candidate.c);
    rankedCandidates.push({
      candidate,
      center,
      distance: Math.hypot(pointer.x - center.x, pointer.y - center.y),
      isPointerCell: sameCell(pointerCell, candidate),
    });
  }

  rankedCandidates.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) > 1e-6) {
      return a.distance - b.distance;
    }
    if (a.isPointerCell !== b.isPointerCell) {
      return a.isPointerCell ? -1 : 1;
    }
    return 0;
  });

  for (let i = 0; i < rankedCandidates.length; i += 1) {
    const ranked = rankedCandidates[i];
    const equalToHold = Math.abs(ranked.distance - holdDistance) <= 1e-6;
    const improves = ranked.distance < holdDistance - 1e-6
      || (equalToHold && ranked.isPointerCell && !holdIsPointerCell);
    if (!improves) continue;
    return {
      ...ranked,
      holdDistance,
      marginPx: holdDistance - ranked.distance,
    };
  }

  return null;
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
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = headNode.r + dr;
      const nc = headNode.c + dc;
      if (nr < 0 || nr >= snapshot.rows || nc < 0 || nc >= snapshot.cols) continue;

      const cand = { r: nr, c: nc };
      if (!isAdjacentMove(snapshot, headNode, cand)) continue;
      if (!isUsableCell(snapshot, cand.r, cand.c)) continue;

      const isBacktrack = Boolean(backtrackNode)
        && cand.r === backtrackNode.r
        && cand.c === backtrackNode.c;
      const k = `${cand.r},${cand.c}`;
      if (!isBacktrack && snapshot.visited.has(k)) continue;

      candidates.push({ ...cand, isBacktrack });
    }
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
  pointerCell,
  isUsableCell,
  isAdjacentMove,
  cellCenter,
  cellSize,
}) {
  if (!snapshot || !headNode || !pointer || typeof cellCenter !== 'function') return null;

  const candidates = buildPathDragCandidates({
    snapshot,
    headNode,
    backtrackNode,
    isUsableCell,
    isAdjacentMove,
  });

  const headCenter = cellCenter(headNode.r, headNode.c);
  const stitchBridgeCrossingStep = resolveStitchBridgeCrossingStep({
    snapshot,
    headNode,
    headCenter,
    candidates,
    pointer,
    rawPointer: pointer,
    cellCenter,
    cellSize,
  });
  if (stitchBridgeCrossingStep?.step) {
    return stitchBridgeCrossingStep.step;
  }
  if (stitchBridgeCrossingStep?.hold) {
    return null;
  }

  const bestMove = resolveBestMoveCandidate({
    candidates,
    pointer,
    pointerCell,
    headNode,
    headCenter,
    cellCenter,
  });
  if (!bestMove) return null;
  return { r: bestMove.candidate.r, c: bestMove.candidate.c };
}
