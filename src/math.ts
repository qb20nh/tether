import type {
  GridPoint,
} from './contracts/ports.ts';

type PointLike = Pick<GridPoint, 'r' | 'c'> | null | undefined;

export const pointsMatch = (a: PointLike, b: PointLike): boolean =>
  Boolean(a && b && a.r === b.r && a.c === b.c);

export const cellDistance = (a: PointLike, b: PointLike): number => {
  if (!a || !b) return 1;
  return Math.hypot(a.r - b.r, a.c - b.c);
};

export const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

export const normalizeAngle = (angle: number): number => {
  const TAU = Math.PI * 2;
  const normalized = angle % TAU;
  return normalized >= 0 ? normalized : normalized + TAU;
};

export const angleDeltaSigned = (from: number, to: number): number => {
  const TAU = Math.PI * 2;
  const delta = normalizeAngle(to - from);
  return delta > Math.PI ? delta - TAU : delta;
};

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
