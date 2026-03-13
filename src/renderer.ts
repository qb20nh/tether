export {
  resolveHeadShiftStepCount,
  resolveTipArrivalSyntheticPrevPath,
} from './renderer/path_animation_engine.ts';
import type {
  ElementLike,
  InteractionModel,
} from './contracts/ports.ts';

type CellMatrix = ReadonlyArray<ReadonlyArray<ElementLike | null | undefined> | undefined>;

let lastPathTipDragHoverCell: ElementLike | null = null;

const readInteger = (value: unknown): number | null =>
  Number.isInteger(value) ? value as number : null;

export const syncPathTipDragHoverCell = (
  interactionModel: InteractionModel | null = null,
  cells: CellMatrix = [],
): void => {
  let nextCell: ElementLike | null = null;
  if (interactionModel?.isPathDragging) {
    const cursor = interactionModel.pathDragCursor;
    const rowIndex = readInteger(cursor?.r);
    const colIndex = readInteger(cursor?.c);
    if (rowIndex !== null && colIndex !== null) {
      const cell = cells[rowIndex]?.[colIndex] || null;
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
