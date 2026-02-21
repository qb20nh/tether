export const keyOf = (r, c) => `${r},${c}`;
export const keyV = (vr, vc) => `${vr},${vc}`;

export const inBounds = (rows, cols, r, c) => r >= 0 && r < rows && c >= 0 && c < cols;

export const parseLevel = (level) => {
  const g = level.grid.map((row) => row.split(''));
  const rows = g.length;
  const cols = g[0].length;
  let usable = 0;

  for (let r = 0; r < rows; r++) {
    if (g[r].length !== cols) throw new Error('Ragged grid');
    for (let c = 0; c < cols; c++) {
      const ch = g[r][c];
      if (ch !== '#' && ch !== 'm') usable++;
    }
  }

  return { g, rows, cols, usable, stitches: (level.stitches || []).map((p) => [p[0], p[1]]) };
};

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

export const isAdjacentMove = (snapshot, a, b) => {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc === 1) return true;
  if (dr === 1 && dc === 1) {
    const vr = Math.max(a.r, b.r);
    const vc = Math.max(a.c, b.c);
    return snapshot.stitchSet && snapshot.stitchSet.has(keyV(vr, vc));
  }
  return false;
};
