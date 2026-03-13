import type {
  GridPoint,
} from '../contracts/ports.ts';

type CoordinatePairInput =
  | readonly [unknown, unknown]
  | { r?: unknown; c?: unknown }
  | null
  | undefined;

const isCoordinatePairObject = (
  entry: CoordinatePairInput,
): entry is { r?: unknown; c?: unknown } => (
  !Array.isArray(entry) && Boolean(entry) && typeof entry === 'object'
);

export const parseCoordinatePair = (entry: CoordinatePairInput): GridPoint | null => {
  const entryObject = isCoordinatePairObject(entry) ? entry : null;
  const r = Array.isArray(entry)
    ? entry[0]
    : entryObject?.r;
  const c = Array.isArray(entry)
    ? entry[1]
    : entryObject?.c;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
};
