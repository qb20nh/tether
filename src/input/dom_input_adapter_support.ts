import type {
  BoardSelection,
  GameSnapshot,
  GridPoint,
  RuntimeData,
} from '../contracts/ports.ts';

interface PointLike {
  r?: unknown;
  c?: unknown;
}

export interface BoardNavPayload extends RuntimeData {
  isBoardNavActive: boolean;
  boardCursor?: GridPoint | null;
  boardSelection?: BoardSelection | null;
  isBoardNavPressing?: boolean;
  boardSelectionInteractive?: boolean | null;
  boardNavPreviewDelta?: GridPoint | null;
}

export const clampToRange = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

export const cloneCursor = (cursor: PointLike | null | undefined): GridPoint | null => (
  (() => {
    const source = cursor;
    if (!source || !Number.isInteger(source.r) || !Number.isInteger(source.c)) return null;
    return { r: source.r as number, c: source.c as number };
  })()
);

export const cloneBoardSelection = (
  selectionKind: string | null | undefined,
  cursor: PointLike | null | undefined,
): BoardSelection | null => {
  const clonedCursor = cloneCursor(cursor);
  return typeof selectionKind === 'string' && clonedCursor
    ? { kind: selectionKind, r: clonedCursor.r, c: clonedCursor.c }
    : null;
};

export const cloneDirectionDelta = (delta: PointLike | null | undefined): GridPoint | null =>
  cloneCursor(delta);

export const boardNavPayloadsMatch = (
  left: BoardNavPayload | null | undefined,
  right: BoardNavPayload | null | undefined,
): boolean => (
  Boolean(left?.isBoardNavActive) === Boolean(right?.isBoardNavActive)
  && (left?.boardCursor?.r ?? null) === (right?.boardCursor?.r ?? null)
  && (left?.boardCursor?.c ?? null) === (right?.boardCursor?.c ?? null)
  && (left?.boardSelection?.kind ?? null) === (right?.boardSelection?.kind ?? null)
  && (left?.boardSelection?.r ?? null) === (right?.boardSelection?.r ?? null)
  && (left?.boardSelection?.c ?? null) === (right?.boardSelection?.c ?? null)
  && Boolean(left?.isBoardNavPressing) === Boolean(right?.isBoardNavPressing)
  && (left?.boardSelectionInteractive ?? null) === (right?.boardSelectionInteractive ?? null)
  && (left?.boardNavPreviewDelta?.r ?? null) === (right?.boardNavPreviewDelta?.r ?? null)
  && (left?.boardNavPreviewDelta?.c ?? null) === (right?.boardNavPreviewDelta?.c ?? null)
);

export const isPointInBounds = (
  snapshot: Pick<GameSnapshot, 'rows' | 'cols'> | null | undefined,
  point: PointLike | null | undefined,
): point is GridPoint => {
  const sourceSnapshot = snapshot;
  const sourcePoint = point;
  if (!sourceSnapshot || !sourcePoint) return false;
  if (!Number.isInteger(sourcePoint.r) || !Number.isInteger(sourcePoint.c)) return false;
  return (sourcePoint.r as number) >= 0
    && (sourcePoint.c as number) >= 0
    && (sourcePoint.r as number) < sourceSnapshot.rows
    && (sourcePoint.c as number) < sourceSnapshot.cols;
};

export const resolveBoardOriginCursor = (
  snapshot: Pick<GameSnapshot, 'rows' | 'cols'> | null | undefined,
): GridPoint | null => (
  snapshot && snapshot.rows > 0 && snapshot.cols > 0
    ? { r: 0, c: 0 }
    : null
);

export const pointsMatch = (
  left: PointLike | null | undefined,
  right: PointLike | null | undefined,
): boolean => {
  const leftPoint = left;
  const rightPoint = right;
  if (!leftPoint || !rightPoint) return false;
  if (!Number.isInteger(leftPoint.r) || !Number.isInteger(leftPoint.c)) return false;
  if (!Number.isInteger(rightPoint.r) || !Number.isInteger(rightPoint.c)) return false;
  return leftPoint.r === rightPoint.r && leftPoint.c === rightPoint.c;
};

export const isPathEndpointSelectionKind = (
  selectionKind: string | null | undefined,
): selectionKind is 'path-start' | 'path-end' => (
  selectionKind === 'path-start' || selectionKind === 'path-end'
);

export const resolvePathSelectionSide = (
  selectionKind: 'path-start' | 'path-end' | null | undefined,
): 'start' | 'end' => (
  selectionKind === 'path-start' ? 'start' : 'end'
);

export const normalizeDirectionDelta = (
  directionOrDelta: string | PointLike | null | undefined,
  directionDeltas: Readonly<Record<string, GridPoint>>,
): GridPoint | null => {
  if (typeof directionOrDelta === 'string') {
    return cloneCursor(directionDeltas[directionOrDelta]);
  }
  const source = directionOrDelta;
  if (
    source
    && Number.isInteger(source.r)
    && Number.isInteger(source.c)
    && Math.abs(source.r as number) <= 1
    && Math.abs(source.c as number) <= 1
    && ((source.r as number) !== 0 || (source.c as number) !== 0)
  ) {
    return {
      r: source.r as number,
      c: source.c as number,
    };
  }
  return null;
};

export const isOrthogonalDelta = (delta: PointLike | null | undefined): boolean => (
  Math.abs((delta?.r as number | undefined) ?? 0) + Math.abs((delta?.c as number | undefined) ?? 0) === 1
);

export const parseDirectionKeyDelta = (directionKey: string | null | undefined): GridPoint | null => {
  if (typeof directionKey !== 'string') return null;
  const [rawR, rawC] = directionKey.split(',');
  const r = Number.parseInt(rawR, 10);
  const c = Number.parseInt(rawC, 10);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
};
