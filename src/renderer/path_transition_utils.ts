import { pointsMatch } from '../math.ts';
import type {
  GridPoint,
} from '../contracts/ports.ts';

type Path = readonly GridPoint[] | null | undefined;

export const getPathTipFromPath = (path: Path, side: string): GridPoint | null => {
  if (!Array.isArray(path) || path.length <= 0) return null;
  if (side === 'start') return path[0] || null;
  if (path.length <= 1) return path[0] || null;
  return path.at(-1) || null;
};

export const pathsMatch = (aPath: Path, bPath: Path): boolean => {
  if (!Array.isArray(aPath) || !Array.isArray(bPath)) return false;
  if (aPath.length !== bPath.length) return false;
  for (let i = 0; i < aPath.length; i += 1) {
    if (!pointsMatch(aPath[i], bPath[i])) return false;
  }
  return true;
};

export const isPathReversed = (nextPath: Path, previousPath: Path): boolean => {
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return false;
  if (nextPath.length !== previousPath.length || nextPath.length < 2) return false;

  for (let i = 0; i < nextPath.length; i += 1) {
    if (!pointsMatch(nextPath[i], previousPath[previousPath.length - 1 - i])) return false;
  }
  return true;
};

export const normalizeFlowOffset = (value: number, cycle = 128): number => {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(cycle) || cycle <= 0) return 0;
  const mod = value % cycle;
  return mod >= 0 ? mod : mod + cycle;
};

export const resolvePathSignature = (path: Path): string => {
  if (!Array.isArray(path) || path.length <= 0) return '0|_|_';
  const head = path[0] || null;
  const tail = path.at(-1) || null;
  const headSig = `${Number(head?.r)},${Number(head?.c)}`;
  const tailSig = `${Number(tail?.r)},${Number(tail?.c)}`;
  return `${path.length}|${headSig}|${tailSig}`;
};

const matchesPathWindow = (
  sourcePath: readonly GridPoint[],
  targetPath: readonly GridPoint[],
  sourceOffset = 0,
  targetOffset = 0,
  length = 0,
): boolean => {
  for (let i = 0; i < length; i += 1) {
    if (!pointsMatch(sourcePath[sourceOffset + i], targetPath[targetOffset + i])) return false;
  }
  return true;
};

const resolveRetractTransitionLengths = (
  prevPath: Path,
  nextPath: Path,
): { nextLen: number; diff: number } | null => {
  if (!Array.isArray(prevPath) || !Array.isArray(nextPath)) return null;
  const nextLen = nextPath.length;
  const diff = prevPath.length - nextLen;
  if (diff < 1 || nextLen < 1) return null;
  return { nextLen, diff };
};

const matchesRetractTransition = (prevPath: Path, nextPath: Path, prevOffset = 0): boolean => {
  const lengths = resolveRetractTransitionLengths(prevPath, nextPath);
  if (!lengths) return false;
  if (!Array.isArray(prevPath) || !Array.isArray(nextPath)) return false;
  return matchesPathWindow(nextPath, prevPath, 0, prevOffset, lengths.nextLen);
};

const matchesAdvanceTransition = (prevPath: Path, nextPath: Path, nextOffset = 0): boolean => {
  if (!Array.isArray(prevPath) || !Array.isArray(nextPath)) return false;
  const prevLen = prevPath.length;
  const nextLen = nextPath.length;
  if (nextLen !== prevLen + 1) return false;
  return matchesPathWindow(nextPath, prevPath, nextOffset, 0, prevLen);
};

export const isEndRetractTransition = (prevPath: Path, nextPath: Path): boolean => (
  matchesRetractTransition(prevPath, nextPath)
);

export const isStartRetractTransition = (prevPath: Path, nextPath: Path): boolean => {
  const lengths = resolveRetractTransitionLengths(prevPath, nextPath);
  if (!lengths) return false;
  return matchesRetractTransition(prevPath, nextPath, lengths.diff);
};

export const isEndAdvanceTransition = (prevPath: Path, nextPath: Path): boolean => (
  matchesAdvanceTransition(prevPath, nextPath)
);

export const isStartAdvanceTransition = (prevPath: Path, nextPath: Path): boolean =>
  matchesAdvanceTransition(prevPath, nextPath, 1);

export const isRetractUnturnTransition = (
  side: string,
  retractedTip: GridPoint | null | undefined,
  nextTip: GridPoint | null | undefined,
  nextPath: Path,
): boolean => {
  if (!retractedTip || !nextTip || !Array.isArray(nextPath)) return false;
  let neighbor: GridPoint | null = null;
  if (side === 'start') neighbor = nextPath[1] || null;
  else if (side === 'end') neighbor = nextPath.at(-2) || null;
  if (!neighbor) return false;

  const inR = neighbor.r - nextTip.r;
  const inC = neighbor.c - nextTip.c;
  const outR = retractedTip.r - nextTip.r;
  const outC = retractedTip.c - nextTip.c;
  if ((inR === 0 && inC === 0) || (outR === 0 && outC === 0)) return false;
  return ((inR * outC) - (inC * outR)) !== 0;
};
