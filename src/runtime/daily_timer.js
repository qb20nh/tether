export const utcStartMsFromDateId = (dateId) => {
    if (typeof dateId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return null;
    const [y, m, d] = dateId.split('-').map((part) => Number.parseInt(part, 10));
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
};

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

export const formatDailyDateLabel = (dateId, locale) => {
    if (typeof dateId !== 'string' || dateId.length === 0) return '-';
    const date = parseUtcDateFromDateId(dateId);
    if (!date) return dateId;
    const formatted = formatDateByLocale(date, locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    return formatted || dateId;
};

export const formatDailyMonthDayLabel = (dateId, locale) => {
    if (typeof dateId !== 'string' || dateId.length === 0) return '-';
    const date = parseUtcDateFromDateId(dateId);
    if (!date) return dateId;
    const formatted = formatDateByLocale(date, locale, {
        month: 'long',
        day: 'numeric',
    });
    return formatted || dateId;
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
