const SAMPLE_WINDOW = 8;
const EMA_ALPHA = 0.35;
const MIN_LOOKAHEAD_MS = 6;
const MAX_LOOKAHEAD_MS = 34;
const ERROR_SCALE_CELLS = 0.75;
const DEFAULT_FRAME_INTERVAL_MS = 16.67;
const MIN_FRAME_INTERVAL_MS = 8;
const MAX_FRAME_INTERVAL_MS = 50;
const MIN_PROJECT_DISTANCE_CELLS = 0.5;
const BASE_PROJECT_DISTANCE_CELLS = 0.75;
const MAX_PROJECT_DISTANCE_CELLS = 1.15;
const MIN_SPEED_PX_PER_MS = 0.02;
const MAX_SEGMENT_DT_MS = 120;
const MIN_INPUT_INTERVAL_MS = 4;
const MAX_INPUT_INTERVAL_MS = 90;
const STALE_SAMPLE_MAX_AGE_MS = 96;
const STITCH_BRIDGE_MIN_HALF_LEN_PX = 2;
const STITCH_BRIDGE_HALF_LEN_CELL_RATIO = 0.18;
const STITCH_BRIDGE_MIN_RADIUS_PX = 1;
const STITCH_BRIDGE_MIN_WIDTH_PX = 1;
const STITCH_BRIDGE_WIDTH_CELL_RATIO = 0.06;
const RAW_POINTER_GUARD_MIN_EPSILON_PX = 1;
const RAW_POINTER_GUARD_CELL_EPSILON_RATIO = 0.03;
const RAW_POINTER_LEAD_SCALE = 1.25;
const RAW_POINTER_LEAD_MAX_CELL_RATIO = 0.55;
const RAW_POINTER_DIRECTION_MIN_COS = 0.10;
const RAW_POINTER_DIRECTION_MIN_DISTANCE_CELL_RATIO = 0.08;
const DEFAULT_CELL_SIZE_PX = 56;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

const safePoint = (point) => ({
  x: Number.isFinite(point?.x) ? point.x : 0,
  y: Number.isFinite(point?.y) ? point.y : 0,
});

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

const resolveFrameIntervalMs = (frameIntervalMs) => {
  const value = Number(frameIntervalMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_FRAME_INTERVAL_MS;
  return clamp(value, MIN_FRAME_INTERVAL_MS, MAX_FRAME_INTERVAL_MS);
};

const resolveInputIntervalMs = (samples) => {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) {
    const dt = Number(samples[i].t) - Number(samples[i - 1].t);
    if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_SEGMENT_DT_MS) continue;
    deltas.push(dt);
  }
  if (deltas.length <= 0) return null;

  const sorted = deltas.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!Number.isFinite(median) || median <= 0) return null;
  return clamp(median, MIN_INPUT_INTERVAL_MS, MAX_INPUT_INTERVAL_MS);
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

export function predictPathDragPointer({
  samples,
  cellSize,
  prevEmaErrorPx,
  prevPredictedClient,
  frameIntervalMs,
  nowMs,
}) {
  const safeSamples = Array.isArray(samples)
    ? samples.slice(Math.max(0, samples.length - SAMPLE_WINDOW))
    : [];
  const current = safePoint(safeSamples[safeSamples.length - 1]);

  let nextEmaErrorPx = Number.isFinite(prevEmaErrorPx) ? Math.max(0, prevEmaErrorPx) : 0;
  const prevPredicted = Number.isFinite(prevPredictedClient?.x) && Number.isFinite(prevPredictedClient?.y)
    ? prevPredictedClient
    : null;
  if (prevPredicted) {
    const errorPx = Math.hypot(current.x - prevPredicted.x, current.y - prevPredicted.y);
    nextEmaErrorPx = (nextEmaErrorPx * (1 - EMA_ALPHA)) + (errorPx * EMA_ALPHA);
  }

  const resolvedNowMs = Number(nowMs);
  const currentSampleTs = Number(safeSamples[safeSamples.length - 1]?.t);
  if (Number.isFinite(resolvedNowMs) && Number.isFinite(currentSampleTs)) {
    const ageMs = resolvedNowMs - currentSampleTs;
    if (Number.isFinite(ageMs) && ageMs > STALE_SAMPLE_MAX_AGE_MS) {
      return {
        effectiveClient: current,
        nextEmaErrorPx,
        nextPredictedClient: null,
      };
    }
  }

  if (safeSamples.length < 2) {
    return {
      effectiveClient: current,
      nextEmaErrorPx,
      nextPredictedClient: null,
    };
  }

  let weightedVx = 0;
  let weightedVy = 0;
  let totalWeight = 0;
  let segmentWeight = 1;

  for (let i = 1; i < safeSamples.length; i++) {
    const prev = safeSamples[i - 1];
    const next = safeSamples[i];
    const dt = Number(next.t) - Number(prev.t);
    if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_SEGMENT_DT_MS) continue;

    const vx = (Number(next.x) - Number(prev.x)) / dt;
    const vy = (Number(next.y) - Number(prev.y)) / dt;
    weightedVx += vx * segmentWeight;
    weightedVy += vy * segmentWeight;
    totalWeight += segmentWeight;
    segmentWeight += 1;
  }

  if (!(totalWeight > 0)) {
    return {
      effectiveClient: current,
      nextEmaErrorPx,
      nextPredictedClient: null,
    };
  }

  const vx = weightedVx / totalWeight;
  const vy = weightedVy / totalWeight;
  const speed = Math.hypot(vx, vy);
  if (speed < MIN_SPEED_PX_PER_MS) {
    return {
      effectiveClient: current,
      nextEmaErrorPx,
      nextPredictedClient: current,
    };
  }

  const resolvedCellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
  const resolvedFrameIntervalMs = resolveFrameIntervalMs(frameIntervalMs);
  const inputIntervalMs = resolveInputIntervalMs(safeSamples);
  const cadenceIntervalMs = inputIntervalMs === null
    ? resolvedFrameIntervalMs
    : clamp(
      (inputIntervalMs * 0.65) + (resolvedFrameIntervalMs * 0.35),
      MIN_LOOKAHEAD_MS,
      MAX_LOOKAHEAD_MS,
    );

  const errorDenominator = resolvedCellSize * ERROR_SCALE_CELLS;
  const errorRatio = clamp(nextEmaErrorPx / errorDenominator, 0, 1);
  const lookaheadMs = clamp(
    cadenceIntervalMs * (1 - (0.65 * errorRatio)),
    MIN_LOOKAHEAD_MS,
    MAX_LOOKAHEAD_MS,
  );

  let projectDx = vx * lookaheadMs;
  let projectDy = vy * lookaheadMs;
  const projectionCapCells = clamp(
    BASE_PROJECT_DISTANCE_CELLS * clamp(cadenceIntervalMs / DEFAULT_FRAME_INTERVAL_MS, 0.75, 1.5),
    MIN_PROJECT_DISTANCE_CELLS,
    MAX_PROJECT_DISTANCE_CELLS,
  );
  const projectionCap = resolvedCellSize * projectionCapCells;
  const projectionDist = Math.hypot(projectDx, projectDy);
  if (projectionDist > projectionCap && projectionCap > 0) {
    const scale = projectionCap / projectionDist;
    projectDx *= scale;
    projectDy *= scale;
  }

  const projected = {
    x: current.x + projectDx,
    y: current.y + projectDy,
  };
  const strength = 1 - errorRatio;
  const effectiveClient = {
    x: current.x + ((projected.x - current.x) * strength),
    y: current.y + ((projected.y - current.y) * strength),
  };

  return {
    effectiveClient,
    nextEmaErrorPx,
    nextPredictedClient: projected,
  };
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

  const candidates = buildPathDragCandidates({
    snapshot,
    headNode,
    backtrackNode,
    isUsableCell,
    isAdjacentMove,
  });

  const headCenter = cellCenter(headNode.r, headNode.c);
  const resolvedRawPointer = (
    Number.isFinite(rawPointer?.x) && Number.isFinite(rawPointer?.y)
      ? rawPointer
      : pointer
  );
  const stitchBridgeCrossingStep = resolveStitchBridgeCrossingStep({
    snapshot,
    headNode,
    headCenter,
    candidates,
    pointer,
    rawPointer: resolvedRawPointer,
    cellCenter,
    cellSize,
  });
  if (stitchBridgeCrossingStep?.step) {
    return stitchBridgeCrossingStep.step;
  }
  if (stitchBridgeCrossingStep?.hold) {
    return null;
  }

  const resolvedCellSize = resolveCellSize(cellSize);
  const rawGuardEpsilon = Math.max(
    RAW_POINTER_GUARD_MIN_EPSILON_PX,
    resolvedCellSize * RAW_POINTER_GUARD_CELL_EPSILON_RATIO,
  );
  const predictedLeadDistance = Math.hypot(
    pointer.x - resolvedRawPointer.x,
    pointer.y - resolvedRawPointer.y,
  );
  const rawLeadAllowance = clamp(
    predictedLeadDistance * RAW_POINTER_LEAD_SCALE,
    0,
    resolvedCellSize * RAW_POINTER_LEAD_MAX_CELL_RATIO,
  );
  const rawHoldDistance = Math.hypot(
    resolvedRawPointer.x - headCenter.x,
    resolvedRawPointer.y - headCenter.y,
  );
  const rawIntentX = resolvedRawPointer.x - headCenter.x;
  const rawIntentY = resolvedRawPointer.y - headCenter.y;
  const rawIntentLength = Math.hypot(rawIntentX, rawIntentY);
  const shouldCheckRawDirection = rawIntentLength > (
    resolvedCellSize * RAW_POINTER_DIRECTION_MIN_DISTANCE_CELL_RATIO
  );

  const holdDistance = Math.hypot(pointer.x - headCenter.x, pointer.y - headCenter.y);
  const holdIsPointerCell = sameCell(pointerCell, headNode);
  const rankedCandidates = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const center = cellCenter(candidate.r, candidate.c);
    const predictedDistance = Math.hypot(pointer.x - center.x, pointer.y - center.y);
    const rawDistance = Math.hypot(resolvedRawPointer.x - center.x, resolvedRawPointer.y - center.y);
    const isPointerCell = sameCell(pointerCell, candidate);
    const candidateVecX = center.x - headCenter.x;
    const candidateVecY = center.y - headCenter.y;
    const candidateVecLength = Math.hypot(candidateVecX, candidateVecY);
    const rawDirectionCos = (
      shouldCheckRawDirection
      && candidateVecLength > 0
    )
      ? ((candidateVecX * rawIntentX) + (candidateVecY * rawIntentY))
        / (candidateVecLength * rawIntentLength)
      : 1;
    rankedCandidates.push({
      candidate,
      predictedDistance,
      rawDistance,
      isPointerCell,
      rawDirectionCos,
    });
  }

  rankedCandidates.sort((a, b) => {
    if (Math.abs(a.predictedDistance - b.predictedDistance) > 1e-6) {
      return a.predictedDistance - b.predictedDistance;
    }
    if (a.isPointerCell !== b.isPointerCell) {
      return a.isPointerCell ? -1 : 1;
    }
    return 0;
  });

  for (let i = 0; i < rankedCandidates.length; i += 1) {
    const ranked = rankedCandidates[i];
    const predictedEqualToHold = Math.abs(ranked.predictedDistance - holdDistance) <= 1e-6;
    const predictedImproves = ranked.predictedDistance < holdDistance - 1e-6
      || (predictedEqualToHold && ranked.isPointerCell && !holdIsPointerCell);
    if (!predictedImproves) continue;
    if (ranked.rawDirectionCos < RAW_POINTER_DIRECTION_MIN_COS) continue;
    if (ranked.rawDistance > rawHoldDistance + rawGuardEpsilon + rawLeadAllowance) continue;
    return { r: ranked.candidate.r, c: ranked.candidate.c };
  }

  return null;
}
