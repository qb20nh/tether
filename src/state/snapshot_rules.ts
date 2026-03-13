import { CELL_TYPES } from '../config.ts';
import type {
  GameSnapshot,
  GridPoint,
} from '../contracts/ports.ts';
import { keyOf } from '../utils.ts';

type SnapshotShape = Pick<GameSnapshot, 'rows' | 'cols' | 'gridData' | 'visited'> | null | undefined;
type PointLike = Pick<GridPoint, 'r' | 'c'> | null | undefined;

const inBounds = (snapshot: SnapshotShape, r: number, c: number): boolean => {
  if (!snapshot) return false;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
  const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
  const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
  return r >= 0 && r < rows && c >= 0 && c < cols;
};

export const isUsableCell = (snapshot: SnapshotShape, r: number, c: number): boolean => {
  if (!inBounds(snapshot, r, c)) return false;
  if (!snapshot) return false;
  const ch = snapshot.gridData?.[r]?.[c];
  return ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
};

export const canDropWall = (
  snapshot: SnapshotShape,
  from: PointLike,
  to: PointLike,
): boolean => {
  if (!snapshot || !from || !to) return false;
  if (!inBounds(snapshot, from.r, from.c) || !inBounds(snapshot, to.r, to.c)) return false;
  if (from.r === to.r && from.c === to.c) return false;
  if (snapshot.gridData?.[from.r]?.[from.c] !== CELL_TYPES.MOVABLE_WALL) return false;
  if (snapshot.gridData?.[to.r]?.[to.c] !== CELL_TYPES.EMPTY) return false;
  if (snapshot.visited?.has?.(keyOf(to.r, to.c))) return false;
  return true;
};
