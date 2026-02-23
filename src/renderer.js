import { ELEMENT_IDS } from './config.js';
import { keyOf } from './utils.js';
import { cellCenter, getCellSize, vertexPos } from './geometry.js';
import { ICONS } from './icons.js';

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

const PATH_FLOW_SPEED = -32;
const PATH_FLOW_CYCLE = 128;
const PATH_FLOW_PULSE = 64;
const PATH_FLOW_GLOW_ALPHA = 1;
const PATH_FLOW_GLOW = `rgba(255, 255, 255, ${PATH_FLOW_GLOW_ALPHA})`;
const PATH_FLOW_GLOW_SOFT = 'rgba(255, 255, 255, 0)';
const PATH_FLOW_RISE = 0.82;
const PATH_FLOW_DROP = 0.83;
const FLOW_STOP_EPSILON = 1e-4;
const TAU = Math.PI * 2;

const pointsMatch = (a, b) => a && b && a.r === b.r && a.c === b.c;
const cellDistance = (a, b) => {
  if (!a || !b) return 1;
  return Math.hypot(a.r - b.r, a.c - b.c);
};

const normalizeFlowOffset = (value) => {
  if (!Number.isFinite(value)) return 0;
  const mod = value % PATH_FLOW_CYCLE;
  return mod >= 0 ? mod : mod + PATH_FLOW_CYCLE;
};

const normalizeModulo = (value, modulus) => {
  if (!Number.isFinite(value) || !Number.isFinite(modulus) || modulus <= 0) return 0;
  const mod = value % modulus;
  return mod >= 0 ? mod : mod + modulus;
};

const normalizeAngle = (angle) => {
  const normalized = angle % TAU;
  return normalized >= 0 ? normalized : normalized + TAU;
};

const angleDeltaSigned = (from, to) => {
  const delta = normalizeAngle(to - from);
  return delta > Math.PI ? delta - TAU : delta;
};

const flowColorFromAlpha = (alpha) => {
  const clampedAlpha = Math.max(0, Math.min(PATH_FLOW_GLOW_ALPHA, alpha));
  if (clampedAlpha <= 0.0005) return PATH_FLOW_GLOW_SOFT;
  if (clampedAlpha >= PATH_FLOW_GLOW_ALPHA - 0.0005) return PATH_FLOW_GLOW;
  return `rgba(255, 255, 255, ${clampedAlpha.toFixed(4)})`;
};

const flowAlphaAtPhase = (phase, pulse) => {
  if (!Number.isFinite(phase) || !Number.isFinite(pulse) || pulse <= 0 || phase >= pulse) {
    return 0;
  }

  const rise = Math.max(0.001, Math.min(0.995, PATH_FLOW_RISE));
  const drop = Math.max(rise + 0.001, Math.min(0.999, PATH_FLOW_DROP));
  const unit = phase / pulse;

  if (unit <= rise) {
    return PATH_FLOW_GLOW_ALPHA * (unit / rise);
  }
  if (unit <= drop) {
    const t = (unit - rise) / (drop - rise);
    return PATH_FLOW_GLOW_ALPHA * (1 - t);
  }
  return 0;
};

const flowAlphaAtTravel = (travel, flowOffset, cycle, pulse) => {
  const phase = normalizeModulo(travel + flowOffset, cycle);
  return flowAlphaAtPhase(phase, pulse);
};

const addOrderedGradientStops = (gradient, stops) => {
  if (!stops || stops.length === 0) {
    gradient.addColorStop(0, PATH_FLOW_GLOW_SOFT);
    gradient.addColorStop(1, PATH_FLOW_GLOW_SOFT);
    return;
  }

  const ordered = stops
    .filter((stop) => stop && Number.isFinite(stop.position))
    .map((stop) => ({
      position: Math.max(0, Math.min(1, stop.position)),
      color: stop.color || PATH_FLOW_GLOW_SOFT,
    }))
    .sort((a, b) => a.position - b.position);

  if (ordered.length === 0) {
    gradient.addColorStop(0, PATH_FLOW_GLOW_SOFT);
    gradient.addColorStop(1, PATH_FLOW_GLOW_SOFT);
    return;
  }

  const merged = [];
  for (const stop of ordered) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(stop.position - last.position) < FLOW_STOP_EPSILON) {
      last.color = stop.color;
    } else {
      merged.push({ ...stop });
    }
  }

  const first = merged[0];
  const last = merged[merged.length - 1];
  if (first.position > 0) gradient.addColorStop(0, first.color);
  for (const stop of merged) {
    gradient.addColorStop(stop.position, stop.color);
  }
  if (last.position < 1) gradient.addColorStop(1, last.color);
};

const buildFlowGradientStops = (travelStart, travelEnd, flowOffset, cycle, pulse) => {
  const length = travelEnd - travelStart;
  if (!Number.isFinite(length) || length <= 0) {
    return [
      { position: 0, color: PATH_FLOW_GLOW_SOFT },
      { position: 1, color: PATH_FLOW_GLOW_SOFT },
    ];
  }

  const pushStops = [];
  const addStopAtTravel = (travel) => {
    if (!Number.isFinite(travel)) return;
    if (travel < travelStart - 1e-6 || travel > travelEnd + 1e-6) return;
    const position = Math.max(0, Math.min(1, (travel - travelStart) / length));
    const alpha = flowAlphaAtTravel(travel, flowOffset, cycle, pulse);
    pushStops.push({ position, alpha });
  };

  addStopAtTravel(travelStart);
  addStopAtTravel(travelEnd);

  const riseDist = pulse * Math.max(0, Math.min(1, PATH_FLOW_RISE));
  const dropDist = pulse * Math.max(0, Math.min(1, PATH_FLOW_DROP));
  const boundaries = [0, riseDist, dropDist, pulse];

  const shiftedStart = travelStart + flowOffset;
  const shiftedEnd = travelEnd + flowOffset;

  for (const boundary of boundaries) {
    const nStart = Math.floor((shiftedStart - boundary) / cycle);
    const nEnd = Math.floor((shiftedEnd - boundary) / cycle);
    for (let n = nStart; n <= nEnd; n++) {
      const travel = n * cycle + boundary - flowOffset;
      addStopAtTravel(travel);
    }
  }

  pushStops.sort((a, b) => a.position - b.position);
  const merged = [];
  for (const stop of pushStops) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(stop.position - last.position) < FLOW_STOP_EPSILON) {
      last.alpha = stop.alpha;
    } else {
      merged.push({ ...stop });
    }
  }

  if (merged.length === 0) {
    return [
      { position: 0, color: PATH_FLOW_GLOW_SOFT },
      { position: 1, color: PATH_FLOW_GLOW_SOFT },
    ];
  }

  if (merged[0].position > 0) {
    merged.unshift({ position: 0, alpha: merged[0].alpha });
  }

  const tail = merged[merged.length - 1];
  if (tail.position < 1) {
    merged.push({ position: 1, alpha: tail.alpha });
  }

  return merged.map((stop) => ({
    position: stop.position,
    color: flowColorFromAlpha(stop.alpha),
  }));
};

const getHeadLeadTravel = (path, refs = {}, offset = { x: 0, y: 0 }) => {
  const { gridEl, ctx } = refs;
  if (!path || path.length < 2) return 0;

  const first = getCellPoint(path[0].r, path[0].c, { gridEl }, offset);
  const second = getCellPoint(path[1].r, path[1].c, { gridEl }, offset);
  const firstSegmentLength = Math.hypot(second.x - first.x, second.y - first.y);
  if (!(firstSegmentLength > 0)) return 0;

  const canUseConic = typeof ctx?.createConicGradient === 'function';
  if (!canUseConic || path.length < 3) return firstSegmentLength;

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

const shouldAnimatePathFlow = (snapshot) => {
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

  if (!shouldAnimatePathFlow(latestPathSnapshot)) {
    stopPathAnimation();
    drawAllInternal(latestPathSnapshot, latestPathRefs, latestPathStatuses, 0);
    return;
  }

  if (pathAnimationLastTs > 0) {
    const dt = Math.max(0, (timestamp - pathAnimationLastTs) / 1000);
    if (Number.isFinite(dt)) {
      pathAnimationOffset = (pathAnimationOffset + dt * PATH_FLOW_SPEED) % PATH_FLOW_CYCLE;
    }
  }

  pathAnimationLastTs = timestamp;
  if (latestPathSnapshot && latestPathRefs) {
    drawAnimatedPath(latestPathSnapshot, latestPathRefs, latestPathStatuses, pathAnimationOffset);
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

const getCanvasScale = (ctx) => {
  const fallback = window.devicePixelRatio || 1;
  if (!ctx || typeof ctx.getTransform !== 'function') {
    return { x: fallback, y: fallback };
  }

  const transform = ctx.getTransform();
  const sx = Number.isFinite(transform.a) && transform.a !== 0 ? transform.a : fallback;
  const sy = Number.isFinite(transform.d) && transform.d !== 0 ? transform.d : fallback;
  return { x: sx, y: sy };
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

  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  ctx.imageSmoothingEnabled = false;
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
  const nextCellBorder = clampNumber(nextCell * 0.02, 0.6, 2.4);
  const nextBoardBorder = clampNumber(nextCell * 0.02, 0.6, 2.4);
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
    levelSel: get(ELEMENT_IDS.LEVEL_SEL),
    langLabel: get(ELEMENT_IDS.LANG_LABEL),
    langSel: get(ELEMENT_IDS.LANG_SEL),
    themeLabel: get(ELEMENT_IDS.THEME_LABEL),
    themeToggle: get(ELEMENT_IDS.THEME_TOGGLE),
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
    result.ctx = result.canvas.getContext('2d');
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
        mark.innerHTML = icons['m'];
      } else if (code === '#') {
        cell.classList.add('wall');
        mark.innerHTML = '';
      } else {
        mark.innerHTML = icons[code] || '';
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

export function updateCells(snapshot, results, refs) {
  const { hintStatus, stitchStatus, rpsStatus, blockedStatus } = results;

  const desired = Array.from({ length: snapshot.rows }, () =>
    Array.from({ length: snapshot.cols }, () => ({
      classes: ['cell'],
      idx: '',
    }))
  );

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const code = snapshot.gridData[r][c];
      if (code === 'm') desired[r][c].classes.push('wall', 'movable');
      else if (code === '#') desired[r][c].classes.push('wall');
    }
  }

  for (let i = 0; i < snapshot.path.length; i++) {
    const p = snapshot.path[i];
    desired[p.r][p.c].classes.push('visited');
    desired[p.r][p.c].idx = String(i + 1);
  }

  if (snapshot.path.length > 0) {
    const head = snapshot.path[0];
    desired[head.r][head.c].classes.push('pathStart');

    if (snapshot.path.length > 1) {
      const tail = snapshot.path[snapshot.path.length - 1];
      desired[tail.r][tail.c].classes.push('pathEnd');
    }
  }

  if (hintStatus) {
    hintStatus.badKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('badHint');
    });

    hintStatus.goodKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('goodHint');
    });
  }

  if (rpsStatus) {
    rpsStatus.badKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('badRps');
    });

    rpsStatus.goodKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c] && !desired[r][c].classes.includes('badRps')) {
        desired[r][c].classes.push('goodRps');
      }
    });
  }

  if (blockedStatus) {
    blockedStatus.badKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('badBlocked');
    });
  }

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const cell = gridCells[r][c];
      const state = desired[r][c];
      const targetStr = state.classes.join(' ');

      if (cell.className !== targetStr) {
        cell.className = targetStr;
      }

      const idxEl = cell.querySelector('.idx');
      if (idxEl && idxEl.textContent !== state.idx) {
        idxEl.textContent = state.idx;
      }
    }
  }

  drawAll(snapshot, refs, { hintStatus, stitchStatus, rpsStatus });
}

export function drawAll(snapshot, refs, statuses) {
  const previousPath = latestPathSnapshot?.path || null;
  const shift = getHeadShiftDelta(snapshot.path, previousPath, refs);
  if (shift !== 0) {
    pathAnimationOffset = normalizeFlowOffset(pathAnimationOffset + shift);
  }

  latestPathSnapshot = snapshot;
  latestPathRefs = refs;
  latestPathStatuses = statuses;

  const offset = shouldAnimatePathFlow(snapshot) ? pathAnimationOffset : 0;
  drawAllInternal(snapshot, refs, statuses, offset);

  if (shouldAnimatePathFlow(snapshot)) {
    schedulePathAnimation();
  } else {
    stopPathAnimation();
  }
}

export function drawStaticSymbols(snapshot, refs, statuses) {
  const { symbolCtx, symbolCanvas } = refs;
  if (!symbolCtx || !symbolCanvas) return;

  const symbolScale = getCanvasScale(symbolCtx);
  symbolCtx.clearRect(0, 0, symbolCanvas.width / symbolScale.x, symbolCanvas.height / symbolScale.y);

  drawCornerCounts(snapshot, refs, symbolCtx, statuses?.hintStatus?.cornerVertexStatus);
  drawCrossStitches(snapshot, refs, symbolCtx, statuses?.stitchStatus?.vertexStatus);
}

export function drawAnimatedPath(snapshot, refs, statuses, flowOffset = 0) {
  const { ctx, canvas } = refs;
  if (!ctx || !canvas) return;

  const pathScale = getCanvasScale(ctx);
  ctx.clearRect(0, 0, canvas.width / pathScale.x, canvas.height / pathScale.y);

  drawPathLine(snapshot, refs, ctx, flowOffset);
}

function drawAllInternal(snapshot, refs, statuses, flowOffset = 0) {
  drawStaticSymbols(snapshot, refs, statuses);
  drawAnimatedPath(snapshot, refs, statuses, flowOffset);
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

function drawPathLine(snapshot, refs, ctx, flowOffset = 0) {
  if (snapshot.path.length === 0) return;

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  const offset = getGridCanvasOffset(refs);
  const size = getCellSize(refs.gridEl);
  const width = Math.max(7, Math.floor(size * 0.15));
  const arrowLength = Math.max(Math.floor(size * 0.24), 13);
  const startRadius = Math.max(Math.floor(width * 0.9), 6);
  const halfHeadWidth = Math.max(6, Math.floor(width * 0.95));

  const colorMain = forceOpaqueColor(
    getComputedStyle(document.documentElement).getPropertyValue('--line').trim(),
  );

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const adjustedPoints = [];
  for (let i = 0; i < snapshot.path.length; i++) {
    const p = snapshot.path[i];
    const pnt = getCellPoint(p.r, p.c, refs, offset);
    adjustedPoints.push(pnt);
  }

  if (snapshot.path.length > 1) {
    ctx.strokeStyle = colorMain;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < adjustedPoints.length; i++) {
      const { x, y } = adjustedPoints[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (shouldAnimatePathFlow(snapshot)) {
      drawFlowRibbon(adjustedPoints, ctx, width, flowOffset, {
        startRadius,
        arrowLength,
        endHalfWidth: halfHeadWidth,
        drawMain: true,
        drawTips: false,
      });
    }
  }

  const head = snapshot.path[0];
  const { x: hx, y: hy } = getCellPoint(head.r, head.c, refs, offset);
  ctx.fillStyle = colorMain;
  ctx.beginPath();
  ctx.arc(hx, hy, startRadius, 0, Math.PI * 2);
  ctx.fill();

  if (snapshot.path.length > 1) {
    const tail = snapshot.path[snapshot.path.length - 1];
    const prev = snapshot.path[snapshot.path.length - 2];
    const { x: tx, y: ty } = getCellPoint(tail.r, tail.c, refs, offset);
    const { x: px, y: py } = getCellPoint(prev.r, prev.c, refs, offset);
    const dx = tx - px;
    const dy = ty - py;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;
    const angle = Math.atan2(uy, ux);

    ctx.fillStyle = colorMain;
    ctx.beginPath();
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(angle);
    ctx.moveTo(arrowLength, 0);
    ctx.lineTo(0, -halfHeadWidth);
    ctx.lineTo(0, halfHeadWidth);
    ctx.closePath();
    ctx.restore();
    ctx.fill();
  }

  if (snapshot.path.length > 1 && shouldAnimatePathFlow(snapshot)) {
    drawFlowRibbon(adjustedPoints, ctx, width, flowOffset, {
      startRadius,
      arrowLength,
      endHalfWidth: halfHeadWidth,
      drawMain: false,
      drawTips: true,
    });
  }

  ctx.globalAlpha = previousAlpha;
}

function drawFlowRibbon(points, ctx, width, flowOffset, tipOptions = {}) {
  if (points.length < 2 || !Number.isFinite(flowOffset)) return;

  const cycle = Math.max(18, PATH_FLOW_CYCLE);
  const pulse = Math.max(6, Math.min(PATH_FLOW_PULSE, cycle));
  const flowWidth = width;
  const drawMain = tipOptions.drawMain !== false;
  const drawTips = tipOptions.drawTips !== false;
  const startTipRadius = Number.isFinite(tipOptions.startRadius) ? Math.max(0, tipOptions.startRadius) : 0;
  const endTipLength = Number.isFinite(tipOptions.arrowLength) ? Math.max(0, tipOptions.arrowLength) : 0;
  const endTipHalfWidth = Number.isFinite(tipOptions.endHalfWidth)
    ? Math.max(0, tipOptions.endHalfWidth)
    : Math.max(6, Math.floor(flowWidth * 0.95));
  const canUseConic = typeof ctx.createConicGradient === 'function';
  const segmentCount = points.length - 1;
  const segmentLengths = new Array(Math.max(0, segmentCount)).fill(0);
  const segmentUx = new Array(Math.max(0, segmentCount)).fill(0);
  const segmentUy = new Array(Math.max(0, segmentCount)).fill(0);
  const cornerTurns = new Array(points.length).fill(null);
  const linearPrimitives = [];
  const cornerPrimitives = [];

  const cornerRadius = Math.max(1.2, flowWidth * 0.5);
  const angleTolerance = 1e-4;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      segmentLengths[i] = len;
      segmentUx[i] = dx / len;
      segmentUy[i] = dy / len;
    } else {
      segmentLengths[i] = 0;
      segmentUx[i] = 0;
      segmentUy[i] = 0;
    }
  }

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];

    const inDx = corner.x - prev.x;
    const inDy = corner.y - prev.y;
    const outDx = next.x - corner.x;
    const outDy = next.y - corner.y;
    const inLen = Math.hypot(inDx, inDy);
    const outLen = Math.hypot(outDx, outDy);
    if (inLen <= 0 || outLen <= 0) continue;

    const inAngle = Math.atan2(inDy, inDx);
    const outAngle = Math.atan2(outDy, outDx);
    const headingTurn = angleDeltaSigned(inAngle, outAngle);
    const absTurn = Math.abs(headingTurn);
    if (absTurn <= angleTolerance || absTurn >= Math.PI - angleTolerance) continue;

    const tangentOffset = cornerRadius * Math.tan(absTurn * 0.5);
    if (!(tangentOffset > 0) || !Number.isFinite(tangentOffset)) continue;
    const inUx = inDx / inLen;
    const inUy = inDy / inLen;
    const outUx = outDx / outLen;
    const outUy = outDy / outLen;
    const baseCx = corner.x;
    const baseCy = corner.y;
    const tangentInX = baseCx - inUx * tangentOffset;
    const tangentInY = baseCy - inUy * tangentOffset;
    const tangentOutX = baseCx + outUx * tangentOffset;
    const tangentOutY = baseCy + outUy * tangentOffset;
    const inNormalX = headingTurn > 0 ? -inUy : inUy;
    const inNormalY = headingTurn > 0 ? inUx : -inUx;
    const cx = tangentInX + inNormalX * cornerRadius;
    const cy = tangentInY + inNormalY * cornerRadius;
    const angleIn = normalizeAngle(Math.atan2(tangentInY - cy, tangentInX - cx));
    const angleOut = normalizeAngle(Math.atan2(tangentOutY - cy, tangentOutX - cx));
    const centerSweep = angleDeltaSigned(angleIn, angleOut);
    const centerSweepAbs = Math.abs(centerSweep);
    if (centerSweepAbs <= angleTolerance) continue;

    cornerTurns[i] = {
      centerAngleIn: angleIn,
      centerAngleOut: angleOut,
      turnSigned: centerSweep < 0 ? -1 : 1,
      absTurn: centerSweepAbs,
      tangentOffset,
      arcLength: Math.max(0, centerSweepAbs * cornerRadius),
      cx,
      cy,
      tangentInX,
      tangentInY,
      tangentOutX,
      tangentOutY,
    };
  }

  let firstSegmentIndex = -1;
  let lastSegmentIndex = -1;
  for (let i = 0; i < segmentCount; i++) {
    if (segmentLengths[i] <= 0) continue;
    if (firstSegmentIndex < 0) firstSegmentIndex = i;
    lastSegmentIndex = i;
  }

  let flowTravel = 0;
  for (let i = 0; i < segmentCount; i++) {
    const len = segmentLengths[i];
    const startCorner = canUseConic ? cornerTurns[i] : null;
    const endCorner = canUseConic ? cornerTurns[i + 1] : null;
    const hasStartCorner = Boolean(startCorner);
    const hasEndCorner = Boolean(endCorner);
    const trimStart = hasStartCorner ? startCorner.tangentOffset : 0;
    const trimEnd = hasEndCorner ? endCorner.tangentOffset : 0;
    const drawableStart = Math.min(trimStart, len);
    const drawableEnd = Math.max(drawableStart, len - trimEnd);
    const drawableLength = drawableEnd - drawableStart;

    if (drawableLength > 0) {
      linearPrimitives.push({
        segmentIndex: i,
        localStart: drawableStart,
        localEnd: drawableEnd,
        travelStart: flowTravel,
        travelEnd: flowTravel + drawableLength,
      });
      flowTravel += drawableLength;
    }

    if (hasEndCorner && cornerTurns[i + 1]) {
      const arcLength = cornerTurns[i + 1].arcLength;
      if (arcLength > 0) {
        cornerPrimitives.push({
          cornerIndex: i + 1,
          travelStart: flowTravel,
          travelEnd: flowTravel + arcLength,
        });
        flowTravel += arcLength;
      }
    }
  }

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;

  const fillGradientWithClip = (clipPath, bounds, x1, y1, x2, y2, travelStart, travelEnd) => {
    if (!clipPath || !bounds) return;
    const travelSpan = travelEnd - travelStart;
    if (!Number.isFinite(travelSpan) || travelSpan <= 0) return;

    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    const flowStops = buildFlowGradientStops(
      travelStart,
      travelEnd,
      flowOffset,
      cycle,
      pulse,
    );
    addOrderedGradientStops(gradient, flowStops);

    ctx.save();
    ctx.clip(clipPath);
    ctx.fillStyle = gradient;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.restore();
  };

  const drawStartTipGradient = () => {
    if (!(startTipRadius > 0 && firstSegmentIndex >= 0)) return;
    const head = points[0];
    const ux = segmentUx[firstSegmentIndex];
    const uy = segmentUy[firstSegmentIndex];
    const startClip = new Path2D();
    startClip.arc(head.x, head.y, startTipRadius, 0, TAU);
    fillGradientWithClip(
      startClip,
      {
        x: head.x - startTipRadius - 1,
        y: head.y - startTipRadius - 1,
        w: startTipRadius * 2 + 2,
        h: startTipRadius * 2 + 2,
      },
      head.x - ux * startTipRadius,
      head.y - uy * startTipRadius,
      head.x + ux * startTipRadius,
      head.y + uy * startTipRadius,
      -startTipRadius,
      startTipRadius,
    );
  };

  if (drawMain) {
    for (const primitive of linearPrimitives) {
      const i = primitive.segmentIndex;
      const start = points[i];
      const ux = segmentUx[i];
      const uy = segmentUy[i];
      const x1 = start.x + ux * primitive.localStart;
      const y1 = start.y + uy * primitive.localStart;
      const x2 = start.x + ux * primitive.localEnd;
      const y2 = start.y + uy * primitive.localEnd;
      const flow = ctx.createLinearGradient(x1, y1, x2, y2);
      const flowStops = buildFlowGradientStops(
        primitive.travelStart,
        primitive.travelEnd,
        flowOffset,
        cycle,
        pulse,
      );
      addOrderedGradientStops(flow, flowStops);

      ctx.strokeStyle = flow;
      ctx.lineWidth = flowWidth;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  if (drawTips && endTipLength > 0 && lastSegmentIndex >= 0) {
    const tail = points[points.length - 1];
    const ux = segmentUx[lastSegmentIndex];
    const uy = segmentUy[lastSegmentIndex];
    const perpX = -uy;
    const perpY = ux;
    const apexX = tail.x + ux * endTipLength;
    const apexY = tail.y + uy * endTipLength;
    const leftX = tail.x - perpX * endTipHalfWidth;
    const leftY = tail.y - perpY * endTipHalfWidth;
    const rightX = tail.x + perpX * endTipHalfWidth;
    const rightY = tail.y + perpY * endTipHalfWidth;
    const minX = Math.min(apexX, leftX, rightX) - 1;
    const maxX = Math.max(apexX, leftX, rightX) + 1;
    const minY = Math.min(apexY, leftY, rightY) - 1;
    const maxY = Math.max(apexY, leftY, rightY) + 1;

    const endClip = new Path2D();
    endClip.moveTo(apexX, apexY);
    endClip.lineTo(leftX, leftY);
    endClip.lineTo(rightX, rightY);
    endClip.closePath();

    fillGradientWithClip(
      endClip,
      {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      },
      tail.x,
      tail.y,
      apexX,
      apexY,
      flowTravel,
      flowTravel + endTipLength,
    );
  }

  if (!canUseConic) {
    if (drawTips) drawStartTipGradient();
    ctx.restore();
    return;
  }

  if (drawMain) {
    for (const primitive of cornerPrimitives) {
      const i = primitive.cornerIndex;
      const corner = cornerTurns[i];
      if (!corner) continue;

      const turnSigned = corner.turnSigned;
      const turnAbs = corner.absTurn;
      const cornerArcLength = Math.max(0, turnAbs * cornerRadius);
      if (cornerArcLength <= 0) continue;

      const baseCx = points[i].x;
      const baseCy = points[i].y;
      const cx = corner.cx;
      const cy = corner.cy;
      const tangentInX = corner.tangentInX;
      const tangentInY = corner.tangentInY;
      const tangentOutX = corner.tangentOutX;
      const tangentOutY = corner.tangentOutY;
      const spanNorm = turnAbs / TAU;
      const conicStartAngle = turnSigned > 0 ? corner.centerAngleIn : corner.centerAngleOut;
      const cornerGradient = ctx.createConicGradient(conicStartAngle, cx, cy);
      const flowStops = buildFlowGradientStops(
        primitive.travelStart,
        primitive.travelEnd,
        flowOffset,
        cycle,
        pulse,
      );
      const conicStops = flowStops.map((stop) => ({
        position: turnSigned > 0 ? stop.position * spanNorm : (1 - stop.position) * spanNorm,
        color: stop.color,
      }));
      addOrderedGradientStops(cornerGradient, conicStops);

      const cornerConnector = new Path2D();
      cornerConnector.moveTo(tangentInX, tangentInY);
      cornerConnector.lineTo(baseCx, baseCy);
      cornerConnector.lineTo(tangentOutX, tangentOutY);

      ctx.save();
      ctx.strokeStyle = cornerGradient;
      ctx.lineWidth = flowWidth;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.stroke(cornerConnector);
      ctx.restore();
    }
  }

  if (drawTips) drawStartTipGradient();
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
  const { boardWrap, canvas, ctx, symbolCanvas, symbolCtx } = refs;
  if (!boardWrap || !canvas || !ctx || !symbolCanvas || !symbolCtx) return;
  syncBoardCellSize(refs);

  const wrapRect = boardWrap.getBoundingClientRect();
  const styles = getComputedStyle(boardWrap);
  const borderLeft = parseFloat(styles.borderLeftWidth || '0') || 0;
  const borderRight = parseFloat(styles.borderRightWidth || '0') || 0;
  const borderTop = parseFloat(styles.borderTopWidth || '0') || 0;
  const borderBottom = parseFloat(styles.borderBottomWidth || '0') || 0;
  const cw = Math.max(0, wrapRect.width - borderLeft - borderRight);
  const ch = Math.max(0, wrapRect.height - borderTop - borderBottom);

  configureHiDPICanvas(canvas, ctx, cw, ch);
  configureHiDPICanvas(symbolCanvas, symbolCtx, cw, ch);
}
