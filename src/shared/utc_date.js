const UTC_DATE_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

export const utcDateIdFromMs = (ms) => {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseUtcDateIdStartMs = (dateId) => {
  if (typeof dateId !== 'string' || !UTC_DATE_ID_RE.test(dateId)) return null;
  const [year, month, day] = dateId.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
};
