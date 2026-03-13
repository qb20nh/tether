import type { NotificationHistoryEntry } from '../contracts/ports.ts';

type UpdateBuildResolverHistoryEntry = Pick<NotificationHistoryEntry, 'kind' | 'action'>;

interface UpdateBuildResolverOptions {
  hintBuildNumber?: number | null;
  readLastNotifiedRemoteBuildNumber?: () => number | null;
  notificationHistoryEntries?: readonly UpdateBuildResolverHistoryEntry[];
  fetchRemoteBuildNumber?: () => Promise<number | null>;
  resolveUpdatableRemoteBuildNumber?: (buildNumber: number) => Promise<number | null>;
  localBuildNumber?: number;
}

const readBuildNumber = (value: unknown): number | null =>
  Number.isInteger(value) ? value as number : null;

export async function resolveLatestUpdateBuildNumber(
  options: UpdateBuildResolverOptions = {},
): Promise<number | null> {
  const {
    hintBuildNumber = null,
    readLastNotifiedRemoteBuildNumber = () => null,
    notificationHistoryEntries = [],
    fetchRemoteBuildNumber = async () => null,
    resolveUpdatableRemoteBuildNumber = async () => null,
    localBuildNumber = 0,
  } = options;

  let latest = readBuildNumber(hintBuildNumber) ?? 0;

  const storedNotifiedBuild = readBuildNumber(readLastNotifiedRemoteBuildNumber());
  if (storedNotifiedBuild !== null && storedNotifiedBuild > latest) {
    latest = storedNotifiedBuild;
  }

  for (const entry of notificationHistoryEntries) {
    if (entry?.kind !== 'new-version-available') continue;
    const action = entry.action;
    if (action?.type !== 'apply-update') continue;
    const actionBuildNumber = readBuildNumber(action.buildNumber);
    if (actionBuildNumber !== null && actionBuildNumber > latest) {
      latest = actionBuildNumber;
    }
  }

  const remoteBuildNumber = readBuildNumber(await fetchRemoteBuildNumber());
  if (remoteBuildNumber !== null && remoteBuildNumber > latest) {
    latest = remoteBuildNumber;
  }

  const updatableBuildNumber = await resolveUpdatableRemoteBuildNumber(latest);
  const resolvedUpdatableBuildNumber = readBuildNumber(updatableBuildNumber);
  if (resolvedUpdatableBuildNumber === null || resolvedUpdatableBuildNumber <= localBuildNumber) return null;
  return resolvedUpdatableBuildNumber;
}
