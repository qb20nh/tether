import { pointsMatch, cellDistance } from '../math.js';

const PATH_TIP_ARRIVAL_ADJACENT_MAX = Math.SQRT2 + 1e-3;

const hasShiftedPathPrefixMatch = (longerPath, shorterPath, shiftCount) => {
  if (!Array.isArray(longerPath) || !Array.isArray(shorterPath)) return false;
  if (!Number.isInteger(shiftCount) || shiftCount <= 0) return false;
  if (longerPath.length !== shorterPath.length + shiftCount) return false;

  for (let i = 0; i < shorterPath.length; i += 1) {
    if (!pointsMatch(longerPath[i + shiftCount], shorterPath[i])) return false;
  }
  return true;
};

const resolveTipArrivalSyntheticPrevPathFromHint = (
  side,
  nextPath,
  tipArrivalHint = null,
) => {
  if (side !== 'start' && side !== 'end') return null;
  if (!Array.isArray(nextPath)) return null;
  if (!tipArrivalHint || tipArrivalHint.side !== side) return null;

  const from = tipArrivalHint.from;
  const to = tipArrivalHint.to;
  if (
    !Number.isInteger(from?.r)
    || !Number.isInteger(from?.c)
    || !Number.isInteger(to?.r)
    || !Number.isInteger(to?.c)
  ) {
    return null;
  }

  const nextLen = nextPath.length;
  if (nextLen <= 1) return null;
  const nextTip = side === 'start'
    ? nextPath[0]
    : nextPath[nextLen - 1];
  if (!nextTip || nextTip.r !== to.r || nextTip.c !== to.c) return null;
  if (cellDistance(from, to) > PATH_TIP_ARRIVAL_ADJACENT_MAX) return null;

  if (side === 'end') {
    const previousTip = nextPath[nextLen - 2];
    if (previousTip && previousTip.r === from.r && previousTip.c === from.c) {
      return nextPath.slice(0, nextLen - 1);
    }
    if (nextPath.some((node) => node?.r === from.r && node?.c === from.c)) return null;
    return [...nextPath, { r: from.r, c: from.c }];
  }

  const nextNeighbor = nextPath[1];
  if (nextNeighbor && nextNeighbor.r === from.r && nextNeighbor.c === from.c) {
    return nextPath.slice(1);
  }
  if (nextPath.some((node) => node?.r === from.r && node?.c === from.c)) return null;
  return [{ r: from.r, c: from.c }, ...nextPath];
};

export const resolveTipArrivalSyntheticPrevPath = (
  side,
  prevPath,
  nextPath,
  tipArrivalHint = null,
) => {
  if (side !== 'start' && side !== 'end') return null;
  if (!Array.isArray(prevPath) || !Array.isArray(nextPath)) return null;

  const fromHint = resolveTipArrivalSyntheticPrevPathFromHint(side, nextPath, tipArrivalHint);
  if (fromHint) return fromHint;

  const prevLen = prevPath.length;
  const nextLen = nextPath.length;
  if (prevLen <= 0 || nextLen <= 0) return null;

  if (prevLen === nextLen) {
    if (nextLen <= 1) return null;
    if (side === 'end') {
      const prevTail = prevPath[nextLen - 1];
      const nextTail = nextPath[nextLen - 1];
      if (!prevTail || !nextTail || pointsMatch(prevTail, nextTail)) return null;
      return nextPath.slice(0, nextLen - 1);
    }

    const prevHead = prevPath[0];
    const nextHead = nextPath[0];
    if (!prevHead || !nextHead || pointsMatch(prevHead, nextHead)) return null;
    return nextPath.slice(1);
  }

  if (side === 'end') {
    const sharedLen = Math.min(prevLen, nextLen);
    for (let i = 0; i < sharedLen; i += 1) {
      if (!pointsMatch(prevPath[i], nextPath[i])) return null;
    }

    const delta = nextLen - prevLen;
    if (delta > 1) {
      return nextLen > 1 ? nextPath.slice(0, nextLen - 1) : null;
    }
    if (delta < -1) {
      const restored = prevPath[nextLen];
      return restored ? [...nextPath, restored] : null;
    }
    return null;
  }

  if (nextLen > prevLen) {
    const stepCount = nextLen - prevLen;
    if (stepCount <= 1) return null;
    if (!hasShiftedPathPrefixMatch(nextPath, prevPath, stepCount)) return null;
    return nextLen > 1 ? nextPath.slice(1) : null;
  }

  const stepCount = prevLen - nextLen;
  if (stepCount <= 1) return null;
  if (!hasShiftedPathPrefixMatch(prevPath, nextPath, stepCount)) return null;
  const restored = prevPath[stepCount - 1];
  return restored ? [restored, ...nextPath] : null;
};

export const resolveHeadShiftStepCount = (nextPath, previousPath) => {
  if (!Array.isArray(nextPath) || !Array.isArray(previousPath)) return 0;

  const nextLen = nextPath.length;
  const prevLen = previousPath.length;
  if (nextLen < 2 || prevLen < 2 || nextLen === prevLen) return 0;

  if (nextLen > prevLen) {
    const shiftCount = nextLen - prevLen;
    return hasShiftedPathPrefixMatch(nextPath, previousPath, shiftCount)
      ? shiftCount
      : 0;
  }

  const shiftCount = prevLen - nextLen;
  return hasShiftedPathPrefixMatch(previousPath, nextPath, shiftCount)
    ? -shiftCount
    : 0;
};

const resolveNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const resolveRequestFrame = () => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame;
  return (cb) => setTimeout(() => cb(resolveNow()), 16);
};

const resolveCancelFrame = () => {
  if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame;
  return (id) => clearTimeout(id);
};

const normalizeShouldAnimate = (value) => {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.shouldAnimate === 'boolean') {
    return value.shouldAnimate;
  }
  return null;
};

export function createPathAnimationEngine(options = {}) {
  const requestFrame = typeof options.requestFrame === 'function'
    ? options.requestFrame
    : resolveRequestFrame();
  const cancelFrame = typeof options.cancelFrame === 'function'
    ? options.cancelFrame
    : resolveCancelFrame();
  const nowFn = typeof options.nowFn === 'function'
    ? options.nowFn
    : resolveNow;

  const onResetForCacheElements = options.onResetForCacheElements;
  const onSetInteractionModel = options.onSetInteractionModel;
  const onDrawAll = options.onDrawAll;
  const onDrawAnimatedPath = options.onDrawAnimatedPath;
  const onUpdatePathLayoutMetrics = options.onUpdatePathLayoutMetrics;
  const onNotifyInteractiveResize = options.onNotifyInteractiveResize;
  const onSetPathFlowFreezeImmediate = options.onSetPathFlowFreezeImmediate;
  const onAnimationFrame = options.onAnimationFrame;

  let animationFrameId = 0;
  let latestFrameTimestamp = 0;
  let interactiveResizeActive = false;
  let pathFlowFrozen = false;

  const stopAnimationFrame = () => {
    if (!animationFrameId) return;
    cancelFrame(animationFrameId);
    animationFrameId = 0;
    latestFrameTimestamp = 0;
  };

  const runAnimationFrame = (timestamp) => {
    animationFrameId = 0;
    latestFrameTimestamp = Number.isFinite(timestamp) ? timestamp : 0;

    if (typeof onAnimationFrame !== 'function') return;
    const shouldContinue = onAnimationFrame({
      timestamp: latestFrameTimestamp,
      nowMs: nowFn(),
      interactiveResizeActive,
      pathFlowFrozen,
    }) === true;

    if (shouldContinue) {
      animationFrameId = requestFrame(runAnimationFrame);
    } else {
      latestFrameTimestamp = 0;
    }
  };

  const maybeScheduleAnimationFrame = (shouldAnimate) => {
    if (shouldAnimate === true) {
      if (!animationFrameId) {
        latestFrameTimestamp = 0;
        animationFrameId = requestFrame(runAnimationFrame);
      }
      return;
    }
    if (shouldAnimate === false) {
      stopAnimationFrame();
    }
  };

  return {
    resetForCacheElements(refs) {
      stopAnimationFrame();
      interactiveResizeActive = false;
      pathFlowFrozen = false;
      if (typeof onResetForCacheElements === 'function') {
        onResetForCacheElements(refs);
      }
    },

    setInteractionModel(interactionModel) {
      if (typeof onSetInteractionModel === 'function') {
        onSetInteractionModel(interactionModel);
      }
    },

    drawAll(snapshot, refs, statuses, completionModel, tutorialFlags, drawAllInternal) {
      let drawResult = undefined;
      if (typeof onDrawAll === 'function') {
        drawResult = onDrawAll(
          snapshot,
          refs,
          statuses,
          completionModel,
          tutorialFlags,
          drawAllInternal,
        );
      } else if (typeof drawAllInternal === 'function') {
        drawResult = drawAllInternal(
          snapshot,
          refs,
          statuses,
          completionModel,
          tutorialFlags,
        );
      }
      maybeScheduleAnimationFrame(normalizeShouldAnimate(drawResult));
      return drawResult;
    },

    drawAnimatedPath(snapshot, refs, statuses, flowOffset, completionModel, tutorialFlags, callbacks = {}) {
      if (typeof onDrawAnimatedPath === 'function') {
        return onDrawAnimatedPath(
          snapshot,
          refs,
          statuses,
          flowOffset,
          completionModel,
          tutorialFlags,
          callbacks,
        );
      }
      if (typeof callbacks.drawAnimatedPathInternal === 'function') {
        return callbacks.drawAnimatedPathInternal(
          snapshot,
          refs,
          statuses,
          flowOffset,
          completionModel,
          tutorialFlags,
        );
      }
      return undefined;
    },

    updatePathLayoutMetrics(offset, cell, gap, pad) {
      if (typeof onUpdatePathLayoutMetrics === 'function') {
        return onUpdatePathLayoutMetrics(offset, cell, gap, pad);
      }
      return undefined;
    },

    notifyInteractiveResize() {
      interactiveResizeActive = true;
      if (typeof onNotifyInteractiveResize === 'function') {
        onNotifyInteractiveResize();
      }
    },

    setPathFlowFreezeImmediate(isFrozen = false) {
      pathFlowFrozen = Boolean(isFrozen);
      if (typeof onSetPathFlowFreezeImmediate === 'function') {
        onSetPathFlowFreezeImmediate(pathFlowFrozen);
      }
    },
  };
}
