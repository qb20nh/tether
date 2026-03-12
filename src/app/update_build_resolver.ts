// @ts-nocheck
export async function resolveLatestUpdateBuildNumber(options = {}) {
  const {
    hintBuildNumber = null,
    readLastNotifiedRemoteBuildNumber = () => null,
    notificationHistoryEntries = [],
    fetchRemoteBuildNumber = async () => null,
    resolveUpdatableRemoteBuildNumber = async () => null,
    localBuildNumber = 0,
  } = options;

  let latest = Number.isInteger(hintBuildNumber) ? hintBuildNumber : 0;

  const storedNotifiedBuild = readLastNotifiedRemoteBuildNumber();
  if (Number.isInteger(storedNotifiedBuild) && storedNotifiedBuild > latest) {
    latest = storedNotifiedBuild;
  }

  for (const entry of notificationHistoryEntries) {
    if (entry?.kind !== 'new-version-available') continue;
    const action = entry.action;
    if (action?.type !== 'apply-update') continue;
    if (Number.isInteger(action.buildNumber) && action.buildNumber > latest) {
      latest = action.buildNumber;
    }
  }

  const remoteBuildNumber = await fetchRemoteBuildNumber();
  if (Number.isInteger(remoteBuildNumber) && remoteBuildNumber > latest) {
    latest = remoteBuildNumber;
  }

  const updatableBuildNumber = await resolveUpdatableRemoteBuildNumber(latest);
  if (!Number.isInteger(updatableBuildNumber) || updatableBuildNumber <= localBuildNumber) return null;
  return updatableBuildNumber;
}
