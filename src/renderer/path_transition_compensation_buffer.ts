import {
  normalizeFlowOffset,
  pathsMatch,
  resolvePathSignature,
} from './path_transition_utils.ts';
import type {
  GameSnapshot,
  GridPoint,
} from '../contracts/ports.ts';

type SnapshotOrPath = GameSnapshot | readonly GridPoint[] | null | undefined;

const resolveSnapshotPath = (snapshotOrPath: SnapshotOrPath): readonly GridPoint[] | null => {
  if (Array.isArray(snapshotOrPath)) return snapshotOrPath;
  if (
    snapshotOrPath
    && typeof snapshotOrPath === 'object'
    && 'path' in snapshotOrPath
    && Array.isArray(snapshotOrPath.path)
  ) {
    return snapshotOrPath.path;
  }
  return null;
};

interface PathTransitionCompensationBuffer {
  hasPending: () => boolean;
  clear: () => void;
  record: (
    previousSnapshot: SnapshotOrPath,
    nextSnapshot: SnapshotOrPath,
    refs?: unknown,
  ) => number;
  consume: (
    path: readonly GridPoint[] | null | undefined,
    currentOffset?: number,
    flowCycle?: number,
  ) => {
    consumed: boolean;
    stale: boolean;
    appliedShift: number;
    transitionCount: number;
    nextOffset: number;
  };
}

export function createPathTransitionCompensationBuffer({
  resolveShift,
}: {
  resolveShift?: (
    nextPath: readonly GridPoint[],
    previousPath: readonly GridPoint[],
    refs?: unknown,
  ) => number;
}): PathTransitionCompensationBuffer {
  let pendingPathFlowOffsetShift = 0;
  let pendingPathFlowTransitionCount = 0;
  let pendingPathFlowTargetSignature = '';

  return {
    hasPending() {
      return pendingPathFlowTransitionCount > 0;
    },

    clear() {
      pendingPathFlowOffsetShift = 0;
      pendingPathFlowTransitionCount = 0;
      pendingPathFlowTargetSignature = '';
    },

    record(previousSnapshot, nextSnapshot, refs = null) {
      const previousPath = resolveSnapshotPath(previousSnapshot);
      const nextPath = resolveSnapshotPath(nextSnapshot);
      if (!Array.isArray(previousPath) || !Array.isArray(nextPath)) return 0;
      if (pathsMatch(previousPath, nextPath)) return 0;

      pendingPathFlowTransitionCount += 1;
      pendingPathFlowTargetSignature = resolvePathSignature(nextPath);

      const shift = typeof resolveShift === 'function'
        ? resolveShift(nextPath, previousPath, refs)
        : 0;
      if (!Number.isFinite(shift) || shift === 0) return 0;

      pendingPathFlowOffsetShift += shift;
      return shift;
    },

    consume(path, currentOffset = 0, flowCycle = 128) {
      if (pendingPathFlowTransitionCount <= 0) {
        return {
          consumed: false,
          stale: false,
          appliedShift: 0,
          transitionCount: 0,
          nextOffset: normalizeFlowOffset(currentOffset, flowCycle),
        };
      }

      const transitionCount = pendingPathFlowTransitionCount;
      const nextSignature = resolvePathSignature(path);
      if (pendingPathFlowTargetSignature !== nextSignature) {
        this.clear();
        return {
          consumed: false,
          stale: true,
          appliedShift: 0,
          transitionCount,
          nextOffset: normalizeFlowOffset(currentOffset, flowCycle),
        };
      }

      const appliedShift = Number.isFinite(pendingPathFlowOffsetShift)
        ? pendingPathFlowOffsetShift
        : 0;
      const nextOffset = appliedShift === 0
        ? normalizeFlowOffset(currentOffset, flowCycle)
        : normalizeFlowOffset(currentOffset + appliedShift, flowCycle);
      this.clear();
      return {
        consumed: true,
        stale: false,
        appliedShift,
        transitionCount,
        nextOffset,
      };
    },
  };
}
