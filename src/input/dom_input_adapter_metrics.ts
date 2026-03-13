import type {
  BoardLayoutMetrics,
  ElementLike,
  GameSnapshot,
} from '../contracts/ports.ts';
import {
  getCellSize,
  getGridGap,
  getGridPadding,
} from '../geometry.ts';

export interface GridMetrics extends BoardLayoutMetrics {
  scrollX: number;
  scrollY: number;
}

export interface ViewportScrollState {
  x: number;
  y: number;
}

const getCellSizeTyped = getCellSize as unknown as (scope?: unknown) => number;
const getGridGapTyped = getGridGap as unknown as (gridEl: unknown) => number;
const getGridPaddingTyped = getGridPadding as unknown as (gridEl: unknown) => number;

export const readViewportScroll = (
  windowObj: {
    scrollX?: number;
    scrollY?: number;
    pageXOffset?: number;
    pageYOffset?: number;
  } | undefined = typeof window !== 'undefined' ? window : undefined,
): ViewportScrollState => {
  if (!windowObj) return { x: 0, y: 0 };
  return {
    x: windowObj.scrollX || windowObj.pageXOffset || 0,
    y: windowObj.scrollY || windowObj.pageYOffset || 0,
  };
};

export const syncViewportScrollState = (
  viewportScroll: ViewportScrollState,
  windowObj: {
    scrollX?: number;
    scrollY?: number;
    pageXOffset?: number;
    pageYOffset?: number;
  } | undefined = typeof window !== 'undefined' ? window : undefined,
): ViewportScrollState => {
  const next = readViewportScroll(windowObj);
  viewportScroll.x = next.x;
  viewportScroll.y = next.y;
  return viewportScroll;
};

export const captureGridMetrics = (
  gridEl: ElementLike | null | undefined,
  snapshot: Pick<GameSnapshot, 'rows' | 'cols'> | null | undefined,
  viewportScroll: ViewportScrollState,
): GridMetrics | null => {
  if (!gridEl || !snapshot) return null;
  const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
  const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
  if (rows <= 0 || cols <= 0) return null;

  const rect = gridEl.getBoundingClientRect();
  const size = getCellSizeTyped(gridEl);
  const gap = getGridGapTyped(gridEl);
  const pad = getGridPaddingTyped(gridEl);
  const step = size + gap;
  if (step <= 0) return null;

  return {
    version: 0,
    rows,
    cols,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    size,
    gap,
    step,
    pad,
    scrollX: viewportScroll.x,
    scrollY: viewportScroll.y,
  };
};

export const isUsableGridMetrics = (
  metrics: BoardLayoutMetrics | null | undefined,
  snapshot: Pick<GameSnapshot, 'rows' | 'cols'> | null | undefined,
): metrics is GridMetrics => {
  if (!metrics || !snapshot) return false;
  const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
  const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
  if (rows <= 0 || cols <= 0) return false;
  return (
    metrics.rows === rows
    && metrics.cols === cols
    && Number.isFinite(metrics.left)
    && Number.isFinite(metrics.top)
    && Number.isFinite(metrics.right)
    && Number.isFinite(metrics.bottom)
    && Number.isFinite(metrics.size)
    && Number.isFinite(metrics.step)
    && Number.isFinite(metrics.pad)
    && metrics.step > 0
  );
};

export const readCachedGridMetrics = (
  metrics: BoardLayoutMetrics | null | undefined,
  snapshot: Pick<GameSnapshot, 'rows' | 'cols'> | null | undefined,
  currentScroll: ViewportScrollState,
): GridMetrics | null => {
  if (!isUsableGridMetrics(metrics, snapshot)) return null;

  const sourceScrollX = Number.isFinite(metrics.scrollX) ? metrics.scrollX : currentScroll.x;
  const sourceScrollY = Number.isFinite(metrics.scrollY) ? metrics.scrollY : currentScroll.y;
  const scrollDx = currentScroll.x - sourceScrollX;
  const scrollDy = currentScroll.y - sourceScrollY;
  if (!(scrollDx || scrollDy)) {
    return {
      ...metrics,
      scrollX: sourceScrollX,
      scrollY: sourceScrollY,
    };
  }

  return {
    ...metrics,
    left: metrics.left - scrollDx,
    right: metrics.right - scrollDx,
    top: metrics.top - scrollDy,
    bottom: metrics.bottom - scrollDy,
    scrollX: currentScroll.x,
    scrollY: currentScroll.y,
  };
};

export const resolveDragGridMetrics = ({
  snapshot,
  forceMeasure = false,
  currentDragGridMetrics,
  cachedLayoutMetrics,
  gridEl,
  viewportScroll,
}: {
  snapshot?: Pick<GameSnapshot, 'rows' | 'cols'> | null;
  forceMeasure?: boolean;
  currentDragGridMetrics: GridMetrics | null;
  cachedLayoutMetrics: BoardLayoutMetrics | null | undefined;
  gridEl: ElementLike | null | undefined;
  viewportScroll: ViewportScrollState;
}): GridMetrics | null => {
  const cachedMetrics = readCachedGridMetrics(cachedLayoutMetrics, snapshot ?? null, viewportScroll);
  if (cachedMetrics) return cachedMetrics;
  if (!snapshot) return null;
  if (forceMeasure || !isUsableGridMetrics(currentDragGridMetrics, snapshot)) {
    return captureGridMetrics(gridEl, snapshot, viewportScroll);
  }
  return currentDragGridMetrics;
};
