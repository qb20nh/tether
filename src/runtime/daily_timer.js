import { parseUtcDateIdStartMs } from '../shared/utc_date.js';

export const utcStartMsFromDateId = parseUtcDateIdStartMs;

const parseUtcDateFromDateId = (dateId) => {
    const startMs = utcStartMsFromDateId(dateId);
    if (!Number.isInteger(startMs)) return null;
    return new Date(startMs);
};

const formatDateByLocale = (date, locale, options) => {
    try {
        return new Intl.DateTimeFormat(locale || undefined, {
            timeZone: 'UTC',
            ...options,
        }).format(date);
    } catch {
        return null;
    }
};

const formatDailyDatePartLabel = (dateId, locale, options) => {
    if (typeof dateId !== 'string' || dateId.length === 0) return '-';
    const date = parseUtcDateFromDateId(dateId);
    if (!date) return dateId;
    const formatted = formatDateByLocale(date, locale, options);
    return formatted || dateId;
};

export const formatDailyDateLabel = (dateId, locale) => {
    return formatDailyDatePartLabel(dateId, locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};

export const formatDailyMonthDayLabel = (dateId, locale) => {
    return formatDailyDatePartLabel(dateId, locale, {
        month: 'long',
        day: 'numeric',
    });
};

export const formatCountdownHms = (remainingMs, locale) => {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const formatNumber = (() => {
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
