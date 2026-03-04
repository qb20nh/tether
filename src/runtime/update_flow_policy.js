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

