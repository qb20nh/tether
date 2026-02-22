import { isObstacle } from './tether_config.js';

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
      if (!isObstacle(ch)) usable++;
    }
  }

  const cornerCountsRaw = level.cornerCounts || [];
  const seenCornerVertices = new Set();
  const cornerCounts = cornerCountsRaw.map((entry, idx) => {
    if (!Array.isArray(entry) || entry.length < 3) {
      throw new Error(`Invalid cornerCounts entry at index ${idx}`);
    }

    const [vr, vc, count] = entry;
    const isInt = (v) => Number.isInteger(v);
    if (!isInt(vr) || !isInt(vc) || !isInt(count)) {
      throw new Error(`cornerCounts[${idx}] must be [int, int, int]`);
    }

    if (vr < 1 || vr > rows - 1 || vc < 1 || vc > cols - 1) {
      throw new Error(`cornerCounts[${idx}] vertex out of range`);
    }

    if (count < 0 || count > 3) {
      throw new Error(`cornerCounts[${idx}] count must be in 0..3`);
    }

    const vk = keyV(vr, vc);
    if (seenCornerVertices.has(vk)) {
      throw new Error(`Duplicate cornerCounts vertex at ${vk}`);
    }
    seenCornerVertices.add(vk);

    return [vr, vc, count];
  });

  return {
    g,
    rows,
    cols,
    usable,
    stitches: (level.stitches || []).map((p) => [p[0], p[1]]),
    cornerCounts,
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
