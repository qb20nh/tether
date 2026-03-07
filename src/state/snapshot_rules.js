import { CELL_TYPES } from '../config.js';
import { keyOf } from '../utils.js';

const inBounds = (snapshot, r, c) => {
  if (!snapshot) return false;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
  const rows = Number.isInteger(snapshot.rows) ? snapshot.rows : 0;
  const cols = Number.isInteger(snapshot.cols) ? snapshot.cols : 0;
  return r >= 0 && r < rows && c >= 0 && c < cols;
};

export const isUsableCell = (snapshot, r, c) => {
  if (!inBounds(snapshot, r, c)) return false;
  const ch = snapshot.gridData?.[r]?.[c];
  return ch !== CELL_TYPES.WALL && ch !== CELL_TYPES.MOVABLE_WALL;
};

export const canDropWall = (snapshot, from, to) => {
  if (!snapshot || !from || !to) return false;
  if (!inBounds(snapshot, from.r, from.c) || !inBounds(snapshot, to.r, to.c)) return false;
  if (from.r === to.r && from.c === to.c) return false;
  if (snapshot.gridData?.[from.r]?.[from.c] !== CELL_TYPES.MOVABLE_WALL) return false;
  if (snapshot.gridData?.[to.r]?.[to.c] !== CELL_TYPES.EMPTY) return false;
  if (snapshot.visited?.has?.(keyOf(to.r, to.c))) return false;
  return true;
};
