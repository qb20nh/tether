export const getCellSize = (scope = document.documentElement) => {
  const source =
    scope && scope instanceof Element ? scope : document.documentElement;

  const parseCellVar = (el) => {
    if (!el || !(el instanceof Element)) return NaN;
    const inlineRaw = el.style.getPropertyValue('--cell').trim();
    const inlineParsed = parseFloat(inlineRaw);
    if (Number.isFinite(inlineParsed) && inlineParsed > 0) return inlineParsed;

    const computedRaw = getComputedStyle(el).getPropertyValue('--cell').trim();
    const computedParsed = parseFloat(computedRaw);
    return Number.isFinite(computedParsed) && computedParsed > 0
      ? computedParsed
      : NaN;
  };

  if (source instanceof Element) {
    const gridEl =
      source.id === 'grid'
        ? source
        : source.querySelector('#grid');
    if (gridEl) {
      const byCssVar = parseCellVar(gridEl);
      if (Number.isFinite(byCssVar) && byCssVar > 0) return byCssVar;

      const styles = getComputedStyle(gridEl);
      const cols = parseFloat(styles.getPropertyValue('--grid-cols').trim()) || 0;
      const gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
      const pad = parseFloat(styles.paddingLeft || styles.padding || '0') || 0;
      if (cols > 0) {
        const gridW = gridEl.getBoundingClientRect().width;
        const inferred = (gridW - pad * 2 - gap * (cols - 1)) / cols;
        if (Number.isFinite(inferred) && inferred > 0) return inferred;
      }
    }

    const bySourceCssVar = parseCellVar(source);
    if (Number.isFinite(bySourceCssVar) && bySourceCssVar > 0) return bySourceCssVar;
  }

  const raw = getComputedStyle(source).getPropertyValue('--cell').trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 56;
};

export const getGridGap = (gridEl) => {
  const styles = getComputedStyle(gridEl);
  return parseFloat((styles.columnGap || styles.gap || '0').trim()) || 0;
};

export const getGridPadding = (gridEl) => {
  const styles = getComputedStyle(gridEl);
  return parseFloat((styles.paddingLeft || styles.padding || '0').trim()) || 0;
};

export const cellCenter = (r, c, gridEl) => {
  const size = getCellSize(gridEl);
  const gap = getGridGap(gridEl);
  const pad = getGridPadding(gridEl);
  return {
    x: pad + c * (size + gap) + size / 2,
    y: pad + r * (size + gap) + size / 2,
  };
};

export const vertexPos = (vr, vc, gridEl) => {
  const size = getCellSize(gridEl);
  const gap = getGridGap(gridEl);
  const pad = getGridPadding(gridEl);
  return {
    x: pad + vc * (size + gap) - gap / 2,
    y: pad + vr * (size + gap) - gap / 2,
  };
};
