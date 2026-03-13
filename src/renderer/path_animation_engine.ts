import type {
  GridPoint,
  InteractionModel,
  PathTipArrivalHint,
} from '../contracts/ports.ts';
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

type PathSide = 'start' | 'end';
type MaybePath = readonly GridPoint[] | null | undefined;
type AnimationFrameHandle = number | ReturnType<typeof setTimeout>;
type RequestFrame = (callback: (timestamp: number) => void) => AnimationFrameHandle;
type CancelFrame = (handle: AnimationFrameHandle) => void;
type DrawHook = (...args: unknown[]) => unknown;

interface DirectionVector {
  x: number;
  y: number;
}

interface PathTipArrivalState {
  mode: 'arrive' | 'retract';
  startTimeMs: number;
  offsetX: number;
  offsetY: number;
  targetR: number;
  targetC: number;
  cutoffMs: number;
}

interface PathFlowVisibilityState {
  mode: 'appear' | 'disappear';
  startTimeMs: number;
}

interface PathStartPinPresenceState {
  mode: 'appear' | 'disappear';
  startTimeMs: number;
  anchorR: number;
  anchorC: number;
}

interface PathFlowFreezeState {
  startTimeMs: number;
  fromMix: number;
  toMix: number;
}

interface PathRotateState {
  startTimeMs: number;
  targetR: number;
  targetC: number;
  neighborR: number;
  neighborC: number;
  fromAngle: number;
  deltaAngle: number;
  cutoffMs: number;
}

interface PathReverseTipSwapState {
  startTimeMs: number;
  headR: number;
  headC: number;
  tailR: number;
  tailC: number;
}

interface PathReverseGradientBlendState {
  startTimeMs: number;
  headR: number;
  headC: number;
  tailR: number;
  tailC: number;
  pathLength: number;
  fromFlowOffset: number;
  toFlowOffset: number;
  fromTravelSpan: number;
}

interface PathOverlapCandidate {
  nextStart: number;
  prevStart: number;
  overlap: number;
  headShiftAbs: number;
  headCost: number;
}

interface PathOverlapWindow {
  shiftCount: number;
  nextStart: number;
  prevStart: number;
  overlap: number;
  isFullLengthOverlap: boolean;
  isPureHeadShift: boolean;
}

interface MixState {
  mix: number;
  active: boolean;
}

interface StartPinPresenceScaleState {
  scale: number;
  active: boolean;
  mode: 'none' | 'appear' | 'disappear';
  anchorR: number;
  anchorC: number;
}

interface DirectionState extends DirectionVector {
  active: boolean;
}

interface ReverseTipScaleState {
  inScale: number;
  outScale: number;
  active: boolean;
}

interface ReverseGradientBlendResolvedState {
  blend: number;
  fromFlowOffset: number;
  toFlowOffset: number;
  fromTravelSpan: number;
  active: boolean;
}

interface TipArrivalOffsetState extends DirectionState {
  mode: 'none' | 'arrive' | 'retract';
  remain: number;
  progress: number;
  linearRemain: number;
  linearProgress: number;
}

interface AdjacentTipArrivalMove {
  dr: number;
  dc: number;
  length: number;
}

interface PathAnimationFramePayload {
  timestamp: number;
  nowMs: number;
  interactiveResizeActive: boolean;
  pathFlowFrozen: boolean;
}

interface DrawAnimatedPathCallbacks {
  drawAnimatedPathInternal?: DrawHook;
}

interface PathAnimationEngineOptions {
  requestFrame?: RequestFrame;
  cancelFrame?: CancelFrame;
  nowFn?: () => number;
  isReducedMotionPreferred?: () => boolean;
  onResetForCacheElements?: (refs: unknown) => void;
  onSetInteractionModel?: (interactionModel: InteractionModel | null | undefined) => void;
  onDrawAll?: DrawHook;
  onDrawAnimatedPath?: DrawHook;
  onUpdatePathLayoutMetrics?: (offset: { x: number; y: number }, cell: number, gap: number, pad: number) => unknown;
  onNotifyInteractiveResize?: () => void;
  onSetPathFlowFreezeImmediate?: (isFrozen: boolean) => void;
  onAnimationFrame?: (payload: PathAnimationFramePayload) => boolean;
}

interface PathAnimationEngine {
  resetForCacheElements: (refs: unknown) => void;
  resetTransitionState: (options?: { preserveFlowFreeze?: boolean }) => void;
  syncPathFlowFreezeTarget: (isFrozen: boolean, nowMs?: number) => void;
  resolvePathFlowFreezeMix: (nowMs?: number, out?: MixState) => MixState;
  updatePathTipArrivalStates: (
    prevPath: MaybePath,
    nextPath: MaybePath,
    cellSize: number,
    cellStep: number,
    nowMs?: number,
    tipArrivalHint?: PathTipArrivalHint | null,
  ) => void;
  resolvePathTipArrivalOffset: (
    side: PathSide,
    tip: GridPoint | null | undefined,
    nowMs?: number,
    out?: TipArrivalOffsetState,
  ) => TipArrivalOffsetState;
  hasActivePathTipArrivals: (nowMs?: number) => boolean;
  updatePathFlowVisibilityState: (prevPath: MaybePath, nextPath: MaybePath, nowMs?: number) => void;
  resolvePathFlowVisibilityMix: (path: MaybePath, nowMs?: number, out?: MixState) => MixState;
  hasActivePathFlowVisibility: (path: MaybePath, nowMs?: number, out?: MixState) => boolean;
  updatePathStartPinPresenceState: (prevPath: MaybePath, nextPath: MaybePath, nowMs?: number) => void;
  resolvePathStartPinPresenceScale: (path: MaybePath, nowMs?: number, out?: StartPinPresenceScaleState) => StartPinPresenceScaleState;
  hasActivePathStartPinPresence: (path: MaybePath, nowMs?: number, out?: StartPinPresenceScaleState) => boolean;
  updatePathEndArrowRotateState: (prevPath: MaybePath, nextPath: MaybePath, nowMs?: number) => void;
  resolvePathEndArrowDirection: (path: MaybePath, nowMs?: number, out?: DirectionState) => DirectionState;
  hasActivePathEndArrowRotate: (path: MaybePath, nowMs?: number) => boolean;
  updatePathStartFlowRotateState: (prevPath: MaybePath, nextPath: MaybePath, nowMs?: number) => void;
  resolvePathStartFlowDirection: (path: MaybePath, nowMs?: number, out?: DirectionState) => DirectionState;
  hasActivePathStartFlowRotate: (path: MaybePath, nowMs?: number) => boolean;
  updatePathReverseTipSwapState: (prevPath: MaybePath, nextPath: MaybePath, nowMs?: number) => void;
  resolvePathReverseTipSwapScale: (path: MaybePath, nowMs?: number, out?: ReverseTipScaleState) => ReverseTipScaleState;
  hasActivePathReverseTipSwap: (path: MaybePath, nowMs?: number) => boolean;
  beginPathReverseGradientBlend: (
    path: MaybePath,
    fromFlowOffset: number,
    fromTravelSpan: number,
    toFlowOffset: number,
    cycle?: number,
    nowMs?: number,
  ) => void;
  resolvePathReverseGradientBlend: (
    path: MaybePath,
    cycle?: number,
    nowMs?: number,
    out?: ReverseGradientBlendResolvedState,
  ) => ReverseGradientBlendResolvedState;
  hasActivePathReverseGradientBlend: (path: MaybePath, cycle?: number, nowMs?: number) => boolean;
  setInteractionModel: (interactionModel: InteractionModel | null | undefined) => void;
  drawAll: (
    snapshot: unknown,
    refs: unknown,
    statuses: unknown,
    completionModel: unknown,
    tutorialFlags: unknown,
    drawAllInternal?: DrawHook,
  ) => unknown;
  drawAnimatedPath: (
    snapshot: unknown,
    refs: unknown,
    statuses: unknown,
    flowOffset: number,
    completionModel: unknown,
    tutorialFlags: unknown,
    callbacks?: DrawAnimatedPathCallbacks,
  ) => unknown;
  updatePathLayoutMetrics: (
    offset: { x: number; y: number },
    cell: number,
    gap: number,
    pad: number,
  ) => unknown;
  notifyInteractiveResize: () => void;
  setPathFlowFreezeImmediate: (isFrozen?: boolean) => void;
}

const hasShiftedPathPrefixMatch = (longerPath: MaybePath, shorterPath: MaybePath, shiftCount: number): boolean => {
  if (!Array.isArray(longerPath) || !Array.isArray(shorterPath)) return false;
  if (!Number.isInteger(shiftCount) || shiftCount <= 0) return false;
  if (longerPath.length !== shorterPath.length + shiftCount) return false;

  for (let i = 0; i < shorterPath.length; i += 1) {
    if (!pointsMatch(longerPath[i + shiftCount], shorterPath[i])) return false;
  }
  return true;
};

const isPathSide = (side: unknown): side is PathSide => side === 'start' || side === 'end';

const hasIntegerPointCoordinates = (point: unknown): point is GridPoint => {
  if (!point || typeof point !== 'object') return false;
  const maybePoint = point as Partial<GridPoint>;
  return Number.isInteger(maybePoint.r) && Number.isInteger(maybePoint.c);
};

const clonePoint = (point: GridPoint): GridPoint => ({ r: point.r, c: point.c });

const getPathTipForSide = (path: MaybePath, side: PathSide): GridPoint | undefined => (
  side === 'start' ? path?.[0] : path?.at(-1)
);

const getPathTipNeighborForSide = (path: MaybePath, side: PathSide): GridPoint | undefined => (
  side === 'start' ? path?.[1] : path?.at(-2)
);

const trimPathTipForSide = (path: readonly GridPoint[], side: PathSide): GridPoint[] => (
  side === 'start' ? path.slice(1) : path.slice(0, -1)
);

const insertPointAtPathTipForSide = (path: readonly GridPoint[], side: PathSide, point: GridPoint): GridPoint[] => (
  side === 'start'
    ? [clonePoint(point), ...path]
    : [...path, clonePoint(point)]
);

const pathContainsPoint = (path: MaybePath, point: GridPoint): boolean => (
  Array.isArray(path) && path.some((node) => pointsMatch(node, point))
);

const pathsSharePrefixMatch = (leftPath: readonly GridPoint[], rightPath: readonly GridPoint[], compareLength: number): boolean => {
  for (let i = 0; i < compareLength; i += 1) {
    if (!pointsMatch(leftPath[i], rightPath[i])) return false;
  }
  return true;
};

const resolveTipArrivalSyntheticPrevPathFromHint = (
  side: PathSide,
  nextPath: MaybePath,
  tipArrivalHint: PathTipArrivalHint | null = null,
): GridPoint[] | null => {
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

const resolveEqualLengthTipArrivalSyntheticPrevPath = (
  side: PathSide,
  prevPath: readonly GridPoint[],
  nextPath: readonly GridPoint[],
): GridPoint[] | null => {
  if (nextPath.length <= 1) return null;

  const prevTip = getPathTipForSide(prevPath, side);
  const nextTip = getPathTipForSide(nextPath, side);
  if (!prevTip || !nextTip || pointsMatch(prevTip, nextTip)) return null;
  return trimPathTipForSide(nextPath, side);
};

const resolveEndTipArrivalSyntheticPrevPath = (
  prevPath: readonly GridPoint[],
  nextPath: readonly GridPoint[],
): GridPoint[] | null => {
  const delta = nextPath.length - prevPath.length;
  const sharedLen = Math.min(prevPath.length, nextPath.length);
  if (!pathsSharePrefixMatch(prevPath, nextPath, sharedLen)) return null;
  if (delta > 1) return nextPath.length > 1 ? trimPathTipForSide(nextPath, 'end') : null;
  if (delta >= -1) return null;

  const restored = prevPath[nextPath.length];
  return restored ? insertPointAtPathTipForSide(nextPath, 'end', restored) : null;
};

const resolveStartTipArrivalSyntheticPrevPath = (
  prevPath: readonly GridPoint[],
  nextPath: readonly GridPoint[],
): GridPoint[] | null => {
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
  side: PathSide,
  prevPath: MaybePath,
  nextPath: MaybePath,
  tipArrivalHint: PathTipArrivalHint | null = null,
): GridPoint[] | null => {
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

const resolvePathOverlapLength = (
  nextPath: readonly GridPoint[],
  previousPath: readonly GridPoint[],
  nextStart: number,
  prevStart: number,
): number => {
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
  overlap: number,
  headCost: number,
  bestOverlap: number,
  bestHeadCost: number,
): boolean => {
  if (overlap > bestOverlap) return true;
  if (overlap < bestOverlap) return false;
  return headCost < bestHeadCost;
};

const isBetterRelaxedOverlapCandidate = (
  overlap: number,
  headShiftAbs: number,
  headCost: number,
  bestOverlap: number,
  bestHeadShiftAbs: number,
  bestHeadCost: number,
): boolean => {
  if (overlap > bestOverlap) return true;
  if (overlap < bestOverlap) return false;
  if (headShiftAbs < bestHeadShiftAbs) return true;
  if (headShiftAbs > bestHeadShiftAbs) return false;
  return headCost < bestHeadCost;
};

const resolvePathOverlapCandidate = (
  nextPath: readonly GridPoint[],
  previousPath: readonly GridPoint[],
  nextStart: number,
  prevStart: number,
  minOverlap: number,
  shiftCount: number | null,
): PathOverlapCandidate | null => {
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
  candidate: PathOverlapCandidate,
  bestOverlap: number,
  bestHeadShiftAbs: number,
  bestHeadCost: number,
  shiftCount: number | null,
): boolean => {
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
  nextPath: MaybePath,
  previousPath: MaybePath,
  minOverlap = 1,
  shiftCount: number | null = null,
): Pick<PathOverlapWindow, 'nextStart' | 'prevStart' | 'overlap'> | null => {
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

export const resolveHeadShiftStepCount = (nextPath: MaybePath, previousPath: MaybePath): number => {
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

export const resolveHeadShiftTransitionWindow = (nextPath: MaybePath, previousPath: MaybePath): PathOverlapWindow | null => {
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

const cubicBezierAxisAt = (t: number, p1: number, p2: number): number => {
  const omt = 1 - t;
  return (3 * p1 * omt * omt * t) + (3 * p2 * omt * t * t) + (t * t * t);
};

const cubicBezierAxisSlopeAt = (t: number, p1: number, p2: number): number => {
  const omt = 1 - t;
  return (3 * p1 * omt * omt) + (6 * (p2 - p1) * omt * t) + (3 * (1 - p2) * t * t);
};

const sampleCubicBezierYAtX = (x: number, x1: number, y1: number, x2: number, y2: number): number => {
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

const easeOutCubic = (unit: number): number => {
  const t = clampUnit(unit);
  const inv = 1 - t;
  return 1 - (inv * inv * inv);
};

const resolveNow = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const resolveRequestFrame = (): RequestFrame => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame;
  return (cb) => setTimeout(() => cb(resolveNow()), 16);
};

const resolveCancelFrame = (): CancelFrame => {
  if (typeof cancelAnimationFrame === 'function') return (id) => cancelAnimationFrame(id as number);
  return (id) => clearTimeout(id as ReturnType<typeof setTimeout>);
};

const normalizeShouldAnimate = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'shouldAnimate' in value) {
    const shouldAnimate = (value as { shouldAnimate?: unknown }).shouldAnimate;
    if (typeof shouldAnimate === 'boolean') return shouldAnimate;
  }
  return null;
};

const resolveDefaultReducedMotionQuery = (): (() => boolean) => {
  return () => readReducedMotionPreference();
};

const getPathSegmentCount = (path: MaybePath): number => {
  const pathLength = Array.isArray(path) ? path.length : 0;
  return pathLength > 1 ? pathLength - 1 : 0;
};

const normalizeDirectionInto = (dx: number, dy: number, out: DirectionVector): DirectionVector | null => {
  const len = Math.hypot(dx, dy);
  if (len <= 0) return null;
  out.x = dx / len;
  out.y = dy / len;
  return out;
};

export function createPathAnimationEngine(options: PathAnimationEngineOptions = {}): PathAnimationEngine {
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

  let animationFrameId: AnimationFrameHandle | 0 = 0;
  let latestFrameTimestamp = 0;
  let interactiveResizeActive = false;
  let pathFlowFrozen = false;

  let pathStartArrivalState: PathTipArrivalState | null = null;
  let pathEndArrivalState: PathTipArrivalState | null = null;
  let pathStartPinPresenceState: PathStartPinPresenceState | null = null;
  let pathFlowVisibilityState: PathFlowVisibilityState | null = null;
  let pathFlowFreezeState: PathFlowFreezeState | null = null;
  let pathFlowFreezeMix = 1;
  let lastPathFlowFrozen = false;
  let pathReverseTipSwapState: PathReverseTipSwapState | null = null;
  let pathReverseGradientBlendState: PathReverseGradientBlendState | null = null;
  let pathEndArrowRotateState: PathRotateState | null = null;
  let pathStartFlowRotateState: PathRotateState | null = null;

  const flowFreezeMixScratch: MixState = { mix: 1, active: false };
  const flowVisibilityMixScratch: MixState = { mix: 1, active: false };
  const startPinPresenceScaleScratch: StartPinPresenceScaleState = {
    scale: 1,
    active: false,
    mode: 'none',
    anchorR: Number.NaN,
    anchorC: Number.NaN,
  };
  const endArrowDirectionScratch: DirectionState = { x: Number.NaN, y: Number.NaN, active: false };
  const startFlowDirectionScratch: DirectionState = { x: Number.NaN, y: Number.NaN, active: false };
  const reverseTipScaleScratch: ReverseTipScaleState = { inScale: 1, outScale: 0, active: false };
  const reverseGradientBlendScratch: ReverseGradientBlendResolvedState = {
    blend: 1,
    fromFlowOffset: 0,
    toFlowOffset: 0,
    fromTravelSpan: 0,
    active: false,
  };
  const normalizeDirectionScratchA: DirectionVector = { x: 0, y: 0 };
  const normalizeDirectionScratchB: DirectionVector = { x: 0, y: 0 };

  const clearPathTipArrivalStates = () => {
    pathStartArrivalState = null;
    pathEndArrivalState = null;
  };

  const clearSinglePathTipArrivalState = (side: PathSide): void => {
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

  const clearPathRotateState = (side: PathSide): void => {
    if (side === 'start') {
      clearPathStartFlowRotateState();
      return;
    }
    if (side === 'end') {
      clearPathEndArrowRotateState();
    }
  };

  const setPathRotateState = (side: PathSide, state: PathRotateState | null): void => {
    if (side === 'start') {
      pathStartFlowRotateState = state;
      return;
    }
    if (side === 'end') {
      pathEndArrowRotateState = state;
    }
  };

  const getPathRotateState = (side: PathSide): PathRotateState | null => (
    side === 'start'
      ? pathStartFlowRotateState
      : pathEndArrowRotateState
  );

  const resetTransitionState = ({ preserveFlowFreeze = false }: { preserveFlowFreeze?: boolean } = {}): void => {
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
  ): MixState => {
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

  const syncPathFlowFreezeTarget = (isFrozen: boolean, nowMs = nowFn()): void => {
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
    side: PathSide,
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs = nowFn(),
  ): void => {
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
    if (!prevPath || !nextPath) {
      clearPathRotateState(side);
      return;
    }

    const retractedTip = isStartSide
      ? prevPath[prevPath.length - nextPath.length - 1]
      : prevPath[nextPath.length];
    const nextTip = getPathTipFromPath(nextPath, side);
    let neighbor: GridPoint | null = null;
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
    side: PathSide,
    path: MaybePath,
    nowMs: number,
    out: DirectionState,
  ): DirectionState => {
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
    if (!path || pathLength < 2) {
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
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs = nowFn(),
  ): void => updatePathRotateState('end', prevPath, nextPath, nowMs);

  const resolvePathEndArrowDirection = (
    path: MaybePath,
    nowMs = nowFn(),
    out = endArrowDirectionScratch,
  ): DirectionState => resolvePathRotateDirection('end', path, nowMs, out);

  const hasActivePathEndArrowRotate = (
    path: MaybePath,
    nowMs = nowFn(),
  ): boolean => resolvePathEndArrowDirection(path, nowMs, endArrowDirectionScratch).active;

  const updatePathStartFlowRotateState = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs = nowFn(),
  ): void => updatePathRotateState('start', prevPath, nextPath, nowMs);

  const resolvePathStartFlowDirection = (
    path: MaybePath,
    nowMs = nowFn(),
    out = startFlowDirectionScratch,
  ): DirectionState => resolvePathRotateDirection('start', path, nowMs, out);

  const hasActivePathStartFlowRotate = (
    path: MaybePath,
    nowMs = nowFn(),
  ): boolean => resolvePathStartFlowDirection(path, nowMs, startFlowDirectionScratch).active;

  const setSinglePathTipArrivalState = (side: PathSide, state: PathTipArrivalState | null): void => {
    if (side === 'start') pathStartArrivalState = state;
    else if (side === 'end') pathEndArrivalState = state;
  };

  const resolveAdjacentTipArrivalMove = (
    prevTip: GridPoint,
    nextTip: GridPoint,
  ): AdjacentTipArrivalMove | null => {
    const dr = prevTip.r - nextTip.r;
    const dc = prevTip.c - nextTip.c;
    const length = Math.hypot(dc, dr);
    if (length <= 0 || length > PATH_TIP_ARRIVAL_ADJACENT_MAX) return null;
    return { dr, dc, length };
  };

  const resolveSinglePathTipArrivalMode = (
    side: PathSide,
    prevPath: MaybePath,
    nextPath: MaybePath,
  ): PathTipArrivalState['mode'] | null => {
    if (side === 'start') {
      if (isStartRetractTransition(prevPath, nextPath)) return 'retract';
      return isStartAdvanceTransition(prevPath, nextPath) ? 'arrive' : null;
    }
    if (isEndRetractTransition(prevPath, nextPath)) return 'retract';
    return isEndAdvanceTransition(prevPath, nextPath) ? 'arrive' : null;
  };

  const buildPathTipArrivalState = (
    mode: PathTipArrivalState['mode'],
    nextTip: GridPoint,
    move: AdjacentTipArrivalMove,
    cellSize: number,
    cellStep: number,
    nowMs: number,
  ): PathTipArrivalState => {
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
    side: PathSide,
    prevPath: MaybePath,
    nextPath: MaybePath,
    cellSize: number,
    cellStep: number,
    nowMs: number,
  ): void => {
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
    prevPath: MaybePath,
    nextPath: MaybePath,
    cellSize: number,
    cellStep: number,
    nowMs = nowFn(),
    tipArrivalHint: PathTipArrivalHint | null = null,
  ): void => {
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

  const resolvePathTipArrivalOffset = (
    side: PathSide,
    tip: GridPoint | null | undefined,
    nowMs = nowFn(),
    out: TipArrivalOffsetState = {
      x: 0,
      y: 0,
      active: false,
      mode: 'none',
      remain: 1,
      progress: 0,
      linearRemain: 1,
      linearProgress: 0,
    },
  ): TipArrivalOffsetState => {
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

  const hasActivePathTipArrivals = (nowMs = nowFn()): boolean => {
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
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs = nowFn(),
  ): void => {
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
    path: MaybePath,
    nowMs = nowFn(),
    out = flowVisibilityMixScratch,
  ): MixState => {
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

  const hasActivePathFlowVisibility = (path: MaybePath, nowMs?: number, out = flowVisibilityMixScratch): boolean => (
    resolvePathFlowVisibilityMix(path, nowMs ?? nowFn(), out).active
  );

  const updatePathStartPinPresenceState = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs = nowFn(),
  ): void => {
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
    path: MaybePath,
    nowMs = nowFn(),
    out = startPinPresenceScaleScratch,
  ): StartPinPresenceScaleState => {
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

  const hasActivePathStartPinPresence = (
    path: MaybePath,
    nowMs?: number,
    out = startPinPresenceScaleScratch,
  ): boolean => (
    resolvePathStartPinPresenceScale(path, nowMs ?? nowFn(), out).active
  );

  const beginPathReverseGradientBlend = (
    path: MaybePath,
    fromFlowOffset: number,
    fromTravelSpan: number,
    toFlowOffset: number,
    cycle = PATH_FLOW_CYCLE,
    nowMs = nowFn(),
  ): void => {
    const pathLength = Array.isArray(path) ? path.length : 0;
    if (isReducedMotionPreferred() || !path || pathLength < 2) {
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
    path: MaybePath,
    cycle = PATH_FLOW_CYCLE,
    nowMs = nowFn(),
    out = reverseGradientBlendScratch,
  ): ReverseGradientBlendResolvedState => {
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
    if (!path || pathLength !== state.pathLength || pathLength < 2) {
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
    path: MaybePath,
    cycle = PATH_FLOW_CYCLE,
    nowMs = nowFn(),
  ): boolean => resolvePathReverseGradientBlend(path, cycle, nowMs, reverseGradientBlendScratch).active;

  const updatePathReverseTipSwapState = (prevPath: MaybePath, nextPath: MaybePath, nowMs = nowFn()): void => {
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

  const resolvePathReverseTipSwapScale = (
    path: MaybePath,
    nowMs = nowFn(),
    out = reverseTipScaleScratch,
  ): ReverseTipScaleState => {
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

  const hasActivePathReverseTipSwap = (path: MaybePath, nowMs = nowFn()): boolean => (
    resolvePathReverseTipSwapScale(path, nowMs, reverseTipScaleScratch).active
  );

  const stopAnimationFrame = () => {
    if (!animationFrameId) return;
    cancelFrame(animationFrameId);
    animationFrameId = 0;
    latestFrameTimestamp = 0;
  };

  const runAnimationFrame = (timestamp: number): void => {
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

  const maybeScheduleAnimationFrame = (shouldAnimate: boolean | null): void => {
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

    updatePathLayoutMetrics(offset: { x: number; y: number }, cell: number, gap: number, pad: number) {
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
