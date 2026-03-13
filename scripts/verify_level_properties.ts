#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  GameSnapshot,
  GridPoint,
  GridTuple,
  StitchRequirement,
} from '../src/contracts/ports.ts';
import { HINT_CODES } from '../src/config.ts';
import { DEFAULT_LEVEL_INDEX, LEVELS } from '../src/levels.ts';
import {
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../src/rules.ts';
import { hashString32, makeMulberry32Rng, mix32 } from '../src/shared/hash32.ts';
import {
  buildStitchLookups,
  countCornerOrthConnections,
  isOrthogonalStep,
} from '../src/shared/stitch_corner_geometry.ts';
import { keyOf, keyV, parseLevel } from '../src/utils.ts';
import { parseNonNegativeInt, readRequiredArgValue } from './lib/cli_utils.ts';

type CornerCount = [number, number, number];
type ParsedLevel = ReturnType<typeof parseLevel>;
export interface ScriptLevel {
  name?: string;
  nameKey?: string;
  desc?: string;
  descKey?: string;
  grid: string[];
  stitches?: GridTuple[];
  cornerCounts?: CornerCount[];
  difficulty?: unknown;
  [key: string]: unknown;
}
type ScriptLevelWithDifficulty = ScriptLevel & {
  difficulty?: DifficultyMetadata;
};

interface DifficultyProfile {
  trials: number;
  trialNodeCap: number;
}

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
} as const satisfies Record<string, DifficultyProfile>;

export type DifficultyProfileName = keyof typeof DIFFICULTY_PROFILES;

export interface SolveOptions {
  minRaw: number;
  minCanonical: number;
  minHintOrders: number;
  minCornerOrders: number;
  maxSolutions: number;
  timeMs: number;
}

interface VerifyCliOptions extends SolveOptions {
  levels: string[];
  difficulty: boolean;
  difficultyProfile: DifficultyProfileName;
  difficultyProofTimeMs: number;
  difficultyProofNodeCap: number;
  json: boolean;
}

interface TimeoutState {
  timedOut: boolean;
}

interface LevelContext {
  level: ScriptLevel;
  parsed: ParsedLevel;
  baseGrid: string[][];
  rows: number;
  cols: number;
  stitchSet: Set<string>;
  stitchReq: Map<string, StitchRequirement>;
  cornerCounts: CornerCount[];
  movableWalls: GridPoint[];
  movableWallsCount: number;
  movableCandidates: GridPoint[];
  wallPlacementsTotal: number;
}

interface PlacementState {
  rows: number;
  cols: number;
  totalUsable: number;
  gridData: string[][];
  path: GridPoint[];
  visited: Set<string>;
  stitches: GridTuple[];
  stitchSet: Set<string>;
  stitchReq: Map<string, StitchRequirement>;
  cornerCounts: CornerCount[];
  usableCells: GridPoint[];
  startCells: GridPoint[];
  neighborMap: Map<string, GridPoint[]>;
}

interface SolveMetrics {
  rawSolutions: number;
  canonicalSolutions: number;
  distinctHintOrders: number;
  distinctCornerOrders: number;
  timedOut: boolean;
  hitMaxSolutions: boolean;
  earlySatisfied: boolean;
  movableWallsPresent: boolean;
  movableWallsCount: number;
  wallPlacementsChecked: number;
  wallPlacementsTotal: number;
}

interface RandomSolveTrialResult {
  solved: boolean;
  backtracks: number;
  nodeExpansions: number;
  deadEnds: number;
  maxDepth: number;
  nodeCapReached: boolean;
  placementSignature: string;
}

interface RandomSolveBatchResult {
  trials: number;
  solvedTrials: number;
  successRate: number;
  meanBacktracksSolved: number;
  p90BacktracksSolved: number;
  cvBacktracksSolved: number;
  meanNodeExpansions: number;
  meanDeadEnds: number;
  p90MaxDepth: number;
  nodeCapHits: number;
  uniqueWallPlacementsSampled: number;
}

interface BaselineMetrics {
  baselineMeanBacktracks: number;
  baselineCvBacktracks: number;
}

interface DifficultyComponents {
  backtracking: number;
  retries: number;
  volatility: number;
}

interface DifficultyMetrics {
  trials: number;
  solvedTrials: number;
  successRate: number;
  meanBacktracksSolved: number;
  p90BacktracksSolved: number;
  expectedRetries: number;
  baselineMeanBacktracks: number;
  baselineCvBacktracks: number;
  unsatProofStatus: UnsatProofStatus;
  cvBacktracksSolved: number;
  uniqueWallPlacementsSampled: number;
  meanNodeExpansions: number;
  meanDeadEnds: number;
  p90MaxDepth: number;
  nodeCapHits: number;
}

interface DifficultyMetadata {
  version: number;
  profile: DifficultyProfileName;
  score: number;
  label: string;
  components: DifficultyComponents;
  metrics: DifficultyMetrics;
}

interface LevelResultRow extends SolveMetrics {
  index: number;
  nameKey: string | null;
  name: string | null;
  pass: boolean;
  failures: string[];
  difficulty?: DifficultyMetadata;
}

interface DifficultySummary {
  profile: DifficultyProfileName;
  trials: number;
  trialNodeCap: number;
  proofTimeMs: number;
  proofNodeCap: number;
  levelsFile: string;
}

interface VerifySummary {
  checked: number;
  passed: number;
  failed: number;
  defaults: SolveOptions;
  difficulty?: DifficultySummary;
}

interface TraversePlacementOptions {
  shouldStop?: () => boolean;
  beforeVisitNode?: () => boolean;
  onCompletePath?: (path: GridPoint[], placement: PlacementState) => void;
}

interface VisitPlacementOptions {
  shouldStop?: () => boolean;
  beforePlacementStep?: () => boolean;
  onPlacement?: (placement: PlacementState) => void;
}

type UnsatProofStatus = 'not_run' | 'proven_unsat' | 'satisfiable_found' | 'inconclusive';

interface UnsatProofResult {
  status: Exclude<UnsatProofStatus, 'not_run'>;
  nodesVisited: number;
  timedOut: boolean;
  nodeCapHit: boolean;
}

const CONSTRAINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v', 'g', 'b', 'p']);
const ORTH_DIRS: readonly GridTuple[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const ALL_DIRS: readonly GridTuple[] = [
  ...ORTH_DIRS,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const GOLDEN_RATIO_32 = 0x9e3779b9;
const DIFFICULTY_VERSION = 1;
const LEVELS_FILE_PATH = fileURLToPath(new URL('../src/levels.ts', import.meta.url));
const KNOWN_LEVEL_KEYS = new Set([
  'name',
  'nameKey',
  'desc',
  'descKey',
  'grid',
  'stitches',
  'cornerCounts',
  'difficulty',
]);
const ALL_LEVELS = LEVELS as readonly ScriptLevelWithDifficulty[];
const DIFFICULTY_PROFILE_NAMES = Object.keys(DIFFICULTY_PROFILES) as DifficultyProfileName[];

const DEFAULTS: VerifyCliOptions = {
  levels: [],
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
  json: false,
};

const usage = (): void => {
  console.log(
    [
      'Usage:',
      '  node --import tsx scripts/verify_level_properties.ts [options]',
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
      '  node --import tsx scripts/verify_level_properties.ts --level level.tutorial_6.name',
      '  node --import tsx scripts/verify_level_properties.ts --level 18 --min-canonical 2 --min-hint-orders 2',
      '  node --import tsx scripts/verify_level_properties.ts --difficulty --difficulty-profile standard256',
      '  node --import tsx scripts/verify_level_properties.ts --difficulty --json',
    ].join('\n'),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isDifficultyProfileName = (value: string): value is DifficultyProfileName =>
  Object.hasOwn(DIFFICULTY_PROFILES, value);

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

const roundFixed = (value: number, digits = 6): number => {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const asInt = (value: unknown, fallback = 0): number => {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) ? n : fallback;
};

function parseArgs(argv: readonly string[]): VerifyCliOptions {
  const opts: VerifyCliOptions = {
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

  let index = 0;
  while (index < argv.length) {
    const a = argv[index];
    let nextArgIndex = index + 1;
    const next = (): string => {
      const result = readRequiredArgValue(argv as string[], index, a);
      nextArgIndex = result.nextIndex + 1;
      return result.value;
    };

    switch (a) {
      case '--help':
      case '-h':
        usage();
        process.exit(0);
      case '--json':
        opts.json = true;
        break;
      case '--difficulty':
        opts.difficulty = true;
        break;
      case '--difficulty-profile': {
        const profile = next();
        if (!isDifficultyProfileName(profile)) {
          throw new Error(
            `--difficulty-profile must be one of ${DIFFICULTY_PROFILE_NAMES.join(', ')}, got: ${profile}`,
          );
        }
        opts.difficultyProfile = profile;
        break;
      }
      case '--difficulty-proof-time-ms':
        opts.difficultyProofTimeMs = parseNonNegativeInt('--difficulty-proof-time-ms', next());
        break;
      case '--difficulty-proof-node-cap':
        opts.difficultyProofNodeCap = parseNonNegativeInt('--difficulty-proof-node-cap', next());
        break;
      case '--level':
        opts.levels.push(next());
        break;
      case '--min-raw':
        opts.minRaw = parseNonNegativeInt('--min-raw', next());
        break;
      case '--min-canonical':
        opts.minCanonical = parseNonNegativeInt('--min-canonical', next());
        break;
      case '--min-hint-orders':
        opts.minHintOrders = parseNonNegativeInt('--min-hint-orders', next());
        break;
      case '--min-corner-orders':
        opts.minCornerOrders = parseNonNegativeInt('--min-corner-orders', next());
        break;
      case '--max-solutions':
        opts.maxSolutions = parseNonNegativeInt('--max-solutions', next());
        break;
      case '--time-ms':
        opts.timeMs = parseNonNegativeInt('--time-ms', next());
        break;
      default:
        throw new Error(`Unknown option: ${a}`);
    }

    index = nextArgIndex;
  }

  return opts;
}

function resolveLevelSelector(selector: string): { index: number; level: ScriptLevelWithDifficulty } {
  if (/^\d+$/.test(selector)) {
    const idx = Number.parseInt(selector, 10);
    if (idx < 0 || idx >= ALL_LEVELS.length) {
      throw new Error(`Level index out of range: ${selector}`);
    }
    return { index: idx, level: ALL_LEVELS[idx] };
  }

  const byKey = ALL_LEVELS.findIndex((lv) => lv.nameKey === selector);
  if (byKey >= 0) return { index: byKey, level: ALL_LEVELS[byKey] };

  const byName = ALL_LEVELS.findIndex((lv) => lv.name === selector);
  if (byName >= 0) return { index: byName, level: ALL_LEVELS[byName] };

  throw new Error(`Could not resolve level selector: ${selector}`);
}

const pathKey = (path: readonly GridPoint[]): string => path.map((p) => `${p.r},${p.c}`).join('|');

const canonicalPathKey = (path: readonly GridPoint[]): string => {
  const f = pathKey(path);
  const b = pathKey([...path].reverse());
  return f < b ? f : b;
};

const hintOrderSignature = (path: readonly GridPoint[], gridData: readonly string[][]): string => {
  const parts: string[] = [];
  for (const p of path) {
    const ch = gridData[p.r][p.c];
    if (CONSTRAINT_CODES.has(ch)) parts.push(`${ch}@${p.r},${p.c}`);
  }
  return parts.join('>');
};

const edgeKey = (a: GridPoint, b: GridPoint): string => {
  const ka = `${a.r},${a.c}`;
  const kb = `${b.r},${b.c}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const cornerOrderSignature = (path: readonly GridPoint[], cornerCounts: readonly CornerCount[]): string => {
  if (cornerCounts.length === 0) return '';

  const edgeSet = new Set<string>();
  const satisfied = new Set<string>();
  const order: string[] = [];

  for (const [vr, vc, target] of cornerCounts) {
    const key = `${vr},${vc}`;
    if (target === 0) {
      satisfied.add(key);
      order.push(key);
    }
  }

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const cur = path[i];
    if (isOrthogonalStep(prev, cur)) {
      edgeSet.add(edgeKey(prev, cur));
    }

    for (const [vr, vc, target] of cornerCounts) {
      const key = `${vr},${vc}`;
      if (satisfied.has(key)) continue;
      if (countCornerOrthConnections(vr, vc, edgeSet, edgeKey) === target) {
        satisfied.add(key);
        order.push(key);
      }
    }
  }

  return order.join('>');
};

const chooseCount = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i += 1) {
    result = (result * (n - kk + i)) / i;
  }
  return Math.round(result);
};

const compareCell = (a: GridPoint, b: GridPoint): number => {
  if (a.r !== b.r) return a.r - b.r;
  return a.c - b.c;
};

const cloneGrid = (grid: readonly string[][]): string[][] => grid.map((row) => row.slice());

const shuffleInPlace = <T>(arr: T[], rng: () => number): T[] => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
};

const percentile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
};

const mean = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
};

const stddev = (values: readonly number[], avg: number): number => {
  if (values.length === 0) return 0;
  if (!Number.isFinite(avg)) return 0;
  let sumSq = 0;
  for (const v of values) {
    const d = v - avg;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
};

const checkDeadline = (deadline: number, timeoutState: TimeoutState): boolean => {
  if (Date.now() > deadline) {
    timeoutState.timedOut = true;
    return false;
  }
  return true;
};

const sampleWalls = (movableCandidates: readonly GridPoint[], count: number, rng: () => number): GridPoint[] => {
  if (count === 0) return [];
  const available = movableCandidates.slice();
  const chosen: GridPoint[] = [];
  for (let i = 0; i < count && available.length > 0; i += 1) {
    const pick = Math.floor(rng() * available.length);
    chosen.push(available[pick]);
    available.splice(pick, 1);
  }
  chosen.sort(compareCell);
  return chosen;
};

const wallPlacementSignature = (walls: readonly GridPoint[]): string => {
  if (walls.length === 0) return 'none';
  return walls.map((cell) => keyOf(cell.r, cell.c)).join(';');
};

const buildSnapshot = (
  placement: PlacementState,
  path: readonly GridPoint[],
  visited: ReadonlySet<string>,
): GameSnapshot => {
  const idxByKey = new Map<string, number>();
  for (let i = 0; i < path.length; i += 1) {
    idxByKey.set(keyOf(path[i].r, path[i].c), i);
  }

  return {
    version: 1,
    levelIndex: 0,
    rows: placement.rows,
    cols: placement.cols,
    totalUsable: placement.totalUsable,
    pathKey: pathKey(path),
    gridData: placement.gridData,
    path: [...path],
    visited: new Set(visited),
    stitches: placement.stitches,
    stitchSet: placement.stitchSet,
    stitchReq: placement.stitchReq,
    cornerCounts: placement.cornerCounts,
    idxByKey,
  };
};

export function buildLevelContext(level: ScriptLevel): LevelContext {
  const parsed = parseLevel(level);
  const baseGrid = cloneGrid(parsed.g);
  const rows = parsed.rows;
  const cols = parsed.cols;
  const { stitchSet, stitchReq } = buildStitchLookups(parsed.stitches, keyV);
  const cornerCounts = parsed.cornerCounts || [];

  const movableWalls: GridPoint[] = [];
  const movableCandidates: GridPoint[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
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

function getUsableCells(gridData: readonly string[][], rows: number, cols: number): GridPoint[] {
  const usableCells: GridPoint[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ch = gridData[r][c];
      if (ch === '#' || ch === 'm') continue;
      usableCells.push({ r, c });
    }
  }
  return usableCells;
}

function getCellNeighbors(
  cell: GridPoint,
  gridData: readonly string[][],
  rows: number,
  cols: number,
  stitchSet: ReadonlySet<string>,
): GridPoint[] {
  const out: GridPoint[] = [];
  for (const [dr, dc] of ALL_DIRS) {
    const nr = cell.r + dr;
    const nc = cell.c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
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
      if (stitchSet.has(keyV(vr, vc))) {
        out.push(next);
      }
    }
  }
  return out;
}

function buildPlacementState(levelCtx: LevelContext, wallCells: readonly GridPoint[]): PlacementState {
  const gridData = cloneGrid(levelCtx.baseGrid);

  if (levelCtx.movableWallsCount > 0) {
    for (const cell of levelCtx.movableCandidates) {
      gridData[cell.r][cell.c] = '.';
    }
    for (const cell of wallCells) {
      gridData[cell.r][cell.c] = 'm';
    }
  }

  const usableCells = getUsableCells(gridData, levelCtx.rows, levelCtx.cols);
  const neighborMap = new Map<string, GridPoint[]>();
  for (const cell of usableCells) {
    neighborMap.set(
      keyOf(cell.r, cell.c),
      getCellNeighbors(cell, gridData, levelCtx.rows, levelCtx.cols, levelCtx.stitchSet),
    );
  }

  const startCells = usableCells.filter((cell) => !HINT_CODES.has(gridData[cell.r][cell.c]));

  return {
    rows: levelCtx.rows,
    cols: levelCtx.cols,
    totalUsable: levelCtx.parsed.usable,
    gridData,
    path: [],
    visited: new Set<string>(),
    stitches: levelCtx.parsed.stitches,
    stitchSet: levelCtx.stitchSet,
    stitchReq: levelCtx.stitchReq,
    cornerCounts: levelCtx.cornerCounts,
    usableCells,
    startCells,
    neighborMap,
  };
}

function isValidPrefix(
  placement: PlacementState,
  path: readonly GridPoint[],
  visited: ReadonlySet<string>,
): boolean {
  const snapshot = buildSnapshot(placement, path, visited);

  if (evaluateHints(snapshot, { suppressEndpointRequirement: true }).bad > 0) return false;
  if (evaluateStitches(snapshot).bad > 0) return false;
  if (evaluateRPS(snapshot).bad > 0) return false;
  if (evaluateBlockedCells(snapshot).bad > 0) return false;
  return true;
}

function traversePlacementPaths(
  placement: PlacementState,
  options: TraversePlacementOptions = {},
): void {
  const {
    shouldStop = () => false,
    beforeVisitNode = () => true,
    onCompletePath = () => {},
  } = options;

  const dfs = (path: GridPoint[], visited: Set<string>): void => {
    if (shouldStop()) return;
    if (!beforeVisitNode()) return;
    if (!isValidPrefix(placement, path, visited)) return;

    if (path.length === placement.totalUsable) {
      onCompletePath(path, placement);
      return;
    }

    const last = path[path.length - 1];
    const neighbors = placement.neighborMap.get(keyOf(last.r, last.c)) || [];
    for (const next of neighbors) {
      const nextKey = keyOf(next.r, next.c);
      if (visited.has(nextKey)) continue;

      visited.add(nextKey);
      path.push(next);
      dfs(path, visited);
      path.pop();
      visited.delete(nextKey);

      if (shouldStop()) return;
    }
  };

  for (const start of placement.startCells) {
    if (shouldStop()) break;
    const visited = new Set<string>([keyOf(start.r, start.c)]);
    dfs([{ r: start.r, c: start.c }], visited);
  }
}

function visitPlacementStates(
  levelCtx: LevelContext,
  options: VisitPlacementOptions = {},
): number {
  const {
    shouldStop = () => false,
    beforePlacementStep = () => true,
    onPlacement = () => {},
  } = options;

  let placementsVisited = 0;
  const visit = (wallCells: readonly GridPoint[]): void => {
    placementsVisited += 1;
    onPlacement(buildPlacementState(levelCtx, wallCells));
  };

  if (levelCtx.movableWallsCount === 0) {
    visit([]);
    return placementsVisited;
  }

  const selected: GridPoint[] = [];
  const choosePlacement = (startIndex: number, picksLeft: number): void => {
    if (shouldStop()) return;
    if (!beforePlacementStep()) return;

    if (picksLeft === 0) {
      visit(selected);
      return;
    }

    for (let i = startIndex; i <= levelCtx.movableCandidates.length - picksLeft; i += 1) {
      selected.push(levelCtx.movableCandidates[i]);
      choosePlacement(i + 1, picksLeft - 1);
      selected.pop();
      if (shouldStop()) return;
    }
  };

  choosePlacement(0, levelCtx.movableWallsCount);
  return placementsVisited;
}

export function solveLevel(level: ScriptLevel, opts: SolveOptions): SolveMetrics {
  const levelCtx = buildLevelContext(level);
  const deadline = Date.now() + opts.timeMs;
  const timeoutState: TimeoutState = { timedOut: false };

  const rawSet = new Set<string>();
  const canonicalSet = new Set<string>();
  const hintOrderSet = new Set<string>();
  const cornerOrderSet = new Set<string>();

  let earlySatisfied = false;
  let wallPlacementsChecked = 0;

  const requirementsMet = (): boolean =>
    rawSet.size >= opts.minRaw &&
    canonicalSet.size >= opts.minCanonical &&
    hintOrderSet.size >= opts.minHintOrders &&
    cornerOrderSet.size >= opts.minCornerOrders;

  const shouldStop = (): boolean =>
    timeoutState.timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied;
  const beforeVisitNode = (): boolean => checkDeadline(deadline, timeoutState);
  const onCompletePath = (path: GridPoint[], placement: PlacementState): void => {
    rawSet.add(pathKey(path));
    const canonical = canonicalPathKey(path);
    if (!canonicalSet.has(canonical)) {
      canonicalSet.add(canonical);
      hintOrderSet.add(hintOrderSignature(path, placement.gridData));
      cornerOrderSet.add(cornerOrderSignature(path, levelCtx.cornerCounts));
    }
    if (requirementsMet()) earlySatisfied = true;
  };

  wallPlacementsChecked = visitPlacementStates(levelCtx, {
    shouldStop,
    beforePlacementStep: beforeVisitNode,
    onPlacement: (placement) => {
      traversePlacementPaths(placement, {
        shouldStop,
        beforeVisitNode,
        onCompletePath,
      });
    },
  });

  return {
    rawSolutions: rawSet.size,
    canonicalSolutions: canonicalSet.size,
    distinctHintOrders: hintOrderSet.size,
    distinctCornerOrders: cornerOrderSet.size,
    timedOut: timeoutState.timedOut,
    hitMaxSolutions: rawSet.size >= opts.maxSolutions,
    earlySatisfied,
    movableWallsPresent: levelCtx.movableWallsCount > 0,
    movableWallsCount: levelCtx.movableWallsCount,
    wallPlacementsChecked,
    wallPlacementsTotal: levelCtx.wallPlacementsTotal,
  };
}

function runRandomSolveTrial(levelCtx: LevelContext, trialSeed: number, trialNodeCap: number): RandomSolveTrialResult {
  const rng = makeMulberry32Rng(trialSeed);
  const sampledWalls = sampleWalls(levelCtx.movableCandidates, levelCtx.movableWallsCount, rng);
  const placement = buildPlacementState(levelCtx, sampledWalls);

  const result: RandomSolveTrialResult = {
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

  const dfs = (path: GridPoint[], visited: Set<string>): boolean => {
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
    const visited = new Set<string>([keyOf(start.r, start.c)]);
    const solved = dfs([{ r: start.r, c: start.c }], visited);
    if (solved || result.nodeCapReached) break;
  }

  return result;
}

export function runRandomSolveBatch(
  levelCtx: LevelContext,
  profile: DifficultyProfile,
  seedMaterial: string,
): RandomSolveBatchResult {
  const baseSeed = hashString32(seedMaterial);

  let solvedTrials = 0;
  let nodeCapHits = 0;

  const backtracksSolved: number[] = [];
  const nodeExpansionsAll: number[] = [];
  const deadEndsAll: number[] = [];
  const maxDepthAll: number[] = [];
  const placementSet = new Set<string>();

  for (let i = 0; i < profile.trials; i += 1) {
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

function proveSatisfiableOrUnsat(levelCtx: LevelContext, opts: VerifyCliOptions): UnsatProofResult {
  const deadline = Date.now() + opts.difficultyProofTimeMs;
  const nodeCap = opts.difficultyProofNodeCap;

  let nodesVisited = 0;
  let found = false;
  const timeoutState: TimeoutState = { timedOut: false };
  let nodeCapHit = false;

  const consumeBudget = (): boolean => {
    if (!checkDeadline(deadline, timeoutState)) return false;
    if (nodesVisited >= nodeCap) {
      nodeCapHit = true;
      return false;
    }
    nodesVisited += 1;
    return true;
  };
  const shouldStop = (): boolean => found || timeoutState.timedOut || nodeCapHit;
  const beforePlacementStep = (): boolean => checkDeadline(deadline, timeoutState);

  visitPlacementStates(levelCtx, {
    shouldStop,
    beforePlacementStep,
    onPlacement: (placement) => {
      traversePlacementPaths(placement, {
        shouldStop,
        beforeVisitNode: consumeBudget,
        onCompletePath: () => {
          found = true;
        },
      });
    },
  });

  let status: UnsatProofResult['status'] = 'proven_unsat';
  if (found) status = 'satisfiable_found';
  else if (timeoutState.timedOut || nodeCapHit) status = 'inconclusive';

  return {
    status,
    nodesVisited,
    timedOut: timeoutState.timedOut,
    nodeCapHit,
  };
}

function scoreLabel(score: number): string {
  if (score >= 100) return 'Impossible';
  if (score >= 80) return 'Expert';
  if (score >= 60) return 'Hard';
  if (score >= 40) return 'Medium';
  if (score >= 20) return 'Easy';
  return 'Trivial';
}

function makeSyntheticEmptyLevel(rows: number, cols: number): ScriptLevel {
  return {
    name: `Baseline Empty ${rows}x${cols}`,
    nameKey: `baseline.empty.${rows}x${cols}`,
    desc: '',
    grid: Array.from({ length: rows }, () => '.'.repeat(cols)),
    stitches: [],
    cornerCounts: [],
  };
}

function difficultySeedMaterial(level: ScriptLevel, rows: number, cols: number): string {
  const id = level.nameKey || level.name || 'level';
  return `${id}|${rows}|${cols}|${level.grid.join('/')}`;
}

function getBaselineMetrics(
  rows: number,
  cols: number,
  opts: VerifyCliOptions,
  baselineCache: Map<string, BaselineMetrics>,
): BaselineMetrics {
  const cacheKey = `${opts.difficultyProfile}|${rows}x${cols}`;
  const cached = baselineCache.get(cacheKey);
  if (cached) return cached;

  const synthetic = makeSyntheticEmptyLevel(rows, cols);
  const syntheticCtx = buildLevelContext(synthetic);
  const profile = DIFFICULTY_PROFILES[opts.difficultyProfile];
  const batch = runRandomSolveBatch(
    syntheticCtx,
    profile,
    difficultySeedMaterial(synthetic, rows, cols),
  );

  const baseline: BaselineMetrics = {
    baselineMeanBacktracks: batch.meanBacktracksSolved,
    baselineCvBacktracks: batch.cvBacktracksSolved,
  };

  baselineCache.set(cacheKey, baseline);
  return baseline;
}

function normalizeDifficultyMetadata(meta: unknown): DifficultyMetadata {
  const metaObject = isRecord(meta) ? meta : {};
  const components = isRecord(metaObject.components) ? metaObject.components : {};
  const metrics = isRecord(metaObject.metrics) ? metaObject.metrics : {};
  const profile =
    typeof metaObject.profile === 'string' && isDifficultyProfileName(metaObject.profile)
      ? metaObject.profile
      : DEFAULTS.difficultyProfile;
  const rawStatus = typeof metrics.unsatProofStatus === 'string' ? metrics.unsatProofStatus : 'not_run';
  const unsatProofStatus: UnsatProofStatus = (
    rawStatus === 'not_run' ||
    rawStatus === 'proven_unsat' ||
    rawStatus === 'satisfiable_found' ||
    rawStatus === 'inconclusive'
  ) ? rawStatus : 'not_run';
  const score = clamp(asInt(metaObject.score, 0), 0, 100);

  return {
    version: DIFFICULTY_VERSION,
    profile,
    score,
    label: typeof metaObject.label === 'string' ? metaObject.label : scoreLabel(score),
    components: {
      backtracking: roundFixed(Number(components.backtracking ?? 0)),
      retries: roundFixed(Number(components.retries ?? 0)),
      volatility: roundFixed(Number(components.volatility ?? 0)),
    },
    metrics: {
      trials: asInt(metrics.trials, 0),
      solvedTrials: asInt(metrics.solvedTrials, 0),
      successRate: roundFixed(Number(metrics.successRate ?? 0)),
      meanBacktracksSolved: roundFixed(Number(metrics.meanBacktracksSolved ?? 0)),
      p90BacktracksSolved: roundFixed(Number(metrics.p90BacktracksSolved ?? 0)),
      expectedRetries: roundFixed(Number(metrics.expectedRetries ?? 0)),
      baselineMeanBacktracks: roundFixed(Number(metrics.baselineMeanBacktracks ?? 0)),
      baselineCvBacktracks: roundFixed(Number(metrics.baselineCvBacktracks ?? 0)),
      unsatProofStatus,
      cvBacktracksSolved: roundFixed(Number(metrics.cvBacktracksSolved ?? 0)),
      uniqueWallPlacementsSampled: asInt(metrics.uniqueWallPlacementsSampled, 0),
      meanNodeExpansions: roundFixed(Number(metrics.meanNodeExpansions ?? 0)),
      meanDeadEnds: roundFixed(Number(metrics.meanDeadEnds ?? 0)),
      p90MaxDepth: roundFixed(Number(metrics.p90MaxDepth ?? 0)),
      nodeCapHits: asInt(metrics.nodeCapHits, 0),
    },
  };
}

function measureDifficulty(
  level: ScriptLevel,
  opts: VerifyCliOptions,
  baselineCache: Map<string, BaselineMetrics>,
): DifficultyMetadata {
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
    19 * Math.min(1, relativeVolatility / 1),
    0,
    19,
  );

  const score99 = Math.round(clamp(backtracking + retries + volatility, 0, 99));
  let unsatProofStatus: UnsatProofStatus = 'not_run';
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

  return normalizeDifficultyMetadata({
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
}

function verifyResult(result: SolveMetrics, opts: SolveOptions): string[] {
  const failures: string[] = [];
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

function deepCloneLevel(level: ScriptLevelWithDifficulty): ScriptLevelWithDifficulty {
  const cloned: ScriptLevelWithDifficulty = {
    ...level,
    grid: level.grid.map(String),
    stitches: (level.stitches || []).map((entry) => [entry[0], entry[1]] as GridTuple),
  };

  if (Object.hasOwn(level, 'cornerCounts')) {
    cloned.cornerCounts = (level.cornerCounts || []).map(
      (entry) => [entry[0], entry[1], entry[2]] as CornerCount,
    );
  }

  if (level.difficulty) {
    cloned.difficulty = normalizeDifficultyMetadata(level.difficulty);
  }

  return cloned;
}

function canonicalizeLevel(level: ScriptLevelWithDifficulty): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const levelRecord = level as Record<string, unknown>;

  if (Object.hasOwn(level, 'name')) out.name = level.name;
  if (Object.hasOwn(level, 'nameKey')) out.nameKey = level.nameKey;
  if (Object.hasOwn(level, 'desc')) out.desc = level.desc;
  if (Object.hasOwn(level, 'descKey')) out.descKey = level.descKey;

  out.grid = level.grid.map(String);
  out.stitches = (level.stitches || []).map((entry) => [entry[0], entry[1]] as GridTuple);

  if (Object.hasOwn(level, 'cornerCounts')) {
    out.cornerCounts = (level.cornerCounts || []).map(
      (entry) => [entry[0], entry[1], entry[2]] as CornerCount,
    );
  }

  if (level.difficulty) {
    out.difficulty = normalizeDifficultyMetadata(level.difficulty);
  }

  const extras = Object.keys(levelRecord)
    .filter((key) => !KNOWN_LEVEL_KEYS.has(key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of extras) {
    out[key] = levelRecord[key];
  }

  return out;
}

function writeCanonicalLevels(levels: readonly ScriptLevelWithDifficulty[]): void {
  const canonicalLevels = levels.map(canonicalizeLevel);
  const body = JSON.stringify(canonicalLevels, null, 2);
  const fileText = `export const LEVELS = ${body};\n\nexport const DEFAULT_LEVEL_INDEX = ${DEFAULT_LEVEL_INDEX};\n`;
  fs.writeFileSync(LEVELS_FILE_PATH, fileText, 'utf8');
}

function writeDifficultyUpdates(results: readonly LevelResultRow[]): void {
  const byIndex = new Map<number, DifficultyMetadata>();
  for (const result of results) {
    if (result.difficulty) {
      byIndex.set(result.index, result.difficulty);
    }
  }
  const levelsForWrite = ALL_LEVELS.map((level, index) => {
    const clone = deepCloneLevel(level);
    const difficulty = byIndex.get(index);
    if (difficulty) {
      clone.difficulty = normalizeDifficultyMetadata(difficulty);
    } else if (clone.difficulty) {
      clone.difficulty = normalizeDifficultyMetadata(clone.difficulty);
    }
    return clone;
  });
  writeCanonicalLevels(levelsForWrite);
}

function getCliOptions(): VerifyCliOptions {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    usage();
    process.exit(2);
  }
}

function getSelectedLevels(opts: VerifyCliOptions): Array<{ index: number; level: ScriptLevelWithDifficulty }> {
  try {
    if (opts.levels.length === 0) {
      return ALL_LEVELS.map((level, index) => ({ index, level }));
    }
    return opts.levels.map(resolveLevelSelector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }
}

function getLevelLabel(result: Pick<LevelResultRow, 'index' | 'nameKey' | 'name'>): string {
  if (result.nameKey) return result.nameKey;
  if (result.name) return result.name;
  return `level[${result.index}]`;
}

function printDifficultyResults(
  opts: VerifyCliOptions,
  summary: VerifySummary,
  results: readonly LevelResultRow[],
): void {
  for (const result of results) {
    const label = getLevelLabel(result);
    const status = result.pass ? 'PASS' : 'FAIL';
    const difficulty = result.difficulty;
    if (!difficulty) continue;
    console.log(
      `[DIFF] idx=${result.index} ${label} score=${difficulty.score} label=${difficulty.label}` +
      ` successRate=${difficulty.metrics.successRate}` +
      ` meanBacktracks=${difficulty.metrics.meanBacktracksSolved}` +
      ` unsat=${difficulty.metrics.unsatProofStatus} verify=${status}`,
    );
  }
  console.log(
    `Summary: checked=${summary.checked} passed=${summary.passed} failed=${summary.failed}` +
    ` profile=${opts.difficultyProfile} proofTimeMs=${opts.difficultyProofTimeMs}` +
    ` proofNodeCap=${opts.difficultyProofNodeCap}`,
  );
  console.log(`Updated: ${LEVELS_FILE_PATH}`);
}

function printStandardResults(
  _opts: VerifyCliOptions,
  summary: VerifySummary,
  results: readonly LevelResultRow[],
): void {
  for (const result of results) {
    const label = getLevelLabel(result);
    const status = result.pass ? 'PASS' : 'FAIL';
    const note = result.failures.length ? ` :: ${result.failures.join('; ')}` : '';
    const movableNote = result.movableWallsPresent
      ? ` movableWalls=${result.movableWallsCount} placements=${result.wallPlacementsChecked}/${result.wallPlacementsTotal}`
      : '';
    console.log(
      `[${status}] idx=${result.index} ${label} raw=${result.rawSolutions} canonical=${result.canonicalSolutions}` +
      ` hintOrders=${result.distinctHintOrders} cornerOrders=${result.distinctCornerOrders}` +
      `${movableNote}${note}`,
    );
  }
  console.log(
    `Summary: checked=${summary.checked} passed=${summary.passed} failed=${summary.failed}`,
  );
}

function printResults(opts: VerifyCliOptions, summary: VerifySummary, results: readonly LevelResultRow[]): void {
  if (opts.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else if (opts.difficulty) {
    printDifficultyResults(opts, summary, results);
  } else {
    printStandardResults(opts, summary, results);
  }
}

function main(): void {
  const opts = getCliOptions();
  const selected = getSelectedLevels(opts);
  const baselineCache = new Map<string, BaselineMetrics>();
  const results: LevelResultRow[] = [];

  for (const { index, level } of selected) {
    const metrics = solveLevel(level, opts);
    const failures = verifyResult(metrics, opts);

    const row: LevelResultRow = {
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
    writeDifficultyUpdates(results);
  }

  const summary: VerifySummary = {
    checked: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
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
    const profile = DIFFICULTY_PROFILES[opts.difficultyProfile];
    summary.difficulty = {
      profile: opts.difficultyProfile,
      trials: profile.trials,
      trialNodeCap: profile.trialNodeCap,
      proofTimeMs: opts.difficultyProofTimeMs,
      proofNodeCap: opts.difficultyProofNodeCap,
      levelsFile: LEVELS_FILE_PATH,
    };
  }

  printResults(opts, summary, results);
  process.exit(summary.failed === 0 ? 0 : 1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
