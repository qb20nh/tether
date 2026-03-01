import { ELEMENT_IDS } from './config.js';
import { keyOf } from './utils.js';
import { cellCenter, getCellSize, vertexPos } from './geometry.js';
import { ICONS } from './icons.js';
import { buildBoardCellViewModel } from './renderer/board_view_model.js';
import { createPathWebglRenderer } from './renderer/path_webgl_renderer.js';
import {
  pointsMatch,
  cellDistance,
  clampUnit,
  normalizeAngle,
  angleDeltaSigned,
  clampNumber,
} from './math.js';

let gridCells = [];
let lastDropTargetKey = null;
let wallGhostEl = null;
let cachedBoardWrap = null;
let activeBoardSize = { rows: 0, cols: 0 };
let pathAnimationOffset = 0;
let pathAnimationFrame = 0;
let pathAnimationLastTs = 0;
let latestPathSnapshot = null;
let latestPathRefs = null;
let latestPathStatuses = null;
let latestCompletionModel = null;
let latestPathMainFlowTravel = 0;
let colorParserCtx = null;
let reusablePathPoints = [];
let reusableCellViewModel = null;
let resizeCanvasSignature = '';
let lastFlowMetricCell = NaN;
let pathThemeCacheInitialized = false;
let pathThemeLineRaw = '';
let pathThemeGoodRaw = '';
let pathThemeMainRgb = { r: 255, g: 255, b: 255 };
let pathThemeCompleteRgb = { r: 34, g: 197, b: 94 };
let pathGeometryToken = 0;
let cachedPathRef = null;
let cachedPathLength = -1;
let cachedPathHeadR = NaN;
let cachedPathHeadC = NaN;
let cachedPathTailR = NaN;
let cachedPathTailC = NaN;
let cachedPathLayoutVersion = -1;
let reducedMotionQuery = null;
const pathFlowMetricsCache = { cycle: 128, pulse: 64, speed: -32 };
const gridOffsetScratch = { x: 0, y: 0 };
const headOffsetScratch = { x: 0, y: 0 };
const headPointScratchA = { x: 0, y: 0 };
const headPointScratchB = { x: 0, y: 0 };
const headPointScratchC = { x: 0, y: 0 };
const keyParseScratch = { r: 0, c: 0 };
const EMPTY_MAP = new Map();
const pathLayoutMetrics = {
  ready: false,
  version: 0,
  offsetX: 0,
  offsetY: 0,
  cell: 56,
  gap: 0,
  pad: 0,
};
const pathFramePayload = {
  points: [],
  geometryToken: 0,
  width: 0,
  startRadius: 0,
  arrowLength: 0,
  endHalfWidth: 0,
  mainColorRgb: null,
  completeColorRgb: null,
  isCompletionSolved: false,
  completionProgress: 0,
  flowEnabled: false,
  flowOffset: 0,
  flowCycle: 128,
  flowPulse: 64,
  flowSpeed: -32,
  flowRise: 0.82,
  flowDrop: 0.83,
};

const PATH_FLOW_SPEED = -32;
const PATH_FLOW_CYCLE = 128;
const PATH_FLOW_PULSE = 64;
const PATH_FLOW_BASE_CELL = 56;
const PATH_FLOW_RISE = 0.82;
const PATH_FLOW_DROP = 0.83;
const TAU = Math.PI * 2;
const CANVAS_ALIGN_OFFSET_CSS_PX = 0.5;



const isPathReversed = (nextPath, previousPath) => {
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return false;
  if (nextPath.length !== previousPath.length || nextPath.length < 2) return false;

  for (let i = 0; i < nextPath.length; i++) {
    if (!pointsMatch(nextPath[i], previousPath[previousPath.length - 1 - i])) return false;
  }
  return true;
};

const normalizeFlowOffset = (value, cycle = PATH_FLOW_CYCLE) => {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(cycle) || cycle <= 0) return 0;
  const mod = value % cycle;
  return mod >= 0 ? mod : mod + cycle;
};



const getNowMs = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
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



const getHeadLeadTravel = (path, refs = {}, offset = { x: 0, y: 0 }) => {
  const { gridEl } = refs;
  if (!path || path.length < 2) return 0;

  const first = getCellPoint(path[0].r, path[0].c, { gridEl }, offset, headPointScratchA);
  const second = getCellPoint(path[1].r, path[1].c, { gridEl }, offset, headPointScratchB);
  const firstSegmentLength = Math.hypot(second.x - first.x, second.y - first.y);
  if (!(firstSegmentLength > 0)) return 0;

  if (path.length < 3) return firstSegmentLength;

  const third = getCellPoint(path[2].r, path[2].c, { gridEl }, offset, headPointScratchC);
  const inDx = second.x - first.x;
  const inDy = second.y - first.y;
  const outDx = third.x - second.x;
  const outDy = third.y - second.y;
  const inLen = Math.hypot(inDx, inDy);
  const outLen = Math.hypot(outDx, outDy);
  if (inLen <= 0 || outLen <= 0) return firstSegmentLength;

  const inAngle = Math.atan2(inDy, inDx);
  const outAngle = Math.atan2(outDy, outDx);
  const headingTurn = angleDeltaSigned(inAngle, outAngle);
  const absTurn = Math.abs(headingTurn);
  const angleTolerance = 1e-4;
  if (absTurn <= angleTolerance || absTurn >= Math.PI - angleTolerance) return firstSegmentLength;

  const flowWidth = Math.max(7, Math.floor(getCellSize(gridEl) * 0.15));
  const cornerRadius = Math.max(1.2, flowWidth * 0.5);
  const tangentOffset = cornerRadius * Math.tan(absTurn * 0.5);
  if (!(tangentOffset > 0) || !Number.isFinite(tangentOffset)) return firstSegmentLength;
  const leadLinear = Math.max(0, firstSegmentLength - tangentOffset);
  const cornerArcLength = cornerRadius * absTurn;
  return leadLinear + cornerArcLength - tangentOffset;
};

const getHeadShiftDelta = (nextPath, previousPath, refs = {}, offset = { x: 0, y: 0 }) => {
  const { gridEl } = refs;
  if (!nextPath || !previousPath) return 0;
  const nextLen = nextPath.length;
  const prevLen = previousPath.length;
  const fallbackStep = (path) =>
    Math.max(1, cellDistance(path?.[0], path?.[1]) * getCellSize(gridEl));

  if (nextLen === prevLen + 1 && nextLen >= 2) {
    let shared = true;
    for (let i = 0; i < prevLen; i++) {
      if (!pointsMatch(nextPath[i + 1], previousPath[i])) {
        shared = false;
        break;
      }
    }
    if (shared) {
      const shifted = getHeadLeadTravel(nextPath, refs, offset);
      return -(shifted > 0 ? shifted : fallbackStep(nextPath));
    }
  }

  if (nextLen === prevLen - 1 && prevLen >= 2) {
    let shared = true;
    for (let i = 0; i < nextLen; i++) {
      if (!pointsMatch(previousPath[i + 1], nextPath[i])) {
        shared = false;
        break;
      }
    }
    if (shared) {
      const shifted = getHeadLeadTravel(previousPath, refs, offset);
      return shifted > 0 ? shifted : fallbackStep(previousPath);
    }
  }

  return 0;
};

const shouldAnimatePathFlow = (snapshot, completionModel = latestCompletionModel) => {
  if (!snapshot || snapshot.path.length <= 1) return false;
  return !isReducedMotionPreferred();
};

const stopPathAnimation = () => {
  if (!pathAnimationFrame) return;
  cancelAnimationFrame(pathAnimationFrame);
  pathAnimationFrame = 0;
  pathAnimationLastTs = 0;
};

const animatePathFlow = (timestamp) => {
  pathAnimationFrame = 0;

  if (!latestPathSnapshot || !latestPathRefs) {
    stopPathAnimation();
    return;
  }

  if (!shouldAnimatePathFlow(latestPathSnapshot, latestCompletionModel)) {
    stopPathAnimation();
    drawAllInternal(latestPathSnapshot, latestPathRefs, latestPathStatuses, 0, latestCompletionModel);
    return;
  }

  if (pathAnimationLastTs > 0) {
    const dt = Math.max(0, (timestamp - pathAnimationLastTs) / 1000);
    if (Number.isFinite(dt)) {
      const flowSpeed = Number.isFinite(pathFramePayload.flowSpeed)
        ? pathFramePayload.flowSpeed
        : PATH_FLOW_SPEED;
      const flowCycle = Number.isFinite(pathFramePayload.flowCycle) && pathFramePayload.flowCycle > 0
        ? pathFramePayload.flowCycle
        : PATH_FLOW_CYCLE;
      pathAnimationOffset = normalizeFlowOffset(
        pathAnimationOffset + dt * flowSpeed,
        flowCycle,
      );
    }
  }

  pathAnimationLastTs = timestamp;
  if (latestPathSnapshot && latestPathRefs) drawIdleAnimatedPath(pathAnimationOffset, latestCompletionModel);

  pathAnimationFrame = requestAnimationFrame(animatePathFlow);
};

const schedulePathAnimation = () => {
  if (pathAnimationFrame) return;
  pathAnimationLastTs = 0;
  pathAnimationFrame = requestAnimationFrame(animatePathFlow);
};



const parsePx = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const configureHiDPICanvas = (canvas, ctx, cssWidth, cssHeight) => {
  const safeCssWidth = Math.max(1, cssWidth);
  const safeCssHeight = Math.max(1, cssHeight);
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(safeCssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(safeCssHeight * dpr));
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

const updatePathThemeCache = (refs = latestPathRefs) => {
  const styleTarget = refs?.boardWrap || document.documentElement;
  if (!styleTarget || typeof getComputedStyle !== 'function') return;
  const styles = getComputedStyle(styleTarget);
  const nextLineRaw = forceOpaqueColor(styles.getPropertyValue('--line').trim());
  const nextGoodRaw = forceOpaqueColor(
    styles.getPropertyValue('--good').trim() || '#22c55e',
  );

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
  pathThemeCacheInitialized = true;
};

const getCachedPathFlowMetrics = (refs = latestPathRefs, cellSize = null) => {
  const resolvedCell = Number.isFinite(cellSize) && cellSize > 0
    ? cellSize
    : getCellSize(refs?.gridEl);
  if (resolvedCell !== lastFlowMetricCell) {
    getPathFlowMetrics(refs, pathFlowMetricsCache, resolvedCell);
    lastFlowMetricCell = resolvedCell;
  }
  return pathFlowMetricsCache;
};

const isReducedMotionPreferred = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (!reducedMotionQuery) {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return Boolean(reducedMotionQuery.matches);
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

const ensurePathLayoutMetrics = (refs) => {
  if (pathLayoutMetrics.ready) return pathLayoutMetrics;
  const offset = getGridCanvasOffset(refs, gridOffsetScratch);
  const cell = getCellSize(refs?.gridEl);
  const gridStyles = refs?.gridEl ? getComputedStyle(refs.gridEl) : null;
  const gap = parsePx(gridStyles?.columnGap || gridStyles?.gap || '0');
  const pad = parsePx(gridStyles?.paddingLeft || gridStyles?.padding || '0');
  return updatePathLayoutMetrics(offset, cell, gap, pad);
};

const drawIdleAnimatedPath = (flowOffset = 0, completionModel = latestCompletionModel) => {
  const pathRenderer = latestPathRefs?.pathRenderer;
  if (!pathRenderer) return;
  if (!latestPathSnapshot || latestPathSnapshot.path.length === 0) {
    latestPathMainFlowTravel = 0;
    pathRenderer.clear();
    return;
  }

  pathFramePayload.flowOffset = flowOffset;
  pathFramePayload.isCompletionSolved = Boolean(completionModel?.isSolved);
  pathFramePayload.completionProgress = getCompletionProgress(completionModel);
  latestPathMainFlowTravel = pathRenderer.drawPathFrame(pathFramePayload);
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

export function cacheElements() {
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
    result.pathRenderer = createPathWebglRenderer(result.canvas);
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
  pathLayoutMetrics.ready = false;
  pathLayoutMetrics.version = 0;
  reducedMotionQuery = null;
  pathFramePayload.points = [];
  pathFramePayload.geometryToken = 0;
  pathFramePayload.width = 0;
  pathFramePayload.startRadius = 0;
  pathFramePayload.arrowLength = 0;
  pathFramePayload.endHalfWidth = 0;
  pathFramePayload.mainColorRgb = null;
  pathFramePayload.completeColorRgb = null;
  pathFramePayload.isCompletionSolved = false;
  pathFramePayload.completionProgress = 0;
  pathFramePayload.flowEnabled = false;
  pathFramePayload.flowOffset = 0;
  pathFramePayload.flowCycle = PATH_FLOW_CYCLE;
  pathFramePayload.flowPulse = PATH_FLOW_PULSE;
  pathFramePayload.flowSpeed = PATH_FLOW_SPEED;
  pathFramePayload.flowRise = PATH_FLOW_RISE;
  pathFramePayload.flowDrop = PATH_FLOW_DROP;

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
  const p = cellCenter(r, c, refs.gridEl);
  const target = out || { x: 0, y: 0 };
  target.x = p.x + offset.x;
  target.y = p.y + offset.y;
  return target;
};

const getVertexPoint = (r, c, refs, offset = { x: 0, y: 0 }, out = null) => {
  const p = vertexPos(r, c, refs.gridEl);
  const target = out || { x: 0, y: 0 };
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

export const showWallDragGhost = (x, y) => {
  const ghost = ensureWallGhostEl();
  if (!ghost || !cachedBoardWrap) return;
  ghost.style.display = 'grid';
  moveWallDragGhost(x, y);
};

export const moveWallDragGhost = (x, y) => {
  if (!wallGhostEl || !cachedBoardWrap) return;
  const rect = cachedBoardWrap.getBoundingClientRect();
  const innerLeft = rect.left + cachedBoardWrap.clientLeft;
  const innerTop = rect.top + cachedBoardWrap.clientTop;
  wallGhostEl.style.left = `${x - innerLeft}px`;
  wallGhostEl.style.top = `${y - innerTop}px`;
};

export const hideWallDragGhost = () => {
  if (!wallGhostEl) return;
  wallGhostEl.remove();
  wallGhostEl = null;
};

export function setMessage(msgEl, kind, html) {
  msgEl.classList.remove('good', 'bad');
  if (kind) msgEl.classList.add(kind);
  msgEl.innerHTML = html;
}

export function setLegendIcons(icons, refs, iconX) {
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

export function buildGrid(snapshot, refs, icons, iconX) {
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

export function clearDropTarget() {
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

export function setDropTarget(r, c) {
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

const hasSamePrefixPath = (nextPath, prevPath, length) => {
  for (let i = 0; i < length; i++) {
    const next = nextPath[i];
    const prev = prevPath[i];
    if (!next || !prev || next.r !== prev.r || next.c !== prev.c) return false;
  }
  return true;
};

const resolveTailPathDelta = (prevPath, nextPath) => {
  if (!Array.isArray(prevPath) || !Array.isArray(nextPath)) return null;
  const prevLen = prevPath.length;
  const nextLen = nextPath.length;
  if (nextLen === prevLen + 1) {
    if (!hasSamePrefixPath(nextPath, prevPath, prevLen)) return null;
    return {
      prevTail: prevLen > 0 ? prevPath[prevLen - 1] : null,
      nextTail: nextPath[nextLen - 1] || null,
    };
  }
  if (nextLen === prevLen - 1) {
    if (!hasSamePrefixPath(nextPath, prevPath, nextLen)) return null;
    return {
      prevTail: prevLen > 0 ? prevPath[prevLen - 1] : null,
      nextTail: nextLen > 0 ? nextPath[nextLen - 1] : null,
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

  const markEl = idxEl?.nextElementSibling;
  const markHtml = resolveCellMarkHtml(code);
  if (markEl && markEl.innerHTML !== markHtml) {
    markEl.innerHTML = markHtml;
  }

  const diagOrderValue = String(r + c);
  if (cell.style.getPropertyValue('--diag-order') !== diagOrderValue) {
    cell.style.setProperty('--diag-order', diagOrderValue);
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

const tryApplyIncrementalEndDragUpdate = (snapshot, results, interactionModel = null) => {
  if (!interactionModel?.isPathDragging || interactionModel.pathDragSide !== 'end') return false;
  const prevSnapshot = latestPathSnapshot;
  if (!prevSnapshot) return false;
  if (snapshot.rows !== prevSnapshot.rows || snapshot.cols !== prevSnapshot.cols) return false;
  if (snapshot.gridData !== prevSnapshot.gridData) return false;

  const delta = resolveTailPathDelta(prevSnapshot.path, snapshot.path);
  if (!delta) return false;

  const hintStatus = results.hintStatus || {};
  const rpsStatus = results.rpsStatus || {};
  const blockedStatus = results.blockedStatus || {};
  const prevHintStatus = latestPathStatuses?.hintStatus || {};
  const prevRpsStatus = latestPathStatuses?.rpsStatus || {};
  const prevBlockedStatus = latestPathStatuses?.blockedStatus || {};
  const statusSets = {
    badHint: statusKeySet(hintStatus.badKeys),
    goodHint: statusKeySet(hintStatus.goodKeys),
    badRps: statusKeySet(rpsStatus.badKeys),
    goodRps: statusKeySet(rpsStatus.goodKeys),
    badBlocked: statusKeySet(blockedStatus.badKeys),
  };
  const prevSets = {
    badHint: statusKeySet(prevHintStatus.badKeys),
    goodHint: statusKeySet(prevHintStatus.goodKeys),
    badRps: statusKeySet(prevRpsStatus.badKeys),
    goodRps: statusKeySet(prevRpsStatus.goodKeys),
    badBlocked: statusKeySet(prevBlockedStatus.badKeys),
  };

  const touchedKeys = new Set();
  if (delta.prevTail) touchedKeys.add(keyOf(delta.prevTail.r, delta.prevTail.c));
  if (delta.nextTail) touchedKeys.add(keyOf(delta.nextTail.r, delta.nextTail.c));
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

  return true;
};

export function updateCells(
  snapshot,
  results,
  refs,
  completionModel = null,
  interactionModel = null,
) {
  const { hintStatus, stitchStatus, rpsStatus, blockedStatus } = results;
  const usedIncremental = tryApplyIncrementalEndDragUpdate(
    snapshot,
    { hintStatus, rpsStatus, blockedStatus },
    interactionModel,
  );
  if (!usedIncremental) {
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

        const diagOrderValue = String(r + c);
        const currentDiagOrder = cell.style.getPropertyValue('--diag-order');
        if (currentDiagOrder !== diagOrderValue) {
          cell.style.setProperty('--diag-order', diagOrderValue);
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

  drawAll(snapshot, refs, { hintStatus, stitchStatus, rpsStatus, blockedStatus }, completionModel);
}

export function drawAll(snapshot, refs, statuses, completionModel = null) {
  const previousPath = latestPathSnapshot?.path || null;
  const layout = ensurePathLayoutMetrics(refs);
  const flow = getCachedPathFlowMetrics(refs, layout.cell);
  updatePathThemeCache(refs);
  const animateFlow = shouldAnimatePathFlow(snapshot, completionModel);

  if (isPathReversed(snapshot.path, previousPath)) {
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
  } else {
    const shift = getHeadShiftDelta(
      snapshot.path,
      previousPath,
      refs,
      getGridCanvasOffset(refs, headOffsetScratch),
    );
    if (shift !== 0) {
      pathAnimationOffset = normalizeFlowOffset(
        pathAnimationOffset + shift,
        flow.cycle,
      );
    }
  }

  latestPathSnapshot = snapshot;
  latestPathRefs = refs;
  latestPathStatuses = statuses;
  latestCompletionModel = completionModel;

  const offset = animateFlow ? pathAnimationOffset : 0;
  drawAllInternal(snapshot, refs, statuses, offset, completionModel);

  if (animateFlow) {
    schedulePathAnimation();
  } else {
    stopPathAnimation();
  }
}

export function drawStaticSymbols(snapshot, refs, statuses) {
  const { symbolCtx, symbolCanvas } = refs;
  if (!symbolCtx || !symbolCanvas) return;

  clearCanvas(symbolCtx, symbolCanvas);

  drawCornerCounts(snapshot, refs, symbolCtx, statuses?.hintStatus?.cornerVertexStatus);
  drawCrossStitches(snapshot, refs, symbolCtx, statuses?.stitchStatus?.vertexStatus);
}

export function drawAnimatedPath(snapshot, refs, statuses, flowOffset = 0, completionModel = null) {
  const { pathRenderer } = refs;
  if (!pathRenderer) return;

  if (!snapshot || snapshot.path.length === 0) {
    latestPathMainFlowTravel = 0;
    pathRenderer.clear();
    return;
  }

  const layout = ensurePathLayoutMetrics(refs);
  const size = layout.cell;
  const width = Math.max(7, Math.floor(size * 0.15));
  const arrowLength = Math.max(Math.floor(size * 0.24), 13);
  const startRadius = Math.max(Math.floor(width * 0.9), 6);
  const endHalfWidth = Math.max(6, Math.floor(width * 0.95));

  if (!pathThemeCacheInitialized) updatePathThemeCache(refs);
  const completionProgress = getCompletionProgress(completionModel);
  const isCompletionSolved = Boolean(completionModel?.isSolved);
  const showFlowRibbon = shouldAnimatePathFlow(snapshot, completionModel);
  const flowMetrics = getCachedPathFlowMetrics(refs, size);

  const step = size + layout.gap;
  const half = size * 0.5;
  const path = snapshot.path;
  const pathLength = path.length;
  const head = path[0];
  const tail = path[pathLength - 1];
  const pointsChanged = (
    cachedPathRef !== path
    || cachedPathLayoutVersion !== layout.version
    || cachedPathLength !== pathLength
    || cachedPathHeadR !== head.r
    || cachedPathHeadC !== head.c
    || cachedPathTailR !== tail.r
    || cachedPathTailC !== tail.c
  );

  if (pointsChanged) {
    if (reusablePathPoints.length < pathLength) {
      for (let i = reusablePathPoints.length; i < pathLength; i++) {
        reusablePathPoints.push({ x: 0, y: 0 });
      }
    }
    reusablePathPoints.length = pathLength;
    for (let i = 0; i < pathLength; i++) {
      const point = path[i];
      const pooled = reusablePathPoints[i];
      pooled.x = layout.offsetX + layout.pad + (point.c * step) + half;
      pooled.y = layout.offsetY + layout.pad + (point.r * step) + half;
    }

    cachedPathRef = path;
    cachedPathLayoutVersion = layout.version;
    cachedPathLength = pathLength;
    cachedPathHeadR = head.r;
    cachedPathHeadC = head.c;
    cachedPathTailR = tail.r;
    cachedPathTailC = tail.c;
    pathGeometryToken += 1;
  } else if (reusablePathPoints.length !== pathLength) {
    reusablePathPoints.length = pathLength;
  }

  pathFramePayload.points = reusablePathPoints;
  pathFramePayload.geometryToken = pathGeometryToken;
  pathFramePayload.width = width;
  pathFramePayload.startRadius = startRadius;
  pathFramePayload.arrowLength = arrowLength;
  pathFramePayload.endHalfWidth = endHalfWidth;
  pathFramePayload.mainColorRgb = pathThemeMainRgb;
  pathFramePayload.completeColorRgb = pathThemeCompleteRgb;
  pathFramePayload.isCompletionSolved = isCompletionSolved;
  pathFramePayload.completionProgress = completionProgress;
  pathFramePayload.flowEnabled = showFlowRibbon;
  pathFramePayload.flowOffset = flowOffset;
  pathFramePayload.flowCycle = flowMetrics.cycle;
  pathFramePayload.flowPulse = flowMetrics.pulse;
  pathFramePayload.flowSpeed = flowMetrics.speed;
  pathFramePayload.flowRise = PATH_FLOW_RISE;
  pathFramePayload.flowDrop = PATH_FLOW_DROP;
  latestPathMainFlowTravel = pathRenderer.drawPathFrame(pathFramePayload);
}

function drawAllInternal(snapshot, refs, statuses, flowOffset = 0, completionModel = null) {
  drawStaticSymbols(snapshot, refs, statuses);
  drawAnimatedPath(snapshot, refs, statuses, flowOffset, completionModel);
}

function drawCrossStitches(snapshot, refs, ctx, vertexStatus = EMPTY_MAP) {
  ctx.save();
  ctx.globalAlpha = 1;

  const offset = getGridCanvasOffset(refs, gridOffsetScratch);
  const cell = getCellSize(refs.gridEl);
  const stitchLineHalf = Math.max(2, cell * 0.18);
  const stitchWidth = Math.max(1, cell * 0.06);
  const styleDeclaration = getComputedStyle(document.documentElement);
  const colorGood = forceOpaqueColor(styleDeclaration.getPropertyValue('--good').trim() || '#32bb70');
  const colorBad = forceOpaqueColor(styleDeclaration.getPropertyValue('--bad').trim() || '#e85c5c');
  const colorPending = '#ffffff';

  const shadowColor = styleDeclaration.getPropertyValue('--stitchShadow').trim();
  const shadowOpaque = forceOpaqueColor(shadowColor || '#0a111b');

  const resolveDiagStatus = (entry, key) => {
    if (typeof entry === 'string') return entry;
    return entry?.[key] || 'pending';
  };

  const drawLine = (x1, y1, x2, y2, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  for (const [vr, vc] of snapshot.stitches) {
    const point = getVertexPoint(vr, vc, refs, offset, headPointScratchA);
    drawLine(
      point.x - stitchLineHalf,
      point.y - stitchLineHalf,
      point.x + stitchLineHalf,
      point.y + stitchLineHalf,
      shadowOpaque,
      stitchWidth * 2.0,
    );
    drawLine(
      point.x + stitchLineHalf,
      point.y - stitchLineHalf,
      point.x - stitchLineHalf,
      point.y + stitchLineHalf,
      shadowOpaque,
      stitchWidth * 2.0,
    );
  }

  const drawStatePass = (state, color) => {
    for (const [vr, vc] of snapshot.stitches) {
      const vk = keyOf(vr, vc);
      const entry = vertexStatus.get(vk) || 'pending';
      const diagAState = resolveDiagStatus(entry, 'diagA');
      const diagBState = resolveDiagStatus(entry, 'diagB');
      const point = getVertexPoint(vr, vc, refs, offset, headPointScratchB);
      if (diagAState === state) {
        drawLine(
          point.x - stitchLineHalf,
          point.y - stitchLineHalf,
          point.x + stitchLineHalf,
          point.y + stitchLineHalf,
          color,
          stitchWidth,
        );
      }
      if (diagBState === state) {
        drawLine(
          point.x + stitchLineHalf,
          point.y - stitchLineHalf,
          point.x - stitchLineHalf,
          point.y + stitchLineHalf,
          color,
          stitchWidth,
        );
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

  const offset = getGridCanvasOffset(refs, gridOffsetScratch);
  const cell = getCellSize(refs.gridEl);
  const cornerRadius = Math.max(6, cell * 0.17);
  const cornerLineWidth = Math.max(1, cell * 0.04);
  const cornerFontSize = Math.max(12, Math.floor(cell * 0.22));

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${cornerFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;

  const styleDeclaration = getComputedStyle(document.documentElement);
  const colorGood = forceOpaqueColor(styleDeclaration.getPropertyValue('--good').trim() || '#32bb70');
  const colorBad = forceOpaqueColor(styleDeclaration.getPropertyValue('--bad').trim() || '#e85c5c');
  const colorPending = '#ffffff';

  for (const [vr, vc, target] of snapshot.cornerCounts) {
    const vk = keyOf(vr, vc);
    const state = cornerVertexStatus.get(vk) || 'pending';
    let accentColor = colorPending;
    if (state === 'good') accentColor = colorGood;
    else if (state === 'bad') accentColor = colorBad;

    const { x, y } = getVertexPoint(vr, vc, refs, offset, headPointScratchC);

    ctx.beginPath();
    ctx.fillStyle = 'rgb(11, 15, 20)';
    ctx.arc(x, y, cornerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = cornerLineWidth;
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.fillText(String(target), x, y + 0.5);
  }

  ctx.restore();
}

export function resizeCanvas(refs) {
  const { boardWrap, canvas, pathRenderer, symbolCanvas, symbolCtx } = refs;
  if (!boardWrap || !canvas || !pathRenderer || !symbolCanvas || !symbolCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;
  const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
  const nextSignature = [
    activeBoardSize.rows,
    activeBoardSize.cols,
    boardWrap.clientWidth,
    boardWrap.clientHeight,
    boardWrap.offsetWidth,
    boardWrap.offsetHeight,
    dpr,
    viewportWidth,
    viewportHeight,
  ].join('|');
  if (nextSignature === resizeCanvasSignature) return;
  resizeCanvasSignature = nextSignature;

  syncBoardCellSize(refs);

  const wrapRect = boardWrap.getBoundingClientRect();
  const styles = getComputedStyle(boardWrap);
  const borderLeft = parseFloat(styles.borderLeftWidth || '0') || 0;
  const borderRight = parseFloat(styles.borderRightWidth || '0') || 0;
  const borderTop = parseFloat(styles.borderTopWidth || '0') || 0;
  const borderBottom = parseFloat(styles.borderBottomWidth || '0') || 0;
  const cw = Math.max(0, wrapRect.width - borderLeft - borderRight);
  const ch = Math.max(0, wrapRect.height - borderTop - borderBottom);
  const gridRect = refs.gridEl.getBoundingClientRect();
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
  updatePathLayoutMetrics(offset, cell, gap, pad);

  pathRenderer.resize(cw, ch, dpr);
  configureHiDPICanvas(symbolCanvas, symbolCtx, cw, ch);
}
