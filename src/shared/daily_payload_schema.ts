import { isUtcDateId } from './utc_date.ts';
import type {
  GridTuple,
  LevelDefinition,
} from '../contracts/ports.ts';

export const DAILY_HISTORY_SCHEMA_VERSION = 1;
export const DAILY_PAYLOAD_SCHEMA_VERSION = 1;

interface DailyPayloadLevel extends Pick<LevelDefinition, 'grid' | 'stitches' | 'cornerCounts'> {
  name: string;
}

interface DailyPayloadHeader {
  schemaVersion: number;
  poolVersion: string;
  dailyId: string;
  dailySlot: number;
  canonicalKey: string;
  generatedAtUtcMs: number;
}

interface DailyPayload {
  schemaVersion: number;
  poolVersion: string;
  dailyId: string;
  dailySlot: number | null;
  canonicalKey: string;
  generatedAtUtcMs: number | null;
  hardInvalidateAtUtcMs: number;
  level: DailyPayloadLevel;
}

interface DailyHistoryEntry {
  dailyId: string;
  dailySlot: number;
  canonicalKey: string;
  poolVersion: string;
  publishedAtUtcMs: number;
}

interface DailyHistory {
  schemaVersion: number;
  entries: DailyHistoryEntry[];
}

const normalizeGrid = (grid: unknown): string[] | null => {
  if (!Array.isArray(grid) || grid.length === 0) return null;

  const out: string[] = [];
  let cols: number | null = null;
  for (const row of grid) {
    if (typeof row !== 'string' || row.length === 0) return null;
    if (cols === null) cols = row.length;
    if (row.length !== cols) return null;
    out.push(row);
  }

  return out;
};

const normalizePairs = (value: unknown): GridTuple[] | null => {
  if (!Array.isArray(value)) return [];

  const out: GridTuple[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    out.push([a, b]);
  }

  return out;
};

const normalizeCornerCounts = (value: unknown): Array<[number, number, number]> | null => {
  if (!Array.isArray(value)) return [];

  const out: Array<[number, number, number]> = [];
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

const parseNullableInt = (value: unknown): number | null => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const readInteger = (value: unknown): number | null =>
  Number.isInteger(value) ? value as number : null;

const normalizeLooseDailyId = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeCanonicalKey = (value: unknown): string => (typeof value === 'string' ? value : '');

export const normalizeDailyPayloadLevel = (
  raw: unknown,
  dailyId = '',
): DailyPayloadLevel | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const grid = normalizeGrid(source.grid);
  const stitches = normalizePairs(source.stitches);
  const cornerCounts = normalizeCornerCounts(source.cornerCounts);
  if (!grid || !stitches || !cornerCounts) return null;

  return {
    name: typeof source.name === 'string' ? source.name : `Daily ${dailyId}`,
    grid,
    stitches,
    cornerCounts,
  };
};

export const normalizeDailyPayloadHeader = (raw: unknown): DailyPayloadHeader | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const dailyId = normalizeLooseDailyId(source.dailyId);
  const dailySlot = readInteger(source.dailySlot) ?? -1;
  const canonicalKey = normalizeCanonicalKey(source.canonicalKey);
  if (!dailyId || dailySlot < 0 || !canonicalKey) return null;

  return {
    schemaVersion: readInteger(source.schemaVersion) ?? 0,
    poolVersion: typeof source.poolVersion === 'string' ? source.poolVersion : '',
    dailyId,
    dailySlot,
    canonicalKey,
    generatedAtUtcMs: readInteger(source.generatedAtUtcMs) ?? 0,
  };
};

export const normalizeDailyPayload = (raw: unknown): DailyPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const dailyId = isUtcDateId(source.dailyId) ? source.dailyId : null;
  if (!dailyId) return null;

  const hardInvalidateAtUtcMs = parseNullableInt(source.hardInvalidateAtUtcMs);
  if (hardInvalidateAtUtcMs === null || hardInvalidateAtUtcMs <= 0) return null;

  const level = normalizeDailyPayloadLevel(source.level, dailyId);
  if (!level) return null;

  const dailySlot = parseNullableInt(source.dailySlot);
  const generatedAtUtcMs = parseNullableInt(source.generatedAtUtcMs);

  return {
    schemaVersion: readInteger(source.schemaVersion) ?? 0,
    poolVersion: typeof source.poolVersion === 'string' ? source.poolVersion : '',
    dailyId,
    dailySlot,
    canonicalKey: typeof source.canonicalKey === 'string' ? source.canonicalKey : '',
    generatedAtUtcMs,
    hardInvalidateAtUtcMs,
    level,
  };
};

export const normalizeDailyHistoryEntry = (entry: unknown): DailyHistoryEntry | null => {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry as Record<string, unknown>;

  const dailyId = normalizeLooseDailyId(source.dailyId);
  const dailySlot = readInteger(source.dailySlot) ?? -1;
  const canonicalKey = normalizeCanonicalKey(source.canonicalKey);
  if (!dailyId || dailySlot < 0 || !canonicalKey) return null;

  return {
    dailyId,
    dailySlot,
    canonicalKey,
    poolVersion: typeof source.poolVersion === 'string' ? source.poolVersion : '',
    publishedAtUtcMs: readInteger(source.publishedAtUtcMs) ?? 0,
  };
};

export const normalizeDailyHistory = (
  raw: unknown,
  { schemaVersion = DAILY_HISTORY_SCHEMA_VERSION } = {},
): DailyHistory => {
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion, entries: [] };
  }
  const source = raw as Record<string, unknown>;

  const entries = Array.isArray(source.entries)
    ? source.entries
      .map((entry) => normalizeDailyHistoryEntry(entry))
      .filter((entry): entry is DailyHistoryEntry => Boolean(entry))
    : [];

  return {
    schemaVersion: readInteger(source.schemaVersion) ?? schemaVersion,
    entries,
  };
};
