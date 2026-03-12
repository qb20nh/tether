// @ts-nocheck
const RELATIVE_TIME_UNITS = Object.freeze([
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
]);
const DAILY_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

export const HISTORY_DOT_COLORS = Object.freeze({
  NONE: 'none',
  RED: 'red',
  BLUE: 'blue',
});

const asFiniteInt = (value, fallback = null) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

export const normalizeHistoryAction = (action) => {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'apply-update') {
    const buildNumber = asFiniteInt(action.buildNumber, null);
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return null;
    return {
      type: 'apply-update',
      buildNumber,
    };
  }
  if (action.type === 'open-daily') {
    const dailyId = typeof action.dailyId === 'string' ? action.dailyId.trim() : '';
    if (!DAILY_ID_RE.test(dailyId)) return null;
    return {
      type: 'open-daily',
      dailyId,
    };
  }
  return null;
};

export const hasUnreadSystemHistory = (entries = []) =>
  Array.isArray(entries)
  && entries.some((entry) => entry?.source === 'system' && entry.marker === 'unread');

export const historyEntryDotColor = (entry) => {
  if (!entry) return HISTORY_DOT_COLORS.NONE;
  if (entry.source === 'system') return HISTORY_DOT_COLORS.RED;
  if (entry.source === 'toast') return HISTORY_DOT_COLORS.BLUE;
  return HISTORY_DOT_COLORS.NONE;
};

export const getHistoryDeathFadeRank = (index, total, tailCount = 10) => {
  const i = asFiniteInt(index, -1);
  const t = asFiniteInt(total, 0);
  const tail = asFiniteInt(tailCount, 0);
  if (i < 0 || t <= tail || i >= t || tail <= 0) return -1;
  const fadeStart = t - tail;
  if (i < fadeStart) return -1;
  return i - fadeStart;
};

export const formatHistoryRelativeTime = (createdAtUtcMs, locale, nowMs = Date.now()) => {
  const created = asFiniteInt(createdAtUtcMs, null);
  const now = asFiniteInt(nowMs, Date.now());
  if (!Number.isInteger(created)) return '';
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

export const formatHistoryAbsoluteTime = (createdAtUtcMs, locale) => {
  const created = asFiniteInt(createdAtUtcMs, null);
  if (!Number.isInteger(created)) return '';
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
