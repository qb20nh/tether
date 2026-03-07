import {
  normalizeFlowOffset,
  pathsMatch,
  resolvePathSignature,
} from './path_transition_utils.js';

const resolveSnapshotPath = (snapshotOrPath) => {
  if (Array.isArray(snapshotOrPath)) return snapshotOrPath;
  if (Array.isArray(snapshotOrPath?.path)) return snapshotOrPath.path;
  return null;
};

export function createPathTransitionCompensationBuffer({ resolveShift }) {
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
      if (!(pendingPathFlowTransitionCount > 0)) {
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
      const nextOffset = appliedShift !== 0
        ? normalizeFlowOffset(currentOffset + appliedShift, flowCycle)
        : normalizeFlowOffset(currentOffset, flowCycle);
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
