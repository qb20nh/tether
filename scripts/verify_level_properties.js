#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LEVEL_INDEX, LEVELS } from '../src/levels.js';
import { HINT_CODES } from '../src/config.js';
import { parseLevel, keyOf, keyV } from '../src/utils.js';
import {
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../src/rules.js';

const CONSTRAINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v', 'g', 'b', 'p']);
const ORTH_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const ALL_DIRS = [
  ...ORTH_DIRS,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const UINT32 = 0x100000000;
const GOLDEN_RATIO_32 = 0x9e3779b9;
const DIFFICULTY_VERSION = 1;
const LEVELS_FILE_PATH = fileURLToPath(new URL('../src/levels.js', import.meta.url));
const KNOWN_LEVEL_KEYS = [
  'name',
  'nameKey',
  'desc',
  'descKey',
  'grid',
  'stitches',
  'cornerCounts',
  'difficulty',
];

export const DIFFICULTY_PROFILES = {
  standard256: {
    trials: 256,
    trialNodeCap: 25000,
  },
  lite96: {
    trials: 96,
    trialNodeCap: 18000,
  },
  heavy512: {
    trials: 512,
    trialNodeCap: 35000,
  },
};

const DEFAULTS = {
  minRaw: 1,
  minCanonical: 2,
  minHintOrders: 0,
  minCornerOrders: 0,
  maxSolutions: 20000,
  timeMs: 30000,
  difficulty: false,
  difficultyProfile: 'standard256',
  difficultyProofTimeMs: 30000,
  difficultyProofNodeCap: 5000000,
};

const usage = () => {
  console.log(
    [
      'Usage:',
      '  node scripts/verify_level_properties.js [options]',
      '',
      'Options:',
      '  --level <selector>                  Level index, nameKey, or name. Repeatable.',
      '  --min-raw <n>                       Minimum raw solutions (default: 1).',
      '  --min-canonical <n>                 Minimum canonical solutions (default: 2).',
      '  --min-hint-orders <n>               Minimum distinct hint-visit orders (default: 0).',
      '  --min-corner-orders <n>             Minimum distinct corner-satisfaction orders (default: 0).',
      '  --max-solutions <n>                 Early stop after this many raw solutions (default: 20000).',
      '  --time-ms <n>                       Per-level timeout in ms (default: 30000).',
      '  --difficulty                        Measure objective difficulty and write metadata.',
      '  --difficulty-profile <name>         One of: standard256, lite96, heavy512 (default: standard256).',
      '  --difficulty-proof-time-ms <n>      Unsat proof timeout in ms (default: 30000).',
      '  --difficulty-proof-node-cap <n>     Unsat proof DFS node cap (default: 5000000).',
      '  --json                              Output JSON summary.',
      '  --help                              Show this help.',
      '',
      'Examples:',
      '  node scripts/verify_level_properties.js --level level.tutorial_6.name',
      '  node scripts/verify_level_properties.js --level 18 --min-canonical 2 --min-hint-orders 2',
      '  node scripts/verify_level_properties.js --difficulty --difficulty-profile standard256',
      '  node scripts/verify_level_properties.js --difficulty --json',
    ].join('\n'),
  );
};

const toInt = (name, value) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${value}`);
  }
  return n;
};

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const roundFixed = (value, digits = 6) => {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const asInt = (value, fallback = 0) => {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) ? n : fallback;
};

function parseArgs(argv) {
  const opts = {
    levels: [],
    minRaw: DEFAULTS.minRaw,
    minCanonical: DEFAULTS.minCanonical,
    minHintOrders: DEFAULTS.minHintOrders,
    minCornerOrders: DEFAULTS.minCornerOrders,
    maxSolutions: DEFAULTS.maxSolutions,
    timeMs: DEFAULTS.timeMs,
    difficulty: DEFAULTS.difficulty,
    difficultyProfile: DEFAULTS.difficultyProfile,
    difficultyProofTimeMs: DEFAULTS.difficultyProofTimeMs,
    difficultyProofNodeCap: DEFAULTS.difficultyProofNodeCap,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[i];
    };

    if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--difficulty') {
      opts.difficulty = true;
    } else if (a === '--difficulty-profile') {
      const profile = next();
      if (!Object.hasOwn(DIFFICULTY_PROFILES, profile)) {
        throw new Error(
          `--difficulty-profile must be one of ${Object.keys(DIFFICULTY_PROFILES).join(', ')}, got: ${profile}`,
        );
      }
      opts.difficultyProfile = profile;
    } else if (a === '--difficulty-proof-time-ms') {
      opts.difficultyProofTimeMs = toInt('--difficulty-proof-time-ms', next());
    } else if (a === '--difficulty-proof-node-cap') {
      opts.difficultyProofNodeCap = toInt('--difficulty-proof-node-cap', next());
    } else if (a === '--level') {
      opts.levels.push(next());
    } else if (a === '--min-raw') {
      opts.minRaw = toInt('--min-raw', next());
    } else if (a === '--min-canonical') {
      opts.minCanonical = toInt('--min-canonical', next());
    } else if (a === '--min-hint-orders') {
      opts.minHintOrders = toInt('--min-hint-orders', next());
    } else if (a === '--min-corner-orders') {
      opts.minCornerOrders = toInt('--min-corner-orders', next());
    } else if (a === '--max-solutions') {
      opts.maxSolutions = toInt('--max-solutions', next());
    } else if (a === '--time-ms') {
      opts.timeMs = toInt('--time-ms', next());
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return opts;
}

function resolveLevelSelector(selector) {
  if (/^\d+$/.test(selector)) {
    const idx = Number.parseInt(selector, 10);
    if (idx < 0 || idx >= LEVELS.length) {
      throw new Error(`Level index out of range: ${selector}`);
    }
    return { index: idx, level: LEVELS[idx] };
  }

  const byKey = LEVELS.findIndex((lv) => lv.nameKey === selector);
  if (byKey >= 0) return { index: byKey, level: LEVELS[byKey] };

  const byName = LEVELS.findIndex((lv) => lv.name === selector);
  if (byName >= 0) return { index: byName, level: LEVELS[byName] };

  throw new Error(`Could not resolve level selector: ${selector}`);
}

const pathKey = (path) => path.map((p) => `${p.r},${p.c}`).join('|');
const canonicalPathKey = (path) => {
  const f = pathKey(path);
  const b = [...path].reverse().map((p) => `${p.r},${p.c}`).join('|');
  return f < b ? f : b;
};

const hintOrderSignature = (path, gridData) => {
  const parts = [];
  for (const p of path) {
    const ch = gridData[p.r][p.c];
    if (CONSTRAINT_CODES.has(ch)) parts.push(`${ch}@${p.r},${p.c}`);
  }
  return parts.join('>');
};

const edgeKey = (a, b) => {
  const ka = `${a.r},${a.c}`;
  const kb = `${b.r},${b.c}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const cornerCountFromEdges = (vr, vc, edgeSet) => {
  let count = 0;
  if (edgeSet.has(`${vr - 1},${vc - 1}|${vr - 1},${vc}`)) count++;
  if (edgeSet.has(`${vr - 1},${vc - 1}|${vr},${vc - 1}`)) count++;
  if (edgeSet.has(`${vr - 1},${vc}|${vr},${vc}`)) count++;
  if (edgeSet.has(`${vr},${vc - 1}|${vr},${vc}`)) count++;
  return count;
};

const cornerOrderSignature = (path, cornerCounts) => {
  if (!cornerCounts || cornerCounts.length === 0) return '';

  const edgeSet = new Set();
  const satisfied = new Set();
  const order = [];

  for (const [vr, vc, target] of cornerCounts) {
    const key = `${vr},${vc}`;
    if (target === 0) {
      satisfied.add(key);
      order.push(key);
    }
  }

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    if (Math.abs(prev.r - cur.r) + Math.abs(prev.c - cur.c) === 1) {
      edgeSet.add(edgeKey(prev, cur));
    }

    for (const [vr, vc, target] of cornerCounts) {
      const key = `${vr},${vc}`;
      if (satisfied.has(key)) continue;
      if (cornerCountFromEdges(vr, vc, edgeSet) === target) {
        satisfied.add(key);
        order.push(key);
      }
    }
  }

  return order.join('>');
};

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

const chooseCount = (n, k) => {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  return Math.round(result);
};

const compareCell = (a, b) => {
  if (a.r !== b.r) return a.r - b.r;
  return a.c - b.c;
};

const cloneGrid = (grid) => grid.map((row) => row.slice());

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

const makeRng = (seed) => {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
};

const shuffleInPlace = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
};

const percentile = (values, q) => {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
};

const mean = (values) => {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
};

const stddev = (values, avg) => {
  if (!values || values.length === 0) return 0;
  if (!Number.isFinite(avg)) return 0;
  let sumSq = 0;
  for (const v of values) {
    const d = v - avg;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
};

const sampleWalls = (movableCandidates, count, rng) => {
  if (count === 0) return [];
  const available = movableCandidates.slice();
  const chosen = [];
  for (let i = 0; i < count && available.length > 0; i++) {
    const pick = Math.floor(rng() * available.length);
    chosen.push(available[pick]);
    available.splice(pick, 1);
  }
  chosen.sort(compareCell);
  return chosen;
};

const wallPlacementSignature = (walls) => {
  if (!walls || walls.length === 0) return 'none';
  return walls.map((cell) => keyOf(cell.r, cell.c)).join(';');
};

export function buildLevelContext(level) {
  const parsed = parseLevel(level);
  const baseGrid = cloneGrid(parsed.g);
  const rows = parsed.rows;
  const cols = parsed.cols;
  const stitchSet = new Set(parsed.stitches.map(([vr, vc]) => keyV(vr, vc)));
  const stitchReq = buildStitchReq(parsed.stitches);
  const cornerCounts = parsed.cornerCounts || [];

  const movableWalls = [];
  const movableCandidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = baseGrid[r][c];
      if (ch === 'm') movableWalls.push({ r, c });
      if (ch === '.' || ch === 'm') movableCandidates.push({ r, c });
    }
  }

  return {
    level,
    parsed,
    baseGrid,
    rows,
    cols,
    stitchSet,
    stitchReq,
    cornerCounts,
    movableWalls,
    movableWallsCount: movableWalls.length,
    movableCandidates,
    wallPlacementsTotal: chooseCount(movableCandidates.length, movableWalls.length),
  };
}

function buildPlacementState(levelCtx, wallCells) {
  const gridData = cloneGrid(levelCtx.baseGrid);

  if (levelCtx.movableWallsCount > 0) {
    for (const cell of levelCtx.movableCandidates) {
      gridData[cell.r][cell.c] = '.';
    }
    for (const cell of wallCells) {
      gridData[cell.r][cell.c] = 'm';
    }
  }

  const usableCells = [];
  for (let r = 0; r < levelCtx.rows; r++) {
    for (let c = 0; c < levelCtx.cols; c++) {
      const ch = gridData[r][c];
      if (ch === '#' || ch === 'm') continue;
      usableCells.push({ r, c });
    }
  }

  const neighborMap = new Map();
  for (const cell of usableCells) {
    const out = [];
    for (const [dr, dc] of ALL_DIRS) {
      const nr = cell.r + dr;
      const nc = cell.c + dc;
      if (nr < 0 || nr >= levelCtx.rows || nc < 0 || nc >= levelCtx.cols) continue;
      const target = gridData[nr][nc];
      if (target === '#' || target === 'm') continue;

      const next = { r: nr, c: nc };
      const adr = Math.abs(cell.r - next.r);
      const adc = Math.abs(cell.c - next.c);

      if (adr + adc === 1) {
        out.push(next);
      } else if (adr === 1 && adc === 1) {
        const vr = Math.max(cell.r, next.r);
        const vc = Math.max(cell.c, next.c);
        if (levelCtx.stitchSet.has(keyV(vr, vc))) {
          out.push(next);
        }
      }
    }
    neighborMap.set(keyOf(cell.r, cell.c), out);
  }

  const startCells = usableCells.filter((cell) => !HINT_CODES.has(gridData[cell.r][cell.c]));

  return {
    rows: levelCtx.rows,
    cols: levelCtx.cols,
    totalUsable: levelCtx.parsed.usable,
    gridData,
    path: [],
    visited: new Set(),
    stitches: levelCtx.parsed.stitches,
    stitchSet: levelCtx.stitchSet,
    stitchReq: levelCtx.stitchReq,
    cornerCounts: levelCtx.cornerCounts,
    usableCells,
    startCells,
    neighborMap,
  };
}

function isValidPrefix(placement, path, visited) {
  const snapshot = {
    rows: placement.rows,
    cols: placement.cols,
    totalUsable: placement.totalUsable,
    gridData: placement.gridData,
    path,
    visited,
    stitches: placement.stitches,
    stitchSet: placement.stitchSet,
    stitchReq: placement.stitchReq,
    cornerCounts: placement.cornerCounts,
  };

  if (evaluateHints(snapshot).bad > 0) return false;
  if (evaluateStitches(snapshot).bad > 0) return false;
  if (evaluateRPS(snapshot).bad > 0) return false;
  if (evaluateBlockedCells(snapshot).bad > 0) return false;
  return true;
}

export function solveLevel(level, opts) {
  const levelCtx = buildLevelContext(level);

  const deadline = Date.now() + opts.timeMs;
  let timedOut = false;

  const rawSet = new Set();
  const canonicalSet = new Set();
  const hintOrderSet = new Set();
  const cornerOrderSet = new Set();

  let earlySatisfied = false;
  let wallPlacementsChecked = 0;

  const requirementsMet = () =>
    rawSet.size >= opts.minRaw &&
    canonicalSet.size >= opts.minCanonical &&
    hintOrderSet.size >= opts.minHintOrders &&
    cornerOrderSet.size >= opts.minCornerOrders;

  const runForPlacement = (wallCells) => {
    const placement = buildPlacementState(levelCtx, wallCells);

    const dfs = (path, visited) => {
      if (rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }

      if (!isValidPrefix(placement, path, visited)) return;

      if (path.length === placement.totalUsable) {
        rawSet.add(pathKey(path));
        const canonical = canonicalPathKey(path);
        if (!canonicalSet.has(canonical)) {
          canonicalSet.add(canonical);
          hintOrderSet.add(hintOrderSignature(path, placement.gridData));
          cornerOrderSet.add(cornerOrderSignature(path, levelCtx.cornerCounts));
        }
        if (requirementsMet()) earlySatisfied = true;
        return;
      }

      const last = path[path.length - 1];
      const nbs = placement.neighborMap.get(keyOf(last.r, last.c)) || [];
      for (const nb of nbs) {
        const nk = keyOf(nb.r, nb.c);
        if (visited.has(nk)) continue;

        visited.add(nk);
        path.push(nb);
        dfs(path, visited);
        path.pop();
        visited.delete(nk);

        if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      }
    };

    for (const start of placement.startCells) {
      if (earlySatisfied) break;
      const visited = new Set([keyOf(start.r, start.c)]);
      dfs([{ r: start.r, c: start.c }], visited);
      if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) break;
    }
  };

  if (levelCtx.movableWallsCount === 0) {
    wallPlacementsChecked = 1;
    runForPlacement([]);
  } else {
    const selected = [];
    const choosePlacement = (startIndex, picksLeft) => {
      if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }

      if (picksLeft === 0) {
        wallPlacementsChecked += 1;
        runForPlacement(selected);
        return;
      }

      for (let i = startIndex; i <= levelCtx.movableCandidates.length - picksLeft; i++) {
        selected.push(levelCtx.movableCandidates[i]);
        choosePlacement(i + 1, picksLeft - 1);
        selected.pop();
        if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      }
    };

    choosePlacement(0, levelCtx.movableWallsCount);
  }

  return {
    rawSolutions: rawSet.size,
    canonicalSolutions: canonicalSet.size,
    distinctHintOrders: hintOrderSet.size,
    distinctCornerOrders: cornerOrderSet.size,
    timedOut,
    hitMaxSolutions: rawSet.size >= opts.maxSolutions,
    earlySatisfied,
    movableWallsPresent: levelCtx.movableWallsCount > 0,
    movableWallsCount: levelCtx.movableWallsCount,
    wallPlacementsChecked,
    wallPlacementsTotal: levelCtx.wallPlacementsTotal,
  };
}

function runRandomSolveTrial(levelCtx, trialSeed, trialNodeCap) {
  const rng = makeRng(trialSeed);
  const sampledWalls = sampleWalls(levelCtx.movableCandidates, levelCtx.movableWallsCount, rng);
  const placement = buildPlacementState(levelCtx, sampledWalls);

  const result = {
    solved: false,
    backtracks: 0,
    nodeExpansions: 0,
    deadEnds: 0,
    maxDepth: 0,
    nodeCapReached: false,
    placementSignature: wallPlacementSignature(sampledWalls),
  };

  if (placement.startCells.length === 0) {
    return result;
  }

  const startOrder = placement.startCells.slice();
  shuffleInPlace(startOrder, rng);

  const dfs = (path, visited) => {
    if (result.nodeCapReached || result.solved) return false;
    if (result.nodeExpansions >= trialNodeCap) {
      result.nodeCapReached = true;
      return false;
    }

    result.nodeExpansions += 1;
    if (path.length > result.maxDepth) result.maxDepth = path.length;

    if (!isValidPrefix(placement, path, visited)) {
      result.deadEnds += 1;
      return false;
    }

    if (path.length === placement.totalUsable) {
      result.solved = true;
      return true;
    }

    const last = path[path.length - 1];
    const neighbors = (placement.neighborMap.get(keyOf(last.r, last.c)) || []).slice();
    shuffleInPlace(neighbors, rng);

    let advanced = false;
    for (const nb of neighbors) {
      const nk = keyOf(nb.r, nb.c);
      if (visited.has(nk)) continue;

      advanced = true;
      visited.add(nk);
      path.push(nb);

      if (dfs(path, visited)) return true;

      path.pop();
      visited.delete(nk);
      result.backtracks += 1;

      if (result.nodeCapReached || result.solved) return false;
    }

    if (!advanced) {
      result.deadEnds += 1;
    }

    return false;
  };

  for (const start of startOrder) {
    const visited = new Set([keyOf(start.r, start.c)]);
    const solved = dfs([{ r: start.r, c: start.c }], visited);
    if (solved || result.nodeCapReached) break;
  }

  return result;
}

export function runRandomSolveBatch(levelCtx, profile, seedMaterial) {
  const baseSeed = hashString32(seedMaterial);

  let solvedTrials = 0;
  let nodeCapHits = 0;

  const backtracksSolved = [];
  const nodeExpansionsAll = [];
  const deadEndsAll = [];
  const maxDepthAll = [];
  const placementSet = new Set();

  for (let i = 0; i < profile.trials; i++) {
    const seedOffset = Math.imul(i, GOLDEN_RATIO_32) >>> 0;
    const trialSeed = mix32((baseSeed ^ seedOffset) >>> 0);
    const trial = runRandomSolveTrial(levelCtx, trialSeed, profile.trialNodeCap);

    placementSet.add(trial.placementSignature);
    nodeExpansionsAll.push(trial.nodeExpansions);
    deadEndsAll.push(trial.deadEnds);
    maxDepthAll.push(trial.maxDepth);

    if (trial.nodeCapReached) nodeCapHits += 1;
    if (trial.solved) {
      solvedTrials += 1;
      backtracksSolved.push(trial.backtracks);
    }
  }

  const meanBacktracksSolved = mean(backtracksSolved);
  const p90BacktracksSolved = percentile(backtracksSolved, 0.9);
  const sdBacktracksSolved = stddev(backtracksSolved, meanBacktracksSolved);
  const cvBacktracksSolved = meanBacktracksSolved > 0 ? sdBacktracksSolved / meanBacktracksSolved : 0;

  return {
    trials: profile.trials,
    solvedTrials,
    successRate: profile.trials > 0 ? solvedTrials / profile.trials : 0,
    meanBacktracksSolved,
    p90BacktracksSolved,
    cvBacktracksSolved,
    meanNodeExpansions: mean(nodeExpansionsAll),
    meanDeadEnds: mean(deadEndsAll),
    p90MaxDepth: percentile(maxDepthAll, 0.9),
    nodeCapHits,
    uniqueWallPlacementsSampled: placementSet.size,
  };
}

function proveSatisfiableOrUnsat(levelCtx, opts) {
  const deadline = Date.now() + opts.difficultyProofTimeMs;
  const nodeCap = opts.difficultyProofNodeCap;

  let nodesVisited = 0;
  let found = false;
  let timedOut = false;
  let nodeCapHit = false;

  const consumeBudget = () => {
    if (Date.now() > deadline) {
      timedOut = true;
      return false;
    }
    if (nodesVisited >= nodeCap) {
      nodeCapHit = true;
      return false;
    }
    nodesVisited += 1;
    return true;
  };

  const runPlacement = (placement) => {
    const dfs = (path, visited) => {
      if (found || timedOut || nodeCapHit) return;
      if (!consumeBudget()) return;

      if (!isValidPrefix(placement, path, visited)) return;
      if (path.length === placement.totalUsable) {
        found = true;
        return;
      }

      const last = path[path.length - 1];
      const nbs = placement.neighborMap.get(keyOf(last.r, last.c)) || [];
      for (const nb of nbs) {
        const nk = keyOf(nb.r, nb.c);
        if (visited.has(nk)) continue;

        visited.add(nk);
        path.push(nb);
        dfs(path, visited);
        path.pop();
        visited.delete(nk);

        if (found || timedOut || nodeCapHit) return;
      }
    };

    for (const start of placement.startCells) {
      if (found || timedOut || nodeCapHit) return;
      const visited = new Set([keyOf(start.r, start.c)]);
      dfs([{ r: start.r, c: start.c }], visited);
    }
  };

  if (levelCtx.movableWallsCount === 0) {
    runPlacement(buildPlacementState(levelCtx, []));
  } else {
    const selected = [];
    const choosePlacement = (startIndex, picksLeft) => {
      if (found || timedOut || nodeCapHit) return;
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }

      if (picksLeft === 0) {
        runPlacement(buildPlacementState(levelCtx, selected));
        return;
      }

      for (let i = startIndex; i <= levelCtx.movableCandidates.length - picksLeft; i++) {
        selected.push(levelCtx.movableCandidates[i]);
        choosePlacement(i + 1, picksLeft - 1);
        selected.pop();
        if (found || timedOut || nodeCapHit) return;
      }
    };

    choosePlacement(0, levelCtx.movableWallsCount);
  }

  let status = 'proven_unsat';
  if (found) status = 'satisfiable_found';
  else if (timedOut || nodeCapHit) status = 'inconclusive';

  return {
    status,
    nodesVisited,
    timedOut,
    nodeCapHit,
  };
}

function scoreLabel(score) {
  if (score >= 100) return 'Impossible';
  if (score >= 80) return 'Expert';
  if (score >= 60) return 'Hard';
  if (score >= 40) return 'Medium';
  if (score >= 20) return 'Easy';
  return 'Trivial';
}

function makeSyntheticEmptyLevel(rows, cols) {
  return {
    name: `Baseline Empty ${rows}x${cols}`,
    nameKey: `baseline.empty.${rows}x${cols}`,
    desc: '',
    grid: Array.from({ length: rows }, () => '.'.repeat(cols)),
    stitches: [],
    cornerCounts: [],
  };
}

function difficultySeedMaterial(level, rows, cols) {
  const id = level.nameKey || level.name || 'level';
  return `${id}|${rows}|${cols}|${(level.grid || []).join('/')}`;
}

function getBaselineMetrics(rows, cols, opts, baselineCache) {
  const cacheKey = `${opts.difficultyProfile}|${rows}x${cols}`;
  if (baselineCache.has(cacheKey)) return baselineCache.get(cacheKey);

  const synthetic = makeSyntheticEmptyLevel(rows, cols);
  const syntheticCtx = buildLevelContext(synthetic);
  const profile = DIFFICULTY_PROFILES[opts.difficultyProfile];
  const batch = runRandomSolveBatch(
    syntheticCtx,
    profile,
    difficultySeedMaterial(synthetic, rows, cols),
  );

  const baseline = {
    baselineMeanBacktracks: batch.meanBacktracksSolved,
    baselineCvBacktracks: batch.cvBacktracksSolved,
  };

  baselineCache.set(cacheKey, baseline);
  return baseline;
}

function normalizeDifficultyMetadata(meta) {
  const score = clamp(asInt(meta?.score, 0), 0, 100);
  const profileName =
    typeof meta?.profile === 'string' && Object.hasOwn(DIFFICULTY_PROFILES, meta.profile)
      ? meta.profile
      : DEFAULTS.difficultyProfile;

  const rawStatus =
    typeof meta?.metrics?.unsatProofStatus === 'string'
      ? meta.metrics.unsatProofStatus
      : 'not_run';
  const unsatProofStatus = ['not_run', 'proven_unsat', 'satisfiable_found', 'inconclusive'].includes(rawStatus)
    ? rawStatus
    : 'not_run';

  return {
    version: DIFFICULTY_VERSION,
    profile: profileName,
    score,
    label: typeof meta?.label === 'string' ? meta.label : scoreLabel(score),
    components: {
      backtracking: roundFixed(meta?.components?.backtracking ?? 0),
      retries: roundFixed(meta?.components?.retries ?? 0),
      volatility: roundFixed(meta?.components?.volatility ?? 0),
    },
    metrics: {
      trials: asInt(meta?.metrics?.trials, 0),
      solvedTrials: asInt(meta?.metrics?.solvedTrials, 0),
      successRate: roundFixed(meta?.metrics?.successRate ?? 0),
      meanBacktracksSolved: roundFixed(meta?.metrics?.meanBacktracksSolved ?? 0),
      p90BacktracksSolved: roundFixed(meta?.metrics?.p90BacktracksSolved ?? 0),
      expectedRetries: roundFixed(meta?.metrics?.expectedRetries ?? 0),
      baselineMeanBacktracks: roundFixed(meta?.metrics?.baselineMeanBacktracks ?? 0),
      baselineCvBacktracks: roundFixed(meta?.metrics?.baselineCvBacktracks ?? 0),
      unsatProofStatus,
      cvBacktracksSolved: roundFixed(meta?.metrics?.cvBacktracksSolved ?? 0),
      uniqueWallPlacementsSampled: asInt(meta?.metrics?.uniqueWallPlacementsSampled, 0),
      meanNodeExpansions: roundFixed(meta?.metrics?.meanNodeExpansions ?? 0),
      meanDeadEnds: roundFixed(meta?.metrics?.meanDeadEnds ?? 0),
      p90MaxDepth: roundFixed(meta?.metrics?.p90MaxDepth ?? 0),
      nodeCapHits: asInt(meta?.metrics?.nodeCapHits, 0),
    },
  };
}

function measureDifficulty(level, opts, baselineCache) {
  const levelCtx = buildLevelContext(level);
  const profile = DIFFICULTY_PROFILES[opts.difficultyProfile];

  const batch = runRandomSolveBatch(
    levelCtx,
    profile,
    difficultySeedMaterial(level, levelCtx.rows, levelCtx.cols),
  );

  const baseline = getBaselineMetrics(levelCtx.rows, levelCtx.cols, opts, baselineCache);

  const successRate = batch.successRate;
  const expectedRetries = successRate > 0 ? (1 / successRate) - 1 : 20;
  const relativeBacktracks = Math.max(
    0,
    (batch.meanBacktracksSolved / Math.max(1, baseline.baselineMeanBacktracks)) - 1,
  );
  const relativeVolatility = Math.max(
    0,
    batch.cvBacktracksSolved - baseline.baselineCvBacktracks,
  );

  const backtracking = clamp(
    50 * Math.log1p(relativeBacktracks) / Math.log1p(50),
    0,
    50,
  );
  const retries = clamp(
    30 * Math.log1p(expectedRetries) / Math.log1p(9),
    0,
    30,
  );
  const volatility = clamp(
    19 * Math.min(1, relativeVolatility / 1.0),
    0,
    19,
  );

  const score99 = Math.round(clamp(backtracking + retries + volatility, 0, 99));

  let unsatProofStatus = 'not_run';
  let score = score99;

  if (successRate === 0) {
    const proof = proveSatisfiableOrUnsat(levelCtx, opts);
    unsatProofStatus = proof.status;
    if (proof.status === 'proven_unsat') {
      score = 100;
    } else if (proof.status === 'satisfiable_found') {
      score = score99;
    } else {
      score = Math.min(99, Math.max(95, score99));
    }
  }

  const difficulty = normalizeDifficultyMetadata({
    version: DIFFICULTY_VERSION,
    profile: opts.difficultyProfile,
    score,
    label: scoreLabel(score),
    components: {
      backtracking,
      retries,
      volatility,
    },
    metrics: {
      trials: profile.trials,
      solvedTrials: batch.solvedTrials,
      successRate,
      meanBacktracksSolved: batch.meanBacktracksSolved,
      p90BacktracksSolved: batch.p90BacktracksSolved,
      expectedRetries,
      baselineMeanBacktracks: baseline.baselineMeanBacktracks,
      baselineCvBacktracks: baseline.baselineCvBacktracks,
      unsatProofStatus,
      cvBacktracksSolved: batch.cvBacktracksSolved,
      uniqueWallPlacementsSampled: batch.uniqueWallPlacementsSampled,
      meanNodeExpansions: batch.meanNodeExpansions,
      meanDeadEnds: batch.meanDeadEnds,
      p90MaxDepth: batch.p90MaxDepth,
      nodeCapHits: batch.nodeCapHits,
    },
  });

  return difficulty;
}

function verifyResult(result, opts) {
  const failures = [];
  if (result.timedOut && !result.earlySatisfied) failures.push('timeout');
  if (result.rawSolutions < opts.minRaw) {
    failures.push(`rawSolutions ${result.rawSolutions} < ${opts.minRaw}`);
  }
  if (result.canonicalSolutions < opts.minCanonical) {
    failures.push(`canonicalSolutions ${result.canonicalSolutions} < ${opts.minCanonical}`);
  }
  if (result.distinctHintOrders < opts.minHintOrders) {
    failures.push(`distinctHintOrders ${result.distinctHintOrders} < ${opts.minHintOrders}`);
  }
  if (result.distinctCornerOrders < opts.minCornerOrders) {
    failures.push(`distinctCornerOrders ${result.distinctCornerOrders} < ${opts.minCornerOrders}`);
  }
  return failures;
}

function deepCloneLevel(level) {
  const cloned = {
    ...level,
    grid: (level.grid || []).map((row) => String(row)),
    stitches: (level.stitches || []).map((entry) => [entry[0], entry[1]]),
  };

  if (Object.prototype.hasOwnProperty.call(level, 'cornerCounts')) {
    cloned.cornerCounts = (level.cornerCounts || []).map((entry) => [entry[0], entry[1], entry[2]]);
  }

  if (level.difficulty) {
    cloned.difficulty = normalizeDifficultyMetadata(level.difficulty);
  }

  return cloned;
}

function canonicalizeLevel(level) {
  const out = {};

  if (Object.prototype.hasOwnProperty.call(level, 'name')) out.name = level.name;
  if (Object.prototype.hasOwnProperty.call(level, 'nameKey')) out.nameKey = level.nameKey;
  if (Object.prototype.hasOwnProperty.call(level, 'desc')) out.desc = level.desc;
  if (Object.prototype.hasOwnProperty.call(level, 'descKey')) out.descKey = level.descKey;

  out.grid = (level.grid || []).map((row) => String(row));
  out.stitches = (level.stitches || []).map((entry) => [entry[0], entry[1]]);

  if (Object.prototype.hasOwnProperty.call(level, 'cornerCounts')) {
    out.cornerCounts = (level.cornerCounts || []).map((entry) => [entry[0], entry[1], entry[2]]);
  }

  if (level.difficulty) {
    out.difficulty = normalizeDifficultyMetadata(level.difficulty);
  }

  const extras = Object.keys(level)
    .filter((key) => !KNOWN_LEVEL_KEYS.includes(key))
    .sort();
  for (const key of extras) {
    out[key] = level[key];
  }

  return out;
}

function writeCanonicalLevels(levels) {
  const canonicalLevels = levels.map(canonicalizeLevel);
  const body = JSON.stringify(canonicalLevels, null, 2);
  const fileText = `export const LEVELS = ${body};\n\nexport const DEFAULT_LEVEL_INDEX = ${DEFAULT_LEVEL_INDEX};\n`;
  fs.writeFileSync(LEVELS_FILE_PATH, fileText, 'utf8');
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    usage();
    process.exit(2);
  }

  let selected = [];
  try {
    if (opts.levels.length === 0) {
      selected = LEVELS.map((level, index) => ({ index, level }));
    } else {
      selected = opts.levels.map(resolveLevelSelector);
    }
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }

  const baselineCache = new Map();
  const results = [];
  for (const { index, level } of selected) {
    const metrics = solveLevel(level, opts);
    const failures = verifyResult(metrics, opts);

    const row = {
      index,
      nameKey: level.nameKey || null,
      name: level.name || null,
      ...metrics,
      pass: failures.length === 0,
      failures,
    };

    if (opts.difficulty) {
      row.difficulty = measureDifficulty(level, opts, baselineCache);
    }

    results.push(row);
  }

  if (opts.difficulty) {
    const byIndex = new Map(results.map((r) => [r.index, r.difficulty]));
    const levelsForWrite = LEVELS.map((level, index) => {
      const clone = deepCloneLevel(level);
      if (byIndex.has(index)) {
        clone.difficulty = normalizeDifficultyMetadata(byIndex.get(index));
      } else if (clone.difficulty) {
        clone.difficulty = normalizeDifficultyMetadata(clone.difficulty);
      }
      return clone;
    });
    writeCanonicalLevels(levelsForWrite);
  }

  const summary = {
    checked: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    defaults: {
      minRaw: opts.minRaw,
      minCanonical: opts.minCanonical,
      minHintOrders: opts.minHintOrders,
      minCornerOrders: opts.minCornerOrders,
      maxSolutions: opts.maxSolutions,
      timeMs: opts.timeMs,
    },
  };

  if (opts.difficulty) {
    summary.difficulty = {
      profile: opts.difficultyProfile,
      trials: DIFFICULTY_PROFILES[opts.difficultyProfile].trials,
      trialNodeCap: DIFFICULTY_PROFILES[opts.difficultyProfile].trialNodeCap,
      proofTimeMs: opts.difficultyProofTimeMs,
      proofNodeCap: opts.difficultyProofNodeCap,
      levelsFile: LEVELS_FILE_PATH,
    };
  }

  if (opts.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    if (opts.difficulty) {
      for (const r of results) {
        const label = r.nameKey || r.name || `level[${r.index}]`;
        const status = r.pass ? 'PASS' : 'FAIL';
        const d = r.difficulty;
        console.log(
          `[DIFF] idx=${r.index} ${label} score=${d.score} label=${d.label}` +
          ` successRate=${d.metrics.successRate}` +
          ` meanBacktracks=${d.metrics.meanBacktracksSolved}` +
          ` unsat=${d.metrics.unsatProofStatus} verify=${status}`,
        );
      }
      console.log(
        `Summary: checked=${summary.checked} passed=${summary.passed} failed=${summary.failed}` +
        ` profile=${opts.difficultyProfile} proofTimeMs=${opts.difficultyProofTimeMs}` +
        ` proofNodeCap=${opts.difficultyProofNodeCap}`,
      );
      console.log(`Updated: ${LEVELS_FILE_PATH}`);
    } else {
      for (const r of results) {
        const label = r.nameKey || r.name || `level[${r.index}]`;
        const status = r.pass ? 'PASS' : 'FAIL';
        const note = r.failures.length ? ` :: ${r.failures.join('; ')}` : '';
        const movableNote = r.movableWallsPresent
          ? ` movableWalls=${r.movableWallsCount} placements=${r.wallPlacementsChecked}/${r.wallPlacementsTotal}`
          : '';
        console.log(
          `[${status}] idx=${r.index} ${label} raw=${r.rawSolutions} canonical=${r.canonicalSolutions}` +
          ` hintOrders=${r.distinctHintOrders} cornerOrders=${r.distinctCornerOrders}` +
          `${movableNote}${note}`,
        );
      }
      console.log(
        `Summary: checked=${summary.checked} passed=${summary.passed} failed=${summary.failed}`,
      );
    }
  }

  process.exit(summary.failed === 0 ? 0 : 1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
