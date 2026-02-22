export const getCellSize = (scope = document.documentElement) => {
  const source =
    scope && scope instanceof Element ? scope : document.documentElement;

  if (source instanceof Element) {
    const probe =
      source.classList.contains('cell')
        ? source
        : source.querySelector('.cell');
    if (probe) {
      const measured = probe.getBoundingClientRect().width;
      if (Number.isFinite(measured) && measured > 0) return measured;
    }

    const gridEl =
      source.id === 'grid'
        ? source
        : source.querySelector('#grid');
    if (gridEl) {
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
