export {
  resolveHeadShiftStepCount,
  resolveTipArrivalSyntheticPrevPath,
} from './renderer/path_animation_engine.js';

const clearPathTipDragHoverCells = (cells = []) => {
  for (let r = 0; r < cells.length; r += 1) {
    const row = cells[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      row[c]?.classList?.remove?.('pathTipDragHover');
    }
  }
};

export const syncPathTipDragHoverCell = (interactionModel = null, cells = []) => {
  clearPathTipDragHoverCells(cells);
  if (!interactionModel?.isPathDragging) return;

  const r = interactionModel.pathDragCursor?.r;
  const c = interactionModel.pathDragCursor?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return;

  const cell = cells?.[r]?.[c] || null;
  if (!cell || cell.classList?.contains?.('wall')) return;
  cell.classList?.add?.('pathTipDragHover');
};
