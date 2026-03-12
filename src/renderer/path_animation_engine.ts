// @ts-nocheck
import {
  angleDeltaSigned,
  cellDistance,
  clampUnit,
  pointsMatch,
} from '../math.ts';
import { isReducedMotionPreferred as readReducedMotionPreference } from '../reduced_motion.ts';
import {
  getPathTipFromPath,
  isEndAdvanceTransition,
  isEndRetractTransition,
  isPathReversed,
  isRetractUnturnTransition,
  isStartAdvanceTransition,
  isStartRetractTransition,
  normalizeFlowOffset,
  pathsMatch,
} from './path_transition_utils.ts';

const PATH_FLOW_CYCLE = 128;
const PATH_FLOW_FREEZE_DURATION_MS = 2500;
const PATH_FLOW_FREEZE_EPSILON = 1e-3;
const PATH_TIP_ARRIVAL_DURATION_MS = 200;
const PATH_REVERSE_TIP_SWAP_DURATION_MS = 200;
const PATH_REVERSE_GRADIENT_BLEND_DURATION_MS = 200;
const PATH_TIP_ARRIVAL_DISTANCE_CELL_FACTOR = 0.5;
const PATH_TIP_ARRIVAL_ADJACENT_MAX = Math.SQRT2 + 1e-3;
const PATH_TIP_CENTER_SNAP_EPSILON_PX = 0.5;
const PATH_TIP_ARRIVAL_BEZIER_X1 = 0;
const PATH_TIP_ARRIVAL_BEZIER_Y1 = 0.9;
const PATH_TIP_ARRIVAL_BEZIER_X2 = 0.1;
const PATH_TIP_ARRIVAL_BEZIER_Y2 = 1;

const hasShiftedPathPrefixMatch = (longerPath, shorterPath, shiftCount) => {
  if (!Array.isArray(longerPath) || !Array.isArray(shorterPath)) return false;
  if (!Number.isInteger(shiftCount) || shiftCount <= 0) return false;
  if (longerPath.length !== shorterPath.length + shiftCount) return false;

  for (let i = 0; i < shorterPath.length; i += 1) {
    if (!pointsMatch(longerPath[i + shiftCount], shorterPath[i])) return false;
  }
  return true;
};

const isPathSide = (side) => side === 'start' || side === 'end';

const hasIntegerPointCoordinates = (point) => (
  Number.isInteger(point?.r) && Number.isInteger(point?.c)
);

const clonePoint = (point) => ({ r: point.r, c: point.c });

const getPathTipForSide = (path, side) => (
  side === 'start' ? path[0] : path.at(-1)
);

const getPathTipNeighborForSide = (path, side) => (
  side === 'start' ? path[1] : path.at(-2)
);

const trimPathTipForSide = (path, side) => (
  side === 'start' ? path.slice(1) : path.slice(0, -1)
);

const insertPointAtPathTipForSide = (path, side, point) => (
  side === 'start'
    ? [clonePoint(point), ...path]
    : [...path, clonePoint(point)]
);

const pathContainsPoint = (path, point) => (
  Array.isArray(path) && path.some((node) => pointsMatch(node, point))
);

const pathsSharePrefixMatch = (leftPath, rightPath, compareLength) => {
  for (let i = 0; i < compareLength; i += 1) {
    if (!pointsMatch(leftPath[i], rightPath[i])) return false;
  }
  return true;
};

const resolveTipArrivalSyntheticPrevPathFromHint = (
  side,
  nextPath,
  tipArrivalHint = null,
) => {
  if (!isPathSide(side) || !Array.isArray(nextPath)) return null;
  if (!tipArrivalHint || tipArrivalHint.side !== side) return null;

  const from = tipArrivalHint.from;
  const to = tipArrivalHint.to;
  if (!hasIntegerPointCoordinates(from) || !hasIntegerPointCoordinates(to)) return null;
  if (nextPath.length <= 1) return null;

  const nextTip = getPathTipForSide(nextPath, side);
  if (!pointsMatch(nextTip, to)) return null;
  if (cellDistance(from, to) > PATH_TIP_ARRIVAL_ADJACENT_MAX) return null;

  const nextNeighbor = getPathTipNeighborForSide(nextPath, side);
  if (pointsMatch(nextNeighbor, from)) return trimPathTipForSide(nextPath, side);
  if (pathContainsPoint(nextPath, from)) return null;
  return insertPointAtPathTipForSide(nextPath, side, from);
};

const resolveEqualLengthTipArrivalSyntheticPrevPath = (side, prevPath, nextPath) => {
  if (nextPath.length <= 1) return null;

  const prevTip = getPathTipForSide(prevPath, side);
  const nextTip = getPathTipForSide(nextPath, side);
  if (!prevTip || !nextTip || pointsMatch(prevTip, nextTip)) return null;
  return trimPathTipForSide(nextPath, side);
};

const resolveEndTipArrivalSyntheticPrevPath = (prevPath, nextPath) => {
  const delta = nextPath.length - prevPath.length;
  const sharedLen = Math.min(prevPath.length, nextPath.length);
  if (!pathsSharePrefixMatch(prevPath, nextPath, sharedLen)) return null;
  if (delta > 1) return nextPath.length > 1 ? trimPathTipForSide(nextPath, 'end') : null;
  if (delta >= -1) return null;

  const restored = prevPath[nextPath.length];
  return restored ? insertPointAtPathTipForSide(nextPath, 'end', restored) : null;
};

const resolveStartTipArrivalSyntheticPrevPath = (prevPath, nextPath) => {
  if (nextPath.length > prevPath.length) {
    const stepCount = nextPath.length - prevPath.length;
    if (stepCount <= 1) return null;
    if (!hasShiftedPathPrefixMatch(nextPath, prevPath, stepCount)) return null;
    return nextPath.length > 1 ? trimPathTipForSide(nextPath, 'start') : null;
  }

  const stepCount = prevPath.length - nextPath.length;
  if (stepCount <= 1) return null;
  if (!hasShiftedPathPrefixMatch(prevPath, nextPath, stepCount)) return null;

  const restored = prevPath[stepCount - 1];
  return restored ? insertPointAtPathTipForSide(nextPath, 'start', restored) : null;
};

export const resolveTipArrivalSyntheticPrevPath = (
  side,
  prevPath,
  nextPath,
  tipArrivalHint = null,
) => {
  if (!isPathSide(side) || !Array.isArray(prevPath) || !Array.isArray(nextPath)) return null;

  const fromHint = resolveTipArrivalSyntheticPrevPathFromHint(side, nextPath, tipArrivalHint);
  if (fromHint) return fromHint;

  const prevLen = prevPath.length;
  const nextLen = nextPath.length;
  if (prevLen <= 0 || nextLen <= 0) return null;
  if (prevLen === nextLen) {
    return resolveEqualLengthTipArrivalSyntheticPrevPath(side, prevPath, nextPath);
  }
  return side === 'end'
    ? resolveEndTipArrivalSyntheticPrevPath(prevPath, nextPath)
    : resolveStartTipArrivalSyntheticPrevPath(prevPath, nextPath);
};

const resolvePathOverlapLength = (nextPath, previousPath, nextStart, prevStart) => {
  let overlap = 0;
  const maxCompare = Math.min(previousPath.length - prevStart, nextPath.length - nextStart);
  while (
    overlap < maxCompare
    && pointsMatch(nextPath[nextStart + overlap], previousPath[prevStart + overlap])
  ) {
    overlap += 1;
  }
  return overlap;
};

const isBetterShiftConstrainedOverlapCandidate = (
  overlap,
  headCost,
  bestOverlap,
  bestHeadCost,
) => {
  if (overlap > bestOverlap) return true;
  if (overlap < bestOverlap) return false;
  return headCost < bestHeadCost;
};

const isBetterRelaxedOverlapCandidate = (
  overlap,
  headShiftAbs,
  headCost,
  bestOverlap,
  bestHeadShiftAbs,
  bestHeadCost,
) => {
  if (overlap > bestOverlap) return true;
  if (overlap < bestOverlap) return false;
  if (headShiftAbs < bestHeadShiftAbs) return true;
  if (headShiftAbs > bestHeadShiftAbs) return false;
  return headCost < bestHeadCost;
};

const resolvePathOverlapCandidate = (
  nextPath,
  previousPath,
  nextStart,
  prevStart,
  minOverlap,
  shiftCount,
) => {
  if (Number.isInteger(shiftCount) && (nextStart - prevStart) !== shiftCount) return null;

  const overlap = resolvePathOverlapLength(nextPath, previousPath, nextStart, prevStart);
  if (overlap < minOverlap) return null;

  return {
    nextStart,
    prevStart,
    overlap,
    headShiftAbs: Math.abs(nextStart - prevStart),
    headCost: nextStart + prevStart,
  };
};

const isBetterPathOverlapCandidate = (
  candidate,
  bestOverlap,
  bestHeadShiftAbs,
  bestHeadCost,
  shiftCount,
) => {
  if (Number.isInteger(shiftCount)) {
    return isBetterShiftConstrainedOverlapCandidate(
      candidate.overlap,
      candidate.headCost,
      bestOverlap,
      bestHeadCost,
    );
  }

  return isBetterRelaxedOverlapCandidate(
    candidate.overlap,
    candidate.headShiftAbs,
    candidate.headCost,
    bestOverlap,
    bestHeadShiftAbs,
    bestHeadCost,
  );
};

const resolveBestPathOverlap = (
  nextPath,
  previousPath,
  minOverlap = 1,
  shiftCount = null,
) => {
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return null;
  const nextLen = nextPath.length;
  const prevLen = previousPath.length;
  if (nextLen <= 0 || prevLen <= 0) return null;

  let bestNextStart = 0;
  let bestPrevStart = 0;
  let bestOverlap = 0;
  let bestHeadShiftAbs = Infinity;
  let bestHeadCost = Infinity;

  for (let prevStart = 0; prevStart < prevLen; prevStart += 1) {
    for (let nextStart = 0; nextStart < nextLen; nextStart += 1) {
      const candidate = resolvePathOverlapCandidate(
        nextPath,
        previousPath,
        nextStart,
        prevStart,
        minOverlap,
        shiftCount,
      );
      if (!candidate) continue;

      if (!isBetterPathOverlapCandidate(
        candidate,
        bestOverlap,
        bestHeadShiftAbs,
        bestHeadCost,
        shiftCount,
      )) continue;

      bestOverlap = candidate.overlap;
      bestNextStart = candidate.nextStart;
      bestPrevStart = candidate.prevStart;
      bestHeadShiftAbs = candidate.headShiftAbs;
      bestHeadCost = candidate.headCost;
    }
  }

  if (bestOverlap < minOverlap) return null;
  return {
    nextStart: bestNextStart,
    prevStart: bestPrevStart,
    overlap: bestOverlap,
  };
};

export const resolveHeadShiftStepCount = (nextPath, previousPath) => {
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return 0;

  const nextLen = nextPath.length;
  const prevLen = previousPath.length;
  if (nextLen < 2 || prevLen < 2) return 0;

  if (nextLen > prevLen) {
    const shiftCount = nextLen - prevLen;
    if (hasShiftedPathPrefixMatch(nextPath, previousPath, shiftCount)) {
      return shiftCount;
    }
  } else if (nextLen < prevLen) {
    const shiftCount = prevLen - nextLen;
    if (hasShiftedPathPrefixMatch(previousPath, nextPath, shiftCount)) {
      return -shiftCount;
    }
  }

  const minOverlap = Math.min(nextLen, prevLen) <= 2 ? 1 : 2;
  const overlap = resolveBestPathOverlap(nextPath, previousPath, minOverlap);
  if (!overlap) return 0;
  return overlap.nextStart - overlap.prevStart;
};

export const resolveHeadShiftTransitionWindow = (nextPath, previousPath) => {
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return null;
  const nextLen = nextPath.length;
  const prevLen = previousPath.length;
  if (nextLen < 2 || prevLen < 2) return null;

  const minOverlap = Math.min(nextLen, prevLen) <= 2 ? 1 : 2;
  let shiftCount = resolveHeadShiftStepCount(nextPath, previousPath);
  let overlap = Number.isInteger(shiftCount) && shiftCount !== 0
    ? resolveBestPathOverlap(nextPath, previousPath, minOverlap, shiftCount)
    : null;

  // Fast multi-turn retract+advance can collapse strict overlap matching to 1 node.
  // Keep this fallback constrained to head-changed transitions only.
  if (!overlap) {
    const nextHead = nextPath[0] || null;
    const prevHead = previousPath[0] || null;
    const headChanged = !(
      nextHead
      && prevHead
      && pointsMatch(nextHead, prevHead)
    );
    if (!headChanged) return null;

    const relaxedOverlap = resolveBestPathOverlap(nextPath, previousPath, 1);
    if (!relaxedOverlap) return null;

    const relaxedShift = relaxedOverlap.nextStart - relaxedOverlap.prevStart;
    if (!Number.isInteger(relaxedShift) || relaxedShift === 0) return null;
    shiftCount = relaxedShift;
    overlap = relaxedOverlap;
  }

  const minLen = Math.min(nextLen, prevLen);
  const isFullLengthOverlap = overlap.overlap >= minLen;
  return {
    shiftCount,
    nextStart: overlap.nextStart,
    prevStart: overlap.prevStart,
    overlap: overlap.overlap,
    isFullLengthOverlap,
    isPureHeadShift: isFullLengthOverlap && (overlap.nextStart === 0 || overlap.prevStart === 0),
  };
};

const cubicBezierAxisAt = (t, p1, p2) => {
  const omt = 1 - t;
  return (3 * p1 * omt * omt * t) + (3 * p2 * omt * t * t) + (t * t * t);
};

const cubicBezierAxisSlopeAt = (t, p1, p2) => {
  const omt = 1 - t;
  return (3 * p1 * omt * omt) + (6 * (p2 - p1) * omt * t) + (3 * (1 - p2) * t * t);
};

const sampleCubicBezierYAtX = (x, x1, y1, x2, y2) => {
  const safeX = clampUnit(x);
  if (safeX <= 0) return 0;
  if (safeX >= 1) return 1;

  let t = safeX;
  for (let i = 0; i < 6; i += 1) {
    const xAtT = cubicBezierAxisAt(t, x1, x2);
    const slope = cubicBezierAxisSlopeAt(t, x1, x2);
    const delta = xAtT - safeX;
    if (Math.abs(delta) <= 1e-5 || Math.abs(slope) <= 1e-5) break;
    const next = t - (delta / slope);
    if (next <= 0 || next >= 1) break;
    t = next;
  }

  let low = 0;
  let high = 1;
  for (let i = 0; i < 12; i += 1) {
    const xAtT = cubicBezierAxisAt(t, x1, x2);
    if (Math.abs(xAtT - safeX) <= 1e-6) break;
    if (xAtT > safeX) high = t;
    else low = t;
    t = (low + high) * 0.5;
  }

  return cubicBezierAxisAt(t, y1, y2);
};

const easeOutCubic = (unit) => {
  const t = clampUnit(unit);
  const inv = 1 - t;
  return 1 - (inv * inv * inv);
};

const resolveNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const resolveRequestFrame = () => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame;
  return (cb) => setTimeout(() => cb(resolveNow()), 16);
};

const resolveCancelFrame = () => {
  if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame;
  return (id) => clearTimeout(id);
};

const normalizeShouldAnimate = (value) => {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.shouldAnimate === 'boolean') {
    return value.shouldAnimate;
  }
  return null;
};

const resolveDefaultReducedMotionQuery = () => {
  return () => readReducedMotionPreference();
};

const getPathSegmentCount = (path) => {
  const pathLength = Array.isArray(path) ? path.length : 0;
  return pathLength > 1 ? pathLength - 1 : 0;
};

const normalizeDirectionInto = (dx, dy, out) => {
  const len = Math.hypot(dx, dy);
  if (len <= 0) return null;
  out.x = dx / len;
  out.y = dy / len;
  return out;
};

export function createPathAnimationEngine(options = {}) {
  const requestFrame = typeof options.requestFrame === 'function'
    ? options.requestFrame
    : resolveRequestFrame();
  const cancelFrame = typeof options.cancelFrame === 'function'
    ? options.cancelFrame
    : resolveCancelFrame();
  const nowFn = typeof options.nowFn === 'function'
    ? options.nowFn
    : resolveNow;
  const isReducedMotionPreferred = typeof options.isReducedMotionPreferred === 'function'
    ? options.isReducedMotionPreferred
    : resolveDefaultReducedMotionQuery();

  const onResetForCacheElements = options.onResetForCacheElements;
  const onSetInteractionModel = options.onSetInteractionModel;
  const onDrawAll = options.onDrawAll;
  const onDrawAnimatedPath = options.onDrawAnimatedPath;
  const onUpdatePathLayoutMetrics = options.onUpdatePathLayoutMetrics;
  const onNotifyInteractiveResize = options.onNotifyInteractiveResize;
  const onSetPathFlowFreezeImmediate = options.onSetPathFlowFreezeImmediate;
  const onAnimationFrame = options.onAnimationFrame;

  let animationFrameId = 0;
  let latestFrameTimestamp = 0;
  let interactiveResizeActive = false;
  let pathFlowFrozen = false;

  let pathStartArrivalState = null;
  let pathEndArrivalState = null;
  let pathStartPinPresenceState = null;
  let pathFlowVisibilityState = null;
  let pathFlowFreezeState = null;
  let pathFlowFreezeMix = 1;
  let lastPathFlowFrozen = false;
  let pathReverseTipSwapState = null;
  let pathReverseGradientBlendState = null;
  let pathEndArrowRotateState = null;
  let pathStartFlowRotateState = null;

  const flowFreezeMixScratch = { mix: 1, active: false };
  const flowVisibilityMixScratch = { mix: 1, active: false };
  const startPinPresenceScaleScratch = {
    scale: 1,
    active: false,
    mode: 'none',
    anchorR: Number.NaN,
    anchorC: Number.NaN,
  };
  const endArrowDirectionScratch = { x: Number.NaN, y: Number.NaN, active: false };
  const startFlowDirectionScratch = { x: Number.NaN, y: Number.NaN, active: false };
  const reverseTipScaleScratch = { inScale: 1, outScale: 0, active: false };
  const reverseGradientBlendScratch = {
    blend: 1,
    fromFlowOffset: 0,
    toFlowOffset: 0,
    fromTravelSpan: 0,
    active: false,
  };
  const normalizeDirectionScratchA = { x: 0, y: 0 };
  const normalizeDirectionScratchB = { x: 0, y: 0 };

  const clearPathTipArrivalStates = () => {
    pathStartArrivalState = null;
    pathEndArrivalState = null;
  };

  const clearSinglePathTipArrivalState = (side) => {
    if (side === 'start') pathStartArrivalState = null;
    else if (side === 'end') pathEndArrivalState = null;
  };

  const clearPathStartPinPresenceState = () => {
    pathStartPinPresenceState = null;
  };

  const clearPathFlowVisibilityState = () => {
    pathFlowVisibilityState = null;
  };

  const clearPathReverseTipSwapState = () => {
    pathReverseTipSwapState = null;
  };

  const clearPathReverseGradientBlendState = () => {
    pathReverseGradientBlendState = null;
  };

  const clearPathEndArrowRotateState = () => {
    pathEndArrowRotateState = null;
  };

  const clearPathStartFlowRotateState = () => {
    pathStartFlowRotateState = null;
  };

  const clearPathRotateState = (side) => {
    if (side === 'start') {
      clearPathStartFlowRotateState();
      return;
    }
    if (side === 'end') {
      clearPathEndArrowRotateState();
    }
  };

  const setPathRotateState = (side, state) => {
    if (side === 'start') {
      pathStartFlowRotateState = state;
      return;
    }
    if (side === 'end') {
      pathEndArrowRotateState = state;
    }
  };

  const getPathRotateState = (side) => (
    side === 'start'
      ? pathStartFlowRotateState
      : pathEndArrowRotateState
  );

  const resetTransitionState = ({ preserveFlowFreeze = false } = {}) => {
    clearPathTipArrivalStates();
    clearPathStartPinPresenceState();
    clearPathFlowVisibilityState();
    clearPathReverseTipSwapState();
    clearPathReverseGradientBlendState();
    clearPathEndArrowRotateState();
    clearPathStartFlowRotateState();

    if (!preserveFlowFreeze) {
      pathFlowFreezeState = null;
      pathFlowFreezeMix = 1;
      lastPathFlowFrozen = false;
      pathFlowFrozen = false;
    }
  };

  const resolvePathFlowFreezeMix = (
    nowMs = nowFn(),
    out = flowFreezeMixScratch,
  ) => {
    out.mix = pathFlowFreezeMix;
    out.active = false;

    const state = pathFlowFreezeState;
    if (!state) return out;

    const elapsed = nowMs - state.startTimeMs;
    if (elapsed >= PATH_FLOW_FREEZE_DURATION_MS) {
      pathFlowFreezeMix = state.toMix;
      pathFlowFreezeState = null;
      out.mix = pathFlowFreezeMix;
      return out;
    }

    const eased = easeOutCubic(clampUnit(elapsed / PATH_FLOW_FREEZE_DURATION_MS));
    pathFlowFreezeMix = clampUnit(state.fromMix + ((state.toMix - state.fromMix) * eased));
    out.mix = pathFlowFreezeMix;
    out.active = true;
    return out;
  };

  const syncPathFlowFreezeTarget = (isFrozen, nowMs = nowFn()) => {
    if (lastPathFlowFrozen === Boolean(isFrozen)) return;
    lastPathFlowFrozen = Boolean(isFrozen);

    const currentMix = resolvePathFlowFreezeMix(nowMs, flowFreezeMixScratch).mix;
    const targetMix = isFrozen ? 0 : 1;
    if (Math.abs(currentMix - targetMix) <= PATH_FLOW_FREEZE_EPSILON) {
      pathFlowFreezeMix = targetMix;
      pathFlowFreezeState = null;
      return;
    }

    pathFlowFreezeState = {
      startTimeMs: nowMs,
      fromMix: currentMix,
      toMix: targetMix,
    };
  };

  const updatePathRotateState = (
    side,
    prevPath,
    nextPath,
    nowMs = nowFn(),
  ) => {
    if (isReducedMotionPreferred()) {
      clearPathRotateState(side);
      return;
    }
    if (pathsMatch(prevPath, nextPath)) return;

    const isStartSide = side === 'start';
    const isRetracting = isStartSide
      ? isStartRetractTransition(prevPath, nextPath)
      : isEndRetractTransition(prevPath, nextPath);
    if (!isRetracting) {
      clearPathRotateState(side);
      return;
    }

    const retractedTip = isStartSide
      ? prevPath[prevPath.length - nextPath.length - 1]
      : prevPath[nextPath.length];
    const nextTip = getPathTipFromPath(nextPath, side);
    let neighbor = null;
    if (Array.isArray(nextPath)) {
      neighbor = isStartSide ? nextPath[1] : nextPath.at(-2);
    }
    if (!retractedTip || !nextTip || !neighbor) {
      clearPathRotateState(side);
      return;
    }
    if (!isRetractUnturnTransition(side, retractedTip, nextTip, nextPath)) {
      clearPathRotateState(side);
      return;
    }

    const fromDir = isStartSide
      ? normalizeDirectionInto(
        nextTip.c - retractedTip.c,
        nextTip.r - retractedTip.r,
        normalizeDirectionScratchA,
      )
      : normalizeDirectionInto(
        retractedTip.c - nextTip.c,
        retractedTip.r - nextTip.r,
        normalizeDirectionScratchA,
      );
    const toDir = isStartSide
      ? normalizeDirectionInto(
        neighbor.c - nextTip.c,
        neighbor.r - nextTip.r,
        normalizeDirectionScratchB,
      )
      : normalizeDirectionInto(
        nextTip.c - neighbor.c,
        nextTip.r - neighbor.r,
        normalizeDirectionScratchB,
      );
    if (!fromDir || !toDir) {
      clearPathRotateState(side);
      return;
    }

    const fromAngle = Math.atan2(fromDir.y, fromDir.x);
    const toAngle = Math.atan2(toDir.y, toDir.x);
    setPathRotateState(side, {
      startTimeMs: nowMs,
      targetR: nextTip.r,
      targetC: nextTip.c,
      neighborR: neighbor.r,
      neighborC: neighbor.c,
      fromAngle,
      deltaAngle: angleDeltaSigned(fromAngle, toAngle),
      cutoffMs: PATH_TIP_ARRIVAL_DURATION_MS,
    });
  };

  const resolvePathRotateDirection = (
    side,
    path,
    nowMs,
    out,
  ) => {
    out.x = Number.NaN;
    out.y = Number.NaN;
    out.active = false;

    if (isReducedMotionPreferred()) {
      clearPathRotateState(side);
      return out;
    }

    const state = getPathRotateState(side);
    if (!state) return out;
    const pathLength = Array.isArray(path) ? path.length : 0;
    if (pathLength < 2) {
      clearPathRotateState(side);
      return out;
    }

    const isStartSide = side === 'start';
    const tip = isStartSide ? path[0] : path[pathLength - 1];
    const neighbor = isStartSide ? path[1] : path[pathLength - 2];
    if (
      !tip
      || !neighbor
      || tip.r !== state.targetR
      || tip.c !== state.targetC
      || neighbor.r !== state.neighborR
      || neighbor.c !== state.neighborC
    ) {
      clearPathRotateState(side);
      return out;
    }

    const elapsed = nowMs - state.startTimeMs;
    const visibleDuration = Number.isFinite(state.cutoffMs) && state.cutoffMs > 0
      ? state.cutoffMs
      : PATH_TIP_ARRIVAL_DURATION_MS;
    if (elapsed >= visibleDuration) {
      clearPathRotateState(side);
      return out;
    }
    const linearProgress = clampUnit(elapsed / PATH_TIP_ARRIVAL_DURATION_MS);
    const eased = easeOutCubic(linearProgress);
    const angle = state.fromAngle + (state.deltaAngle * eased);
    out.x = Math.cos(angle);
    out.y = Math.sin(angle);
    out.active = true;
    return out;
  };

  const updatePathEndArrowRotateState = (
    prevPath,
    nextPath,
    nowMs = nowFn(),
  ) => updatePathRotateState('end', prevPath, nextPath, nowMs);

  const resolvePathEndArrowDirection = (
    path,
    nowMs = nowFn(),
    out = endArrowDirectionScratch,
  ) => resolvePathRotateDirection('end', path, nowMs, out);

  const hasActivePathEndArrowRotate = (
    path,
    nowMs = nowFn(),
  ) => resolvePathEndArrowDirection(path, nowMs, endArrowDirectionScratch).active;

  const updatePathStartFlowRotateState = (
    prevPath,
    nextPath,
    nowMs = nowFn(),
  ) => updatePathRotateState('start', prevPath, nextPath, nowMs);

  const resolvePathStartFlowDirection = (
    path,
    nowMs = nowFn(),
    out = startFlowDirectionScratch,
  ) => resolvePathRotateDirection('start', path, nowMs, out);

  const hasActivePathStartFlowRotate = (
    path,
    nowMs = nowFn(),
  ) => resolvePathStartFlowDirection(path, nowMs, startFlowDirectionScratch).active;

  const setSinglePathTipArrivalState = (side, state) => {
    if (side === 'start') pathStartArrivalState = state;
    else if (side === 'end') pathEndArrivalState = state;
  };

  const resolveAdjacentTipArrivalMove = (prevTip, nextTip) => {
    const dr = prevTip.r - nextTip.r;
    const dc = prevTip.c - nextTip.c;
    const length = Math.hypot(dc, dr);
    if (length <= 0 || length > PATH_TIP_ARRIVAL_ADJACENT_MAX) return null;
    return { dr, dc, length };
  };

  const resolveSinglePathTipArrivalMode = (side, prevPath, nextPath) => {
    if (side === 'start') {
      if (isStartRetractTransition(prevPath, nextPath)) return 'retract';
      return isStartAdvanceTransition(prevPath, nextPath) ? 'arrive' : null;
    }
    if (isEndRetractTransition(prevPath, nextPath)) return 'retract';
    return isEndAdvanceTransition(prevPath, nextPath) ? 'arrive' : null;
  };

  const buildPathTipArrivalState = (mode, nextTip, move, cellSize, cellStep, nowMs) => {
    if (mode === 'retract') {
      const step = Number.isFinite(cellStep) && cellStep > 0 ? cellStep : Number(cellSize) || 0;
      return {
        mode,
        startTimeMs: nowMs,
        offsetX: move.dc * step,
        offsetY: move.dr * step,
        targetR: nextTip.r,
        targetC: nextTip.c,
        cutoffMs: PATH_TIP_ARRIVAL_DURATION_MS,
      };
    }

    const distancePx = Math.max(0, (Number(cellSize) || 0) * PATH_TIP_ARRIVAL_DISTANCE_CELL_FACTOR);
    return {
      mode,
      startTimeMs: nowMs,
      offsetX: (move.dc / move.length) * distancePx,
      offsetY: (move.dr / move.length) * distancePx,
      targetR: nextTip.r,
      targetC: nextTip.c,
      cutoffMs: PATH_TIP_ARRIVAL_DURATION_MS,
    };
  };

  const updateSinglePathTipArrivalState = (
    side,
    prevPath,
    nextPath,
    cellSize,
    cellStep,
    nowMs,
  ) => {
    if (!isPathSide(side)) return;
    const clearState = () => clearSinglePathTipArrivalState(side);
    const prevTip = getPathTipFromPath(prevPath, side);
    const nextTip = getPathTipFromPath(nextPath, side);

    if (!nextTip || !prevTip || pointsMatch(prevTip, nextTip)) {
      clearState();
      return;
    }

    const move = resolveAdjacentTipArrivalMove(prevTip, nextTip);
    if (!move) {
      clearState();
      return;
    }

    const mode = resolveSinglePathTipArrivalMode(side, prevPath, nextPath);
    if (!mode) {
      clearState();
      return;
    }

    setSinglePathTipArrivalState(
      side,
      buildPathTipArrivalState(mode, nextTip, move, cellSize, cellStep, nowMs),
    );
  };

  const updatePathTipArrivalStates = (
    prevPath,
    nextPath,
    cellSize,
    cellStep,
    nowMs = nowFn(),
    tipArrivalHint = null,
  ) => {
    if (isReducedMotionPreferred()) {
      clearPathTipArrivalStates();
      return;
    }
    const pathChanged = !pathsMatch(prevPath, nextPath);
    if (!pathChanged) return;
    if (isPathReversed(nextPath, prevPath)) {
      const head = nextPath?.[0] || null;
      const tail = nextPath?.[nextPath.length - 1] || null;
      const tipsAdjacent = Boolean(
        head
        && tail
        && cellDistance(head, tail) <= PATH_TIP_ARRIVAL_ADJACENT_MAX,
      );
      if (tipsAdjacent) {
        clearPathTipArrivalStates();
        return;
      }
    }

    const startPrevPath = resolveTipArrivalSyntheticPrevPath(
      'start',
      prevPath,
      nextPath,
      tipArrivalHint,
    ) || prevPath;
    const endPrevPath = resolveTipArrivalSyntheticPrevPath(
      'end',
      prevPath,
      nextPath,
      tipArrivalHint,
    ) || prevPath;

    updateSinglePathTipArrivalState(
      'start',
      startPrevPath,
      nextPath,
      cellSize,
      cellStep,
      nowMs,
    );
    updateSinglePathTipArrivalState(
      'end',
      endPrevPath,
      nextPath,
      cellSize,
      cellStep,
      nowMs,
    );
  };

  const resolvePathTipArrivalOffset = (side, tip, nowMs, out) => {
    const state = side === 'start' ? pathStartArrivalState : pathEndArrivalState;
    out.x = 0;
    out.y = 0;
    out.active = false;
    out.mode = 'none';
    out.remain = 1;
    out.progress = 0;
    out.linearRemain = 1;
    out.linearProgress = 0;

    if (!tip || !state) return out;
    if (state.targetR !== tip.r || state.targetC !== tip.c) {
      clearSinglePathTipArrivalState(side);
      return out;
    }

    const elapsed = nowMs - state.startTimeMs;
    const visibleDuration = Number.isFinite(state.cutoffMs) && state.cutoffMs > 0
      ? state.cutoffMs
      : PATH_TIP_ARRIVAL_DURATION_MS;
    if (elapsed >= visibleDuration) {
      clearSinglePathTipArrivalState(side);
      return out;
    }
    const unit = elapsed / PATH_TIP_ARRIVAL_DURATION_MS;
    const linearProgress = clampUnit(unit);
    const linearRemain = 1 - linearProgress;

    const eased = sampleCubicBezierYAtX(
      linearProgress,
      PATH_TIP_ARRIVAL_BEZIER_X1,
      PATH_TIP_ARRIVAL_BEZIER_Y1,
      PATH_TIP_ARRIVAL_BEZIER_X2,
      PATH_TIP_ARRIVAL_BEZIER_Y2,
    );
    const remain = 1 - eased;
    out.x = state.offsetX * remain;
    out.y = state.offsetY * remain;
    if (Math.abs(out.x) <= PATH_TIP_CENTER_SNAP_EPSILON_PX) out.x = 0;
    if (Math.abs(out.y) <= PATH_TIP_CENTER_SNAP_EPSILON_PX) out.y = 0;
    out.active = (out.x !== 0 || out.y !== 0);
    out.mode = state.mode || 'arrive';
    out.remain = remain;
    out.progress = eased;
    out.linearRemain = linearRemain;
    out.linearProgress = linearProgress;
    if (!out.active) {
      clearSinglePathTipArrivalState(side);
    }
    return out;
  };

  const hasActivePathTipArrivals = (nowMs = nowFn()) => {
    if (isReducedMotionPreferred()) {
      clearPathTipArrivalStates();
      return false;
    }

    if (
      pathStartArrivalState
      && nowMs - pathStartArrivalState.startTimeMs >= (
        Number.isFinite(pathStartArrivalState.cutoffMs) && pathStartArrivalState.cutoffMs > 0
          ? pathStartArrivalState.cutoffMs
          : PATH_TIP_ARRIVAL_DURATION_MS
      )
    ) {
      pathStartArrivalState = null;
    }
    if (
      pathEndArrivalState
      && nowMs - pathEndArrivalState.startTimeMs >= (
        Number.isFinite(pathEndArrivalState.cutoffMs) && pathEndArrivalState.cutoffMs > 0
          ? pathEndArrivalState.cutoffMs
          : PATH_TIP_ARRIVAL_DURATION_MS
      )
    ) {
      pathEndArrivalState = null;
    }
    return Boolean(pathStartArrivalState || pathEndArrivalState);
  };

  const updatePathFlowVisibilityState = (
    prevPath,
    nextPath,
    nowMs = nowFn(),
  ) => {
    if (isReducedMotionPreferred()) {
      clearPathFlowVisibilityState();
      return;
    }

    const pathChanged = !pathsMatch(prevPath, nextPath);
    if (!pathChanged) return;
    const prevSegmentCount = getPathSegmentCount(prevPath);
    const nextSegmentCount = getPathSegmentCount(nextPath);
    if (prevSegmentCount === 0 && nextSegmentCount === 1) {
      pathFlowVisibilityState = {
        mode: 'appear',
        startTimeMs: nowMs,
      };
      return;
    }
    if (prevSegmentCount === 1 && nextSegmentCount === 0) {
      pathFlowVisibilityState = {
        mode: 'disappear',
        startTimeMs: nowMs,
      };
      return;
    }
    clearPathFlowVisibilityState();
  };

  const resolvePathFlowVisibilityMix = (
    path,
    nowMs = nowFn(),
    out = flowVisibilityMixScratch,
  ) => {
    out.mix = 1;
    out.active = false;

    if (isReducedMotionPreferred()) {
      clearPathFlowVisibilityState();
      return out;
    }

    const state = pathFlowVisibilityState;
    if (!state) return out;
    const mode = state.mode === 'disappear' ? 'disappear' : 'appear';
    const segmentCount = getPathSegmentCount(path);
    if (mode === 'appear' && segmentCount !== 1) {
      clearPathFlowVisibilityState();
      return out;
    }
    if (mode === 'disappear' && segmentCount !== 0) {
      clearPathFlowVisibilityState();
      return out;
    }

    const elapsed = nowMs - state.startTimeMs;
    if (elapsed >= PATH_TIP_ARRIVAL_DURATION_MS) {
      clearPathFlowVisibilityState();
      out.mix = mode === 'appear' ? 1 : 0;
      return out;
    }
    const unit = clampUnit(elapsed / PATH_TIP_ARRIVAL_DURATION_MS);
    out.mix = mode === 'appear' ? unit : (1 - unit);
    out.active = true;
    return out;
  };

  const hasActivePathFlowVisibility = (path, nowMs, out = flowVisibilityMixScratch) => (
    resolvePathFlowVisibilityMix(path, nowMs ?? nowFn(), out).active
  );

  const updatePathStartPinPresenceState = (
    prevPath,
    nextPath,
    nowMs = nowFn(),
  ) => {
    if (isReducedMotionPreferred()) {
      clearPathStartPinPresenceState();
      return;
    }

    const pathChanged = !pathsMatch(prevPath, nextPath);
    if (!pathChanged) return;
    const prevLen = Array.isArray(prevPath) ? prevPath.length : 0;
    const nextLen = Array.isArray(nextPath) ? nextPath.length : 0;

    if (prevLen === 0 && nextLen === 1) {
      const anchor = nextPath?.[0] || null;
      if (!anchor) {
        clearPathStartPinPresenceState();
        return;
      }
      pathStartPinPresenceState = {
        mode: 'appear',
        startTimeMs: nowMs,
        anchorR: anchor.r,
        anchorC: anchor.c,
      };
      return;
    }

    if (prevLen === 1 && nextLen === 0) {
      const anchor = prevPath?.[0] || null;
      if (!anchor) {
        clearPathStartPinPresenceState();
        return;
      }
      pathStartPinPresenceState = {
        mode: 'disappear',
        startTimeMs: nowMs,
        anchorR: anchor.r,
        anchorC: anchor.c,
      };
      return;
    }

    clearPathStartPinPresenceState();
  };

  const resolvePathStartPinPresenceScale = (
    path,
    nowMs = nowFn(),
    out = startPinPresenceScaleScratch,
  ) => {
    out.scale = 1;
    out.active = false;
    out.mode = 'none';
    out.anchorR = Number.NaN;
    out.anchorC = Number.NaN;

    if (isReducedMotionPreferred()) {
      clearPathStartPinPresenceState();
      return out;
    }

    const state = pathStartPinPresenceState;
    if (!state) return out;
    const mode = state.mode === 'disappear' ? 'disappear' : 'appear';
    const pathLength = Array.isArray(path) ? path.length : 0;
    if (mode === 'appear') {
      const anchor = path?.[0] || null;
      if (
        pathLength !== 1
        || !anchor
        || anchor.r !== state.anchorR
        || anchor.c !== state.anchorC
      ) {
        clearPathStartPinPresenceState();
        return out;
      }
    } else if (pathLength !== 0) {
      clearPathStartPinPresenceState();
      return out;
    }

    const elapsed = nowMs - state.startTimeMs;
    if (elapsed >= PATH_TIP_ARRIVAL_DURATION_MS) {
      clearPathStartPinPresenceState();
      return out;
    }
    const unit = clampUnit(elapsed / PATH_TIP_ARRIVAL_DURATION_MS);
    const eased = easeOutCubic(unit);
    out.scale = mode === 'appear' ? eased : (1 - eased);
    out.mode = mode;
    out.anchorR = state.anchorR;
    out.anchorC = state.anchorC;
    out.active = true;
    return out;
  };

  const hasActivePathStartPinPresence = (path, nowMs, out = startPinPresenceScaleScratch) => (
    resolvePathStartPinPresenceScale(path, nowMs ?? nowFn(), out).active
  );

  const beginPathReverseGradientBlend = (
    path,
    fromFlowOffset,
    fromTravelSpan,
    toFlowOffset,
    cycle = PATH_FLOW_CYCLE,
    nowMs = nowFn(),
  ) => {
    const pathLength = Array.isArray(path) ? path.length : 0;
    if (isReducedMotionPreferred() || pathLength < 2) {
      clearPathReverseGradientBlendState();
      return;
    }
    const head = path[0];
    const tail = path[pathLength - 1];
    if (!head || !tail) {
      clearPathReverseGradientBlendState();
      return;
    }
    pathReverseGradientBlendState = {
      startTimeMs: nowMs,
      headR: head.r,
      headC: head.c,
      tailR: tail.r,
      tailC: tail.c,
      pathLength,
      fromFlowOffset: normalizeFlowOffset(fromFlowOffset, cycle),
      toFlowOffset: normalizeFlowOffset(toFlowOffset, cycle),
      fromTravelSpan: Math.max(0, Number(fromTravelSpan) || 0),
    };
  };

  const resolvePathReverseGradientBlend = (
    path,
    cycle = PATH_FLOW_CYCLE,
    nowMs = nowFn(),
    out = reverseGradientBlendScratch,
  ) => {
    out.blend = 1;
    out.fromFlowOffset = 0;
    out.toFlowOffset = 0;
    out.fromTravelSpan = 0;
    out.active = false;

    if (isReducedMotionPreferred()) {
      clearPathReverseGradientBlendState();
      return out;
    }

    const state = pathReverseGradientBlendState;
    if (!state) return out;
    const pathLength = Array.isArray(path) ? path.length : 0;
    if (pathLength !== state.pathLength || pathLength < 2) {
      clearPathReverseGradientBlendState();
      return out;
    }
    const head = path[0];
    const tail = path[pathLength - 1];
    if (
      !head
      || !tail
      || head.r !== state.headR
      || head.c !== state.headC
      || tail.r !== state.tailR
      || tail.c !== state.tailC
    ) {
      clearPathReverseGradientBlendState();
      return out;
    }

    const elapsed = nowMs - state.startTimeMs;
    if (elapsed >= PATH_REVERSE_GRADIENT_BLEND_DURATION_MS) {
      clearPathReverseGradientBlendState();
      return out;
    }

    out.blend = easeOutCubic(clampUnit(elapsed / PATH_REVERSE_GRADIENT_BLEND_DURATION_MS));
    out.fromFlowOffset = normalizeFlowOffset(state.fromFlowOffset, cycle);
    out.toFlowOffset = normalizeFlowOffset(state.toFlowOffset, cycle);
    out.fromTravelSpan = state.fromTravelSpan;
    out.active = true;
    return out;
  };

  const hasActivePathReverseGradientBlend = (
    path,
    cycle = PATH_FLOW_CYCLE,
    nowMs = nowFn(),
  ) => resolvePathReverseGradientBlend(path, cycle, nowMs, reverseGradientBlendScratch).active;

  const updatePathReverseTipSwapState = (prevPath, nextPath, nowMs = nowFn()) => {
    if (isReducedMotionPreferred()) {
      clearPathReverseTipSwapState();
      return;
    }
    if (!isPathReversed(nextPath, prevPath)) return;
    if (!Array.isArray(nextPath) || nextPath.length < 2) return;
    const head = nextPath[0];
    const tail = nextPath.at(-1);
    if (!head || !tail) return;
    pathReverseTipSwapState = {
      startTimeMs: nowMs,
      headR: head.r,
      headC: head.c,
      tailR: tail.r,
      tailC: tail.c,
    };
  };

  const resolvePathReverseTipSwapScale = (path, nowMs = nowFn(), out = reverseTipScaleScratch) => {
    out.inScale = 1;
    out.outScale = 0;
    out.active = false;

    if (isReducedMotionPreferred()) {
      clearPathReverseTipSwapState();
      return out;
    }

    const state = pathReverseTipSwapState;
    if (!state) return out;
    if (!Array.isArray(path) || path.length < 2) {
      clearPathReverseTipSwapState();
      return out;
    }

    const head = path[0];
    const tail = path.at(-1);
    if (
      !head
      || !tail
      || head.r !== state.headR
      || head.c !== state.headC
      || tail.r !== state.tailR
      || tail.c !== state.tailC
    ) {
      clearPathReverseTipSwapState();
      return out;
    }

    const elapsed = nowMs - state.startTimeMs;
    if (elapsed >= PATH_REVERSE_TIP_SWAP_DURATION_MS) {
      clearPathReverseTipSwapState();
      return out;
    }

    const unit = clampUnit(elapsed / PATH_REVERSE_TIP_SWAP_DURATION_MS);
    const inScale = easeOutCubic(unit);
    out.inScale = Math.max(0, Math.min(1, inScale));
    out.outScale = 1 - out.inScale;
    out.active = true;
    return out;
  };

  const hasActivePathReverseTipSwap = (path, nowMs = nowFn()) => (
    resolvePathReverseTipSwapScale(path, nowMs, reverseTipScaleScratch).active
  );

  const stopAnimationFrame = () => {
    if (!animationFrameId) return;
    cancelFrame(animationFrameId);
    animationFrameId = 0;
    latestFrameTimestamp = 0;
  };

  const runAnimationFrame = (timestamp) => {
    animationFrameId = 0;
    latestFrameTimestamp = Number.isFinite(timestamp) ? timestamp : 0;

    if (typeof onAnimationFrame !== 'function') return;
    const shouldContinue = onAnimationFrame({
      timestamp: latestFrameTimestamp,
      nowMs: nowFn(),
      interactiveResizeActive,
      pathFlowFrozen,
    }) === true;

    if (shouldContinue) {
      animationFrameId = requestFrame(runAnimationFrame);
    } else {
      latestFrameTimestamp = 0;
    }
  };

  const maybeScheduleAnimationFrame = (shouldAnimate) => {
    if (shouldAnimate === true) {
      if (!animationFrameId) {
        latestFrameTimestamp = 0;
        animationFrameId = requestFrame(runAnimationFrame);
      }
      return;
    }
    if (shouldAnimate === false) {
      stopAnimationFrame();
    }
  };

  return {
    resetForCacheElements(refs) {
      stopAnimationFrame();
      interactiveResizeActive = false;
      resetTransitionState();
      if (typeof onResetForCacheElements === 'function') {
        onResetForCacheElements(refs);
      }
    },

    resetTransitionState,
    syncPathFlowFreezeTarget,
    resolvePathFlowFreezeMix,
    updatePathTipArrivalStates,
    resolvePathTipArrivalOffset,
    hasActivePathTipArrivals,
    updatePathFlowVisibilityState,
    resolvePathFlowVisibilityMix,
    hasActivePathFlowVisibility,
    updatePathStartPinPresenceState,
    resolvePathStartPinPresenceScale,
    hasActivePathStartPinPresence,
    updatePathEndArrowRotateState,
    resolvePathEndArrowDirection,
    hasActivePathEndArrowRotate,
    updatePathStartFlowRotateState,
    resolvePathStartFlowDirection,
    hasActivePathStartFlowRotate,
    updatePathReverseTipSwapState,
    resolvePathReverseTipSwapScale,
    hasActivePathReverseTipSwap,
    beginPathReverseGradientBlend,
    resolvePathReverseGradientBlend,
    hasActivePathReverseGradientBlend,

    setInteractionModel(interactionModel) {
      if (typeof onSetInteractionModel === 'function') {
        onSetInteractionModel(interactionModel);
      }
    },

    drawAll(snapshot, refs, statuses, completionModel, tutorialFlags, drawAllInternal) {
      let drawResult;
      if (typeof onDrawAll === 'function') {
        drawResult = onDrawAll(
          snapshot,
          refs,
          statuses,
          completionModel,
          tutorialFlags,
          drawAllInternal,
        );
      } else if (typeof drawAllInternal === 'function') {
        drawResult = drawAllInternal(
          snapshot,
          refs,
          statuses,
          completionModel,
          tutorialFlags,
        );
      }
      maybeScheduleAnimationFrame(normalizeShouldAnimate(drawResult));
      return drawResult;
    },

    drawAnimatedPath(snapshot, refs, statuses, flowOffset, completionModel, tutorialFlags, callbacks = {}) {
      if (typeof onDrawAnimatedPath === 'function') {
        return onDrawAnimatedPath(
          snapshot,
          refs,
          statuses,
          flowOffset,
          completionModel,
          tutorialFlags,
          callbacks,
        );
      }
      if (typeof callbacks.drawAnimatedPathInternal === 'function') {
        return callbacks.drawAnimatedPathInternal(
          snapshot,
          refs,
          statuses,
          flowOffset,
          completionModel,
          tutorialFlags,
        );
      }
      return undefined;
    },

    updatePathLayoutMetrics(offset, cell, gap, pad) {
      if (typeof onUpdatePathLayoutMetrics === 'function') {
        return onUpdatePathLayoutMetrics(offset, cell, gap, pad);
      }
      return undefined;
    },

    notifyInteractiveResize() {
      interactiveResizeActive = true;
      if (typeof onNotifyInteractiveResize === 'function') {
        onNotifyInteractiveResize();
      }
    },

    setPathFlowFreezeImmediate(isFrozen = false) {
      pathFlowFrozen = Boolean(isFrozen);
      lastPathFlowFrozen = pathFlowFrozen;
      pathFlowFreezeMix = pathFlowFrozen ? 0 : 1;
      pathFlowFreezeState = null;
      if (typeof onSetPathFlowFreezeImmediate === 'function') {
        onSetPathFlowFreezeImmediate(pathFlowFrozen);
      }
    },
  };
}
