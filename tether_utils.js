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

export const getCellSize = () =>
  parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(), 10) || 56;

export const getGridGap = (gridEl) =>
  parseInt((getComputedStyle(gridEl).gap || '0').trim(), 10) || 0;

export const getGridPadding = (gridEl) =>
  parseInt((getComputedStyle(gridEl).padding || '0').trim(), 10) || 0;

export const cellCenter = (r, c, gridEl) => {
  const size = getCellSize();
  const gap = getGridGap(gridEl);
  const pad = getGridPadding(gridEl);
  return {
    x: pad + c * (size + gap) + size / 2,
    y: pad + r * (size + gap) + size / 2,
  };
};

export const vertexPos = (vr, vc, gridEl) => {
  const size = getCellSize();
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
