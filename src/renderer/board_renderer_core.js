import { ELEMENT_IDS } from '../config.js';
import { keyOf } from '../utils.js';
import { cellCenter, getCellSize, vertexPos } from '../geometry.js';
import { ICONS } from '../icons.js';
import { buildBoardCellViewModel } from './board_view_model.js';
import { createPathWebglRenderer } from './path_webgl_renderer.js';
import {
  createPathAnimationEngine,
  resolveHeadShiftStepCount,
  resolveHeadShiftTransitionWindow,
  resolveTipArrivalSyntheticPrevPath,
} from './path_animation_engine.js';
import {
  pointsMatch,
  cellDistance,
  clampUnit,
  angleDeltaSigned,
  clampNumber,
} from '../math.js';
import {
  getPathTipFromPath,
  isEndRetractTransition,
  isPathReversed,
  isRetractUnturnTransition,
  isStartRetractTransition,
  normalizeFlowOffset,
  pathsMatch,
  resolvePathSignature,
} from './path_transition_utils.js';
import { createPathTransitionCompensationBuffer } from './path_transition_compensation_buffer.js';
import { isReducedMotionPreferred as readReducedMotionPreference } from '../reduced_motion.js';

const DEBUG_COUNTER_NOOP = () => {};

const createDebugCounterFnsDev = (debugCounters = null) => {
  if (!debugCounters) {
    return [
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
    ];
  }

  const increment = (name, amount = 1) => {
    const previous = Number(debugCounters[name]) || 0;
    debugCounters[name] = previous + amount;
  };

  return [
    (amount = 1) => increment('heavyFrameRenders', amount),
    (amount = 1) => increment('pathDraws', amount),
    (amount = 1) => increment('incrementalCellPatches', amount),
    (amount = 1) => increment('fullCellRebuilds', amount),
    (amount = 1) => increment('symbolRedraws', amount),
  ];
};

const createDebugCounterFns = (typeof __TETHER_DEV__ === 'boolean' ? __TETHER_DEV__ : true)
  ? createDebugCounterFnsDev
  : () => [
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
  ];

export function createBoardRendererCore(options = {}) {
const icons = options.icons || {};
const iconX = options.iconX || '';
const [
  countHeavyFrameRenders,
  countPathDraws,
  countIncrementalCellPatches,
  countFullCellRebuilds,
  countSymbolRedraws,
] = createDebugCounterFns(options.debugCounters || null);
let refs = null;
let gridCells = [];
let lastDropTargetKey = null;
let lastPathTipDragHoverCell = null;
let wallGhostEl = null;
let cachedBoardWrap = null;
let activeBoardSize = { rows: 0, cols: 0 };
let pathAnimationOffset = 0;
let pathAnimationFrame = 0;
let pathAnimationLastTs = 0;
let latestPathSnapshot = null;
let latestPathRefs = null;
let latestPathStatuses = null;
let latestPathStatusSets = null;
let latestCompletionModel = null;
let latestTutorialFlags = null;
let latestInteractionModel = null;
let latestMessageKind = null;
let latestMessageHtml = '';
let pendingRenderState = null;
const pendingRenderDirty = {
  cells: false,
  path: false,
  symbols: false,
  message: false,
  interaction: false,
};
let latestPathMainFlowTravel = 0;
let colorParserCtx = null;
let reusablePathPoints = [];
let reusableTutorialBracketPoints = [];
let reusableCellViewModel = null;
let resizeCanvasSignature = '';
let lastFlowMetricCell = NaN;
let pathThemeCacheInitialized = false;
let pathThemeLineRaw = '';
let pathThemeGoodRaw = '';
let pathThemeMainRgb = { r: 255, g: 255, b: 255 };
let pathThemeCompleteRgb = { r: 34, g: 197, b: 94 };
let pathThemeBadRaw = '#e85c5c';
let pathThemeStitchShadowRaw = '#0a111b';
let pathThemeCornerPending = '#ffffff';
let pathThemeCornerFill = 'rgb(11, 15, 20)';
let pathGeometryToken = 0;
let cachedPathRef = null;
let cachedPathLength = -1;
let cachedPathHeadR = NaN;
let cachedPathHeadC = NaN;
let cachedPathTailR = NaN;
let cachedPathTailC = NaN;
let cachedPathLayoutVersion = -1;
let pathStartRetainedArcState = null;
let pathEndRetainedArcState = null;
let pathRetainedArcTokenSeed = 0;
let tutorialBracketSignature = '';
let tutorialBracketGeometryToken = 0;
let lowPowerModeEnabled = false;
let lowPowerFrameDelayTimer = 0;
let lastPresentedFrameTimestamp = 0;
let wallGhostOffsetLeft = 0;
let wallGhostOffsetTop = 0;
let lastPathRendererRecoveryAttemptMs = 0;
let interactiveResizeActive = false;
let interactiveResizeTimer = 0;
let pendingInteractiveResizePayload = null;
const pathFlowMetricsCache = { cycle: 128, pulse: 64, speed: -32 };
const gridOffsetScratch = { x: 0, y: 0 };
const headOffsetScratch = { x: 0, y: 0 };
const headPointScratchA = { x: 0, y: 0 };
const headPointScratchB = { x: 0, y: 0 };
const headPointScratchC = { x: 0, y: 0 };
const keyParseScratch = { r: 0, c: 0 };
const EMPTY_MAP = new Map();
const TUTORIAL_BRACKET_COLOR_RGB = { r: 120, g: 190, b: 255 };
const FROZEN_PATH_GRAY_RGB = { r: 156, g: 156, b: 156 };
const tutorialBracketColorScratch = { r: 120, g: 190, b: 255 };
const pathFlowFreezeMixScratch = { mix: 1, active: false };
const themeColorScratch = { r: 0, g: 0, b: 0 };
const pathLayoutMetrics = {
  ready: false,
  version: 0,
  offsetX: 0,
  offsetY: 0,
  cell: 56,
  gap: 0,
  pad: 0,
};
const boardLayoutMetrics = {
  ready: false,
  version: 0,
  rows: 0,
  cols: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  size: 56,
  gap: 0,
  pad: 0,
  step: 56,
  scrollX: 0,
  scrollY: 0,
};
const pathFramePayload = {
  points: [],
  geometryToken: 0,
  width: 0,
  baseStartRadius: 0,
  baseArrowLength: 0,
  baseEndHalfWidth: 0,
  reverseHeadArrowLength: 0,
  reverseHeadArrowHalfWidth: 0,
  reverseTailCircleRadius: 0,
  reverseColorBlend: 1,
  reverseFromFlowOffset: 0,
  reverseTravelSpan: 0,
  startRadius: 0,
  arrowLength: 0,
  endHalfWidth: 0,
  mainColorRgb: null,
  completeColorRgb: null,
  isCompletionSolved: false,
  completionProgress: 0,
  flowEnabled: false,
  flowMix: 1,
  flowBaseSpeed: -32,
  flowOffset: 0,
  flowCycle: 128,
  flowPulse: 64,
  flowSpeed: -32,
  flowRise: 0.82,
  flowDrop: 0.83,
  tutorialBracketCenters: [],
  tutorialBracketGeometryToken: 0,
  tutorialBracketCellSize: 0,
  tutorialBracketPulseEnabled: false,
  tutorialBracketColorRgb: null,
  drawTutorialBracketsInPathLayer: false,
  endArrowDirX: NaN,
  endArrowDirY: NaN,
  startFlowDirX: NaN,
  startFlowDirY: NaN,
  retainedStartArcWidth: 0,
  retainedEndArcWidth: 0,
  retainedStartArcPoints: [],
  retainedEndArcPoints: [],
  retainedStartArcGeometryToken: NaN,
  retainedEndArcGeometryToken: NaN,
};

const PATH_FLOW_SPEED = -32;
const PATH_FLOW_CYCLE = 128;
const PATH_FLOW_PULSE = 64;
const PATH_FLOW_BASE_CELL = 56;
const PATH_FLOW_ANCHOR_RATIO = 1;
const PATH_FLOW_RISE = 0.82;
const PATH_FLOW_DROP = 0.83;
const PATH_FLOW_FREEZE_EPSILON = 1e-3;
const PATH_TIP_ARRIVAL_DURATION_MS = 200;
const PATH_RETAINED_ARC_SETTLE_DURATION_MS = 100;
const TUTORIAL_BRACKET_PULSE_CYCLES = 3;
const TAU = Math.PI * 2;
const CANVAS_ALIGN_OFFSET_CSS_PX = 0;
const PATH_RENDERER_RECOVERY_COOLDOWN_MS = 500;
const INTERACTIVE_RESIZE_IDLE_MS = 200;
const LOW_POWER_FRAME_INTERVAL_MS = 1000 / 30;
const PATH_TIP_HOVER_SCALE_DURATION_MS = 120;
const PATH_TIP_HOVER_UP_SCALE = 1.15;
const PATH_TIP_HOVER_SCALE_EPSILON = 1e-4;
const FLOW_TRAVEL_ANGLE_TOLERANCE = 1e-4;
const RETAINED_ARC_COVERAGE_EPSILON_PX = 0.5;
const arrivalOffsetScratchA = {
  x: 0,
  y: 0,
  active: false,
  remain: 1,
  progress: 0,
  linearRemain: 1,
  linearProgress: 0,
};
const arrivalOffsetScratchB = {
  x: 0,
  y: 0,
  active: false,
  remain: 1,
  progress: 0,
  linearRemain: 1,
  linearProgress: 0,
};
let reusableArrivalPathPoints = [];
const startPinPresenceScaleScratch = {
  scale: 1,
  active: false,
  mode: 'none',
  anchorR: NaN,
  anchorC: NaN,
};
const flowVisibilityMixScratch = { mix: 1, active: false };
const pathTipHoverScaleScratch = { startScale: 1, endScale: 1, active: false };
const reusableStartPinPresencePoint = { x: 0, y: 0 };
const reusableStartPinPresencePoints = [reusableStartPinPresencePoint];
const frozenMainColorScratch = { r: 255, g: 255, b: 255 };
const frozenCompleteColorScratch = { r: 34, g: 197, b: 94 };
const reverseTipScaleScratch = { inScale: 1, outScale: 0, active: false };
const reverseGradientBlendScratch = {
  blend: 1,
  fromFlowOffset: 0,
  toFlowOffset: 0,
  fromTravelSpan: 0,
  active: false,
};
const endArrowDirectionScratch = { x: NaN, y: NaN, active: false };
const startFlowDirectionScratch = { x: NaN, y: NaN, active: false };
const retainedArcRenderScratchA = {
  points: [],
  geometryToken: NaN,
  active: false,
};
const retainedArcRenderScratchB = {
  points: [],
  geometryToken: NaN,
  active: false,
};
let reusableStartRetainedArcPoints = [];
let reusableEndRetainedArcPoints = [];
const pathStartTipHoverScaleState = { fromScale: 1, toScale: 1, startTimeMs: NaN };
const pathEndTipHoverScaleState = { fromScale: 1, toScale: 1, startTimeMs: NaN };

const clearPendingRenderDirty = () => {
  pendingRenderDirty.cells = false;
  pendingRenderDirty.path = false;
  pendingRenderDirty.symbols = false;
  pendingRenderDirty.message = false;
  pendingRenderDirty.interaction = false;
};

const clearLowPowerFrameDelayTimer = () => {
  if (!lowPowerFrameDelayTimer) return;
  clearTimeout(lowPowerFrameDelayTimer);
  lowPowerFrameDelayTimer = 0;
};

const easeOutCubic = (unit) => {
  const t = clampUnit(unit);
  const inv = 1 - t;
  return 1 - (inv * inv * inv);
};

const mixRgb = (from, to, mixUnit, out = null) => {
  const unit = clampUnit(mixUnit);
  const target = out || { r: 0, g: 0, b: 0 };
  const fromR = Number.isFinite(Number(from?.r)) ? Number(from.r) : 0;
  const fromG = Number.isFinite(Number(from?.g)) ? Number(from.g) : 0;
  const fromB = Number.isFinite(Number(from?.b)) ? Number(from.b) : 0;
  const toR = Number.isFinite(Number(to?.r)) ? Number(to.r) : 0;
  const toG = Number.isFinite(Number(to?.g)) ? Number(to.g) : 0;
  const toB = Number.isFinite(Number(to?.b)) ? Number(to.b) : 0;
  target.r = Math.max(0, Math.min(255, Math.round(fromR + ((toR - fromR) * unit))));
  target.g = Math.max(0, Math.min(255, Math.round(fromG + ((toG - fromG) * unit))));
  target.b = Math.max(0, Math.min(255, Math.round(fromB + ((toB - fromB) * unit))));
  return target;
};

const resolvePathFlowFreezeMix = (
  nowMs = getNowMs(),
  out = pathFlowFreezeMixScratch,
) => pathAnimationEngine.resolvePathFlowFreezeMix(nowMs, out);

const syncPathFlowFreezeTarget = (isFrozen, nowMs = getNowMs()) => (
  pathAnimationEngine.syncPathFlowFreezeTarget(isFrozen, nowMs)
);

const isPathFlowFrozen = () => Boolean(latestInteractionModel?.isDailyLocked);
const clearPathTransitionCompensationBuffer = () => {
  transitionCompensationBuffer.clear();
};

const recordPathTransitionCompensation = (
  previousSnapshot,
  nextSnapshot,
  refs = null,
) => transitionCompensationBuffer.record(previousSnapshot, nextSnapshot, refs);

const consumePathTransitionCompensation = (
  path,
  flowCycle = PATH_FLOW_CYCLE,
) => {
  const result = transitionCompensationBuffer.consume(path, pathAnimationOffset, flowCycle);
  pathAnimationOffset = result.nextOffset;
  return result;
};

const clearPathStartRetainedArcState = () => {
  pathStartRetainedArcState = null;
};

const clearPathEndRetainedArcState = () => {
  pathEndRetainedArcState = null;
};

const clearPathRetainedArcStates = () => {
  clearPathStartRetainedArcState();
  clearPathEndRetainedArcState();
};


const clearPathTipHoverScaleStates = () => {
  pathStartTipHoverScaleState.fromScale = 1;
  pathStartTipHoverScaleState.toScale = 1;
  pathStartTipHoverScaleState.startTimeMs = NaN;
  pathEndTipHoverScaleState.fromScale = 1;
  pathEndTipHoverScaleState.toScale = 1;
  pathEndTipHoverScaleState.startTimeMs = NaN;
};

const updatePathEndArrowRotateState = (
  prevPath,
  nextPath,
  nowMs = getNowMs(),
) => pathAnimationEngine.updatePathEndArrowRotateState(prevPath, nextPath, nowMs);

const resolvePathEndArrowDirection = (
  path,
  nowMs = getNowMs(),
  out = endArrowDirectionScratch,
) => pathAnimationEngine.resolvePathEndArrowDirection(path, nowMs, out);

const hasActivePathEndArrowRotate = (
  path,
  nowMs = getNowMs(),
) => pathAnimationEngine.hasActivePathEndArrowRotate(path, nowMs);

const applyPathEndArrowDirectionToPayload = (path, nowMs = getNowMs()) => {
  const direction = resolvePathEndArrowDirection(path, nowMs, endArrowDirectionScratch);
  pathFramePayload.endArrowDirX = direction.active ? direction.x : NaN;
  pathFramePayload.endArrowDirY = direction.active ? direction.y : NaN;
  return direction.active;
};

const updatePathStartFlowRotateState = (
  prevPath,
  nextPath,
  nowMs = getNowMs(),
) => pathAnimationEngine.updatePathStartFlowRotateState(prevPath, nextPath, nowMs);

const resolvePathStartFlowDirection = (
  path,
  nowMs = getNowMs(),
  out = startFlowDirectionScratch,
) => pathAnimationEngine.resolvePathStartFlowDirection(path, nowMs, out);

const hasActivePathStartFlowRotate = (
  path,
  nowMs = getNowMs(),
) => pathAnimationEngine.hasActivePathStartFlowRotate(path, nowMs);

const applyPathStartFlowDirectionToPayload = (path, nowMs = getNowMs()) => {
  const direction = resolvePathStartFlowDirection(path, nowMs, startFlowDirectionScratch);
  pathFramePayload.startFlowDirX = direction.active ? direction.x : NaN;
  pathFramePayload.startFlowDirY = direction.active ? direction.y : NaN;
  return direction.active;
};

const clearSinglePathRetainedArcState = (side) => {
  if (side === 'start') clearPathStartRetainedArcState();
  else if (side === 'end') clearPathEndRetainedArcState();
};

const updateSinglePathRetainedArcState = (
  side,
  prevPath,
  nextPath,
  nowMs = getNowMs(),
  pathChanged = true,
) => {
  if (side !== 'start' && side !== 'end') return;
  const clearState = () => clearSinglePathRetainedArcState(side);
  if (!pathChanged) return;

  const isRetract = side === 'start'
    ? isStartRetractTransition(prevPath, nextPath)
    : isEndRetractTransition(prevPath, nextPath);
  if (!isRetract) {
    clearState();
    return;
  }

  const prevTip = getPathTipFromPath(prevPath, side);
  const nextTip = getPathTipFromPath(nextPath, side);
  if (!prevTip || !nextTip) {
    clearState();
    return;
  }
  if (!isRetractUnturnTransition(side, prevTip, nextTip, nextPath)) {
    clearState();
    return;
  }
  const neighbor = side === 'start'
    ? nextPath?.[1] || null
    : nextPath?.[nextPath.length - 2] || null;
  if (!neighbor) {
    clearState();
    return;
  }

  const nextState = {
    side,
    startTimeMs: nowMs,
    settleStartTimeMs: NaN,
    cornerR: nextTip.r,
    cornerC: nextTip.c,
    movingR: prevTip.r,
    movingC: prevTip.c,
    arcInR: side === 'start' ? prevTip.r : neighbor.r,
    arcInC: side === 'start' ? prevTip.c : neighbor.c,
    arcOutR: side === 'start' ? neighbor.r : prevTip.r,
    arcOutC: side === 'start' ? neighbor.c : prevTip.c,
    geometryTokenSeed: (pathRetainedArcTokenSeed += 1),
  };
  if (side === 'start') pathStartRetainedArcState = nextState;
  else pathEndRetainedArcState = nextState;
};

const updatePathRetainedArcStates = (
  prevPath,
  nextPath,
  nowMs = getNowMs(),
) => {
  if (isReducedMotionPreferred()) {
    clearPathRetainedArcStates();
    return;
  }
  const pathChanged = !pathsMatch(prevPath, nextPath);
  if (!pathChanged) return;

  updateSinglePathRetainedArcState('start', prevPath, nextPath, nowMs, pathChanged);
  updateSinglePathRetainedArcState('end', prevPath, nextPath, nowMs, pathChanged);
};

const isRetainedArcStateCompatibleWithPath = (state, path) => {
  if (!state || !Array.isArray(path) || path.length <= 0) return false;
  if (state.side === 'start') {
    const head = path[0];
    return Boolean(head && head.r === state.cornerR && head.c === state.cornerC);
  }
  const tail = path[path.length - 1];
  return Boolean(tail && tail.r === state.cornerR && tail.c === state.cornerC);
};

const getCellPointFromLayout = (r, c, out = headPointScratchA) => {
  if (!pathLayoutMetrics.ready) return null;
  const row = Number(r);
  const col = Number(c);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  const deviceScale = getDevicePixelScale();
  const step = pathLayoutMetrics.cell + pathLayoutMetrics.gap;
  const half = pathLayoutMetrics.cell * 0.5;
  out.x = snapCssToDevicePixel(
    pathLayoutMetrics.offsetX + pathLayoutMetrics.pad + (col * step) + half,
    deviceScale,
  );
  out.y = snapCssToDevicePixel(
    pathLayoutMetrics.offsetY + pathLayoutMetrics.pad + (row * step) + half,
    deviceScale,
  );
  return out;
};

const clearArcPointPool = (points) => {
  if (Array.isArray(points)) points.length = 0;
};

const ensureArcPointPoolLength = (points, length) => {
  if (!Array.isArray(points)) return;
  if (points.length < length) {
    for (let i = points.length; i < length; i++) {
      points.push({ x: 0, y: 0 });
    }
  }
  points.length = length;
};

const buildRetainedArcPolyline = (
  state,
  width,
  outPoints,
  settleUnit = 0,
) => {
  clearArcPointPool(outPoints);
  if (!state || !(width > 0)) return null;
  const p0 = getCellPointFromLayout(state.arcInR, state.arcInC, headPointScratchA);
  const p1 = getCellPointFromLayout(state.cornerR, state.cornerC, headPointScratchB);
  const p2 = getCellPointFromLayout(state.arcOutR, state.arcOutC, headPointScratchC);
  if (!p0 || !p1 || !p2) return null;

  const inDx = p1.x - p0.x;
  const inDy = p1.y - p0.y;
  const outDx = p2.x - p1.x;
  const outDy = p2.y - p1.y;
  const inLen = Math.hypot(inDx, inDy);
  const outLen = Math.hypot(outDx, outDy);
  if (!(inLen > 0) || !(outLen > 0)) return null;
  const inUx = inDx / inLen;
  const inUy = inDy / inLen;
  const outUx = outDx / outLen;
  const outUy = outDy / outLen;
  const inAngle = Math.atan2(inUy, inUx);
  const outAngle = Math.atan2(outUy, outUx);
  const turn = angleDeltaSigned(inAngle, outAngle);
  const absTurn = Math.abs(turn);
  if (
    absTurn <= FLOW_TRAVEL_ANGLE_TOLERANCE
    || absTurn >= Math.PI - FLOW_TRAVEL_ANGLE_TOLERANCE
  ) {
    return null;
  }

  const targetAbsTurn = Math.min(absTurn, Math.PI / 4);
  const unit = clampUnit(settleUnit);
  const desiredAbsTurn = absTurn + ((targetAbsTurn - absTurn) * easeOutCubic(unit));
  if (!(desiredAbsTurn > FLOW_TRAVEL_ANGLE_TOLERANCE)) return null;

  const turnSign = turn < 0 ? -1 : 1;
  const desiredOutAngle = inAngle + (turnSign * desiredAbsTurn);
  const desiredOutUx = Math.cos(desiredOutAngle);
  const desiredOutUy = Math.sin(desiredOutAngle);

  const radius = width * 0.5;
  const tangentOffset = radius * Math.tan(desiredAbsTurn * 0.5);
  if (!(tangentOffset > 0) || !Number.isFinite(tangentOffset)) return null;

  const tangentInX = p1.x - inUx * tangentOffset;
  const tangentInY = p1.y - inUy * tangentOffset;
  const tangentOutX = p1.x + desiredOutUx * tangentOffset;
  const tangentOutY = p1.y + desiredOutUy * tangentOffset;
  ensureArcPointPoolLength(outPoints, 3);
  outPoints[0].x = tangentInX;
  outPoints[0].y = tangentInY;
  outPoints[1].x = p1.x;
  outPoints[1].y = p1.y;
  outPoints[2].x = tangentOutX;
  outPoints[2].y = tangentOutY;
  return outPoints;
};

const getMaxDistancePointToPoints = (
  px,
  py,
  points,
) => {
  if (!Array.isArray(points) || points.length <= 0) return Infinity;
  let maxDistance = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    maxDistance = Math.max(maxDistance, Math.hypot(px - x, py - y));
  }
  return maxDistance;
};

const resolveSinglePathRetainedArc = (
  side,
  path,
  width,
  coverageRadius,
  nowMs,
  tipMoving,
  tipCenterX,
  tipCenterY,
  out,
) => {
  out.points = [];
  out.geometryToken = NaN;
  out.active = false;

  if (isReducedMotionPreferred()) {
    clearPathRetainedArcStates();
    return out;
  }

  const state = side === 'start' ? pathStartRetainedArcState : pathEndRetainedArcState;
  if (!state) return out;
  if (!isRetainedArcStateCompatibleWithPath(state, path)) {
    clearSinglePathRetainedArcState(side);
    return out;
  }

  if (tipMoving) {
    state.settleStartTimeMs = NaN;
  } else if (!Number.isFinite(state.settleStartTimeMs)) {
    state.settleStartTimeMs = nowMs;
  }
  const settleUnit = Number.isFinite(state.settleStartTimeMs)
    ? clampUnit((nowMs - state.settleStartTimeMs) / PATH_RETAINED_ARC_SETTLE_DURATION_MS)
    : 0;
  const retractUnit = Number.isFinite(state.startTimeMs)
    ? clampUnit((nowMs - state.startTimeMs) / PATH_TIP_ARRIVAL_DURATION_MS)
    : 0;
  if (tipMoving || retractUnit > 0) {
    clearSinglePathRetainedArcState(side);
    return out;
  }
  const arcPoints = buildRetainedArcPolyline(
    state,
    width,
    side === 'start' ? reusableStartRetainedArcPoints : reusableEndRetainedArcPoints,
    settleUnit,
  );
  if (!arcPoints || arcPoints.length < 2) {
    clearSinglePathRetainedArcState(side);
    return out;
  }

  if (Number.isFinite(tipCenterX) && Number.isFinite(tipCenterY) && coverageRadius > 0) {
    const maxCenterlineDistance = getMaxDistancePointToPoints(tipCenterX, tipCenterY, arcPoints);
    const fullyCoveredDistance = coverageRadius - (width * 0.5) - RETAINED_ARC_COVERAGE_EPSILON_PX;
    if (fullyCoveredDistance > 0 && maxCenterlineDistance <= fullyCoveredDistance) {
      clearSinglePathRetainedArcState(side);
      return out;
    }
  }

  out.points = arcPoints;
  out.geometryToken = (
    state.geometryTokenSeed * 1e6
  ) + pathLayoutMetrics.version;
  out.active = true;
  return out;
};

const hasActivePathRetainedArc = (path) => {
  if (isReducedMotionPreferred()) {
    clearPathRetainedArcStates();
    return false;
  }
  if (pathStartRetainedArcState && !isRetainedArcStateCompatibleWithPath(pathStartRetainedArcState, path)) {
    clearPathStartRetainedArcState();
  }
  if (pathEndRetainedArcState && !isRetainedArcStateCompatibleWithPath(pathEndRetainedArcState, path)) {
    clearPathEndRetainedArcState();
  }
  return Boolean(pathStartRetainedArcState || pathEndRetainedArcState);
};

const updatePathTipArrivalStates = (
  prevPath,
  nextPath,
  cellSize,
  cellStep,
  nowMs = getNowMs(),
) => pathAnimationEngine.updatePathTipArrivalStates(
  prevPath,
  nextPath,
  cellSize,
  cellStep,
  nowMs,
  latestInteractionModel?.pathTipArrivalHint || null,
);

const resolvePathTipArrivalOffset = (side, tip, nowMs, out) => (
  pathAnimationEngine.resolvePathTipArrivalOffset(side, tip, nowMs, out)
);

const hasActivePathTipArrivals = (nowMs = getNowMs()) => (
  pathAnimationEngine.hasActivePathTipArrivals(nowMs)
);

const updatePathFlowVisibilityState = (
  prevPath,
  nextPath,
  nowMs = getNowMs(),
) => pathAnimationEngine.updatePathFlowVisibilityState(prevPath, nextPath, nowMs);

const resolvePathFlowVisibilityMix = (
  path,
  nowMs = getNowMs(),
  out = flowVisibilityMixScratch,
) => pathAnimationEngine.resolvePathFlowVisibilityMix(path, nowMs, out);

const hasActivePathFlowVisibility = (path, nowMs = getNowMs()) => (
  pathAnimationEngine.hasActivePathFlowVisibility(path, nowMs, flowVisibilityMixScratch)
);

const updatePathStartPinPresenceState = (
  prevPath,
  nextPath,
  nowMs = getNowMs(),
) => pathAnimationEngine.updatePathStartPinPresenceState(prevPath, nextPath, nowMs);

const resolvePathStartPinPresenceScale = (
  path,
  nowMs = getNowMs(),
  out = startPinPresenceScaleScratch,
) => pathAnimationEngine.resolvePathStartPinPresenceScale(path, nowMs, out);

const hasActivePathStartPinPresence = (path, nowMs = getNowMs()) => (
  pathAnimationEngine.hasActivePathStartPinPresence(path, nowMs, startPinPresenceScaleScratch)
);

const applyPathStartPinPresenceToPayload = (path, nowMs = getNowMs()) => {
  const presence = resolvePathStartPinPresenceScale(path, nowMs, startPinPresenceScaleScratch);
  const currentStartRadius = Number(pathFramePayload.startRadius) || 0;
  pathFramePayload.startRadius = currentStartRadius * Math.max(0, presence.scale);
  return presence.active;
};

const resolvePathTipHoverScaleValue = (state, nowMs = getNowMs()) => {
  const fromScale = Number.isFinite(state?.fromScale) ? state.fromScale : 1;
  const toScale = Number.isFinite(state?.toScale) ? state.toScale : 1;
  const startTimeMs = Number(state?.startTimeMs);
  if (!Number.isFinite(startTimeMs)) {
    return {
      scale: toScale,
      active: Math.abs(toScale - 1) > PATH_TIP_HOVER_SCALE_EPSILON,
    };
  }
  if (!(PATH_TIP_HOVER_SCALE_DURATION_MS > 0)) {
    state.fromScale = toScale;
    state.startTimeMs = NaN;
    return {
      scale: toScale,
      active: Math.abs(toScale - 1) > PATH_TIP_HOVER_SCALE_EPSILON,
    };
  }
  const elapsed = nowMs - startTimeMs;
  if (elapsed <= 0) return { scale: fromScale, active: true };
  const linear = clampUnit(elapsed / PATH_TIP_HOVER_SCALE_DURATION_MS);
  const eased = easeOutCubic(linear);
  const scale = fromScale + ((toScale - fromScale) * eased);
  if (linear >= 1) {
    state.fromScale = toScale;
    state.startTimeMs = NaN;
    return {
      scale: toScale,
      active: Math.abs(toScale - 1) > PATH_TIP_HOVER_SCALE_EPSILON,
    };
  }
  return { scale, active: true };
};

const updatePathTipHoverScaleTarget = (state, targetScale, nowMs = getNowMs()) => {
  const safeTarget = Number.isFinite(targetScale) && targetScale > 0 ? targetScale : 1;
  if (Math.abs(safeTarget - (Number(state?.toScale) || 1)) <= PATH_TIP_HOVER_SCALE_EPSILON) return;
  const resolved = resolvePathTipHoverScaleValue(state, nowMs);
  state.fromScale = resolved.scale;
  state.toScale = safeTarget;
  state.startTimeMs = nowMs;
};

const isCellCurrentlyHovered = (cell) => Boolean(cell?.matches?.(':hover'));

const resolvePathTipHoverScales = (
  path,
  interactionModel = latestInteractionModel,
  nowMs = getNowMs(),
  out = pathTipHoverScaleScratch,
) => {
  out.startScale = 1;
  out.endScale = 1;
  out.active = false;

  if (isReducedMotionPreferred()) {
    clearPathTipHoverScaleStates();
    return out;
  }

  let targetStartScale = 1;
  let targetEndScale = 1;
  if (!interactionModel?.isPathDragging && Array.isArray(path) && path.length > 0) {
    const head = path[0] || null;
    const tail = path.length > 1 ? path[path.length - 1] : null;
    const startCell = head ? gridCells[head.r]?.[head.c] : null;
    const endCell = tail ? gridCells[tail.r]?.[tail.c] : null;
    if (isCellCurrentlyHovered(startCell)) targetStartScale = PATH_TIP_HOVER_UP_SCALE;
    if (isCellCurrentlyHovered(endCell)) targetEndScale = PATH_TIP_HOVER_UP_SCALE;
  }

  updatePathTipHoverScaleTarget(pathStartTipHoverScaleState, targetStartScale, nowMs);
  updatePathTipHoverScaleTarget(pathEndTipHoverScaleState, targetEndScale, nowMs);
  const resolvedStart = resolvePathTipHoverScaleValue(pathStartTipHoverScaleState, nowMs);
  const resolvedEnd = resolvePathTipHoverScaleValue(pathEndTipHoverScaleState, nowMs);
  out.startScale = Math.max(0, Number(resolvedStart.scale) || 0);
  out.endScale = Math.max(0, Number(resolvedEnd.scale) || 0);
  out.active = Boolean(resolvedStart.active || resolvedEnd.active);
  return out;
};

const hasActivePathTipHoverScale = (
  path,
  interactionModel = latestInteractionModel,
  nowMs = getNowMs(),
) => resolvePathTipHoverScales(path, interactionModel, nowMs, pathTipHoverScaleScratch).active;

const resolveStartPinDisappearRenderPoints = (
  path,
  nowMs = getNowMs(),
) => {
  const presence = resolvePathStartPinPresenceScale(path, nowMs, startPinPresenceScaleScratch);
  if (!presence.active || presence.mode !== 'disappear') return null;
  if (!pathLayoutMetrics.ready) return null;
  if (!Number.isFinite(presence.anchorR) || !Number.isFinite(presence.anchorC)) {
    return null;
  }

  const step = pathLayoutMetrics.cell + pathLayoutMetrics.gap;
  const half = pathLayoutMetrics.cell * 0.5;
  reusableStartPinPresencePoint.x = pathLayoutMetrics.offsetX
    + pathLayoutMetrics.pad
    + (presence.anchorC * step)
    + half;
  reusableStartPinPresencePoint.y = pathLayoutMetrics.offsetY
    + pathLayoutMetrics.pad
    + (presence.anchorR * step)
    + half;
  return reusableStartPinPresencePoints;
};

const beginPathReverseGradientBlend = (
  path,
  fromFlowOffset,
  fromTravelSpan,
  toFlowOffset,
  cycle = PATH_FLOW_CYCLE,
  nowMs = getNowMs(),
) => pathAnimationEngine.beginPathReverseGradientBlend(
  path,
  fromFlowOffset,
  fromTravelSpan,
  toFlowOffset,
  cycle,
  nowMs,
);

const resolvePathReverseGradientBlend = (
  path,
  cycle = PATH_FLOW_CYCLE,
  nowMs = getNowMs(),
  out = reverseGradientBlendScratch,
) => pathAnimationEngine.resolvePathReverseGradientBlend(path, cycle, nowMs, out);

const hasActivePathReverseGradientBlend = (
  path,
  cycle = PATH_FLOW_CYCLE,
  nowMs = getNowMs(),
) => pathAnimationEngine.hasActivePathReverseGradientBlend(path, cycle, nowMs);

const applyPathReverseGradientBlendToPayload = (
  path,
  cycle = PATH_FLOW_CYCLE,
  nowMs = getNowMs(),
) => {
  const reverseBlend = resolvePathReverseGradientBlend(path, cycle, nowMs, reverseGradientBlendScratch);
  const currentFlowOffset = normalizeFlowOffset(pathFramePayload.flowOffset, cycle);
  const reverseFromFlowOffset = reverseBlend.active
    ? normalizeFlowOffset(
      reverseBlend.fromFlowOffset + reverseBlend.toFlowOffset - currentFlowOffset,
      cycle,
    )
    : currentFlowOffset;
  pathFramePayload.reverseColorBlend = reverseBlend.blend;
  pathFramePayload.reverseFromFlowOffset = reverseFromFlowOffset;
  pathFramePayload.reverseTravelSpan = reverseBlend.active
    ? reverseBlend.fromTravelSpan
    : 0;
  return reverseBlend.active;
};

const updatePathReverseTipSwapState = (prevPath, nextPath, nowMs = getNowMs()) => (
  pathAnimationEngine.updatePathReverseTipSwapState(prevPath, nextPath, nowMs)
);

const resolvePathReverseTipSwapScale = (path, nowMs = getNowMs(), out = reverseTipScaleScratch) => (
  pathAnimationEngine.resolvePathReverseTipSwapScale(path, nowMs, out)
);

const hasActivePathReverseTipSwap = (path, nowMs = getNowMs()) => (
  pathAnimationEngine.hasActivePathReverseTipSwap(path, nowMs)
);

const applyPathReverseTipSwapToPayload = (path, nowMs = getNowMs()) => {
  const reverseTipScale = resolvePathReverseTipSwapScale(path, nowMs, reverseTipScaleScratch);
  const inScale = reverseTipScale.inScale;
  const outScale = reverseTipScale.outScale;
  const baseStartRadius = Number(pathFramePayload.baseStartRadius) || 0;
  const baseArrowLength = Number(pathFramePayload.baseArrowLength) || 0;
  const baseEndHalfWidth = Number(pathFramePayload.baseEndHalfWidth) || 0;
  pathFramePayload.startRadius = baseStartRadius * inScale;
  pathFramePayload.arrowLength = baseArrowLength * inScale;
  pathFramePayload.endHalfWidth = baseEndHalfWidth * inScale;
  pathFramePayload.reverseHeadArrowLength = baseArrowLength * outScale;
  pathFramePayload.reverseHeadArrowHalfWidth = baseEndHalfWidth * outScale;
  pathFramePayload.reverseTailCircleRadius = baseStartRadius * outScale;
  return reverseTipScale.active;
};

const getPathRenderPointsForFrame = (
  path,
  nowMs = getNowMs(),
  flowWidth = pathFramePayload.width,
  startRadius = pathFramePayload.startRadius,
  endHalfWidth = pathFramePayload.endHalfWidth,
) => {
  if (isReducedMotionPreferred()) {
    pathAnimationEngine.resetTransitionState({ preserveFlowFreeze: true });
    clearPathRetainedArcStates();
    return {
      points: reusablePathPoints,
      geometryToken: pathGeometryToken,
      flowTravelCompensation: 0,
      segmentRetractTipScale: 1,
      retainedStartArcPoints: [],
      retainedStartArcGeometryToken: NaN,
      retainedEndArcPoints: [],
      retainedEndArcGeometryToken: NaN,
    };
  }

  const pathLength = Array.isArray(path) ? path.length : 0;
  const resolvedWidth = Number.isFinite(flowWidth) && flowWidth > 0
    ? flowWidth
    : Math.max(1, Number(pathFramePayload.width) || 1);
  const startCoverageRadius = Math.max(0, Number(startRadius) || 0);
  const endCoverageRadius = Math.max(
    resolvedWidth * 0.5,
    Math.max(0, Number(endHalfWidth) || 0),
  );

  const resolveRetainedArcs = (
    startTipCenterX = NaN,
    startTipCenterY = NaN,
    endTipCenterX = NaN,
    endTipCenterY = NaN,
    startTipMoving = false,
    endTipMoving = false,
  ) => {
    const startArc = resolveSinglePathRetainedArc(
      'start',
      path,
      resolvedWidth,
      startCoverageRadius,
      nowMs,
      startTipMoving,
      startTipCenterX,
      startTipCenterY,
      retainedArcRenderScratchA,
    );
    const endArc = resolveSinglePathRetainedArc(
      'end',
      path,
      resolvedWidth,
      endCoverageRadius,
      nowMs,
      endTipMoving,
      endTipCenterX,
      endTipCenterY,
      retainedArcRenderScratchB,
    );
    return {
      retainedStartArcPoints: startArc.points,
      retainedStartArcGeometryToken: startArc.geometryToken,
      retainedEndArcPoints: endArc.points,
      retainedEndArcGeometryToken: endArc.geometryToken,
    };
  };

  if (pathLength <= 0 || reusablePathPoints.length !== pathLength) {
    if (pathLength <= 0) {
      const retainedArcs = resolveRetainedArcs();
      const syntheticPoints = resolveStartPinDisappearRenderPoints(path, nowMs);
      if (syntheticPoints) {
        return {
          points: syntheticPoints,
          geometryToken: NaN,
          flowTravelCompensation: 0,
          segmentRetractTipScale: 1,
          ...retainedArcs,
        };
      }
      return {
        points: reusablePathPoints,
        geometryToken: pathGeometryToken,
        flowTravelCompensation: 0,
        segmentRetractTipScale: 1,
        ...retainedArcs,
      };
    }
    const retainedArcs = resolveRetainedArcs();
    return {
      points: reusablePathPoints,
      geometryToken: pathGeometryToken,
      flowTravelCompensation: 0,
      segmentRetractTipScale: 1,
      ...retainedArcs,
    };
  }

  const startTip = getPathTipFromPath(path, 'start');
  const endTip = getPathTipFromPath(path, 'end');
  const startOffset = resolvePathTipArrivalOffset('start', startTip, nowMs, arrivalOffsetScratchA);
  const endOffset = resolvePathTipArrivalOffset('end', endTip, nowMs, arrivalOffsetScratchB);
  const startHasRetract = startOffset.active && startOffset.mode === 'retract';
  const endHasRetract = endOffset.active && endOffset.mode === 'retract';
  const startTargetPoint = reusablePathPoints[0] || null;
  const endTargetPoint = reusablePathPoints[pathLength - 1] || null;
  const startTipCenterX = startTargetPoint
    ? startTargetPoint.x + (startHasRetract ? startOffset.x : 0)
    : NaN;
  const startTipCenterY = startTargetPoint
    ? startTargetPoint.y + (startHasRetract ? startOffset.y : 0)
    : NaN;
  const endTipCenterX = endTargetPoint
    ? endTargetPoint.x + (endHasRetract ? endOffset.x : 0)
    : NaN;
  const endTipCenterY = endTargetPoint
    ? endTargetPoint.y + (endHasRetract ? endOffset.y : 0)
    : NaN;
  const retainedArcs = resolveRetainedArcs(
    startTipCenterX,
    startTipCenterY,
    endTipCenterX,
    endTipCenterY,
    startHasRetract,
    endHasRetract,
  );
  if (!startOffset.active && !endOffset.active) {
    return {
      points: reusablePathPoints,
      geometryToken: pathGeometryToken,
      flowTravelCompensation: 0,
      segmentRetractTipScale: 1,
      ...retainedArcs,
    };
  }

  const renderLength = pathLength + (startHasRetract ? 1 : 0) + (endHasRetract ? 1 : 0);
  if (reusableArrivalPathPoints.length < renderLength) {
    for (let i = reusableArrivalPathPoints.length; i < renderLength; i++) {
      reusableArrivalPathPoints.push({ x: 0, y: 0 });
    }
  }
  reusableArrivalPathPoints.length = renderLength;
  let writeIndex = 0;

  if (startHasRetract) {
    const target = reusablePathPoints[0];
    const ghost = reusableArrivalPathPoints[writeIndex];
    ghost.x = target.x + startOffset.x;
    ghost.y = target.y + startOffset.y;
    writeIndex += 1;
  }

  for (let i = 0; i < pathLength; i++) {
    const src = reusablePathPoints[i];
    const dst = reusableArrivalPathPoints[writeIndex];
    dst.x = src.x;
    dst.y = src.y;
    if (i === 0 && startOffset.active && startOffset.mode === 'arrive') {
      dst.x += startOffset.x;
      dst.y += startOffset.y;
    }
    if (i === pathLength - 1 && endOffset.active && endOffset.mode === 'arrive') {
      dst.x += endOffset.x;
      dst.y += endOffset.y;
    }
    writeIndex += 1;
  }

  if (endHasRetract && pathLength > 0) {
    const target = reusablePathPoints[pathLength - 1];
    const ghost = reusableArrivalPathPoints[writeIndex];
    ghost.x = target.x + endOffset.x;
    ghost.y = target.y + endOffset.y;
  }

  let flowTravelCompensation = 0;
  if (pathLength > 1 && startOffset.active) {
    const baseTravel = getPathMainTravelFromPoints(reusablePathPoints, resolvedWidth);
    const renderTravel = getPathMainTravelFromPoints(
      reusableArrivalPathPoints,
      resolvedWidth,
    );
    if (Number.isFinite(baseTravel) && Number.isFinite(renderTravel)) {
      flowTravelCompensation = baseTravel - renderTravel;
    }
  }
  let segmentRetractTipScale = 1;
  if (pathLength === 1) {
    if (startHasRetract) {
      segmentRetractTipScale = Math.min(
        segmentRetractTipScale,
        clampUnit(Number(startOffset.linearRemain)),
      );
    }
    if (endHasRetract) {
      segmentRetractTipScale = Math.min(
        segmentRetractTipScale,
        clampUnit(Number(endOffset.linearRemain)),
      );
    }
  }
  return {
    points: reusableArrivalPathPoints,
    geometryToken: NaN,
    flowTravelCompensation,
    segmentRetractTipScale,
    ...retainedArcs,
  };
};



let realTimeLastMs = 0;
let scaledTimeAccumulatorMs = 0;

const getNowMs = () => {
  const getRealTime = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  const currentRealTime = getRealTime();
  if (realTimeLastMs === 0) {
    realTimeLastMs = currentRealTime;
    scaledTimeAccumulatorMs = currentRealTime;
  }

  const delta = currentRealTime - realTimeLastMs;
  realTimeLastMs = currentRealTime;

  const speedMultiplier = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV && typeof window.TETHER_DEBUG_ANIM_SPEED === 'number'
    ? Math.max(0.1, window.TETHER_DEBUG_ANIM_SPEED)
    : 1;

  scaledTimeAccumulatorMs += (delta / speedMultiplier);
  return scaledTimeAccumulatorMs;
};

const getCompletionProgress = (completionModel = latestCompletionModel) => {
  if (!completionModel || !completionModel.isSolved) return 0;
  if (!completionModel.isCompleting) return 1;

  const durationMs = Number(completionModel.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  const startTimeMs = Number(completionModel.startTimeMs);
  if (!Number.isFinite(startTimeMs)) return 0;

  const elapsedMs = getNowMs() - startTimeMs;
  return clampUnit(elapsedMs / durationMs);
};

const getPathFlowMetrics = (refs = latestPathRefs, out = null, cellSize = null) => {
  const cell = Number.isFinite(cellSize) && cellSize > 0
    ? cellSize
    : getCellSize(refs?.gridEl);
  const scale = Number.isFinite(cell) && cell > 0
    ? cell / PATH_FLOW_BASE_CELL
    : 1;
  const cycle = Math.max(18, PATH_FLOW_CYCLE * scale);
  const pulse = Math.max(6, Math.min(PATH_FLOW_PULSE * scale, cycle));
  const speed = PATH_FLOW_SPEED * scale;
  if (out) {
    out.cycle = cycle;
    out.pulse = pulse;
    out.speed = speed;
    return out;
  }
  return { cycle, pulse, speed };
};

const getPathMainTravelFromPoints = (points, flowWidth, maxSegments = null) => {
  const pointCount = Array.isArray(points) ? points.length : 0;
  if (pointCount < 2) return 0;

  const width = Number.isFinite(flowWidth) && flowWidth > 0 ? flowWidth : 1;
  const cornerRadius = width * 0.5;
  const segmentCount = pointCount - 1;
  const segmentLengths = new Array(segmentCount).fill(0);
  const segmentUx = new Array(segmentCount).fill(0);
  const segmentUy = new Array(segmentCount).fill(0);

  for (let i = 0; i < segmentCount; i++) {
    const start = points[i];
    const end = points[i + 1];
    const startX = Number(start?.x);
    const startY = Number(start?.y);
    const endX = Number(end?.x);
    const endY = Number(end?.y);
    if (
      !Number.isFinite(startX)
      || !Number.isFinite(startY)
      || !Number.isFinite(endX)
      || !Number.isFinite(endY)
    ) {
      continue;
    }
    const dx = endX - startX;
    const dy = endY - startY;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    segmentLengths[i] = len;
    segmentUx[i] = dx / len;
    segmentUy[i] = dy / len;
  }

  const cornerTangents = new Array(pointCount).fill(0);
  const cornerArcs = new Array(pointCount).fill(0);
  for (let i = 1; i < pointCount - 1; i++) {
    const inLen = segmentLengths[i - 1];
    const outLen = segmentLengths[i];
    if (!(inLen > 0) || !(outLen > 0)) continue;

    const inAngle = Math.atan2(segmentUy[i - 1], segmentUx[i - 1]);
    const outAngle = Math.atan2(segmentUy[i], segmentUx[i]);
    const absTurn = Math.abs(angleDeltaSigned(inAngle, outAngle));
    if (
      absTurn <= FLOW_TRAVEL_ANGLE_TOLERANCE
      || absTurn >= Math.PI - FLOW_TRAVEL_ANGLE_TOLERANCE
    ) {
      continue;
    }

    const tangentScale = Math.tan(absTurn * 0.5);
    if (!(tangentScale > 0) || !Number.isFinite(tangentScale)) continue;
    const tangentOffset = cornerRadius * tangentScale;
    const maxTangentOffset = Math.max(0, Math.min(inLen, outLen));
    const effectiveTangentOffset = Math.min(tangentOffset, maxTangentOffset);
    if (!(effectiveTangentOffset > 0) || !Number.isFinite(effectiveTangentOffset)) continue;
    const effectiveRadius = effectiveTangentOffset / tangentScale;
    if (!(effectiveRadius > 0) || !Number.isFinite(effectiveRadius)) continue;
    cornerTangents[i] = effectiveTangentOffset;
    cornerArcs[i] = effectiveRadius * absTurn;
  }

  const segmentLimit = Number.isInteger(maxSegments)
    ? Math.max(0, Math.min(segmentCount, maxSegments))
    : segmentCount;

  let flowTravel = 0;
  for (let i = 0; i < segmentLimit; i++) {
    const len = segmentLengths[i];
    if (!(len > 0)) continue;

    const trimStart = cornerTangents[i] > 0 ? Math.min(len, cornerTangents[i]) : 0;
    const trimEnd = cornerTangents[i + 1] > 0 ? Math.min(len, cornerTangents[i + 1]) : 0;
    const drawableStart = trimStart;
    const drawableEnd = Math.max(drawableStart, len - trimEnd);
    flowTravel += Math.max(0, drawableEnd - drawableStart);
    flowTravel += Math.max(0, cornerArcs[i + 1] || 0);
  }

  return flowTravel;
};

const resolveCompensationFlowWidth = (gridEl = null, flowWidth = null) => {
  if (Number.isFinite(flowWidth) && flowWidth > 0) return flowWidth;
  const cell = pathLayoutMetrics.ready
    ? pathLayoutMetrics.cell
    : getCellSize(gridEl);
  const deviceScale = getDevicePixelScale();
  return Math.max(7, snapCssToDevicePixel(Math.floor(cell * 0.15), deviceScale));
};

const getPathPrefixTravelFromCells = (
  path,
  prefixLength,
  refs = {},
  offset = { x: 0, y: 0 },
  flowWidth = null,
) => {
  if (!Array.isArray(path) || path.length < 2) return 0;
  const safePrefixLength = Math.min(path.length, Math.max(0, Number(prefixLength) || 0));
  if (safePrefixLength < 2) return 0;

  const { gridEl } = refs;
  if (!gridEl && !pathLayoutMetrics.ready) return 0;

  const resolvedWidth = resolveCompensationFlowWidth(gridEl, flowWidth);

  const points = new Array(safePrefixLength);
  for (let i = 0; i < safePrefixLength; i += 1) {
    const p = getCellPointFromLayout(path[i].r, path[i].c)
      || getCellPoint(path[i].r, path[i].c, { gridEl }, offset);
    points[i] = { x: p.x, y: p.y };
  }
  return getPathMainTravelFromPoints(points, resolvedWidth);
};

const getPathTravelToSegmentStartFromCells = (
  path,
  segmentStartIndex,
  refs = {},
  offset = { x: 0, y: 0 },
  flowWidth = null,
) => {
  if (!Array.isArray(path) || path.length < 2) return 0;
  const safeSegmentStartIndex = Math.min(
    path.length - 1,
    Math.max(0, Number(segmentStartIndex) || 0),
  );
  if (safeSegmentStartIndex <= 0) return 0;

  const { gridEl } = refs;
  if (!gridEl && !pathLayoutMetrics.ready) return 0;

  const resolvedWidth = resolveCompensationFlowWidth(gridEl, flowWidth);

  const points = new Array(path.length);
  for (let i = 0; i < path.length; i += 1) {
    const p = getCellPointFromLayout(path[i].r, path[i].c)
      || getCellPoint(path[i].r, path[i].c, { gridEl }, offset);
    points[i] = { x: p.x, y: p.y };
  }
  return getPathMainTravelFromPoints(points, resolvedWidth, safeSegmentStartIndex);
};

const getHeadShiftDelta = (nextPath, previousPath, refs = {}, offset = { x: 0, y: 0 }) => {
  const { gridEl } = refs;
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return 0;

  const transitionWindow = resolveHeadShiftTransitionWindow(nextPath, previousPath);
  if (!transitionWindow) return 0;
  const {
    shiftCount: headShiftStepCount,
    nextStart,
    prevStart,
    overlap,
    isFullLengthOverlap,
    isPureHeadShift,
  } = transitionWindow;
  const shouldUseSegmentStartAnchor = (
    overlap >= 2
    && !isFullLengthOverlap
    && nextStart > 0
    && prevStart > 0
  );

  const resolvedCell = getCellSize(gridEl);
  const safeCell = Number.isFinite(resolvedCell) && resolvedCell > 0
    ? resolvedCell
    : PATH_FLOW_BASE_CELL;

  const flowWidth = resolveCompensationFlowWidth(gridEl);
  if (isPureHeadShift) {
    const previousTravel = getPathPrefixTravelFromCells(
      previousPath,
      previousPath.length,
      refs,
      offset,
      flowWidth,
    );
    const nextTravel = getPathPrefixTravelFromCells(
      nextPath,
      nextPath.length,
      refs,
      offset,
      flowWidth,
    );
    const shift = previousTravel - nextTravel;
    if (Number.isFinite(shift) && shift !== 0) return shift;
  }

  if (shouldUseSegmentStartAnchor) {
    const previousSegmentStartTravel = getPathTravelToSegmentStartFromCells(
      previousPath,
      prevStart,
      refs,
      offset,
      flowWidth,
    );
    const nextSegmentStartTravel = getPathTravelToSegmentStartFromCells(
      nextPath,
      nextStart,
      refs,
      offset,
      flowWidth,
    );
    const shift = previousSegmentStartTravel - nextSegmentStartTravel;
    if (Number.isFinite(shift) && shift !== 0) return shift;
  }

  if (overlap >= 1) {
    const previousNodeTravel = getPathPrefixTravelFromCells(
      previousPath,
      prevStart + 1,
      refs,
      offset,
      flowWidth,
    );
    const nextNodeTravel = getPathPrefixTravelFromCells(
      nextPath,
      nextStart + 1,
      refs,
      offset,
      flowWidth,
    );
    const shift = previousNodeTravel - nextNodeTravel;
    if (Number.isFinite(shift) && shift !== 0) return shift;
  }

  const fallbackStep = (path) => Math.max(1, cellDistance(path?.[0], path?.[1]) * safeCell);
  const stepCount = Math.abs(headShiftStepCount);
  return headShiftStepCount > 0
    ? -(fallbackStep(nextPath) * stepCount)
    : (fallbackStep(previousPath) * stepCount);
};

const transitionCompensationBuffer = createPathTransitionCompensationBuffer({
  resolveShift: (nextPath, previousPath, refs = null) => {
    const activeRefs = refs || latestPathRefs || null;
    if (!pathLayoutMetrics.ready && !activeRefs?.gridEl) return 0;
    const shift = getHeadShiftDelta(
      nextPath,
      previousPath,
      activeRefs || {},
      getGridCanvasOffset(activeRefs || {}, headOffsetScratch),
    );
    if (!Number.isFinite(shift) || shift === 0) return 0;
    return shift * PATH_FLOW_ANCHOR_RATIO;
  },
});



const shouldAnimatePathFlow = (
  snapshot,
  completionModel = latestCompletionModel,
  tutorialFlags = latestTutorialFlags,
) => {
  if (isReducedMotionPreferred()) return false;
  if (snapshot && snapshot.path.length > 1) return true;
  return Boolean(tutorialFlags?.path || tutorialFlags?.movable);
};

const stopPathAnimation = () => {
  if (pathAnimationFrame) cancelAnimationFrame(pathAnimationFrame);
  pathAnimationFrame = 0;
  pathAnimationLastTs = 0;
};

const advancePathFlowOffset = (timestamp, flowMix, shouldAnimateFlow) => {
  if (!shouldAnimateFlow || flowMix <= PATH_FLOW_FREEZE_EPSILON || pathAnimationLastTs <= 0) return;
  const dt = Math.max(0, (timestamp - pathAnimationLastTs) / 1000);
  if (!Number.isFinite(dt)) return;
  const baseFlowSpeed = Number.isFinite(pathFramePayload.flowBaseSpeed)
    ? pathFramePayload.flowBaseSpeed
    : PATH_FLOW_SPEED;
  const flowSpeed = baseFlowSpeed * clampUnit(flowMix);
  pathFramePayload.flowSpeed = flowSpeed;
  const flowCycle = Number.isFinite(pathFramePayload.flowCycle) && pathFramePayload.flowCycle > 0
    ? pathFramePayload.flowCycle
    : PATH_FLOW_CYCLE;
  pathAnimationOffset = normalizeFlowOffset(
    pathAnimationOffset + (dt * flowSpeed),
    flowCycle,
  );
};

const flushPendingRenderFrame = (timestamp) => {
  const frame = pendingRenderState;
  pendingRenderState = null;
  if (!frame || !refs) {
    clearPendingRenderDirty();
    return false;
  }

  const tutorialFlags = frame.uiModel?.tutorialFlags || null;
  const interactionModel = latestInteractionModel || {};

  if (pendingRenderDirty.cells) {
    updateCells(
      frame.snapshot,
      frame.evaluation,
      refs,
      frame.completion,
      interactionModel,
      tutorialFlags,
    );
  } else {
    syncPathTipDragHoverCell(interactionModel);
    pathAnimationEngine.setInteractionModel(interactionModel);
  }

  if (
    pendingRenderDirty.message
    && Object.prototype.hasOwnProperty.call(frame.uiModel || {}, 'messageHtml')
  ) {
    setMessage(refs.msgEl, frame.uiModel.messageKind || null, frame.uiModel.messageHtml || '');
  }

  if (pendingRenderDirty.interaction || pendingRenderDirty.cells) {
    applyInteractionState(interactionModel);
  }

  const nowMs = getNowMs();
  syncPathFlowFreezeTarget(isPathFlowFrozen(), nowMs);
  const flowFreeze = resolvePathFlowFreezeMix(nowMs, pathFlowFreezeMixScratch);
  advancePathFlowOffset(
    timestamp,
    flowFreeze.mix,
    shouldAnimatePathFlow(frame.snapshot, frame.completion, tutorialFlags),
  );

  clearPendingRenderDirty();
  countHeavyFrameRenders();
  const shouldContinue = drawAllImpl(
    frame.snapshot,
    refs,
    frame.evaluation,
    frame.completion,
    tutorialFlags,
  );
  pathAnimationLastTs = shouldContinue ? timestamp : 0;
  return shouldContinue;
};

const runAnimationOnlyFrame = (timestamp) => {
  const nowMs = getNowMs();

  if (!latestPathSnapshot || !latestPathRefs) {
    pathAnimationLastTs = 0;
    return false;
  }

  syncPathFlowFreezeTarget(isPathFlowFrozen(), nowMs);
  const flowFreeze = resolvePathFlowFreezeMix(nowMs, pathFlowFreezeMixScratch);
  const baseAnimateFlow = shouldAnimatePathFlow(
    latestPathSnapshot,
    latestCompletionModel,
    latestTutorialFlags,
  );
  const animateFlow = baseAnimateFlow && flowFreeze.mix > PATH_FLOW_FREEZE_EPSILON;
  const animateFlowVisibility = (
    hasActivePathFlowVisibility(latestPathSnapshot.path, nowMs)
    && flowFreeze.mix > PATH_FLOW_FREEZE_EPSILON
  );
  const animateTipArrivals = hasActivePathTipArrivals(nowMs);
  const animateRetainedArc = hasActivePathRetainedArc(latestPathSnapshot.path, nowMs);
  const animateEndArrowRotate = hasActivePathEndArrowRotate(latestPathSnapshot.path, nowMs);
  const animateStartFlowRotate = hasActivePathStartFlowRotate(latestPathSnapshot.path, nowMs);
  const animateStartPinPresence = hasActivePathStartPinPresence(latestPathSnapshot.path, nowMs);
  const animateTipHoverScale = hasActivePathTipHoverScale(
    latestPathSnapshot.path,
    latestInteractionModel,
    nowMs,
  );
  const animateReverseTipSwap = hasActivePathReverseTipSwap(latestPathSnapshot.path, nowMs);
  const animateReverseGradientBlend = hasActivePathReverseGradientBlend(
    latestPathSnapshot.path,
    pathFramePayload.flowCycle,
    nowMs,
  );
  const shouldContinue = (
    flowFreeze.active
    || animateFlow
    || animateFlowVisibility
    || animateTipArrivals
    || animateRetainedArc
    || animateEndArrowRotate
    || animateStartFlowRotate
    || animateStartPinPresence
    || animateTipHoverScale
    || animateReverseTipSwap
    || animateReverseGradientBlend
  );

  if (!shouldContinue) {
    pathAnimationLastTs = 0;
    drawAllInternal(
      latestPathSnapshot,
      latestPathRefs,
      latestPathStatuses,
      0,
      latestCompletionModel,
      latestTutorialFlags,
    );
    return false;
  }

  advancePathFlowOffset(timestamp, flowFreeze.mix, animateFlow || animateFlowVisibility);

  pathAnimationLastTs = timestamp;
  const flowOffset = (animateFlow || animateFlowVisibility || flowFreeze.active) ? pathAnimationOffset : 0;
  drawIdleAnimatedPath(flowOffset, latestCompletionModel, nowMs);
  return true;
};

const runRendererFrame = (timestamp) => {
  pathAnimationFrame = 0;
  lastPresentedFrameTimestamp = Number.isFinite(timestamp) ? timestamp : getNowMs();
  let shouldContinue = false;
  if (pendingRenderState) {
    shouldContinue = flushPendingRenderFrame(timestamp);
  } else {
    if (pendingRenderDirty.interaction) {
      applyInteractionState(latestInteractionModel || {});
      pendingRenderDirty.interaction = false;
    }
    shouldContinue = runAnimationOnlyFrame(timestamp);
  }
  if (pendingRenderState || pendingRenderDirty.interaction || shouldContinue) {
    scheduleRendererFrame();
  }
};

const scheduleRendererFrame = () => {
  if (pathAnimationFrame || lowPowerFrameDelayTimer) return;
  if (!lowPowerModeEnabled) {
    pathAnimationFrame = requestAnimationFrame(runRendererFrame);
    return;
  }

  const nowMs = (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  );
  const elapsedMs = lastPresentedFrameTimestamp > 0
    ? (nowMs - lastPresentedFrameTimestamp)
    : LOW_POWER_FRAME_INTERVAL_MS;
  const waitMs = Math.max(0, LOW_POWER_FRAME_INTERVAL_MS - elapsedMs);
  if (waitMs <= 0) {
    pathAnimationFrame = requestAnimationFrame(runRendererFrame);
    return;
  }

  lowPowerFrameDelayTimer = setTimeout(() => {
    lowPowerFrameDelayTimer = 0;
    if (!pathAnimationFrame) {
      pathAnimationFrame = requestAnimationFrame(runRendererFrame);
    }
  }, waitMs);
};



const parsePx = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDevicePixelScale = () => {
  const dpr = typeof window !== 'undefined'
    ? Number(window.devicePixelRatio)
    : NaN;
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (!lowPowerModeEnabled) return safeDpr;
  return Math.max(1, safeDpr / 2);
};

const snapCssToDevicePixel = (value, scale = getDevicePixelScale()) => {
  const safeScale = scale > 0 ? scale : 1;
  return Math.round((Number(value) || 0) * safeScale) / safeScale;
};

const getCanvasScale = (ctx) => {
  if (!ctx || typeof ctx.getTransform !== 'function') {
    return { x: 1, y: 1, min: 1 };
  }
  const matrix = ctx.getTransform();
  const scaleX = Math.abs(Number(matrix?.a) || 1);
  const scaleY = Math.abs(Number(matrix?.d) || 1);
  return {
    x: scaleX > 0 ? scaleX : 1,
    y: scaleY > 0 ? scaleY : 1,
    min: Math.max(1, Math.min(scaleX > 0 ? scaleX : 1, scaleY > 0 ? scaleY : 1)),
  };
};

const snapCanvasLength = (value, scale) => {
  const safeScale = scale > 0 ? scale : 1;
  return Math.max(1, Math.round(Math.max(0, Number(value) || 0) * safeScale)) / safeScale;
};

const snapCanvasPoint = (value, scale) => {
  const safeScale = scale > 0 ? scale : 1;
  return Math.round((Number(value) || 0) * safeScale) / safeScale;
};

const configureHiDPICanvas = (canvas, ctx, cssWidth, cssHeight, dpr = getDevicePixelScale()) => {
  const safeCssWidth = Math.max(1, cssWidth);
  const safeCssHeight = Math.max(1, cssHeight);
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const pixelWidth = Math.max(1, Math.round(safeCssWidth * safeDpr));
  const pixelHeight = Math.max(1, Math.round(safeCssHeight * safeDpr));
  const scaleX = pixelWidth / safeCssWidth;
  const scaleY = pixelHeight / safeCssHeight;

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const cssWidthPx = `${safeCssWidth}px`;
  const cssHeightPx = `${safeCssHeight}px`;
  if (canvas.style.width !== cssWidthPx) canvas.style.width = cssWidthPx;
  if (canvas.style.height !== cssHeightPx) canvas.style.height = cssHeightPx;

  ctx.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    CANVAS_ALIGN_OFFSET_CSS_PX * scaleX,
    CANVAS_ALIGN_OFFSET_CSS_PX * scaleY,
  );
  ctx.imageSmoothingEnabled = false;
};

const clearCanvas = (ctx, canvas) => {
  if (!ctx || !canvas) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
};

const forceOpaqueColor = (color) => {
  if (typeof color !== 'string') return '#ffffff';
  const trimmed = color.trim();

  const rgba = trimmed.match(
    /^rgba\s*\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*\)$/i,
  );
  if (rgba) {
    return `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})`;
  }

  const hsla = trimmed.match(
    /^hsla\s*\(\s*([+\-]?\d*\.?\d+(?:deg|rad|turn)?)\s*,\s*([+\-]?\d*\.?\d+%)\s*,\s*([+\-]?\d*\.?\d+%)\s*,\s*([+\-]?\d*\.?\d+)\s*\)$/i,
  );
  if (hsla) {
    return `hsl(${hsla[1]}, ${hsla[2]}, ${hsla[3]})`;
  }

  return trimmed;
};

const parseColorToRgb = (color, out = null) => {
  if (typeof color !== 'string' || typeof document === 'undefined') return null;
  if (!colorParserCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    colorParserCtx = canvas.getContext('2d');
  }
  if (!colorParserCtx) return null;

  try {
    colorParserCtx.fillStyle = '#000000';
    colorParserCtx.fillStyle = color;
  } catch {
    return null;
  }

  const resolved = String(colorParserCtx.fillStyle || '').trim();
  if (!resolved) return null;

  const hex = resolved.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = parseInt(hex[1], 16);
    const target = out || { r: 0, g: 0, b: 0 };
    target.r = (value >> 16) & 0xff;
    target.g = (value >> 8) & 0xff;
    target.b = value & 0xff;
    return target;
  }

  const rgb = resolved.match(
    /^rgba?\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)/i,
  );
  if (rgb) {
    const target = out || { r: 0, g: 0, b: 0 };
    target.r = Math.max(0, Math.min(255, Math.round(Number(rgb[1]))));
    target.g = Math.max(0, Math.min(255, Math.round(Number(rgb[2]))));
    target.b = Math.max(0, Math.min(255, Math.round(Number(rgb[3]))));
    return target;
  }

  return null;
};

const resolveThemeGoodColor = (styles, fallback = '#16a34a') => {
  if (!styles) return fallback;

  const goodRgbRaw = styles.getPropertyValue('--good-rgb').trim();
  if (goodRgbRaw) {
    const goodFromRgb = `rgb(${goodRgbRaw})`;
    if (parseColorToRgb(goodFromRgb, themeColorScratch)) {
      return goodFromRgb;
    }
  }

  const goodRaw = forceOpaqueColor(styles.getPropertyValue('--good').trim());
  if (goodRaw && parseColorToRgb(goodRaw, themeColorScratch)) {
    return goodRaw;
  }

  return fallback;
};

const updatePathThemeCache = (refs = latestPathRefs) => {
  const styleTarget = refs?.boardWrap || document.documentElement;
  if (!styleTarget || typeof getComputedStyle !== 'function') return;
  const styles = getComputedStyle(styleTarget);
  const nextLineRaw = forceOpaqueColor(styles.getPropertyValue('--line').trim());
  const nextGoodRaw = resolveThemeGoodColor(styles, '#16a34a');
  const nextBadRaw = forceOpaqueColor(styles.getPropertyValue('--bad').trim() || '#e85c5c');
  const nextStitchShadowRaw = forceOpaqueColor(styles.getPropertyValue('--stitchShadow').trim() || '#0a111b');
  const isLightTheme = Boolean(document?.documentElement?.classList?.contains('theme-light'));

  if (!pathThemeCacheInitialized || pathThemeLineRaw !== nextLineRaw) {
    const parsed = parseColorToRgb(nextLineRaw, pathThemeMainRgb);
    if (parsed) pathThemeMainRgb = parsed;
    pathThemeLineRaw = nextLineRaw;
  }
  if (!pathThemeCacheInitialized || pathThemeGoodRaw !== nextGoodRaw) {
    const parsed = parseColorToRgb(nextGoodRaw, pathThemeCompleteRgb);
    if (parsed) pathThemeCompleteRgb = parsed;
    pathThemeGoodRaw = nextGoodRaw;
  }
  pathThemeBadRaw = nextBadRaw;
  pathThemeStitchShadowRaw = nextStitchShadowRaw;
  pathThemeCornerPending = isLightTheme ? '#0f172a' : '#ffffff';
  pathThemeCornerFill = isLightTheme ? 'rgb(248, 251, 255)' : 'rgb(11, 15, 20)';
  pathThemeCacheInitialized = true;
};

const getCachedPathFlowMetrics = (refs = latestPathRefs, cellSize = null) => {
  const resolvedCell = Number.isFinite(cellSize) && cellSize > 0
    ? cellSize
    : getCellSize(refs?.gridEl);
  if (resolvedCell !== lastFlowMetricCell) {
    const prevCycle = Number(pathFlowMetricsCache.cycle);
    getPathFlowMetrics(refs, pathFlowMetricsCache, resolvedCell);
    const nextCycle = Number(pathFlowMetricsCache.cycle);
    if (
      Number.isFinite(prevCycle)
      && prevCycle > 0
      && Number.isFinite(nextCycle)
      && nextCycle > 0
      && prevCycle !== nextCycle
    ) {
      const phaseUnit = normalizeFlowOffset(pathAnimationOffset, prevCycle) / prevCycle;
      pathAnimationOffset = normalizeFlowOffset(phaseUnit * nextCycle, nextCycle);
    }
    lastFlowMetricCell = resolvedCell;
  }
  return pathFlowMetricsCache;
};

const isReducedMotionPreferred = () => {
  if (lowPowerModeEnabled) return true;
  return readReducedMotionPreference();
};

const updatePathLayoutMetrics = (offset, cell, gap, pad) => {
  const nextOffsetX = Number(offset?.x) || 0;
  const nextOffsetY = Number(offset?.y) || 0;
  const nextCell = Number.isFinite(cell) && cell > 0 ? cell : pathLayoutMetrics.cell;
  const nextGap = Number.isFinite(gap) ? gap : pathLayoutMetrics.gap;
  const nextPad = Number.isFinite(pad) ? pad : pathLayoutMetrics.pad;
  const changed = (
    !pathLayoutMetrics.ready
    || pathLayoutMetrics.offsetX !== nextOffsetX
    || pathLayoutMetrics.offsetY !== nextOffsetY
    || pathLayoutMetrics.cell !== nextCell
    || pathLayoutMetrics.gap !== nextGap
    || pathLayoutMetrics.pad !== nextPad
  );
  if (changed) {
    pathLayoutMetrics.offsetX = nextOffsetX;
    pathLayoutMetrics.offsetY = nextOffsetY;
    pathLayoutMetrics.cell = nextCell;
    pathLayoutMetrics.gap = nextGap;
    pathLayoutMetrics.pad = nextPad;
    pathLayoutMetrics.version += 1;
    lastFlowMetricCell = NaN;
  }
  pathLayoutMetrics.ready = true;
  return pathLayoutMetrics;
};

const updateBoardLayoutMetrics = (metrics = {}) => {
  const nextRows = Number.isInteger(metrics.rows) ? metrics.rows : activeBoardSize.rows;
  const nextCols = Number.isInteger(metrics.cols) ? metrics.cols : activeBoardSize.cols;
  const nextLeft = Number(metrics.left) || 0;
  const nextTop = Number(metrics.top) || 0;
  const nextRight = Number(metrics.right) || nextLeft;
  const nextBottom = Number(metrics.bottom) || nextTop;
  const nextSize = Number.isFinite(metrics.size) && metrics.size > 0
    ? metrics.size
    : boardLayoutMetrics.size;
  const nextGap = Number.isFinite(metrics.gap) ? metrics.gap : boardLayoutMetrics.gap;
  const nextPad = Number.isFinite(metrics.pad) ? metrics.pad : boardLayoutMetrics.pad;
  const nextStep = Number.isFinite(metrics.step) && metrics.step > 0
    ? metrics.step
    : (nextSize + nextGap);
  const nextScrollX = Number.isFinite(metrics.scrollX) ? metrics.scrollX : boardLayoutMetrics.scrollX;
  const nextScrollY = Number.isFinite(metrics.scrollY) ? metrics.scrollY : boardLayoutMetrics.scrollY;
  const changed = (
    !boardLayoutMetrics.ready
    || boardLayoutMetrics.rows !== nextRows
    || boardLayoutMetrics.cols !== nextCols
    || boardLayoutMetrics.left !== nextLeft
    || boardLayoutMetrics.top !== nextTop
    || boardLayoutMetrics.right !== nextRight
    || boardLayoutMetrics.bottom !== nextBottom
    || boardLayoutMetrics.size !== nextSize
    || boardLayoutMetrics.gap !== nextGap
    || boardLayoutMetrics.pad !== nextPad
    || boardLayoutMetrics.step !== nextStep
  );
  if (changed) {
    boardLayoutMetrics.rows = nextRows;
    boardLayoutMetrics.cols = nextCols;
    boardLayoutMetrics.left = nextLeft;
    boardLayoutMetrics.top = nextTop;
    boardLayoutMetrics.right = nextRight;
    boardLayoutMetrics.bottom = nextBottom;
    boardLayoutMetrics.size = nextSize;
    boardLayoutMetrics.gap = nextGap;
    boardLayoutMetrics.pad = nextPad;
    boardLayoutMetrics.step = nextStep;
    boardLayoutMetrics.version += 1;
  }
  boardLayoutMetrics.scrollX = nextScrollX;
  boardLayoutMetrics.scrollY = nextScrollY;
  boardLayoutMetrics.ready = true;
  return boardLayoutMetrics;
};

const clearBoardLayoutMetrics = () => {
  boardLayoutMetrics.ready = false;
  boardLayoutMetrics.version = 0;
  boardLayoutMetrics.rows = 0;
  boardLayoutMetrics.cols = 0;
  boardLayoutMetrics.left = 0;
  boardLayoutMetrics.top = 0;
  boardLayoutMetrics.right = 0;
  boardLayoutMetrics.bottom = 0;
  boardLayoutMetrics.size = 56;
  boardLayoutMetrics.gap = 0;
  boardLayoutMetrics.pad = 0;
  boardLayoutMetrics.step = 56;
  boardLayoutMetrics.scrollX = 0;
  boardLayoutMetrics.scrollY = 0;
};

const ensurePathLayoutMetrics = (refs) => {
  if (pathLayoutMetrics.ready) return pathLayoutMetrics;
  const offset = getGridCanvasOffset(refs, gridOffsetScratch);
  const cell = getCellSize(refs?.gridEl);
  const gridStyles = refs?.gridEl ? getComputedStyle(refs.gridEl) : null;
  const gap = parsePx(gridStyles?.columnGap || gridStyles?.gap || '0');
  const pad = parsePx(gridStyles?.paddingLeft || gridStyles?.padding || '0');
  return updatePathLayoutMetrics(offset, cell, gap, pad);
};

const drawIdleAnimatedPath = (
  flowOffset = 0,
  completionModel = latestCompletionModel,
  nowMs = getNowMs(),
) => {
  const pathRenderer = ensurePathRenderer({
    refs: latestPathRefs,
    allowRecovery: !interactiveResizeActive,
  });
  if (!pathRenderer) return;
  if (!latestPathSnapshot) {
    latestPathMainFlowTravel = 0;
    pathRenderer.clear();
    return;
  }

  const renderPoints = getPathRenderPointsForFrame(
    latestPathSnapshot.path,
    nowMs,
    pathFramePayload.width,
    pathFramePayload.baseStartRadius,
    pathFramePayload.baseEndHalfWidth,
  );
  pathFramePayload.points = renderPoints.points;
  pathFramePayload.retainedStartArcPoints = renderPoints.retainedStartArcPoints;
  pathFramePayload.retainedStartArcGeometryToken = renderPoints.retainedStartArcGeometryToken;
  pathFramePayload.retainedEndArcPoints = renderPoints.retainedEndArcPoints;
  pathFramePayload.retainedEndArcGeometryToken = renderPoints.retainedEndArcGeometryToken;
  pathFramePayload.retainedStartArcWidth = pathFramePayload.width;
  pathFramePayload.retainedEndArcWidth = pathFramePayload.width;
  const reverseTipSwapActive = applyPathReverseTipSwapToPayload(latestPathSnapshot.path, nowMs);
  const startPinPresenceActive = applyPathStartPinPresenceToPayload(latestPathSnapshot.path, nowMs);
  const endArrowRotateActive = applyPathEndArrowDirectionToPayload(latestPathSnapshot.path, nowMs);
  const startFlowRotateActive = applyPathStartFlowDirectionToPayload(latestPathSnapshot.path, nowMs);
  const segmentRetractTipScale = clampUnit(
    Number.isFinite(renderPoints.segmentRetractTipScale)
      ? renderPoints.segmentRetractTipScale
      : 1,
  );
  pathFramePayload.arrowLength *= segmentRetractTipScale;
  pathFramePayload.endHalfWidth *= segmentRetractTipScale;
  const tipHoverScale = resolvePathTipHoverScales(
    latestPathSnapshot.path,
    latestInteractionModel,
    nowMs,
    pathTipHoverScaleScratch,
  );
  pathFramePayload.startRadius *= tipHoverScale.startScale;
  pathFramePayload.arrowLength *= tipHoverScale.endScale;
  pathFramePayload.endHalfWidth *= tipHoverScale.endScale;
  const baseStartRadius = Number(pathFramePayload.baseStartRadius) || 0;
  const baseEndHalfWidth = Number(pathFramePayload.baseEndHalfWidth) || 0;
  const startTipWidthScale = baseStartRadius > 0
    ? clampUnit((Number(pathFramePayload.startRadius) || 0) / baseStartRadius)
    : 1;
  const endTipWidthScale = baseEndHalfWidth > 0
    ? clampUnit((Number(pathFramePayload.endHalfWidth) || 0) / baseEndHalfWidth)
    : 1;
  pathFramePayload.retainedStartArcWidth = Math.max(0.5, pathFramePayload.width * startTipWidthScale);
  pathFramePayload.retainedEndArcWidth = Math.max(0.5, pathFramePayload.width * endTipWidthScale);
  pathFramePayload.geometryToken = (
    reverseTipSwapActive
    || startPinPresenceActive
    || endArrowRotateActive
    || startFlowRotateActive
    || tipHoverScale.active
  ) ? NaN : renderPoints.geometryToken;
  const flowVisibility = resolvePathFlowVisibilityMix(
    latestPathSnapshot.path,
    nowMs,
    flowVisibilityMixScratch,
  );
  const flowFreeze = resolvePathFlowFreezeMix(nowMs, pathFlowFreezeMixScratch);
  const flowFreezeMix = clampUnit(flowFreeze.mix);
  const frozenMix = 1 - flowFreezeMix;
  pathFramePayload.mainColorRgb = mixRgb(
    pathThemeMainRgb,
    FROZEN_PATH_GRAY_RGB,
    frozenMix,
    frozenMainColorScratch,
  );
  pathFramePayload.completeColorRgb = mixRgb(
    pathThemeCompleteRgb,
    FROZEN_PATH_GRAY_RGB,
    frozenMix,
    frozenCompleteColorScratch,
  );
  const flowMix = clampUnit(Number.isFinite(flowVisibility.mix) ? flowVisibility.mix : 1);
  const effectiveFlowMix = flowMix * flowFreezeMix;
  const hasRenderableMainFlowPoints = Array.isArray(pathFramePayload.points)
    && pathFramePayload.points.length > 1;
  const hasRenderableRetainedStartFlowPoints = Array.isArray(pathFramePayload.retainedStartArcPoints)
    && pathFramePayload.retainedStartArcPoints.length > 1;
  const hasRenderableRetainedEndFlowPoints = Array.isArray(pathFramePayload.retainedEndArcPoints)
    && pathFramePayload.retainedEndArcPoints.length > 1;
  const hasRenderableFlowPoints = (
    hasRenderableMainFlowPoints
    || hasRenderableRetainedStartFlowPoints
    || hasRenderableRetainedEndFlowPoints
  );
  pathFramePayload.flowEnabled = (
    !isReducedMotionPreferred()
    && hasRenderableFlowPoints
    && effectiveFlowMix > PATH_FLOW_FREEZE_EPSILON
  );
  pathFramePayload.flowMix = effectiveFlowMix;
  const baseFlowSpeed = Number.isFinite(pathFramePayload.flowBaseSpeed)
    ? pathFramePayload.flowBaseSpeed
    : PATH_FLOW_SPEED;
  pathFramePayload.flowSpeed = baseFlowSpeed * flowFreezeMix;
  pathFramePayload.flowOffset = flowOffset + (Number(renderPoints.flowTravelCompensation) || 0);
  if (effectiveFlowMix > PATH_FLOW_FREEZE_EPSILON) {
    applyPathReverseGradientBlendToPayload(
      latestPathSnapshot.path,
      pathFramePayload.flowCycle,
      nowMs,
    );
  } else {
    pathFramePayload.reverseColorBlend = 1;
    pathFramePayload.reverseFromFlowOffset = 0;
    pathFramePayload.reverseTravelSpan = 0;
  }
  pathFramePayload.isCompletionSolved = Boolean(completionModel?.isSolved);
  pathFramePayload.completionProgress = getCompletionProgress(completionModel);
  countPathDraws();
  latestPathMainFlowTravel = pathRenderer.drawPathFrame(pathFramePayload);

  if (latestTutorialFlags?.path || latestTutorialFlags?.movable) {
    drawStaticSymbols(latestPathSnapshot, latestPathRefs, latestPathStatuses);
    drawTutorialBracketsOnSymbolCanvas(latestPathRefs, latestTutorialFlags, flowOffset);
  }
};

const updateTutorialBracketPayload = (snapshot, layout, tutorialFlags = null) => {
  const pathEnabled = Boolean(tutorialFlags?.path);
  const movableEnabled = Boolean(tutorialFlags?.movable);
  const step = layout.cell + layout.gap;
  const half = layout.cell * 0.5;
  let count = 0;
  let signature = `${layout.version}|${pathEnabled ? 1 : 0}|${movableEnabled ? 1 : 0}|`;

  const ensurePoint = (index) => {
    if (!reusableTutorialBracketPoints[index]) {
      reusableTutorialBracketPoints[index] = { x: 0, y: 0 };
    }
    return reusableTutorialBracketPoints[index];
  };

  if (pathEnabled && snapshot.path.length > 0) {
    const head = snapshot.path[0];
    const headPoint = ensurePoint(count);
    headPoint.x = layout.offsetX + layout.pad + (head.c * step) + half;
    headPoint.y = layout.offsetY + layout.pad + (head.r * step) + half;
    signature += `${head.r},${head.c};`;
    count += 1;

    if (snapshot.path.length > 1) {
      const tail = snapshot.path[snapshot.path.length - 1];
      const tailPoint = ensurePoint(count);
      tailPoint.x = layout.offsetX + layout.pad + (tail.c * step) + half;
      tailPoint.y = layout.offsetY + layout.pad + (tail.r * step) + half;
      signature += `${tail.r},${tail.c};`;
      count += 1;
    }
  }

  if (movableEnabled) {
    for (let r = 0; r < snapshot.rows; r++) {
      for (let c = 0; c < snapshot.cols; c++) {
        if (snapshot.gridData[r][c] !== 'm') continue;
        const point = ensurePoint(count);
        point.x = layout.offsetX + layout.pad + (c * step) + half;
        point.y = layout.offsetY + layout.pad + (r * step) + half;
        signature += `${r},${c};`;
        count += 1;
      }
    }
  }

  if (reusableTutorialBracketPoints.length !== count) {
    reusableTutorialBracketPoints.length = count;
  }
  if (signature !== tutorialBracketSignature) {
    tutorialBracketSignature = signature;
    tutorialBracketGeometryToken += 1;
  }

  const resolveTutorialBracketColor = () => {
    let firstCell = null;
    let hoveredCell = null;
    let activeCell = null;

    const considerCell = (r, c) => {
      const cell = gridCells[r]?.[c];
      if (!cell) return;
      if (!firstCell) firstCell = cell;
      if (typeof cell.matches !== 'function') return;
      if (!activeCell && cell.matches(':active')) activeCell = cell;
      if (!hoveredCell && cell.matches(':hover')) hoveredCell = cell;
    };

    if (pathEnabled && snapshot.path.length > 0) {
      const head = snapshot.path[0];
      considerCell(head.r, head.c);
      if (snapshot.path.length > 1) {
        const tail = snapshot.path[snapshot.path.length - 1];
        considerCell(tail.r, tail.c);
      }
    }

    if (movableEnabled) {
      for (let r = 0; r < snapshot.rows; r++) {
        for (let c = 0; c < snapshot.cols; c++) {
          if (snapshot.gridData[r][c] !== 'm') continue;
          considerCell(r, c);
        }
      }
    }

    const sourceCell = activeCell || hoveredCell || firstCell;
    if (!sourceCell || typeof getComputedStyle !== 'function') return TUTORIAL_BRACKET_COLOR_RGB;
    const cssColor = getComputedStyle(sourceCell).getPropertyValue('--interactive-corner-color');
    const parsed = parseColorToRgb(cssColor, tutorialBracketColorScratch);
    return parsed || TUTORIAL_BRACKET_COLOR_RGB;
  };

  pathFramePayload.tutorialBracketCenters = reusableTutorialBracketPoints;
  pathFramePayload.tutorialBracketGeometryToken = tutorialBracketGeometryToken;
  pathFramePayload.tutorialBracketCellSize = layout.cell;
  pathFramePayload.tutorialBracketPulseEnabled = !isReducedMotionPreferred();
  pathFramePayload.tutorialBracketColorRgb = resolveTutorialBracketColor();
};


const syncBoardCellSize = (refs, rows = activeBoardSize.rows, cols = activeBoardSize.cols) => {
  if (!refs.boardWrap || !refs.gridEl) return;
  if (!rows || !cols || rows <= 0 || cols <= 0) return;

  const boardStyles = getComputedStyle(refs.boardWrap);
  const gap = parsePx(boardStyles.getPropertyValue('--gap')) || 2;
  const boardBorderInline =
    parsePx(boardStyles.borderLeftWidth) + parsePx(boardStyles.borderRightWidth);
  const parent = refs.boardWrap.parentElement;
  const parentInline = (() => {
    if (!parent) return refs.boardWrap.clientWidth;
    const styles = getComputedStyle(parent);
    return Math.max(
      0,
      parent.clientWidth - parsePx(styles.paddingLeft) - parsePx(styles.paddingRight),
    );
  })();
  const appInline = (() => {
    if (!refs.app) return Infinity;
    const styles = getComputedStyle(refs.app);
    return Math.max(
      0,
      refs.app.clientWidth - parsePx(styles.paddingLeft) - parsePx(styles.paddingRight),
    );
  })();
  const viewportInline = Math.max(
    0,
    (window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0) - 12,
  );
  const maxInline = Math.min(parentInline, appInline, viewportInline);
  const maxBlock = (() => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    if (refs.app) {
      const appStyles = getComputedStyle(refs.app);
      const reservedUiBlock =
        parsePx(appStyles.getPropertyValue('--ui-reserve')) +
        parsePx(appStyles.paddingTop) +
        parsePx(appStyles.paddingBottom) +
        20;
      if (reservedUiBlock > 0) {
        return Math.max(120, viewportHeight - reservedUiBlock);
      }
    }

    // Fallback for unexpected styling states.
    const top = refs.gridEl.getBoundingClientRect().top;
    return Math.max(120, viewportHeight - top - 20);
  })();

  if (!Number.isFinite(maxInline) || maxInline <= 0 || !Number.isFinite(maxBlock) || maxBlock <= 0) return;

  const widthBudget = maxInline - boardBorderInline - (gap * 2) - (cols - 1) * gap;
  const heightBudget = maxBlock - (gap * 2) - (rows - 1) * gap;
  if (widthBudget <= 0 || heightBudget <= 0) return;

  const minByGrid = Math.min(
    880 / cols,
    880 / rows,
    184,
  );
  const byInline = widthBudget / cols;
  const byBlock = heightBudget / rows;
  const nextCell = clampNumber(Math.min(byInline, byBlock), 8, minByGrid);
  const nextCellBorder = clampNumber(nextCell * 0.024, 0.8, 2.8);
  const nextBoardBorder = clampNumber(nextCell * 0.024, 0.8, 2.8);
  const nextCellPx = `${Math.round(nextCell)}px`;
  const nextCellBorderPx = `${nextCellBorder.toFixed(2)}px`;
  const nextBoardBorderPx = `${nextBoardBorder.toFixed(2)}px`;

  const currentCell = refs.boardWrap.style.getPropertyValue('--cell') || '';
  if (currentCell !== nextCellPx) {
    refs.boardWrap.style.setProperty('--cell', nextCellPx);
    refs.gridEl.style.setProperty('--cell', nextCellPx);
  }

  const currentCellBorder = refs.boardWrap.style.getPropertyValue('--cell-border') || '';
  if (currentCellBorder !== nextCellBorderPx) {
    refs.boardWrap.style.setProperty('--cell-border', nextCellBorderPx);
    refs.gridEl.style.setProperty('--cell-border', nextCellBorderPx);
  }

  const currentBoardBorder = refs.boardWrap.style.getPropertyValue('--board-border') || '';
  if (currentBoardBorder !== nextBoardBorderPx) {
    refs.boardWrap.style.setProperty('--board-border', nextBoardBorderPx);
    refs.gridEl.style.setProperty('--board-border', nextBoardBorderPx);
  }
};

const nowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const clearInteractiveResizeTimer = () => {
  if (!interactiveResizeTimer) return;
  clearTimeout(interactiveResizeTimer);
  interactiveResizeTimer = 0;
};

const applyCanvasCssSize = (canvas, cssWidth, cssHeight) => {
  if (!canvas) return;
  const safeCssWidth = Math.max(1, Number(cssWidth) || 1);
  const safeCssHeight = Math.max(1, Number(cssHeight) || 1);
  const cssWidthPx = `${safeCssWidth}px`;
  const cssHeightPx = `${safeCssHeight}px`;
  if (canvas.style.width !== cssWidthPx) canvas.style.width = cssWidthPx;
  if (canvas.style.height !== cssHeightPx) canvas.style.height = cssHeightPx;
};

const applyScaledSymbolCanvasTransform = (canvas, ctx, cssWidth, cssHeight) => {
  if (!canvas || !ctx) return;
  const dpr = getDevicePixelScale();
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const safeCssWidth = Math.max(1, cssWidth);
  const safeCssHeight = Math.max(1, cssHeight);
  const pixelWidth = Math.max(1, Math.round(safeCssWidth * safeDpr));
  const pixelHeight = Math.max(1, Math.round(safeCssHeight * safeDpr));
  const scaleX = pixelWidth / safeCssWidth;
  const scaleY = pixelHeight / safeCssHeight;
  
  ctx.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    CANVAS_ALIGN_OFFSET_CSS_PX * scaleX,
    CANVAS_ALIGN_OFFSET_CSS_PX * scaleY,
  );
  ctx.imageSmoothingEnabled = false;
};

const createReplacementPathCanvas = (canvas) => {
  const replacement = document.createElement('canvas');
  replacement.id = canvas.id;
  replacement.className = canvas.className;
  replacement.style.cssText = canvas.style.cssText;
  replacement.width = canvas.width || 1;
  replacement.height = canvas.height || 1;
  return replacement;
};

const shouldPathRendererUseAntialias = () => !lowPowerModeEnabled;

const createPathRenderer = (canvas) => createPathWebglRenderer(canvas, {
  antialias: shouldPathRendererUseAntialias(),
});

const pathRendererAntialiasMismatch = (renderer) => (
  typeof renderer?.antialiasEnabled === 'boolean'
  && renderer.antialiasEnabled !== shouldPathRendererUseAntialias()
);

const ensurePathRenderer = (refs) => {
  const allowRecovery = refs?.allowRecovery !== false;
  const targetRefs = refs?.refs || refs;
  if (!targetRefs) return null;
  const currentRenderer = targetRefs.pathRenderer || null;
  const currentCanvas = targetRefs.canvas || null;
  if (!currentCanvas) return currentRenderer;

  const rendererLost = Boolean(currentRenderer?.isContextLost?.());
  const antialiasMismatch = !rendererLost && pathRendererAntialiasMismatch(currentRenderer);
  if (currentRenderer && !rendererLost && !antialiasMismatch) return currentRenderer;
  if (antialiasMismatch && !allowRecovery) return currentRenderer;
  if (!allowRecovery) return null;
  if (antialiasMismatch && (!currentCanvas.parentElement || typeof currentCanvas.replaceWith !== 'function')) {
    return currentRenderer;
  }

  if (!antialiasMismatch) {
    const currentNow = nowMs();
    const elapsedMs = currentNow - lastPathRendererRecoveryAttemptMs;
    if (elapsedMs < PATH_RENDERER_RECOVERY_COOLDOWN_MS) return null;
    lastPathRendererRecoveryAttemptMs = currentNow;
  }

  let nextCanvas = currentCanvas;
  if ((rendererLost || antialiasMismatch) && currentCanvas.parentElement && typeof currentCanvas.replaceWith === 'function') {
    const replacement = createReplacementPathCanvas(currentCanvas);
    currentCanvas.replaceWith(replacement);
    targetRefs.canvas = replacement;
    nextCanvas = replacement;
  }

  if (currentRenderer) {
    try {
      currentRenderer.destroy?.();
    } catch {
      // Keep recovery best-effort; a failed destroy should not prevent re-init.
    }
    targetRefs.pathRenderer = null;
  }

  try {
    targetRefs.pathRenderer = createPathRenderer(nextCanvas);
    resizeCanvasSignature = '';
    return targetRefs.pathRenderer;
  } catch {
    return null;
  }
};

const flushInteractiveResize = () => {
  const payload = pendingInteractiveResizePayload;
  pendingInteractiveResizePayload = null;
  clearInteractiveResizeTimer();
  interactiveResizeActive = false;
  if (!payload) return;

  const {
    refs,
    cssWidth,
    cssHeight,
    dpr,
    offset,
    cell,
    gap,
    pad,
  } = payload;
  if (!refs?.symbolCanvas || !refs?.symbolCtx) return;
  pathAnimationEngine.updatePathLayoutMetrics(offset, cell, gap, pad);
  if (wallGhostEl) refreshWallGhostOffset();
  const pathRenderer = ensurePathRenderer({ refs, allowRecovery: true });
  if (pathRenderer) pathRenderer.resize(cssWidth, cssHeight, dpr);
  configureHiDPICanvas(refs.symbolCanvas, refs.symbolCtx, cssWidth, cssHeight, dpr);

  if (refs === latestPathRefs && latestPathSnapshot) {
    drawAllInternal(
      latestPathSnapshot,
      refs,
      latestPathStatuses,
      pathAnimationOffset,
      latestCompletionModel,
      latestTutorialFlags,
    );
  }
};

const scheduleInteractiveResizeFlush = (payload) => {
  pendingInteractiveResizePayload = payload;
  clearInteractiveResizeTimer();
  interactiveResizeTimer = window.setTimeout(() => {
    interactiveResizeTimer = 0;
    flushInteractiveResize();
  }, INTERACTIVE_RESIZE_IDLE_MS);
};

function cacheElements() {
  const get = (id) => document.getElementById(id);

  const result = {
    app: get(ELEMENT_IDS.APP),
    levelLabel: get(ELEMENT_IDS.LEVEL_LABEL),
    levelSelectGroup: get(ELEMENT_IDS.LEVEL_SELECT_GROUP),
    levelSel: get(ELEMENT_IDS.LEVEL_SEL),
    infiniteSel: get(ELEMENT_IDS.INFINITE_SEL),
    dailyMeta: get(ELEMENT_IDS.DAILY_META),
    dailyDateValue: get(ELEMENT_IDS.DAILY_DATE_VALUE),
    dailyCountdownValue: get(ELEMENT_IDS.DAILY_COUNTDOWN_VALUE),
    scoreMeta: get(ELEMENT_IDS.SCORE_META),
    infiniteScoreLabel: get(ELEMENT_IDS.INFINITE_SCORE_LABEL),
    infiniteScoreValue: get(ELEMENT_IDS.INFINITE_SCORE_VALUE),
    dailyScoreLabel: get(ELEMENT_IDS.DAILY_SCORE_LABEL),
    dailyScoreValue: get(ELEMENT_IDS.DAILY_SCORE_VALUE),
    langLabel: get(ELEMENT_IDS.LANG_LABEL),
    langSel: get(ELEMENT_IDS.LANG_SEL),
    themeLabel: get(ELEMENT_IDS.THEME_LABEL),
    themeToggle: get(ELEMENT_IDS.THEME_TOGGLE),
    lowPowerLabel: get(ELEMENT_IDS.LOW_POWER_LABEL),
    lowPowerToggle: get(ELEMENT_IDS.LOW_POWER_TOGGLE),
    settingsToggle: get(ELEMENT_IDS.SETTINGS_TOGGLE),
    settingsPanel: get(ELEMENT_IDS.SETTINGS_PANEL),
    themeSwitchDialog: get(ELEMENT_IDS.THEME_SWITCH_DIALOG),
    themeSwitchMessage: get(ELEMENT_IDS.THEME_SWITCH_MESSAGE),
    themeSwitchCancelBtn: get(ELEMENT_IDS.THEME_SWITCH_CANCEL_BTN),
    themeSwitchConfirmBtn: get(ELEMENT_IDS.THEME_SWITCH_CONFIRM_BTN),
    resetBtn: get(ELEMENT_IDS.RESET_BTN),
    guidePanel: get(ELEMENT_IDS.GUIDE_PANEL),
    guideToggleBtn: get(ELEMENT_IDS.GUIDE_TOGGLE_BTN),
    legendPanel: get(ELEMENT_IDS.LEGEND_PANEL),
    legendToggleBtn: get(ELEMENT_IDS.LEGEND_TOGGLE_BTN),
    msgEl: get(ELEMENT_IDS.MSG),
    prevInfiniteBtn: get(ELEMENT_IDS.PREV_INFINITE_BTN),
    nextLevelBtn: get(ELEMENT_IDS.NEXT_LEVEL_BTN),
    gridEl: get(ELEMENT_IDS.GRID),
    boardWrap: get(ELEMENT_IDS.BOARD_WRAP),
    canvas: get(ELEMENT_IDS.CANVAS),
    symbolCanvas: get(ELEMENT_IDS.SYMBOL_CANVAS),
    legend: get(ELEMENT_IDS.LEGEND),
    bTurn: get(ELEMENT_IDS.B_TURN),
    bCW: get(ELEMENT_IDS.B_CW),
    bCCW: get(ELEMENT_IDS.B_CCW),
    bStraight: get(ELEMENT_IDS.B_STRAIGHT),
    bH: get(ELEMENT_IDS.B_H),
    bV: get(ELEMENT_IDS.B_V),
    bX: get(ELEMENT_IDS.B_X),
    bSc: get(ELEMENT_IDS.B_SCISSORS),
    bRo: get(ELEMENT_IDS.B_ROCK),
    bPa: get(ELEMENT_IDS.B_PAPER),
    bMoveWall: get(ELEMENT_IDS.B_MOVE_WALL),
    reverseBtn: get(ELEMENT_IDS.REVERSE_BTN),
  };

  if (result.canvas) {
    try {
      result.pathRenderer = createPathRenderer(result.canvas);
    } catch {
      result.pathRenderer = null;
    }
  }
  if (result.symbolCanvas) {
    result.symbolCtx = result.symbolCanvas.getContext('2d');
  }
  cachedBoardWrap = result.boardWrap;
  resizeCanvasSignature = '';
  lastFlowMetricCell = NaN;
  pathThemeCacheInitialized = false;
  reusablePathPoints.length = 0;
  pathGeometryToken = 0;
  cachedPathRef = null;
  cachedPathLength = -1;
  cachedPathHeadR = NaN;
  cachedPathHeadC = NaN;
  cachedPathTailR = NaN;
  cachedPathTailC = NaN;
  cachedPathLayoutVersion = -1;
  wallGhostOffsetLeft = 0;
  wallGhostOffsetTop = 0;
  lastPathRendererRecoveryAttemptMs = 0;
  interactiveResizeActive = false;
  pendingInteractiveResizePayload = null;
  clearPathTransitionCompensationBuffer();
  clearInteractiveResizeTimer();
  pathLayoutMetrics.ready = false;
  pathLayoutMetrics.version = 0;
  pathAnimationEngine.resetTransitionState();
  clearPathRetainedArcStates();
  clearPathTipHoverScaleStates();
  pathRetainedArcTokenSeed = 0;
  reusableArrivalPathPoints.length = 0;
  reusableStartRetainedArcPoints.length = 0;
  reusableEndRetainedArcPoints.length = 0;
  pathFramePayload.points = [];
  pathFramePayload.geometryToken = 0;
  pathFramePayload.width = 0;
  pathFramePayload.baseStartRadius = 0;
  pathFramePayload.baseArrowLength = 0;
  pathFramePayload.baseEndHalfWidth = 0;
  pathFramePayload.reverseHeadArrowLength = 0;
  pathFramePayload.reverseHeadArrowHalfWidth = 0;
  pathFramePayload.reverseTailCircleRadius = 0;
  pathFramePayload.reverseColorBlend = 1;
  pathFramePayload.reverseFromFlowOffset = 0;
  pathFramePayload.reverseTravelSpan = 0;
  pathFramePayload.startRadius = 0;
  pathFramePayload.arrowLength = 0;
  pathFramePayload.endHalfWidth = 0;
  pathFramePayload.mainColorRgb = null;
  pathFramePayload.completeColorRgb = null;
  pathFramePayload.isCompletionSolved = false;
  pathFramePayload.completionProgress = 0;
  pathFramePayload.flowEnabled = false;
  pathFramePayload.flowMix = 1;
  pathFramePayload.flowBaseSpeed = PATH_FLOW_SPEED;
  pathFramePayload.flowOffset = 0;
  pathFramePayload.flowCycle = PATH_FLOW_CYCLE;
  pathFramePayload.flowPulse = PATH_FLOW_PULSE;
  pathFramePayload.flowSpeed = PATH_FLOW_SPEED;
  pathFramePayload.flowRise = PATH_FLOW_RISE;
  pathFramePayload.flowDrop = PATH_FLOW_DROP;
  pathFramePayload.tutorialBracketCenters = [];
  pathFramePayload.tutorialBracketGeometryToken = 0;
  pathFramePayload.tutorialBracketCellSize = 0;
  pathFramePayload.tutorialBracketPulseEnabled = false;
  pathFramePayload.tutorialBracketColorRgb = null;
  pathFramePayload.drawTutorialBracketsInPathLayer = false;
  pathFramePayload.endArrowDirX = NaN;
  pathFramePayload.endArrowDirY = NaN;
  pathFramePayload.startFlowDirX = NaN;
  pathFramePayload.startFlowDirY = NaN;
  pathFramePayload.retainedStartArcWidth = 0;
  pathFramePayload.retainedEndArcWidth = 0;
  pathFramePayload.retainedStartArcPoints = [];
  pathFramePayload.retainedEndArcPoints = [];
  pathFramePayload.retainedStartArcGeometryToken = NaN;
  pathFramePayload.retainedEndArcGeometryToken = NaN;
  latestTutorialFlags = null;
  latestInteractionModel = null;
  reusableTutorialBracketPoints = [];
  tutorialBracketSignature = '';
  tutorialBracketGeometryToken = 0;
  pathAnimationEngine.resetForCacheElements(result);

  return result;
}

const createGhost = () => {
  const ghost = document.createElement('div');
  ghost.className = 'wallDragGhost';
  ghost.innerHTML = `<div class="wallDragGhostMark">${ICONS.m || ''}</div>`;
  return ghost;
};

const getGridCanvasOffset = (refs, out = null) => {
  const target = out || { x: 0, y: 0 };
  if (pathLayoutMetrics.ready) {
    target.x = pathLayoutMetrics.offsetX;
    target.y = pathLayoutMetrics.offsetY;
    return target;
  }
  if (!refs.gridEl || !refs.boardWrap) {
    target.x = 0;
    target.y = 0;
    return target;
  }
  const gridRect = refs.gridEl.getBoundingClientRect();
  const boardRect = refs.boardWrap.getBoundingClientRect();
  const innerLeft = boardRect.left + refs.boardWrap.clientLeft;
  const innerTop = boardRect.top + refs.boardWrap.clientTop;
  target.x = gridRect.left - innerLeft;
  target.y = gridRect.top - innerTop;
  return target;
};

const getCellPoint = (r, c, refs, offset = { x: 0, y: 0 }, out = null) => {
  const target = out || { x: 0, y: 0 };
  if (pathLayoutMetrics.ready) {
    const step = pathLayoutMetrics.cell + pathLayoutMetrics.gap;
    target.x = pathLayoutMetrics.pad + (c * step) + (pathLayoutMetrics.cell * 0.5) + offset.x;
    target.y = pathLayoutMetrics.pad + (r * step) + (pathLayoutMetrics.cell * 0.5) + offset.y;
    return target;
  }
  const p = cellCenter(r, c, refs.gridEl);
  target.x = p.x + offset.x;
  target.y = p.y + offset.y;
  return target;
};

const getVertexPoint = (r, c, refs, offset = { x: 0, y: 0 }, out = null, dpr = 0) => {
  const target = out || { x: 0, y: 0 };
  if (pathLayoutMetrics.ready) {
    const step = pathLayoutMetrics.cell + pathLayoutMetrics.gap;
    if (dpr > 0) {
      const half = pathLayoutMetrics.cell * 0.5;
      const x0 = snapCssToDevicePixel(pathLayoutMetrics.pad + ((c - 1) * step) + half + offset.x, dpr);
      const x1 = snapCssToDevicePixel(pathLayoutMetrics.pad + (c * step) + half + offset.x, dpr);
      const y0 = snapCssToDevicePixel(pathLayoutMetrics.pad + ((r - 1) * step) + half + offset.y, dpr);
      const y1 = snapCssToDevicePixel(pathLayoutMetrics.pad + (r * step) + half + offset.y, dpr);
      target.x = (x0 + x1) * 0.5;
      target.y = (y0 + y1) * 0.5;
    } else {
      target.x = pathLayoutMetrics.pad + (c * step) - (pathLayoutMetrics.gap * 0.5) + offset.x;
      target.y = pathLayoutMetrics.pad + (r * step) - (pathLayoutMetrics.gap * 0.5) + offset.y;
    }
    return target;
  }
  const p = vertexPos(r, c, refs.gridEl);
  target.x = p.x + offset.x;
  target.y = p.y + offset.y;
  return target;
};

const ensureWallGhostEl = () => {
  if (!cachedBoardWrap) return null;
  if (wallGhostEl) return wallGhostEl;

  wallGhostEl = createGhost();
  cachedBoardWrap.appendChild(wallGhostEl);
  return wallGhostEl;
};

const refreshWallGhostOffset = () => {
  if (!cachedBoardWrap) return;
  const rect = cachedBoardWrap.getBoundingClientRect();
  wallGhostOffsetLeft = rect.left + cachedBoardWrap.clientLeft;
  wallGhostOffsetTop = rect.top + cachedBoardWrap.clientTop;
};

const showWallDragGhost = (x, y) => {
  const ghost = ensureWallGhostEl();
  if (!ghost || !cachedBoardWrap) return;
  refreshWallGhostOffset();
  ghost.style.display = 'grid';
  moveWallDragGhost(x, y);
};

const moveWallDragGhost = (x, y) => {
  if (!wallGhostEl || !cachedBoardWrap) return;
  wallGhostEl.style.left = `${x - wallGhostOffsetLeft}px`;
  wallGhostEl.style.top = `${y - wallGhostOffsetTop}px`;
};

const hideWallDragGhost = () => {
  if (!wallGhostEl) return;
  wallGhostEl.remove();
  wallGhostEl = null;
  wallGhostOffsetLeft = 0;
  wallGhostOffsetTop = 0;
};

function setMessage(msgEl, kind, html) {
  const nextKind = kind || null;
  const nextHtml = html || '';
  if (latestMessageKind === nextKind && latestMessageHtml === nextHtml) return;

  if (latestMessageKind !== nextKind) {
    if (latestMessageKind) msgEl.classList.remove(latestMessageKind);
    if (nextKind) msgEl.classList.add(nextKind);
    latestMessageKind = nextKind;
  }
  if (latestMessageHtml !== nextHtml) {
    msgEl.innerHTML = nextHtml;
    latestMessageHtml = nextHtml;
  }
}

function setLegendIcons(icons, refs, iconX) {
  const map = {
    bTurn: icons['t'],
    bCW: icons['r'],
    bCCW: icons['l'],
    bStraight: icons['s'],
    bH: icons['h'],
    bV: icons['v'],
    bX: iconX,
    bSc: icons['g'],
    bRo: icons['b'],
    bPa: icons['p'],
    bMoveWall: icons['m'],
  };

  Object.keys(map).forEach((id) => {
    if (refs[id]) refs[id].innerHTML = map[id] || '';
  });
}

const resolveCellMarkHtml = (code, icons = ICONS) => {
  if (code === 'm') return icons.m || '';
  if (code === '#') return '';
  return icons[code] || '';
};

function buildGrid(snapshot, refs, icons, iconX) {
  const { boardWrap, gridEl } = refs;
  activeBoardSize = { rows: snapshot.rows, cols: snapshot.cols };
  syncBoardCellSize(refs);

  if (boardWrap) {
    boardWrap.style.setProperty('--grid-cols', String(snapshot.cols));
    boardWrap.style.setProperty('--grid-rows', String(snapshot.rows));
  }
  gridEl.style.setProperty('--grid-cols', String(snapshot.cols));
  gridEl.style.setProperty('--grid-rows', String(snapshot.rows));

  gridCells = Array.from({ length: snapshot.rows }, () => Array(snapshot.cols).fill(null));

  gridEl.innerHTML = '';
  gridEl.style.gridTemplateColumns = `repeat(var(--grid-cols), var(--cell))`;
  gridEl.style.gridTemplateRows = `repeat(var(--grid-rows), var(--cell))`;

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      const idx = document.createElement('div');
      idx.className = 'idx';
      idx.textContent = '';
      cell.appendChild(idx);

      const mark = document.createElement('div');
      mark.className = 'mark';

      const code = snapshot.gridData[r][c];
      if (code === 'm') {
        cell.classList.add('wall', 'movable');
        mark.innerHTML = resolveCellMarkHtml(code, icons);
      } else if (code === '#') {
        cell.classList.add('wall');
        mark.innerHTML = resolveCellMarkHtml(code, icons);
      } else {
        mark.innerHTML = resolveCellMarkHtml(code, icons);
      }

      cell.appendChild(mark);
      cell.style.setProperty('--diag-order', String(r + c));
      gridEl.appendChild(cell);
      gridCells[r][c] = cell;
    }
  }

  lastDropTargetKey = null;
  reusableCellViewModel = null;
  resizeCanvasSignature = '';
  cachedPathRef = null;
  cachedPathLength = -1;
  cachedPathLayoutVersion = -1;
  pathAnimationEngine.resetTransitionState({ preserveFlowFreeze: true });
  clearPathRetainedArcStates();
  pathRetainedArcTokenSeed = 0;
  reusableArrivalPathPoints.length = 0;
  reusableStartRetainedArcPoints.length = 0;
  reusableEndRetainedArcPoints.length = 0;
  clearPathTipDragHoverCell();
  clearPathTipHoverScaleStates();
  resizeCanvas(refs);
}

const parseGridKey = (value, out = keyParseScratch) => {
  if (typeof value !== 'string') return null;
  const commaIndex = value.indexOf(',');
  if (commaIndex <= 0 || commaIndex >= value.length - 1) return null;
  const r = Number(value.slice(0, commaIndex));
  const c = Number(value.slice(commaIndex + 1));
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  out.r = r;
  out.c = c;
  return out;
};

function clearDropTarget() {
  if (!lastDropTargetKey) return;
  const parsedKey = parseGridKey(lastDropTargetKey);
  if (!parsedKey) {
    lastDropTargetKey = null;
    return;
  }
  const { r, c } = parsedKey;
  if (r >= 0 && c >= 0 && gridCells[r] && gridCells[r][c]) {
    const cell = gridCells[r][c];
    cell.classList.remove('dropTarget', 'wallDropPreview');
    const preview = cell.querySelector('.wallGhostPreviewMarker');
    if (preview) preview.remove();
  }
  lastDropTargetKey = null;
}

function setDropTarget(r, c) {
  clearDropTarget();
  const key = keyOf(r, c);
  if (gridCells[r] && gridCells[r][c]) {
    const cell = gridCells[r][c];
    cell.classList.add('dropTarget', 'wallDropPreview');

    const mark = cell.querySelector('.mark');
    if (mark && !mark.querySelector('.wallGhostPreviewMarker')) {
      const preview = document.createElement('span');
      preview.className = 'wallGhostPreviewMarker';
      preview.innerHTML = ICONS.m || '';
      mark.appendChild(preview);
    }

    lastDropTargetKey = key;
  }
}

const statusKeySet = (keys) => {
  const set = new Set();
  if (!Array.isArray(keys)) return set;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key === 'string') set.add(key);
  }
  return set;
};

const addStatusDeltaKeys = (nextSet, prevSet, out) => {
  nextSet.forEach((key) => {
    if (!prevSet.has(key)) out.add(key);
  });
  prevSet.forEach((key) => {
    if (!nextSet.has(key)) out.add(key);
  });
};

const buildStatusSets = (results = {}) => ({
  badHint: statusKeySet(results.hintStatus?.badKeys),
  goodHint: statusKeySet(results.hintStatus?.goodKeys),
  badRps: statusKeySet(results.rpsStatus?.badKeys),
  goodRps: statusKeySet(results.rpsStatus?.goodKeys),
  badBlocked: statusKeySet(results.blockedStatus?.badKeys),
});

const addPathKeys = (path, out) => {
  if (!Array.isArray(path)) return;
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    if (!point) continue;
    out.add(keyOf(point.r, point.c));
  }
};

const resolveEndpointPathDelta = (prevPath, nextPath) => {
  if (!Array.isArray(prevPath) || !Array.isArray(nextPath)) return null;
  const prevLen = prevPath.length;
  const nextLen = nextPath.length;
  const shared = Math.min(prevLen, nextLen);

  let prefixLength = 0;
  while (prefixLength < shared && pointsMatch(prevPath[prefixLength], nextPath[prefixLength])) {
    prefixLength += 1;
  }
  if (prefixLength === shared) {
    return {
      side: 'end',
      prevChanged: prevPath.slice(prefixLength),
      nextChanged: nextPath.slice(prefixLength),
    };
  }

  let suffixLength = 0;
  while (
    suffixLength < shared
    && pointsMatch(
      prevPath[prevLen - 1 - suffixLength],
      nextPath[nextLen - 1 - suffixLength],
    )
  ) {
    suffixLength += 1;
  }

  if (suffixLength === 0 && prefixLength > 0) {
    return {
      side: 'end',
      prevChanged: prevPath.slice(prefixLength),
      nextChanged: nextPath.slice(prefixLength),
    };
  }

  if (prefixLength === 0 && suffixLength > 0) {
    return {
      side: 'start',
      prevChanged: prevPath.slice(0, prevLen - suffixLength),
      nextChanged: nextPath.slice(0, nextLen - suffixLength),
    };
  }

  return null;
};

const applyCellSnapshotState = (snapshot, r, c, statusSets) => {
  const cell = gridCells[r]?.[c];
  if (!cell) return;
  const key = keyOf(r, c);
  const code = snapshot.gridData[r][c];
  const classes = ['cell'];

  if (code === 'm') classes.push('wall', 'movable');
  else if (code === '#') classes.push('wall');

  if (snapshot.visited.has(key)) classes.push('visited');
  if (snapshot.path.length > 0) {
    const head = snapshot.path[0];
    if (head && head.r === r && head.c === c) classes.push('pathStart');
    if (snapshot.path.length > 1) {
      const tail = snapshot.path[snapshot.path.length - 1];
      if (tail && tail.r === r && tail.c === c) classes.push('pathEnd');
    }
  }

  if (statusSets.badHint.has(key)) classes.push('badHint');
  if (statusSets.goodHint.has(key)) classes.push('goodHint');
  if (statusSets.badRps.has(key)) classes.push('badRps');
  if (statusSets.goodRps.has(key) && !statusSets.badRps.has(key)) classes.push('goodRps');
  if (statusSets.badBlocked.has(key)) classes.push('badBlocked');

  const targetClass = classes.join(' ');
  if (cell.className !== targetClass) {
    cell.className = targetClass;
  }

  const idxText = snapshot.idxByKey.has(key)
    ? String(snapshot.idxByKey.get(key) + 1)
    : '';
  const idxEl = cell.firstElementChild;
  if (idxEl && idxEl.textContent !== idxText) {
    idxEl.textContent = idxText;
  }

  const pathOrderValue = idxText ? String(Math.max(0, Number(idxText) - 1)) : '';
  const currentPathOrder = cell.style.getPropertyValue('--path-order');
  if (pathOrderValue) {
    if (currentPathOrder !== pathOrderValue) {
      cell.style.setProperty('--path-order', pathOrderValue);
    }
  } else if (currentPathOrder) {
    cell.style.removeProperty('--path-order');
  }
};

const clearPathTipDragHoverCell = () => {
  if (!lastPathTipDragHoverCell) return;
  lastPathTipDragHoverCell.classList.remove('pathTipDragHover');
  lastPathTipDragHoverCell = null;
};

const syncPathTipDragHoverCell = (interactionModel = null, cells = gridCells) => {
  let nextCell = null;
  if (interactionModel?.isPathDragging) {
  const cursor = interactionModel.pathDragCursor;
  const cursorR = Number(cursor?.r);
  const cursorC = Number(cursor?.c);
    if (Number.isInteger(cursorR) && Number.isInteger(cursorC)) {
      const cell = cells[cursorR]?.[cursorC];
      if (cell && !cell.classList.contains('wall')) {
        nextCell = cell;
      }
    }
  }

  if (nextCell === lastPathTipDragHoverCell) {
    if (nextCell && !nextCell.classList.contains('pathTipDragHover')) {
      nextCell.classList.add('pathTipDragHover');
    }
    return;
  }
  clearPathTipDragHoverCell();
  if (!nextCell) return;
  nextCell.classList.add('pathTipDragHover');
  lastPathTipDragHoverCell = nextCell;
};

const tryApplyIncrementalPathUpdate = (snapshot, results) => {
  const prevSnapshot = latestPathSnapshot;
  if (!prevSnapshot) return false;
  if (snapshot.rows !== prevSnapshot.rows || snapshot.cols !== prevSnapshot.cols) return false;
  if (snapshot.gridData !== prevSnapshot.gridData) return false;

  const delta = resolveEndpointPathDelta(prevSnapshot.path, snapshot.path);
  if (!delta) return false;

  const statusSets = buildStatusSets(results);
  const prevSets = latestPathStatusSets || buildStatusSets(latestPathStatuses || {});

  const touchedKeys = new Set();
  if (delta.side === 'start') {
    const preservesSharedSuffixOrder = delta.prevChanged.length === delta.nextChanged.length;
    if (preservesSharedSuffixOrder) {
      addPathKeys(delta.prevChanged, touchedKeys);
      addPathKeys(delta.nextChanged, touchedKeys);
      addPathKeys(prevSnapshot.path.length > 0 ? [prevSnapshot.path[0], prevSnapshot.path[prevSnapshot.path.length - 1]] : [], touchedKeys);
      addPathKeys(snapshot.path.length > 0 ? [snapshot.path[0], snapshot.path[snapshot.path.length - 1]] : [], touchedKeys);
    } else {
      addPathKeys(prevSnapshot.path, touchedKeys);
      addPathKeys(snapshot.path, touchedKeys);
    }
  } else {
    addPathKeys(delta.prevChanged, touchedKeys);
    addPathKeys(delta.nextChanged, touchedKeys);
    addPathKeys(prevSnapshot.path.length > 0 ? [prevSnapshot.path[0], prevSnapshot.path[prevSnapshot.path.length - 1]] : [], touchedKeys);
    addPathKeys(snapshot.path.length > 0 ? [snapshot.path[0], snapshot.path[snapshot.path.length - 1]] : [], touchedKeys);
  }
  addStatusDeltaKeys(statusSets.badHint, prevSets.badHint, touchedKeys);
  addStatusDeltaKeys(statusSets.goodHint, prevSets.goodHint, touchedKeys);
  addStatusDeltaKeys(statusSets.badRps, prevSets.badRps, touchedKeys);
  addStatusDeltaKeys(statusSets.goodRps, prevSets.goodRps, touchedKeys);
  addStatusDeltaKeys(statusSets.badBlocked, prevSets.badBlocked, touchedKeys);

  touchedKeys.forEach((key) => {
    const parsed = parseGridKey(key);
    if (!parsed) return;
    const r = parsed.r;
    const c = parsed.c;
    if (r < 0 || c < 0 || r >= snapshot.rows || c >= snapshot.cols) return;
    applyCellSnapshotState(snapshot, r, c, statusSets);
  });

  countIncrementalCellPatches();
  return true;
};

function updateCells(
  snapshot,
  results,
  refs,
  completionModel = null,
  interactionModel = null,
  tutorialFlags = null,
) {
  const { hintStatus, stitchStatus, rpsStatus, blockedStatus } = results;
  const usedIncremental = tryApplyIncrementalPathUpdate(
    snapshot,
    { hintStatus, rpsStatus, blockedStatus },
  );
  if (!usedIncremental) {
    countFullCellRebuilds();
    reusableCellViewModel = buildBoardCellViewModel(
      snapshot,
      { hintStatus, rpsStatus, blockedStatus },
      resolveCellMarkHtml,
      reusableCellViewModel,
    );
    const desired = reusableCellViewModel;

    for (let r = 0; r < snapshot.rows; r++) {
      for (let c = 0; c < snapshot.cols; c++) {
        const cell = gridCells[r][c];
        const state = desired[r][c];
        const targetStr = state.classes.join(' ');

        if (cell.className !== targetStr) {
          cell.className = targetStr;
        }

        const idxEl = cell.firstElementChild;
        if (idxEl && idxEl.textContent !== state.idx) {
          idxEl.textContent = state.idx;
        }

        const markEl = idxEl?.nextElementSibling;
        if (markEl && markEl.innerHTML !== state.markHtml) {
          markEl.innerHTML = state.markHtml;
        }

        const pathOrderValue = state.idx ? String(Math.max(0, Number(state.idx) - 1)) : '';
        const currentPathOrder = cell.style.getPropertyValue('--path-order');
        if (pathOrderValue) {
          if (currentPathOrder !== pathOrderValue) {
            cell.style.setProperty('--path-order', pathOrderValue);
          }
        } else if (currentPathOrder) {
          cell.style.removeProperty('--path-order');
        }
      }
    }
  }
  syncPathTipDragHoverCell(interactionModel);
  pathAnimationEngine.setInteractionModel(interactionModel);
}

function drawAllImpl(
  snapshot,
  refs,
  statuses,
  completionModel = null,
  tutorialFlags = null,
) {
  const previousPath = latestPathSnapshot?.path || null;
  const pathChanged = !pathsMatch(previousPath, snapshot.path);
  const layout = ensurePathLayoutMetrics(refs);
  const flow = getCachedPathFlowMetrics(refs, layout.cell);
  if (!pathThemeCacheInitialized) updatePathThemeCache(refs);
  const nowMs = getNowMs();
  syncPathFlowFreezeTarget(isPathFlowFrozen(), nowMs);
  const flowFreeze = resolvePathFlowFreezeMix(nowMs, pathFlowFreezeMixScratch);
  const baseAnimateFlow = shouldAnimatePathFlow(snapshot, completionModel, tutorialFlags);
  const animateFlow = baseAnimateFlow && flowFreeze.mix > PATH_FLOW_FREEZE_EPSILON;
  updatePathTipArrivalStates(
    previousPath,
    snapshot.path,
    layout.cell,
    layout.cell + layout.gap,
    nowMs,
  );
  updatePathRetainedArcStates(previousPath, snapshot.path, nowMs);
  updatePathEndArrowRotateState(previousPath, snapshot.path, nowMs);
  updatePathStartFlowRotateState(previousPath, snapshot.path, nowMs);
  updatePathStartPinPresenceState(previousPath, snapshot.path, nowMs);
  updatePathFlowVisibilityState(previousPath, snapshot.path, nowMs);
  updatePathReverseTipSwapState(previousPath, snapshot.path, nowMs);
  if (isPathReversed(snapshot.path, previousPath)) {
    clearPathTransitionCompensationBuffer();
    const reverseFromFlowOffset = pathAnimationOffset;
    const reverseTravel = latestPathMainFlowTravel;
    if (reverseTravel > 0) {
      const transitionAnchorUnit = Math.max(
        0,
        Math.min(1, (PATH_FLOW_RISE + PATH_FLOW_DROP) * 0.5),
      );
      const transitionAnchor = flow.pulse * transitionAnchorUnit;
      pathAnimationOffset = normalizeFlowOffset(
        (2 * transitionAnchor) - reverseTravel - pathAnimationOffset,
        flow.cycle,
      );
    }
    beginPathReverseGradientBlend(
      snapshot.path,
      reverseFromFlowOffset,
      latestPathMainFlowTravel,
      pathAnimationOffset,
      flow.cycle,
      nowMs,
    );
  } else if (pathChanged) {
    const consumedCompensation = consumePathTransitionCompensation(
      snapshot.path,
      flow.cycle,
    );
    if (!consumedCompensation.consumed) {
      const shift = getHeadShiftDelta(
        snapshot.path,
        previousPath,
        refs,
        getGridCanvasOffset(refs, headOffsetScratch),
      );
      if (shift !== 0) {
        pathAnimationOffset = normalizeFlowOffset(
          pathAnimationOffset + (shift * PATH_FLOW_ANCHOR_RATIO),
          flow.cycle,
        );
      }
    }
  } else if (transitionCompensationBuffer.hasPending()) {
    clearPathTransitionCompensationBuffer();
  }

  latestPathSnapshot = snapshot;
  latestPathRefs = refs;
  latestPathStatuses = statuses;
  latestPathStatusSets = buildStatusSets(statuses || {});
  latestCompletionModel = completionModel;
  latestTutorialFlags = tutorialFlags;

  const animateFlowVisibility = (
    hasActivePathFlowVisibility(snapshot.path, nowMs)
    && flowFreeze.mix > PATH_FLOW_FREEZE_EPSILON
  );
  const offset = (animateFlow || animateFlowVisibility || flowFreeze.active) ? pathAnimationOffset : 0;
  drawAllInternal(snapshot, refs, statuses, offset, completionModel, tutorialFlags);

  const animateTipArrivals = hasActivePathTipArrivals(nowMs);
  const animateRetainedArc = hasActivePathRetainedArc(snapshot.path, nowMs);
  const animateEndArrowRotate = hasActivePathEndArrowRotate(snapshot.path, nowMs);
  const animateStartFlowRotate = hasActivePathStartFlowRotate(snapshot.path, nowMs);
  const animateStartPinPresence = hasActivePathStartPinPresence(snapshot.path, nowMs);
  const animateTipHoverScale = hasActivePathTipHoverScale(
    snapshot.path,
    latestInteractionModel,
    nowMs,
  );
  const animateReverseTipSwap = hasActivePathReverseTipSwap(snapshot.path, nowMs);
  const animateReverseGradientBlend = hasActivePathReverseGradientBlend(
    snapshot.path,
    flow.cycle,
    nowMs,
  );
  return (
    flowFreeze.active
    || animateFlow
    || animateFlowVisibility
    || animateTipArrivals
    || animateRetainedArc
    || animateEndArrowRotate
    || animateStartFlowRotate
    || animateStartPinPresence
    || animateTipHoverScale
    || animateReverseTipSwap
    || animateReverseGradientBlend
  );
}

function drawStaticSymbols(snapshot, refs, statuses) {
  const { symbolCtx, symbolCanvas } = refs;
  if (!symbolCtx || !symbolCanvas) return;

  countSymbolRedraws();
  clearCanvas(symbolCtx, symbolCanvas);

  drawCornerCounts(snapshot, refs, symbolCtx, statuses?.hintStatus?.cornerVertexStatus);
  drawCrossStitches(snapshot, refs, symbolCtx, statuses?.stitchStatus?.vertexStatus);
}

function drawTutorialBracketsOnSymbolCanvas(refs, tutorialFlags = null, flowOffset = pathFramePayload.flowOffset) {
  if (!tutorialFlags?.path && !tutorialFlags?.movable) return;
  const { symbolCtx } = refs;
  if (!symbolCtx) return;

  const centers = Array.isArray(pathFramePayload.tutorialBracketCenters)
    ? pathFramePayload.tutorialBracketCenters
    : [];
  const cellSize = Math.max(0, Number(pathFramePayload.tutorialBracketCellSize) || 0);
  if (cellSize <= 0 || centers.length === 0) return;

  const rawColor = pathFramePayload.tutorialBracketColorRgb || TUTORIAL_BRACKET_COLOR_RGB;
  const colorR = Math.max(0, Math.min(255, Math.round(Number(rawColor?.r) || TUTORIAL_BRACKET_COLOR_RGB.r)));
  const colorG = Math.max(0, Math.min(255, Math.round(Number(rawColor?.g) || TUTORIAL_BRACKET_COLOR_RGB.g)));
  const colorB = Math.max(0, Math.min(255, Math.round(Number(rawColor?.b) || TUTORIAL_BRACKET_COLOR_RGB.b)));

  const halfSize = cellSize * 0.5;
  const inset = cellSize * 0.05;
  const cornerRadius = Math.max(1, (cellSize * 0.2142857143) - inset);
  const cornerThickness = Math.max(1.2, cornerRadius * 0.31);
  const baseCornerAnchor = Math.max(0, halfSize - inset - cornerRadius);
  const flowCycle = Math.max(1, Number(pathFramePayload.flowCycle) || PATH_FLOW_CYCLE);
  const normalizedOffset = ((flowOffset % flowCycle) + flowCycle) % flowCycle;
  const phaseUnit = normalizedOffset / flowCycle;
  const pulse = pathFramePayload.tutorialBracketPulseEnabled
    ? (0.5 - (0.5 * Math.cos(phaseUnit * TAU * TUTORIAL_BRACKET_PULSE_CYCLES)))
    : 1;
  const inwardShift = Math.min(baseCornerAnchor, (cornerRadius * 0.16) * pulse);
  const cornerAnchor = Math.max(0, baseCornerAnchor - inwardShift);
  const whiteMix = Math.max(0, Math.min(1, 0.14 + (pulse * 0.18)));
  const alpha = Math.max(0, Math.min(1, 0.88 + (pulse * 0.12)));
  const drawR = Math.round(colorR + ((255 - colorR) * whiteMix));
  const drawG = Math.round(colorG + ((255 - colorG) * whiteMix));
  const drawB = Math.round(colorB + ((255 - colorB) * whiteMix));

  symbolCtx.save();
  symbolCtx.strokeStyle = `rgba(${drawR}, ${drawG}, ${drawB}, ${alpha})`;
  symbolCtx.lineWidth = cornerThickness;
  symbolCtx.lineCap = 'round';
  symbolCtx.lineJoin = 'round';
  symbolCtx.shadowColor = `rgba(${drawR}, ${drawG}, ${drawB}, ${0.3 + (pulse * 0.1)})`;
  symbolCtx.shadowBlur = Math.max(0.5, cornerThickness * 1.25);

  for (let i = 0; i < centers.length; i++) {
    const center = centers[i];
    const cx = Number(center?.x);
    const cy = Number(center?.y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

    symbolCtx.beginPath();
    symbolCtx.arc(cx - cornerAnchor, cy - cornerAnchor, cornerRadius, Math.PI, Math.PI * 1.5);
    symbolCtx.stroke();

    symbolCtx.beginPath();
    symbolCtx.arc(cx + cornerAnchor, cy - cornerAnchor, cornerRadius, Math.PI * 1.5, TAU);
    symbolCtx.stroke();

    symbolCtx.beginPath();
    symbolCtx.arc(cx - cornerAnchor, cy + cornerAnchor, cornerRadius, Math.PI * 0.5, Math.PI);
    symbolCtx.stroke();

    symbolCtx.beginPath();
    symbolCtx.arc(cx + cornerAnchor, cy + cornerAnchor, cornerRadius, 0, Math.PI * 0.5);
    symbolCtx.stroke();
  }

  symbolCtx.restore();
}

function drawAnimatedPathImpl(
  snapshot,
  refs,
  statuses,
  flowOffset = 0,
  completionModel = null,
  tutorialFlags = null,
) {
  const pathRenderer = ensurePathRenderer({
    refs,
    allowRecovery: !interactiveResizeActive,
  });
  if (!pathRenderer) return;

  if (!snapshot) {
    latestPathMainFlowTravel = 0;
    pathRenderer.clear();
    return;
  }

  const layout = ensurePathLayoutMetrics(refs);
  const size = layout.cell;
  const deviceScale = getDevicePixelScale();
  const width = Math.max(7, snapCssToDevicePixel(Math.floor(size * 0.15), deviceScale));
  const arrowLength = Math.max(13, snapCssToDevicePixel(Math.floor(size * 0.24), deviceScale));
  const startRadius = Math.max(6, snapCssToDevicePixel(Math.floor(width * 0.9), deviceScale));
  const endHalfWidth = Math.max(6, snapCssToDevicePixel(Math.floor(width * 0.95), deviceScale));

  if (!pathThemeCacheInitialized) updatePathThemeCache(refs);
  const completionProgress = getCompletionProgress(completionModel);
  const isCompletionSolved = Boolean(completionModel?.isSolved);
  const flowMetrics = getCachedPathFlowMetrics(refs, size);

  const step = size + layout.gap;
  const half = size * 0.5;
  const path = snapshot.path;
  const pathLength = path.length;
  const head = pathLength > 0 ? path[0] : null;
  const tail = pathLength > 0 ? path[pathLength - 1] : null;

  if (pathLength > 0) {
    const pointsChanged = (
      cachedPathRef !== path
      || cachedPathLayoutVersion !== layout.version
      || cachedPathLength !== pathLength
      || cachedPathHeadR !== head.r
      || cachedPathHeadC !== head.c
      || cachedPathTailR !== tail.r
      || cachedPathTailC !== tail.c
    );
    if (!pointsChanged && reusablePathPoints.length === pathLength) {
      // Keep previous pooled coordinates; no geometry mutation needed.
    } else {
      if (reusablePathPoints.length < pathLength) {
        for (let i = reusablePathPoints.length; i < pathLength; i++) {
          reusablePathPoints.push({ x: 0, y: 0 });
        }
      }
      reusablePathPoints.length = pathLength;
      for (let i = 0; i < pathLength; i++) {
        const point = path[i];
        const pooled = reusablePathPoints[i];
        pooled.x = snapCssToDevicePixel(
          layout.offsetX + layout.pad + (point.c * step) + half,
          deviceScale,
        );
        pooled.y = snapCssToDevicePixel(
          layout.offsetY + layout.pad + (point.r * step) + half,
          deviceScale,
        );
      }

      cachedPathRef = path;
      cachedPathLayoutVersion = layout.version;
      cachedPathLength = pathLength;
      cachedPathHeadR = head.r;
      cachedPathHeadC = head.c;
      cachedPathTailR = tail.r;
      cachedPathTailC = tail.c;
      pathGeometryToken += 1;
    }
  } else {
    reusablePathPoints.length = 0;
    const emptyGeometryChanged = (
      cachedPathLength !== 0
      || cachedPathLayoutVersion !== layout.version
      || cachedPathRef !== path
    );
    if (emptyGeometryChanged) {
      cachedPathRef = path;
      cachedPathLayoutVersion = layout.version;
      cachedPathLength = 0;
      cachedPathHeadR = NaN;
      cachedPathHeadC = NaN;
      cachedPathTailR = NaN;
      cachedPathTailC = NaN;
      pathGeometryToken += 1;
    }
  }

  updateTutorialBracketPayload(snapshot, layout, tutorialFlags);

  const nowMs = getNowMs();
  syncPathFlowFreezeTarget(isPathFlowFrozen(), nowMs);
  const flowFreeze = resolvePathFlowFreezeMix(nowMs, pathFlowFreezeMixScratch);
  const flowFreezeMix = clampUnit(flowFreeze.mix);
  const frozenMix = 1 - flowFreezeMix;
  const renderPoints = getPathRenderPointsForFrame(
    path,
    nowMs,
    width,
    startRadius,
    endHalfWidth,
  );
  pathFramePayload.baseStartRadius = startRadius;
  pathFramePayload.baseArrowLength = arrowLength;
  pathFramePayload.baseEndHalfWidth = endHalfWidth;
  const reverseTipSwapActive = applyPathReverseTipSwapToPayload(path, nowMs);
  pathFramePayload.points = renderPoints.points;
  pathFramePayload.retainedStartArcPoints = renderPoints.retainedStartArcPoints;
  pathFramePayload.retainedStartArcGeometryToken = renderPoints.retainedStartArcGeometryToken;
  pathFramePayload.retainedEndArcPoints = renderPoints.retainedEndArcPoints;
  pathFramePayload.retainedEndArcGeometryToken = renderPoints.retainedEndArcGeometryToken;
  pathFramePayload.retainedStartArcWidth = width;
  pathFramePayload.retainedEndArcWidth = width;
  pathFramePayload.width = width;
  if (!reverseTipSwapActive) {
    pathFramePayload.startRadius = startRadius;
    pathFramePayload.arrowLength = arrowLength;
    pathFramePayload.endHalfWidth = endHalfWidth;
  }
  const startPinPresenceActive = applyPathStartPinPresenceToPayload(path, nowMs);
  const endArrowRotateActive = applyPathEndArrowDirectionToPayload(path, nowMs);
  const startFlowRotateActive = applyPathStartFlowDirectionToPayload(path, nowMs);
  const segmentRetractTipScale = clampUnit(
    Number.isFinite(renderPoints.segmentRetractTipScale)
      ? Math.sqrt(renderPoints.segmentRetractTipScale)
      : 1,
  );
  pathFramePayload.arrowLength *= segmentRetractTipScale;
  pathFramePayload.endHalfWidth *= segmentRetractTipScale;
  const tipHoverScale = resolvePathTipHoverScales(
    path,
    latestInteractionModel,
    nowMs,
    pathTipHoverScaleScratch,
  );
  pathFramePayload.startRadius *= tipHoverScale.startScale;
  pathFramePayload.arrowLength *= tipHoverScale.endScale;
  pathFramePayload.endHalfWidth *= tipHoverScale.endScale;
  const startTipWidthScale = startRadius > 0
    ? clampUnit((Number(pathFramePayload.startRadius) || 0) / startRadius)
    : 1;
  const endTipWidthScale = endHalfWidth > 0
    ? clampUnit((Number(pathFramePayload.endHalfWidth) || 0) / endHalfWidth)
    : 1;
  pathFramePayload.retainedStartArcWidth = Math.max(0.5, width * startTipWidthScale);
  pathFramePayload.retainedEndArcWidth = Math.max(0.5, width * endTipWidthScale);
  pathFramePayload.geometryToken = (
    reverseTipSwapActive
    || startPinPresenceActive
    || endArrowRotateActive
    || startFlowRotateActive
    || tipHoverScale.active
  ) ? NaN : renderPoints.geometryToken;
  pathFramePayload.mainColorRgb = mixRgb(
    pathThemeMainRgb,
    FROZEN_PATH_GRAY_RGB,
    frozenMix,
    frozenMainColorScratch,
  );
  pathFramePayload.completeColorRgb = mixRgb(
    pathThemeCompleteRgb,
    FROZEN_PATH_GRAY_RGB,
    frozenMix,
    frozenCompleteColorScratch,
  );
  pathFramePayload.isCompletionSolved = isCompletionSolved;
  pathFramePayload.completionProgress = completionProgress;
  const flowVisibility = resolvePathFlowVisibilityMix(path, nowMs, flowVisibilityMixScratch);
  const flowMix = clampUnit(Number.isFinite(flowVisibility.mix) ? flowVisibility.mix : 1);
  const effectiveFlowMix = flowMix * flowFreezeMix;
  const hasRenderableMainFlowPoints = Array.isArray(pathFramePayload.points)
    && pathFramePayload.points.length > 1;
  const hasRenderableRetainedStartFlowPoints = Array.isArray(pathFramePayload.retainedStartArcPoints)
    && pathFramePayload.retainedStartArcPoints.length > 1;
  const hasRenderableRetainedEndFlowPoints = Array.isArray(pathFramePayload.retainedEndArcPoints)
    && pathFramePayload.retainedEndArcPoints.length > 1;
  const hasRenderableFlowPoints = (
    hasRenderableMainFlowPoints
    || hasRenderableRetainedStartFlowPoints
    || hasRenderableRetainedEndFlowPoints
  );
  pathFramePayload.flowEnabled = (
    !isReducedMotionPreferred()
    && hasRenderableFlowPoints
    && effectiveFlowMix > PATH_FLOW_FREEZE_EPSILON
  );
  pathFramePayload.flowMix = effectiveFlowMix;
  pathFramePayload.flowOffset = flowOffset + (Number(renderPoints.flowTravelCompensation) || 0);
  pathFramePayload.flowCycle = flowMetrics.cycle;
  pathFramePayload.flowPulse = flowMetrics.pulse;
  pathFramePayload.flowBaseSpeed = flowMetrics.speed;
  pathFramePayload.flowSpeed = flowMetrics.speed * flowFreezeMix;
  if (effectiveFlowMix > PATH_FLOW_FREEZE_EPSILON) {
    applyPathReverseGradientBlendToPayload(path, flowMetrics.cycle, nowMs);
  } else {
    pathFramePayload.reverseColorBlend = 1;
    pathFramePayload.reverseFromFlowOffset = 0;
    pathFramePayload.reverseTravelSpan = 0;
  }
  pathFramePayload.flowRise = PATH_FLOW_RISE;
  pathFramePayload.flowDrop = PATH_FLOW_DROP;
  pathFramePayload.drawTutorialBracketsInPathLayer = false;
  countPathDraws();
  latestPathMainFlowTravel = pathRenderer.drawPathFrame(pathFramePayload);
}

const pathAnimationEngine = createPathAnimationEngine({
  nowFn: getNowMs,
  isReducedMotionPreferred: () => isReducedMotionPreferred(),
  onSetInteractionModel: (interactionModel) => {
    latestInteractionModel = interactionModel;
  },
  onUpdatePathLayoutMetrics: (offset, cell, gap, pad) =>
    updatePathLayoutMetrics(offset, cell, gap, pad),
  onNotifyInteractiveResize: () => {
    interactiveResizeActive = true;
  },
});

function drawAnimatedPath(
  snapshot,
  refs,
  statuses,
  flowOffset = 0,
  completionModel = null,
  tutorialFlags = null,
) {
  return pathAnimationEngine.drawAnimatedPath(
    snapshot,
    refs,
    statuses,
    flowOffset,
    completionModel,
    tutorialFlags,
    { drawAnimatedPathInternal: drawAnimatedPathImpl },
  );
}

function drawAllInternal(
  snapshot,
  refs,
  statuses,
  flowOffset = 0,
  completionModel = null,
  tutorialFlags = null,
) {
  drawStaticSymbols(snapshot, refs, statuses);
  drawAnimatedPath(snapshot, refs, statuses, flowOffset, completionModel, tutorialFlags);
  drawTutorialBracketsOnSymbolCanvas(refs, tutorialFlags, flowOffset);
}

function drawCrossStitches(snapshot, refs, ctx, vertexStatus = EMPTY_MAP) {
  ctx.save();
  ctx.globalAlpha = 1;

  const layout = ensurePathLayoutMetrics(refs);
  const offset = getGridCanvasOffset(refs, gridOffsetScratch);
  const cell = layout.cell;
  const canvasScale = getCanvasScale(ctx);
  const stitchLineHalf = snapCanvasLength(Math.max(2, cell * 0.18), canvasScale.min);
  const stitchWidth = snapCanvasLength(Math.max(1, cell * 0.06), canvasScale.min);
  if (!pathThemeCacheInitialized) updatePathThemeCache(refs);
  const colorGood = pathThemeGoodRaw || '#16a34a';
  const colorBad = pathThemeBadRaw || '#e85c5c';
  const colorPending = '#ffffff';
  const shadowOpaque = pathThemeStitchShadowRaw || '#0a111b';

  const resolveDiagStatus = (entry, key) => {
    if (typeof entry === 'string') return entry;
    return entry?.[key] || 'pending';
  };

  const buildUnsnappedLine = (x1, y1, x2, y2) => ({
    x1,
    y1,
    x2,
    y2,
  });

  const drawLine = (line, color, width) => {
    const snappedWidth = snapCanvasLength(width, canvasScale.min);
    ctx.strokeStyle = color;
    ctx.lineWidth = snappedWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  };

  for (const [vr, vc] of snapshot.stitches) {
    const point = getVertexPoint(vr, vc, refs, offset, headPointScratchA, canvasScale.x);
    const centerX = point.x;
    const centerY = point.y;
    const diagALine = buildUnsnappedLine(
      centerX - stitchLineHalf,
      centerY - stitchLineHalf,
      centerX + stitchLineHalf,
      centerY + stitchLineHalf,
    );
    const diagBLine = buildUnsnappedLine(
      centerX + stitchLineHalf,
      centerY - stitchLineHalf,
      centerX - stitchLineHalf,
      centerY + stitchLineHalf,
    );
    drawLine(diagALine, shadowOpaque, stitchWidth * 2.0);
    drawLine(diagBLine, shadowOpaque, stitchWidth * 2.0);
  }

  const drawStatePass = (state, color) => {
    for (const [vr, vc] of snapshot.stitches) {
      const vk = keyOf(vr, vc);
      const entry = vertexStatus.get(vk) || 'pending';
      const diagAState = resolveDiagStatus(entry, 'diagA');
      const diagBState = resolveDiagStatus(entry, 'diagB');
      const point = getVertexPoint(vr, vc, refs, offset, headPointScratchB, canvasScale.x);
      const centerX = point.x;
      const centerY = point.y;
      const diagALine = buildUnsnappedLine(
        centerX - stitchLineHalf,
        centerY - stitchLineHalf,
        centerX + stitchLineHalf,
        centerY + stitchLineHalf,
      );
      const diagBLine = buildUnsnappedLine(
        centerX + stitchLineHalf,
        centerY - stitchLineHalf,
        centerX - stitchLineHalf,
        centerY + stitchLineHalf,
      );
      if (diagAState === state) {
        drawLine(diagALine, color, stitchWidth);
      }
      if (diagBState === state) {
        drawLine(diagBLine, color, stitchWidth);
      }
    }
  };

  drawStatePass('pending', colorPending);
  drawStatePass('good', colorGood);
  drawStatePass('bad', colorBad);

  ctx.restore();
}

function drawCornerCounts(snapshot, refs, ctx, cornerVertexStatus = EMPTY_MAP) {
  if (!snapshot.cornerCounts || snapshot.cornerCounts.length === 0) return;

  const layout = ensurePathLayoutMetrics(refs);
  const offset = getGridCanvasOffset(refs, gridOffsetScratch);
  const cell = layout.cell;
  const canvasScale = getCanvasScale(ctx);
  const cornerRadius = snapCanvasLength(Math.max(6, cell * 0.17), canvasScale.min);
  const cornerLineWidth = snapCanvasLength(Math.max(1, cell * 0.04), canvasScale.min);
  const cornerFontSize = Math.max(12, Math.round(cell * 0.22));

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${cornerFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;

  if (!pathThemeCacheInitialized) updatePathThemeCache(refs);
  const colorGood = pathThemeGoodRaw || '#16a34a';
  const colorBad = pathThemeBadRaw || '#e85c5c';
  const colorPending = pathThemeCornerPending;
  const cornerFillColor = pathThemeCornerFill;

  for (const [vr, vc, target] of snapshot.cornerCounts) {
    const vk = keyOf(vr, vc);
    const state = cornerVertexStatus.get(vk) || 'pending';
    let accentColor = colorPending;
    if (state === 'good') accentColor = colorGood;
    else if (state === 'bad') accentColor = colorBad;

    const point = getVertexPoint(vr, vc, refs, offset, headPointScratchC, canvasScale.x);
    const x = point.x;
    const y = point.y;

    ctx.beginPath();
    ctx.fillStyle = cornerFillColor;
    ctx.arc(x, y, cornerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = cornerLineWidth;
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.fillText(String(target), x, y);
  }

  ctx.restore();
}

function resizeCanvas(refs) {
  const { boardWrap, canvas, symbolCanvas, symbolCtx } = refs;
  if (!boardWrap || !canvas || !symbolCanvas || !symbolCtx || !refs.gridEl) return;
  const dpr = getDevicePixelScale();
  const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;
  const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
  const wrapRect = boardWrap.getBoundingClientRect();
  const gridRect = refs.gridEl.getBoundingClientRect();
  const nextSignature = [
    activeBoardSize.rows,
    activeBoardSize.cols,
    boardWrap.clientWidth,
    boardWrap.clientHeight,
    boardWrap.offsetWidth,
    boardWrap.offsetHeight,
    wrapRect.left,
    wrapRect.top,
    wrapRect.width,
    wrapRect.height,
    gridRect.left,
    gridRect.top,
    gridRect.width,
    gridRect.height,
    dpr,
    viewportWidth,
    viewportHeight,
  ].join('|');
  if (nextSignature === resizeCanvasSignature) return;
  resizeCanvasSignature = nextSignature;

  syncBoardCellSize(refs);

  const styles = getComputedStyle(boardWrap);
  const borderLeft = parseFloat(styles.borderLeftWidth || '0') || 0;
  const borderRight = parseFloat(styles.borderRightWidth || '0') || 0;
  const borderTop = parseFloat(styles.borderTopWidth || '0') || 0;
  const borderBottom = parseFloat(styles.borderBottomWidth || '0') || 0;
  const cw = Math.max(0, wrapRect.width - borderLeft - borderRight);
  const ch = Math.max(0, wrapRect.height - borderTop - borderBottom);
  const innerLeft = wrapRect.left + boardWrap.clientLeft;
  const innerTop = wrapRect.top + boardWrap.clientTop;
  const offset = {
    x: gridRect.left - innerLeft,
    y: gridRect.top - innerTop,
  };
  const gridStyles = getComputedStyle(refs.gridEl);
  const gap = parsePx(gridStyles.columnGap || gridStyles.gap || '0');
  const pad = parsePx(gridStyles.paddingLeft || gridStyles.padding || '0');
  const cellFromStyle = parsePx(
    boardWrap.style.getPropertyValue('--cell')
    || refs.gridEl.style.getPropertyValue('--cell')
    || styles.getPropertyValue('--cell'),
  );
  const cell = cellFromStyle > 0 ? cellFromStyle : getCellSize(refs.gridEl);
  updateBoardLayoutMetrics({
    rows: activeBoardSize.rows,
    cols: activeBoardSize.cols,
    left: gridRect.left,
    top: gridRect.top,
    right: gridRect.right,
    bottom: gridRect.bottom,
    size: cell,
    gap,
    pad,
    step: cell + gap,
    scrollX: window.scrollX || window.pageXOffset || 0,
    scrollY: window.scrollY || window.pageYOffset || 0,
  });

  if (interactiveResizeActive) {
    applyCanvasCssSize(canvas, cw, ch);
    applyCanvasCssSize(symbolCanvas, cw, ch);
    applyScaledSymbolCanvasTransform(symbolCanvas, symbolCtx, cw, ch);
    scheduleInteractiveResizeFlush({
      refs,
      cssWidth: cw,
      cssHeight: ch,
      dpr,
      offset,
      cell,
      gap,
      pad,
    });
    return;
  }

  pendingInteractiveResizePayload = null;
  clearInteractiveResizeTimer();
  pathAnimationEngine.updatePathLayoutMetrics(offset, cell, gap, pad);
  if (wallGhostEl) refreshWallGhostOffset();
  const pathRenderer = ensurePathRenderer(refs);
  if (pathRenderer) pathRenderer.resize(cw, ch, dpr);
  configureHiDPICanvas(symbolCanvas, symbolCtx, cw, ch, dpr);
}

function notifyInteractiveResize() {
  pathAnimationEngine.notifyInteractiveResize();
}

const setPathFlowFreezeImmediate = (isFrozen = false) => {
  pathAnimationEngine.setPathFlowFreezeImmediate(isFrozen);
};

const applyImmediateInteractionState = (interactionModel = {}) => {
  if (!refs) return;
  if (interactionModel.dropTarget && Number.isInteger(interactionModel.dropTarget.r) && Number.isInteger(interactionModel.dropTarget.c)) {
    setDropTarget(interactionModel.dropTarget.r, interactionModel.dropTarget.c);
  } else {
    clearDropTarget();
  }

  const ghost = interactionModel.wallGhost;
  if (ghost?.visible) {
    showWallDragGhost(ghost.x || 0, ghost.y || 0);
    moveWallDragGhost(ghost.x || 0, ghost.y || 0);
  } else {
    hideWallDragGhost();
  }
};

const applyInteractionState = (interactionModel = {}) => {
  if (!refs) return;
  applyImmediateInteractionState(interactionModel);
  syncPathTipDragHoverCell(interactionModel);
};

const resetCoreState = () => {
  gridCells = [];
  lastDropTargetKey = null;
  lastPathTipDragHoverCell = null;
  wallGhostEl = null;
  cachedBoardWrap = null;
  activeBoardSize = { rows: 0, cols: 0 };
  pathAnimationOffset = 0;
  pathAnimationFrame = 0;
  pathAnimationLastTs = 0;
  latestPathSnapshot = null;
  latestPathRefs = null;
  latestPathStatuses = null;
  latestPathStatusSets = null;
  latestCompletionModel = null;
  latestTutorialFlags = null;
  latestInteractionModel = null;
  latestMessageKind = null;
  latestMessageHtml = '';
  pendingRenderState = null;
  clearPendingRenderDirty();
  latestPathMainFlowTravel = 0;
  colorParserCtx = null;
  reusablePathPoints = [];
  reusableTutorialBracketPoints = [];
  reusableCellViewModel = null;
  resizeCanvasSignature = '';
  lastFlowMetricCell = NaN;
  pathThemeCacheInitialized = false;
  pathThemeLineRaw = '';
  pathThemeGoodRaw = '';
  pathThemeMainRgb = { r: 255, g: 255, b: 255 };
  pathThemeCompleteRgb = { r: 34, g: 197, b: 94 };
  pathGeometryToken = 0;
  cachedPathRef = null;
  cachedPathLength = -1;
  cachedPathHeadR = NaN;
  cachedPathHeadC = NaN;
  cachedPathTailR = NaN;
  cachedPathTailC = NaN;
  cachedPathLayoutVersion = -1;
  pathStartRetainedArcState = null;
  pathEndRetainedArcState = null;
  pathRetainedArcTokenSeed = 0;
  tutorialBracketSignature = '';
  tutorialBracketGeometryToken = 0;
  wallGhostOffsetLeft = 0;
  wallGhostOffsetTop = 0;
  lastPathRendererRecoveryAttemptMs = 0;
  interactiveResizeActive = false;
  interactiveResizeTimer = 0;
  lowPowerFrameDelayTimer = 0;
  lastPresentedFrameTimestamp = 0;
  pendingInteractiveResizePayload = null;
  realTimeLastMs = 0;
  scaledTimeAccumulatorMs = 0;
  reusableArrivalPathPoints = [];
  reusableStartRetainedArcPoints = [];
  reusableEndRetainedArcPoints = [];
  clearBoardLayoutMetrics();
  clearPathRetainedArcStates();
  clearPathTipHoverScaleStates();
  transitionCompensationBuffer.clear();
  lowPowerModeEnabled = false;
};

return {
  mount(shellRefs = null) {
    refs = shellRefs || cacheElements();
    if (shellRefs) {
      cachedBoardWrap = refs?.boardWrap || null;
      pathAnimationEngine.resetForCacheElements(refs);
      latestPathRefs = refs;
    }
    setLegendIcons(icons, refs, iconX);
  },

  getRefs() {
    return refs;
  },

  getLayoutMetrics() {
    return boardLayoutMetrics.ready ? boardLayoutMetrics : null;
  },

  rebuildGrid(snapshot) {
    if (!refs) return;
    buildGrid(snapshot, refs, icons, iconX);
  },

  renderFrame({
    snapshot,
    evaluation,
    completion = null,
    uiModel = {},
    interactionModel = {},
  }) {
    if (!refs) return;
    latestInteractionModel = interactionModel;
    pendingRenderState = {
      snapshot,
      evaluation,
      completion,
      uiModel,
    };
    pendingRenderDirty.cells = true;
    pendingRenderDirty.path = true;
    pendingRenderDirty.symbols = true;
    pendingRenderDirty.interaction = true;
    if (Object.prototype.hasOwnProperty.call(uiModel, 'messageHtml')) {
      pendingRenderDirty.message = true;
    }
    scheduleRendererFrame();
  },

  updateInteraction(interactionModel = {}) {
    latestInteractionModel = interactionModel;
    pathAnimationEngine.setInteractionModel(interactionModel);
    applyImmediateInteractionState(interactionModel);
    pendingRenderDirty.interaction = true;
    scheduleRendererFrame();
  },

  resize() {
    if (!refs) return;
    pathThemeCacheInitialized = false;
    resizeCanvas(refs);
    if (!interactiveResizeActive && latestPathSnapshot) {
      pendingRenderDirty.symbols = true;
      pendingRenderDirty.path = true;
      scheduleRendererFrame();
    }
  },

  setLowPowerMode(enabled = false) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled === lowPowerModeEnabled) return;
    lowPowerModeEnabled = nextEnabled;
    clearLowPowerFrameDelayTimer();
    lastPresentedFrameTimestamp = 0;
    resizeCanvasSignature = '';
    pathThemeCacheInitialized = false;
    if (lowPowerModeEnabled) {
      pathAnimationEngine.resetTransitionState();
      clearPathRetainedArcStates();
      clearPathTipHoverScaleStates();
      clearPathTransitionCompensationBuffer();
      stopPathAnimation();
    }
    if (refs) {
      resizeCanvas(refs);
      if (!pendingRenderState && latestPathSnapshot && latestPathStatuses) {
        pendingRenderState = {
          snapshot: latestPathSnapshot,
          evaluation: latestPathStatuses,
          completion: latestCompletionModel,
          uiModel: {
            messageKind: latestMessageKind,
            messageHtml: latestMessageHtml,
            tutorialFlags: latestTutorialFlags,
          },
        };
        pendingRenderDirty.path = true;
        pendingRenderDirty.symbols = true;
        pendingRenderDirty.interaction = true;
      }
      scheduleRendererFrame();
    }
  },

  notifyResizeInteraction() {
    notifyInteractiveResize();
  },

  setPathFlowFreezeImmediate(isFrozen = false) {
    setPathFlowFreezeImmediate(isFrozen);
  },

  recordPathTransition(previousSnapshot, nextSnapshot) {
    if (!refs) return;
    recordPathTransitionCompensation(previousSnapshot, nextSnapshot, refs);
  },

  clearPathTransitionCompensation() {
    clearPathTransitionCompensationBuffer();
  },

  destroy() {
    clearDropTarget();
    hideWallDragGhost();
    syncPathTipDragHoverCell({ isPathDragging: false, pathDragCursor: null }, []);
    clearInteractiveResizeTimer();
    clearLowPowerFrameDelayTimer();
    stopPathAnimation();
    refs?.pathRenderer?.destroy?.();
    pathAnimationEngine.resetForCacheElements(null);
    refs = null;
    resetCoreState();
  },
};
}
