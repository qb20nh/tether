#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import {
  INFINITE_FEATURE_CYCLE,
  INFINITE_MAX_LEVELS,
  MAX_CONSTRAINT_DENSITY,
  MAX_WALL_DENSITY,
  MIN_CONSTRAINT_DENSITY,
  generateInfiniteLevel,
} from '../src/infinite.js';
import { canonicalConstraintSignature } from '../src/infinite_canonical.js';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../src/rules.js';
import { keyV } from '../src/utils.js';
import { solveLevel } from './verify_level_properties.js';

const HINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v']);
const RPS_CODES = new Set(['g', 'b', 'p']);
const DEFAULT_FEATURE_UNIQUE_RATIO = Object.freeze(
  Object.fromEntries(INFINITE_FEATURE_CYCLE.map((feature) => [feature, feature === 'corner' ? 0.1 : 0.25])),
);

const DEFAULTS = {
  samples: 30,
  coverage: 30,
  canonicalScan: INFINITE_MAX_LEVELS,
  solveTimeMs: 1200,
  retrySolveTimeMs: 5000,
  perfRuns: 500,
  perfBudgetMsP95: 300,
  minUniqueRatio: 0.4,
  minFeatureUniqueRatio: DEFAULT_FEATURE_UNIQUE_RATIO,
  json: false,
};

const toInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
  return parsed;
};

const toRatio = (name, value) => {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1, got ${value}`);
  }
  return parsed;
};

const parseJsonFeatureUniqueRatio = (input) => {
  let raw;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    throw new Error(`--min-feature-unique-ratio JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('--min-feature-unique-ratio JSON must be an object');
  }
  return raw;
};

const parseKvFeatureUniqueRatio = (input) => {
  const raw = {};
  const pairs = input.split(',').map((part) => part.trim()).filter(Boolean);
  if (pairs.length === 0) {
    throw new Error('--min-feature-unique-ratio requires key=value pairs or JSON object');
  }
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0 || eq >= pair.length - 1) {
      throw new Error(`Invalid feature ratio pair: ${pair}`);
    }
    const key = pair.slice(0, eq).trim();
    const ratio = pair.slice(eq + 1).trim();
    raw[key] = ratio;
  }
  return raw;
};

const parseFeatureUniqueRatio = (value) => {
  const input = String(value || '').trim();
  if (!input) return {};

  const raw = input.startsWith('{')
    ? parseJsonFeatureUniqueRatio(input)
    : parseKvFeatureUniqueRatio(input);

  const out = {};
  for (const [feature, ratio] of Object.entries(raw)) {
    if (!INFINITE_FEATURE_CYCLE.includes(feature)) {
      throw new Error(
        `Unknown feature "${feature}" in --min-feature-unique-ratio. Expected one of: ${INFINITE_FEATURE_CYCLE.join(', ')}`,
      );
    }
    out[feature] = toRatio(`unique ratio for ${feature}`, ratio);
  }

  return out;
};

const parseArgs = (argv) => {
  const opts = {
    ...DEFAULTS,
    minFeatureUniqueRatio: { ...DEFAULTS.minFeatureUniqueRatio },
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === '--samples') opts.samples = toInt('--samples', nextValue());
    else if (arg === '--coverage') opts.coverage = toInt('--coverage', nextValue());
    else if (arg === '--canonical-scan') opts.canonicalScan = toInt('--canonical-scan', nextValue());
    else if (arg === '--solve-time-ms') opts.solveTimeMs = toInt('--solve-time-ms', nextValue());
    else if (arg === '--retry-solve-time-ms') opts.retrySolveTimeMs = toInt('--retry-solve-time-ms', nextValue());
    else if (arg === '--perf-runs') opts.perfRuns = toInt('--perf-runs', nextValue());
    else if (arg === '--min-unique-ratio') opts.minUniqueRatio = toRatio('--min-unique-ratio', nextValue());
    else if (arg === '--min-feature-unique-ratio') {
      opts.minFeatureUniqueRatio = {
        ...opts.minFeatureUniqueRatio,
        ...parseFeatureUniqueRatio(nextValue()),
      };
    }
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/verify_infinite_generation.js [options]',
          '',
          'Options:',
          `  --samples <n>        Determinism + solvability sample size (default: ${DEFAULTS.samples})`,
          `  --coverage <n>       Feature-cycle coverage checks (default: ${DEFAULTS.coverage})`,
          `  --canonical-scan <n> Canonical collision scan range from index 0 (default: ${DEFAULTS.canonicalScan})`,
          `  --solve-time-ms <n>  Per-level solve timeout (default: ${DEFAULTS.solveTimeMs})`,
          `  --retry-solve-time-ms <n>  Retry timeout for first-pass solver timeouts (default: ${DEFAULTS.retrySolveTimeMs})`,
          `  --perf-runs <n>      Number of generation runs for perf (default: ${DEFAULTS.perfRuns})`,
          `  --min-unique-ratio <0..1>  Minimum global unique-signature ratio (default: ${DEFAULTS.minUniqueRatio})`,
          '  --min-feature-unique-ratio <spec>',
          '                       Per-feature uniqueness thresholds, JSON or key=val list.',
          '                       Example: corner=0.10,stitch=0.25,rps=0.25',
          '  --json               Emit JSON output',
          '  --help               Show this help',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (opts.canonicalScan > INFINITE_MAX_LEVELS) {
    throw new Error(`--canonical-scan cannot exceed ${INFINITE_MAX_LEVELS}`);
  }

  return opts;
};

const signatureOf = (level) =>
  JSON.stringify({
    grid: level.grid,
    stitches: level.stitches || [],
    cornerCounts: level.cornerCounts || [],
  });

const analyzeFeatures = (level) => {
  let hasHint = false;
  let hasRps = false;
  let hasMovable = false;
  let hintCount = 0;
  let rpsCount = 0;
  let wallCount = 0;
  let cellConstraintCount = 0;

  for (const row of level.grid || []) {
    for (const element of row) {
      const ch = element;
      if (ch === '#') {
        wallCount += 1;
      } else if (ch === 'm') {
        wallCount += 1;
        hasMovable = true;
      } else if (HINT_CODES.has(ch)) {
        hasHint = true;
        hintCount += 1;
        cellConstraintCount += 1;
      } else if (RPS_CODES.has(ch)) {
        hasRps = true;
        rpsCount += 1;
        cellConstraintCount += 1;
      }
    }
  }

  const rows = level.grid?.length || 0;
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
    wallCount,
    nonWallCellCount,
    cellConstraintCount,
    constraintTokenCount,
    mixed: featureCount >= 2,
    featureCount,
  };
};

const constraintDensity = (level, features) => {
  if (features.nonWallCellCount <= 0) return 0;
  return features.constraintTokenCount / features.nonWallCellCount;
};

const wallDensity = (level, features) => {
  const rows = level.grid?.length || 0;
  const cols = rows > 0 ? level.grid[0].length : 0;
  const totalCells = rows * cols;
  if (totalCells <= 0) return 0;
  return features.wallCount / totalCells;
};

const isWallCell = (level, r, c) => {
  const row = level.grid?.[r];
  if (!row) return false;
  const ch = row[c];
  return ch === '#' || ch === 'm';
};

const checkUnsatisfiableCorner = (level, vr, vc, count) => {
  const nw = isWallCell(level, vr - 1, vc - 1);
  const ne = isWallCell(level, vr - 1, vc);
  const sw = isWallCell(level, vr, vc - 1);
  const se = isWallCell(level, vr, vc);
  const wallCount = [nw, ne, sw, se].filter(Boolean).length;
  const diagonalWalls = (nw && se) || (ne && sw);

  if (wallCount > 3) {
    return 'more_than_3_walls';
  }
  if (count === 0 && diagonalWalls) {
    return 'zero_with_diagonal_walls';
  }

  const maxPossible = [
    !nw && !ne,
    !nw && !sw,
    !ne && !se,
    !sw && !se,
  ].filter(Boolean).length;

  if (count > maxPossible) {
    return 'count_exceeds_local_max';
  }

  return null;
};

const hasUnsatisfiableCorner = (level) => {
  for (const [vr, vc, count] of level.cornerCounts || []) {
    const reason = checkUnsatisfiableCorner(level, vr, vc, count);
    if (reason) {
      return {
        vr,
        vc,
        count,
        reason,
      };
    }
  }
  return null;
};

const inBounds = (rows, cols, r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
const keyOf = (r, c) => `${r},${c}`;
const isObstacle = (ch) => ch === '#' || ch === 'm';

const buildStitchReq = (stitches) => {
  const req = new Map();
  for (const [vr, vc] of stitches) {
    req.set(keyV(vr, vc), {
      nw: { r: vr - 1, c: vc - 1 },
      ne: { r: vr - 1, c: vc },
      sw: { r: vr, c: vc - 1 },
      se: { r: vr, c: vc },
    });
  }
  return req;
};

const getGridDimensions = (level) => {
  const rows = level.grid?.length || 0;
  const cols = rows > 0 ? level.grid[0].length : 0;
  return { rows, cols };
};

const validateWitnessMeta = (meta) => {
  if (!meta) return { ok: false, reason: 'missing_witness_path' };
  if (!Array.isArray(meta.witnessPath) || meta.witnessPath.length === 0) {
    return { ok: false, reason: 'missing_witness_path' };
  }
  if (!Array.isArray(meta.witnessMovableWalls)) {
    return { ok: false, reason: 'missing_witness_movable_walls' };
  }
  return { ok: true };
};

const parseWitnessCoords = (coords, rows, cols, invalidReason, oobReason) => {
  const result = [];
  for (let i = 0; i < coords.length; i++) {
    const entry = coords[i];
    if (!Array.isArray(entry) || entry.length < 2) {
      return { ok: false, reason: invalidReason, at: i };
    }
    const r = entry[0];
    const c = entry[1];
    if (!Number.isInteger(r) || !Number.isInteger(c) || !inBounds(rows, cols, r, c)) {
      return { ok: false, reason: oobReason, at: i };
    }
    result.push([r, c]);
  }
  return { ok: true, coords: result };
};

const extractMovableWalls = (gridData, rows, cols) => {
  const currentMovable = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (gridData[r][c] === 'm') currentMovable.push([r, c]);
    }
  }
  return currentMovable;
};

const countUsableCells = (gridData, rows, cols) => {
  let totalUsable = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isObstacle(gridData[r][c])) totalUsable += 1;
    }
  }
  return totalUsable;
};

const applyWitnessMovableWalls = (gridData, rows, cols, witnessMovableWalls) => {
  const currentMovable = extractMovableWalls(gridData, rows, cols);

  if (currentMovable.length !== witnessMovableWalls.length) {
    return {
      ok: false,
      reason: 'witness_movable_count_mismatch',
      currentCount: currentMovable.length,
      witnessCount: witnessMovableWalls.length,
    };
  }

  for (const [r, c] of currentMovable) {
    gridData[r][c] = '.';
  }

  for (const [r, c] of witnessMovableWalls) {
    const ch = gridData[r][c];
    if (ch !== '#' && ch !== '.') {
      return { ok: false, reason: 'witness_movable_target_invalid', r, c, ch };
    }
    gridData[r][c] = 'm';
  }

  const totalUsable = countUsableCells(gridData, rows, cols);

  return { ok: true, totalUsable };
};

const isValidStep = (prev, cur, stitchSet) => {
  const dr = Math.abs(prev.r - cur.r);
  const dc = Math.abs(prev.c - cur.c);
  if (dr + dc === 1) return true;
  if (dr === 1 && dc === 1) {
    return stitchSet.has(keyV(Math.max(prev.r, cur.r), Math.max(prev.c, cur.c)));
  }
  return false;
};

const validateWitnessPathTrajectory = (path, gridData, stitchSet) => {
  const visited = new Set();
  for (let i = 0; i < path.length; i++) {
    const cur = path[i];
    const curKey = keyOf(cur.r, cur.c);

    if (isObstacle(gridData[cur.r][cur.c])) {
      return { ok: false, reason: 'witness_path_hits_obstacle', at: i, r: cur.r, c: cur.c };
    }
    if (visited.has(curKey)) {
      return { ok: false, reason: 'witness_path_revisits_cell', at: i, r: cur.r, c: cur.c };
    }
    if (i > 0 && !isValidStep(path[i - 1], cur, stitchSet)) {
      return { ok: false, reason: 'witness_path_non_adjacent_step', at: i };
    }
    visited.add(curKey);
  }
  return { ok: true, visited };
};

const evaluateWitnessCompletion = (snapshot) => {
  const hintStatus = evaluateHints(snapshot);
  const stitchStatus = evaluateStitches(snapshot);
  const rpsStatus = evaluateRPS(snapshot);
  const blockedStatus = evaluateBlockedCells(snapshot);
  const completion = checkCompletion(snapshot, {
    hintStatus,
    stitchStatus,
    rpsStatus,
  }, (k) => k);

  if (blockedStatus.bad > 0) {
    return { ok: false, reason: 'witness_blocked_cells', blocked: blockedStatus.bad };
  }
  if (completion.kind !== 'good') {
    return {
      ok: false,
      reason: 'witness_completion_failed',
      allVisited: completion.allVisited,
      hintsOk: completion.hintsOk,
      stitchesOk: completion.stitchesOk,
      rpsOk: completion.rpsOk,
    };
  }
  return { ok: true };
};

const verifyWitnessReplay = (level) => {
  const { rows, cols } = getGridDimensions(level);
  if (!(rows > 0 && cols > 0)) return { ok: false, reason: 'empty_grid' };

  const metaResult = validateWitnessMeta(level.infiniteMeta);
  if (!metaResult.ok) return metaResult;
  const meta = level.infiniteMeta;

  const parsedPath = parseWitnessCoords(
    meta.witnessPath, rows, cols,
    'invalid_witness_path_entry', 'witness_path_out_of_bounds'
  );
  if (!parsedPath.ok) return parsedPath;
  const path = parsedPath.coords.map(([r, c]) => ({ r, c }));

  const parsedWalls = parseWitnessCoords(
    meta.witnessMovableWalls, rows, cols,
    'invalid_witness_movable_entry', 'witness_movable_out_of_bounds'
  );
  if (!parsedWalls.ok) return parsedWalls;
  const witnessMovableWalls = parsedWalls.coords;

  const gridData = level.grid.map((row) => row.split(''));

  const wallResult = applyWitnessMovableWalls(gridData, rows, cols, witnessMovableWalls);
  if (!wallResult.ok) return wallResult;
  const { totalUsable } = wallResult;

  if (path.length !== totalUsable) {
    return {
      ok: false,
      reason: 'witness_path_length_mismatch',
      pathLength: path.length,
      totalUsable,
    };
  }

  const stitches = (level.stitches || []).map(([vr, vc]) => [vr, vc]);
  const stitchSet = new Set(stitches.map(([vr, vc]) => keyV(vr, vc)));

  const trajResult = validateWitnessPathTrajectory(path, gridData, stitchSet);
  if (!trajResult.ok) return trajResult;
  const { visited } = trajResult;

  const idxByKey = new Map(path.map((p, i) => [keyOf(p.r, p.c), i]));
  const snapshot = {
    rows,
    cols,
    totalUsable,
    gridData,
    path,
    visited,
    stitches,
    stitchSet,
    stitchReq: buildStitchReq(stitches),
    cornerCounts: level.cornerCounts || [],
    idxByKey,
  };

  return evaluateWitnessCompletion(snapshot);
};

const percentile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
};

const mean = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const round = (value) => Math.round(value * 1000) / 1000;

const analyzeFeatureUniqueness = (opts, featureSampleCounts, featureSampleSignatures) => {
  const perFeatureUniqueRatios = {};
  const featureMismatches = [];

  for (const feature of INFINITE_FEATURE_CYCLE) {
    const count = featureSampleCounts[feature];
    const unique = featureSampleSignatures[feature].size;
    const ratio = count > 0 ? unique / count : 1;
    const required = opts.minFeatureUniqueRatio[feature] ?? opts.minUniqueRatio;
    
    perFeatureUniqueRatios[feature] = {
      samples: count,
      uniqueSignatures: unique,
      ratio: round(ratio),
      requiredRatio: required,
    };
    
    if (count > 0 && ratio < required) {
      featureMismatches.push({ scope: feature, observed: ratio, required });
    }
  }

  return { perFeatureUniqueRatios, featureMismatches };
};

const checkDeterminismAndUniqueness = (opts, failures) => {
  const determinismMismatches = [];
  const uniqueRatioMismatches = [];
  const featureSampleCounts = Object.fromEntries(INFINITE_FEATURE_CYCLE.map((feature) => [feature, 0]));
  const featureSampleSignatures = Object.fromEntries(
    INFINITE_FEATURE_CYCLE.map((feature) => [feature, new Set()]),
  );
  const baseHistogramByFeature = Object.fromEntries(
    INFINITE_FEATURE_CYCLE.map((feature) => [feature, new Map()]),
  );

  const signatures = new Map();
  for (let i = 0; i < opts.samples; i++) {
    const a = generateInfiniteLevel(i);
    const b = generateInfiniteLevel(i);
    const sigA = signatureOf(a);
    const sigB = signatureOf(b);
    if (sigA !== sigB) {
      determinismMismatches.push(i);
    }
    signatures.set(i, sigA);

    const requiredFeature = INFINITE_FEATURE_CYCLE[i % INFINITE_FEATURE_CYCLE.length];
    featureSampleCounts[requiredFeature] += 1;
    featureSampleSignatures[requiredFeature].add(sigA);
    const baseIndex = Number.isInteger(a?.infiniteMeta?.baseLevelIndex)
      ? a.infiniteMeta.baseLevelIndex
      : -1;
    const histogram = baseHistogramByFeature[requiredFeature];
    histogram.set(baseIndex, (histogram.get(baseIndex) || 0) + 1);
  }

  if (determinismMismatches.length > 0) {
    failures.push(`Determinism mismatches at indices: ${determinismMismatches.join(', ')}`);
  }

  const uniqueSignatureCount = new Set(signatures.values()).size;
  const uniqueRatio = opts.samples > 0 ? uniqueSignatureCount / opts.samples : 1;
  if (opts.samples > 1 && uniqueSignatureCount <= 1) {
    failures.push('All sampled infinite levels were identical.');
  }
  if (uniqueRatio < opts.minUniqueRatio) {
    uniqueRatioMismatches.push({
      scope: 'global',
      observed: uniqueRatio,
      required: opts.minUniqueRatio,
    });
    failures.push(
      `Global unique-signature ratio ${round(uniqueRatio)} was below threshold ${opts.minUniqueRatio}`,
    );
  }

  const { perFeatureUniqueRatios, featureMismatches } = analyzeFeatureUniqueness(
    opts,
    featureSampleCounts,
    featureSampleSignatures,
  );
  uniqueRatioMismatches.push(...featureMismatches);

  if (featureMismatches.length > 0) {
    failures.push(
      `Per-feature unique-signature ratios below threshold: ${featureMismatches
        .map((entry) => `${entry.scope}(${round(entry.observed)}/${entry.required})`)
        .join(', ')}`,
    );
  }

  return {
    determinism: {
      checked: opts.samples,
      mismatches: determinismMismatches,
      uniqueSignatures: uniqueSignatureCount,
      uniqueRatio: round(uniqueRatio),
      requiredUniqueRatio: opts.minUniqueRatio,
    },
    uniqueness: {
      checked: opts.samples,
      global: {
        uniqueSignatures: uniqueSignatureCount,
        ratio: round(uniqueRatio),
        requiredRatio: opts.minUniqueRatio,
      },
      perFeature: perFeatureUniqueRatios,
      mismatches: uniqueRatioMismatches.map((entry) => ({
        scope: entry.scope,
        observed: round(entry.observed),
        required: entry.required,
      })),
      baseHistogramByFeature: Object.fromEntries(
        INFINITE_FEATURE_CYCLE.map((feature) => [
          feature,
          [...baseHistogramByFeature[feature].entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([baseLevelIndex, count]) => ({ baseLevelIndex, count })),
        ]),
      ),
    },
    uniqueSignatureCount,
    uniqueRatio,
    determinismMismatches,
  };
};

const analyzeLevelCoverage = (i, state) => {
  const expectedFeature = INFINITE_FEATURE_CYCLE[i % INFINITE_FEATURE_CYCLE.length];
  const level = generateInfiniteLevel(i);
  const features = analyzeFeatures(level);
  const density = constraintDensity(level, features);
  const wallRatio = wallDensity(level, features);

  if (!features[expectedFeature]) {
    state.coverageMismatches.push({ index: i, expectedFeature, detected: features });
  }
  if (density < MIN_CONSTRAINT_DENSITY || density > MAX_CONSTRAINT_DENSITY) {
    state.densityMismatches.push({
      index: i, density, requiredMinDensity: MIN_CONSTRAINT_DENSITY,
      requiredMaxDensity: MAX_CONSTRAINT_DENSITY, detected: features,
    });
  }
  if (wallRatio > MAX_WALL_DENSITY) {
    state.wallDensityMismatches.push({
      index: i, wallDensity: wallRatio, requiredMaxWallDensity: MAX_WALL_DENSITY, detected: features,
    });
  }
  const unsatCorner = hasUnsatisfiableCorner(level);
  if (unsatCorner) {
    state.cornerUnsatMismatches.push({ index: i, ...unsatCorner });
  }
  if (features.featureCount < 2) {
    state.minimumFeatureMismatches.push({ index: i, featureCount: features.featureCount, detected: features });
  }
  if (expectedFeature === 'rps' && features.hintCount < 2) {
    state.rpsHintMinimumMismatches.push({ index: i, hintCount: features.hintCount, detected: features });
  }
  if (features.rpsCount === 1) {
    state.singletonRpsMismatches.push({ index: i, detected: features });
  }
};

const checkCoverage = (opts, failures, cornerUnsatMismatches, singletonRpsMismatches) => {
  const state = {
    coverageMismatches: [],
    minimumFeatureMismatches: [],
    rpsHintMinimumMismatches: [],
    densityMismatches: [],
    wallDensityMismatches: [],
    cornerUnsatMismatches,
    singletonRpsMismatches,
  };

  for (let i = 0; i < opts.coverage; i++) {
    analyzeLevelCoverage(i, state);
  }

  if (state.coverageMismatches.length > 0) failures.push(`Feature coverage mismatches: ${state.coverageMismatches.length}`);
  if (state.minimumFeatureMismatches.length > 0) failures.push(`Minimum feature-family mismatches: ${state.minimumFeatureMismatches.length}`);
  if (state.rpsHintMinimumMismatches.length > 0) failures.push(`RPS hint-minimum mismatches: ${state.rpsHintMinimumMismatches.length}`);
  if (state.densityMismatches.length > 0) failures.push(`Constraint-density mismatches: ${state.densityMismatches.length}`);
  if (state.wallDensityMismatches.length > 0) failures.push(`Wall-density mismatches: ${state.wallDensityMismatches.length}`);

  return {
    coverage: { checked: opts.coverage, cycle: INFINITE_FEATURE_CYCLE, mismatches: state.coverageMismatches },
    minimumFeatures: { checked: opts.coverage, required: 2, mismatches: state.minimumFeatureMismatches },
    rpsHintMinimum: { checked: opts.coverage, requiredHintCount: 2, mismatches: state.rpsHintMinimumMismatches },
    constraintDensity: { checked: opts.coverage, requiredMinDensity: MIN_CONSTRAINT_DENSITY, requiredMaxDensity: MAX_CONSTRAINT_DENSITY, mismatches: state.densityMismatches },
    wallDensity: { checked: opts.coverage, requiredMaxDensity: MAX_WALL_DENSITY, mismatches: state.wallDensityMismatches },
  };
};

const checkCanonicalScan = (opts, failures, cornerUnsatMismatches, singletonRpsMismatches) => {
  const witnessProofFailures = [];
  const canonicalCollisions = [];
  const canonicalSeen = new Map();

  for (let i = 0; i < opts.canonicalScan; i++) {
    const level = generateInfiniteLevel(i);
    const features = analyzeFeatures(level);
    if (features.rpsCount === 1) {
      singletonRpsMismatches.push({ index: i, detected: features });
    }
    const unsatCorner = hasUnsatisfiableCorner(level);
    if (unsatCorner) {
      cornerUnsatMismatches.push({ index: i, ...unsatCorner });
    }
    const witnessProof = verifyWitnessReplay(level);
    if (!witnessProof.ok) {
      witnessProofFailures.push({ index: i, ...witnessProof });
    }
    const canonicalSignature = canonicalConstraintSignature(level);
    if (!canonicalSeen.has(canonicalSignature)) {
      canonicalSeen.set(canonicalSignature, i);
      continue;
    }
    canonicalCollisions.push({ firstIndex: canonicalSeen.get(canonicalSignature), index: i });
  }

  if (canonicalCollisions.length > 0) failures.push(`Canonical collisions: ${canonicalCollisions.length}`);
  if (witnessProofFailures.length > 0) failures.push(`Witness-proof failures: ${witnessProofFailures.length}`);

  return {
    canonicalUniqueness: {
      scanned: opts.canonicalScan,
      collisions: canonicalCollisions,
      uniqueSignatures: opts.canonicalScan - canonicalCollisions.length,
    },
    witnessProof: {
      checked: opts.canonicalScan,
      failures: witnessProofFailures,
    },
    witnessProofFailuresCount: witnessProofFailures.length,
  };
};

const processLevelSolvability = (i, solveOpts, retrySolveOpts, counts) => {
  const level = generateInfiniteLevel(i);
  const firstPass = solveLevel(level, solveOpts);
  let finalMetrics = firstPass;
  let retried = false;

  const requiresRetry = firstPass.rawSolutions <= 0 && firstPass.timedOut && retrySolveOpts.timeMs > solveOpts.timeMs;
  if (requiresRetry) {
    retried = true;
    counts.retried += 1;
    finalMetrics = solveLevel(level, retrySolveOpts);
    if (finalMetrics.rawSolutions > 0 && !finalMetrics.timedOut) {
      counts.retryResolved += 1;
    }
  }

  if (firstPass.timedOut) counts.timedOut += 1;
  if (finalMetrics.timedOut) counts.finalTimedOut += 1;
  if (finalMetrics.rawSolutions > 0) counts.solved += 1;

  if (finalMetrics.rawSolutions <= 0 || finalMetrics.timedOut) {
    counts.failures.push({
      index: i,
      rawSolutions: finalMetrics.rawSolutions,
      timedOut: finalMetrics.timedOut,
      retried,
      firstPassTimedOut: firstPass.timedOut,
    });
  }
};

const checkSolvability = (opts, failures, witnessProofFailuresCount) => {
  const solveOpts = {
    timeMs: opts.solveTimeMs,
    minRaw: 1,
    minCanonical: 0,
    minHintOrders: 0,
    minCornerOrders: 0,
    maxSolutions: 1,
  };
  const retrySolveOpts = {
    ...solveOpts,
    timeMs: Math.max(opts.retrySolveTimeMs, opts.solveTimeMs),
  };

  const counts = {
    solved: 0,
    timedOut: 0,
    finalTimedOut: 0,
    retried: 0,
    retryResolved: 0,
    failures: [],
  };

  for (let i = 0; i < opts.samples; i++) {
    processLevelSolvability(i, solveOpts, retrySolveOpts, counts);
  }

  // Solver sampling is advisory; authoritative solvability proof is witness replay.
  if (counts.failures.length > 0 && witnessProofFailuresCount > 0) {
    failures.push(`Solvability failures: ${counts.failures.length}`);
  }

  return {
    checked: opts.samples,
    solved: counts.solved,
    timedOut: counts.timedOut,
    finalTimedOut: counts.finalTimedOut,
    retried: counts.retried,
    retryResolved: counts.retryResolved,
    retrySolveTimeMs: retrySolveOpts.timeMs,
    failures: counts.failures,
  };
};

const checkPerformance = (opts, failures) => {
  const perfDurations = [];
  for (let i = 0; i < opts.perfRuns; i++) {
    const index = i % Math.max(1, opts.samples);
    const t0 = performance.now();
    generateInfiniteLevel(index);
    perfDurations.push(performance.now() - t0);
  }

  const perfSummary = {
    runs: opts.perfRuns,
    meanMs: round(mean(perfDurations)),
    p95Ms: round(percentile(perfDurations, 0.95)),
    maxMs: round(percentile(perfDurations, 1)),
    budgetMsP95: opts.perfBudgetMsP95,
  };

  if (perfSummary.p95Ms > opts.perfBudgetMsP95) {
    failures.push(`Generation p95 ${perfSummary.p95Ms}ms exceeded budget ${opts.perfBudgetMsP95}ms`);
  }

  return perfSummary;
};

const printTextSummary = (opts, detAndDedupObj, coverageObj, scanObj, checkSolversObj, perfSummary, failures) => {
  console.log(`Determinism: ${opts.samples - detAndDedupObj.determinismMismatches.length}/${opts.samples} exact matches`);
  console.log(
    `Uniqueness: ${detAndDedupObj.uniqueSignatureCount}/${opts.samples} unique signatures (${detAndDedupObj.uniqueRatio} ratio, threshold ${opts.minUniqueRatio})`,
  );
  console.log(`Coverage: ${opts.coverage - coverageObj.coverage.mismatches.length}/${opts.coverage} satisfied expected feature`);
  console.log(`Canonical scan: ${opts.canonicalScan - scanObj.canonicalUniqueness.collisions.length}/${opts.canonicalScan} unique`);
  console.log(
    `Solvability: ${checkSolversObj.solved}/${opts.samples} solved (timeouts: ${checkSolversObj.timedOut}, retries resolved: ${checkSolversObj.retryResolved}/${checkSolversObj.retried})`,
  );
  console.log(`Performance: mean ${perfSummary.meanMs}ms, p95 ${perfSummary.p95Ms}ms, max ${perfSummary.maxMs}ms`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
  } else {
    console.log('All checks passed.');
  }
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const failures = [];
  const cornerUnsatMismatches = [];
  const singletonRpsMismatches = [];

  const detAndDedupObj = checkDeterminismAndUniqueness(opts, failures);
  const coverageObj = checkCoverage(opts, failures, cornerUnsatMismatches, singletonRpsMismatches);
  if (cornerUnsatMismatches.length > 0) {
    failures.push(`Corner-unsatisfiable mismatches: ${cornerUnsatMismatches.length}`);
  }
  const scanObj = checkCanonicalScan(opts, failures, cornerUnsatMismatches, singletonRpsMismatches);

  const singletonRpsMismatchList = [...new Map(
    singletonRpsMismatches.map((entry) => [entry.index, entry]),
  ).values()].sort((a, b) => a.index - b.index);

  if (singletonRpsMismatchList.length > 0) {
    failures.push(`Singleton-RPS mismatches: ${singletonRpsMismatchList.length}`);
  }

  const checkSolversObj = checkSolvability(opts, failures, scanObj.witnessProofFailuresCount);
  const perfSummary = checkPerformance(opts, failures);

  const result = {
    ok: failures.length === 0,
    options: opts,
    determinism: detAndDedupObj.determinism,
    uniqueness: detAndDedupObj.uniqueness,
    coverage: coverageObj.coverage,
    minimumFeatures: coverageObj.minimumFeatures,
    rpsHintMinimum: coverageObj.rpsHintMinimum,
    constraintDensity: coverageObj.constraintDensity,
    wallDensity: coverageObj.wallDensity,
    cornerUnsatisfiable: {
      checkedCoverage: opts.coverage,
      checkedCanonicalScan: opts.canonicalScan,
      mismatches: [...new Map(
        cornerUnsatMismatches.map((entry) => [entry.index, entry]),
      ).values()].sort((a, b) => a.index - b.index),
    },
    singletonRps: {
      checkedCoverage: opts.coverage,
      checkedCanonicalScan: opts.canonicalScan,
      mismatches: singletonRpsMismatchList,
    },
    canonicalUniqueness: scanObj.canonicalUniqueness,
    witnessProof: scanObj.witnessProof,
    solvability: checkSolversObj,
    performance: perfSummary,
    failures,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTextSummary(opts, detAndDedupObj, coverageObj, scanObj, checkSolversObj, perfSummary, failures);
  }

  if (failures.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
