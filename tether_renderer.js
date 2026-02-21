import { ELEMENT_IDS } from './tether_config.js';
import { cellCenter, getCellSize, keyOf, vertexPos } from './tether_utils.js';
import { ICONS } from './tether_icons.js';

let gridCells = [];
let lastDropTargetKey = null;
let wallGhostEl = null;
let cachedBoardWrap = null;
let activeBoardSize = { rows: 0, cols: 0 };

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

const parsePx = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const syncBoardCellSize = (refs, rows = activeBoardSize.rows, cols = activeBoardSize.cols) => {
  if (!refs.boardWrap || !refs.gridEl) return;
  if (!rows || !cols || rows <= 0 || cols <= 0) return;

  const gap = parsePx(getComputedStyle(refs.boardWrap).getPropertyValue('--gap')) || 2;
  const parent = refs.boardWrap.parentElement;
  const maxInline = parent ? parent.clientWidth : refs.boardWrap.clientWidth;
  const maxBlock = (() => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    const top = refs.gridEl.getBoundingClientRect().top;
    return Math.max(120, viewportHeight - top - 20);
  })();

  if (!Number.isFinite(maxInline) || maxInline <= 0 || !Number.isFinite(maxBlock) || maxBlock <= 0) return;

  const widthBudget = maxInline - (gap * 2) - (cols - 1) * gap;
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
  const nextCellPx = `${Math.round(nextCell)}px`;

  const currentCell = refs.boardWrap.style.getPropertyValue('--cell') || '';
  if (currentCell !== nextCellPx) {
    refs.boardWrap.style.setProperty('--cell', nextCellPx);
    refs.gridEl.style.setProperty('--cell', nextCellPx);
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
    resetBtn: get(ELEMENT_IDS.RESET_BTN),
    guidePanel: get(ELEMENT_IDS.GUIDE_PANEL),
    guideToggleBtn: get(ELEMENT_IDS.GUIDE_TOGGLE_BTN),
    legendPanel: get(ELEMENT_IDS.LEGEND_PANEL),
    legendToggleBtn: get(ELEMENT_IDS.LEGEND_TOGGLE_BTN),
    msgEl: get(ELEMENT_IDS.MSG),
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

const clearCellState = (cell) => {
  cell.classList.remove(
    'visited',
    'tail',
    'pathStart',
    'pathEnd',
    'badHint',
    'goodHint',
    'badBlocked',
    'badRps',
    'goodRps',
    'dropTarget',
    'wallDropPreview',
  );

  const preview = cell.querySelector('.wallGhostPreviewMarker');
  if (preview) preview.remove();

  const idx = cell.querySelector('.idx');
  if (idx) idx.textContent = '';
};

export function updateCells(snapshot, results, refs) {
  const { hintStatus, stitchStatus, rpsStatus, blockedStatus } = results;

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      clearCellState(gridCells[r][c]);
    }
  }

  for (let i = 0; i < snapshot.path.length; i++) {
    const p = snapshot.path[i];
    const cell = gridCells[p.r][p.c];
    cell.classList.add('visited');
    const idx = cell.querySelector('.idx');
    if (idx) idx.textContent = String(i + 1);
  }

  if (snapshot.path.length > 0) {
    const head = snapshot.path[0];
    const headCell = gridCells[head.r][head.c];
    headCell.classList.add('pathStart');

    if (snapshot.path.length > 1) {
      const tail = snapshot.path[snapshot.path.length - 1];
      const tailCell = gridCells[tail.r][tail.c];
      tailCell.classList.add('pathEnd');
    }
  }

  if (hintStatus) {
    hintStatus.badKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (gridCells[r]?.[c]) gridCells[r][c].classList.add('badHint');
    });

    hintStatus.goodKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (gridCells[r]?.[c]) gridCells[r][c].classList.add('goodHint');
    });
  }

  if (rpsStatus) {
    rpsStatus.badKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (gridCells[r]?.[c]) gridCells[r][c].classList.add('badRps');
    });

    rpsStatus.goodKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      const cell = gridCells[r]?.[c];
      if (!cell || cell.classList.contains('badRps')) return;
      cell.classList.add('goodRps');
    });
  }

  if (blockedStatus) {
    blockedStatus.badKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (gridCells[r]?.[c]) gridCells[r][c].classList.add('badBlocked');
    });
  }

  drawAll(snapshot, refs, { hintStatus, stitchStatus, rpsStatus });
}

export function drawAll(snapshot, refs, statuses) {
  const { ctx, canvas, symbolCtx, symbolCanvas } = refs;
  if (!ctx || !canvas || !symbolCtx || !symbolCanvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  symbolCtx.clearRect(0, 0, symbolCanvas.width / dpr, symbolCanvas.height / dpr);

  drawPathLine(snapshot, refs, ctx);
  drawCornerCounts(snapshot, refs, symbolCtx, statuses?.hintStatus?.cornerVertexStatus);
  drawCrossStitches(snapshot, refs, symbolCtx, statuses?.stitchStatus?.vertexStatus);
}

function drawCrossStitches(snapshot, refs, ctx, vertexStatus = new Map()) {
  const offset = getGridCanvasOffset(refs);
  const cell = getCellSize(refs.gridEl);
  const stitchLineHalf = Math.max(2, cell * 0.18);
  const stitchWidth = Math.max(1, cell * 0.06);
  const shadowColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--stitchShadow')
    .trim();

  const goodColor = getComputedStyle(document.documentElement).getPropertyValue('--good').trim();
  const badColor = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim();
  const idleColor = getComputedStyle(document.documentElement).getPropertyValue('--stitchIdle').trim();

  const resolveDiagStatus = (entry, key) => {
    if (typeof entry === 'string') return entry;
    return entry?.[key] || 'pending';
  };

  const colorForStatus = (status) =>
    status === 'good' ? goodColor : status === 'bad' ? badColor : idleColor;

  const lineData = [];

  const collectLine = (x1, y1, x2, y2, status) => {
    lineData.push({ x1, y1, x2, y2, state: status || 'pending' });
  };

  const drawShadowLine = (x1, y1, x2, y2) => {
    const bgColor = shadowColor || '#0a111b';
    ctx.strokeStyle = bgColor;
    ctx.lineWidth = stitchWidth * 1.85;
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
    const color = colorForStatus(line.state);
    ctx.strokeStyle = color;
    ctx.lineWidth = stitchWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }

  for (const line of goodLines) {
    const color = colorForStatus(line.state);
    ctx.strokeStyle = color;
    ctx.lineWidth = stitchWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }

  for (const line of badLines) {
    const color = colorForStatus(line.state);
    ctx.strokeStyle = color;
    ctx.lineWidth = stitchWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }
}

function drawPathLine(snapshot, refs, ctx) {
  if (snapshot.path.length === 0) return;

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  const offset = getGridCanvasOffset(refs);
  const size = getCellSize(refs.gridEl);
  const width = Math.max(7, Math.floor(size * 0.15));
  const arrowLength = Math.max(Math.floor(size * 0.24), 13);

  const colorMain = getComputedStyle(document.documentElement).getPropertyValue('--line').trim();

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  if (snapshot.path.length > 1) {
    const adjustedPoints = [];
    for (let i = 0; i < snapshot.path.length; i++) {
      const p = snapshot.path[i];
      const pnt = getCellPoint(p.r, p.c, refs, offset);
      adjustedPoints.push(pnt);
    }

    ctx.strokeStyle = colorMain;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < adjustedPoints.length; i++) {
      const { x, y } = adjustedPoints[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const head = snapshot.path[0];
  const { x: hx, y: hy } = getCellPoint(head.r, head.c, refs, offset);
  const startRadius = Math.max(Math.floor(width * 0.9), 6);
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
    const halfHeadWidth = Math.max(6, Math.floor(width * 0.95));

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

  ctx.globalAlpha = previousAlpha;
}

function drawCornerCounts(snapshot, refs, ctx, cornerVertexStatus = new Map()) {
  if (!snapshot.cornerCounts || snapshot.cornerCounts.length === 0) return;

  const offset = getGridCanvasOffset(refs);
  const cell = getCellSize(refs.gridEl);
  const cornerRadius = Math.max(6, cell * 0.17);
  const cornerLineWidth = Math.max(1, cell * 0.04);
  const cornerFontSize = Math.max(12, Math.floor(cell * 0.22));

  const rootStyles = getComputedStyle(document.documentElement);
  const goodColor = rootStyles.getPropertyValue('--good').trim();
  const badColor = rootStyles.getPropertyValue('--bad').trim();
  const pendingColor = rootStyles.getPropertyValue('--muted').trim();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${cornerFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;

  for (const [vr, vc, target] of snapshot.cornerCounts) {
    const vk = keyOf(vr, vc);
    const status = cornerVertexStatus.get(vk) || 'pending';
    const accentColor = status === 'good'
      ? goodColor
      : status === 'bad'
        ? badColor
        : pendingColor;
    const { x, y } = getVertexPoint(vr, vc, refs, offset);

    ctx.beginPath();
    ctx.fillStyle = 'rgba(11, 15, 20, 0.88)';
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
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.ceil(cw * dpr));
  canvas.height = Math.max(1, Math.ceil(ch * dpr));
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  symbolCanvas.width = Math.max(1, Math.ceil(cw * dpr));
  symbolCanvas.height = Math.max(1, Math.ceil(ch * dpr));
  symbolCanvas.style.width = `${cw}px`;
  symbolCanvas.style.height = `${ch}px`;
  symbolCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
