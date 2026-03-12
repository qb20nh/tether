export const resolveCanvasSize = (cssWidth, cssHeight, dpr = 1) => {
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

export const applyCanvasElementSize = (canvas, cssWidth, cssHeight, pixelWidth = null, pixelHeight = null) => {
  if (!canvas) return;

  if (Number.isInteger(pixelWidth) && canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (Number.isInteger(pixelHeight) && canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const cssWidthPx = `${Math.max(1, Number(cssWidth) || 1)}px`;
  const cssHeightPx = `${Math.max(1, Number(cssHeight) || 1)}px`;
  if (canvas.style.width !== cssWidthPx) canvas.style.width = cssWidthPx;
  if (canvas.style.height !== cssHeightPx) canvas.style.height = cssHeightPx;
};
