import { parseUtcDateIdStartMs } from '../shared/utc_date.ts';

export const utcStartMsFromDateId = parseUtcDateIdStartMs;

const readInteger = (value: unknown): number | null =>
  Number.isInteger(value) ? value as number : null;

const parseUtcDateFromDateId = (dateId: unknown): Date | null => {
  const startMs = readInteger(utcStartMsFromDateId(dateId));
  if (startMs === null) return null;
  return new Date(startMs);
};

const formatDateByLocale = (
  date: Date,
  locale: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string | null => {
    try {
        return new Intl.DateTimeFormat(locale || undefined, {
            timeZone: 'UTC',
            ...options,
        }).format(date);
    } catch {
        return null;
    }
};

const formatDailyDatePartLabel = (
  dateId: unknown,
  locale: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string => {
    if (typeof dateId !== 'string' || dateId.length === 0) return '-';
    const date = parseUtcDateFromDateId(dateId);
    if (!date) return dateId;
    const formatted = formatDateByLocale(date, locale, options);
    return formatted || dateId;
};

export const formatDailyDateLabel = (
  dateId: unknown,
  locale: string | null | undefined,
): string => {
    return formatDailyDatePartLabel(dateId, locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};

export const formatDailyMonthDayLabel = (
  dateId: unknown,
  locale: string | null | undefined,
): string => {
    return formatDailyDatePartLabel(dateId, locale, {
        month: 'long',
        day: 'numeric',
    });
};

export const formatCountdownHms = (
  remainingMs: number,
  locale: string | null | undefined,
): string => {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const formatNumber: (value: number) => string = (() => {
        try {
            const numberFormat = new Intl.NumberFormat(locale || undefined, {
                minimumIntegerDigits: 2,
                useGrouping: false,
            });
            return (value) => numberFormat.format(value);
        } catch {
            return (value) => String(value).padStart(2, '0');
        }
    })();
    return `${formatNumber(hours)}:${formatNumber(minutes)}:${formatNumber(seconds)}`;
};
