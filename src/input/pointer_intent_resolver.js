const SAMPLE_WINDOW = 8;
const EMA_ALPHA = 0.35;
const MIN_LOOKAHEAD_MS = 6;
const MAX_LOOKAHEAD_MS = 34;
const ERROR_SCALE_CELLS = 1.15;
const ERROR_DAMP_WEIGHT = 0.35;
const SPARSE_BONUS_WEIGHT = 0.30;
const LATENCY_BIAS_MS = 2;
const DEFAULT_FRAME_INTERVAL_MS = 16.67;
const MIN_FRAME_INTERVAL_MS = 8;
const MAX_FRAME_INTERVAL_MS = 50;
const MIN_PROJECT_DISTANCE_CELLS = 0.5;
const BASE_PROJECT_DISTANCE_CELLS = 0.75;
const MAX_PROJECT_DISTANCE_CELLS = 1.15;
const MIN_SPEED_PX_PER_MS = 0.02;
const STOP_CONVERGENCE_SPEED_PX_PER_MS = 0.012;
const HEADING_COS_STEADY_MIN = 0.80;
const HEADING_COS_TRANSITION_MIN = 0.40;
const INTENT_FACTOR_STEADY = 1.00;
const INTENT_FACTOR_TRANSITION = 0.85;
const INTENT_FACTOR_TURN = 0.60;
const MAX_SEGMENT_DT_MS = 120;
const MIN_INPUT_INTERVAL_MS = 4;
const MAX_INPUT_INTERVAL_MS = 90;
const STALE_SAMPLE_MAX_AGE_MS = 96;
const STITCH_BRIDGE_MIN_HALF_LEN_PX = 2;
const STITCH_BRIDGE_HALF_LEN_CELL_RATIO = 0.18;
const STITCH_BRIDGE_MIN_RADIUS_PX = 1;
const STITCH_BRIDGE_MIN_WIDTH_PX = 1;
const STITCH_BRIDGE_WIDTH_CELL_RATIO = 0.06;
const RAW_POINTER_DIRECTION_MIN_DISTANCE_CELL_RATIO = 0.08;
const RAW_POINTER_OPPOSITE_DIRECTION_COS = -0.20;
const RAW_OVERRIDE_MARGIN_CELL_RATIO = 0.10;
const RAW_BACKTRACK_OVERRIDE_MARGIN_CELL_RATIO = 0.06;
const DEFAULT_CELL_SIZE_PX = 56;
const MIN_PREDICTION_STRENGTH_LEVEL = 0;
const MAX_PREDICTION_STRENGTH_LEVEL = 3;
const DEFAULT_PREDICTION_STRENGTH_LEVEL = 1;

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

const resolvePredictionStrengthLevel = (predictionStrengthLevel) => {
  const value = Number(predictionStrengthLevel);
  if (!Number.isInteger(value)) return DEFAULT_PREDICTION_STRENGTH_LEVEL;
  return clamp(value, MIN_PREDICTION_STRENGTH_LEVEL, MAX_PREDICTION_STRENGTH_LEVEL);
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

export function predictPathDragPointer({
  samples,
  cellSize,
  prevEmaErrorPx,
  prevPredictedClient,
  frameIntervalMs,
  nowMs,
  predictionStrengthLevel = DEFAULT_PREDICTION_STRENGTH_LEVEL,
}) {
  const safeSamples = Array.isArray(samples)
    ? samples.slice(Math.max(0, samples.length - SAMPLE_WINDOW))
    : [];
  const current = safePoint(safeSamples[safeSamples.length - 1]);
  const resolvedPredictionStrengthLevel = resolvePredictionStrengthLevel(predictionStrengthLevel);

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

  if (resolvedPredictionStrengthLevel <= MIN_PREDICTION_STRENGTH_LEVEL) {
    return {
      effectiveClient: current,
      nextEmaErrorPx,
      nextPredictedClient: null,
    };
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
  let latestSegmentVx = 0;
  let latestSegmentVy = 0;
  let hasLatestSegmentVelocity = false;
  let previousSegmentVx = 0;
  let previousSegmentVy = 0;
  let hasPreviousSegmentVelocity = false;

  for (let i = 1; i < safeSamples.length; i++) {
    const prev = safeSamples[i - 1];
    const next = safeSamples[i];
    const dt = Number(next.t) - Number(prev.t);
    if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_SEGMENT_DT_MS) continue;

    const vx = (Number(next.x) - Number(prev.x)) / dt;
    const vy = (Number(next.y) - Number(prev.y)) / dt;
    if (hasLatestSegmentVelocity) {
      previousSegmentVx = latestSegmentVx;
      previousSegmentVy = latestSegmentVy;
      hasPreviousSegmentVelocity = true;
    }
    latestSegmentVx = vx;
    latestSegmentVy = vy;
    hasLatestSegmentVelocity = true;
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
  const latestVx = hasLatestSegmentVelocity ? latestSegmentVx : vx;
  const latestVy = hasLatestSegmentVelocity ? latestSegmentVy : vy;
  const latestSpeed = Math.hypot(latestVx, latestVy);
  const previousVx = hasPreviousSegmentVelocity ? previousSegmentVx : latestVx;
  const previousVy = hasPreviousSegmentVelocity ? previousSegmentVy : latestVy;
  const previousSpeed = Math.hypot(previousVx, previousVy);
  if (latestSpeed < STOP_CONVERGENCE_SPEED_PX_PER_MS) {
    return {
      effectiveClient: current,
      nextEmaErrorPx,
      nextPredictedClient: current,
    };
  }
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
  const sampleAgeMs = (Number.isFinite(resolvedNowMs) && Number.isFinite(currentSampleTs))
    ? clamp(Math.max(0, resolvedNowMs - currentSampleTs), 0, MAX_LOOKAHEAD_MS)
    : 0;
  const frameLagMs = resolvedFrameIntervalMs;
  const baselineInputIntervalMs = inputIntervalMs === null
    ? frameLagMs
    : inputIntervalMs;
  const sparseBonusMs = Math.max(0, baselineInputIntervalMs - frameLagMs) * SPARSE_BONUS_WEIGHT;
  const targetLagMs = clamp(
    sampleAgeMs + frameLagMs + sparseBonusMs + LATENCY_BIAS_MS,
    MIN_LOOKAHEAD_MS,
    MAX_LOOKAHEAD_MS,
  );
  const cadenceIntervalMs = inputIntervalMs === null
    ? resolvedFrameIntervalMs
    : clamp(
      (inputIntervalMs * 0.65) + (resolvedFrameIntervalMs * 0.35),
      MIN_LOOKAHEAD_MS,
      MAX_LOOKAHEAD_MS,
    );

  const errorDenominator = resolvedCellSize * ERROR_SCALE_CELLS;
  const errorRatio = clamp(nextEmaErrorPx / errorDenominator, 0, 1);
  const weightedSpeed = speed;
  const headingCos = (weightedSpeed > 0 && latestSpeed > 0)
    ? clamp(
      ((latestVx * vx) + (latestVy * vy)) / (latestSpeed * weightedSpeed),
      -1,
      1,
    )
    : 1;
  let intentFactor = INTENT_FACTOR_TURN;
  if (headingCos >= HEADING_COS_STEADY_MIN) {
    intentFactor = INTENT_FACTOR_STEADY;
  } else if (headingCos >= HEADING_COS_TRANSITION_MIN) {
    intentFactor = INTENT_FACTOR_TRANSITION;
  }
  if (previousSpeed > 0 && latestSpeed > 0 && latestSpeed < (previousSpeed * 0.45)) {
    intentFactor = Math.min(intentFactor, INTENT_FACTOR_TRANSITION);
  }
  const errorScale = 1 - (ERROR_DAMP_WEIGHT * errorRatio);
  const lookaheadMs = clamp(
    targetLagMs * errorScale * intentFactor,
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
  const baseStrength = 1 - errorRatio;
  const baseEffectiveClient = {
    x: current.x + ((projected.x - current.x) * baseStrength),
    y: current.y + ((projected.y - current.y) * baseStrength),
  };
  const effectiveClient = {
    x: current.x + ((baseEffectiveClient.x - current.x) * resolvedPredictionStrengthLevel),
    y: current.y + ((baseEffectiveClient.y - current.y) * resolvedPredictionStrengthLevel),
  };
  const nextPredictedClient = {
    x: current.x + ((projected.x - current.x) * resolvedPredictionStrengthLevel),
    y: current.y + ((projected.y - current.y) * resolvedPredictionStrengthLevel),
  };

  return {
    effectiveClient,
    nextEmaErrorPx,
    nextPredictedClient,
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
  const rawOverrideMarginPx = resolvedCellSize * RAW_OVERRIDE_MARGIN_CELL_RATIO;
  const rawBacktrackOverrideMarginPx = resolvedCellSize * RAW_BACKTRACK_OVERRIDE_MARGIN_CELL_RATIO;
  const rawIntentX = resolvedRawPointer.x - headCenter.x;
  const rawIntentY = resolvedRawPointer.y - headCenter.y;
  const rawIntentLength = Math.hypot(rawIntentX, rawIntentY);
  const shouldCheckRawDirection = rawIntentLength > (
    resolvedCellSize * RAW_POINTER_DIRECTION_MIN_DISTANCE_CELL_RATIO
  );
  const predictedBest = resolveBestMoveCandidate({
    candidates,
    pointer,
    pointerCell,
    headNode,
    headCenter,
    cellCenter,
  });
  if (!predictedBest) return null;
  const predictedCenter = predictedBest.center;

  const rawBest = resolveBestMoveCandidate({
    candidates,
    pointer: resolvedRawPointer,
    pointerCell,
    headNode,
    headCenter,
    cellCenter,
  });
  const resolveRawDirectionCos = (center) => {
    if (!shouldCheckRawDirection) return 1;
    const candidateVecX = center.x - headCenter.x;
    const candidateVecY = center.y - headCenter.y;
    const candidateVecLength = Math.hypot(candidateVecX, candidateVecY);
    if (!(candidateVecLength > 0)) return 1;
    return clamp(
      ((candidateVecX * rawIntentX) + (candidateVecY * rawIntentY)) / (candidateVecLength * rawIntentLength),
      -1,
      1,
    );
  };
  const predictedRawDirectionCos = resolveRawDirectionCos(predictedCenter);

  if (!rawBest) {
    if (predictedRawDirectionCos < RAW_POINTER_OPPOSITE_DIRECTION_COS) return null;
    return { r: predictedBest.candidate.r, c: predictedBest.candidate.c };
  }

  const matches = rawBest.candidate.r === predictedBest.candidate.r
    && rawBest.candidate.c === predictedBest.candidate.c;
  if (matches) {
    return { r: predictedBest.candidate.r, c: predictedBest.candidate.c };
  }

  if (predictedRawDirectionCos < RAW_POINTER_OPPOSITE_DIRECTION_COS) {
    return { r: rawBest.candidate.r, c: rawBest.candidate.c };
  }

  if (rawBest.marginPx > (predictedBest.marginPx + rawOverrideMarginPx)) {
    return { r: rawBest.candidate.r, c: rawBest.candidate.c };
  }

  if (
    rawBest.candidate.isBacktrack
    && rawBest.marginPx > (predictedBest.marginPx + rawBacktrackOverrideMarginPx)
  ) {
    return { r: rawBest.candidate.r, c: rawBest.candidate.c };
  }

  return { r: predictedBest.candidate.r, c: predictedBest.candidate.c };
}
