const SAMPLE_WINDOW = 4;
const EMA_ALPHA = 0.35;
const BASE_LOOKAHEAD_MS = 16;
const MIN_LOOKAHEAD_MS = 6;
const MAX_LOOKAHEAD_MS = 22;
const ERROR_SCALE_CELLS = 0.75;
const MAX_PROJECT_DISTANCE_CELLS = 0.75;
const MIN_SPEED_PX_PER_MS = 0.02;
const MAX_SEGMENT_DT_MS = 48;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

const safePoint = (point) => ({
  x: Number.isFinite(point?.x) ? point.x : 0,
  y: Number.isFinite(point?.y) ? point.y : 0,
});

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
  const errorDenominator = resolvedCellSize * ERROR_SCALE_CELLS;
  const errorRatio = clamp(nextEmaErrorPx / errorDenominator, 0, 1);
  const lookaheadMs = clamp(
    BASE_LOOKAHEAD_MS * (1 - (0.65 * errorRatio)),
    MIN_LOOKAHEAD_MS,
    MAX_LOOKAHEAD_MS,
  );

  let projectDx = vx * lookaheadMs;
  let projectDy = vy * lookaheadMs;
  const projectionCap = resolvedCellSize * MAX_PROJECT_DISTANCE_CELLS;
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
