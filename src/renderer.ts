// @ts-nocheck
export {
  resolveHeadShiftStepCount,
  resolveTipArrivalSyntheticPrevPath,
} from './renderer/path_animation_engine.ts';

let lastPathTipDragHoverCell = null;

export const syncPathTipDragHoverCell = (interactionModel = null, cells = []) => {
  let nextCell = null;
  if (interactionModel?.isPathDragging) {
    const r = interactionModel.pathDragCursor?.r;
    const c = interactionModel.pathDragCursor?.c;
    if (Number.isInteger(r) && Number.isInteger(c)) {
      const cell = cells?.[r]?.[c] || null;
      if (cell && !cell.classList?.contains?.('wall')) {
        nextCell = cell;
      }
    }
  }

  if (nextCell === lastPathTipDragHoverCell) return;
  lastPathTipDragHoverCell?.classList?.remove?.('pathTipDragHover');
  lastPathTipDragHoverCell = null;
  if (!nextCell) return;

  nextCell.classList?.add?.('pathTipDragHover');
  lastPathTipDragHoverCell = nextCell;
};
