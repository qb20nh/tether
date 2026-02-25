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
import { solveLevel } from './verify_level_properties.js';

const HINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v']);
const RPS_CODES = new Set(['g', 'b', 'p']);
const DEFAULT_FEATURE_UNIQUE_RATIO = Object.freeze(
  Object.fromEntries(INFINITE_FEATURE_CYCLE.map((feature) => [feature, feature === 'corner' ? 0.10 : 0.25])),
);

const DEFAULTS = {
  samples: 30,
  coverage: 30,
  canonicalScan: INFINITE_MAX_LEVELS,
  solveTimeMs: 1200,
  retrySolveTimeMs: 5000,
  perfRuns: 500,
  perfBudgetMsP95: 300,
  minUniqueRatio: 0.40,
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

const parseFeatureUniqueRatio = (value) => {
  const input = String(value || '').trim();
  if (!input) return {};

  let raw;
  if (input.startsWith('{')) {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new Error(`--min-feature-unique-ratio JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('--min-feature-unique-ratio JSON must be an object');
    }
  } else {
    raw = {};
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
  }

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
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '#' || ch === 'm') wallCount += 1;
      if (HINT_CODES.has(ch)) {
        hasHint = true;
        hintCount += 1;
        cellConstraintCount += 1;
      }
      if (RPS_CODES.has(ch)) {
        hasRps = true;
        rpsCount += 1;
        cellConstraintCount += 1;
      }
      if (ch === 'm') hasMovable = true;
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
  if (!(features.nonWallCellCount > 0)) return 0;
  return features.constraintTokenCount / features.nonWallCellCount;
};

const wallDensity = (level, features) => {
  const rows = level.grid?.length || 0;
  const cols = rows > 0 ? level.grid[0].length : 0;
  const totalCells = rows * cols;
  if (!(totalCells > 0)) return 0;
  return features.wallCount / totalCells;
};

const isWallCell = (level, r, c) => {
  const row = level.grid?.[r];
  if (!row) return false;
  const ch = row[c];
  return ch === '#' || ch === 'm';
};

const hasUnsatisfiableCorner = (level) => {
  for (const [vr, vc, count] of level.cornerCounts || []) {
    const nw = isWallCell(level, vr - 1, vc - 1);
    const ne = isWallCell(level, vr - 1, vc);
    const sw = isWallCell(level, vr, vc - 1);
    const se = isWallCell(level, vr, vc);
    const wallCount = (nw ? 1 : 0) + (ne ? 1 : 0) + (sw ? 1 : 0) + (se ? 1 : 0);
    const diagonalWalls = (nw && se) || (ne && sw);

    let maxPossible = 0;
    if (!nw && !ne) maxPossible += 1;
    if (!nw && !sw) maxPossible += 1;
    if (!ne && !se) maxPossible += 1;
    if (!sw && !se) maxPossible += 1;

    if (wallCount > 3) {
      return {
        vr,
        vc,
        count,
        reason: 'more_than_3_walls',
      };
    }
    if (count === 0 && diagonalWalls) {
      return {
        vr,
        vc,
        count,
        reason: 'zero_with_diagonal_walls',
      };
    }
    if (count > maxPossible) {
      return {
        vr,
        vc,
        count,
        reason: 'count_exceeds_local_max',
      };
    }
  }
  return null;
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const failures = [];
  const determinismMismatches = [];
  const coverageMismatches = [];
  const minimumFeatureMismatches = [];
  const rpsHintMinimumMismatches = [];
  const densityMismatches = [];
  const wallDensityMismatches = [];
  const cornerUnsatMismatches = [];
  const singletonRpsMismatches = [];
  const canonicalCollisions = [];
  const solvabilityFailures = [];
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

  const perFeatureUniqueRatios = {};
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
      uniqueRatioMismatches.push({
        scope: feature,
        observed: ratio,
        required,
      });
    }
  }
  if (uniqueRatioMismatches.some((entry) => entry.scope !== 'global')) {
    failures.push(
      `Per-feature unique-signature ratios below threshold: ${uniqueRatioMismatches
        .filter((entry) => entry.scope !== 'global')
        .map((entry) => `${entry.scope}(${round(entry.observed)}/${entry.required})`)
        .join(', ')}`,
    );
  }

  for (let i = 0; i < opts.coverage; i++) {
    const expectedFeature = INFINITE_FEATURE_CYCLE[i % INFINITE_FEATURE_CYCLE.length];
    const level = generateInfiniteLevel(i);
    const features = analyzeFeatures(level);
    const density = constraintDensity(level, features);
    const wallRatio = wallDensity(level, features);
    if (!features[expectedFeature]) {
      coverageMismatches.push({
        index: i,
        expectedFeature,
        detected: features,
      });
    }
    if (density < MIN_CONSTRAINT_DENSITY || density > MAX_CONSTRAINT_DENSITY) {
      densityMismatches.push({
        index: i,
        density,
        requiredMinDensity: MIN_CONSTRAINT_DENSITY,
        requiredMaxDensity: MAX_CONSTRAINT_DENSITY,
        detected: features,
      });
    }
    if (wallRatio > MAX_WALL_DENSITY) {
      wallDensityMismatches.push({
        index: i,
        wallDensity: wallRatio,
        requiredMaxWallDensity: MAX_WALL_DENSITY,
        detected: features,
      });
    }
    const unsatCorner = hasUnsatisfiableCorner(level);
    if (unsatCorner) {
      cornerUnsatMismatches.push({
        index: i,
        ...unsatCorner,
      });
    }
    if (features.featureCount < 2) {
      minimumFeatureMismatches.push({
        index: i,
        featureCount: features.featureCount,
        detected: features,
      });
    }
    if (expectedFeature === 'rps' && features.hintCount < 2) {
      rpsHintMinimumMismatches.push({
        index: i,
        hintCount: features.hintCount,
        detected: features,
      });
    }
    if (features.rpsCount === 1) {
      singletonRpsMismatches.push({
        index: i,
        detected: features,
      });
    }
  }

  if (coverageMismatches.length > 0) {
    failures.push(`Feature coverage mismatches: ${coverageMismatches.length}`);
  }
  if (minimumFeatureMismatches.length > 0) {
    failures.push(`Minimum feature-family mismatches: ${minimumFeatureMismatches.length}`);
  }
  if (rpsHintMinimumMismatches.length > 0) {
    failures.push(`RPS hint-minimum mismatches: ${rpsHintMinimumMismatches.length}`);
  }
  if (densityMismatches.length > 0) {
    failures.push(`Constraint-density mismatches: ${densityMismatches.length}`);
  }
  if (wallDensityMismatches.length > 0) {
    failures.push(`Wall-density mismatches: ${wallDensityMismatches.length}`);
  }
  if (cornerUnsatMismatches.length > 0) {
    failures.push(`Corner-unsatisfiable mismatches: ${cornerUnsatMismatches.length}`);
  }

  const canonicalSeen = new Map();
  for (let i = 0; i < opts.canonicalScan; i++) {
    const level = generateInfiniteLevel(i);
    const features = analyzeFeatures(level);
    if (features.rpsCount === 1) {
      singletonRpsMismatches.push({
        index: i,
        detected: features,
      });
    }
    const unsatCorner = hasUnsatisfiableCorner(level);
    if (unsatCorner) {
      cornerUnsatMismatches.push({
        index: i,
        ...unsatCorner,
      });
    }
    const canonicalSignature = canonicalConstraintSignature(level);
    if (!canonicalSeen.has(canonicalSignature)) {
      canonicalSeen.set(canonicalSignature, i);
      continue;
    }
    canonicalCollisions.push({
      firstIndex: canonicalSeen.get(canonicalSignature),
      index: i,
    });
  }
  if (canonicalCollisions.length > 0) {
    failures.push(`Canonical collisions: ${canonicalCollisions.length}`);
  }
  const singletonRpsMismatchList = [...new Map(
    singletonRpsMismatches.map((entry) => [entry.index, entry]),
  ).values()].sort((a, b) => a.index - b.index);
  if (singletonRpsMismatchList.length > 0) {
    failures.push(`Singleton-RPS mismatches: ${singletonRpsMismatchList.length}`);
  }

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

  let solvedCount = 0;
  let timedOutCount = 0;
  let finalTimedOutCount = 0;
  let retriedCount = 0;
  let retryResolvedCount = 0;
  for (let i = 0; i < opts.samples; i++) {
    const level = generateInfiniteLevel(i);
    const firstPass = solveLevel(level, solveOpts);
    let finalMetrics = firstPass;
    let retried = false;

    if (firstPass.timedOut) timedOutCount += 1;
    if (firstPass.rawSolutions <= 0 && firstPass.timedOut && retrySolveOpts.timeMs > solveOpts.timeMs) {
      retried = true;
      retriedCount += 1;
      finalMetrics = solveLevel(level, retrySolveOpts);
      if (finalMetrics.rawSolutions > 0 && !finalMetrics.timedOut) {
        retryResolvedCount += 1;
      }
    }

    if (finalMetrics.timedOut) finalTimedOutCount += 1;
    if (finalMetrics.rawSolutions > 0) solvedCount += 1;
    if (finalMetrics.rawSolutions <= 0 || finalMetrics.timedOut) {
      solvabilityFailures.push({
        index: i,
        rawSolutions: finalMetrics.rawSolutions,
        timedOut: finalMetrics.timedOut,
        retried,
        firstPassTimedOut: firstPass.timedOut,
      });
    }
  }

  if (solvabilityFailures.length > 0) {
    failures.push(`Solvability failures: ${solvabilityFailures.length}`);
  }

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

  const result = {
    ok: failures.length === 0,
    options: opts,
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
    coverage: {
      checked: opts.coverage,
      cycle: INFINITE_FEATURE_CYCLE,
      mismatches: coverageMismatches,
    },
    minimumFeatures: {
      checked: opts.coverage,
      required: 2,
      mismatches: minimumFeatureMismatches,
    },
    rpsHintMinimum: {
      checked: opts.coverage,
      requiredHintCount: 2,
      mismatches: rpsHintMinimumMismatches,
    },
    constraintDensity: {
      checked: opts.coverage,
      requiredMinDensity: MIN_CONSTRAINT_DENSITY,
      requiredMaxDensity: MAX_CONSTRAINT_DENSITY,
      mismatches: densityMismatches,
    },
    wallDensity: {
      checked: opts.coverage,
      requiredMaxDensity: MAX_WALL_DENSITY,
      mismatches: wallDensityMismatches,
    },
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
    canonicalUniqueness: {
      scanned: opts.canonicalScan,
      collisions: canonicalCollisions,
      uniqueSignatures: opts.canonicalScan - canonicalCollisions.length,
    },
    solvability: {
      checked: opts.samples,
      solved: solvedCount,
      timedOut: timedOutCount,
      finalTimedOut: finalTimedOutCount,
      retried: retriedCount,
      retryResolved: retryResolvedCount,
      retrySolveTimeMs: retrySolveOpts.timeMs,
      failures: solvabilityFailures,
    },
    performance: perfSummary,
    failures,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Determinism: ${opts.samples - determinismMismatches.length}/${opts.samples} exact matches`);
    console.log(
      `Uniqueness: ${uniqueSignatureCount}/${opts.samples} unique signatures (${round(uniqueRatio)} ratio, threshold ${opts.minUniqueRatio})`,
    );
    console.log(`Coverage: ${opts.coverage - coverageMismatches.length}/${opts.coverage} satisfied expected feature`);
    console.log(`Canonical scan: ${opts.canonicalScan - canonicalCollisions.length}/${opts.canonicalScan} unique`);
    console.log(
      `Solvability: ${solvedCount}/${opts.samples} solved (timeouts: ${timedOutCount}, retries resolved: ${retryResolvedCount}/${retriedCount})`,
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
  }

  if (failures.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
