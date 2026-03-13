import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ZlibOptions } from 'node:zlib';
import {
  decodeDailyOverridesPayload,
  encodeDailyOverridesPayload,
} from '../src/daily_pool_codec.ts';
import {
  INFINITE_MAX_LEVELS,
  generateInfiniteLevel,
  generateInfiniteLevelFromVariant,
} from '../src/infinite.ts';
import { canonicalConstraintFingerprint } from '../src/infinite_canonical.ts';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../src/rules.ts';
import type {
  CompletionResult,
  GameSnapshot,
  GridPoint,
  GridTuple,
  LevelDefinition,
} from '../src/contracts/ports.ts';
import { parseCoordinatePair } from '../src/shared/coordinate_pair.ts';
import { parseUtcDateIdStartMs, utcDateIdFromMs } from '../src/shared/utc_date.ts';
import { createGameStateStore } from '../src/state/game_state_store.ts';

export const DAILY_POOL_SCHEMA_VERSION = 1;
export const DAILY_POOL_VERSION = 'v1';
export const DAILY_POOL_EPOCH_UTC_DATE = '2026-01-01';
export const DAILY_POOL_MAX_SLOTS = 30000;
export const DAILY_POOL_BASE_VARIANT_ID = 0;
export const DAILY_POOL_MAX_VARIANT_PROBE = 255;
export const DAILY_POOL_DIFFICULTY_VARIANT_WINDOW = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

interface DailyLevelInfiniteMeta {
  witnessPath?: unknown;
  witnessMovableWalls?: unknown;
}

export interface DailyLevel extends LevelDefinition {
  grid: string[];
  stitches?: GridTuple[];
  cornerCounts?: Array<[number, number, number]>;
  infiniteMeta?: DailyLevelInfiniteMeta;
}

export interface MaterializedDailyLevel {
  slot: number;
  infiniteIndex: number;
  variantId: number;
  level: DailyLevel;
  canonicalKey: string;
}

export interface DailyCandidate extends MaterializedDailyLevel {
  difficultyScore: number;
}

type DailyOverridesBySlot = Readonly<Record<number, number>> | null | undefined;
type DailyOverrideInput = Map<number, number> | Record<string, number> | null | undefined;
type GzipOptionsWithMtime = ZlibOptions & { mtime?: number };

const asDailyLevel = (level: LevelDefinition): DailyLevel => level as DailyLevel;

const countMovableWalls = (level: DailyLevel): number => {
  let count = 0;
  for (const row of level.grid || []) {
    for (const ch of row) {
      if (ch === 'm') count += 1;
    }
  }
  return count;
};

const countCellType = (level: DailyLevel, matcher: (ch: string) => boolean): number => {
  let count = 0;
  for (const row of level.grid || []) {
    for (const ch of row) {
      if (matcher(ch)) count += 1;
    }
  }
  return count;
};

const countWitnessTurns = (witnessPathRaw: unknown): number => {
  if (!Array.isArray(witnessPathRaw) || witnessPathRaw.length < 3) return 0;
  let turns = 0;
  let prevDr: number | null = null;
  let prevDc: number | null = null;

  for (let i = 1; i < witnessPathRaw.length; i += 1) {
    const prev = parseCoordinatePair(witnessPathRaw[i - 1]);
    const next = parseCoordinatePair(witnessPathRaw[i]);
    if (!prev || !next) continue;

    const dr = next.r - prev.r;
    const dc = next.c - prev.c;
    if (!Number.isInteger(dr) || !Number.isInteger(dc)) continue;
    if (prevDr !== null && prevDc !== null && (dr !== prevDr || dc !== prevDc)) turns += 1;
    prevDr = dr;
    prevDc = dc;
  }

  return turns;
};

export const estimateDailyDifficultyScore = (level: DailyLevel | null | undefined): number => {
  if (!level || !Array.isArray(level.grid) || level.grid.length === 0) return -1;
  const rows = level.grid.length;
  const cols = level.grid[0]?.length || 0;
  const totalCells = rows * cols;

  const wallCount = countCellType(level, (ch) => ch === '#');
  const movableCount = countCellType(level, (ch) => ch === 'm');
  const hintCount = countCellType(level, (ch) => (
    ch === 't'
    || ch === 'r'
    || ch === 'l'
    || ch === 's'
    || ch === 'h'
    || ch === 'v'
  ));
  const rpsCount = countCellType(level, (ch) => ch === 'g' || ch === 'b' || ch === 'p');

  const stitchCount = Array.isArray(level.stitches) ? level.stitches.length : 0;
  const cornerCount = Array.isArray(level.cornerCounts) ? level.cornerCounts.length : 0;
  const witnessPathRaw = level.infiniteMeta?.witnessPath;
  const witnessLength = Array.isArray(witnessPathRaw)
    ? witnessPathRaw.length
    : Math.max(0, totalCells - wallCount - movableCount);
  const witnessTurns = countWitnessTurns(witnessPathRaw);

  const featureFamilies =
    (hintCount > 0 ? 1 : 0)
    + (rpsCount > 0 ? 1 : 0)
    + (stitchCount > 0 ? 1 : 0)
    + (cornerCount > 0 ? 1 : 0)
    + (movableCount > 0 ? 1 : 0);

  return (
    (totalCells * 8)
    + (witnessLength * 20)
    + (witnessTurns * 9)
    + ((wallCount + movableCount) * 7)
    + (hintCount * 12)
    + (rpsCount * 16)
    + (stitchCount * 22)
    + (cornerCount * 10)
    + (featureFamilies * 40)
  );
};

const evaluateSnapshotCompletion = (snapshot: GameSnapshot): CompletionResult => {
  const evaluate = {
    hintStatus: evaluateHints(snapshot, {}),
    stitchStatus: evaluateStitches(snapshot),
    rpsStatus: evaluateRPS(snapshot),
    blockedStatus: evaluateBlockedCells(snapshot),
  };
  return checkCompletion(snapshot, evaluate, (key) => key);
};

export const replayWitnessAndValidate = (level: DailyLevel | null | undefined): boolean => {
  if (!level || !Array.isArray(level.grid)) return false;

  const witnessPathRaw = level.infiniteMeta?.witnessPath;
  if (!Array.isArray(witnessPathRaw) || witnessPathRaw.length === 0) return false;

  const witnessPath: GridPoint[] = [];
  for (const entry of witnessPathRaw) {
    const parsed = parseCoordinatePair(entry);
    if (!parsed) return false;
    witnessPath.push(parsed);
  }

  const store = createGameStateStore(() => level);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  const movableWallCount = countMovableWalls(level);
  const witnessMovableWallsRaw = level.infiniteMeta?.witnessMovableWalls;
  if (movableWallCount > 0) {
    if (!Array.isArray(witnessMovableWallsRaw) || witnessMovableWallsRaw.length !== movableWallCount) {
      return false;
    }

    const restored = store.restoreMutableState({
      levelIndex: 0,
      path: [],
      movableWalls: witnessMovableWallsRaw as GridTuple[],
    });
    if (!restored) return false;
  }

  for (const point of witnessPath) {
    const transition = store.dispatch({
      type: 'path/start-or-step',
      payload: { r: point.r, c: point.c },
    });
    if (!transition.changed) return false;
  }

  const snapshot = store.getSnapshot();
  const completion = evaluateSnapshotCompletion(snapshot);
  return completion.kind === 'good';
};

export const buildInfiniteCanonicalKeySet = (maxLevels = INFINITE_MAX_LEVELS): Set<string> => {
  if (!Number.isInteger(maxLevels) || maxLevels <= 0 || maxLevels > INFINITE_MAX_LEVELS) {
    throw new Error(`maxLevels must be 1..${INFINITE_MAX_LEVELS}, got ${maxLevels}`);
  }

  const out = new Set<string>();
  for (let i = 0; i < maxLevels; i += 1) {
    const level = asDailyLevel(generateInfiniteLevel(i));
    out.add(canonicalConstraintFingerprint(level).key);
  }
  return out;
};

export const materializeDailyLevelForSlot = (
  slot: number,
  overridesBySlot: DailyOverridesBySlot = null,
  baseVariantId = DAILY_POOL_BASE_VARIANT_ID,
): MaterializedDailyLevel => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INFINITE_MAX_LEVELS) {
    throw new Error(`daily slot must be 0..${INFINITE_MAX_LEVELS - 1}, got ${slot}`);
  }

  const overrideVariant = overridesBySlot ? overridesBySlot[slot] : null;
  const variantId = typeof overrideVariant === 'number'
    && Number.isInteger(overrideVariant)
    && overrideVariant >= 0
    ? overrideVariant
    : baseVariantId;
  const level = asDailyLevel(generateInfiniteLevelFromVariant(slot, variantId));
  const canonicalKey = canonicalConstraintFingerprint(level).key;

  return {
    slot,
    infiniteIndex: slot,
    variantId,
    level,
    canonicalKey,
  };
};

const isBetterDailyCandidate = (
  candidate: DailyCandidate,
  bestCandidate: DailyCandidate | null,
): boolean => (
  !bestCandidate
  || candidate.difficultyScore > bestCandidate.difficultyScore
  || (
    candidate.difficultyScore === bestCandidate.difficultyScore
    && candidate.variantId < bestCandidate.variantId
  )
);

const generateAndValidateDailyCandidate = (
  slot: number,
  variantId: number,
  infiniteCanonicalKeys: ReadonlySet<string>,
  dailyCanonicalKeys: ReadonlySet<string>,
): DailyCandidate | null => {
  let level: DailyLevel;
  try {
    level = asDailyLevel(generateInfiniteLevelFromVariant(slot, variantId));
  } catch {
    return null;
  }

  const canonicalKey = canonicalConstraintFingerprint(level).key;
  if (infiniteCanonicalKeys.has(canonicalKey)) return null;
  if (dailyCanonicalKeys.has(canonicalKey)) return null;
  if (!replayWitnessAndValidate(level)) return null;

  return {
    slot,
    infiniteIndex: slot,
    variantId,
    canonicalKey,
    level,
    difficultyScore: estimateDailyDifficultyScore(level),
  };
};

export const selectDailyCandidateForSlot = (
  slot: number,
  {
    infiniteCanonicalKeys,
    dailyCanonicalKeys,
    maxVariantProbe = DAILY_POOL_MAX_VARIANT_PROBE,
    baseVariantId = DAILY_POOL_BASE_VARIANT_ID,
    difficultyVariantWindow = DAILY_POOL_DIFFICULTY_VARIANT_WINDOW,
  }: {
    infiniteCanonicalKeys: ReadonlySet<string>;
    dailyCanonicalKeys: ReadonlySet<string>;
    maxVariantProbe?: number;
    baseVariantId?: number;
    difficultyVariantWindow?: number;
  },
): DailyCandidate => {
  if (!Number.isInteger(maxVariantProbe) || maxVariantProbe < baseVariantId) {
    throw new Error(`maxVariantProbe must be >= ${baseVariantId}, got ${maxVariantProbe}`);
  }
  if (!Number.isInteger(difficultyVariantWindow) || difficultyVariantWindow <= 0) {
    throw new Error(`difficultyVariantWindow must be a positive integer, got ${difficultyVariantWindow}`);
  }

  const windowEnd = Math.min(maxVariantProbe, baseVariantId + difficultyVariantWindow - 1);
  let bestWindowCandidate: DailyCandidate | null = null;
  let firstFallbackCandidate: DailyCandidate | null = null;

  for (let variantId = baseVariantId; variantId <= maxVariantProbe; variantId += 1) {
    const candidate = generateAndValidateDailyCandidate(
      slot,
      variantId,
      infiniteCanonicalKeys,
      dailyCanonicalKeys,
    );
    if (!candidate) continue;

    if (variantId > windowEnd) {
      if (!bestWindowCandidate) firstFallbackCandidate = candidate;
      break;
    }

    if (isBetterDailyCandidate(candidate, bestWindowCandidate)) {
      bestWindowCandidate = candidate;
    }
  }

  if (bestWindowCandidate) return bestWindowCandidate;
  if (firstFallbackCandidate) return firstFallbackCandidate;

  throw new Error(`Unable to find unique solvable daily variant for slot ${slot}`);
};

export const computePoolDigest = (records: Iterable<string>): string => {
  const hash = createHash('sha256');
  for (const record of records) {
    hash.update(String(record));
    hash.update('\n');
  }
  return hash.digest('hex');
};

export const utcStartMsFromDateId = (dateId: string): number => {
  const startMs = parseUtcDateIdStartMs(dateId);
  if (typeof startMs !== 'number' || !Number.isInteger(startMs)) {
    throw new TypeError(`Invalid UTC date id: ${dateId}`);
  }
  return startMs;
};

export const addUtcDaysToDateId = (dateId: string, deltaDays: number): string => {
  if (!Number.isInteger(deltaDays)) {
    throw new TypeError(`deltaDays must be an integer, got ${deltaDays}`);
  }
  return utcDateIdFromMs(utcStartMsFromDateId(dateId) + (deltaDays * DAY_MS));
};

export const computeDayOrdinal = (
  dateId: string,
  epochDateId = DAILY_POOL_EPOCH_UTC_DATE,
): number => {
  const dayStart = utcStartMsFromDateId(dateId);
  const epochStart = utcStartMsFromDateId(epochDateId);
  return Math.floor((dayStart - epochStart) / DAY_MS);
};

interface HmacCounterRng {
  nextInt: (maxExclusive: number) => number;
}

const createHmacCounterRng = (secret: string, context: string): HmacCounterRng => {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let offset = 0;

  const refill = (): void => {
    pool = createHmac('sha256', secret)
      .update(`${context}:${counter}`)
      .digest();
    counter += 1;
    offset = 0;
  };

  const nextUint32 = (): number => {
    if ((offset + 4) > pool.length) refill();
    const value = pool.readUInt32LE(offset) >>> 0;
    offset += 4;
    return value;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    if (maxExclusive === 1) return 0;

    const UINT32 = 0x100000000;
    const limit = Math.floor(UINT32 / maxExclusive) * maxExclusive;
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    return value % maxExclusive;
  };

  refill();
  return { nextInt };
};

export const buildSecretPermutation = (
  secret: string,
  maxSlots: number,
  context = 'tether|daily|perm|v1',
): number[] => {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Secret must be a non-empty string');
  }
  if (!Number.isInteger(maxSlots) || maxSlots <= 0) {
    throw new Error(`maxSlots must be a positive integer, got ${maxSlots}`);
  }

  const permutation = Array.from({ length: maxSlots }, (_, i) => i);
  const rng = createHmacCounterRng(secret, context);

  for (let i = maxSlots - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const tmp = permutation[i];
    permutation[i] = permutation[j];
    permutation[j] = tmp;
  }

  return permutation;
};

export const writeDailyOverridesGzipFile = (
  outFilePath: string,
  overrides: DailyOverrideInput,
  maxVariantUsed = 0,
  gzipOptions: GzipOptionsWithMtime = {},
): {
  payload: Uint8Array;
  variantBits: number;
  entryCount: number;
  compressedBytes: number;
  packedBytes: number;
} => {
  const encoded = encodeDailyOverridesPayload(overrides, maxVariantUsed);
  const compressed = gzipSync(encoded.payload, {
    level: 9,
    mtime: 0,
    ...gzipOptions,
  } as GzipOptionsWithMtime);
  fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
  fs.writeFileSync(outFilePath, compressed);
  return {
    ...encoded,
    compressedBytes: compressed.length,
    packedBytes: encoded.payload.length,
  };
};

export const readDailyOverridesGzipFile = (
  filePath: string,
): Readonly<Record<number, number>> => {
  const compressed = fs.readFileSync(filePath);
  const payload = gunzipSync(compressed);
  return decodeDailyOverridesPayload(new Uint8Array(payload));
};

export const toDailyPayloadLevel = (
  level: DailyLevel | null | undefined,
  dailyId: string,
): {
  name: string;
  grid: string[];
  stitches: GridTuple[];
  cornerCounts: Array<[number, number, number]>;
} => ({
  name: `Daily ${dailyId}`,
  grid: Array.isArray(level?.grid) ? level.grid.slice() : [],
  stitches: Array.isArray(level?.stitches)
    ? level.stitches.map((entry): GridTuple => [entry[0], entry[1]])
    : [],
  cornerCounts: Array.isArray(level?.cornerCounts)
    ? level.cornerCounts.map((entry): [number, number, number] => [entry[0], entry[1], entry[2]])
    : [],
});

export { utcDateIdFromMs } from '../src/shared/utc_date.ts';
