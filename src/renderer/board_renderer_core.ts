import { CELL_TYPES, ELEMENT_IDS } from '../config.ts';
import { cellCenter, getCellSize, vertexPos } from '../geometry.ts';
import { ICONS } from '../icons.ts';
import type {
  BoardLayoutMetrics,
  CanvasElementLike,
  ElementLike,
  EvaluateResult,
  GameSnapshot,
  GridPoint,
  InteractionModel,
  RendererRefs,
  RuntimeData,
  TutorialFlags,
  UiRenderModel,
} from '../contracts/ports.ts';
import {
  angleDeltaSigned,
  cellDistance,
  clampNumber,
  clampUnit,
  pointsMatch,
} from '../math.ts';
import { isReducedMotionPreferred as readReducedMotionPreference } from '../reduced_motion.ts';
import { keyOf } from '../utils.ts';
import {
  buildBoardCellViewModel,
} from './board_view_model.ts';
import type {
  BoardCellViewState,
} from './board_view_model.ts';
import {
  createPathAnimationEngine,
  resolveHeadShiftTransitionWindow
} from './path_animation_engine.ts';
import { createPathTransitionCompensationBuffer } from './path_transition_compensation_buffer.ts';
import {
  getPathTipFromPath,
  isEndRetractTransition,
  isPathReversed,
  isRetractUnturnTransition,
  isStartRetractTransition,
  normalizeFlowOffset,
  pathsMatch
} from './path_transition_utils.ts';
import { applyCanvasElementSize, resolveCanvasSize } from './canvas_size_utils.ts';
import {
  createPathWebglRenderer,
} from './path_webgl_renderer.ts';
import type {
  PathFramePayload,
  PathRenderer,
} from './path_webgl_renderer.ts';

interface BoardRendererCoreOptions {
  icons?: Record<string, string>;
  iconX?: string;
  debugCounters?: Record<string, number> | null;
}

interface CompletionModel {
  isSolved: boolean;
  isCompleting: boolean;
  startTimeMs: number;
  durationMs: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface PathLayoutMetricsState {
  ready: boolean;
  version: number;
  offsetX: number;
  offsetY: number;
  cell: number;
  gap: number;
  pad: number;
}

interface RetainedArcState {
  side: 'start' | 'end';
  startTimeMs: number;
  settleStartTimeMs: number;
  cornerR: number;
  cornerC: number;
  movingR: number;
  movingC: number;
  arcInR: number;
  arcInC: number;
  arcOutR: number;
  arcOutC: number;
  geometryTokenSeed: number;
}

interface RetainedArcRenderData {
  retainedStartArcPoints: Point2D[];
  retainedStartArcGeometryToken: number;
  retainedEndArcPoints: Point2D[];
  retainedEndArcGeometryToken: number;
}

interface RetainedArcRenderResult {
  points: Point2D[];
  geometryToken: number;
  active: boolean;
}

interface TipMotion {
  moving: boolean;
  centerX: number;
  centerY: number;
}

interface DirectionState {
  x: number;
  y: number;
  active: boolean;
}

interface FlowFreezeMixState {
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

interface ReverseTipScaleState {
  inScale: number;
  outScale: number;
  active: boolean;
}

interface ReverseGradientBlendState {
  blend: number;
  fromFlowOffset: number;
  toFlowOffset: number;
  fromTravelSpan: number;
  active: boolean;
}

interface TipArrivalOffsetState {
  x: number;
  y: number;
  active: boolean;
  mode: 'none' | 'arrive' | 'retract';
  remain: number;
  progress: number;
  linearRemain: number;
  linearProgress: number;
}

interface TipHoverScaleState {
  fromScale: number;
  toScale: number;
  startTimeMs: number;
}

interface TipHoverScaleResolvedState {
  scale: number;
  active: boolean;
}

interface TipHoverScalePair {
  startScale: number;
  endScale: number;
  active: boolean;
}

interface PendingRenderState {
  snapshot: GameSnapshot;
  evaluation: EvaluateResult;
  completion: CompletionModel | null;
  uiModel: UiRenderModel;
}

interface StatusSets {
  badHint: Set<string>;
  goodHint: Set<string>;
  badRps: Set<string>;
  goodRps: Set<string>;
  badBlocked: Set<string>;
}

type EvaluateResultLike = Partial<EvaluateResult> | null | undefined;

interface PathCanvasSwap {
  previousCanvas: CanvasElementLike;
  nextCanvas: CanvasElementLike;
}

interface InteractiveResizePayload {
  refs: RendererRefs;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  offset: Point2D;
  cell: number;
  gap: number;
  pad: number;
}

interface GridRefsLike {
  gridEl?: ElementLike | null;
}

interface GridCanvasRefsLike extends GridRefsLike {
  boardWrap?: ElementLike | null;
}

interface TravelContext {
  nextPath: GridPoint[];
  previousPath: GridPoint[];
  refs: GridRefsLike;
  offset: Point2D;
  flowWidth: number;
}

interface HeadShiftTransitionWindow {
  shiftCount: number;
  nextStart: number;
  prevStart: number;
  overlap: number;
  isFullLengthOverlap: boolean;
  isPureHeadShift: boolean;
}

interface PathFlowMetrics {
  cycle: number;
  pulse: number;
  speed: number;
}

interface PathRenderPointsResult extends RetainedArcRenderData {
  points: Point2D[];
  geometryToken: number;
  flowTravelCompensation: number;
  segmentRetractTipScale: number;
}

interface BoardNavMarkerTarget {
  r: number;
  c: number;
  variant: 'cursor' | 'selected';
}

interface EndpointPathDelta {
  side: 'start' | 'end';
  prevChanged: GridPoint[];
  nextChanged: GridPoint[];
}

interface PathSizing {
  width: number;
  arrowLength: number;
  startRadius: number;
  endHalfWidth: number;
}

interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type DebugCounterFn = (amount?: number) => void;
type GridCells = Array<Array<ElementLike | null>>;
type BoardCellViewModel = BoardCellViewState[][];
type MaybePath = GridPoint[] | null | undefined;
type LegendIconKey =
  | 'bTurn'
  | 'bCW'
  | 'bCCW'
  | 'bStraight'
  | 'bH'
  | 'bV'
  | 'bX'
  | 'bSc'
  | 'bRo'
  | 'bPa'
  | 'bMoveWall';

const readInteger = (value: unknown): number | null => (
  Number.isInteger(value) ? value as number : null
);

const DEBUG_COUNTER_NOOP = () => { };
const ZERO_OFFSET: Readonly<Point2D> = Object.freeze({ x: 0, y: 0 });
const RGB_HEX_RE = /^#[0-9a-f]{6}$/i;
const CSS_ANGLE_UNITS: readonly string[] = ['deg', 'rad', 'turn'];
const IS_TETHER_DEV_RUNTIME = typeof __TETHER_DEV__ === 'boolean' ? __TETHER_DEV__ : true;
const asDomElement = (element: ElementLike | Element | null | undefined): Element | null => (
  element instanceof Element ? element : null
);

const parseCssFunctionArguments = (
  value: unknown,
  functionName: string,
  expectedCount: number | null = null,
): string[] | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const openIndex = trimmed.indexOf('(');
  const closeIndex = trimmed.lastIndexOf(')');
  if (openIndex <= 0 || closeIndex !== trimmed.length - 1) return null;
  const name = trimmed.slice(0, openIndex).trim().toLowerCase();
  if (name !== functionName) return null;

  const args = trimmed
    .slice(openIndex + 1, closeIndex)
    .split(',')
    .map((part) => part.trim());
  if (expectedCount !== null && args.length !== expectedCount) return null;
  return args;
};

const isSignedNumberString = (value: unknown): boolean => {
  const trimmed = String(value).trim();
  if (!trimmed) return false;

  let index = (trimmed.startsWith('+') || trimmed.startsWith('-')) ? 1 : 0;
  let sawDigit = false;
  let sawDot = false;

  if (index >= trimmed.length) return false;

  for (; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char >= '0' && char <= '9') {
      sawDigit = true;
      continue;
    }
    if (char === '.' && !sawDot) {
      sawDot = true;
      continue;
    }
    return false;
  }

  return sawDigit && trimmed.at(-1) !== '.';
};

const isCssPercentageValue = (value: unknown): boolean => {
  const trimmed = String(value).trim();
  return trimmed.endsWith('%') && isSignedNumberString(trimmed.slice(0, -1));
};

const isCssAngleValue = (value: unknown): boolean => {
  const trimmed = String(value).trim().toLowerCase();
  for (const unit of CSS_ANGLE_UNITS) {
    if (trimmed.endsWith(unit)) {
      return isSignedNumberString(trimmed.slice(0, -unit.length));
    }
  }
  return isSignedNumberString(trimmed);
};

const resolveOpaqueFunctionColor = (
  value: unknown,
  sourceName: string,
  targetName: string,
  validators: Array<(value: string) => boolean>,
): string | null => {
  const args = parseCssFunctionArguments(value, sourceName, validators.length);
  if (!args) return null;
  if (!validators.every((validator, index) => validator(args[index]))) return null;
  return `${targetName}(${args[0]}, ${args[1]}, ${args[2]})`;
};

const resolveRgbColorParts = (value: unknown): [string, string, string] | null => {
  const rgbArgs = parseCssFunctionArguments(value, 'rgb', 3);
  if (rgbArgs?.every((part) => isSignedNumberString(part))) {
    return [rgbArgs[0], rgbArgs[1], rgbArgs[2]];
  }
  const rgbaArgs = parseCssFunctionArguments(value, 'rgba', 4);
  if (rgbaArgs?.slice(0, 3).every((part) => isSignedNumberString(part))) {
    return [rgbaArgs[0], rgbaArgs[1], rgbaArgs[2]];
  }
  return null;
};

function setLegendIcons(
  icons: Record<string, string>,
  refs: RendererRefs | null,
  iconX: string,
): void {
  const map: Record<LegendIconKey, string> = {
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

  (Object.keys(map) as LegendIconKey[]).forEach((id: LegendIconKey) => {
    const refEl = refs?.[id] || null;
    if (refEl) refEl.innerHTML = map[id] || '';
  });
}

const createDebugCounterFnsDev = (
  debugCounters: Record<string, number> | null = null,
): [DebugCounterFn, DebugCounterFn, DebugCounterFn, DebugCounterFn, DebugCounterFn] => {
  if (!debugCounters) {
    return [
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
      DEBUG_COUNTER_NOOP,
    ];
  }

  const increment = (name: string, amount: number = 1): void => {
    const previous = Number(debugCounters[name]) || 0;
    debugCounters[name] = previous + amount;
  };

  return [
    (amount: number = 1) => increment('heavyFrameRenders', amount),
    (amount: number = 1) => increment('pathDraws', amount),
    (amount: number = 1) => increment('incrementalCellPatches', amount),
    (amount: number = 1) => increment('fullCellRebuilds', amount),
    (amount: number = 1) => increment('symbolRedraws', amount),
  ];
};

const createDebugCounterFns = IS_TETHER_DEV_RUNTIME
  ? createDebugCounterFnsDev
  : (): [DebugCounterFn, DebugCounterFn, DebugCounterFn, DebugCounterFn, DebugCounterFn] => [
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
    DEBUG_COUNTER_NOOP,
  ];

export function createBoardRendererCore(options: BoardRendererCoreOptions = {}) {
  const icons = options.icons || {};
  const iconX = options.iconX || '';
  const [
    countHeavyFrameRenders,
    countPathDraws,
    countIncrementalCellPatches,
    countFullCellRebuilds,
    countSymbolRedraws,
  ] = createDebugCounterFns(options.debugCounters || null);
  let refs: RendererRefs | null = null;
  let gridCells: GridCells = [];
  let lastDropTargetKey: string | null = null;
  let lastPathTipDragHoverCell: ElementLike | null = null;
  let lastPathTipDragSelectedCell: ElementLike | null = null;
  let boardNavMarkerEl: ElementLike | null = null;
  let wallGhostEl: ElementLike | null = null;
  let cachedBoardWrap: ElementLike | null = null;
  let activeBoardSize = { rows: 0, cols: 0 };
  let pathAnimationOffset = 0;
  let pathAnimationFrame = 0;
  let pathAnimationLastTs = 0;
  let latestPathSnapshot: GameSnapshot | null = null;
  let latestPathRefs: RendererRefs | null = null;
  let latestPathStatuses: EvaluateResult | null = null;
  let latestPathStatusSets: StatusSets | null = null;
  let latestCompletionModel: CompletionModel | null = null;
  let latestTutorialFlags: TutorialFlags | null = null;
  let latestInteractionModel: InteractionModel | null = null;
  let latestMessageKind: string | null = null;
  let latestMessageHtml = '';
  let pendingRenderState: PendingRenderState | null = null;
  const pendingRenderDirty = {
    cells: false,
    path: false,
    symbols: false,
    message: false,
    interaction: false,
  };
  let pendingPathCanvasSwap: PathCanvasSwap | null = null;
  let latestPathMainFlowTravel = 0;
  let colorParserCtx: CanvasRenderingContext2D | null = null;
  let reusablePathPoints: Point2D[] = [];
  let reusableTutorialBracketPoints: Point2D[] = [];
  let reusableCellViewModel: BoardCellViewModel | null = null;
  let resizeCanvasSignature = '';
  let lastFlowMetricCell = Number.NaN;
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
  let cachedPathRef: GridPoint[] | null = null;
  let cachedPathLength = -1;
  let cachedPathHeadR = Number.NaN;
  let cachedPathHeadC = Number.NaN;
  let cachedPathTailR = Number.NaN;
  let cachedPathTailC = Number.NaN;
  let cachedPathLayoutVersion = -1;
  let pathStartRetainedArcState: RetainedArcState | null = null;
  let pathEndRetainedArcState: RetainedArcState | null = null;
  let pathRetainedArcTokenSeed = 0;
  let tutorialBracketSignature = '';
  let tutorialBracketGeometryToken = 0;
  let lowPowerModeEnabled = false;
  let lowPowerFrameDelayTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let lastPresentedFrameTimestamp = 0;
  let wallGhostOffsetLeft = 0;
  let wallGhostOffsetTop = 0;
  let lastPathRendererRecoveryAttemptMs = 0;
  let interactiveResizeActive = false;
  let interactiveResizeTimer: ReturnType<typeof window.setTimeout> | 0 = 0;
  let pendingInteractiveResizePayload: InteractiveResizePayload | null = null;
  const pathFlowMetricsCache: PathFlowMetrics = { cycle: 128, pulse: 64, speed: -32 };
  const gridOffsetScratch = { x: 0, y: 0 };
  const boardNavPointScratch = { x: 0, y: 0 };
  const headOffsetScratch = { x: 0, y: 0 };
  const headPointScratchA = { x: 0, y: 0 };
  const headPointScratchB = { x: 0, y: 0 };
  const headPointScratchC = { x: 0, y: 0 };
  const keyParseScratch = { r: 0, c: 0 };
  const EMPTY_MAP = new Map<string, unknown>();
  const TUTORIAL_BRACKET_COLOR_RGB: RgbColor = { r: 120, g: 190, b: 255 };
  const FROZEN_PATH_GRAY_RGB: RgbColor = { r: 156, g: 156, b: 156 };
  const tutorialBracketColorScratch: RgbColor = { r: 120, g: 190, b: 255 };
  const pathFlowFreezeMixScratch: FlowFreezeMixState = { mix: 1, active: false };
  const themeColorScratch = { r: 0, g: 0, b: 0 };
  const pathLayoutMetrics: PathLayoutMetricsState = {
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
  const pathFramePayload: PathFramePayload = {
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
    mainColorRgb: undefined,
    completeColorRgb: undefined,
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
    tutorialBracketColorRgb: undefined,
    drawTutorialBracketsInPathLayer: false,
    endArrowDirX: Number.NaN,
    endArrowDirY: Number.NaN,
    startFlowDirX: Number.NaN,
    startFlowDirY: Number.NaN,
    retainedStartArcWidth: 0,
    retainedEndArcWidth: 0,
    retainedStartArcPoints: [],
    retainedEndArcPoints: [],
    retainedStartArcGeometryToken: Number.NaN,
    retainedEndArcGeometryToken: Number.NaN,
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
  const arrivalOffsetScratchA: TipArrivalOffsetState = {
    x: 0,
    y: 0,
    active: false,
    mode: 'none',
    remain: 1,
    progress: 0,
    linearRemain: 1,
    linearProgress: 0,
  };
  const arrivalOffsetScratchB: TipArrivalOffsetState = {
    x: 0,
    y: 0,
    active: false,
    mode: 'none',
    remain: 1,
    progress: 0,
    linearRemain: 1,
    linearProgress: 0,
  };
  let reusableArrivalPathPoints: Point2D[] = [];
  const startPinPresenceScaleScratch: StartPinPresenceScaleState = {
    scale: 1,
    active: false,
    mode: 'none' as const,
    anchorR: Number.NaN,
    anchorC: Number.NaN,
  };
  const flowVisibilityMixScratch: FlowFreezeMixState = { mix: 1, active: false };
  const pathTipHoverScaleScratch: TipHoverScalePair = { startScale: 1, endScale: 1, active: false };
  const reusableStartPinPresencePoint = { x: 0, y: 0 };
  const reusableStartPinPresencePoints = [reusableStartPinPresencePoint];
  const frozenMainColorScratch = { r: 255, g: 255, b: 255 };
  const frozenCompleteColorScratch = { r: 34, g: 197, b: 94 };
  const reverseTipScaleScratch: ReverseTipScaleState = { inScale: 1, outScale: 0, active: false };
  const reverseGradientBlendScratch: ReverseGradientBlendState = {
    blend: 1,
    fromFlowOffset: 0,
    toFlowOffset: 0,
    fromTravelSpan: 0,
    active: false,
  };
  const endArrowDirectionScratch: DirectionState = { x: Number.NaN, y: Number.NaN, active: false };
  const startFlowDirectionScratch: DirectionState = { x: Number.NaN, y: Number.NaN, active: false };
  const retainedArcRenderScratchA: RetainedArcRenderResult = {
    points: [],
    geometryToken: Number.NaN,
    active: false,
  };
  const retainedArcRenderScratchB: RetainedArcRenderResult = {
    points: [],
    geometryToken: Number.NaN,
    active: false,
  };
  let reusableStartRetainedArcPoints: Point2D[] = [];
  let reusableEndRetainedArcPoints: Point2D[] = [];
  const pathStartTipHoverScaleState: TipHoverScaleState = { fromScale: 1, toScale: 1, startTimeMs: Number.NaN };
  const pathEndTipHoverScaleState: TipHoverScaleState = { fromScale: 1, toScale: 1, startTimeMs: Number.NaN };

  const clearPendingRenderDirty = () => {
    pendingRenderDirty.cells = false;
    pendingRenderDirty.path = false;
    pendingRenderDirty.symbols = false;
    pendingRenderDirty.message = false;
    pendingRenderDirty.interaction = false;
  };

  const stageLatestFrameForRender = () => {
    if (!latestPathSnapshot || !latestPathStatuses) return false;
    if (!pendingRenderState) {
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
    }
    pendingRenderDirty.path = true;
    pendingRenderDirty.symbols = true;
    pendingRenderDirty.interaction = true;
    return true;
  };

  const clearLowPowerFrameDelayTimer = () => {
    if (!lowPowerFrameDelayTimer) return;
    clearTimeout(lowPowerFrameDelayTimer);
    lowPowerFrameDelayTimer = 0;
  };

  const easeOutCubic = (unit: number) => {
    const t = clampUnit(unit);
    const inv = 1 - t;
    return 1 - (inv * inv * inv);
  };

  const mixRgb = (
    from: RgbColor | null | undefined,
    to: RgbColor | null | undefined,
    mixUnit: number,
    out: RgbColor | null = null,
  ): RgbColor => {
    const unit = clampUnit(mixUnit);
    const target = out || { r: 0, g: 0, b: 0 };
    const safeFrom = from || null;
    const safeTo = to || null;
    const fromR = Number.isFinite(Number(safeFrom?.r)) ? Number(safeFrom?.r) : 0;
    const fromG = Number.isFinite(Number(safeFrom?.g)) ? Number(safeFrom?.g) : 0;
    const fromB = Number.isFinite(Number(safeFrom?.b)) ? Number(safeFrom?.b) : 0;
    const toR = Number.isFinite(Number(safeTo?.r)) ? Number(safeTo?.r) : 0;
    const toG = Number.isFinite(Number(safeTo?.g)) ? Number(safeTo?.g) : 0;
    const toB = Number.isFinite(Number(safeTo?.b)) ? Number(safeTo?.b) : 0;
    target.r = Math.max(0, Math.min(255, Math.round(fromR + ((toR - fromR) * unit))));
    target.g = Math.max(0, Math.min(255, Math.round(fromG + ((toG - fromG) * unit))));
    target.b = Math.max(0, Math.min(255, Math.round(fromB + ((toB - fromB) * unit))));
    return target;
  };

  const resolvePathFlowFreezeMix = (
    nowMs: number = getNowMs(),
    out = pathFlowFreezeMixScratch,
  ) => pathAnimationEngine.resolvePathFlowFreezeMix(nowMs, out);

  const syncPathFlowFreezeTarget = (isFrozen: boolean, nowMs: number = getNowMs()) => (
    pathAnimationEngine.syncPathFlowFreezeTarget(isFrozen, nowMs)
  );

  const isPathFlowFrozen = () => Boolean(latestInteractionModel?.isDailyLocked);
  const clearPathTransitionCompensationBuffer = () => {
    transitionCompensationBuffer.clear();
  };

  const recordPathTransitionCompensation = (
    previousSnapshot: GameSnapshot,
    nextSnapshot: GameSnapshot,
    refs: RendererRefs | null = null,
  ) => transitionCompensationBuffer.record(previousSnapshot, nextSnapshot, refs);

  const consumePathTransitionCompensation = (
    path: MaybePath,
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
    pathStartTipHoverScaleState.startTimeMs = Number.NaN;
    pathEndTipHoverScaleState.fromScale = 1;
    pathEndTipHoverScaleState.toScale = 1;
    pathEndTipHoverScaleState.startTimeMs = Number.NaN;
  };

  const updatePathEndArrowRotateState = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.updatePathEndArrowRotateState(prevPath, nextPath, nowMs);

  const resolvePathEndArrowDirection = (
    path: MaybePath,
    nowMs: number = getNowMs(),
    out = endArrowDirectionScratch,
  ) => pathAnimationEngine.resolvePathEndArrowDirection(path, nowMs, out);

  const hasActivePathEndArrowRotate = (
    path: MaybePath,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.hasActivePathEndArrowRotate(path, nowMs);

  const applyPathEndArrowDirectionToPayload = (path: MaybePath, nowMs: number = getNowMs()) => {
    const direction = resolvePathEndArrowDirection(path, nowMs, endArrowDirectionScratch);
    pathFramePayload.endArrowDirX = direction.active ? direction.x : Number.NaN;
    pathFramePayload.endArrowDirY = direction.active ? direction.y : Number.NaN;
    return direction.active;
  };

  const updatePathStartFlowRotateState = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.updatePathStartFlowRotateState(prevPath, nextPath, nowMs);

  const resolvePathStartFlowDirection = (
    path: MaybePath,
    nowMs: number = getNowMs(),
    out = startFlowDirectionScratch,
  ) => pathAnimationEngine.resolvePathStartFlowDirection(path, nowMs, out);

  const hasActivePathStartFlowRotate = (
    path: MaybePath,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.hasActivePathStartFlowRotate(path, nowMs);

  const applyPathStartFlowDirectionToPayload = (path: MaybePath, nowMs: number = getNowMs()) => {
    const direction = resolvePathStartFlowDirection(path, nowMs, startFlowDirectionScratch);
    pathFramePayload.startFlowDirX = direction.active ? direction.x : Number.NaN;
    pathFramePayload.startFlowDirY = direction.active ? direction.y : Number.NaN;
    return direction.active;
  };

  const clearSinglePathRetainedArcState = (side: 'start' | 'end') => {
    if (side === 'start') clearPathStartRetainedArcState();
    else if (side === 'end') clearPathEndRetainedArcState();
  };

  const updateSinglePathRetainedArcState = (
    side: 'start' | 'end',
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs: number = getNowMs(),
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

    pathRetainedArcTokenSeed += 1;
    const nextState = {
      side,
      startTimeMs: nowMs,
      settleStartTimeMs: Number.NaN,
      cornerR: nextTip.r,
      cornerC: nextTip.c,
      movingR: prevTip.r,
      movingC: prevTip.c,
      arcInR: side === 'start' ? prevTip.r : neighbor.r,
      arcInC: side === 'start' ? prevTip.c : neighbor.c,
      arcOutR: side === 'start' ? neighbor.r : prevTip.r,
      arcOutC: side === 'start' ? neighbor.c : prevTip.c,
      geometryTokenSeed: pathRetainedArcTokenSeed,
    };
    if (side === 'start') pathStartRetainedArcState = nextState;
    else pathEndRetainedArcState = nextState;
  };

  const updatePathRetainedArcStates = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs: number = getNowMs(),
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

  const isRetainedArcStateCompatibleWithPath = (state: RetainedArcState | null, path: MaybePath): boolean => {
    if (!state || !Array.isArray(path) || path.length <= 0) return false;
    if (state.side === 'start') {
      const head = path[0];
      return Boolean(head && head.r === state.cornerR && head.c === state.cornerC);
    }
    const tail = path.at(-1);
    return Boolean(tail && tail.r === state.cornerR && tail.c === state.cornerC);
  };

  const getCellPointFromLayout = (r: number, c: number, out = headPointScratchA) => {
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

  const clearArcPointPool = (points: Point2D[]) => {
    if (Array.isArray(points)) points.length = 0;
  };

  const ensureArcPointPoolLength = (points: Point2D[], length: number) => {
    if (!Array.isArray(points)) return;
    if (points.length < length) {
      for (let i = points.length; i < length; i++) {
        points.push({ x: 0, y: 0 });
      }
    }
    points.length = length;
  };

  const buildRetainedArcPolyline = (
    state: RetainedArcState | null,
    width: number,
    outPoints: Point2D[],
    settleUnit = 0,
  ): Point2D[] | null => {
    clearArcPointPool(outPoints);
    if (!state || width <= 0) return null;
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
    if (inLen <= 0 || outLen <= 0) return null;
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
    if (desiredAbsTurn <= FLOW_TRAVEL_ANGLE_TOLERANCE) return null;

    const turnSign = turn < 0 ? -1 : 1;
    const desiredOutAngle = inAngle + (turnSign * desiredAbsTurn);
    const desiredOutUx = Math.cos(desiredOutAngle);
    const desiredOutUy = Math.sin(desiredOutAngle);

    const radius = width * 0.5;
    const tangentOffset = radius * Math.tan(desiredAbsTurn * 0.5);
    if (tangentOffset <= 0 || !Number.isFinite(tangentOffset)) return null;

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
    px: number,
    py: number,
    points: Point2D[],
  ) => {
    if (!Array.isArray(points) || points.length <= 0) return Infinity;
    let maxDistance = 0;
    for (const element of points) {
      const point = element;
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      maxDistance = Math.max(maxDistance, Math.hypot(px - x, py - y));
    }
    return maxDistance;
  };

  const resetRetainedArcRenderResult = (out: RetainedArcRenderResult): RetainedArcRenderResult => {
    out.points = [];
    out.geometryToken = Number.NaN;
    out.active = false;
    return out;
  };

  const getRetainedArcStateForSide = (side: 'start' | 'end') => (
    side === 'start' ? pathStartRetainedArcState : pathEndRetainedArcState
  );

  const getRetainedArcPointPool = (side: 'start' | 'end') => (
    side === 'start' ? reusableStartRetainedArcPoints : reusableEndRetainedArcPoints
  );

  const syncRetainedArcSettleStartTime = (
    state: RetainedArcState,
    tipMotion: TipMotion | null | undefined,
    nowMs: number,
  ): void => {
    if (tipMotion?.moving) {
      state.settleStartTimeMs = Number.NaN;
      return;
    }
    if (!Number.isFinite(state.settleStartTimeMs)) {
      state.settleStartTimeMs = nowMs;
    }
  };

  const getRetainedArcAnimationUnits = (state: RetainedArcState, nowMs: number) => ({
    settleUnit: Number.isFinite(state.settleStartTimeMs)
      ? clampUnit((nowMs - state.settleStartTimeMs) / PATH_RETAINED_ARC_SETTLE_DURATION_MS)
      : 0,
    retractUnit: Number.isFinite(state.startTimeMs)
      ? clampUnit((nowMs - state.startTimeMs) / PATH_TIP_ARRIVAL_DURATION_MS)
      : 0,
  });

  const isRetainedArcFullyCovered = (
    tipMotion: TipMotion | null | undefined,
    coverageRadius: number,
    width: number,
    arcPoints: Point2D[],
  ): boolean => {
    const centerX = tipMotion?.centerX;
    const centerY = tipMotion?.centerY;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || coverageRadius <= 0) {
      return false;
    }
    const maxCenterlineDistance = getMaxDistancePointToPoints(
      centerX as number,
      centerY as number,
      arcPoints,
    );
    const fullyCoveredDistance = coverageRadius - (width * 0.5) - RETAINED_ARC_COVERAGE_EPSILON_PX;
    return fullyCoveredDistance > 0 && maxCenterlineDistance <= fullyCoveredDistance;
  };

  const resolveSinglePathRetainedArc = (
    side: 'start' | 'end',
    path: MaybePath,
    width: number,
    coverageRadius: number,
    nowMs: number,
    tipMotion: TipMotion | null | undefined,
    out: RetainedArcRenderResult,
  ): RetainedArcRenderResult => {
    resetRetainedArcRenderResult(out);

    if (isReducedMotionPreferred()) {
      clearPathRetainedArcStates();
      return out;
    }

    const state = getRetainedArcStateForSide(side);
    if (!state) return out;
    if (!isRetainedArcStateCompatibleWithPath(state, path)) {
      clearSinglePathRetainedArcState(side);
      return out;
    }

    syncRetainedArcSettleStartTime(state, tipMotion, nowMs);
    const { settleUnit, retractUnit } = getRetainedArcAnimationUnits(state, nowMs);
    if (tipMotion?.moving || retractUnit > 0) {
      clearSinglePathRetainedArcState(side);
      return out;
    }
    const arcPoints = buildRetainedArcPolyline(
      state,
      width,
      getRetainedArcPointPool(side),
      settleUnit,
    );
    if (!arcPoints || arcPoints.length < 2) {
      clearSinglePathRetainedArcState(side);
      return out;
    }

    if (isRetainedArcFullyCovered(tipMotion, coverageRadius, width, arcPoints)) {
      clearSinglePathRetainedArcState(side);
      return out;
    }

    out.points = arcPoints;
    out.geometryToken = (
      state.geometryTokenSeed * 1e6
    ) + pathLayoutMetrics.version;
    out.active = true;
    return out;
  };

  const hasActivePathRetainedArc = (path: MaybePath) => {
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
    prevPath: MaybePath,
    nextPath: MaybePath,
    cellSize: number,
    cellStep: number,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.updatePathTipArrivalStates(
    prevPath,
    nextPath,
    cellSize,
    cellStep,
    nowMs,
    latestInteractionModel?.pathTipArrivalHint || null,
  );

  const resolvePathTipArrivalOffset = (
    side: 'start' | 'end',
    tip: GridPoint | null | undefined,
    nowMs: number,
    out: TipArrivalOffsetState,
  ): TipArrivalOffsetState => (
    pathAnimationEngine.resolvePathTipArrivalOffset(side, tip, nowMs, out)
  );

  const hasActivePathTipArrivals = (nowMs: number = getNowMs()) => (
    pathAnimationEngine.hasActivePathTipArrivals(nowMs)
  );

  const updatePathFlowVisibilityState = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.updatePathFlowVisibilityState(prevPath, nextPath, nowMs);

  const resolvePathFlowVisibilityMix = (
    path: MaybePath,
    nowMs: number = getNowMs(),
    out = flowVisibilityMixScratch,
  ) => pathAnimationEngine.resolvePathFlowVisibilityMix(path, nowMs, out);

  const hasActivePathFlowVisibility = (path: MaybePath, nowMs: number = getNowMs()) => (
    pathAnimationEngine.hasActivePathFlowVisibility(path, nowMs, flowVisibilityMixScratch)
  );

  const updatePathStartPinPresenceState = (
    prevPath: MaybePath,
    nextPath: MaybePath,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.updatePathStartPinPresenceState(prevPath, nextPath, nowMs);

  const resolvePathStartPinPresenceScale = (
    path: MaybePath,
    nowMs: number = getNowMs(),
    out = startPinPresenceScaleScratch,
  ) => pathAnimationEngine.resolvePathStartPinPresenceScale(path, nowMs, out);

  const hasActivePathStartPinPresence = (path: MaybePath, nowMs: number = getNowMs()) => (
    pathAnimationEngine.hasActivePathStartPinPresence(path, nowMs, startPinPresenceScaleScratch)
  );

  const applyPathStartPinPresenceToPayload = (path: MaybePath, nowMs: number = getNowMs()) => {
    const presence = resolvePathStartPinPresenceScale(path, nowMs, startPinPresenceScaleScratch);
    const currentStartRadius = Number(pathFramePayload.startRadius) || 0;
    pathFramePayload.startRadius = currentStartRadius * Math.max(0, presence.scale);
    return presence.active;
  };

  const resolvePathTipHoverScaleValue = (
    state: TipHoverScaleState,
    nowMs: number = getNowMs(),
  ): TipHoverScaleResolvedState => {
    const fromScale = Number.isFinite(state?.fromScale) ? state.fromScale : 1;
    const toScale = Number.isFinite(state?.toScale) ? state.toScale : 1;
    const startTimeMs = Number(state?.startTimeMs);
    if (!Number.isFinite(startTimeMs)) {
      return {
        scale: toScale,
        active: Math.abs(toScale - 1) > PATH_TIP_HOVER_SCALE_EPSILON,
      };
    }
    if (PATH_TIP_HOVER_SCALE_DURATION_MS <= 0) {
      state.fromScale = toScale;
      state.startTimeMs = Number.NaN;
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
      state.startTimeMs = Number.NaN;
      return {
        scale: toScale,
        active: Math.abs(toScale - 1) > PATH_TIP_HOVER_SCALE_EPSILON,
      };
    }
    return { scale, active: true };
  };

  const updatePathTipHoverScaleTarget = (
    state: TipHoverScaleState,
    targetScale: number,
    nowMs: number = getNowMs(),
  ): void => {
    const safeTarget = Number.isFinite(targetScale) && targetScale > 0 ? targetScale : 1;
    if (Math.abs(safeTarget - (Number(state?.toScale) || 1)) <= PATH_TIP_HOVER_SCALE_EPSILON) return;
    const resolved = resolvePathTipHoverScaleValue(state, nowMs);
    state.fromScale = resolved.scale;
    state.toScale = safeTarget;
    state.startTimeMs = nowMs;
  };

  const isCellCurrentlyHovered = (cell: ElementLike | null | undefined): boolean => Boolean(cell?.matches?.(':hover'));

  const resolvePathTipHoverScales = (
    path: MaybePath,
    interactionModel: InteractionModel | null = latestInteractionModel,
    nowMs: number = getNowMs(),
    out: TipHoverScalePair = pathTipHoverScaleScratch,
  ): TipHoverScalePair => {
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
      const tail = path.length > 1 ? path.at(-1) : null;
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
    path: MaybePath,
    interactionModel: InteractionModel | null = latestInteractionModel,
    nowMs: number = getNowMs(),
  ) => resolvePathTipHoverScales(path, interactionModel, nowMs, pathTipHoverScaleScratch).active;

  const resolveStartPinDisappearRenderPoints = (
    path: MaybePath,
    nowMs: number = getNowMs(),
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
    path: MaybePath,
    fromFlowOffset: number,
    fromTravelSpan: number,
    toFlowOffset: number,
    cycle = PATH_FLOW_CYCLE,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.beginPathReverseGradientBlend(
    path,
    fromFlowOffset,
    fromTravelSpan,
    toFlowOffset,
    cycle,
    nowMs,
  );

  const resolvePathReverseGradientBlend = (
    path: MaybePath,
    cycle = PATH_FLOW_CYCLE,
    nowMs: number = getNowMs(),
    out = reverseGradientBlendScratch,
  ) => pathAnimationEngine.resolvePathReverseGradientBlend(path, cycle, nowMs, out);

  const hasActivePathReverseGradientBlend = (
    path: MaybePath,
    cycle = PATH_FLOW_CYCLE,
    nowMs: number = getNowMs(),
  ) => pathAnimationEngine.hasActivePathReverseGradientBlend(path, cycle, nowMs);

  const applyPathReverseGradientBlendToPayload = (
    path: MaybePath,
    cycle = PATH_FLOW_CYCLE,
    nowMs: number = getNowMs(),
  ) => {
    const reverseBlend = resolvePathReverseGradientBlend(path, cycle, nowMs, reverseGradientBlendScratch);
    const currentFlowOffset = normalizeFlowOffset(pathFramePayload.flowOffset || 0, cycle);
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

  const updatePathReverseTipSwapState = (prevPath: MaybePath, nextPath: MaybePath, nowMs: number = getNowMs()) => (
    pathAnimationEngine.updatePathReverseTipSwapState(prevPath, nextPath, nowMs)
  );

  const resolvePathReverseTipSwapScale = (path: MaybePath, nowMs: number = getNowMs(), out = reverseTipScaleScratch) => (
    pathAnimationEngine.resolvePathReverseTipSwapScale(path, nowMs, out)
  );

  const hasActivePathReverseTipSwap = (path: MaybePath, nowMs: number = getNowMs()) => (
    pathAnimationEngine.hasActivePathReverseTipSwap(path, nowMs)
  );

  const applyPathReverseTipSwapToPayload = (path: MaybePath, nowMs: number = getNowMs()) => {
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

  const buildPathRenderPointsResult = (
    points: Point2D[],
    geometryToken: number,
    retainedArcs: RetainedArcRenderData,
    flowTravelCompensation = 0,
    segmentRetractTipScale = 1,
  ): PathRenderPointsResult => ({
    points,
    geometryToken,
    flowTravelCompensation,
    segmentRetractTipScale,
    ...retainedArcs,
  });

  const resolveRetainedArcRenderData = (
    path: MaybePath,
    resolvedWidth: number,
    startCoverageRadius: number,
    endCoverageRadius: number,
    nowMs: number,
    startTipMotion: TipMotion | null = null,
    endTipMotion: TipMotion | null = null,
  ): RetainedArcRenderData => {
    const startArc = resolveSinglePathRetainedArc(
      'start',
      path,
      resolvedWidth,
      startCoverageRadius,
      nowMs,
      startTipMotion,
      retainedArcRenderScratchA,
    );
    const endArc = resolveSinglePathRetainedArc(
      'end',
      path,
      resolvedWidth,
      endCoverageRadius,
      nowMs,
      endTipMotion,
      retainedArcRenderScratchB,
    );
    return {
      retainedStartArcPoints: startArc.points,
      retainedStartArcGeometryToken: startArc.geometryToken,
      retainedEndArcPoints: endArc.points,
      retainedEndArcGeometryToken: endArc.geometryToken,
    };
  };

  const resolveFallbackPathRenderPoints = (
    path: MaybePath,
    pathLength: number,
    nowMs: number,
    resolvedWidth: number,
    startCoverageRadius: number,
    endCoverageRadius: number,
  ) => {
    const retainedArcs = resolveRetainedArcRenderData(
      path,
      resolvedWidth,
      startCoverageRadius,
      endCoverageRadius,
      nowMs,
    );
    if (pathLength <= 0) {
      const syntheticPoints = resolveStartPinDisappearRenderPoints(path, nowMs);
      if (syntheticPoints) {
        return buildPathRenderPointsResult(syntheticPoints, Number.NaN, retainedArcs);
      }
    }
    return buildPathRenderPointsResult(reusablePathPoints, pathGeometryToken, retainedArcs);
  };

  const resolveTipCenterCoordinate = (
    targetPoint: Point2D | null | undefined,
    axis: 'x' | 'y',
    offset: TipArrivalOffsetState,
    hasRetract: boolean,
  ): number => {
    if (!targetPoint) return Number.NaN;
    const baseValue = Number(targetPoint?.[axis]);
    if (!Number.isFinite(baseValue)) return Number.NaN;
    const delta = hasRetract ? Number(offset?.[axis]) || 0 : 0;
    return baseValue + delta;
  };

  const ensureArrivalPathPointPoolLength = (length: number) => {
    if (reusableArrivalPathPoints.length < length) {
      for (let i = reusableArrivalPathPoints.length; i < length; i++) {
        reusableArrivalPathPoints.push({ x: 0, y: 0 });
      }
    }
    reusableArrivalPathPoints.length = length;
  };

  const buildArrivalPathRenderPoints = (
    pathLength: number,
    startOffset: TipArrivalOffsetState,
    endOffset: TipArrivalOffsetState,
    startHasRetract: boolean,
    endHasRetract: boolean,
  ): Point2D[] => {
    const renderLength = pathLength + (startHasRetract ? 1 : 0) + (endHasRetract ? 1 : 0);
    ensureArrivalPathPointPoolLength(renderLength);
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

    return reusableArrivalPathPoints;
  };

  const resolvePathFlowTravelCompensation = (
    pathLength: number,
    startOffset: TipArrivalOffsetState,
    resolvedWidth: number,
  ): number => {
    if (pathLength <= 1 || !startOffset.active) return 0;
    const baseTravel = getPathMainTravelFromPoints(reusablePathPoints, resolvedWidth);
    const renderTravel = getPathMainTravelFromPoints(reusableArrivalPathPoints, resolvedWidth);
    if (!Number.isFinite(baseTravel) || !Number.isFinite(renderTravel)) return 0;
    return baseTravel - renderTravel;
  };

  const resolvePathSegmentRetractTipScale = (
    pathLength: number,
    startHasRetract: boolean,
    endHasRetract: boolean,
    startOffset: TipArrivalOffsetState,
    endOffset: TipArrivalOffsetState,
  ): number => {
    if (pathLength !== 1) return 1;
    let segmentRetractTipScale = 1;
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
    return segmentRetractTipScale;
  };

  const getPathRenderPointsForFrame = (
    path: MaybePath,
    nowMs: number = getNowMs(),
    flowWidth: number | undefined = pathFramePayload.width,
    startRadius: number | undefined = pathFramePayload.startRadius,
    endHalfWidth: number | undefined = pathFramePayload.endHalfWidth,
  ): PathRenderPointsResult => {
    if (isReducedMotionPreferred()) {
      pathAnimationEngine.resetTransitionState({ preserveFlowFreeze: true });
      clearPathRetainedArcStates();
      return buildPathRenderPointsResult(reusablePathPoints, pathGeometryToken, {
        retainedStartArcPoints: [],
        retainedStartArcGeometryToken: Number.NaN,
        retainedEndArcPoints: [],
        retainedEndArcGeometryToken: Number.NaN,
      });
    }

    const pathLength = Array.isArray(path) ? path.length : 0;
    const resolvedWidth = typeof flowWidth === 'number' && Number.isFinite(flowWidth) && flowWidth > 0
      ? flowWidth
      : Math.max(1, Number(pathFramePayload.width) || 1);
    const startCoverageRadius = Math.max(0, Number(startRadius) || 0);
    const endCoverageRadius = Math.max(
      resolvedWidth * 0.5,
      Math.max(0, Number(endHalfWidth) || 0),
    );

    if (pathLength <= 0 || reusablePathPoints.length !== pathLength) {
      return resolveFallbackPathRenderPoints(
        path,
        pathLength,
        nowMs,
        resolvedWidth,
        startCoverageRadius,
        endCoverageRadius,
      );
    }

    const startTip = getPathTipFromPath(path, 'start');
    const endTip = getPathTipFromPath(path, 'end');
    const startOffset = resolvePathTipArrivalOffset('start', startTip, nowMs, arrivalOffsetScratchA);
    const endOffset = resolvePathTipArrivalOffset('end', endTip, nowMs, arrivalOffsetScratchB);
    const startHasRetract = startOffset.active && startOffset.mode === 'retract';
    const endHasRetract = endOffset.active && endOffset.mode === 'retract';
    const startTargetPoint = reusablePathPoints[0] || null;
    const endTargetPoint = reusablePathPoints[pathLength - 1] || null;
    const retainedArcs = resolveRetainedArcRenderData(
      path,
      resolvedWidth,
      startCoverageRadius,
      endCoverageRadius,
      nowMs,
      {
        moving: startHasRetract,
        centerX: resolveTipCenterCoordinate(startTargetPoint, 'x', startOffset, startHasRetract),
        centerY: resolveTipCenterCoordinate(startTargetPoint, 'y', startOffset, startHasRetract),
      },
      {
        moving: endHasRetract,
        centerX: resolveTipCenterCoordinate(endTargetPoint, 'x', endOffset, endHasRetract),
        centerY: resolveTipCenterCoordinate(endTargetPoint, 'y', endOffset, endHasRetract),
      },
    );
    if (!startOffset.active && !endOffset.active) {
      return buildPathRenderPointsResult(reusablePathPoints, pathGeometryToken, retainedArcs);
    }

    buildArrivalPathRenderPoints(
      pathLength,
      startOffset,
      endOffset,
      startHasRetract,
      endHasRetract,
    );
    return buildPathRenderPointsResult(
      reusableArrivalPathPoints,
      Number.NaN,
      retainedArcs,
      resolvePathFlowTravelCompensation(pathLength, startOffset, resolvedWidth),
      resolvePathSegmentRetractTipScale(
        pathLength,
        startHasRetract,
        endHasRetract,
        startOffset,
        endOffset,
      ),
    );
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

    const speedMultiplier = import.meta?.env?.DEV && typeof window.TETHER_DEBUG_ANIM_SPEED === 'number'
      ? Math.max(0.1, window.TETHER_DEBUG_ANIM_SPEED)
      : 1;

    scaledTimeAccumulatorMs += (delta / speedMultiplier);
    return scaledTimeAccumulatorMs;
  };

  const getCompletionProgress = (completionModel: CompletionModel | null = latestCompletionModel) => {
    if (!completionModel?.isSolved) return 0;
    if (!completionModel.isCompleting) return 1;

    const durationMs = Number(completionModel.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
    const startTimeMs = Number(completionModel.startTimeMs);
    if (!Number.isFinite(startTimeMs)) return 0;

    const elapsedMs = getNowMs() - startTimeMs;
    return clampUnit(elapsedMs / durationMs);
  };

  const getPathFlowMetrics = (
    refs: RendererRefs | null = latestPathRefs,
    out: PathFlowMetrics | null = null,
    cellSize: number | null = null,
  ): PathFlowMetrics => {
    const cell = typeof cellSize === 'number' && Number.isFinite(cellSize) && cellSize > 0
      ? cellSize
      : getCellSize(asDomElement(refs?.gridEl));
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

  const populatePathSegmentMetrics = (
    points: Point2D[],
    segmentCount: number,
    segmentLengths: number[],
    segmentUx: number[],
    segmentUy: number[],
  ): void => {
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
      if (len <= 0) continue;
      segmentLengths[i] = len;
      segmentUx[i] = dx / len;
      segmentUy[i] = dy / len;
    }
  };

  const populatePathCornerMetrics = (
    pointCount: number,
    cornerRadius: number,
    segmentLengths: number[],
    segmentUx: number[],
    segmentUy: number[],
    cornerTangents: number[],
    cornerArcs: number[],
  ): void => {
    for (let i = 1; i < pointCount - 1; i++) {
      const inLen = segmentLengths[i - 1];
      const outLen = segmentLengths[i];
      if (inLen <= 0 || outLen <= 0) continue;

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
      if (tangentScale <= 0 || !Number.isFinite(tangentScale)) continue;
      const tangentOffset = cornerRadius * tangentScale;
      const maxTangentOffset = Math.max(0, Math.min(inLen, outLen));
      const effectiveTangentOffset = Math.min(tangentOffset, maxTangentOffset);
      if (effectiveTangentOffset <= 0 || !Number.isFinite(effectiveTangentOffset)) continue;
      const effectiveRadius = effectiveTangentOffset / tangentScale;
      if (effectiveRadius <= 0 || !Number.isFinite(effectiveRadius)) continue;
      cornerTangents[i] = effectiveTangentOffset;
      cornerArcs[i] = effectiveRadius * absTurn;
    }
  };

  const getPathMainTravelFromPoints = (
    points: Point2D[],
    flowWidth: number | null | undefined,
    maxSegments: number | null = null,
  ): number => {
    const pointCount = Array.isArray(points) ? points.length : 0;
    if (pointCount < 2) return 0;

    const width = typeof flowWidth === 'number' && Number.isFinite(flowWidth) && flowWidth > 0 ? flowWidth : 1;
    const cornerRadius = width * 0.5;
    const segmentCount = pointCount - 1;
    const segmentLengths = new Array(segmentCount).fill(0);
    const segmentUx = new Array(segmentCount).fill(0);
    const segmentUy = new Array(segmentCount).fill(0);
    populatePathSegmentMetrics(points, segmentCount, segmentLengths, segmentUx, segmentUy);

    const cornerTangents = new Array(pointCount).fill(0);
    const cornerArcs = new Array(pointCount).fill(0);
    populatePathCornerMetrics(
      pointCount,
      cornerRadius,
      segmentLengths,
      segmentUx,
      segmentUy,
      cornerTangents,
      cornerArcs,
    );

    const segmentLimit = typeof maxSegments === 'number' && Number.isInteger(maxSegments)
      ? Math.max(0, Math.min(segmentCount, maxSegments))
      : segmentCount;

    let flowTravel = 0;
    for (let i = 0; i < segmentLimit; i++) {
      const len = segmentLengths[i];
      if (len <= 0) continue;

      const trimStart = cornerTangents[i] > 0 ? Math.min(len, cornerTangents[i]) : 0;
      const trimEnd = cornerTangents[i + 1] > 0 ? Math.min(len, cornerTangents[i + 1]) : 0;
      const drawableStart = trimStart;
      const drawableEnd = Math.max(drawableStart, len - trimEnd);
      flowTravel += Math.max(0, drawableEnd - drawableStart);
      flowTravel += Math.max(0, cornerArcs[i + 1] || 0);
    }

    return flowTravel;
  };

  const resolveCompensationFlowWidth = (
    gridEl: ElementLike | null = null,
    flowWidth: number | null = null,
  ): number => {
    if (typeof flowWidth === 'number' && Number.isFinite(flowWidth) && flowWidth > 0) return flowWidth;
    const cell = pathLayoutMetrics.ready
      ? pathLayoutMetrics.cell
      : getCellSize(asDomElement(gridEl));
    const deviceScale = getDevicePixelScale();
    return Math.max(7, snapCssToDevicePixel(Math.floor(cell * 0.15), deviceScale));
  };

  const createPathPointListFromCells = (
    path: GridPoint[],
    refs: GridRefsLike,
    offset: Point2D,
  ): Point2D[] => {
    const { gridEl } = refs;
    const points = new Array(path.length);
    for (let i = 0; i < path.length; i += 1) {
      const p = getCellPointFromLayout(path[i].r, path[i].c)
        || getCellPoint(path[i].r, path[i].c, { gridEl }, offset);
      points[i] = { x: p.x, y: p.y };
    }
    return points;
  };

  const getPathPrefixTravelFromCells = (
    path: MaybePath,
    prefixLength: number,
    refs: GridRefsLike = {},
    offset = ZERO_OFFSET,
    flowWidth: number | null = null,
  ): number => {
    if (!Array.isArray(path) || path.length < 2) return 0;
    const safePrefixLength = Math.min(path.length, Math.max(0, Number(prefixLength) || 0));
    if (safePrefixLength < 2) return 0;

    const { gridEl } = refs;
    if (!gridEl && !pathLayoutMetrics.ready) return 0;

    const resolvedWidth = resolveCompensationFlowWidth(gridEl, flowWidth);
    const points = createPathPointListFromCells(path.slice(0, safePrefixLength), { gridEl }, offset);
    return getPathMainTravelFromPoints(points, resolvedWidth);
  };

  const getPathTravelToSegmentStartFromCells = (
    path: MaybePath,
    segmentStartIndex: number,
    refs: GridRefsLike = {},
    offset = ZERO_OFFSET,
    flowWidth: number | null = null,
  ): number => {
    if (!Array.isArray(path) || path.length < 2) return 0;
    const safeSegmentStartIndex = Math.min(
      path.length - 1,
      Math.max(0, Number(segmentStartIndex) || 0),
    );
    if (safeSegmentStartIndex <= 0) return 0;

    const { gridEl } = refs;
    if (!gridEl && !pathLayoutMetrics.ready) return 0;

    const resolvedWidth = resolveCompensationFlowWidth(gridEl, flowWidth);
    const points = createPathPointListFromCells(path, { gridEl }, offset);
    return getPathMainTravelFromPoints(points, resolvedWidth, safeSegmentStartIndex);
  };

  const resolveTravelShift = (previousTravel: number, nextTravel: number): number => {
    const shift = previousTravel - nextTravel;
    return Number.isFinite(shift) && shift !== 0 ? shift : 0;
  };

  const resolvePureHeadShiftDelta = (
    nextPath: MaybePath,
    previousPath: MaybePath,
    refs: GridRefsLike,
    offset: Point2D,
    flowWidth: number,
    isPureHeadShift: boolean,
  ): number => {
    if (!isPureHeadShift) return 0;
    const safePreviousPath = previousPath as GridPoint[];
    const safeNextPath = nextPath as GridPoint[];
    const previousTravel = getPathPrefixTravelFromCells(
      safePreviousPath,
      safePreviousPath.length,
      refs,
      offset,
      flowWidth,
    );
    const nextTravel = getPathPrefixTravelFromCells(
      safeNextPath,
      safeNextPath.length,
      refs,
      offset,
      flowWidth,
    );
    return resolveTravelShift(previousTravel, nextTravel);
  };

  const resolveSegmentAnchorHeadShiftDelta = (
    travelContext: TravelContext,
    transitionWindow: HeadShiftTransitionWindow,
  ): number => {
    const {
      nextPath,
      previousPath,
      refs,
      offset,
      flowWidth,
    } = travelContext;
    const {
      nextStart,
      prevStart,
      overlap,
      isFullLengthOverlap,
    } = transitionWindow;
    const shouldUseSegmentStartAnchor = (
      overlap >= 2
      && !isFullLengthOverlap
      && nextStart > 0
      && prevStart > 0
    );
    if (!shouldUseSegmentStartAnchor) return 0;

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
    return resolveTravelShift(previousSegmentStartTravel, nextSegmentStartTravel);
  };

  const resolveNodeAnchorHeadShiftDelta = (
    travelContext: TravelContext,
    transitionWindow: HeadShiftTransitionWindow,
  ): number => {
    const {
      nextPath,
      previousPath,
      refs,
      offset,
      flowWidth,
    } = travelContext;
    const { nextStart, prevStart, overlap } = transitionWindow;
    if (overlap < 1) return 0;
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
    return resolveTravelShift(previousNodeTravel, nextNodeTravel);
  };

  const resolveFallbackHeadShiftDelta = (
    headShiftStepCount: number,
    safeCell: number,
    nextPath: MaybePath,
    previousPath: MaybePath,
  ): number => {
    const fallbackStep = (path: MaybePath) => Math.max(1, cellDistance(path?.[0], path?.[1]) * safeCell);
    const stepCount = Math.abs(headShiftStepCount);
    return headShiftStepCount > 0
      ? -(fallbackStep(nextPath) * stepCount)
      : (fallbackStep(previousPath) * stepCount);
  };

  const getHeadShiftDelta = (
    nextPath: MaybePath,
    previousPath: MaybePath,
    refs: GridRefsLike = {},
    offset: Point2D = ZERO_OFFSET,
  ): number => {
    const { gridEl } = refs;
    if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return 0;

    const transitionWindow = resolveHeadShiftTransitionWindow(nextPath, previousPath) as HeadShiftTransitionWindow | null;
    if (!transitionWindow) return 0;
    const {
      shiftCount: headShiftStepCount,
      isPureHeadShift,
    } = transitionWindow;

    const resolvedCell = getCellSize(asDomElement(gridEl));
    const safeCell = Number.isFinite(resolvedCell) && resolvedCell > 0
      ? resolvedCell
      : PATH_FLOW_BASE_CELL;

    const flowWidth = resolveCompensationFlowWidth(gridEl);
    const travelContext: TravelContext = {
      nextPath,
      previousPath,
      refs,
      offset,
      flowWidth,
    };
    const pureHeadShift = resolvePureHeadShiftDelta(
      nextPath,
      previousPath,
      refs,
      offset,
      flowWidth,
      isPureHeadShift,
    );
    if (pureHeadShift !== 0) return pureHeadShift;

    const segmentAnchorShift = resolveSegmentAnchorHeadShiftDelta(
      travelContext,
      transitionWindow,
    );
    if (segmentAnchorShift !== 0) return segmentAnchorShift;

    const nodeAnchorShift = resolveNodeAnchorHeadShiftDelta(
      travelContext,
      transitionWindow,
    );
    if (nodeAnchorShift !== 0) return nodeAnchorShift;

    return resolveFallbackHeadShiftDelta(headShiftStepCount, safeCell, nextPath, previousPath);
  };

  const transitionCompensationBuffer = createPathTransitionCompensationBuffer({
    resolveShift: (
      nextPath: readonly GridPoint[],
      previousPath: readonly GridPoint[],
      refs: unknown = null,
    ) => {
      const activeRefs = (refs as RendererRefs | null) || latestPathRefs || null;
      if (!pathLayoutMetrics.ready && !activeRefs?.gridEl) return 0;
      const shift = getHeadShiftDelta(
        [...nextPath],
        [...previousPath],
        activeRefs || {},
        getGridCanvasOffset(activeRefs || {}, headOffsetScratch),
      );
      if (!Number.isFinite(shift) || shift === 0) return 0;
      return shift * PATH_FLOW_ANCHOR_RATIO;
    },
  });



  const shouldAnimatePathFlow = (
    snapshot: GameSnapshot,
    completionModel: CompletionModel | null = latestCompletionModel,
    tutorialFlags: TutorialFlags | null = latestTutorialFlags,
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

  const advancePathFlowOffset = (timestamp: number, flowMix: number, shouldAnimateFlow: boolean): void => {
    if (!shouldAnimateFlow || flowMix <= PATH_FLOW_FREEZE_EPSILON || pathAnimationLastTs <= 0) return;
    const dt = Math.max(0, (timestamp - pathAnimationLastTs) / 1000);
    if (!Number.isFinite(dt)) return;
    const baseFlowSpeed = typeof pathFramePayload.flowBaseSpeed === 'number' && Number.isFinite(pathFramePayload.flowBaseSpeed)
      ? pathFramePayload.flowBaseSpeed
      : PATH_FLOW_SPEED;
    const flowSpeed = baseFlowSpeed * clampUnit(flowMix);
    pathFramePayload.flowSpeed = flowSpeed;
    const flowCycle = typeof pathFramePayload.flowCycle === 'number' && Number.isFinite(pathFramePayload.flowCycle) && pathFramePayload.flowCycle > 0
      ? pathFramePayload.flowCycle
      : PATH_FLOW_CYCLE;
    pathAnimationOffset = normalizeFlowOffset(
      pathAnimationOffset + (dt * flowSpeed),
      flowCycle,
    );
  };

  const flushPendingRenderFrame = (timestamp: number) => {
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
      && Object.hasOwn(frame.uiModel || {}, 'messageHtml')
      && refs.msgEl
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

  const resolvePathAnimationActivity = (
    path: MaybePath,
    nowMs: number,
    flowCycle = pathFramePayload.flowCycle,
    interactionModel: InteractionModel | null = latestInteractionModel,
  ) => {
    const animateTipArrivals = hasActivePathTipArrivals(nowMs);
    const animateRetainedArc = hasActivePathRetainedArc(path);
    const animateEndArrowRotate = hasActivePathEndArrowRotate(path, nowMs);
    const animateStartFlowRotate = hasActivePathStartFlowRotate(path, nowMs);
    const animateStartPinPresence = hasActivePathStartPinPresence(path, nowMs);
    const animateTipHoverScale = hasActivePathTipHoverScale(path, interactionModel, nowMs);
    const animateReverseTipSwap = hasActivePathReverseTipSwap(path, nowMs);
    const animateReverseGradientBlend = hasActivePathReverseGradientBlend(path, flowCycle, nowMs);
    return {
      animateTipArrivals,
      animateRetainedArc,
      animateEndArrowRotate,
      animateStartFlowRotate,
      animateStartPinPresence,
      animateTipHoverScale,
      animateReverseTipSwap,
      animateReverseGradientBlend,
      active: (
        animateTipArrivals
        || animateRetainedArc
        || animateEndArrowRotate
        || animateStartFlowRotate
        || animateStartPinPresence
        || animateTipHoverScale
        || animateReverseTipSwap
        || animateReverseGradientBlend
      ),
    };
  };

  const runAnimationOnlyFrame = (timestamp: number) => {
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
    const animationActivity = resolvePathAnimationActivity(
      latestPathSnapshot.path,
      nowMs,
      pathFramePayload.flowCycle,
      latestInteractionModel,
    );
    const shouldContinue = (
      flowFreeze.active
      || animateFlow
      || animateFlowVisibility
      || animationActivity.active
    );

    if (!shouldContinue) {
      pathAnimationLastTs = 0;
      if (latestPathSnapshot && latestPathRefs && latestPathStatuses) {
        drawAllInternal(
          latestPathSnapshot,
          latestPathRefs,
          latestPathStatuses,
          0,
          latestCompletionModel,
          latestTutorialFlags,
        );
      }
      return false;
    }

    advancePathFlowOffset(timestamp, flowFreeze.mix, animateFlow || animateFlowVisibility);

    pathAnimationLastTs = timestamp;
    const flowOffset = (animateFlow || animateFlowVisibility || flowFreeze.active) ? pathAnimationOffset : 0;
    drawIdleAnimatedPath(flowOffset, latestCompletionModel, nowMs);
    return true;
  };

  const runRendererFrame = (timestamp: number) => {
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



  const parsePx = (value: string | null | undefined): number => {
    const parsed = Number.parseFloat(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getDevicePixelScale = () => {
    const dpr = typeof window === 'undefined'
      ? Number.NaN
      : Number(window.devicePixelRatio);
    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    if (lowPowerModeEnabled) return Math.max(1, safeDpr / 2);
    return safeDpr;
  };

  const snapCssToDevicePixel = (value: number, scale: number = getDevicePixelScale()): number => {
    const safeScale = scale > 0 ? scale : 1;
    return Math.round((Number(value) || 0) * safeScale) / safeScale;
  };

  const getCanvasScale = (
    ctx: CanvasRenderingContext2D | null,
  ): { x: number; y: number; min: number } => {
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

  const snapCanvasLength = (value: number, scale: number): number => {
    const safeScale = scale > 0 ? scale : 1;
    return Math.max(1, Math.round(Math.max(0, Number(value) || 0) * safeScale)) / safeScale;
  };


  const configureHiDPICanvas = (
    canvas: CanvasElementLike | HTMLCanvasElement | null,
    ctx: CanvasRenderingContext2D | null,
    cssWidth: number,
    cssHeight: number,
    dpr: number = getDevicePixelScale(),
  ): void => {
    const {
      safeCssWidth,
      safeCssHeight,
      pixelWidth,
      pixelHeight,
      scaleX,
      scaleY,
    } = resolveCanvasSize(cssWidth, cssHeight, dpr);

    if (!canvas || !ctx) return;
    applyCanvasElementSize(canvas, safeCssWidth, safeCssHeight, pixelWidth, pixelHeight);

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

  const clearCanvas = (
    ctx: CanvasRenderingContext2D | null,
    canvas: CanvasElementLike | HTMLCanvasElement | null,
  ): void => {
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Number(canvas.width) || 0, Number(canvas.height) || 0);
    ctx.restore();
  };

  const forceOpaqueColor = (color: string) => {
    if (typeof color !== 'string') return '#ffffff';
    const trimmed = color.trim();
    return resolveOpaqueFunctionColor(
      trimmed,
      'rgba',
      'rgb',
      [isSignedNumberString, isSignedNumberString, isSignedNumberString, isSignedNumberString],
    )
      || resolveOpaqueFunctionColor(
        trimmed,
        'hsla',
        'hsl',
        [isCssAngleValue, isCssPercentageValue, isCssPercentageValue, isSignedNumberString],
      )
      || trimmed;
  };

  const parseColorToRgb = (color: string, out: RgbColor | null = null): RgbColor | null => {
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

    if (RGB_HEX_RE.test(resolved)) {
      const value = Number.parseInt(resolved.slice(1), 16);
      const target = out || { r: 0, g: 0, b: 0 };
      target.r = (value >> 16) & 0xff;
      target.g = (value >> 8) & 0xff;
      target.b = value & 0xff;
      return target;
    }

    const rgbParts = resolveRgbColorParts(resolved);
    if (rgbParts) {
      const target = out || { r: 0, g: 0, b: 0 };
      target.r = Math.max(0, Math.min(255, Math.round(Number(rgbParts[0]))));
      target.g = Math.max(0, Math.min(255, Math.round(Number(rgbParts[1]))));
      target.b = Math.max(0, Math.min(255, Math.round(Number(rgbParts[2]))));
      return target;
    }

    return null;
  };

  const resolveThemeGoodColor = (
    styles: CSSStyleDeclaration | null,
    fallback = '#16a34a',
  ): string => {
    if (!styles) return fallback;

    const goodRgbRaw = String(styles.getPropertyValue('--good-rgb') || '').trim();
    if (goodRgbRaw) {
      const goodFromRgb = `rgb(${goodRgbRaw})`;
      if (parseColorToRgb(goodFromRgb, themeColorScratch)) {
        return goodFromRgb;
      }
    }

    const goodRaw = forceOpaqueColor(String(styles.getPropertyValue('--good') || '').trim());
    if (goodRaw && parseColorToRgb(goodRaw, themeColorScratch)) {
      return goodRaw;
    }

    return fallback;
  };

  const updatePathThemeCache = (refs: RendererRefs | null = latestPathRefs) => {
    const styleTarget = asDomElement(refs?.boardWrap) || document.documentElement;
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

  const getCachedPathFlowMetrics = (
    refs: RendererRefs | null = latestPathRefs,
    cellSize: number | null = null,
  ): PathFlowMetrics => {
    const resolvedCell = typeof cellSize === 'number' && Number.isFinite(cellSize) && cellSize > 0
      ? cellSize
      : getCellSize(asDomElement(refs?.gridEl));
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

  const updatePathLayoutMetrics = (
    offset: Point2D | null | undefined,
    cell: number,
    gap: number,
    pad: number,
  ) => {
    const nextOffsetX = Number(offset?.x) || 0;
    const nextOffsetY = Number(offset?.y) || 0;
    const nextCell = typeof cell === 'number' && Number.isFinite(cell) && cell > 0 ? cell : pathLayoutMetrics.cell;
    const nextGap = typeof gap === 'number' && Number.isFinite(gap) ? gap : pathLayoutMetrics.gap;
    const nextPad = typeof pad === 'number' && Number.isFinite(pad) ? pad : pathLayoutMetrics.pad;
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
      lastFlowMetricCell = Number.NaN;
    }
    pathLayoutMetrics.ready = true;
    return pathLayoutMetrics;
  };

  const updateBoardLayoutMetrics = (metrics: Partial<BoardLayoutMetrics> = {}) => {
    const nextRows = typeof metrics.rows === 'number' && Number.isInteger(metrics.rows) ? metrics.rows : activeBoardSize.rows;
    const nextCols = typeof metrics.cols === 'number' && Number.isInteger(metrics.cols) ? metrics.cols : activeBoardSize.cols;
    const nextLeft = Number(metrics.left) || 0;
    const nextTop = Number(metrics.top) || 0;
    const nextRight = Number(metrics.right) || nextLeft;
    const nextBottom = Number(metrics.bottom) || nextTop;
    const nextSize = typeof metrics.size === 'number' && Number.isFinite(metrics.size) && metrics.size > 0
      ? metrics.size
      : boardLayoutMetrics.size;
    const nextGap = typeof metrics.gap === 'number' && Number.isFinite(metrics.gap) ? metrics.gap : boardLayoutMetrics.gap;
    const nextPad = typeof metrics.pad === 'number' && Number.isFinite(metrics.pad) ? metrics.pad : boardLayoutMetrics.pad;
    const nextStep = typeof metrics.step === 'number' && Number.isFinite(metrics.step) && metrics.step > 0
      ? metrics.step
      : (nextSize + nextGap);
    const nextScrollX = typeof metrics.scrollX === 'number' && Number.isFinite(metrics.scrollX) ? metrics.scrollX : boardLayoutMetrics.scrollX;
    const nextScrollY = typeof metrics.scrollY === 'number' && Number.isFinite(metrics.scrollY) ? metrics.scrollY : boardLayoutMetrics.scrollY;
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

  const ensurePathLayoutMetrics = (refs: RendererRefs | null) => {
    if (pathLayoutMetrics.ready) return pathLayoutMetrics;
    const offset = getGridCanvasOffset(refs, gridOffsetScratch);
    const cell = getCellSize(asDomElement(refs?.gridEl));
    const gridEl = asDomElement(refs?.gridEl);
    const gridStyles = gridEl ? getComputedStyle(gridEl) : null;
    const gap = parsePx(gridStyles?.columnGap || gridStyles?.gap || '0');
    const pad = parsePx(gridStyles?.paddingLeft || gridStyles?.padding || '0');
    return updatePathLayoutMetrics(offset, cell, gap, pad);
  };

  const drawIdleAnimatedPath = (
    flowOffset: number = 0,
    completionModel: CompletionModel | null = latestCompletionModel,
    nowMs: number = getNowMs(),
  ) => {
    if (!latestPathRefs) return;
    const pathRenderer = ensurePathRenderer({
      refs: latestPathRefs,
      allowRecovery: !interactiveResizeActive,
    });
    if (!pathRenderer) return;
    if (!latestPathSnapshot) {
      latestPathMainFlowTravel = 0;
      pathRenderer.clear();
      commitPendingPathCanvasSwap();
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
    ) ? Number.NaN : renderPoints.geometryToken;
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
    commitPendingPathCanvasSwap();

    if (latestTutorialFlags?.path || latestTutorialFlags?.movable) {
      if (!latestPathSnapshot || !latestPathRefs || !latestPathStatuses) return;
      drawStaticSymbols(latestPathSnapshot, latestPathRefs, latestPathStatuses);
      drawTutorialBracketsOnSymbolCanvas(latestPathRefs, latestTutorialFlags, flowOffset);
    }
  };

  const ensureTutorialBracketPoint = (index: number): Point2D => {
    if (!reusableTutorialBracketPoints[index]) {
      reusableTutorialBracketPoints[index] = { x: 0, y: 0 };
    }
    return reusableTutorialBracketPoints[index];
  };

  const visitTutorialBracketCells = (
    snapshot: GameSnapshot,
    pathEnabled: boolean,
    movableEnabled: boolean,
    visitor: (r: number, c: number) => void,
  ): void => {
    if (pathEnabled && snapshot.path.length > 0) {
      const head = snapshot.path[0];
      visitor(head.r, head.c);
      if (snapshot.path.length > 1) {
        const tail = snapshot.path[snapshot.path.length - 1];
        visitor(tail.r, tail.c);
      }
    }

    if (!movableEnabled) return;
    for (let r = 0; r < snapshot.rows; r++) {
      for (let c = 0; c < snapshot.cols; c++) {
        if (snapshot.gridData[r][c] !== 'm') continue;
        visitor(r, c);
      }
    }
  };

  const resolveTutorialBracketColor = (
    snapshot: GameSnapshot,
    pathEnabled: boolean,
    movableEnabled: boolean,
  ): RgbColor => {
    let firstCell: ElementLike | null = null;
    let hoveredCell: ElementLike | null = null;
    let activeCell: ElementLike | null = null;

    visitTutorialBracketCells(snapshot, pathEnabled, movableEnabled, (r: number, c: number) => {
      const cell = gridCells[r]?.[c];
      if (!cell) return;
      if (!firstCell) firstCell = cell;
      if (typeof cell.matches !== 'function') return;
      if (!activeCell && cell.matches(':active')) activeCell = cell;
      if (!hoveredCell && cell.matches(':hover')) hoveredCell = cell;
    });

    const sourceCell = activeCell || hoveredCell || firstCell;
    if (!sourceCell || typeof getComputedStyle !== 'function') return TUTORIAL_BRACKET_COLOR_RGB;
    const cssColor = getComputedStyle(asDomElement(sourceCell) as Element).getPropertyValue('--interactive-corner-color');
    const parsed = parseColorToRgb(cssColor, tutorialBracketColorScratch);
    return parsed || TUTORIAL_BRACKET_COLOR_RGB;
  };

  const updateTutorialBracketPayload = (
    snapshot: GameSnapshot,
    layout: PathLayoutMetricsState,
    tutorialFlags: TutorialFlags | null = null,
  ) => {
    const pathEnabled = Boolean(tutorialFlags?.path);
    const movableEnabled = Boolean(tutorialFlags?.movable);
    const step = layout.cell + layout.gap;
    const half = layout.cell * 0.5;
    let count = 0;
    let signature = `${layout.version}|${pathEnabled ? 1 : 0}|${movableEnabled ? 1 : 0}|`;

    visitTutorialBracketCells(snapshot, pathEnabled, movableEnabled, (r: number, c: number) => {
      const point = ensureTutorialBracketPoint(count);
      point.x = layout.offsetX + layout.pad + (c * step) + half;
      point.y = layout.offsetY + layout.pad + (r * step) + half;
      signature += `${r},${c};`;
      count += 1;
    });

    if (reusableTutorialBracketPoints.length !== count) {
      reusableTutorialBracketPoints.length = count;
    }
    if (signature !== tutorialBracketSignature) {
      tutorialBracketSignature = signature;
      tutorialBracketGeometryToken += 1;
    }

    pathFramePayload.tutorialBracketCenters = reusableTutorialBracketPoints;
    pathFramePayload.tutorialBracketGeometryToken = tutorialBracketGeometryToken;
    pathFramePayload.tutorialBracketCellSize = layout.cell;
    pathFramePayload.tutorialBracketPulseEnabled = !isReducedMotionPreferred();
    pathFramePayload.tutorialBracketColorRgb = resolveTutorialBracketColor(
      snapshot,
      pathEnabled,
      movableEnabled,
    );
  };


  const syncBoardCellSize = (
    refs: RendererRefs,
    rows = activeBoardSize.rows,
    cols = activeBoardSize.cols,
  ) => {
    if (!refs.boardWrap || !refs.gridEl) return;
    if (!rows || !cols || rows <= 0 || cols <= 0) return;

    const boardWrapEl = asDomElement(refs.boardWrap) ?? (refs.boardWrap as unknown as Element);
    const boardStyles = getComputedStyle(boardWrapEl);
    const gap = parsePx(boardStyles.getPropertyValue('--gap')) || 2;
    const boardBorderInline =
      parsePx(boardStyles.borderLeftWidth) + parsePx(boardStyles.borderRightWidth);
    const parent = refs.boardWrap.parentElement;
    const parentInline = (() => {
      if (!parent) return refs.boardWrap.clientWidth || 0;
      const styles = getComputedStyle(asDomElement(parent) ?? (parent as unknown as Element));
      return Math.max(
        0,
        (parent.clientWidth || 0) - parsePx(styles.paddingLeft) - parsePx(styles.paddingRight),
      );
    })();
    const appInline = (() => {
      if (!refs.app) return Infinity;
      const styles = getComputedStyle(asDomElement(refs.app) ?? (refs.app as unknown as Element));
      return Math.max(
        0,
        (refs.app.clientWidth || 0) - parsePx(styles.paddingLeft) - parsePx(styles.paddingRight),
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
        const appStyles = getComputedStyle(asDomElement(refs.app) ?? (refs.app as unknown as Element));
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

  const applyCanvasCssSize = (
    canvas: CanvasElementLike | HTMLCanvasElement | null,
    cssWidth: number,
    cssHeight: number,
  ): void => {
    if (!canvas) return;
    applyCanvasElementSize(canvas, cssWidth, cssHeight);
  };

  const applyScaledSymbolCanvasTransform = (
    canvas: CanvasElementLike | HTMLCanvasElement | null,
    ctx: CanvasRenderingContext2D | null,
    cssWidth: number,
    cssHeight: number,
  ): void => {
    if (!canvas || !ctx) return;
    const {
      safeCssWidth,
      safeCssHeight,
      pixelWidth,
      pixelHeight,
      scaleX,
      scaleY,
    } = resolveCanvasSize(cssWidth, cssHeight, getDevicePixelScale());

    applyCanvasElementSize(canvas, safeCssWidth, safeCssHeight, pixelWidth, pixelHeight);

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

  const createReplacementPathCanvas = (
    canvas: CanvasElementLike | HTMLCanvasElement,
  ): HTMLCanvasElement => {
    const replacement = document.createElement('canvas');
    replacement.id = canvas.id || '';
    replacement.className = canvas.className || '';
    replacement.style.cssText = (canvas as HTMLCanvasElement).style.cssText;
    replacement.width = canvas.width || 1;
    replacement.height = canvas.height || 1;
    return replacement;
  };

  const shouldPathRendererUseAntialias = () => !lowPowerModeEnabled;

  const createPathRenderer = (canvas: HTMLCanvasElement): PathRenderer => createPathWebglRenderer(canvas, {
    antialias: shouldPathRendererUseAntialias(),
  });

  const pathRendererAntialiasMismatch = (renderer: PathRenderer | null | undefined): boolean => (
    typeof renderer?.antialiasEnabled === 'boolean'
    && renderer.antialiasEnabled !== shouldPathRendererUseAntialias()
  );

  const commitPendingPathCanvasSwap = () => {
    if (!pendingPathCanvasSwap) return;
    const { previousCanvas, nextCanvas } = pendingPathCanvasSwap;
    if (previousCanvas?.parentElement && typeof previousCanvas.replaceWith === 'function') {
      previousCanvas.replaceWith(nextCanvas as unknown as Node);
    }
    pendingPathCanvasSwap = null;
  };

  const canSwapPathCanvas = (canvas: CanvasElementLike | HTMLCanvasElement | null | undefined): boolean => (
    Boolean(canvas?.parentElement && typeof canvas.replaceWith === 'function')
  );

  const shouldReusePathRenderer = (
    renderer: PathRenderer | null | undefined,
    rendererLost: boolean,
    antialiasMismatch: boolean,
  ): boolean => (
    Boolean(renderer && !rendererLost && !antialiasMismatch)
  );

  const shouldSkipPathRendererRecovery = (
    allowRecovery: boolean,
    currentRenderer: PathRenderer | null | undefined,
    currentCanvas: CanvasElementLike | HTMLCanvasElement | null | undefined,
    rendererLost: boolean,
    antialiasMismatch: boolean,
  ): PathRenderer | null | undefined => {
    if (shouldReusePathRenderer(currentRenderer, rendererLost, antialiasMismatch)) {
      return currentRenderer;
    }
    if (antialiasMismatch && !allowRecovery) return currentRenderer;
    if (!allowRecovery) return null;
    if (antialiasMismatch && !canSwapPathCanvas(currentCanvas)) return currentRenderer;
    return undefined;
  };

  const beginPathRendererRecovery = (antialiasMismatch: boolean) => {
    if (antialiasMismatch) return true;
    const currentNow = nowMs();
    const elapsedMs = currentNow - lastPathRendererRecoveryAttemptMs;
    if (elapsedMs < PATH_RENDERER_RECOVERY_COOLDOWN_MS) return false;
    lastPathRendererRecoveryAttemptMs = currentNow;
    return true;
  };

  const replacePathCanvasForRecovery = (
    targetRefs: RendererRefs,
    currentCanvas: HTMLCanvasElement,
    rendererLost: boolean,
    antialiasMismatch: boolean,
  ): HTMLCanvasElement => {
    if (!(rendererLost || antialiasMismatch) || !canSwapPathCanvas(currentCanvas)) {
      return currentCanvas;
    }
    const replacement = createReplacementPathCanvas(currentCanvas);
    pendingPathCanvasSwap = {
      previousCanvas: currentCanvas,
      nextCanvas: replacement,
    };
    targetRefs.canvas = replacement;
    return replacement;
  };

  const destroyPathRendererInstance = (
    targetRefs: RendererRefs,
    currentRenderer: PathRenderer | null | undefined,
  ): void => {
    if (!currentRenderer) return;
    try {
      currentRenderer.destroy?.();
    } catch {
      // Keep recovery best-effort; a failed destroy should not prevent re-init.
    }
    targetRefs.pathRenderer = null;
  };

  const initializePathRenderer = (targetRefs: RendererRefs, canvas: HTMLCanvasElement): PathRenderer | null => {
    try {
      const nextRenderer = createPathRenderer(canvas);
      targetRefs.pathRenderer = nextRenderer;
      resizeCanvasSignature = '';
      return nextRenderer;
    } catch {
      return null;
    }
  };

  const ensurePathRenderer = (
    refs: RendererRefs | { refs: RendererRefs; allowRecovery?: boolean } | null,
  ): PathRenderer | null | undefined => {
    const allowRecovery = !(refs && 'allowRecovery' in refs && refs.allowRecovery === false);
    const targetRefs = refs && 'refs' in refs ? refs.refs : refs;
    if (!targetRefs) return null;
    const currentRenderer = (targetRefs.pathRenderer as PathRenderer | null | undefined) || null;
    const currentCanvas = (targetRefs.canvas as HTMLCanvasElement | null) || null;
    if (!currentCanvas) return currentRenderer;

    const rendererLost = Boolean(currentRenderer?.isContextLost?.());
    const antialiasMismatch = !rendererLost && pathRendererAntialiasMismatch(currentRenderer);
    const skippedRecovery = shouldSkipPathRendererRecovery(
      allowRecovery,
      currentRenderer,
      currentCanvas,
      rendererLost,
      antialiasMismatch,
    );
    if (skippedRecovery !== undefined) return skippedRecovery;
    if (!beginPathRendererRecovery(antialiasMismatch)) return null;

    const nextCanvas = replacePathCanvasForRecovery(
      targetRefs,
      currentCanvas,
      rendererLost,
      antialiasMismatch,
    );
    destroyPathRendererInstance(targetRefs, currentRenderer);
    return initializePathRenderer(targetRefs, nextCanvas);
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

    if (refs === latestPathRefs && latestPathSnapshot && latestPathStatuses) {
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

  const scheduleInteractiveResizeFlush = (payload: InteractiveResizePayload): void => {
    pendingInteractiveResizePayload = payload;
    clearInteractiveResizeTimer();
    interactiveResizeTimer = setTimeout(() => {
      interactiveResizeTimer = 0;
      flushInteractiveResize();
    }, INTERACTIVE_RESIZE_IDLE_MS);
  };

  function cacheElements() {
    const get = (id: string): HTMLElement | null => document.getElementById(id);

    const result = {
      app: get(ELEMENT_IDS.APP),
      boardFocusProxy: get(ELEMENT_IDS.BOARD_FOCUS_PROXY),
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
      keyboardGamepadLabel: get(ELEMENT_IDS.KEYBOARD_GAMEPAD_LABEL),
      keyboardGamepadToggle: get(ELEMENT_IDS.KEYBOARD_GAMEPAD_TOGGLE),
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
    } as unknown as RendererRefs;

    if (result.canvas) {
      try {
        result.pathRenderer = createPathRenderer(result.canvas as unknown as HTMLCanvasElement);
      } catch {
        result.pathRenderer = null;
      }
    }
    if (result.symbolCanvas) {
      result.symbolCtx = (result.symbolCanvas as unknown as HTMLCanvasElement).getContext('2d');
    }
    cachedBoardWrap = result.boardWrap;
    resizeCanvasSignature = '';
    lastFlowMetricCell = Number.NaN;
    pathThemeCacheInitialized = false;
    reusablePathPoints.length = 0;
    pathGeometryToken = 0;
    cachedPathRef = null;
    cachedPathLength = -1;
    cachedPathHeadR = Number.NaN;
    cachedPathHeadC = Number.NaN;
    cachedPathTailR = Number.NaN;
    cachedPathTailC = Number.NaN;
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
    pathFramePayload.endArrowDirX = Number.NaN;
    pathFramePayload.endArrowDirY = Number.NaN;
    pathFramePayload.startFlowDirX = Number.NaN;
    pathFramePayload.startFlowDirY = Number.NaN;
    pathFramePayload.retainedStartArcWidth = 0;
    pathFramePayload.retainedEndArcWidth = 0;
    pathFramePayload.retainedStartArcPoints = [];
    pathFramePayload.retainedEndArcPoints = [];
    pathFramePayload.retainedStartArcGeometryToken = Number.NaN;
    pathFramePayload.retainedEndArcGeometryToken = Number.NaN;
    latestTutorialFlags = null;
    latestInteractionModel = null;
    reusableTutorialBracketPoints = [];
    tutorialBracketSignature = '';
    tutorialBracketGeometryToken = 0;
    pathAnimationEngine.resetForCacheElements(result);

    return result;
  }

  const createGhost = (): HTMLDivElement => {
    const ghost = document.createElement('div');
    ghost.className = 'wallDragGhost';
    ghost.innerHTML = `<div class="wallDragGhostMark">${ICONS.m || ''}</div>`;
    return ghost;
  };

  const getGridCanvasOffset = (
    refs: GridCanvasRefsLike | null,
    out: Point2D | null = null,
  ): Point2D => {
    const target = out || { x: 0, y: 0 };
    if (pathLayoutMetrics.ready) {
      target.x = pathLayoutMetrics.offsetX;
      target.y = pathLayoutMetrics.offsetY;
      return target;
    }
    if (!refs?.gridEl || !refs?.boardWrap) {
      target.x = 0;
      target.y = 0;
      return target;
    }
    const gridRect = refs.gridEl.getBoundingClientRect();
    const boardRect = refs.boardWrap.getBoundingClientRect();
    const innerLeft = boardRect.left + (refs.boardWrap.clientLeft || 0);
    const innerTop = boardRect.top + (refs.boardWrap.clientTop || 0);
    target.x = gridRect.left - innerLeft;
    target.y = gridRect.top - innerTop;
    return target;
  };

  const getCellPoint = (
    r: number,
    c: number,
    refs: GridRefsLike,
    offset: Point2D = ZERO_OFFSET,
    out: Point2D | null = null,
  ): Point2D => {
    const target = out || { x: 0, y: 0 };
    if (pathLayoutMetrics.ready) {
      const step = pathLayoutMetrics.cell + pathLayoutMetrics.gap;
      target.x = pathLayoutMetrics.pad + (c * step) + (pathLayoutMetrics.cell * 0.5) + offset.x;
      target.y = pathLayoutMetrics.pad + (r * step) + (pathLayoutMetrics.cell * 0.5) + offset.y;
      return target;
    }
    const p = cellCenter(r, c, asDomElement(refs.gridEl) as Element);
    target.x = p.x + offset.x;
    target.y = p.y + offset.y;
    return target;
  };

  const getVertexPoint = (
    r: number,
    c: number,
    refs: GridRefsLike,
    offset: Point2D = ZERO_OFFSET,
    out: Point2D | null = null,
    dpr: number = 0,
  ): Point2D => {
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
    const p = vertexPos(r, c, asDomElement(refs.gridEl) as Element);
    target.x = p.x + offset.x;
    target.y = p.y + offset.y;
    return target;
  };

  const ensureWallGhostEl = (): ElementLike | null => {
    if (!cachedBoardWrap) return null;
    if (wallGhostEl) return wallGhostEl;

    wallGhostEl = createGhost();
    cachedBoardWrap.appendChild(wallGhostEl as unknown as Node);
    return wallGhostEl;
  };

  const refreshWallGhostOffset = () => {
    if (!cachedBoardWrap) return;
    const rect = cachedBoardWrap.getBoundingClientRect();
    wallGhostOffsetLeft = rect.left + (cachedBoardWrap.clientLeft || 0);
    wallGhostOffsetTop = rect.top + (cachedBoardWrap.clientTop || 0);
  };

  const showWallDragGhost = (x: number, y: number): void => {
    const ghost = ensureWallGhostEl();
    if (!ghost || !cachedBoardWrap) return;
    refreshWallGhostOffset();
    ghost.style.display = 'grid';
    moveWallDragGhost(x, y);
  };

  const moveWallDragGhost = (x: number, y: number): void => {
    if (!wallGhostEl || !cachedBoardWrap) return;
    wallGhostEl.style.left = `${x - wallGhostOffsetLeft}px`;
    wallGhostEl.style.top = `${y - wallGhostOffsetTop}px`;
  };

  const hideWallDragGhost = () => {
    if (!wallGhostEl) return;
    wallGhostEl.remove?.();
    wallGhostEl = null;
    wallGhostOffsetLeft = 0;
    wallGhostOffsetTop = 0;
  };

  function setMessage(msgEl: ElementLike, kind: string | null | undefined, nextHtml = ''): void {
    const nextKind = kind || null;
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

  const resolveCellMarkHtml = (code: string, icons: Record<string, string> = ICONS) => {
    if (code === 'm') return icons.m || '';
    if (code === '#') return '';
    return icons[code] || '';
  };

  function buildGrid(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    icons: Record<string, string>,
    iconX: string,
  ) {
    const { boardWrap, gridEl } = refs;
    if (!gridEl) return;
    activeBoardSize = { rows: snapshot.rows, cols: snapshot.cols };
    syncBoardCellSize(refs);

    if (boardWrap) {
      boardWrap.style.setProperty('--grid-cols', String(snapshot.cols));
      boardWrap.style.setProperty('--grid-rows', String(snapshot.rows));
    }
    gridEl.style.setProperty('--grid-cols', String(snapshot.cols));
    gridEl.style.setProperty('--grid-rows', String(snapshot.rows));

    gridCells = Array.from({ length: snapshot.rows }, () => new Array(snapshot.cols).fill(null));

    gridEl.innerHTML = '';
    const gridStyle = gridEl.style as CSSStyleDeclaration;
    gridStyle.gridTemplateColumns = `repeat(var(--grid-cols), var(--cell))`;
    gridStyle.gridTemplateRows = `repeat(var(--grid-rows), var(--cell))`;

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
        gridEl.appendChild(cell as unknown as Node);
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

  function syncBoardNavMarkerLowPowerMode() {
    if (!boardNavMarkerEl?.classList) return;
    boardNavMarkerEl.classList.toggle('isLowPowerMode', lowPowerModeEnabled);
  }

  function getBoardNavMarkerHost(): ElementLike | null {
    if (!refs?.boardWrap) return null;
    const parent = refs.boardWrap.parentElement;
    if (
      parent
      && typeof (parent as ElementLike).appendChild === 'function'
      && 'style' in parent
    ) {
      return parent as ElementLike;
    }
    return refs.boardWrap;
  }

  function syncBoardNavMarkerFrame() {
    if (!boardNavMarkerEl || !refs?.boardWrap) return;
    const markerHost = getBoardNavMarkerHost();
    if (!markerHost?.getBoundingClientRect) return;

    const hostRect = markerHost.getBoundingClientRect();
    const boardRect = refs.boardWrap.getBoundingClientRect();
    const hostInnerLeft = hostRect.left + (markerHost.clientLeft || 0);
    const hostInnerTop = hostRect.top + (markerHost.clientTop || 0);
    const boardInnerLeft = boardRect.left + (refs.boardWrap.clientLeft || 0);
    const boardInnerTop = boardRect.top + (refs.boardWrap.clientTop || 0);
    const boardStyles = getComputedStyle(asDomElement(refs.boardWrap) ?? (refs.boardWrap as unknown as Element));

    boardNavMarkerEl.style.left = `${boardInnerLeft - hostInnerLeft}px`;
    boardNavMarkerEl.style.top = `${boardInnerTop - hostInnerTop}px`;
    boardNavMarkerEl.style.setProperty(
      '--cell-radius',
      boardStyles.getPropertyValue('--cell-radius') || '0px',
    );
    boardNavMarkerEl.style.setProperty(
      '--cell-shadow-1',
      boardStyles.getPropertyValue('--cell-shadow-1') || '0px',
    );
    boardNavMarkerEl.style.setProperty(
      '--cell-shadow-2',
      boardStyles.getPropertyValue('--cell-shadow-2') || '0px',
    );
  }

  function ensureBoardNavMarker() {
    const markerHost = getBoardNavMarkerHost();
    if (!markerHost) return null;
    if (boardNavMarkerEl?.parentElement === markerHost) {
      syncBoardNavMarkerLowPowerMode();
      syncBoardNavMarkerFrame();
      return boardNavMarkerEl;
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }

    boardNavMarkerEl?.remove?.();
    boardNavMarkerEl = document.createElement('div');
    boardNavMarkerEl.className = 'boardNavMarker';
    if (!markerHost.style.position) markerHost.style.position = 'relative';
    markerHost.appendChild(boardNavMarkerEl as unknown as Node);
    syncBoardNavMarkerLowPowerMode();
    syncBoardNavMarkerFrame();
    return boardNavMarkerEl;
  }

  function removeBoardNavMarker() {
    boardNavMarkerEl?.remove?.();
    boardNavMarkerEl = null;
  }

  const parseGridKey = (value: unknown, out: GridPoint = keyParseScratch): GridPoint | null => {
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
    if (r >= 0 && c >= 0 && gridCells[r]?.[c]) {
      const cell = gridCells[r][c];
      cell.classList.remove('dropTarget', 'wallDropPreview');
      const preview = cell.querySelector('.wallGhostPreviewMarker');
      preview?.remove?.();
    }
    lastDropTargetKey = null;
  }

  function setDropTarget(r: number, c: number) {
    clearDropTarget();
    const key = keyOf(r, c);
    if (gridCells[r]?.[c]) {
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

  function hideBoardNavMarker() {
    if (!boardNavMarkerEl?.classList) return;
    boardNavMarkerEl.classList.remove('isActive', 'isCursor', 'isSelected', 'isInvalidSelection');
  }

  function resolveBoardNavMarkerTarget(
    interactionModel: InteractionModel | null = null,
  ): BoardNavMarkerTarget | null {
    if (interactionModel?.isBoardNavActive !== true || interactionModel?.isDailyLocked === true) {
      return null;
    }

    const selection = interactionModel?.boardSelection;
    const cursor = interactionModel?.boardCursor;
    const cursorRow = readInteger(cursor?.r);
    const cursorCol = readInteger(cursor?.c);
    const selectionRow = readInteger(selection?.r);
    const selectionCol = readInteger(selection?.c);
    if (
      selection?.kind === 'wall'
      && cursorRow !== null
      && cursorCol !== null
      && gridCells[cursorRow]?.[cursorCol]
      && !pointsMatch(selection, cursor)
    ) {
      return { r: cursorRow, c: cursorCol, variant: 'cursor' };
    }
    if (
      selectionRow !== null
      && selectionCol !== null
      && gridCells[selectionRow]?.[selectionCol]
    ) {
      return { r: selectionRow, c: selectionCol, variant: 'selected' };
    }

    if (
      cursorRow !== null
      && cursorCol !== null
      && gridCells[cursorRow]?.[cursorCol]
    ) {
      return { r: cursorRow, c: cursorCol, variant: 'cursor' };
    }

    return null;
  }

  function isBoardNavSelectionInteractive(
    snapshot: GameSnapshot | null,
    selection: InteractionModel['boardSelection'] | null = null,
  ): boolean {
    const selectionRow = readInteger(selection?.r);
    const selectionCol = readInteger(selection?.c);
    if (
      !snapshot
      || selectionRow === null
      || selectionCol === null
      || selectionRow < 0
      || selectionCol < 0
      || selectionRow >= snapshot.rows
      || selectionCol >= snapshot.cols
    ) {
      return false;
    }

    const cellType = snapshot.gridData?.[selectionRow]?.[selectionCol];
    if (selection?.kind === 'wall') return cellType === CELL_TYPES.MOVABLE_WALL;
    if (cellType === CELL_TYPES.MOVABLE_WALL) return true;

    const path = Array.isArray(snapshot.path) ? snapshot.path : [];
    if (path.length === 0) return cellType !== CELL_TYPES.WALL;

    const tail = path[path.length - 1] || null;
    if (tail && pointsMatch(selection, tail)) return true;
    if (path.length > 1) {
      const head = path[0] || null;
      if (head && pointsMatch(selection, head)) return true;
    }

    return false;
  }

  function resolveBoardSelectionInteractiveState(interactionModel: InteractionModel | null = null) {
    if (typeof interactionModel?.boardSelectionInteractive === 'boolean') {
      return interactionModel.boardSelectionInteractive;
    }
    const snapshot = pendingRenderState?.snapshot || latestPathSnapshot;
    if (!snapshot) return false;
    return isBoardNavSelectionInteractive(
      snapshot,
      interactionModel?.boardSelection,
    );
  }

  function syncBoardNavHighlights(interactionModel: InteractionModel | null = null) {
    const marker = ensureBoardNavMarker();
    if (!marker || !refs?.gridEl) return;

    const target = resolveBoardNavMarkerTarget(interactionModel);
    if (!target) {
      hideBoardNavMarker();
      return;
    }

    syncBoardNavMarkerFrame();
    const offset = getGridCanvasOffset(refs, gridOffsetScratch);
    const point = getCellPoint(target.r, target.c, refs, offset, boardNavPointScratch);
    const cellSize = pathLayoutMetrics.ready
      ? pathLayoutMetrics.cell
      : getCellSize(asDomElement(refs.gridEl));
    const previewDelta = interactionModel?.boardNavPreviewDelta;
    const previewRow = readInteger(previewDelta?.r);
    const previewCol = readInteger(previewDelta?.c);
    if (previewRow !== null && previewCol !== null) {
      const previewMagnitude = Math.hypot(previewRow, previewCol) || 1;
      const previewOffset = cellSize * 0.15;
      point.x += (previewCol / previewMagnitude) * previewOffset;
      point.y += (previewRow / previewMagnitude) * previewOffset;
    }
    const markerScale = target.variant === 'selected' ? 0.94 : 1.06;
    let selectionIsInteractive = true;
    if (target.variant === 'selected') {
      selectionIsInteractive = resolveBoardSelectionInteractiveState(interactionModel);
    }
    marker.classList.add('isActive');
    marker.classList.toggle('isCursor', target.variant === 'cursor');
    marker.classList.toggle('isSelected', target.variant === 'selected');
    marker.classList.toggle('isInvalidSelection', target.variant === 'selected' && !selectionIsInteractive);
    marker.style.width = `${cellSize}px`;
    marker.style.height = `${cellSize}px`;
    marker.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) scale(${markerScale})`;
  }

  const statusKeySet = (keys: unknown): Set<string> => {
    const set = new Set<string>();
    if (!Array.isArray(keys)) return set;
    for (const element of keys) {
      const key = element;
      if (typeof key === 'string') set.add(key);
    }
    return set;
  };

  const addStatusDeltaKeys = (nextSet: Set<string>, prevSet: Set<string>, out: Set<string>): void => {
    nextSet.forEach((key: string) => {
      if (!prevSet.has(key)) out.add(key);
    });
    prevSet.forEach((key: string) => {
      if (!nextSet.has(key)) out.add(key);
    });
  };

  const buildStatusSets = (results: EvaluateResultLike = {}): StatusSets => {
    const safeResults = results || {};
    return {
      badHint: statusKeySet(safeResults.hintStatus?.badKeys),
      goodHint: statusKeySet(safeResults.hintStatus?.goodKeys),
      badRps: statusKeySet(safeResults.rpsStatus?.badKeys),
      goodRps: statusKeySet(safeResults.rpsStatus?.goodKeys),
      badBlocked: statusKeySet(safeResults.blockedStatus?.badKeys),
    };
  };

  const addPathKeys = (path: MaybePath, out: Set<string>): void => {
    if (!Array.isArray(path)) return;
    for (const element of path) {
      const point = element;
      if (!point) continue;
      out.add(keyOf(point.r, point.c));
    }
  };

  const resolveEndpointPathDelta = (
    prevPath: MaybePath,
    nextPath: MaybePath,
  ): EndpointPathDelta | null => {
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

  const appendSnapshotPathEndpointClasses = (classes: string[], snapshot: GameSnapshot, r: number, c: number): void => {
    if (snapshot.path.length === 0) return;
    const head = snapshot.path[0];
    if (head && head.r === r && head.c === c) classes.push('pathStart');
    if (snapshot.path.length <= 1) return;
    const tail = snapshot.path[snapshot.path.length - 1];
    if (tail && tail.r === r && tail.c === c) classes.push('pathEnd');
  };

  const appendSnapshotStatusClasses = (classes: string[], key: string, statusSets: StatusSets): void => {
    if (statusSets.badHint.has(key)) classes.push('badHint');
    if (statusSets.goodHint.has(key)) classes.push('goodHint');
    if (statusSets.badRps.has(key)) {
      classes.push('badRps');
    } else if (statusSets.goodRps.has(key)) {
      classes.push('goodRps');
    }
    if (statusSets.badBlocked.has(key)) classes.push('badBlocked');
  };

  const collectSnapshotCellClasses = (
    snapshot: GameSnapshot,
    r: number,
    c: number,
    key: string,
    statusSets: StatusSets,
  ): string[] => {
    const classes = ['cell'];
    const code = snapshot.gridData[r][c];
    if (code === 'm') classes.push('wall', 'movable');
    else if (code === '#') classes.push('wall');

    if (snapshot.visited.has(key)) classes.push('visited');
    appendSnapshotPathEndpointClasses(classes, snapshot, r, c);
    appendSnapshotStatusClasses(classes, key, statusSets);
    return classes;
  };

  const syncCellPathOrderValue = (cell: ElementLike, idxText: string | number | null | undefined): void => {
    const pathOrderValue = idxText ? String(Math.max(0, Number(idxText) - 1)) : '';
    const currentPathOrder = cell.style.getPropertyValue('--path-order');
    if (pathOrderValue) {
      if (currentPathOrder !== pathOrderValue) {
        cell.style.setProperty('--path-order', pathOrderValue);
      }
      return;
    }
    if (currentPathOrder) {
      cell.style.removeProperty('--path-order');
    }
  };

  const applyCellSnapshotState = (snapshot: GameSnapshot, r: number, c: number, statusSets: StatusSets) => {
    const cell = gridCells[r]?.[c];
    if (!cell) return;
    const key = keyOf(r, c);
    const targetClass = collectSnapshotCellClasses(snapshot, r, c, key, statusSets).join(' ');
    if (cell.className !== targetClass) {
      cell.className = targetClass;
    }

    const idxValue = snapshot.idxByKey.get(key);
    const idxText = snapshot.idxByKey.has(key) && typeof idxValue === 'number'
      ? String(idxValue + 1)
      : '';
    const idxEl = cell.firstElementChild;
    if (idxEl && idxEl.textContent !== idxText) {
      idxEl.textContent = idxText;
    }
    syncCellPathOrderValue(cell, idxText);
  };

  const clearPathTipDragHoverCell = () => {
    if (!lastPathTipDragHoverCell) return;
    lastPathTipDragHoverCell.classList.remove('pathTipDragHover');
    lastPathTipDragHoverCell = null;
  };

  const clearPathTipDragSelectedCell = () => {
    if (!lastPathTipDragSelectedCell) return;
    lastPathTipDragSelectedCell.classList.remove('pathTipDragSelected');
    lastPathTipDragSelectedCell = null;
  };

  const resolvePathTipDragEndpointCell = (interactionModel: InteractionModel | null = null, cells = gridCells) => {
    if (!interactionModel?.isPathDragging) return null;
    const snapshot = pendingRenderState?.snapshot || latestPathSnapshot;
    const path = Array.isArray(snapshot?.path) ? snapshot.path : [];
    if (path.length <= 0) return null;

    const side = interactionModel.pathDragSide === 'start' ? 'start' : 'end';
    const tip = side === 'start' ? path[0] : path[path.length - 1];
    const tipR = Number(tip?.r);
    const tipC = Number(tip?.c);
    if (!Number.isInteger(tipR) || !Number.isInteger(tipC)) return null;
    const cell = cells[tipR]?.[tipC];
    if (cell && !cell.classList.contains('wall')) return cell;
    return null;
  };

  const resolveBoardNavSelectedCell = (interactionModel: InteractionModel | null = null, cells = gridCells) => {
    const selection = interactionModel?.boardSelection;
    if (interactionModel?.isBoardNavActive !== true || !selection) return null;

    const selectionIsInteractive = resolveBoardSelectionInteractiveState(interactionModel);
    if (!selectionIsInteractive && interactionModel?.isBoardNavPressing !== true) {
      return null;
    }
    const selectionR = Number(selection?.r);
    const selectionC = Number(selection?.c);
    if (!Number.isInteger(selectionR) || !Number.isInteger(selectionC)) return null;
    const cell = cells[selectionR]?.[selectionC];
    if (cell && !cell.classList.contains('wall')) return cell;
    return cell || null;
  };

  const resolvePathTipDragSelectedCell = (interactionModel: InteractionModel | null = null, cells = gridCells) => {
    return resolvePathTipDragEndpointCell(interactionModel, cells)
      || resolveBoardNavSelectedCell(interactionModel, cells);
  };

  const syncPathTipDragHoverCell = (interactionModel: InteractionModel | null = null, cells = gridCells) => {
    let nextCell: ElementLike | Element | null = null;
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

  const syncPathTipDragSelectedCell = (interactionModel: InteractionModel | null = null, cells = gridCells) => {
    const nextCell = resolvePathTipDragSelectedCell(interactionModel, cells);
    if (nextCell === lastPathTipDragSelectedCell) {
      if (nextCell && !nextCell.classList.contains('pathTipDragSelected')) {
        nextCell.classList.add('pathTipDragSelected');
      }
      return;
    }
    clearPathTipDragSelectedCell();
    if (!nextCell) return;
    nextCell.classList.add('pathTipDragSelected');
    lastPathTipDragSelectedCell = nextCell;
  };

  const addPathEndpointKeys = (path: MaybePath, out: Set<string>): void => {
    if (!Array.isArray(path) || path.length <= 0) return;
    const head = path[0];
    const tail = path[path.length - 1];
    addPathKeys([head, tail], out);
  };

  const addTouchedKeysForEndpointDelta = (
    delta: EndpointPathDelta,
    prevPath: MaybePath,
    nextPath: MaybePath,
    out: Set<string>,
  ): void => {
    if (delta.side === 'start' && delta.prevChanged.length !== delta.nextChanged.length) {
      addPathKeys(prevPath, out);
      addPathKeys(nextPath, out);
      return;
    }
    addPathKeys(delta.prevChanged, out);
    addPathKeys(delta.nextChanged, out);
    addPathEndpointKeys(prevPath, out);
    addPathEndpointKeys(nextPath, out);
  };

  const applyTouchedKeysToSnapshot = (snapshot: GameSnapshot, statusSets: StatusSets, touchedKeys: Set<string>) => {
    touchedKeys.forEach((key: string) => {
      const parsed = parseGridKey(key);
      if (!parsed) return;
      const r = parsed.r;
      const c = parsed.c;
      if (r < 0 || c < 0 || r >= snapshot.rows || c >= snapshot.cols) return;
      applyCellSnapshotState(snapshot, r, c, statusSets);
    });
  };

  const collectIncrementalPathTouchedKeys = (
    prevSnapshot: GameSnapshot | null,
    snapshot: GameSnapshot,
    statusSets: StatusSets,
    prevSets: StatusSets,
  ): Set<string> | null => {
    if (!prevSnapshot) return null;
    if (snapshot.rows !== prevSnapshot.rows || snapshot.cols !== prevSnapshot.cols) return null;
    if (snapshot.gridData !== prevSnapshot.gridData) return null;

    const delta = resolveEndpointPathDelta(prevSnapshot.path, snapshot.path);
    if (!delta) return null;

    const touchedKeys = new Set<string>();
    addTouchedKeysForEndpointDelta(delta, prevSnapshot.path, snapshot.path, touchedKeys);
    addStatusDeltaKeys(statusSets.badHint, prevSets.badHint, touchedKeys);
    addStatusDeltaKeys(statusSets.goodHint, prevSets.goodHint, touchedKeys);
    addStatusDeltaKeys(statusSets.badRps, prevSets.badRps, touchedKeys);
    addStatusDeltaKeys(statusSets.goodRps, prevSets.goodRps, touchedKeys);
    addStatusDeltaKeys(statusSets.badBlocked, prevSets.badBlocked, touchedKeys);

    return touchedKeys;
  };

  const tryApplyIncrementalPathUpdate = (snapshot: GameSnapshot, results: EvaluateResult): boolean => {
    const prevSnapshot = latestPathSnapshot;
    const statusSets = buildStatusSets(results);
    const prevSets = latestPathStatusSets || buildStatusSets(latestPathStatuses || {});
    const touchedKeys = collectIncrementalPathTouchedKeys(
      prevSnapshot,
      snapshot,
      statusSets,
      prevSets,
    );
    if (!touchedKeys) return false;

    applyTouchedKeysToSnapshot(snapshot, statusSets, touchedKeys);
    countIncrementalCellPatches();
    return true;
  };

  const previewLowPowerPathDragCells = (
    previousSnapshot: GameSnapshot,
    snapshot: GameSnapshot,
    statusSets: StatusSets,
  ): boolean => {
    if (!refs || !statusSets) return false;
    const prevSets = latestPathStatusSets || buildStatusSets(latestPathStatuses || {});
    const touchedKeys = collectIncrementalPathTouchedKeys(
      previousSnapshot,
      snapshot,
      statusSets,
      prevSets,
    );
    if (!touchedKeys) return false;

    applyTouchedKeysToSnapshot(snapshot, statusSets, touchedKeys);
    return true;
  };

  const applyCellViewState = (cell: ElementLike | null, state: BoardCellViewState): void => {
    if (!cell) return;
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

    syncCellPathOrderValue(cell, state.idx);
  };

  const applyFullCellViewModel = (snapshot: GameSnapshot, desired: BoardCellViewModel): void => {
    for (let r = 0; r < snapshot.rows; r++) {
      for (let c = 0; c < snapshot.cols; c++) {
        applyCellViewState(gridCells[r][c], desired[r][c]);
      }
    }
  };

  function updateCells(
    snapshot: GameSnapshot,
    results: EvaluateResult,
    refs: RendererRefs,
    completionModel: CompletionModel | null = null,
    interactionModel: InteractionModel | null = null,
    tutorialFlags: TutorialFlags | null = null,
  ) {
    const { hintStatus, rpsStatus, blockedStatus } = results;
    const usedIncremental = tryApplyIncrementalPathUpdate(
      snapshot,
      {
        hintStatus,
        stitchStatus: results.stitchStatus || null,
        rpsStatus,
        blockedStatus,
      },
    );
    if (!usedIncremental) {
      countFullCellRebuilds();
      reusableCellViewModel = buildBoardCellViewModel(
        snapshot,
        {
          hintStatus,
          stitchStatus: results.stitchStatus || null,
          rpsStatus,
          blockedStatus,
        },
        resolveCellMarkHtml,
        reusableCellViewModel,
      );
      applyFullCellViewModel(snapshot, reusableCellViewModel);
    }
    syncPathTipDragHoverCell(interactionModel);
    pathAnimationEngine.setInteractionModel(interactionModel);
  }

  const updatePathTransitionStates = (
    previousPath: MaybePath,
    nextPath: MaybePath,
    layout: PathLayoutMetricsState,
    nowMs: number,
  ): void => {
    updatePathTipArrivalStates(
      previousPath,
      nextPath,
      layout.cell,
      layout.cell + layout.gap,
      nowMs,
    );
    updatePathRetainedArcStates(previousPath, nextPath, nowMs);
    updatePathEndArrowRotateState(previousPath, nextPath, nowMs);
    updatePathStartFlowRotateState(previousPath, nextPath, nowMs);
    updatePathStartPinPresenceState(previousPath, nextPath, nowMs);
    updatePathFlowVisibilityState(previousPath, nextPath, nowMs);
    updatePathReverseTipSwapState(previousPath, nextPath, nowMs);
  };

  const applyReversePathFlowOffset = (path: MaybePath, flow: PathFlowMetrics, nowMs: number): void => {
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
      path,
      reverseFromFlowOffset,
      latestPathMainFlowTravel,
      pathAnimationOffset,
      flow.cycle,
      nowMs,
    );
  };

  const applyHeadShiftPathFlowOffset = (
    path: MaybePath,
    previousPath: MaybePath,
    refs: RendererRefs,
    flow: PathFlowMetrics,
  ): void => {
    const consumedCompensation = consumePathTransitionCompensation(path, flow.cycle);
    if (consumedCompensation.consumed) return;
    const shift = getHeadShiftDelta(
      path,
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
  };

  const syncPathAnimationOffsetForTransition = (
    path: MaybePath,
    previousPath: MaybePath,
    refs: RendererRefs,
    flow: PathFlowMetrics,
    pathChanged: boolean,
    nowMs: number,
  ): void => {
    if (isPathReversed(path, previousPath)) {
      applyReversePathFlowOffset(path, flow, nowMs);
      return;
    }
    if (pathChanged) {
      applyHeadShiftPathFlowOffset(path, previousPath, refs, flow);
      return;
    }
    if (transitionCompensationBuffer.hasPending()) {
      clearPathTransitionCompensationBuffer();
    }
  };

  const cacheLatestPathRenderState = (
    snapshot: GameSnapshot,
    refs: RendererRefs,
    statuses: EvaluateResult,
    completionModel: CompletionModel | null,
    tutorialFlags: TutorialFlags | null,
  ): void => {
    latestPathSnapshot = snapshot;
    latestPathRefs = refs;
    latestPathStatuses = statuses;
    latestPathStatusSets = buildStatusSets(statuses || {});
    latestCompletionModel = completionModel;
    latestTutorialFlags = tutorialFlags;
  };

  function drawAllImpl(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    statuses: EvaluateResult,
    completionModel: CompletionModel | null = null,
    tutorialFlags: TutorialFlags | null = null,
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
    updatePathTransitionStates(previousPath, snapshot.path, layout, nowMs);
    syncPathAnimationOffsetForTransition(
      snapshot.path,
      previousPath,
      refs,
      flow,
      pathChanged,
      nowMs,
    );
    cacheLatestPathRenderState(snapshot, refs, statuses, completionModel, tutorialFlags);

    const animateFlowVisibility = (
      hasActivePathFlowVisibility(snapshot.path, nowMs)
      && flowFreeze.mix > PATH_FLOW_FREEZE_EPSILON
    );
    const offset = (animateFlow || animateFlowVisibility || flowFreeze.active) ? pathAnimationOffset : 0;
    drawAllInternal(snapshot, refs, statuses, offset, completionModel, tutorialFlags);
    const animationActivity = resolvePathAnimationActivity(
      snapshot.path,
      nowMs,
      flow.cycle,
      latestInteractionModel,
    );
    return (
      flowFreeze.active
      || animateFlow
      || animateFlowVisibility
      || animationActivity.active
    );
  }

  function drawStaticSymbols(snapshot: GameSnapshot, refs: RendererRefs, statuses: EvaluateResult) {
    const { symbolCtx, symbolCanvas } = refs;
    if (!symbolCtx || !symbolCanvas) return;

    countSymbolRedraws();
    clearCanvas(symbolCtx, symbolCanvas);

    drawCornerCounts(
      snapshot,
      refs,
      symbolCtx,
      (statuses?.hintStatus?.cornerVertexStatus as Map<string, unknown> | undefined) || EMPTY_MAP,
    );
    drawCrossStitches(
      snapshot,
      refs,
      symbolCtx,
      (statuses?.stitchStatus?.vertexStatus as Map<string, unknown> | undefined) || EMPTY_MAP,
    );
  }

  function drawTutorialBracketsOnSymbolCanvas(
    refs: RendererRefs,
    tutorialFlags: TutorialFlags | null = null,
    flowOffset: number = pathFramePayload.flowOffset,
  ) {
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

    for (const element of centers) {
      const center = element;
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

  const syncPathGeometryCache = (
    path: MaybePath,
    layout: PathLayoutMetricsState,
    deviceScale: number,
  ): void => {
    const safePath = Array.isArray(path) ? path : [];
    const pathLength = safePath.length;
    const head = pathLength > 0 ? safePath[0] : null;
    const tail = pathLength > 0 ? safePath[pathLength - 1] : null;
    if (pathLength > 0) {
      const pointsChanged = (
        cachedPathRef !== safePath
        || cachedPathLayoutVersion !== layout.version
        || cachedPathLength !== pathLength
        || cachedPathHeadR !== (head?.r ?? Number.NaN)
        || cachedPathHeadC !== (head?.c ?? Number.NaN)
        || cachedPathTailR !== (tail?.r ?? Number.NaN)
        || cachedPathTailC !== (tail?.c ?? Number.NaN)
      );
      if (!pointsChanged && reusablePathPoints.length === pathLength) {
        return;
      }

      if (reusablePathPoints.length < pathLength) {
        for (let i = reusablePathPoints.length; i < pathLength; i++) {
          reusablePathPoints.push({ x: 0, y: 0 });
        }
      }
      reusablePathPoints.length = pathLength;
      const step = layout.cell + layout.gap;
      const half = layout.cell * 0.5;
      for (let i = 0; i < pathLength; i++) {
        const point = safePath[i];
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

      cachedPathRef = safePath;
      cachedPathLayoutVersion = layout.version;
      cachedPathLength = pathLength;
      cachedPathHeadR = head?.r ?? Number.NaN;
      cachedPathHeadC = head?.c ?? Number.NaN;
      cachedPathTailR = tail?.r ?? Number.NaN;
      cachedPathTailC = tail?.c ?? Number.NaN;
      pathGeometryToken += 1;
      return;
    }

    reusablePathPoints.length = 0;
    const emptyGeometryChanged = (
      cachedPathLength !== 0
      || cachedPathLayoutVersion !== layout.version
      || cachedPathRef !== safePath
    );
    if (!emptyGeometryChanged) return;
    cachedPathRef = safePath;
    cachedPathLayoutVersion = layout.version;
    cachedPathLength = 0;
    cachedPathHeadR = Number.NaN;
    cachedPathHeadC = Number.NaN;
    cachedPathTailR = Number.NaN;
    cachedPathTailC = Number.NaN;
    pathGeometryToken += 1;
  };

  const setPathFrameBaseState = (
    renderPoints: PathRenderPointsResult,
    sizing: PathSizing,
    path: MaybePath,
    nowMs: number,
  ): boolean => {
    pathFramePayload.baseStartRadius = sizing.startRadius;
    pathFramePayload.baseArrowLength = sizing.arrowLength;
    pathFramePayload.baseEndHalfWidth = sizing.endHalfWidth;
    const reverseTipSwapActive = applyPathReverseTipSwapToPayload(path, nowMs);
    pathFramePayload.points = renderPoints.points;
    pathFramePayload.retainedStartArcPoints = renderPoints.retainedStartArcPoints;
    pathFramePayload.retainedStartArcGeometryToken = renderPoints.retainedStartArcGeometryToken;
    pathFramePayload.retainedEndArcPoints = renderPoints.retainedEndArcPoints;
    pathFramePayload.retainedEndArcGeometryToken = renderPoints.retainedEndArcGeometryToken;
    pathFramePayload.retainedStartArcWidth = sizing.width;
    pathFramePayload.retainedEndArcWidth = sizing.width;
    pathFramePayload.width = sizing.width;
    if (!reverseTipSwapActive) {
      pathFramePayload.startRadius = sizing.startRadius;
      pathFramePayload.arrowLength = sizing.arrowLength;
      pathFramePayload.endHalfWidth = sizing.endHalfWidth;
    }
    return reverseTipSwapActive;
  };

  const applyPathFrameTipAnimationState = (
    path: MaybePath,
    nowMs: number,
    renderPoints: PathRenderPointsResult,
    sizing: PathSizing,
    reverseTipSwapActive: boolean,
  ): void => {
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
    const startTipWidthScale = sizing.startRadius > 0
      ? clampUnit((Number(pathFramePayload.startRadius) || 0) / sizing.startRadius)
      : 1;
    const endTipWidthScale = sizing.endHalfWidth > 0
      ? clampUnit((Number(pathFramePayload.endHalfWidth) || 0) / sizing.endHalfWidth)
      : 1;
    pathFramePayload.retainedStartArcWidth = Math.max(0.5, sizing.width * startTipWidthScale);
    pathFramePayload.retainedEndArcWidth = Math.max(0.5, sizing.width * endTipWidthScale);
    pathFramePayload.geometryToken = (
      reverseTipSwapActive
      || startPinPresenceActive
      || endArrowRotateActive
      || startFlowRotateActive
      || tipHoverScale.active
    ) ? Number.NaN : renderPoints.geometryToken;
  };

  const hasRenderablePathFlowPoints = () => (
    (Array.isArray(pathFramePayload.points) && pathFramePayload.points.length > 1)
    || (Array.isArray(pathFramePayload.retainedStartArcPoints) && pathFramePayload.retainedStartArcPoints.length > 1)
    || (Array.isArray(pathFramePayload.retainedEndArcPoints) && pathFramePayload.retainedEndArcPoints.length > 1)
  );

  const syncPathFrameFlowState = (
    path: MaybePath,
    renderPoints: PathRenderPointsResult,
    flowOffset: number,
    flowMetrics: PathFlowMetrics,
    flowFreezeMix: number,
    nowMs: number,
  ): void => {
    const flowVisibility = resolvePathFlowVisibilityMix(path, nowMs, flowVisibilityMixScratch);
    const flowMix = clampUnit(Number.isFinite(flowVisibility.mix) ? flowVisibility.mix : 1);
    const effectiveFlowMix = flowMix * flowFreezeMix;
    pathFramePayload.flowEnabled = (
      !isReducedMotionPreferred()
      && hasRenderablePathFlowPoints()
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
      return;
    }
    pathFramePayload.reverseColorBlend = 1;
    pathFramePayload.reverseFromFlowOffset = 0;
    pathFramePayload.reverseTravelSpan = 0;
  };

  function drawAnimatedPathImpl(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    statuses: EvaluateResult,
    flowOffset: number = 0,
    completionModel: CompletionModel | null = null,
    tutorialFlags: TutorialFlags | null = null,
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
    const sizing = {
      width: Math.max(7, snapCssToDevicePixel(Math.floor(size * 0.15), deviceScale)),
      arrowLength: Math.max(13, snapCssToDevicePixel(Math.floor(size * 0.24), deviceScale)),
      startRadius: 0,
      endHalfWidth: 0,
    };
    sizing.startRadius = Math.max(6, snapCssToDevicePixel(Math.floor(sizing.width * 0.9), deviceScale));
    sizing.endHalfWidth = Math.max(6, snapCssToDevicePixel(Math.floor(sizing.width * 0.95), deviceScale));

    if (!pathThemeCacheInitialized) updatePathThemeCache(refs);
    const completionProgress = getCompletionProgress(completionModel);
    const isCompletionSolved = Boolean(completionModel?.isSolved);
    const flowMetrics = getCachedPathFlowMetrics(refs, size);

    const path = snapshot.path;
    syncPathGeometryCache(path, layout, deviceScale);
    updateTutorialBracketPayload(snapshot, layout, tutorialFlags);

    const nowMs = getNowMs();
    syncPathFlowFreezeTarget(isPathFlowFrozen(), nowMs);
    const flowFreeze = resolvePathFlowFreezeMix(nowMs, pathFlowFreezeMixScratch);
    const flowFreezeMix = clampUnit(flowFreeze.mix);
    const frozenMix = 1 - flowFreezeMix;
    const renderPoints = getPathRenderPointsForFrame(
      path,
      nowMs,
      sizing.width,
      sizing.startRadius,
      sizing.endHalfWidth,
    );
    const reverseTipSwapActive = setPathFrameBaseState(renderPoints, sizing, path, nowMs);
    applyPathFrameTipAnimationState(path, nowMs, renderPoints, sizing, reverseTipSwapActive);
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
    syncPathFrameFlowState(path, renderPoints, flowOffset, flowMetrics, flowFreezeMix, nowMs);
    pathFramePayload.flowRise = PATH_FLOW_RISE;
    pathFramePayload.flowDrop = PATH_FLOW_DROP;
    pathFramePayload.drawTutorialBracketsInPathLayer = false;
    countPathDraws();
    latestPathMainFlowTravel = pathRenderer.drawPathFrame(pathFramePayload);
    commitPendingPathCanvasSwap();
  }

  const pathAnimationEngine = createPathAnimationEngine({
    nowFn: getNowMs,
    isReducedMotionPreferred: () => isReducedMotionPreferred(),
    onSetInteractionModel: (interactionModel: InteractionModel | null | undefined) => {
      latestInteractionModel = interactionModel || null;
    },
    onUpdatePathLayoutMetrics: (offset, cell: number, gap: number, pad: number) =>
      updatePathLayoutMetrics(offset, cell, gap, pad),
    onNotifyInteractiveResize: () => {
      interactiveResizeActive = true;
    },
  });

  function drawAnimatedPath(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    statuses: EvaluateResult,
    flowOffset: number = 0,
    completionModel: CompletionModel | null = null,
    tutorialFlags: TutorialFlags | null = null,
  ) {
    return pathAnimationEngine.drawAnimatedPath(
      snapshot,
      refs,
      statuses,
      flowOffset,
      completionModel,
      tutorialFlags,
      {
        drawAnimatedPathInternal: (...args: unknown[]) => drawAnimatedPathImpl(
          args[0] as GameSnapshot,
          args[1] as RendererRefs,
          args[2] as EvaluateResult,
          args[3] as number,
          (args[4] as CompletionModel | null | undefined) || null,
          (args[5] as TutorialFlags | null | undefined) || null,
        ),
      },
    );
  }

  function drawAllInternal(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    statuses: EvaluateResult,
    flowOffset: number = 0,
    completionModel: CompletionModel | null = null,
    tutorialFlags: TutorialFlags | null = null,
  ) {
    drawStaticSymbols(snapshot, refs, statuses);
    drawAnimatedPath(snapshot, refs, statuses, flowOffset, completionModel, tutorialFlags);
    drawTutorialBracketsOnSymbolCanvas(refs, tutorialFlags, flowOffset);
  }

  function drawCrossStitches(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    ctx: CanvasRenderingContext2D,
    vertexStatus: Map<string, unknown> = EMPTY_MAP,
  ) {
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

    const resolveDiagStatus = (entry: unknown, key: 'diagA' | 'diagB'): string => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && key in entry) {
        const value = (entry as Record<string, unknown>)[key];
        return typeof value === 'string' ? value : 'pending';
      }
      return 'pending';
    };

    const buildUnsnappedLine = (x1: number, y1: number, x2: number, y2: number) => ({
      x1,
      y1,
      x2,
      y2,
    });

    const drawLine = (line: LineSegment, color: string, width: number) => {
      const snappedWidth = snapCanvasLength(width, canvasScale.min);
      ctx.strokeStyle = color;
      ctx.lineWidth = snappedWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.stroke();
    };

    const buildStitchLines = (centerX: number, centerY: number) => ({
      diagALine: buildUnsnappedLine(
        centerX - stitchLineHalf,
        centerY - stitchLineHalf,
        centerX + stitchLineHalf,
        centerY + stitchLineHalf,
      ),
      diagBLine: buildUnsnappedLine(
        centerX + stitchLineHalf,
        centerY - stitchLineHalf,
        centerX - stitchLineHalf,
        centerY + stitchLineHalf,
      ),
    });

    for (const [vr, vc] of snapshot.stitches) {
      const point = getVertexPoint(vr, vc, refs, offset, headPointScratchA, canvasScale.x);
      const { diagALine, diagBLine } = buildStitchLines(point.x, point.y);
      drawLine(diagALine, shadowOpaque, stitchWidth * 2);
      drawLine(diagBLine, shadowOpaque, stitchWidth * 2);
    }

    const drawStatePass = (state: string, color: string) => {
      for (const [vr, vc] of snapshot.stitches) {
        const vk = keyOf(vr, vc);
        const entry = vertexStatus.get(vk) || 'pending';
        const diagAState = resolveDiagStatus(entry, 'diagA');
        const diagBState = resolveDiagStatus(entry, 'diagB');
        const point = getVertexPoint(vr, vc, refs, offset, headPointScratchB, canvasScale.x);
        const { diagALine, diagBLine } = buildStitchLines(point.x, point.y);
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

  function drawCornerCounts(
    snapshot: GameSnapshot,
    refs: RendererRefs,
    ctx: CanvasRenderingContext2D,
    cornerVertexStatus: Map<string, unknown> = EMPTY_MAP,
  ) {
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

  function resizeCanvas(refs: RendererRefs) {
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

    const boardWrapEl = asDomElement(boardWrap) ?? (boardWrap as unknown as Element);
    const styles = getComputedStyle(boardWrapEl);
    const borderLeft = Number.parseFloat(styles.borderLeftWidth || '0') || 0;
    const borderRight = Number.parseFloat(styles.borderRightWidth || '0') || 0;
    const borderTop = Number.parseFloat(styles.borderTopWidth || '0') || 0;
    const borderBottom = Number.parseFloat(styles.borderBottomWidth || '0') || 0;
    const cw = Math.max(0, (wrapRect.width || 0) - borderLeft - borderRight);
    const ch = Math.max(0, (wrapRect.height || 0) - borderTop - borderBottom);
    const innerLeft = wrapRect.left + (boardWrap.clientLeft || 0);
    const innerTop = wrapRect.top + (boardWrap.clientTop || 0);
    const offset = {
      x: gridRect.left - innerLeft,
      y: gridRect.top - innerTop,
    };
    const gridEl = asDomElement(refs.gridEl) ?? (refs.gridEl as unknown as Element);
    const gridStyles = getComputedStyle(gridEl);
    const gap = parsePx(gridStyles.columnGap || gridStyles.gap || '0');
    const pad = parsePx(gridStyles.paddingLeft || gridStyles.padding || '0');
    const cellFromStyle = parsePx(
      boardWrap.style.getPropertyValue('--cell')
      || refs.gridEl.style.getPropertyValue('--cell')
      || styles.getPropertyValue('--cell'),
    );
    const cell = cellFromStyle > 0 ? cellFromStyle : getCellSize(gridEl);
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

  const setPathFlowFreezeImmediate = (isFrozen: boolean = false) => {
    pathAnimationEngine.setPathFlowFreezeImmediate(isFrozen);
  };

  const applyImmediateInteractionState = (interactionModel: InteractionModel | null = null): void => {
    if (!refs) return;
    const dropTarget = interactionModel?.dropTarget;
    const dropRow = readInteger(dropTarget?.r);
    const dropCol = readInteger(dropTarget?.c);
    if (dropRow !== null && dropCol !== null) {
      setDropTarget(dropRow, dropCol);
    } else {
      clearDropTarget();
    }

    const ghost = interactionModel?.wallGhost;
    if (ghost?.visible) {
      showWallDragGhost(ghost.x || 0, ghost.y || 0);
      moveWallDragGhost(ghost.x || 0, ghost.y || 0);
    } else {
      hideWallDragGhost();
    }
  };

  const applyInteractionState = (interactionModel: InteractionModel | null = null): void => {
    if (!refs) return;
    applyImmediateInteractionState(interactionModel);
    syncPathTipDragHoverCell(interactionModel);
    syncPathTipDragSelectedCell(interactionModel);
    syncBoardNavHighlights(interactionModel);
  };

  const resetCoreState = () => {
    clearDropTarget();
    clearPathTipDragHoverCell();
    clearPathTipDragSelectedCell();
    removeBoardNavMarker();
    gridCells = [];
    lastDropTargetKey = null;
    lastPathTipDragHoverCell = null;
    lastPathTipDragSelectedCell = null;
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
    lastFlowMetricCell = Number.NaN;
    pathThemeCacheInitialized = false;
    pathThemeLineRaw = '';
    pathThemeGoodRaw = '';
    pathThemeMainRgb = { r: 255, g: 255, b: 255 };
    pathThemeCompleteRgb = { r: 34, g: 197, b: 94 };
    pathGeometryToken = 0;
    cachedPathRef = null;
    cachedPathLength = -1;
    cachedPathHeadR = Number.NaN;
    cachedPathHeadC = Number.NaN;
    cachedPathTailR = Number.NaN;
    cachedPathTailC = Number.NaN;
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
    pendingPathCanvasSwap = null;
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
      ensureBoardNavMarker();
      setLegendIcons(icons, refs, iconX);
    },

    getRefs() {
      return refs;
    },

    getLayoutMetrics() {
      return boardLayoutMetrics.ready ? boardLayoutMetrics : null;
    },

    rebuildGrid(snapshot: GameSnapshot) {
      if (!refs) return;
      buildGrid(snapshot, refs, icons, iconX);
      syncBoardNavHighlights(latestInteractionModel || {});
    },

    renderFrame({
      snapshot,
      evaluation,
      completion = null,
      uiModel = {},
      interactionModel = {},
    }: {
      snapshot: GameSnapshot;
      evaluation: EvaluateResult;
      completion?: CompletionModel | null;
      uiModel?: UiRenderModel;
      interactionModel?: InteractionModel;
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
      if (Object.hasOwn(uiModel, 'messageHtml')) {
        pendingRenderDirty.message = true;
      }
      scheduleRendererFrame();
    },

    updateInteraction(interactionModel: InteractionModel | null = {}) {
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
      syncBoardNavHighlights(latestInteractionModel || {});
      if (!interactiveResizeActive && stageLatestFrameForRender()) {
        const presentationTimestamp = getNowMs();
        lastPresentedFrameTimestamp = presentationTimestamp;
        const shouldContinue = flushPendingRenderFrame(presentationTimestamp);
        if (pendingRenderState || pendingRenderDirty.interaction || shouldContinue) {
          scheduleRendererFrame();
        }
      }
    },

    setLowPowerMode(enabled: boolean = false) {
      const nextEnabled = Boolean(enabled);
      if (nextEnabled === lowPowerModeEnabled) return;
      lowPowerModeEnabled = nextEnabled;
      syncBoardNavMarkerLowPowerMode();
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
        if (stageLatestFrameForRender()) {
          const presentationTimestamp = getNowMs();
          lastPresentedFrameTimestamp = presentationTimestamp;
          const shouldContinue = flushPendingRenderFrame(presentationTimestamp);
          if (pendingRenderState || pendingRenderDirty.interaction || shouldContinue) {
            scheduleRendererFrame();
          }
          return;
        }
        scheduleRendererFrame();
      }
    },

    notifyResizeInteraction() {
      notifyInteractiveResize();
    },

    setPathFlowFreezeImmediate(isFrozen: boolean = false) {
      setPathFlowFreezeImmediate(isFrozen);
    },

    recordPathTransition(previousSnapshot: GameSnapshot, nextSnapshot: GameSnapshot, interactionModel: InteractionModel | null = null) {
      if (!refs) return;
      recordPathTransitionCompensation(previousSnapshot, nextSnapshot, refs);
      if (!lowPowerModeEnabled || !interactionModel?.isPathDragging) return;
      const previewStatusSets = latestPathStatusSets || buildStatusSets(latestPathStatuses || {});
      previewLowPowerPathDragCells(previousSnapshot, nextSnapshot, previewStatusSets);
    },

    clearPathTransitionCompensation() {
      clearPathTransitionCompensationBuffer();
    },

    destroy(options: RuntimeData & { releaseWebglContext?: boolean } = {}) {
      clearDropTarget();
      hideWallDragGhost();
      syncPathTipDragHoverCell({ isPathDragging: false, pathDragCursor: null }, []);
      clearInteractiveResizeTimer();
      clearLowPowerFrameDelayTimer();
      stopPathAnimation();
      refs?.pathRenderer?.destroy?.({
        releaseContext: options.releaseWebglContext !== false,
      });
      pathAnimationEngine.resetForCacheElements(null);
      refs = null;
      resetCoreState();
    },
  };
}
