import { LEVELS } from './levels.js';

export const INFINITE_GLOBAL_SEED = 'TETHER_INFINITE_V1';
export const INFINITE_FEATURE_CYCLE = Object.freeze([
  'stitch',
  'movable',
  'corner',
  'rps',
  'hint',
  'mixed',
]);
export const MIN_CONSTRAINT_DENSITY = 0.15;

const HINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v']);
const RPS_CODES = new Set(['g', 'b', 'p']);
const RPS_ROTATE = Object.freeze({
  g: 'b',
  b: 'p',
  p: 'g',
});

const TRANSFORMS = Object.freeze([
  { id: 'identity', swapAxes: false, mirrorsOrientation: false },
  { id: 'rot90', swapAxes: true, mirrorsOrientation: false },
  { id: 'rot180', swapAxes: false, mirrorsOrientation: false },
  { id: 'rot270', swapAxes: true, mirrorsOrientation: false },
  { id: 'flip_h', swapAxes: false, mirrorsOrientation: true },
  { id: 'flip_v', swapAxes: false, mirrorsOrientation: true },
  { id: 'transpose', swapAxes: true, mirrorsOrientation: true },
  { id: 'anti_transpose', swapAxes: true, mirrorsOrientation: true },
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
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
};

const intFromRng = (rng, maxExclusive) => Math.floor(rng() * maxExclusive);
const weightedPick = (entries, weights, rng) => {
  if (!entries || entries.length === 0) return null;
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (!(total > 0)) return entries[entries.length - 1];

  let roll = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return entries[i];
  }
  return entries[entries.length - 1];
};

const deriveSeed = (rootSeed, label) => mix32(rootSeed ^ hashString32(label));

const deepCloneLevelShape = (level) => ({
  grid: level.grid.map((row) => String(row)),
  stitches: (level.stitches || []).map((entry) => [entry[0], entry[1]]),
  cornerCounts: (level.cornerCounts || []).map((entry) => [entry[0], entry[1], entry[2]]),
});

const analyzeFeatures = (level) => {
  let hasHint = false;
  let hasRps = false;
  let hasMovable = false;
  let hintCount = 0;
  let wallCount = 0;
  let constraintCellCount = 0;

  for (const row of level.grid) {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch !== '.') constraintCellCount += 1;
      if (HINT_CODES.has(ch)) {
        hasHint = true;
        hintCount += 1;
      }
      if (RPS_CODES.has(ch)) hasRps = true;
      if (ch === 'm') hasMovable = true;
      if (ch === '#') wallCount += 1;
    }
  }

  const hasStitch = (level.stitches || []).length > 0;
  const hasCorner = (level.cornerCounts || []).length > 0;
  const featureCount = [hasStitch, hasMovable, hasCorner, hasRps, hasHint].filter(Boolean).length;

  return {
    stitch: hasStitch,
    movable: hasMovable,
    corner: hasCorner,
    rps: hasRps,
    hint: hasHint,
    hintCount,
    wallCount,
    constraintCellCount,
    mixed: featureCount >= 2,
    featureCount,
  };
};

const CAMPAIGN_ENTRIES = LEVELS.map((level, index) => {
  const clone = deepCloneLevelShape(level);
  const rows = clone.grid.length;
  const cols = clone.grid[0].length;
  const features = analyzeFeatures(clone);
  return {
    index,
    level: clone,
    rows,
    cols,
    area: rows * cols,
    features,
    constraintDensity:
      (
        features.constraintCellCount +
        (clone.stitches || []).length +
        (clone.cornerCounts || []).length
      ) / (rows * cols),
    label: level.name || level.nameKey || `level.${index}`,
    difficultyScore: Number.isFinite(level?.difficulty?.score) ? level.difficulty.score : 50,
  };
});

const FEATURE_POOLS = Object.fromEntries(
  INFINITE_FEATURE_CYCLE.map((feature) => [
    feature,
    CAMPAIGN_ENTRIES
      .filter((entry) => {
        const hasDensity = entry.constraintDensity >= MIN_CONSTRAINT_DENSITY;
        if (feature === 'rps') {
          return hasDensity && entry.features.rps && entry.features.mixed;
        }
        if (feature === 'hint') {
          return hasDensity && entry.features.hint && entry.features.mixed;
        }
        if (feature === 'corner') {
          return entry.features.corner;
        }
        if (feature === 'movable') {
          const canProvideMovable = entry.features.movable || entry.features.wallCount > 0;
          const hasSecondaryFamily =
            entry.features.hint || entry.features.stitch || entry.features.corner || entry.features.rps;
          return hasDensity && canProvideMovable && hasSecondaryFamily;
        }
        if (!entry.features[feature] || !hasDensity) return false;
        return true;
      })
      .sort((a, b) => (a.difficultyScore - b.difficultyScore) || (a.index - b.index)),
  ]),
);

const BASE_PICK_WINDOW = 8;
const MAX_BASE_ATTEMPTS = 6;

const transformedDimensions = (rows, cols, transformIndex) => {
  const meta = TRANSFORMS[transformIndex];
  if (!meta) throw new Error(`Unknown transform index: ${transformIndex}`);
  if (meta.swapAxes) return { rows: cols, cols: rows };
  return { rows, cols };
};

const mapCellCoord = (r, c, rows, cols, transformIndex) => {
  switch (transformIndex) {
    case 0:
      return { r, c };
    case 1:
      return { r: c, c: rows - 1 - r };
    case 2:
      return { r: rows - 1 - r, c: cols - 1 - c };
    case 3:
      return { r: cols - 1 - c, c: r };
    case 4:
      return { r, c: cols - 1 - c };
    case 5:
      return { r: rows - 1 - r, c };
    case 6:
      return { r: c, c: r };
    case 7:
      return { r: cols - 1 - c, c: rows - 1 - r };
    default:
      throw new Error(`Unknown transform index: ${transformIndex}`);
  }
};

const mapPointCoord = (pr, pc, rows, cols, transformIndex) => {
  switch (transformIndex) {
    case 0:
      return { r: pr, c: pc };
    case 1:
      return { r: pc, c: rows - pr };
    case 2:
      return { r: rows - pr, c: cols - pc };
    case 3:
      return { r: cols - pc, c: pr };
    case 4:
      return { r: pr, c: cols - pc };
    case 5:
      return { r: rows - pr, c: pc };
    case 6:
      return { r: pc, c: pr };
    case 7:
      return { r: cols - pc, c: rows - pr };
    default:
      throw new Error(`Unknown transform index: ${transformIndex}`);
  }
};

const mapHintCodeForTransform = (ch, transformIndex) => {
  const meta = TRANSFORMS[transformIndex];
  if (!meta) return ch;

  let out = ch;
  if (meta.swapAxes) {
    if (out === 'h') out = 'v';
    else if (out === 'v') out = 'h';
  }

  if (meta.mirrorsOrientation) {
    if (out === 'r') out = 'l';
    else if (out === 'l') out = 'r';
  }

  return out;
};

const sortPairs = (pairs) =>
  pairs
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

const sortCornerCounts = (entries) =>
  entries
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));

const applyTransform = (entry, transformIndex) => {
  const level = entry.level;
  const rows = level.grid.length;
  const cols = level.grid[0].length;
  const dims = transformedDimensions(rows, cols, transformIndex);
  const dstGrid = Array.from({ length: dims.rows }, () => Array(dims.cols).fill('.'));

  for (let r = 0; r < rows; r++) {
    const row = level.grid[r];
    for (let c = 0; c < cols; c++) {
      const mapped = mapCellCoord(r, c, rows, cols, transformIndex);
      dstGrid[mapped.r][mapped.c] = mapHintCodeForTransform(row[c], transformIndex);
    }
  }

  const stitches = (level.stitches || []).map(([vr, vc]) => {
    const mapped = mapPointCoord(vr, vc, rows, cols, transformIndex);
    return [mapped.r, mapped.c];
  });
  const cornerCounts = (level.cornerCounts || []).map(([vr, vc, count]) => {
    const mapped = mapPointCoord(vr, vc, rows, cols, transformIndex);
    return [mapped.r, mapped.c, count];
  });

  return {
    grid: dstGrid.map((row) => row.join('')),
    stitches: sortPairs(stitches),
    cornerCounts: sortCornerCounts(cornerCounts),
  };
};

const applyRpsShift = (grid, shift) => {
  if (shift <= 0) return;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      let ch = grid[r][c];
      for (let i = 0; i < shift; i++) {
        if (!RPS_ROTATE[ch]) break;
        ch = RPS_ROTATE[ch];
      }
      grid[r][c] = ch;
    }
  }
};

const collectHintCells = (grid) => {
  const cells = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const ch = grid[r][c];
      if (HINT_CODES.has(ch)) {
        cells.push({ r, c, ch });
      }
    }
  }
  return cells;
};

const thinHints = (grid, rng, minKeep) => {
  if (rng() >= 0.6) return;
  const hints = collectHintCells(grid);
  let remaining = hints.length;
  for (let i = 0; i < hints.length; i++) {
    if (remaining <= minKeep) break;
    if (rng() < 0.38) {
      const cell = hints[i];
      grid[cell.r][cell.c] = '.';
      remaining -= 1;
    }
  }
};

const thinCornerCounts = (cornerCounts, rng, minKeep) => {
  if (rng() >= 0.6) return cornerCounts;
  const next = cornerCounts.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next.length <= minKeep) break;
    if (rng() < 0.38) next.splice(i, 1);
  }
  return next;
};

const tuneWallMutability = (grid, rng, minMovable, maxMovable) => {
  if (rng() >= 0.7) return;
  const walls = [];
  let movableCount = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const ch = grid[r][c];
      if (ch === '#' || ch === 'm') {
        walls.push({ r, c });
        if (ch === 'm') movableCount += 1;
      }
    }
  }
  if (walls.length === 0) return;

  for (let i = 0; i < walls.length; i++) {
    if (rng() >= 0.24) continue;
    const cell = walls[i];
    const ch = grid[cell.r][cell.c];
    if (ch === 'm') {
      if (movableCount <= minMovable) continue;
      grid[cell.r][cell.c] = '#';
      movableCount -= 1;
    } else {
      if (movableCount >= maxMovable) continue;
      grid[cell.r][cell.c] = 'm';
      movableCount += 1;
    }
  }

  if (movableCount >= minMovable) return;
  for (let i = 0; i < walls.length; i++) {
    const cell = walls[i];
    if (grid[cell.r][cell.c] === '#') {
      grid[cell.r][cell.c] = 'm';
      movableCount += 1;
      if (movableCount >= minMovable) break;
    }
  }
};

const toGridMatrix = (grid) => grid.map((row) => row.split(''));
const toGridStrings = (grid) => grid.map((row) => row.join(''));

const restoreHintFromSource = (targetGrid, sourceGrid) => {
  for (let r = 0; r < sourceGrid.length; r++) {
    for (let c = 0; c < sourceGrid[r].length; c++) {
      const sourceCode = sourceGrid[r][c];
      if (!HINT_CODES.has(sourceCode)) continue;
      targetGrid[r][c] = sourceCode;
      return true;
    }
  }
  return false;
};

const restoreRpsFromSource = (targetGrid, sourceGrid) => {
  for (let r = 0; r < sourceGrid.length; r++) {
    for (let c = 0; c < sourceGrid[r].length; c++) {
      const sourceCode = sourceGrid[r][c];
      if (!RPS_CODES.has(sourceCode)) continue;
      targetGrid[r][c] = sourceCode;
      return true;
    }
  }
  return false;
};

const countHintCells = (grid) => {
  let count = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (HINT_CODES.has(grid[r][c])) count += 1;
    }
  }
  return count;
};

const restoreMovableFromSource = (targetGrid, sourceGrid) => {
  for (let r = 0; r < sourceGrid.length; r++) {
    for (let c = 0; c < sourceGrid[r].length; c++) {
      if (sourceGrid[r][c] !== 'm') continue;
      if (targetGrid[r][c] === '#' || targetGrid[r][c] === 'm') {
        targetGrid[r][c] = 'm';
        return true;
      }
    }
  }

  for (let r = 0; r < targetGrid.length; r++) {
    for (let c = 0; c < targetGrid[r].length; c++) {
      if (targetGrid[r][c] === '#') {
        targetGrid[r][c] = 'm';
        return true;
      }
    }
  }
  return false;
};

const injectSyntheticRps = (targetGrid) => {
  for (let r = 0; r < targetGrid.length; r++) {
    for (let c = 0; c < targetGrid[r].length; c++) {
      if (targetGrid[r][c] === '.') {
        targetGrid[r][c] = 'g';
        return true;
      }
    }
  }
  return false;
};

const injectSyntheticHint = (targetGrid, rng) => {
  const empties = [];
  for (let r = 0; r < targetGrid.length; r++) {
    for (let c = 0; c < targetGrid[r].length; c++) {
      if (targetGrid[r][c] === '.') {
        empties.push({ r, c });
      }
    }
  }
  if (empties.length === 0) return false;
  const pick = empties[intFromRng(rng, empties.length)];
  targetGrid[pick.r][pick.c] = 't';
  return true;
};

const ensureMinimumFeatureFamilies = (target, source, minCount = 2) => {
  const sourceGrid = toGridMatrix(source.grid);
  const targetGrid = toGridMatrix(target.grid);

  const currentFeatures = () =>
    analyzeFeatures({
      grid: toGridStrings(targetGrid),
      stitches: target.stitches,
      cornerCounts: target.cornerCounts,
    });

  const sourceFeatures = analyzeFeatures({
    grid: source.grid,
    stitches: source.stitches,
    cornerCounts: source.cornerCounts,
  });

  const tryRestoreHint = () => {
    if (!sourceFeatures.hint) return false;
    return restoreHintFromSource(targetGrid, sourceGrid);
  };

  const tryRestoreCorner = () => {
    if (!sourceFeatures.corner) return false;
    if ((target.cornerCounts || []).length > 0) return false;
    if ((source.cornerCounts || []).length === 0) return false;
    target.cornerCounts = [source.cornerCounts[0].slice()];
    return true;
  };

  const tryRestoreMovable = () => {
    if (!sourceFeatures.movable) return false;
    return restoreMovableFromSource(targetGrid, sourceGrid);
  };

  const tryRestoreStitch = () => {
    if (!sourceFeatures.stitch) return false;
    if ((target.stitches || []).length > 0) return false;
    if ((source.stitches || []).length === 0) return false;
    target.stitches = [source.stitches[0].slice()];
    return true;
  };

  const tryRestoreRps = () => {
    if (!sourceFeatures.rps) return false;
    return restoreRpsFromSource(targetGrid, sourceGrid);
  };

  const restorers = [tryRestoreHint, tryRestoreCorner, tryRestoreMovable, tryRestoreStitch, tryRestoreRps];
  let features = currentFeatures();
  for (let i = 0; i < restorers.length && features.featureCount < minCount; i++) {
    restorers[i]();
    features = currentFeatures();
  }

  if (features.featureCount < minCount && !features.rps) {
    injectSyntheticRps(targetGrid);
    features = currentFeatures();
  }

  target.grid = toGridStrings(targetGrid);
  target.cornerCounts = sortCornerCounts(target.cornerCounts || []);
  target.stitches = sortPairs(target.stitches || []);
};

const ensureMinimumHintCount = (target, source, minHints = 2) => {
  const sourceGrid = toGridMatrix(source.grid);
  const targetGrid = toGridMatrix(target.grid);

  const sourceHintCells = [];
  for (let r = 0; r < sourceGrid.length; r++) {
    for (let c = 0; c < sourceGrid[r].length; c++) {
      const code = sourceGrid[r][c];
      if (HINT_CODES.has(code)) {
        sourceHintCells.push({ r, c, code });
      }
    }
  }

  let hintCount = countHintCells(targetGrid);
  for (let i = 0; i < sourceHintCells.length && hintCount < minHints; i++) {
    const cell = sourceHintCells[i];
    if (HINT_CODES.has(targetGrid[cell.r][cell.c])) continue;
    targetGrid[cell.r][cell.c] = cell.code;
    hintCount += 1;
  }

  target.grid = toGridStrings(targetGrid);
};

const constraintUnitDensity = (grid, stitches, cornerCounts) => {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  if (rows === 0 || cols === 0) return 0;

  let constraintCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== '.') constraintCells += 1;
    }
  }

  const units = constraintCells + (stitches || []).length + (cornerCounts || []).length;
  return units / (rows * cols);
};

const ensureMinimumConstraintDensity = (target, source, minDensity = MIN_CONSTRAINT_DENSITY) => {
  const sourceGrid = toGridMatrix(source.grid);
  const targetGrid = toGridMatrix(target.grid);
  let stitches = sortPairs(target.stitches || []);
  let cornerCounts = sortCornerCounts(target.cornerCounts || []);

  const sourceStitchMap = new Map((source.stitches || []).map((entry) => [`${entry[0]},${entry[1]}`, entry]));
  const sourceCornerMap = new Map((source.cornerCounts || []).map((entry) => [`${entry[0]},${entry[1]}`, entry]));

  const tryRestoreCellByPredicate = (predicate) => {
    for (let r = 0; r < sourceGrid.length; r++) {
      for (let c = 0; c < sourceGrid[r].length; c++) {
        const sourceCode = sourceGrid[r][c];
        if (!predicate(sourceCode)) continue;
        if (targetGrid[r][c] !== '.') continue;
        targetGrid[r][c] = sourceCode;
        return true;
      }
    }
    return false;
  };

  const tryRestoreStitch = () => {
    const existing = new Set(stitches.map((entry) => `${entry[0]},${entry[1]}`));
    for (const [key, entry] of sourceStitchMap) {
      if (existing.has(key)) continue;
      stitches.push([entry[0], entry[1]]);
      stitches = sortPairs(stitches);
      return true;
    }
    return false;
  };

  const tryRestoreCorner = () => {
    const existing = new Set(cornerCounts.map((entry) => `${entry[0]},${entry[1]}`));
    for (const [key, entry] of sourceCornerMap) {
      if (existing.has(key)) continue;
      cornerCounts.push([entry[0], entry[1], entry[2]]);
      cornerCounts = sortCornerCounts(cornerCounts);
      return true;
    }
    return false;
  };

  let density = constraintUnitDensity(targetGrid, stitches, cornerCounts);
  while (density < minDensity) {
    let changed = false;
    if (tryRestoreCellByPredicate((code) => HINT_CODES.has(code))) changed = true;
    density = constraintUnitDensity(targetGrid, stitches, cornerCounts);
    if (density >= minDensity) break;

    if (tryRestoreCellByPredicate((code) => RPS_CODES.has(code))) changed = true;
    density = constraintUnitDensity(targetGrid, stitches, cornerCounts);
    if (density >= minDensity) break;

    if (tryRestoreCellByPredicate((code) => code === '#' || code === 'm')) changed = true;
    density = constraintUnitDensity(targetGrid, stitches, cornerCounts);
    if (density >= minDensity) break;

    if (tryRestoreStitch()) changed = true;
    density = constraintUnitDensity(targetGrid, stitches, cornerCounts);
    if (density >= minDensity) break;

    if (tryRestoreCorner()) changed = true;
    density = constraintUnitDensity(targetGrid, stitches, cornerCounts);
    if (density >= minDensity) break;

    if (!changed) break;
  }

  target.grid = toGridStrings(targetGrid);
  target.stitches = stitches;
  target.cornerCounts = cornerCounts;
  return density >= minDensity;
};

const ensureRequiredFeature = (target, source, requiredFeature) => {
  const sourceGrid = toGridMatrix(source.grid);
  const targetGrid = toGridMatrix(target.grid);

  const ensureHint = () => restoreHintFromSource(targetGrid, sourceGrid);
  const ensureRps = () => {
    let hasRps = false;
    for (let r = 0; r < targetGrid.length; r++) {
      for (let c = 0; c < targetGrid[r].length; c++) {
        if (RPS_CODES.has(targetGrid[r][c])) {
          hasRps = true;
          break;
        }
      }
      if (hasRps) break;
    }
    if (hasRps) return true;
    return restoreRpsFromSource(targetGrid, sourceGrid) || injectSyntheticRps(targetGrid);
  };
  const ensureCorner = () => {
    if ((target.cornerCounts || []).length > 0) return true;
    if ((source.cornerCounts || []).length === 0) return false;
    target.cornerCounts = [source.cornerCounts[0].slice()];
    return true;
  };
  const ensureMovable = () => restoreMovableFromSource(targetGrid, sourceGrid);

  if (requiredFeature === 'hint') ensureHint();
  else if (requiredFeature === 'corner') ensureCorner();
  else if (requiredFeature === 'movable') ensureMovable();
  else if (requiredFeature === 'rps') ensureRps();
  else if (requiredFeature === 'mixed') {
    let features = analyzeFeatures({
      grid: toGridStrings(targetGrid),
      stitches: target.stitches,
      cornerCounts: target.cornerCounts,
    });
    if (features.featureCount < 2) {
      if (!features.hint) ensureHint();
      features = analyzeFeatures({
        grid: toGridStrings(targetGrid),
        stitches: target.stitches,
        cornerCounts: target.cornerCounts,
      });
      if (features.featureCount < 2 && !features.corner) ensureCorner();
      features = analyzeFeatures({
        grid: toGridStrings(targetGrid),
        stitches: target.stitches,
        cornerCounts: target.cornerCounts,
      });
      if (features.featureCount < 2 && !features.movable) ensureMovable();
    }
  }

  target.grid = toGridStrings(targetGrid);
  target.cornerCounts = sortCornerCounts(target.cornerCounts || []);
  target.stitches = sortPairs(target.stitches || []);
};

const levelConstraintDensity = (level, analyzed = analyzeFeatures(level)) => {
  const rows = level.grid.length;
  const cols = rows > 0 ? level.grid[0].length : 0;
  if (rows === 0 || cols === 0) return 0;
  return (
    analyzed.constraintCellCount +
    (level.stitches || []).length +
    (level.cornerCounts || []).length
  ) / (rows * cols);
};

const validatePostconditions = (level, requiredFeature) => {
  const features = analyzeFeatures(level);
  const density = levelConstraintDensity(level, features);
  const requiredFeatureOk = Boolean(features[requiredFeature]);
  const minimumFeaturesOk = features.featureCount >= 2;
  const rpsHintMinimumOk = requiredFeature !== 'rps' || features.hintCount >= 2;
  const densityOk = density >= MIN_CONSTRAINT_DENSITY;

  return {
    ok: requiredFeatureOk && minimumFeaturesOk && rpsHintMinimumOk && densityOk,
    requiredFeatureOk,
    minimumFeaturesOk,
    rpsHintMinimumOk,
    densityOk,
    density,
    features,
  };
};

const enforceDeterministicFallback = (target, source, requiredFeature, rng) => {
  ensureRequiredFeature(target, source, requiredFeature);
  ensureMinimumFeatureFamilies(target, source, 2);
  if (requiredFeature === 'rps') {
    ensureMinimumHintCount(target, source, 2);
  }
  ensureMinimumConstraintDensity(target, source, MIN_CONSTRAINT_DENSITY);

  let validation = validatePostconditions(target, requiredFeature);
  if (validation.requiredFeatureOk && validation.minimumFeaturesOk && validation.rpsHintMinimumOk && validation.densityOk) {
    return validation;
  }

  const grid = toGridMatrix(target.grid);

  if (!validation.requiredFeatureOk && requiredFeature === 'rps') {
    injectSyntheticRps(grid);
  } else if (!validation.requiredFeatureOk && requiredFeature === 'hint') {
    injectSyntheticHint(grid, rng);
  }

  if (!validation.minimumFeaturesOk) {
    if (!validation.features.rps) injectSyntheticRps(grid);
    if (!validation.features.hint) injectSyntheticHint(grid, rng);
  }

  if (!validation.rpsHintMinimumOk) {
    while (countHintCells(grid) < 2) {
      if (!injectSyntheticHint(grid, rng)) break;
    }
  }

  target.grid = toGridStrings(grid);
  target.stitches = sortPairs(target.stitches || []);
  target.cornerCounts = sortCornerCounts(target.cornerCounts || []);

  // Density repair is explicit: succeed here or let caller retry another transform/base.
  if (!ensureMinimumConstraintDensity(target, source, MIN_CONSTRAINT_DENSITY)) {
    validation = validatePostconditions(target, requiredFeature);
    return validation;
  }

  validation = validatePostconditions(target, requiredFeature);
  return validation;
};

const mutateSafely = (transformed, rng, requiredFeature) => {
  const grid = toGridMatrix(transformed.grid);
  const sourceGrid = transformed.grid.map((row) => row);

  applyRpsShift(grid, intFromRng(rng, 3));
  thinHints(grid, rng, requiredFeature === 'rps' ? 2 : (requiredFeature === 'hint' ? 1 : 0));

  let cornerCounts = thinCornerCounts(
    transformed.cornerCounts || [],
    rng,
    requiredFeature === 'corner' ? 2 : 0,
  );

  const maxMovableWalls = requiredFeature === 'rps' ? 1 : 2;
  tuneWallMutability(grid, rng, requiredFeature === 'movable' ? 1 : 0, maxMovableWalls);

  const out = {
    grid: toGridStrings(grid),
    stitches: sortPairs((transformed.stitches || []).slice()),
    cornerCounts: sortCornerCounts(cornerCounts),
  };

  ensureRequiredFeature(
    out,
    {
      grid: sourceGrid,
      stitches: transformed.stitches || [],
      cornerCounts: transformed.cornerCounts || [],
    },
    requiredFeature,
  );

  ensureMinimumFeatureFamilies(
    out,
    {
      grid: sourceGrid,
      stitches: transformed.stitches || [],
      cornerCounts: transformed.cornerCounts || [],
    },
    2,
  );

  if (requiredFeature === 'rps') {
    ensureMinimumHintCount(
      out,
      {
        grid: sourceGrid,
        stitches: transformed.stitches || [],
        cornerCounts: transformed.cornerCounts || [],
      },
      2,
    );
  }

  ensureMinimumConstraintDensity(
    out,
    {
      grid: sourceGrid,
      stitches: transformed.stitches || [],
      cornerCounts: transformed.cornerCounts || [],
    },
    MIN_CONSTRAINT_DENSITY,
  );
  return out;
};

const pickBaseEntry = (requiredFeature, infiniteIndex, seed, attempt) => {
  const pool = FEATURE_POOLS[requiredFeature];
  const effectivePool = pool && pool.length > 0 ? pool : CAMPAIGN_ENTRIES;
  if (effectivePool.length === 1) return effectivePool[0];

  const rotateSeed = deriveSeed(seed, `base-rotate:${requiredFeature}:${infiniteIndex}:${attempt}`);
  const rotateOffset = rotateSeed % effectivePool.length;
  const rotated = Array.from(
    { length: effectivePool.length },
    (_, i) => effectivePool[(i + rotateOffset) % effectivePool.length],
  );
  const anchors = effectivePool.slice(0, Math.min(4, effectivePool.length));
  const exploratory = rotated.slice(0, Math.min(4, rotated.length));
  const seen = new Set();
  const window = [];
  for (const entry of [...anchors, ...exploratory]) {
    if (window.length >= BASE_PICK_WINDOW) break;
    if (seen.has(entry.index)) continue;
    seen.add(entry.index);
    window.push(entry);
  }
  if (window.length === 0) window.push(effectivePool[0]);

  const pickSeed = deriveSeed(seed, `base-weighted-pick:${requiredFeature}:${infiniteIndex}:${attempt}`);
  const pickRng = makeRng(pickSeed);
  const weights = window.map((entry) => {
    const areaPenalty = 1 + (Math.max(0, entry.area - 25) / 20);
    const difficultyPenalty = 1 + (Math.max(0, entry.difficultyScore - 60) / 80);
    return 1 / (areaPenalty * difficultyPenalty);
  });
  return weightedPick(window, weights, pickRng) || window[window.length - 1];
};

const featureLabel = (feature) => {
  switch (feature) {
    case 'stitch':
      return 'stitches';
    case 'movable':
      return 'movable walls';
    case 'corner':
      return 'corner counts';
    case 'rps':
      return 'RPS ordering';
    case 'hint':
      return 'hint routing';
    case 'mixed':
      return 'mixed constraints';
    default:
      return 'constraints';
  }
};

export function generateInfiniteLevel(infiniteIndex) {
  if (!Number.isInteger(infiniteIndex) || infiniteIndex < 0) {
    throw new Error(`infiniteIndex must be a non-negative integer, got: ${infiniteIndex}`);
  }

  const requiredFeature = INFINITE_FEATURE_CYCLE[infiniteIndex % INFINITE_FEATURE_CYCLE.length];
  const seed = mix32(hashString32(`${INFINITE_GLOBAL_SEED}:${infiniteIndex}`));
  const pool = FEATURE_POOLS[requiredFeature];
  const baseAttemptLimit = Math.max(
    1,
    Math.min(MAX_BASE_ATTEMPTS, pool && pool.length > 0 ? pool.length : CAMPAIGN_ENTRIES.length),
  );
  let failureContext = null;

  for (let baseAttempt = 0; baseAttempt < baseAttemptLimit; baseAttempt++) {
    const base = pickBaseEntry(requiredFeature, infiniteIndex, seed, baseAttempt);
    const transformStartSeed = deriveSeed(seed, `transform-start:${infiniteIndex}:${baseAttempt}:${base.index}`);
    const transformStart = transformStartSeed % TRANSFORMS.length;

    for (let transformAttempt = 0; transformAttempt < TRANSFORMS.length; transformAttempt++) {
      const transformIndex = (transformStart + transformAttempt) % TRANSFORMS.length;
      const transformed = applyTransform(base, transformIndex);
      const mutateSeed = deriveSeed(
        seed,
        `mutate:${infiniteIndex}:${baseAttempt}:${transformIndex}:${base.index}`,
      );
      const fallbackSeed = deriveSeed(
        seed,
        `fallback:${infiniteIndex}:${baseAttempt}:${transformIndex}:${base.index}`,
      );
      const mutated = mutateSafely(transformed, makeRng(mutateSeed), requiredFeature);
      const validation = enforceDeterministicFallback(
        mutated,
        {
          grid: transformed.grid,
          stitches: transformed.stitches || [],
          cornerCounts: transformed.cornerCounts || [],
        },
        requiredFeature,
        makeRng(fallbackSeed),
      );

      if (validation.ok) {
        const displayIndex = infiniteIndex + 1;
        return {
          name: `Infinite #${displayIndex}`,
          desc: `Deterministic ${TRANSFORMS[transformIndex].id} remix focused on ${featureLabel(requiredFeature)}.`,
          grid: mutated.grid,
          stitches: mutated.stitches,
          cornerCounts: mutated.cornerCounts,
          infiniteMeta: {
            version: 1,
            index: infiniteIndex,
            requiredFeature,
            transform: TRANSFORMS[transformIndex].id,
            baseLevelIndex: base.index,
            seed,
          },
        };
      }

      failureContext = {
        baseIndex: base.index,
        transform: TRANSFORMS[transformIndex].id,
        validation,
      };
    }
  }

  throw new Error(
    `Failed to generate infinite level ${infiniteIndex} after deterministic retries` +
    (failureContext
      ? ` (required=${requiredFeature}, base=${failureContext.baseIndex}, transform=${failureContext.transform}, density=${failureContext.validation.density.toFixed(3)})`
      : ''),
  );
}
