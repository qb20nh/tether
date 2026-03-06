import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLatestUpdateBuildNumber } from '../../src/app/update_build_resolver.js';

test('resolver keeps hint when stronger than other sources', async () => {
  let resolverInput = null;
  const result = await resolveLatestUpdateBuildNumber({
    hintBuildNumber: 120,
    readLastNotifiedRemoteBuildNumber: () => 110,
    notificationHistoryEntries: [
      { kind: 'new-version-available', action: { type: 'apply-update', buildNumber: 115 } },
    ],
    fetchRemoteBuildNumber: async () => 119,
    resolveUpdatableRemoteBuildNumber: async (buildNumber) => {
      resolverInput = buildNumber;
      return 122;
    },
    localBuildNumber: 100,
  });

  assert.equal(resolverInput, 120);
  assert.equal(result, 122);
});

test('resolver prefers stored notified build over hint', async () => {
  let resolverInput = null;
  const result = await resolveLatestUpdateBuildNumber({
    hintBuildNumber: 120,
    readLastNotifiedRemoteBuildNumber: () => 121,
    notificationHistoryEntries: [],
    fetchRemoteBuildNumber: async () => 119,
    resolveUpdatableRemoteBuildNumber: async (buildNumber) => {
      resolverInput = buildNumber;
      return 123;
    },
    localBuildNumber: 100,
  });

  assert.equal(resolverInput, 121);
  assert.equal(result, 123);
});

test('resolver prefers history apply-update action over stored build', async () => {
  let resolverInput = null;
  const result = await resolveLatestUpdateBuildNumber({
    hintBuildNumber: 120,
    readLastNotifiedRemoteBuildNumber: () => 121,
    notificationHistoryEntries: [
      { kind: 'toast', action: { type: 'apply-update', buildNumber: 999 } },
      { kind: 'new-version-available', action: { type: 'open-daily', dailyId: '2026-03-06' } },
      { kind: 'new-version-available', action: { type: 'apply-update', buildNumber: 124 } },
    ],
    fetchRemoteBuildNumber: async () => 123,
    resolveUpdatableRemoteBuildNumber: async (buildNumber) => {
      resolverInput = buildNumber;
      return 126;
    },
    localBuildNumber: 100,
  });

  assert.equal(resolverInput, 124);
  assert.equal(result, 126);
});

test('resolver prefers remote build over history build when larger', async () => {
  let resolverInput = null;
  const result = await resolveLatestUpdateBuildNumber({
    hintBuildNumber: 120,
    readLastNotifiedRemoteBuildNumber: () => 121,
    notificationHistoryEntries: [
      { kind: 'new-version-available', action: { type: 'apply-update', buildNumber: 124 } },
    ],
    fetchRemoteBuildNumber: async () => 130,
    resolveUpdatableRemoteBuildNumber: async (buildNumber) => {
      resolverInput = buildNumber;
      return 131;
    },
    localBuildNumber: 100,
  });

  assert.equal(resolverInput, 130);
  assert.equal(result, 131);
});

test('resolver returns null when updatable build is not newer than local', async () => {
  const result = await resolveLatestUpdateBuildNumber({
    hintBuildNumber: 120,
    readLastNotifiedRemoteBuildNumber: () => 121,
    notificationHistoryEntries: [
      { kind: 'new-version-available', action: { type: 'apply-update', buildNumber: 124 } },
    ],
    fetchRemoteBuildNumber: async () => 130,
    resolveUpdatableRemoteBuildNumber: async () => 100,
    localBuildNumber: 100,
  });

  assert.equal(result, null);
});
