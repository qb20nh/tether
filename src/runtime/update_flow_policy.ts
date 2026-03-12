// @ts-nocheck
export const UPDATE_CHECK_DECISION = Object.freeze({
  NOOP: 'noop',
  APPLY: 'apply',
  NOTIFY: 'notify',
});

export const UPDATE_APPLY_STATUS = Object.freeze({
  APPLIED: 'applied',
  UNAVAILABLE: 'unavailable',
  ALREADY_PROMPTED: 'already-prompted',
  UPDATE_FAILED: 'update-failed',
  NO_WAITING: 'no-waiting',
});

export const resolveUpdateCheckDecision = ({
  localBuildNumber,
  updatableRemoteBuildNumber,
  autoUpdateEnabled,
}) => {
  if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) {
    return UPDATE_CHECK_DECISION.NOOP;
  }
  if (!Number.isInteger(updatableRemoteBuildNumber) || updatableRemoteBuildNumber <= localBuildNumber) {
    return UPDATE_CHECK_DECISION.NOOP;
  }
  return autoUpdateEnabled
    ? UPDATE_CHECK_DECISION.APPLY
    : UPDATE_CHECK_DECISION.NOTIFY;
};

export const shouldReloadAfterManualPinConfirm = ({
  confirmedInServiceWorker,
  applyStatus,
}) => (
  confirmedInServiceWorker === true
  && applyStatus === UPDATE_APPLY_STATUS.NO_WAITING
);

export const shouldResyncManualUpdatePolicy = ({
  localAutoUpdateEnabled,
  localBuildNumber,
  swPolicy,
}) => {
  if (localAutoUpdateEnabled) return false;
  if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) return false;
  if (!swPolicy || typeof swPolicy !== 'object') return true;

  if (swPolicy.autoUpdateEnabled === true) return true;

  const pinnedBuildNumber = Number.parseInt(swPolicy.pinnedBuildNumber, 10);
  if (!Number.isInteger(pinnedBuildNumber) || pinnedBuildNumber !== localBuildNumber) {
    return true;
  }

  const servingBuildNumber = Number.parseInt(swPolicy.servingBuildNumber, 10);
  if (!Number.isInteger(servingBuildNumber) || servingBuildNumber !== localBuildNumber) {
    return true;
  }
  if (swPolicy.pinnedCacheUsable === false) {
    return true;
  }
  return false;
};
