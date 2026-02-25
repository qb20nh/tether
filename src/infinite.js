import { canonicalConstraintFingerprint } from './infinite_canonical.js';
import { INFINITE_OVERRIDE_BY_INDEX } from './infinite_overrides.js';

export const INFINITE_GLOBAL_SEED = 'TETHER_INFINITE_V2';
export const INFINITE_FEATURE_CYCLE = Object.freeze([
  'stitch',
  'movable',
  'corner',
  'rps',
  'hint',
  'mixed',
]);
export const INFINITE_MAX_LEVELS = 30000;
export const INFINITE_CANDIDATE_VARIANTS = 4;
export const MIN_CONSTRAINT_DENSITY = 0.15;
export const MAX_CONSTRAINT_DENSITY = 0.25;
export const MAX_WALL_DENSITY = 0.25;

const HINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v']);
const RPS_CODES = ['g', 'b', 'p'];
const UINT32 = 0x100000000;
const ORTH_DIRS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);

const hashString32 = (input) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const mix32 = (input) => {
  let x = input >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
};

const makeRng = (seedInput) => {
  let state = seedInput >>> 0;
  if (state === 0) state = 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
};

const intFromRng = (rng, maxExclusive) => {
  if (!(maxExclusive > 0)) return 0;
  return Math.floor(rng() * maxExclusive);
};

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

const keyOf = (r, c) => `${r},${c}`;

const edgeKey = (a, b) => {
  const ka = a.r * 1000 + a.c;
  const kb = b.r * 1000 + b.c;
  return ka < kb ? ka * 1000000 + kb : kb * 1000000 + ka;
};

const sortPairs = (pairs) =>
  pairs
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

const sortCornerCounts = (entries) =>
  entries
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));

const sortCells = (cells) =>
  cells
    .slice()
    .sort((a, b) => (a.r - b.r) || (a.c - b.c));

const assertInfiniteIndex = (infiniteIndex) => {
  if (!Number.isInteger(infiniteIndex) || infiniteIndex < 0) {
    throw new Error(`infiniteIndex must be a non-negative integer, got: ${infiniteIndex}`);
  }
  if (infiniteIndex >= INFINITE_MAX_LEVELS) {
    throw new Error(`infiniteIndex out of range: ${infiniteIndex} (max ${INFINITE_MAX_LEVELS - 1})`);
  }
};

const assertVariantId = (variantId) => {
  if (!Number.isInteger(variantId) || variantId < 0) {
    throw new Error(`variantId must be a non-negative integer, got: ${variantId}`);
  }
};

const toGridStrings = (grid) => grid.map((row) => row.join(''));

const pickDistinct = (items, count, rng) => {
  if (!Array.isArray(items) || items.length === 0 || count <= 0) return [];
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = intFromRng(rng, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, Math.min(count, copy.length));
};

const buildFeaturePlan = (requiredFeature, rng) => {
  const plan = {
    hint: true,
    corner: true,
    stitch: false,
    movable: false,
    rps: false,
  };

  if (requiredFeature === 'stitch') {
    plan.stitch = true;
  } else if (requiredFeature === 'movable') {
    plan.movable = true;
  } else if (requiredFeature === 'rps') {
    plan.rps = true;
  } else if (requiredFeature === 'mixed') {
    const coreExtra = pickDistinct(['stitch', 'rps'], 1, rng);
    for (const key of coreExtra) plan[key] = true;
    if (rng() < 0.25) plan.movable = true;
  }

  if (!plan.stitch && rng() < 0.12) plan.stitch = true;
  if (!plan.movable && rng() < 0.08) plan.movable = true;
  if (!plan.rps && rng() < 0.16) plan.rps = true;

  if (plan.rps) plan.hint = true;

  return plan;
};

const chooseDimensions = (rng) => ({
  rows: 5 + intFromRng(rng, 2), // 5..6
  cols: 5 + intFromRng(rng, 2), // 5..6
});

const countMissingCoverage = (counts) => {
  let missing = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] <= 0) missing += 1;
  }
  return missing;
};

const hasFullCoverage = (rowCoverage, colCoverage) =>
  countMissingCoverage(rowCoverage) === 0 && countMissingCoverage(colCoverage) === 0;

const choosePathLength = (rows, cols, requiredFeature, plan, rng) => {
  const total = rows * cols;
  let minFill = 0.78;
  let maxFill = 0.92;

  switch (requiredFeature) {
    case 'movable':
      minFill = 0.75;
      maxFill = 0.86;
      break;
    case 'stitch':
      minFill = 0.77;
      maxFill = 0.90;
      break;
    case 'mixed':
      minFill = 0.75;
      maxFill = 0.88;
      break;
    case 'hint':
      minFill = 0.80;
      maxFill = 0.94;
      break;
    case 'rps':
      minFill = 0.78;
      maxFill = 0.90;
      break;
    case 'corner':
      minFill = 0.77;
      maxFill = 0.92;
      break;
    default:
      break;
  }

  if (plan.movable) {
    minFill = Math.max(0.75, minFill - 0.02);
    maxFill = Math.max(minFill, maxFill - 0.02);
  }

  const minCoverage = rows + cols - 1;
  const minCellsByWallBudget = Math.ceil(total * (1 - MAX_WALL_DENSITY));
  let minCells = Math.max(minCoverage, 14, minCellsByWallBudget, Math.ceil(total * minFill));
  let maxCells = Math.min(total, Math.max(minCells, Math.floor(total * maxFill)));

  if (maxCells < minCells) maxCells = minCells;
  return minCells + intFromRng(rng, maxCells - minCells + 1);
};

const buildRandomOrthPath = (rows, cols, targetLen, rng) => {
  const total = rows * cols;
  if (!Number.isInteger(targetLen) || targetLen < rows + cols - 1 || targetLen > total) return null;

  const maxAttempts = 20;
  const maxNodeBudget = 9000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = { r: intFromRng(rng, rows), c: intFromRng(rng, cols) };
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const rowCoverage = Array(rows).fill(0);
    const colCoverage = Array(cols).fill(0);
    const path = [start];
    let nodeCount = 0;

    visited[start.r][start.c] = true;
    rowCoverage[start.r] += 1;
    colCoverage[start.c] += 1;

    const dfs = () => {
      nodeCount += 1;
      if (nodeCount > maxNodeBudget) return false;

      const depth = path.length;
      const remaining = targetLen - depth;

      const missingRows = countMissingCoverage(rowCoverage);
      const missingCols = countMissingCoverage(colCoverage);
      if (missingRows > remaining || missingCols > remaining) return false;

      if (depth === targetLen) {
        return hasFullCoverage(rowCoverage, colCoverage);
      }

      const cur = path[depth - 1];
      const candidates = [];
      for (const [dr, dc] of ORTH_DIRS) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (visited[nr][nc]) continue;

        const rowNovel = rowCoverage[nr] === 0 ? 1 : 0;
        const colNovel = colCoverage[nc] === 0 ? 1 : 0;
        const remainingAfter = remaining - 1;
        if ((missingRows - rowNovel) > remainingAfter || (missingCols - colNovel) > remainingAfter) {
          continue;
        }

        let onward = 0;
        for (const [ndr, ndc] of ORTH_DIRS) {
          const ar = nr + ndr;
          const ac = nc + ndc;
          if (ar < 0 || ar >= rows || ac < 0 || ac >= cols) continue;
          if (!visited[ar][ac] && !(ar === cur.r && ac === cur.c)) onward += 1;
        }

        candidates.push({
          r: nr,
          c: nc,
          onward,
          score: ((rowNovel + colNovel) * 10) + ((4 - onward) * 2) + rng(),
        });
      }

      if (candidates.length === 0) return false;
      candidates.sort((a, b) => (b.score - a.score) || (a.onward - b.onward));

      for (const candidate of candidates) {
        visited[candidate.r][candidate.c] = true;
        rowCoverage[candidate.r] += 1;
        colCoverage[candidate.c] += 1;
        path.push({ r: candidate.r, c: candidate.c });

        if (dfs()) return true;

        path.pop();
        rowCoverage[candidate.r] -= 1;
        colCoverage[candidate.c] -= 1;
        visited[candidate.r][candidate.c] = false;
      }

      return false;
    };

    if (dfs()) return path;
  }

  return null;
};

const buildSnakePath = (top, left, activeRows, activeCols) => {
  const path = [];
  for (let rr = 0; rr < activeRows; rr++) {
    const r = top + rr;
    if (rr % 2 === 0) {
      for (let cc = 0; cc < activeCols; cc++) {
        path.push({ r, c: left + cc });
      }
    } else {
      for (let cc = activeCols - 1; cc >= 0; cc--) {
        path.push({ r, c: left + cc });
      }
    }
  }
  return path;
};

const describeTransitions = (path) => {
  const transitions = [];
  if (!Array.isArray(path) || path.length < 4) return transitions;

  for (let start = 0; start <= path.length - 4; start++) {
    const p0 = path[start];
    const p1 = path[start + 1];
    const p2 = path[start + 2];
    const p3 = path[start + 3];

    const orth01 = Math.abs(p0.r - p1.r) + Math.abs(p0.c - p1.c) === 1;
    const orth12 = Math.abs(p1.r - p2.r) + Math.abs(p1.c - p2.c) === 1;
    const orth23 = Math.abs(p2.r - p3.r) + Math.abs(p2.c - p3.c) === 1;
    if (!orth01 || !orth12 || !orth23) continue;

    const minR = Math.min(p0.r, p1.r, p2.r, p3.r);
    const maxR = Math.max(p0.r, p1.r, p2.r, p3.r);
    const minC = Math.min(p0.c, p1.c, p2.c, p3.c);
    const maxC = Math.max(p0.c, p1.c, p2.c, p3.c);
    if (maxR - minR !== 1 || maxC - minC !== 1) continue;

    const uniqueCells = new Set([
      keyOf(p0.r, p0.c),
      keyOf(p1.r, p1.c),
      keyOf(p2.r, p2.c),
      keyOf(p3.r, p3.c),
    ]);
    if (uniqueCells.size !== 4) continue;

    transitions.push({
      start,
      stitchVertex: [minR + 1, minC + 1],
    });
  }

  return transitions;
};

const pickStitchTransitions = (transitions, wantedCount, rng) => {
  if (!Array.isArray(transitions) || transitions.length === 0 || wantedCount <= 0) return [];
  const shuffled = pickDistinct(transitions, transitions.length, rng);
  const selected = [];

  for (const candidate of shuffled) {
    let overlaps = false;
    for (let i = 0; i < selected.length; i++) {
      if (Math.abs(candidate.start - selected[i].start) < 4) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    selected.push(candidate);
    if (selected.length >= wantedCount) break;
  }

  selected.sort((a, b) => a.start - b.start);
  return selected;
};

const collectStitchVerticesFromPath = (path) => {
  const stitchKeys = new Set();
  const stitches = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    if (dr + dc === 1) continue;
    if (dr === 1 && dc === 1) {
      const vr = Math.max(a.r, b.r);
      const vc = Math.max(a.c, b.c);
      const k = `${vr},${vc}`;
      if (!stitchKeys.has(k)) {
        stitchKeys.add(k);
        stitches.push([vr, vc]);
      }
      continue;
    }
    return {
      stitches: [],
      invalidStep: {
        index: i,
        from: [a.r, a.c],
        to: [b.r, b.c],
      },
    };
  }
  return {
    stitches: sortPairs(stitches),
    invalidStep: null,
  };
};

const applyStitchTransitions = (path, selectedTransitions) => {
  if (!selectedTransitions || selectedTransitions.length === 0) return;
  for (const transition of selectedTransitions) {
    const i = transition.start;
    const tmp = path[i + 1];
    path[i + 1] = path[i + 2];
    path[i + 2] = tmp;
  }
};

const buildOrthEdgeSet = (path) => {
  const edges = new Set();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    if (dr + dc !== 1) continue;
    edges.add(edgeKey(a, b));
  }
  return edges;
};

const countCornerOrthConnections = (vr, vc, orthEdges) => {
  const nw = { r: vr - 1, c: vc - 1 };
  const ne = { r: vr - 1, c: vc };
  const sw = { r: vr, c: vc - 1 };
  const se = { r: vr, c: vc };

  let count = 0;
  if (orthEdges.has(edgeKey(nw, ne))) count++;
  if (orthEdges.has(edgeKey(nw, sw))) count++;
  if (orthEdges.has(edgeKey(ne, se))) count++;
  if (orthEdges.has(edgeKey(sw, se))) count++;
  return count;
};

const isWallCell = (grid, r, c) => {
  if (!Array.isArray(grid) || !Array.isArray(grid[r])) return false;
  const ch = grid[r][c];
  return ch === '#' || ch === 'm';
};

const cornerWallStats = (grid, vr, vc) => {
  const nw = isWallCell(grid, vr - 1, vc - 1);
  const ne = isWallCell(grid, vr - 1, vc);
  const sw = isWallCell(grid, vr, vc - 1);
  const se = isWallCell(grid, vr, vc);

  const wallCount = (nw ? 1 : 0) + (ne ? 1 : 0) + (sw ? 1 : 0) + (se ? 1 : 0);
  const hasDiagonalWalls = (nw && se) || (ne && sw);

  let maxPossible = 0;
  if (!nw && !ne) maxPossible += 1;
  if (!nw && !sw) maxPossible += 1;
  if (!ne && !se) maxPossible += 1;
  if (!sw && !se) maxPossible += 1;

  return {
    wallCount,
    hasDiagonalWalls,
    maxPossible,
  };
};

const isUnsatisfiableCornerConstraint = (grid, vr, vc, count) => {
  const stats = cornerWallStats(grid, vr, vc);
  if (stats.wallCount > 3) return true;
  if (count === 0 && stats.hasDiagonalWalls) return true;
  if (count > stats.maxPossible) return true;
  return false;
};

const getHintChoicesAtIndex = (path, index) => {
  if (index <= 0 || index >= path.length - 1) return [];

  const prev = path[index - 1];
  const cur = path[index];
  const next = path[index + 1];

  const vin = { dr: cur.r - prev.r, dc: cur.c - prev.c };
  const vout = { dr: next.r - cur.r, dc: next.c - cur.c };

  const straight = vin.dr === vout.dr && vin.dc === vout.dc;
  const isHoriz = vin.dr === 0 && vout.dr === 0;
  const isVert = vin.dc === 0 && vout.dc === 0;

  const z = vin.dc * vout.dr - vin.dr * vout.dc;
  const cw = z > 0;
  const ccw = z < 0;

  const out = [];
  if (!straight) out.push('t');
  if (!straight && cw) out.push('r');
  if (!straight && ccw) out.push('l');
  if (straight) out.push('s');
  if (straight && isHoriz) out.push('h');
  if (straight && isVert) out.push('v');
  return out;
};

const rotateRps = (start, steps) => {
  const idx = RPS_CODES.indexOf(start);
  if (idx < 0) return 'g';
  return RPS_CODES[(idx + (steps % 3)) % 3];
};

const analyzeFeatures = (level) => {
  let hasHint = false;
  let hasRps = false;
  let hasMovable = false;
  let hintCount = 0;
  let rpsCount = 0;
  let wallCount = 0;
  let cellConstraintCount = 0;

  for (const row of level.grid) {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '#' || ch === 'm') wallCount += 1;
      if (HINT_CODES.has(ch)) {
        hasHint = true;
        hintCount += 1;
        cellConstraintCount += 1;
      }
      if (RPS_CODES.includes(ch)) {
        hasRps = true;
        rpsCount += 1;
        cellConstraintCount += 1;
      }
      if (ch === 'm') hasMovable = true;
    }
  }

  const rows = level.grid.length;
  const cols = rows > 0 ? level.grid[0].length : 0;
  const totalCells = rows * cols;
  const nonWallCellCount = Math.max(0, totalCells - wallCount);
  const hasStitch = (level.stitches || []).length > 0;
  const hasCorner = (level.cornerCounts || []).length > 0;
  const stitchCount = (level.stitches || []).length;
  const cornerCount = (level.cornerCounts || []).length;
  const constraintTokenCount = cellConstraintCount + stitchCount + cornerCount;
  const featureCount = [hasStitch, hasMovable, hasCorner, hasRps, hasHint].filter(Boolean).length;

  return {
    stitch: hasStitch,
    movable: hasMovable,
    corner: hasCorner,
    rps: hasRps,
    hint: hasHint,
    hintCount,
    rpsCount,
    featureCount,
    wallCount,
    nonWallCellCount,
    cellConstraintCount,
    constraintTokenCount,
  };
};

const constraintDensity = (level, features = analyzeFeatures(level)) => {
  const denom = features.nonWallCellCount;
  if (!(denom > 0)) return 0;
  return features.constraintTokenCount / denom;
};

const wallDensity = (level, features = analyzeFeatures(level)) => {
  const rows = level.grid.length;
  const cols = rows > 0 ? level.grid[0].length : 0;
  const total = rows * cols;
  if (!(total > 0)) return 0;
  return features.wallCount / total;
};

const enforceMinimumFeatures = (grid, path, rng, options = {}) => {
  const {
    minHints = 2,
    requireRps = false,
    rpsCount = 0,
    occupied = new Set(),
  } = options;

  const pathIndices = [];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    const k = keyOf(p.r, p.c);
    if (!occupied.has(k) && grid[p.r][p.c] === '.') {
      pathIndices.push(i);
    }
  }

  let targetRps = Math.max(0, rpsCount);
  if (requireRps) targetRps = Math.max(2, targetRps);
  if (targetRps === 1) targetRps = 2;

  if (targetRps > 0) {
    const picks = pickDistinct(pathIndices, Math.min(targetRps, pathIndices.length), rng)
      .sort((a, b) => a - b);
    const start = RPS_CODES[intFromRng(rng, RPS_CODES.length)];
    for (let i = 0; i < picks.length; i++) {
      const p = path[picks[i]];
      grid[p.r][p.c] = rotateRps(start, i);
      occupied.add(keyOf(p.r, p.c));
    }
  }

  let hintPlaced = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    if (HINT_CODES.has(grid[p.r][p.c])) hintPlaced += 1;
  }

  if (hintPlaced < minHints) {
    const candidates = [];
    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i];
      const k = keyOf(p.r, p.c);
      if (occupied.has(k)) continue;
      if (grid[p.r][p.c] !== '.') continue;
      const choices = getHintChoicesAtIndex(path, i);
      if (choices.length === 0) continue;
      candidates.push({ i, choices });
    }

    const needed = Math.min(candidates.length, minHints - hintPlaced);
    const selected = pickDistinct(candidates, needed, rng);
    for (const entry of selected) {
      const choice = entry.choices[intFromRng(rng, entry.choices.length)];
      const p = path[entry.i];
      grid[p.r][p.c] = choice;
      occupied.add(keyOf(p.r, p.c));
      hintPlaced += 1;
    }
  }
};

const buildCornerCounts = (
  rows,
  cols,
  orthEdges,
  rng,
  requiredFeature,
  forbiddenVertices = new Set(),
  grid = null,
) => {
  const candidates = [];
  for (let vr = 1; vr < rows; vr++) {
    for (let vc = 1; vc < cols; vc++) {
      const vk = `${vr},${vc}`;
      if (forbiddenVertices.has(vk)) continue;
      const count = countCornerOrthConnections(vr, vc, orthEdges);
      if (count < 0 || count > 3) continue;
      if (isUnsatisfiableCornerConstraint(grid, vr, vc, count)) continue;
      candidates.push([vr, vc, count]);
    }
  }

  if (candidates.length === 0) return [];

  const zeroCandidates = candidates.filter((entry) => entry[2] === 0);
  const nonZeroCandidates = candidates.filter((entry) => entry[2] !== 0);

  let targetCount = 1 + intFromRng(rng, 2);
  if (requiredFeature === 'corner') targetCount = 2 + intFromRng(rng, 2);
  targetCount = Math.min(targetCount, 4, candidates.length);

  const picked = [];
  const used = new Set();

  const addEntry = (entry) => {
    const k = `${entry[0]},${entry[1]}`;
    if (used.has(k)) return;
    used.add(k);
    picked.push(entry);
  };

  if (zeroCandidates.length > 0 && (requiredFeature === 'corner' || rng() < 0.25)) {
    addEntry(zeroCandidates[intFromRng(rng, zeroCandidates.length)]);
  }

  const primaryPool = nonZeroCandidates.length > 0 ? nonZeroCandidates : candidates;
  const primaryNeeded = Math.max(0, targetCount - picked.length);
  for (const entry of pickDistinct(primaryPool, primaryNeeded, rng)) {
    addEntry(entry);
  }

  if (picked.length < targetCount) {
    for (const entry of pickDistinct(candidates, targetCount - picked.length, rng)) {
      addEntry(entry);
    }
  }

  return sortCornerCounts(picked);
};

const findFallbackCornerCount = (
  rows,
  cols,
  orthEdges,
  forbiddenVertices = new Set(),
  grid = null,
) => {
  for (let vr = 1; vr < rows; vr++) {
    for (let vc = 1; vc < cols; vc++) {
      const vk = `${vr},${vc}`;
      if (forbiddenVertices.has(vk)) continue;
      const count = countCornerOrthConnections(vr, vc, orthEdges);
      if (count < 0 || count > 3) continue;
      if (isUnsatisfiableCornerConstraint(grid, vr, vc, count)) continue;
      return [vr, vc, count];
    }
  }
  return null;
};

const removeArrayAt = (arr, index) => {
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) return false;
  arr.splice(index, 1);
  return true;
};

const enforceConstraintDensityBand = (grid, path, stitches, cornerCounts, requiredFeature, rng) => {
  const minHints = requiredFeature === 'hint' ? 3 : (requiredFeature === 'rps' ? 2 : 1);
  const minRps = requiredFeature === 'rps' ? 2 : 0;
  const minCorners = 1;

  const snapshot = () => {
    let hintCount = 0;
    let rpsCount = 0;
    let wallCount = 0;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const ch = grid[r][c];
        if (ch === '#' || ch === 'm') wallCount += 1;
        if (HINT_CODES.has(ch)) hintCount += 1;
        if (RPS_CODES.includes(ch)) rpsCount += 1;
      }
    }
    const total = grid.length * (grid[0]?.length || 0);
    const nonWall = Math.max(0, total - wallCount);
    const tokenCount = hintCount + rpsCount + stitches.length + cornerCounts.length;
    const density = nonWall > 0 ? tokenCount / nonWall : 0;
    return {
      hintCount,
      rpsCount,
      wallCount,
      nonWall,
      tokenCount,
      density,
    };
  };

  for (let iter = 0; iter < 256; iter++) {
    const state = snapshot();
    if (state.density >= MIN_CONSTRAINT_DENSITY && state.density <= MAX_CONSTRAINT_DENSITY) return true;

    if (state.density > MAX_CONSTRAINT_DENSITY) {
      let changed = false;

      const removableHints = [];
      for (let i = 1; i < path.length - 1; i++) {
        const p = path[i];
        if (HINT_CODES.has(grid[p.r][p.c])) removableHints.push(p);
      }
      if (removableHints.length > minHints) {
        const pick = removableHints[intFromRng(rng, removableHints.length)];
        grid[pick.r][pick.c] = '.';
        changed = true;
      } else if (cornerCounts.length > minCorners) {
        changed = removeArrayAt(cornerCounts, intFromRng(rng, cornerCounts.length));
      } else {
        const rpsPathIndices = [];
        for (let i = 1; i < path.length - 1; i++) {
          const p = path[i];
          if (RPS_CODES.includes(grid[p.r][p.c])) rpsPathIndices.push(i);
        }

        const rpsCount = rpsPathIndices.length;
        if (rpsCount > minRps) {
          if (rpsCount === 2 && minRps === 0) {
            const a = path[rpsPathIndices[0]];
            const b = path[rpsPathIndices[1]];
            grid[a.r][a.c] = '.';
            grid[b.r][b.c] = '.';
            changed = true;
          } else if (rpsCount - 1 >= minRps && rpsCount - 1 !== 1) {
            const removeFromStart = rng() < 0.5;
            const removeIndex = removeFromStart ? rpsPathIndices[0] : rpsPathIndices[rpsCount - 1];
            const p = path[removeIndex];
            grid[p.r][p.c] = '.';
            changed = true;
          }
        }
      }

      if (!changed) return false;
      continue;
    }

    const addableHints = [];
    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i];
      if (grid[p.r][p.c] !== '.') continue;
      const choices = getHintChoicesAtIndex(path, i);
      if (choices.length === 0) continue;
      addableHints.push({ p, choices });
    }
    if (addableHints.length === 0) return false;
    const picked = addableHints[intFromRng(rng, addableHints.length)];
    grid[picked.p.r][picked.p.c] = picked.choices[intFromRng(rng, picked.choices.length)];
  }

  return false;
};

const chooseMovableCount = (requiredFeature, plan, wallCellCount, rng) => {
  if (!plan.movable || wallCellCount <= 0) return 0;
  const maxMovable = Math.min(2, wallCellCount);
  if (maxMovable <= 1) return 1;
  if (requiredFeature === 'movable') return rng() < 0.7 ? 2 : 1;
  return rng() < 0.2 ? 2 : 1;
};

const scrambleMovableStartPositions = (grid, path, solvedMovableCells, rng) => {
  if (!Array.isArray(solvedMovableCells) || solvedMovableCells.length === 0) return false;

  const solvedKeySet = new Set(solvedMovableCells.map((cell) => keyOf(cell.r, cell.c)));
  const openPathCells = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (grid[p.r][p.c] !== '.') continue;
    const k = keyOf(p.r, p.c);
    if (solvedKeySet.has(k)) continue;
    openPathCells.push({ r: p.r, c: p.c });
  }
  if (openPathCells.length === 0) return false;

  const sourceOrder = pickDistinct(solvedMovableCells, solvedMovableCells.length, rng);
  const targetOrder = pickDistinct(openPathCells, openPathCells.length, rng);

  for (let i = 0; i < sourceOrder.length; i++) {
    const source = sourceOrder[i];
    if (grid[source.r][source.c] !== 'm') continue;

    for (let j = 0; j < targetOrder.length; j++) {
      const target = targetOrder[j];
      if (grid[target.r][target.c] !== '.') continue;
      if (source.r === target.r && source.c === target.c) continue;

      grid[source.r][source.c] = '.';
      grid[target.r][target.c] = 'm';
      return true;
    }
  }

  return false;
};

const buildPathForLevel = (rows, cols, requiredFeature, plan, rng) => {
  const total = rows * cols;
  const minLen = Math.max(rows + cols - 1, 14, Math.ceil(total * (1 - MAX_WALL_DENSITY)));
  const maxLen = total;
  const targetLen = choosePathLength(rows, cols, requiredFeature, plan, rng);
  const needsStitchTransition = requiredFeature === 'stitch' || plan.stitch;

  const jitterSequence = [0, 1, -1, 2, -2, 3, -3, 4, -4];
  let fallbackPath = null;
  let fallbackTransitions = [];

  for (let attempt = 0; attempt < jitterSequence.length * 2; attempt++) {
    const jitter = jitterSequence[attempt % jitterSequence.length];
    const candidateLen = clamp(targetLen + jitter, minLen, maxLen);
    const candidatePath = buildRandomOrthPath(rows, cols, candidateLen, rng);
    if (!candidatePath) continue;

    const candidateTransitions = describeTransitions(candidatePath);
    if (!fallbackPath) {
      fallbackPath = candidatePath;
      fallbackTransitions = candidateTransitions;
    }

    if (!needsStitchTransition || candidateTransitions.length > 0) {
      return {
        path: candidatePath,
        transitions: candidateTransitions,
      };
    }
  }

  if (fallbackPath) {
    return {
      path: fallbackPath,
      transitions: fallbackTransitions,
    };
  }

  const snakePath = buildSnakePath(0, 0, rows, cols);
  return {
    path: snakePath,
    transitions: describeTransitions(snakePath),
  };
};

const createCoreLevel = (infiniteIndex, variantId) => {
  assertInfiniteIndex(infiniteIndex);
  assertVariantId(variantId);

  const requiredFeature = INFINITE_FEATURE_CYCLE[infiniteIndex % INFINITE_FEATURE_CYCLE.length];
  const seed = mix32(hashString32(`${INFINITE_GLOBAL_SEED}:${infiniteIndex}:variant:${variantId}`));
  const rng = makeRng(seed);

  const plan = buildFeaturePlan(requiredFeature, rng);
  const dims = chooseDimensions(rng);

  const { rows, cols } = dims;
  const { path, transitions } = buildPathForLevel(rows, cols, requiredFeature, plan, rng);
  const grid = Array.from({ length: rows }, () => Array(cols).fill('#'));
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    grid[p.r][p.c] = '.';
  }

  const wallCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === '#') wallCells.push({ r, c });
    }
  }

  let solvedMovableCells = [];
  if (plan.movable && wallCells.length > 0) {
    const movableCount = chooseMovableCount(requiredFeature, plan, wallCells.length, rng);
    solvedMovableCells = pickDistinct(wallCells, movableCount, rng);
    for (const cell of solvedMovableCells) {
      grid[cell.r][cell.c] = 'm';
    }
  }

  let stitchTransitions = [];
  if (plan.stitch && transitions.length > 0) {
    const wanted = 1 + intFromRng(rng, Math.min(2, transitions.length));
    stitchTransitions = pickStitchTransitions(transitions, wanted, rng);
  } else if (requiredFeature === 'stitch' && transitions.length > 0) {
    stitchTransitions = pickStitchTransitions(transitions, 1, rng);
  }

  applyStitchTransitions(path, stitchTransitions);
  const stitchCollect = collectStitchVerticesFromPath(path);
  if (stitchCollect.invalidStep) {
    throw new Error(
      `Invalid witness step after stitch transform at infinite index ${infiniteIndex} variant ${variantId}`
      + ` step ${stitchCollect.invalidStep.index} from ${stitchCollect.invalidStep.from.join(',')}`
      + ` to ${stitchCollect.invalidStep.to.join(',')}`,
    );
  }
  let stitches = stitchCollect.stitches;
  const stitchVertexSet = new Set(stitches.map(([vr, vc]) => `${vr},${vc}`));

  const occupied = new Set();
  let requestedRps = 0;
  if (plan.rps) {
    requestedRps = 2 + intFromRng(rng, 2);
  }

  enforceMinimumFeatures(grid, path, rng, {
    minHints:
      requiredFeature === 'hint'
        ? 3
        : (requiredFeature === 'rps' ? 2 : 1),
    requireRps: plan.rps,
    rpsCount: requestedRps,
    occupied,
  });

  if (solvedMovableCells.length > 0) {
    const scrambled = scrambleMovableStartPositions(grid, path, solvedMovableCells, rng);
    if (!scrambled) {
      throw new Error(
        `Failed to scramble movable start positions for infinite index ${infiniteIndex} variant ${variantId}`,
      );
    }
  }

  const orthEdges = buildOrthEdgeSet(path);
  let cornerCounts = buildCornerCounts(rows, cols, orthEdges, rng, requiredFeature, stitchVertexSet, grid);

  if (!enforceConstraintDensityBand(grid, path, stitches, cornerCounts, requiredFeature, rng)) {
    throw new Error(
      `Failed to enforce constraint density band for infinite index ${infiniteIndex} variant ${variantId}`,
    );
  }

  stitches = sortPairs(stitches);
  cornerCounts = sortCornerCounts(cornerCounts);

  const level = {
    grid: toGridStrings(grid),
    stitches,
    cornerCounts,
  };

  const features = analyzeFeatures(level);
  const density = constraintDensity(level, features);
  const walls = wallDensity(level, features);

  if (!features.corner && level.cornerCounts.length === 0) {
    const fallback = findFallbackCornerCount(rows, cols, orthEdges, stitchVertexSet, grid);
    if (!fallback) {
      throw new Error(`No available non-stitch corner vertex for index ${infiniteIndex} variant ${variantId}`);
    }
    level.cornerCounts = [fallback];
  }

  if (requiredFeature === 'stitch' && level.stitches.length === 0) {
    throw new Error(`Failed to create stitch constraints for infinite index ${infiniteIndex} variant ${variantId}`);
  }
  if (requiredFeature === 'movable' && !features.movable) {
    throw new Error(`Failed to create movable walls for infinite index ${infiniteIndex} variant ${variantId}`);
  }
  if (requiredFeature === 'rps' && features.rpsCount < 2) {
    throw new Error(`Failed to create RPS chain for infinite index ${infiniteIndex} variant ${variantId}`);
  }
  if (requiredFeature === 'rps' && features.hintCount < 2) {
    throw new Error(`Insufficient hints for RPS index ${infiniteIndex} variant ${variantId}`);
  }
  if (features.featureCount < 2) {
    throw new Error(`Insufficient feature families for infinite index ${infiniteIndex} variant ${variantId}`);
  }
  if (features.rpsCount === 1) {
    throw new Error(`Singleton RPS chain at infinite index ${infiniteIndex} variant ${variantId}`);
  }
  if (walls > MAX_WALL_DENSITY) {
    throw new Error(
      `Wall density too high (${walls.toFixed(3)}) for infinite index ${infiniteIndex} variant ${variantId}`,
    );
  }
  if (density < MIN_CONSTRAINT_DENSITY || density > MAX_CONSTRAINT_DENSITY) {
    throw new Error(
      `Constraint density out of bounds (${density.toFixed(3)}) for infinite index ${infiniteIndex} variant ${variantId}`,
    );
  }

  const profileId = (rows * 10000) + (cols * 1000) + (path.length * 10) + Math.min(9, stitches.length);

  const witnessPath = path.map((p) => [p.r, p.c]);
  const witnessMovableWalls = sortCells(solvedMovableCells).map((cell) => [cell.r, cell.c]);

  return {
    level,
    meta: {
      requiredFeature,
      seed,
      profileId,
      variantId,
      witnessPath,
      witnessMovableWalls,
    },
  };
};

const decorateInfiniteLevel = (infiniteIndex, core) => {
  const displayIndex = infiniteIndex + 1;
  const requiredFeature = core.meta.requiredFeature;

  return {
    name: `Infinite ${displayIndex}`,
    nameKey: `level.infinite.${displayIndex}.name`,
    grid: core.level.grid,
    stitches: core.level.stitches,
    cornerCounts: core.level.cornerCounts,
    infiniteMeta: {
      isInfinite: true,
      index: infiniteIndex,
      variantId: core.meta.variantId,
      requiredFeature,
      baseLevelIndex: core.meta.profileId,
      witnessPath: core.meta.witnessPath,
      witnessMovableWalls: core.meta.witnessMovableWalls,
    },
  };
};

export const generateInfiniteLevelFromVariant = (infiniteIndex, variantId) =>
  decorateInfiniteLevel(infiniteIndex, createCoreLevel(infiniteIndex, variantId));

const summarizeStyle = (level) => {
  const rows = level.grid.length;
  const cols = rows > 0 ? level.grid[0].length : 0;
  let walls = 0;
  let movable = 0;
  let hints = 0;
  let rps = 0;
  for (const row of level.grid) {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '#') walls++;
      else if (ch === 'm') movable++;
      if (HINT_CODES.has(ch)) hints++;
      if (RPS_CODES.includes(ch)) rps++;
    }
  }
  let cornerZero = 0;
  for (const entry of level.cornerCounts || []) {
    if (entry[2] === 0) cornerZero++;
  }

  return {
    rows,
    cols,
    walls,
    movable,
    hints,
    rps,
    stitches: (level.stitches || []).length,
    corners: (level.cornerCounts || []).length,
    cornerZero,
  };
};

const buildStyleTarget = (infiniteIndex, requiredFeature) => {
  const seed = mix32(hashString32(`${INFINITE_GLOBAL_SEED}:style:${infiniteIndex}:${requiredFeature}`));
  const rows = 5 + ((seed >>> 0) % 2);
  const cols = 5 + ((seed >>> 1) % 2);
  const walls = 2 + ((seed >>> 2) % 11);
  const hints = 3 + ((seed >>> 6) % 4);
  const rps = (seed >>> 9) % 4;
  const stitches = (seed >>> 12) % 3;
  const corners = 1 + ((seed >>> 14) % 5);
  const cornerZero = (seed >>> 17) % 3;
  const movable = (seed >>> 19) % 2;
  return {
    rows,
    cols,
    walls,
    hints,
    rps,
    stitches,
    corners,
    cornerZero,
    movable,
  };
};

const styleFitnessScore = (style, target, requiredFeature) => {
  let score = 0;
  score -= Math.abs(style.rows - target.rows) * 24;
  score -= Math.abs(style.cols - target.cols) * 24;
  score -= Math.abs(style.walls - target.walls) * 6;
  score -= Math.abs(style.hints - target.hints) * 8;
  score -= Math.abs(style.rps - target.rps) * 9;
  score -= Math.abs(style.stitches - target.stitches) * 16;
  score -= Math.abs(style.corners - target.corners) * 12;
  score -= Math.abs(style.cornerZero - target.cornerZero) * 14;
  score -= Math.abs(style.movable - target.movable) * 22;

  if (requiredFeature === 'stitch' && style.stitches <= 0) score -= 800;
  if (requiredFeature === 'movable' && style.movable <= 0) score -= 800;
  if (requiredFeature === 'corner' && style.corners <= 0) score -= 800;
  if (requiredFeature === 'rps' && style.rps < 2) score -= 800;
  if (requiredFeature === 'hint' && style.hints < 3) score -= 800;
  if (requiredFeature === 'mixed' && ((style.stitches > 0 ? 1 : 0) + (style.movable > 0 ? 1 : 0) + (style.rps > 0 ? 1 : 0)) < 1) {
    score -= 400;
  }

  return score;
};

export const selectDefaultInfiniteCandidate = (infiniteIndex) => {
  assertInfiniteIndex(infiniteIndex);
  const requiredFeature = INFINITE_FEATURE_CYCLE[infiniteIndex % INFINITE_FEATURE_CYCLE.length];
  const targetStyle = buildStyleTarget(infiniteIndex, requiredFeature);

  let best = null;
  let firstError = null;

  for (let variantId = 0; variantId < INFINITE_CANDIDATE_VARIANTS; variantId++) {
    try {
      const level = generateInfiniteLevelFromVariant(infiniteIndex, variantId);
      const canonical = canonicalConstraintFingerprint(level);
      const style = summarizeStyle(level);
      const score = styleFitnessScore(style, targetStyle, requiredFeature);
      const rank = mix32(hashString32(`${INFINITE_GLOBAL_SEED}:rank:${infiniteIndex}:${canonical.key}:${score}`));
      if (
        !best
        || score > best.score
        || (score === best.score && rank < best.rank)
        || (score === best.score && rank === best.rank && variantId < best.variantId)
      ) {
        best = {
          variantId,
          level,
          canonicalSignature: canonical.signature,
          canonicalKey: canonical.key,
          score,
          rank,
        };
      }
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }

  if (!best) {
    throw (firstError || new Error(`Unable to materialize default variants for infinite level ${infiniteIndex}`));
  }

  return best;
};

export const selectDefaultInfiniteVariant = (infiniteIndex) =>
  selectDefaultInfiniteCandidate(infiniteIndex).variantId;

const LEVEL_CACHE_LIMIT = 256;
const generatedLevelCache = new Map();

const getCachedLevel = (infiniteIndex) => {
  if (!generatedLevelCache.has(infiniteIndex)) return null;
  const value = generatedLevelCache.get(infiniteIndex);
  generatedLevelCache.delete(infiniteIndex);
  generatedLevelCache.set(infiniteIndex, value);
  return value;
};

const setCachedLevel = (infiniteIndex, level) => {
  if (generatedLevelCache.has(infiniteIndex)) {
    generatedLevelCache.delete(infiniteIndex);
  }
  generatedLevelCache.set(infiniteIndex, level);
  while (generatedLevelCache.size > LEVEL_CACHE_LIMIT) {
    const oldest = generatedLevelCache.keys().next().value;
    generatedLevelCache.delete(oldest);
  }
};

const resolveOverrideVariantId = (infiniteIndex) => {
  const override = INFINITE_OVERRIDE_BY_INDEX?.[infiniteIndex];
  if (Number.isInteger(override) && override >= 0) return override;
  return null;
};

export function generateInfiniteLevel(infiniteIndex) {
  assertInfiniteIndex(infiniteIndex);

  const cached = getCachedLevel(infiniteIndex);
  if (cached) return cached;

  let level = null;
  const overrideVariantId = resolveOverrideVariantId(infiniteIndex);
  if (Number.isInteger(overrideVariantId)) {
    try {
      level = generateInfiniteLevelFromVariant(infiniteIndex, overrideVariantId);
    } catch {
      // Ignore broken/stale override entry and use default variant selection.
    }
  }

  if (!level) {
    level = selectDefaultInfiniteCandidate(infiniteIndex).level;
  }

  setCachedLevel(infiniteIndex, level);
  return level;
}
