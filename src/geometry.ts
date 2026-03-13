const hasPositiveValue = (value: number): boolean => Number.isFinite(value) && value > 0;

const parseCellVar = (el: Element | null | undefined): number => {
  if (!el || !(el instanceof Element)) return Number.NaN;
  const style = (el as Element & {
    style?: { getPropertyValue: (name: string) => string };
  }).style;

  const inlineParsed = Number.parseFloat(style?.getPropertyValue('--cell').trim() || '');
  if (hasPositiveValue(inlineParsed)) return inlineParsed;

  const computedParsed = Number.parseFloat(getComputedStyle(el).getPropertyValue('--cell').trim());
  return hasPositiveValue(computedParsed) ? computedParsed : Number.NaN;
};

const getGridElement = (source: Element | null | undefined): Element | null => {
  if (!(source instanceof Element)) return null;
  return source.id === 'grid' ? source : source.querySelector('#grid');
};

const inferGridCellSize = (gridEl: Element | null): number => {
  if (!gridEl) return Number.NaN;

  const byCssVar = parseCellVar(gridEl);
  if (hasPositiveValue(byCssVar)) return byCssVar;

  const styles = getComputedStyle(gridEl);
  const cols = Number.parseFloat(styles.getPropertyValue('--grid-cols').trim()) || 0;
  if (cols <= 0) return Number.NaN;

  const gap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0;
  const pad = Number.parseFloat(styles.paddingLeft || styles.padding || '0') || 0;
  const gridW = gridEl.getBoundingClientRect().width;
  const inferred = (gridW - pad * 2 - gap * (cols - 1)) / cols;
  return hasPositiveValue(inferred) ? inferred : Number.NaN;
};

export const getCellSize = (
  scope: Element | null | undefined = typeof document !== 'undefined' ? document.documentElement : null,
): number => {
  const source = scope && scope instanceof Element
    ? scope
    : typeof document !== 'undefined'
      ? document.documentElement
      : null;
  if (!source) return 56;
  const byGrid = inferGridCellSize(getGridElement(source));
  if (hasPositiveValue(byGrid)) return byGrid;

  if (source instanceof Element) {
    const bySourceCssVar = parseCellVar(source);
    if (hasPositiveValue(bySourceCssVar)) return bySourceCssVar;
  }

  const raw = getComputedStyle(source).getPropertyValue('--cell').trim();
  const parsed = Number.parseFloat(raw);
  return hasPositiveValue(parsed) ? parsed : 56;
};

export const getGridGap = (gridEl: Element): number => {
  const styles = getComputedStyle(gridEl);
  return Number.parseFloat((styles.columnGap || styles.gap || '0').trim()) || 0;
};

export const getGridPadding = (gridEl: Element): number => {
  const styles = getComputedStyle(gridEl);
  return Number.parseFloat((styles.paddingLeft || styles.padding || '0').trim()) || 0;
};

export const cellCenter = (r: number, c: number, gridEl: Element): { x: number; y: number } => {
  const size = getCellSize(gridEl);
  const gap = getGridGap(gridEl);
  const pad = getGridPadding(gridEl);
  return {
    x: pad + c * (size + gap) + size / 2,
    y: pad + r * (size + gap) + size / 2,
  };
};

export const vertexPos = (vr: number, vc: number, gridEl: Element): { x: number; y: number } => {
  const size = getCellSize(gridEl);
  const gap = getGridGap(gridEl);
  const pad = getGridPadding(gridEl);
  return {
    x: pad + vc * (size + gap) - gap / 2,
    y: pad + vr * (size + gap) - gap / 2,
  };
};
