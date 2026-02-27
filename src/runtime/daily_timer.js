export const utcStartMsFromDateId = (dateId) => {
    if (typeof dateId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return null;
    const [y, m, d] = dateId.split('-').map((part) => Number.parseInt(part, 10));
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
};

export const formatDailyDateLabel = (dateId) => {
    if (typeof dateId !== 'string' || dateId.length === 0) return '-';
    return dateId;
};

export const formatCountdownHms = (remainingMs) => {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad2 = (value) => String(value).padStart(2, '0');
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
};
