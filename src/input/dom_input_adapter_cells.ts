import type {
  BoardLayoutMetrics,
  ElementLike,
  GameSnapshot,
  GridPoint,
} from '../contracts/ports.ts';
import type {
  GridMetrics,
  ViewportScrollState,
} from './dom_input_adapter_metrics.ts';
import {
  captureGridMetrics,
  readCachedGridMetrics,
} from './dom_input_adapter_metrics.ts';
import {
  clampToRange,
} from './dom_input_adapter_support.ts';

type SnapshotShape = Pick<GameSnapshot, 'rows' | 'cols'> | null | undefined;

interface ElementFromPointDocument {
  elementFromPoint: (x: number, y: number) => ElementLike | null;
}

interface CellPointOptions {
  x: number;
  y: number;
  snapshot: SnapshotShape;
  metrics?: GridMetrics | null;
  gridEl: ElementLike | null | undefined;
  viewportScroll: ViewportScrollState;
}

interface PathCellPointOptions extends CellPointOptions {
  layoutMetrics: BoardLayoutMetrics | null | undefined;
}

const defaultDocument = (): ElementFromPointDocument | undefined => (
  typeof document !== 'undefined'
    ? document as unknown as ElementFromPointDocument
    : undefined
);

export const snapCellFromMetrics = (
  x: number,
  y: number,
  resolved: BoardLayoutMetrics | null | undefined,
): GridPoint | null => {
  if (!resolved) return null;
  const localX = x - resolved.left - resolved.pad - (resolved.size * 0.5);
  const localY = y - resolved.top - resolved.pad - (resolved.size * 0.5);
  const c = clampToRange(Math.round(localX / resolved.step), 0, resolved.cols - 1);
  const r = clampToRange(Math.round(localY / resolved.step), 0, resolved.rows - 1);
  return { r, c };
};

export const cellFromPoint = (
  x: number,
  y: number,
  documentObj: ElementFromPointDocument | undefined = defaultDocument(),
): GridPoint | null => {
  const el = documentObj?.elementFromPoint(x, y);
  if (!el) return null;
  const cell = el.closest('.cell') as ElementLike | null;
  if (!cell) return null;

  const r = Number.parseInt(cell.dataset.r ?? '', 10);
  const c = Number.parseInt(cell.dataset.c ?? '', 10);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
};

export const snapWallCellFromPoint = ({
  x,
  y,
  snapshot,
  metrics = null,
  gridEl,
  viewportScroll,
}: CellPointOptions): GridPoint | null => {
  const resolved = metrics ?? captureGridMetrics(gridEl, snapshot, viewportScroll);
  if (!resolved) return null;

  const margin = Math.max(6, resolved.step * 0.5);
  if (
    x < resolved.left - margin
    || x > resolved.right + margin
    || y < resolved.top - margin
    || y > resolved.bottom + margin
  ) {
    return null;
  }
  return snapCellFromMetrics(x, y, resolved);
};

export const snapPathCellFromPoint = ({
  x,
  y,
  snapshot,
  metrics = null,
  gridEl,
  viewportScroll,
}: CellPointOptions): GridPoint | null => {
  const resolved = metrics ?? captureGridMetrics(gridEl, snapshot, viewportScroll);
  if (!resolved) return null;
  return snapCellFromMetrics(x, y, resolved);
};

export const pathCellFromPoint = ({
  x,
  y,
  snapshot,
  metrics = null,
  gridEl,
  layoutMetrics,
  viewportScroll,
}: PathCellPointOptions): GridPoint | null => {
  const resolved = metrics ?? readCachedGridMetrics(layoutMetrics, snapshot, viewportScroll);
  if (resolved) {
    if (
      x < resolved.left
      || x > resolved.right
      || y < resolved.top
      || y > resolved.bottom
    ) {
      return null;
    }
    return snapCellFromMetrics(x, y, resolved);
  }
  return cellFromPoint(x, y);
};

export const wallCellFromPoint = ({
  x,
  y,
  snapshot,
  metrics = null,
  gridEl,
  viewportScroll,
}: CellPointOptions): GridPoint | null => {
  if (metrics) {
    const snapped = snapWallCellFromPoint({
      x,
      y,
      snapshot,
      metrics,
      gridEl,
      viewportScroll,
    });
    if (snapped) return snapped;
  }

  const direct = cellFromPoint(x, y);
  if (direct) return direct;

  return snapWallCellFromPoint({
    x,
    y,
    snapshot,
    metrics,
    gridEl,
    viewportScroll,
  });
};
