import type {
  NotificationHistoryAction,
  NotificationHistoryEntry,
} from '../contracts/ports.ts';

const RELATIVE_TIME_UNITS = Object.freeze([
  { unit: 'year' as Intl.RelativeTimeFormatUnit, ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month' as Intl.RelativeTimeFormatUnit, ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week' as Intl.RelativeTimeFormatUnit, ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day' as Intl.RelativeTimeFormatUnit, ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour' as Intl.RelativeTimeFormatUnit, ms: 60 * 60 * 1000 },
  { unit: 'minute' as Intl.RelativeTimeFormatUnit, ms: 60 * 1000 },
  { unit: 'second' as Intl.RelativeTimeFormatUnit, ms: 1000 },
]);
const DAILY_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

export const HISTORY_DOT_COLORS = Object.freeze({
  NONE: 'none',
  RED: 'red',
  BLUE: 'blue',
} as const);

const asFiniteInt = (value: unknown, fallback: number | null = null): number | null => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

export const normalizeHistoryAction = (action: unknown): NotificationHistoryAction | null => {
  if (!action || typeof action !== 'object') return null;
  const source = action as Record<string, unknown>;
  if (source.type === 'apply-update') {
    const buildNumber = asFiniteInt(source.buildNumber, null);
    if (buildNumber === null || buildNumber <= 0) return null;
    return {
      type: 'apply-update',
      buildNumber,
    };
  }
  if (source.type === 'open-daily') {
    const dailyId = typeof source.dailyId === 'string' ? source.dailyId.trim() : '';
    if (!DAILY_ID_RE.test(dailyId)) return null;
    return {
      type: 'open-daily',
      dailyId,
    };
  }
  return null;
};

export const hasUnreadSystemHistory = (entries: readonly NotificationHistoryEntry[] = []): boolean =>
  Array.isArray(entries)
  && entries.some((entry) => entry?.source === 'system' && entry.marker === 'unread');

export const historyEntryDotColor = (entry: NotificationHistoryEntry | null | undefined): string => {
  if (!entry) return HISTORY_DOT_COLORS.NONE;
  if (entry.source === 'system') return HISTORY_DOT_COLORS.RED;
  if (entry.source === 'toast') return HISTORY_DOT_COLORS.BLUE;
  return HISTORY_DOT_COLORS.NONE;
};

export const getHistoryDeathFadeRank = (index: unknown, total: unknown, tailCount = 10): number => {
  const i = asFiniteInt(index, -1);
  const t = asFiniteInt(total, 0);
  const tail = asFiniteInt(tailCount, 0);
  if (i === null || t === null || tail === null) return -1;
  if (i < 0 || t <= tail || i >= t || tail <= 0) return -1;
  const fadeStart = t - tail;
  if (i < fadeStart) return -1;
  return i - fadeStart;
};

export const formatHistoryRelativeTime = (
  createdAtUtcMs: unknown,
  locale: string | null | undefined,
  nowMs = Date.now(),
): string => {
  const created = asFiniteInt(createdAtUtcMs, null);
  const now = asFiniteInt(nowMs, Date.now()) ?? Date.now();
  if (created === null) return '';
  const deltaMs = created - now;
  const absDelta = Math.abs(deltaMs);
  if (absDelta < 60 * 1000) {
    try {
      const formatter = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' });
      return formatter.format(0, 'second');
    } catch {
      return 'now';
    }
  }
  const unitEntry = RELATIVE_TIME_UNITS.find((candidate) => absDelta >= candidate.ms)
    || RELATIVE_TIME_UNITS.at(-1);
  if (!unitEntry) return '';
  const value = Math.round(deltaMs / unitEntry.ms);

  try {
    const formatter = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' });
    return formatter.format(value, unitEntry.unit);
  } catch {
    if (value === 0) return 'now';
    const abs = Math.abs(value);
    const suffix = value < 0 ? 'ago' : 'from now';
    const plural = abs === 1 ? unitEntry.unit : `${unitEntry.unit}s`;
    return `${abs} ${plural} ${suffix}`;
  }
};

export const formatHistoryAbsoluteTime = (
  createdAtUtcMs: unknown,
  locale: string | null | undefined,
): string => {
  const created = asFiniteInt(createdAtUtcMs, null);
  if (created === null) return '';
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale || undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }
};
