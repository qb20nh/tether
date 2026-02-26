#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from './daily_pool_tools.js';

const HISTORY_SCHEMA_VERSION = 1;
const PAYLOAD_SCHEMA_VERSION = 1;

const DEFAULTS = {
  manifestFile: path.resolve(process.cwd(), 'src/daily_pool_manifest.json'),
  overridesFile: path.resolve(process.cwd(), 'src/daily_overrides.bin.gz'),
  historyFile: path.resolve(process.cwd(), 'daily/history.json'),
  todayFile: path.resolve(process.cwd(), 'daily/today.json'),
  nowMs: null,
  dailySecret: null,
  json: false,
};

const parseArgs = (argv) => {
  const opts = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === '--manifest') opts.manifestFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--overrides') opts.overridesFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--history') opts.historyFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--today') opts.todayFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--now-ms') {
      const parsed = Number.parseInt(nextValue(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--now-ms must be a positive integer, got ${parsed}`);
      }
      opts.nowMs = parsed;
    }
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/publish_daily_level.js [options]',
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
  }

  return opts;
};

const readJson = (filePath, fallback = undefined) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error && typeof error === 'object' && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const normalizeHistory = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] };
  }

  const entries = Array.isArray(raw.entries) ? raw.entries.filter((entry) => entry && typeof entry === 'object') : [];
  return {
    schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : HISTORY_SCHEMA_VERSION,
    entries: entries.map((entry) => ({
      dailyId: String(entry.dailyId || ''),
      dailySlot: Number.isInteger(entry.dailySlot) ? entry.dailySlot : -1,
      canonicalKey: String(entry.canonicalKey || ''),
      poolVersion: String(entry.poolVersion || ''),
      publishedAtUtcMs: Number.isInteger(entry.publishedAtUtcMs) ? entry.publishedAtUtcMs : 0,
    })).filter((entry) => entry.dailyId && entry.dailySlot >= 0 && entry.canonicalKey),
  };
};

const normalizeTodayPayload = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const dailyId = typeof raw.dailyId === 'string' ? raw.dailyId : '';
  const dailySlot = Number.isInteger(raw.dailySlot) ? raw.dailySlot : -1;
  const canonicalKey = typeof raw.canonicalKey === 'string' ? raw.canonicalKey : '';
  const generatedAtUtcMs = Number.isInteger(raw.generatedAtUtcMs) ? raw.generatedAtUtcMs : 0;
  if (!dailyId || dailySlot < 0 || !canonicalKey) return null;
  return {
    dailyId,
    dailySlot,
    canonicalKey,
    generatedAtUtcMs,
  };
};

export const publishDailyLevel = (rawOptions = {}) => {
  const opts = { ...DEFAULTS, ...rawOptions };

  const dailySecret = typeof opts.dailySecret === 'string' && opts.dailySecret.length > 0
    ? opts.dailySecret
    : process.env.DAILY_SECRET;
  if (typeof dailySecret !== 'string' || dailySecret.length === 0) {
    throw new Error('DAILY_SECRET is required');
  }

  const manifest = readJson(opts.manifestFile);
  const maxSlots = Number.isInteger(manifest?.maxSlots) ? manifest.maxSlots : DAILY_POOL_MAX_SLOTS;
  const baseVariantId = Number.isInteger(manifest?.baseVariantId)
    ? manifest.baseVariantId
    : DAILY_POOL_BASE_VARIANT_ID;

  const nowMs = Number.isInteger(opts.nowMs) ? opts.nowMs : Date.now();
  const dailyId = utcDateIdFromMs(nowMs);
  const ordinal = computeDayOrdinal(dailyId, manifest.epochUtcDate);

  if (ordinal < 0) {
    throw new Error(`Current date ${dailyId} is before pool epoch ${manifest.epochUtcDate}`);
  }
  if (ordinal >= maxSlots) {
    throw new Error(`Daily pool exhausted at ordinal ${ordinal} (maxSlots ${maxSlots}). Generate a new pool.`);
  }

  const permutation = buildSecretPermutation(
    dailySecret,
    maxSlots,
    `tether|daily|perm|${manifest.poolVersion}|${manifest.epochUtcDate}`,
  );
  const dailySlot = permutation[ordinal];

  const overrides = readDailyOverridesGzipFile(opts.overridesFile);
  const materialized = materializeDailyLevelForSlot(dailySlot, overrides, baseVariantId);

  if (!replayWitnessAndValidate(materialized.level)) {
    throw new Error(`Daily slot ${dailySlot} failed witness solvability check`);
  }

  const history = normalizeHistory(readJson(opts.historyFile, { schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] }));
  const todayEntry = history.entries.find((entry) => entry.dailyId === dailyId);
  if (todayEntry) {
    if (
      todayEntry.dailySlot !== dailySlot
      || todayEntry.canonicalKey !== materialized.canonicalKey
      || todayEntry.poolVersion !== manifest.poolVersion
    ) {
      throw new Error(`History conflict for ${dailyId}: existing entry differs from computed payload`);
    }
  }

  const canonicalCollision = history.entries.find(
    (entry) => entry.canonicalKey === materialized.canonicalKey && entry.dailyId !== dailyId,
  );
  if (canonicalCollision) {
    throw new Error(`History collision: canonical key already used on ${canonicalCollision.dailyId}`);
  }

  const slotCollision = history.entries.find(
    (entry) => entry.dailySlot === dailySlot && entry.dailyId !== dailyId,
  );
  if (slotCollision) {
    throw new Error(`History collision: slot ${dailySlot} already used on ${slotCollision.dailyId}`);
  }

  const existingTodayPayload = normalizeTodayPayload(readJson(opts.todayFile, null));
  const stableGeneratedAtUtcMs = (
    Number.isInteger(todayEntry?.publishedAtUtcMs) && todayEntry.publishedAtUtcMs > 0
      ? todayEntry.publishedAtUtcMs
      : (
        existingTodayPayload
        && existingTodayPayload.dailyId === dailyId
        && existingTodayPayload.dailySlot === dailySlot
        && existingTodayPayload.canonicalKey === materialized.canonicalKey
        && existingTodayPayload.generatedAtUtcMs > 0
          ? existingTodayPayload.generatedAtUtcMs
          : nowMs
      )
  );

  const tomorrowId = addUtcDaysToDateId(dailyId, 1);
  const payload = {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    poolVersion: String(manifest.poolVersion || ''),
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
    generatedAtUtcMs: stableGeneratedAtUtcMs,
    hardInvalidateAtUtcMs: utcStartMsFromDateId(tomorrowId),
    level: toDailyPayloadLevel(materialized.level, dailyId),
  };

  if (!todayEntry) {
    history.entries.push({
      dailyId,
      dailySlot,
      canonicalKey: materialized.canonicalKey,
      poolVersion: String(manifest.poolVersion || ''),
      publishedAtUtcMs: stableGeneratedAtUtcMs,
    });
    history.entries.sort((a, b) => (a.dailyId < b.dailyId ? -1 : (a.dailyId > b.dailyId ? 1 : 0)));
  }

  writeJson(opts.todayFile, payload);
  writeJson(opts.historyFile, history);

  return {
    ok: true,
    dailyId,
    dailySlot,
    canonicalKey: materialized.canonicalKey,
    ordinal,
    wroteTodayFile: opts.todayFile,
    wroteHistoryFile: opts.historyFile,
    historyLength: history.entries.length,
  };
};

const runCli = () => {
  const opts = parseArgs(process.argv.slice(2));
  const summary = publishDailyLevel({
    ...opts,
    dailySecret: process.env.DAILY_SECRET,
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
