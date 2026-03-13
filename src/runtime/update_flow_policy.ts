export const UPDATE_CHECK_DECISION = Object.freeze({
  NOOP: 'noop',
  APPLY: 'apply',
  NOTIFY: 'notify',
} as const);

export const UPDATE_APPLY_STATUS = Object.freeze({
  APPLIED: 'applied',
  UNAVAILABLE: 'unavailable',
  ALREADY_PROMPTED: 'already-prompted',
  UPDATE_FAILED: 'update-failed',
  NO_WAITING: 'no-waiting',
} as const);

const readInteger = (value: unknown): number | null =>
  Number.isInteger(value) ? value as number : null;

interface UpdateCheckDecisionOptions {
  localBuildNumber: number;
  updatableRemoteBuildNumber: number | null;
  autoUpdateEnabled: boolean;
}

interface SwPolicyState {
  autoUpdateEnabled?: boolean;
  pinnedBuildNumber?: string | number | null;
  servingBuildNumber?: string | number | null;
  pinnedCacheUsable?: boolean;
}

export const resolveUpdateCheckDecision = ({
  localBuildNumber,
  updatableRemoteBuildNumber,
  autoUpdateEnabled,
}: UpdateCheckDecisionOptions): string => {
  if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) {
    return UPDATE_CHECK_DECISION.NOOP;
  }
  const nextBuildNumber = readInteger(updatableRemoteBuildNumber);
  if (nextBuildNumber === null || nextBuildNumber <= localBuildNumber) {
    return UPDATE_CHECK_DECISION.NOOP;
  }
  return autoUpdateEnabled
    ? UPDATE_CHECK_DECISION.APPLY
    : UPDATE_CHECK_DECISION.NOTIFY;
};

export const shouldReloadAfterManualPinConfirm = ({
  confirmedInServiceWorker,
  applyStatus,
}: {
  confirmedInServiceWorker: boolean;
  applyStatus: string;
}): boolean => (
  confirmedInServiceWorker === true
  && applyStatus === UPDATE_APPLY_STATUS.NO_WAITING
);

export const shouldResyncManualUpdatePolicy = ({
  localAutoUpdateEnabled,
  localBuildNumber,
  swPolicy,
}: {
  localAutoUpdateEnabled: boolean;
  localBuildNumber: number;
  swPolicy: SwPolicyState | null;
}): boolean => {
  if (localAutoUpdateEnabled) return false;
  if (!Number.isInteger(localBuildNumber) || localBuildNumber <= 0) return false;
  if (!swPolicy || typeof swPolicy !== 'object') return true;

  if (swPolicy.autoUpdateEnabled === true) return true;

  const pinnedBuildNumber = Number.parseInt(String(swPolicy.pinnedBuildNumber ?? ''), 10);
  if (!Number.isInteger(pinnedBuildNumber) || pinnedBuildNumber !== localBuildNumber) {
    return true;
  }

  const servingBuildNumber = Number.parseInt(String(swPolicy.servingBuildNumber ?? ''), 10);
  if (!Number.isInteger(servingBuildNumber) || servingBuildNumber !== localBuildNumber) {
    return true;
  }
  if (swPolicy.pinnedCacheUsable === false) {
    return true;
  }
  return false;
};
