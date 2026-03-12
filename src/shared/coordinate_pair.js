export const parseCoordinatePair = (entry) => {
  const r = Array.isArray(entry) ? entry[0] : entry?.r;
  const c = Array.isArray(entry) ? entry[1] : entry?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
};
