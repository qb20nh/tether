import { ELEMENT_IDS } from './config.js';
import { keyOf } from './utils.js';
import { cellCenter, getCellSize, vertexPos } from './geometry.js';
import { ICONS } from './icons.js';
import { buildBoardCellViewModel } from './renderer/board_view_model.js';
import { createPathWebglRenderer } from './renderer/path_webgl_renderer.js';

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

const PATH_FLOW_SPEED = -32;
const PATH_FLOW_CYCLE = 128;
const PATH_FLOW_PULSE = 64;
const PATH_FLOW_BASE_CELL = 56;
const PATH_FLOW_RISE = 0.82;
const PATH_FLOW_DROP = 0.83;
const TAU = Math.PI * 2;
const CANVAS_ALIGN_OFFSET_CSS_PX = 0.5;

const pointsMatch = (a, b) => a && b && a.r === b.r && a.c === b.c;
const cellDistance = (a, b) => {
  if (!a || !b) return 1;
  return Math.hypot(a.r - b.r, a.c - b.c);
};

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

const clampUnit = (value) => Math.max(0, Math.min(1, value));

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

const getPathFlowMetrics = (refs = latestPathRefs) => {
  const cell = getCellSize(refs?.gridEl);
  const scale = Number.isFinite(cell) && cell > 0
    ? cell / PATH_FLOW_BASE_CELL
    : 1;
  const cycle = Math.max(18, PATH_FLOW_CYCLE * scale);
  const pulse = Math.max(6, Math.min(PATH_FLOW_PULSE * scale, cycle));
  const speed = PATH_FLOW_SPEED * scale;
  return { cycle, pulse, speed };
};

const normalizeAngle = (angle) => {
  const normalized = angle % TAU;
  return normalized >= 0 ? normalized : normalized + TAU;
};

const angleDeltaSigned = (from, to) => {
  const delta = normalizeAngle(to - from);
  return delta > Math.PI ? delta - TAU : delta;
};

const getHeadLeadTravel = (path, refs = {}, offset = { x: 0, y: 0 }) => {
  const { gridEl } = refs;
  if (!path || path.length < 2) return 0;

  const first = getCellPoint(path[0].r, path[0].c, { gridEl }, offset);
  const second = getCellPoint(path[1].r, path[1].c, { gridEl }, offset);
  const firstSegmentLength = Math.hypot(second.x - first.x, second.y - first.y);
  if (!(firstSegmentLength > 0)) return 0;

  if (path.length < 3) return firstSegmentLength;

  const third = getCellPoint(path[2].r, path[2].c, { gridEl }, offset);
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
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      const flow = getPathFlowMetrics(latestPathRefs);
      pathAnimationOffset = normalizeFlowOffset(
        pathAnimationOffset + dt * flow.speed,
        flow.cycle,
      );
    }
  }

  pathAnimationLastTs = timestamp;
  if (latestPathSnapshot && latestPathRefs) {
    drawAnimatedPath(
      latestPathSnapshot,
      latestPathRefs,
      latestPathStatuses,
      pathAnimationOffset,
      latestCompletionModel,
    );
  }

  pathAnimationFrame = requestAnimationFrame(animatePathFlow);
};

const schedulePathAnimation = () => {
  if (pathAnimationFrame) return;
  pathAnimationLastTs = 0;
  pathAnimationFrame = requestAnimationFrame(animatePathFlow);
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

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

const parseColorToRgb = (color) => {
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
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
    };
  }

  const rgb = resolved.match(
    /^rgba?\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)/i,
  );
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Math.round(Number(rgb[1])))),
      g: Math.max(0, Math.min(255, Math.round(Number(rgb[2])))),
      b: Math.max(0, Math.min(255, Math.round(Number(rgb[3])))),
    };
  }

  return null;
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

  return result;
}

const createGhost = () => {
  const ghost = document.createElement('div');
  ghost.className = 'wallDragGhost';
  ghost.innerHTML = `<div class="wallDragGhostMark">${ICONS.m || ''}</div>`;
  return ghost;
};

const getGridCanvasOffset = (refs) => {
  if (!refs.gridEl || !refs.boardWrap) return { x: 0, y: 0 };
  const gridRect = refs.gridEl.getBoundingClientRect();
  const boardRect = refs.boardWrap.getBoundingClientRect();
  const innerLeft = boardRect.left + refs.boardWrap.clientLeft;
  const innerTop = boardRect.top + refs.boardWrap.clientTop;
  return {
    x: gridRect.left - innerLeft,
    y: gridRect.top - innerTop,
  };
};

const getCellPoint = (r, c, refs, offset = { x: 0, y: 0 }) => {
  const p = cellCenter(r, c, refs.gridEl);
  return { x: p.x + offset.x, y: p.y + offset.y };
};

const getVertexPoint = (r, c, refs, offset = { x: 0, y: 0 }) => {
  const p = vertexPos(r, c, refs.gridEl);
  return { x: p.x + offset.x, y: p.y + offset.y };
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
}

export function clearDropTarget() {
  if (!lastDropTargetKey) return;
  const [r, c] = lastDropTargetKey.split(',').map((v) => Number(v));
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

export function updateCells(snapshot, results, refs, completionModel = null) {
  const { hintStatus, stitchStatus, rpsStatus, blockedStatus } = results;
  const desired = buildBoardCellViewModel(
    snapshot,
    { hintStatus, rpsStatus, blockedStatus },
    resolveCellMarkHtml,
  );

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

  drawAll(snapshot, refs, { hintStatus, stitchStatus, rpsStatus }, completionModel);
}

export function drawAll(snapshot, refs, statuses, completionModel = null) {
  const previousPath = latestPathSnapshot?.path || null;
  const flow = getPathFlowMetrics(refs);

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
    const shift = getHeadShiftDelta(snapshot.path, previousPath, refs);
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

  const offset = shouldAnimatePathFlow(snapshot, completionModel) ? pathAnimationOffset : 0;
  drawAllInternal(snapshot, refs, statuses, offset, completionModel);

  if (shouldAnimatePathFlow(snapshot, completionModel)) {
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

  const offset = getGridCanvasOffset(refs);
  const size = getCellSize(refs.gridEl);
  const width = Math.max(7, Math.floor(size * 0.15));
  const arrowLength = Math.max(Math.floor(size * 0.24), 13);
  const startRadius = Math.max(Math.floor(width * 0.9), 6);
  const endHalfWidth = Math.max(6, Math.floor(width * 0.95));

  const themeStyles = getComputedStyle(refs.boardWrap || document.documentElement);
  const colorMain = forceOpaqueColor(themeStyles.getPropertyValue('--line').trim());
  const colorComplete = forceOpaqueColor(
    themeStyles.getPropertyValue('--good').trim() || '#22c55e',
  );
  const colorMainRgb = parseColorToRgb(colorMain) || { r: 255, g: 255, b: 255 };
  const colorCompleteRgb = parseColorToRgb(colorComplete) || { r: 34, g: 197, b: 94 };
  const completionProgress = getCompletionProgress(completionModel);
  const isCompletionSolved = Boolean(completionModel?.isSolved);
  const showFlowRibbon = shouldAnimatePathFlow(snapshot, completionModel);
  const flowMetrics = getPathFlowMetrics(refs);

  const adjustedPoints = snapshot.path.map((point) =>
    getCellPoint(point.r, point.c, refs, offset));

  latestPathMainFlowTravel = pathRenderer.drawPathFrame({
    points: adjustedPoints,
    width,
    startRadius,
    arrowLength,
    endHalfWidth,
    mainColorRgb: colorMainRgb,
    completeColorRgb: colorCompleteRgb,
    isCompletionSolved,
    completionProgress,
    flowEnabled: showFlowRibbon,
    flowOffset,
    flowCycle: flowMetrics.cycle,
    flowPulse: flowMetrics.pulse,
    flowRise: PATH_FLOW_RISE,
    flowDrop: PATH_FLOW_DROP,
  });
}

function drawAllInternal(snapshot, refs, statuses, flowOffset = 0, completionModel = null) {
  drawStaticSymbols(snapshot, refs, statuses);
  drawAnimatedPath(snapshot, refs, statuses, flowOffset, completionModel);
}

function drawCrossStitches(snapshot, refs, ctx, vertexStatus = new Map()) {
  ctx.save();
  ctx.globalAlpha = 1;

  const offset = getGridCanvasOffset(refs);
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

  const lineData = [];

  const collectLine = (x1, y1, x2, y2, status) => {
    lineData.push({ x1, y1, x2, y2, state: status || 'pending' });
  };

  const drawShadowLine = (x1, y1, x2, y2) => {
    ctx.strokeStyle = shadowOpaque;
    ctx.lineWidth = stitchWidth * 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  for (const [vr, vc] of snapshot.stitches) {
    const vk = keyOf(vr, vc);
    const entry = vertexStatus.get(vk) || 'pending';
    const diagAState = resolveDiagStatus(entry, 'diagA');
    const diagBState = resolveDiagStatus(entry, 'diagB');
    const { x, y } = getVertexPoint(vr, vc, refs, offset);
    collectLine(x - stitchLineHalf, y - stitchLineHalf, x + stitchLineHalf, y + stitchLineHalf, diagAState);
    collectLine(x + stitchLineHalf, y - stitchLineHalf, x - stitchLineHalf, y + stitchLineHalf, diagBState);
  }

  for (const line of lineData) {
    drawShadowLine(line.x1, line.y1, line.x2, line.y2);
  }

  const pendingLines = [];
  const goodLines = [];
  const badLines = [];

  for (const line of lineData) {
    if (line.state === 'bad') badLines.push(line);
    else if (line.state === 'good') goodLines.push(line);
    else pendingLines.push(line);
  }

  for (const line of pendingLines) {
    ctx.strokeStyle = colorPending;
    ctx.lineWidth = stitchWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }

  for (const line of goodLines) {
    ctx.strokeStyle = colorGood;
    ctx.lineWidth = stitchWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }

  for (const line of badLines) {
    ctx.strokeStyle = colorBad;
    ctx.lineWidth = stitchWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCornerCounts(snapshot, refs, ctx, cornerVertexStatus = new Map()) {
  if (!snapshot.cornerCounts || snapshot.cornerCounts.length === 0) return;

  const offset = getGridCanvasOffset(refs);
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

    const { x, y } = getVertexPoint(vr, vc, refs, offset);

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
  syncBoardCellSize(refs);

  const wrapRect = boardWrap.getBoundingClientRect();
  const styles = getComputedStyle(boardWrap);
  const borderLeft = parseFloat(styles.borderLeftWidth || '0') || 0;
  const borderRight = parseFloat(styles.borderRightWidth || '0') || 0;
  const borderTop = parseFloat(styles.borderTopWidth || '0') || 0;
  const borderBottom = parseFloat(styles.borderBottomWidth || '0') || 0;
  const cw = Math.max(0, wrapRect.width - borderLeft - borderRight);
  const ch = Math.max(0, wrapRect.height - borderTop - borderBottom);

  pathRenderer.resize(cw, ch, window.devicePixelRatio || 1);
  configureHiDPICanvas(symbolCanvas, symbolCtx, cw, ch);
}
