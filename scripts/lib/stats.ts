type PointTuple = readonly [number, number];

export const mean = (values: readonly number[]): number => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  let total = 0;
  for (const element of values) total += element;
  return total / values.length;
};

export const median = (values: readonly number[]): number => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
};

export const percentile = (values: readonly number[], ratio: number): number => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, ratio));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * clamped) - 1));
  return sorted[index];
};

export const buildMetricSummary = (
  values: readonly number[],
  resolveMedian: (values: readonly number[]) => number,
): { mean: number; median: number; p95: number } => ({
  mean: mean(values),
  median: resolveMedian(values),
  p95: percentile(values, 0.95),
});

export const formatMetric = (value: number): string => (
  Number.isFinite(value) ? value.toFixed(3) : 'n/a'
);

export const pathsEqual = (
  expected: readonly PointTuple[],
  actual: readonly PointTuple[],
): boolean => {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    const expectedPoint = expected[i];
    const actualPoint = actual[i];
    if (expectedPoint?.[0] !== actualPoint?.[0] || expectedPoint?.[1] !== actualPoint?.[1]) {
      return false;
    }
  }
  return true;
};
