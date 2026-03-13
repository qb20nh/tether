#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAILY_OVERRIDES_REPO_FILE,
  DAILY_POOL_MANIFEST_REPO_FILE,
  PUBLIC_DAILY_HISTORY_REPO_FILE,
  PUBLIC_DAILY_PAYLOAD_REPO_FILE,
} from '../src/shared/paths.ts';
import {
  DAILY_POOL_BASE_VARIANT_ID,
  DAILY_POOL_MAX_SLOTS,
  addUtcDaysToDateId,
  buildSecretPermutation,
  computeDayOrdinal,
  materializeDailyLevelForSlot,
  readDailyOverridesGzipFile,
  replayWitnessAndValidate,
  toDailyPayloadLevel,
  utcDateIdFromMs,
  utcStartMsFromDateId,
} from './daily_pool_tools.ts';
import {
  DAILY_HISTORY_SCHEMA_VERSION,
  DAILY_PAYLOAD_SCHEMA_VERSION,
  normalizeDailyHistory,
  normalizeDailyHistoryEntry,
  normalizeDailyPayload,
  normalizeDailyPayloadHeader,
} from '../src/shared/daily_payload_schema.ts';
import {
  parsePositiveInt,
  readJsonFile,
  readRequiredArgValue,
  writeJsonFile,
} from './lib/cli_utils.ts';

type DailyHistory = ReturnType<typeof normalizeDailyHistory>;
type DailyHistoryEntry = DailyHistory['entries'][number];
type DailyPayloadHeader = NonNullable<ReturnType<typeof normalizeDailyPayloadHeader>>;

interface PublishDailyLevelOptions {
  manifestFile: string;
  overridesFile: string;
  historyFile: string;
  todayFile: string;
  nowMs: number | null;
  dailySecret: string | null;
  json: boolean;
}

interface DailyPoolManifest {
  poolVersion?: string;
  epochUtcDate?: string;
  maxSlots?: number;
  baseVariantId?: number;
}

export interface PublishDailyLevelSummary {
  ok: true;
  preservedExistingDaily: boolean;
  dailyId: string;
  dailySlot: number;
  canonicalKey: string;
  ordinal: number | null;
  wroteTodayFile: string | null;
  wroteHistoryFile: string | null;
  historyLength: number;
}

const DEFAULTS: PublishDailyLevelOptions = {
  manifestFile: path.resolve(process.cwd(), DAILY_POOL_MANIFEST_REPO_FILE),
  overridesFile: path.resolve(process.cwd(), DAILY_OVERRIDES_REPO_FILE),
  historyFile: path.resolve(process.cwd(), PUBLIC_DAILY_HISTORY_REPO_FILE),
  todayFile: path.resolve(process.cwd(), PUBLIC_DAILY_PAYLOAD_REPO_FILE),
  nowMs: null,
  dailySecret: null,
  json: false,
};

const parseArgs = (argv: readonly string[]): PublishDailyLevelOptions => {
  const opts: PublishDailyLevelOptions = { ...DEFAULTS };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    let nextArgIndex = index + 1;
    const nextValue = (): string => {
      const result = readRequiredArgValue(argv, index, arg);
      nextArgIndex = result.nextIndex + 1;
      return result.value;
    };

    if (arg === '--manifest') opts.manifestFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--overrides') opts.overridesFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--history') opts.historyFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--today') opts.todayFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--now-ms') {
      opts.nowMs = parsePositiveInt('--now-ms', nextValue());
    }
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/publish_daily_level.ts [options]',
          '',
          'Options:',
          `  --manifest <path>       Daily pool manifest path (default: ${DEFAULTS.manifestFile})`,
          `  --overrides <path>      Daily override payload path (default: ${DEFAULTS.overridesFile})`,
          `  --history <path>        Daily history ledger path (default: ${DEFAULTS.historyFile})`,
          `  --today <path>          Today's payload output path (default: ${DEFAULTS.todayFile})`,
          '  --now-ms <epochMs>      Override current time for testing',
          '  --json                  Emit JSON summary',
          '  --help                  Show this help',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    index = nextArgIndex;
  }

  return opts;
};

const sortHistoryEntriesByDailyId = (entries: readonly DailyHistoryEntry[] = []): DailyHistoryEntry[] =>
  [...entries].sort((a, b) => a.dailyId.localeCompare(b.dailyId));

const trimHistoryEntries = (
  entries: readonly DailyHistoryEntry[] = [],
  maxEntries = DAILY_POOL_MAX_SLOTS,
): DailyHistoryEntry[] => {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) return [];
  if (entries.length <= maxEntries) return [...entries];
  return entries.slice(entries.length - maxEntries);
};

const pruneHistoryForAppend = (
  entries: readonly DailyHistoryEntry[] = [],
  {
    maxEntries = DAILY_POOL_MAX_SLOTS,
    dailyId = '',
    dailySlot = -1,
    canonicalKey = '',
  }: {
    maxEntries?: number;
    dailyId?: string;
    dailySlot?: number;
    canonicalKey?: string;
  } = {},
): DailyHistoryEntry[] => {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) return [];
  const out = [...entries];
  const hasCollision = (): boolean => out.some((entry) => (
    entry.dailyId !== dailyId
    && (entry.dailySlot === dailySlot || entry.canonicalKey === canonicalKey)
  ));

  for (let i = 0, limit = out.length; i < limit; i += 1) {
    if (out.length === 0) break;
    if (out.length < maxEntries && !hasCollision()) break;
    out.shift();
  }

  return out;
};

const readPreservedExistingDailySummary = ({
  todayEntry,
  todayFile,
  dailyId,
  historyLength,
}: {
  todayEntry: DailyHistoryEntry | undefined;
  todayFile: string;
  dailyId: string;
  historyLength: number;
}): PublishDailyLevelSummary | null => {
  if (!todayEntry) return null;

  const existingTodayPayload = normalizeDailyPayloadHeader(readJsonFile(todayFile, null));
  const payloadMatchesHistory = Boolean(
    existingTodayPayload?.dailyId === dailyId
    && existingTodayPayload.dailySlot === todayEntry.dailySlot
    && existingTodayPayload.canonicalKey === todayEntry.canonicalKey
  );
  if (!payloadMatchesHistory) {
    throw new Error(`History conflict for ${dailyId}: existing daily payload does not match history entry`);
  }

  return {
    ok: true,
    preservedExistingDaily: true,
    dailyId,
    dailySlot: todayEntry.dailySlot,
    canonicalKey: todayEntry.canonicalKey,
    ordinal: null,
    wroteTodayFile: null,
    wroteHistoryFile: null,
    historyLength,
  };
};

const resolveStableGeneratedAtUtcMs = ({
  existingTodayPayload,
  dailyId,
  dailySlot,
  canonicalKey,
  nowMs,
}: {
  existingTodayPayload: DailyPayloadHeader | null;
  dailyId: string;
  dailySlot: number;
  canonicalKey: string;
  nowMs: number;
}): number => (
  existingTodayPayload?.dailyId === dailyId
    && existingTodayPayload.dailySlot === dailySlot
    && existingTodayPayload.canonicalKey === canonicalKey
    && existingTodayPayload.generatedAtUtcMs > 0
    ? existingTodayPayload.generatedAtUtcMs
    : nowMs
);

export const publishDailyLevel = (
  rawOptions: Partial<PublishDailyLevelOptions> = {},
): PublishDailyLevelSummary => {
  const opts: PublishDailyLevelOptions = { ...DEFAULTS, ...rawOptions };

  const nowMs = typeof opts.nowMs === 'number' && Number.isInteger(opts.nowMs) ? opts.nowMs : Date.now();
  const dailyId = utcDateIdFromMs(nowMs);
  const manifest = readJsonFile<DailyPoolManifest>(opts.manifestFile);
  const maxSlots = typeof manifest.maxSlots === 'number' ? manifest.maxSlots : DAILY_POOL_MAX_SLOTS;
  if (!Number.isInteger(maxSlots) || maxSlots <= 0) {
    throw new Error(`Invalid maxSlots in manifest: ${manifest.maxSlots}`);
  }
  const baseVariantId = typeof manifest.baseVariantId === 'number'
    ? manifest.baseVariantId
    : DAILY_POOL_BASE_VARIANT_ID;
  const history = normalizeDailyHistory(
    readJsonFile(opts.historyFile, { schemaVersion: DAILY_HISTORY_SCHEMA_VERSION, entries: [] }),
    { schemaVersion: DAILY_HISTORY_SCHEMA_VERSION },
  );
  history.entries = trimHistoryEntries(
    sortHistoryEntriesByDailyId(history.entries),
    maxSlots,
  );
  const todayEntry = history.entries.find((entry) => entry.dailyId === dailyId);
  const preservedExistingDailySummary = readPreservedExistingDailySummary({
    todayEntry,
    todayFile: opts.todayFile,
    dailyId,
    historyLength: history.entries.length,
  });
  if (preservedExistingDailySummary) return preservedExistingDailySummary;

  const dailySecret = typeof opts.dailySecret === 'string' && opts.dailySecret.length > 0
    ? opts.dailySecret
    : process.env.DAILY_SECRET;
  if (typeof dailySecret !== 'string' || dailySecret.length === 0) {
    throw new Error('DAILY_SECRET is required');
  }

  const ordinal = computeDayOrdinal(dailyId, manifest.epochUtcDate ?? '');

  if (ordinal < 0) {
    throw new Error(`Current date ${dailyId} is before pool epoch ${manifest.epochUtcDate}`);
  }
  const slotOrdinal = ordinal % maxSlots;

  const permutation = buildSecretPermutation(
    dailySecret,
    maxSlots,
    `tether|daily|perm|${manifest.poolVersion ?? ''}|${manifest.epochUtcDate ?? ''}`,
  );
  const dailySlot = permutation[slotOrdinal];

  const overrides = readDailyOverridesGzipFile(opts.overridesFile);
  const materialized = materializeDailyLevelForSlot(dailySlot, overrides, baseVariantId);

  if (!replayWitnessAndValidate(materialized.level)) {
    throw new Error(`Daily slot ${dailySlot} failed witness solvability check`);
  }

  history.entries = pruneHistoryForAppend(history.entries, {
    maxEntries: maxSlots,
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
  });

  const existingTodayPayload = normalizeDailyPayloadHeader(readJsonFile(opts.todayFile, null));
  const stableGeneratedAtUtcMs = resolveStableGeneratedAtUtcMs({
    existingTodayPayload,
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
    nowMs,
  });

  const tomorrowId = addUtcDaysToDateId(dailyId, 1);
  const payload = normalizeDailyPayload({
    schemaVersion: DAILY_PAYLOAD_SCHEMA_VERSION,
    poolVersion: String(manifest.poolVersion || ''),
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
    generatedAtUtcMs: stableGeneratedAtUtcMs,
    hardInvalidateAtUtcMs: utcStartMsFromDateId(tomorrowId),
    level: toDailyPayloadLevel(materialized.level, dailyId),
  });
  if (!payload) {
    throw new Error(`Generated invalid daily payload for ${dailyId}`);
  }

  const historyEntry = normalizeDailyHistoryEntry({
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
    poolVersion: String(manifest.poolVersion || ''),
    publishedAtUtcMs: stableGeneratedAtUtcMs,
  });
  if (!historyEntry) {
    throw new Error(`Generated invalid daily history entry for ${dailyId}`);
  }
  history.entries.push(historyEntry);
  history.entries = trimHistoryEntries(
    sortHistoryEntriesByDailyId(history.entries),
    maxSlots,
  );

  writeJsonFile(opts.todayFile, payload);
  writeJsonFile(opts.historyFile, history);

  return {
    ok: true,
    preservedExistingDaily: false,
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
    ordinal,
    wroteTodayFile: opts.todayFile,
    wroteHistoryFile: opts.historyFile,
    historyLength: history.entries.length,
  };
};

const runCli = (): void => {
  const opts = parseArgs(process.argv.slice(2));
  const summary = publishDailyLevel({
    ...opts,
    dailySecret: process.env.DAILY_SECRET ?? null,
  });

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Published daily payload for ${summary.dailyId} (slot ${summary.dailySlot})`);
  }
};

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
