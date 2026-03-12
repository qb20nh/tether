// @ts-nocheck
import { isUtcDateId } from './utc_date.ts';

export const DAILY_HISTORY_SCHEMA_VERSION = 1;
export const DAILY_PAYLOAD_SCHEMA_VERSION = 1;

const normalizeGrid = (grid) => {
  if (!Array.isArray(grid) || grid.length === 0) return null;

  const out = [];
  let cols = null;
  for (const row of grid) {
    if (typeof row !== 'string' || row.length === 0) return null;
    if (cols === null) cols = row.length;
    if (row.length !== cols) return null;
    out.push(row);
  }

  return out;
};

const normalizePairs = (value) => {
  if (!Array.isArray(value)) return [];

  const out = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    out.push([a, b]);
  }

  return out;
};

const normalizeCornerCounts = (value) => {
  if (!Array.isArray(value)) return [];

  const out = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 3) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    const c = Number.parseInt(entry[2], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return null;
    out.push([a, b, c]);
  }

  return out;
};

const parseNullableInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const normalizeLooseDailyId = (value) => (typeof value === 'string' ? value : '');

const normalizeCanonicalKey = (value) => (typeof value === 'string' ? value : '');

export const normalizeDailyPayloadLevel = (raw, dailyId = '') => {
  if (!raw || typeof raw !== 'object') return null;

  const grid = normalizeGrid(raw.grid);
  const stitches = normalizePairs(raw.stitches);
  const cornerCounts = normalizeCornerCounts(raw.cornerCounts);
  if (!grid || !stitches || !cornerCounts) return null;

  return {
    name: typeof raw.name === 'string' ? raw.name : `Daily ${dailyId}`,
    grid,
    stitches,
    cornerCounts,
  };
};

export const normalizeDailyPayloadHeader = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const dailyId = normalizeLooseDailyId(raw.dailyId);
  const dailySlot = Number.isInteger(raw.dailySlot) ? raw.dailySlot : -1;
  const canonicalKey = normalizeCanonicalKey(raw.canonicalKey);
  if (!dailyId || dailySlot < 0 || !canonicalKey) return null;

  return {
    schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0,
    poolVersion: typeof raw.poolVersion === 'string' ? raw.poolVersion : '',
    dailyId,
    dailySlot,
    canonicalKey,
    generatedAtUtcMs: Number.isInteger(raw.generatedAtUtcMs) ? raw.generatedAtUtcMs : 0,
  };
};

export const normalizeDailyPayload = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const dailyId = isUtcDateId(raw.dailyId) ? raw.dailyId : null;
  if (!dailyId) return null;

  const hardInvalidateAtUtcMs = parseNullableInt(raw.hardInvalidateAtUtcMs);
  if (!Number.isInteger(hardInvalidateAtUtcMs) || hardInvalidateAtUtcMs <= 0) return null;

  const level = normalizeDailyPayloadLevel(raw.level, dailyId);
  if (!level) return null;

  const dailySlot = parseNullableInt(raw.dailySlot);
  const generatedAtUtcMs = parseNullableInt(raw.generatedAtUtcMs);

  return {
    schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0,
    poolVersion: typeof raw.poolVersion === 'string' ? raw.poolVersion : '',
    dailyId,
    dailySlot: Number.isInteger(dailySlot) ? dailySlot : null,
    canonicalKey: typeof raw.canonicalKey === 'string' ? raw.canonicalKey : '',
    generatedAtUtcMs: Number.isInteger(generatedAtUtcMs) ? generatedAtUtcMs : null,
    hardInvalidateAtUtcMs,
    level,
  };
};

export const normalizeDailyHistoryEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;

  const dailyId = normalizeLooseDailyId(entry.dailyId);
  const dailySlot = Number.isInteger(entry.dailySlot) ? entry.dailySlot : -1;
  const canonicalKey = normalizeCanonicalKey(entry.canonicalKey);
  if (!dailyId || dailySlot < 0 || !canonicalKey) return null;

  return {
    dailyId,
    dailySlot,
    canonicalKey,
    poolVersion: typeof entry.poolVersion === 'string' ? entry.poolVersion : '',
    publishedAtUtcMs: Number.isInteger(entry.publishedAtUtcMs) ? entry.publishedAtUtcMs : 0,
  };
};

export const normalizeDailyHistory = (
  raw,
  { schemaVersion = DAILY_HISTORY_SCHEMA_VERSION } = {},
) => {
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion, entries: [] };
  }

  const entries = Array.isArray(raw.entries)
    ? raw.entries.map((entry) => normalizeDailyHistoryEntry(entry)).filter(Boolean)
    : [];

  return {
    schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : schemaVersion,
    entries,
  };
};
