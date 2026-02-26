import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  INFINITE_MAX_LEVELS,
  generateInfiniteLevel,
  generateInfiniteLevelFromVariant,
} from '../src/infinite.js';
import { canonicalConstraintFingerprint } from '../src/infinite_canonical.js';
import { createGameStateStore } from '../src/state/game_state_store.js';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../src/rules.js';
import {
  decodeDailyOverridesPayload,
  encodeDailyOverridesPayload,
} from '../src/daily_pool_codec.js';

export const DAILY_POOL_SCHEMA_VERSION = 1;
export const DAILY_POOL_VERSION = 'v1';
export const DAILY_POOL_EPOCH_UTC_DATE = '2026-01-01';
export const DAILY_POOL_MAX_SLOTS = 30000;
export const DAILY_POOL_BASE_VARIANT_ID = 0;
export const DAILY_POOL_MAX_VARIANT_PROBE = 255;
export const DAILY_POOL_DIFFICULTY_VARIANT_WINDOW = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

const parsePair = (entry) => {
  const r = Array.isArray(entry) ? entry[0] : entry?.r;
  const c = Array.isArray(entry) ? entry[1] : entry?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
};

const countMovableWalls = (level) => {
  let count = 0;
  for (const row of level.grid || []) {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === 'm') count += 1;
    }
  }
  return count;
};

const countCellType = (level, matcher) => {
  let count = 0;
  for (const row of level?.grid || []) {
    for (let i = 0; i < row.length; i++) {
      if (matcher(row[i])) count += 1;
    }
  }
  return count;
};

const countWitnessTurns = (witnessPathRaw) => {
  if (!Array.isArray(witnessPathRaw) || witnessPathRaw.length < 3) return 0;
  let turns = 0;
  let prevDr = null;
  let prevDc = null;

  for (let i = 1; i < witnessPathRaw.length; i++) {
    const prev = parsePair(witnessPathRaw[i - 1]);
    const next = parsePair(witnessPathRaw[i]);
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

export const estimateDailyDifficultyScore = (level) => {
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
  const witnessPathRaw = level?.infiniteMeta?.witnessPath;
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

const evaluateSnapshotCompletion = (snapshot) => {
  const evaluate = {
    hintStatus: evaluateHints(snapshot, {}),
    stitchStatus: evaluateStitches(snapshot),
    rpsStatus: evaluateRPS(snapshot),
    blockedStatus: evaluateBlockedCells(snapshot),
  };
  return checkCompletion(snapshot, evaluate, (key) => key);
};

export const replayWitnessAndValidate = (level) => {
  if (!level || !Array.isArray(level.grid)) return false;

  const witnessPathRaw = level?.infiniteMeta?.witnessPath;
  if (!Array.isArray(witnessPathRaw) || witnessPathRaw.length === 0) return false;

  const witnessPath = [];
  for (let i = 0; i < witnessPathRaw.length; i++) {
    const parsed = parsePair(witnessPathRaw[i]);
    if (!parsed) return false;
    witnessPath.push(parsed);
  }

  const store = createGameStateStore(() => level);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  const movableWallCount = countMovableWalls(level);
  const witnessMovableWallsRaw = level?.infiniteMeta?.witnessMovableWalls;
  if (movableWallCount > 0) {
    if (!Array.isArray(witnessMovableWallsRaw) || witnessMovableWallsRaw.length !== movableWallCount) {
      return false;
    }

    const restored = store.restoreMutableState({
      levelIndex: 0,
      path: [],
      movableWalls: witnessMovableWallsRaw,
    });
    if (!restored) return false;
  }

  for (let i = 0; i < witnessPath.length; i++) {
    const point = witnessPath[i];
    const transition = store.dispatch({
      type: 'path/start-or-step',
      payload: { r: point.r, c: point.c },
    });
    if (!transition.changed) return false;
  }

  const snapshot = store.getSnapshot();
  const completion = evaluateSnapshotCompletion(snapshot);
  return completion?.kind === 'good';
};

export const buildInfiniteCanonicalKeySet = (maxLevels = INFINITE_MAX_LEVELS) => {
  if (!Number.isInteger(maxLevels) || maxLevels <= 0 || maxLevels > INFINITE_MAX_LEVELS) {
    throw new Error(`maxLevels must be 1..${INFINITE_MAX_LEVELS}, got ${maxLevels}`);
  }

  const out = new Set();
  for (let i = 0; i < maxLevels; i++) {
    const level = generateInfiniteLevel(i);
    out.add(canonicalConstraintFingerprint(level).key);
  }
  return out;
};

export const materializeDailyLevelForSlot = (slot, overridesBySlot = null, baseVariantId = DAILY_POOL_BASE_VARIANT_ID) => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INFINITE_MAX_LEVELS) {
    throw new Error(`daily slot must be 0..${INFINITE_MAX_LEVELS - 1}, got ${slot}`);
  }

  const overrideVariant = overridesBySlot ? overridesBySlot[slot] : null;
  const variantId = Number.isInteger(overrideVariant) && overrideVariant >= 0
    ? overrideVariant
    : baseVariantId;
  const level = generateInfiniteLevelFromVariant(slot, variantId);
  const canonicalKey = canonicalConstraintFingerprint(level).key;

  return {
    slot,
    infiniteIndex: slot,
    variantId,
    level,
    canonicalKey,
  };
};

export const selectDailyCandidateForSlot = (
  slot,
  {
    infiniteCanonicalKeys,
    dailyCanonicalKeys,
    maxVariantProbe = DAILY_POOL_MAX_VARIANT_PROBE,
    baseVariantId = DAILY_POOL_BASE_VARIANT_ID,
    difficultyVariantWindow = DAILY_POOL_DIFFICULTY_VARIANT_WINDOW,
  },
) => {
  if (!Number.isInteger(maxVariantProbe) || maxVariantProbe < baseVariantId) {
    throw new Error(`maxVariantProbe must be >= ${baseVariantId}, got ${maxVariantProbe}`);
  }
  if (!Number.isInteger(difficultyVariantWindow) || difficultyVariantWindow <= 0) {
    throw new Error(`difficultyVariantWindow must be a positive integer, got ${difficultyVariantWindow}`);
  }

  const windowEnd = Math.min(maxVariantProbe, baseVariantId + difficultyVariantWindow - 1);
  let bestWindowCandidate = null;
  let firstFallbackCandidate = null;

  for (let variantId = baseVariantId; variantId <= maxVariantProbe; variantId++) {
    let level = null;
    try {
      level = generateInfiniteLevelFromVariant(slot, variantId);
    } catch {
      continue;
    }

    const canonicalKey = canonicalConstraintFingerprint(level).key;
    if (infiniteCanonicalKeys?.has(canonicalKey)) continue;
    if (dailyCanonicalKeys?.has(canonicalKey)) continue;
    if (!replayWitnessAndValidate(level)) continue;

    const candidate = {
      slot,
      infiniteIndex: slot,
      variantId,
      canonicalKey,
      level,
      difficultyScore: estimateDailyDifficultyScore(level),
    };

    if (variantId <= windowEnd) {
      if (
        !bestWindowCandidate
        || candidate.difficultyScore > bestWindowCandidate.difficultyScore
        || (
          candidate.difficultyScore === bestWindowCandidate.difficultyScore
          && candidate.variantId < bestWindowCandidate.variantId
        )
      ) {
        bestWindowCandidate = candidate;
      }
      continue;
    }

    if (!bestWindowCandidate) {
      firstFallbackCandidate = candidate;
      break;
    }
    break;
  }

  if (bestWindowCandidate) return bestWindowCandidate;
  if (firstFallbackCandidate) return firstFallbackCandidate;

  throw new Error(`Unable to find unique solvable daily variant for slot ${slot}`);
};

export const computePoolDigest = (records) => {
  const hash = createHash('sha256');
  for (const record of records) {
    hash.update(String(record));
    hash.update('\n');
  }
  return hash.digest('hex');
};

export const utcDateIdFromMs = (ms) => {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const utcStartMsFromDateId = (dateId) => {
  if (typeof dateId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
    throw new Error(`Invalid UTC date id: ${dateId}`);
  }
  const [y, m, d] = dateId.split('-').map((part) => Number.parseInt(part, 10));
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
};

export const addUtcDaysToDateId = (dateId, deltaDays) => {
  if (!Number.isInteger(deltaDays)) {
    throw new Error(`deltaDays must be an integer, got ${deltaDays}`);
  }
  return utcDateIdFromMs(utcStartMsFromDateId(dateId) + (deltaDays * DAY_MS));
};

export const computeDayOrdinal = (dateId, epochDateId = DAILY_POOL_EPOCH_UTC_DATE) => {
  const dayStart = utcStartMsFromDateId(dateId);
  const epochStart = utcStartMsFromDateId(epochDateId);
  return Math.floor((dayStart - epochStart) / DAY_MS);
};

const createHmacCounterRng = (secret, context) => {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let offset = 0;

  const refill = () => {
    pool = createHmac('sha256', secret)
      .update(`${context}:${counter}`)
      .digest();
    counter += 1;
    offset = 0;
  };

  const nextUint32 = () => {
    if ((offset + 4) > pool.length) refill();
    const value = pool.readUInt32LE(offset) >>> 0;
    offset += 4;
    return value;
  };

  const nextInt = (maxExclusive) => {
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

export const buildSecretPermutation = (secret, maxSlots, context = 'tether|daily|perm|v1') => {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Secret must be a non-empty string');
  }
  if (!Number.isInteger(maxSlots) || maxSlots <= 0) {
    throw new Error(`maxSlots must be a positive integer, got ${maxSlots}`);
  }

  const permutation = Array.from({ length: maxSlots }, (_, i) => i);
  const rng = createHmacCounterRng(secret, context);

  for (let i = maxSlots - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = permutation[i];
    permutation[i] = permutation[j];
    permutation[j] = tmp;
  }

  return permutation;
};

export const writeDailyOverridesGzipFile = (
  outFilePath,
  overrides,
  maxVariantUsed = 0,
  gzipOptions = {},
) => {
  const encoded = encodeDailyOverridesPayload(overrides, maxVariantUsed);
  const compressed = gzipSync(encoded.payload, {
    level: 9,
    mtime: 0,
    ...gzipOptions,
  });
  fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
  fs.writeFileSync(outFilePath, compressed);
  return {
    ...encoded,
    compressedBytes: compressed.length,
    packedBytes: encoded.payload.length,
  };
};

export const readDailyOverridesGzipFile = (filePath) => {
  const compressed = fs.readFileSync(filePath);
  const payload = gunzipSync(compressed);
  return decodeDailyOverridesPayload(new Uint8Array(payload));
};

export const toDailyPayloadLevel = (level, dailyId) => ({
  name: `Daily ${dailyId}`,
  grid: Array.isArray(level?.grid) ? level.grid.slice() : [],
  stitches: Array.isArray(level?.stitches)
    ? level.stitches.map((entry) => [entry[0], entry[1]])
    : [],
  cornerCounts: Array.isArray(level?.cornerCounts)
    ? level.cornerCounts.map((entry) => [entry[0], entry[1], entry[2]])
    : [],
});
