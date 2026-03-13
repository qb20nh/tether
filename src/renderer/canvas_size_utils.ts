import type {
  CanvasElementLike,
} from '../contracts/ports.ts';

export interface CanvasSizeResolution {
  safeCssWidth: number;
  safeCssHeight: number;
  safeDpr: number;
  pixelWidth: number;
  pixelHeight: number;
  scaleX: number;
  scaleY: number;
}

export const resolveCanvasSize = (
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
): CanvasSizeResolution => {
  const safeCssWidth = Math.max(1, Number(cssWidth) || 1);
  const safeCssHeight = Math.max(1, Number(cssHeight) || 1);
  const safeDpr = Math.max(1, Number(dpr) || 1);
  const pixelWidth = Math.max(1, Math.round(safeCssWidth * safeDpr));
  const pixelHeight = Math.max(1, Math.round(safeCssHeight * safeDpr));

  return {
    safeCssWidth,
    safeCssHeight,
    safeDpr,
    pixelWidth,
    pixelHeight,
    scaleX: pixelWidth / safeCssWidth,
    scaleY: pixelHeight / safeCssHeight,
  };
};

export const applyCanvasElementSize = (
  canvas: CanvasElementLike | null | undefined,
  cssWidth: number,
  cssHeight: number,
  pixelWidth: number | null = null,
  pixelHeight: number | null = null,
): void => {
  if (!canvas) return;

  const nextPixelWidth = Number.isInteger(pixelWidth) ? pixelWidth : null;
  const nextPixelHeight = Number.isInteger(pixelHeight) ? pixelHeight : null;
  if (nextPixelWidth !== null && canvas.width !== nextPixelWidth) canvas.width = nextPixelWidth;
  if (nextPixelHeight !== null && canvas.height !== nextPixelHeight) canvas.height = nextPixelHeight;

  const cssWidthPx = `${Math.max(1, Number(cssWidth) || 1)}px`;
  const cssHeightPx = `${Math.max(1, Number(cssHeight) || 1)}px`;
  if (canvas.style.width !== cssWidthPx) canvas.style.width = cssWidthPx;
  if (canvas.style.height !== cssHeightPx) canvas.style.height = cssHeightPx;
};
