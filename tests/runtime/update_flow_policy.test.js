import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPDATE_APPLY_STATUS,
  UPDATE_CHECK_DECISION,
  resolveUpdateCheckDecision,
  shouldReloadAfterManualPinConfirm,
  shouldResyncManualUpdatePolicy,
} from '../../src/runtime/update_flow_policy.ts';

test('resolveUpdateCheckDecision returns NOOP when build is not newer', () => {
  const decision = resolveUpdateCheckDecision({
    localBuildNumber: 100,
    updatableRemoteBuildNumber: 100,
    autoUpdateEnabled: false,
  });
  assert.equal(decision, UPDATE_CHECK_DECISION.NOOP);
});

test('resolveUpdateCheckDecision returns NOTIFY when auto-update is off and newer build exists', () => {
  const decision = resolveUpdateCheckDecision({
    localBuildNumber: 100,
    updatableRemoteBuildNumber: 101,
    autoUpdateEnabled: false,
  });
  assert.equal(decision, UPDATE_CHECK_DECISION.NOTIFY);
});

test('resolveUpdateCheckDecision returns APPLY when auto-update is on and newer build exists', () => {
  const decision = resolveUpdateCheckDecision({
    localBuildNumber: 100,
    updatableRemoteBuildNumber: 101,
    autoUpdateEnabled: true,
  });
  assert.equal(decision, UPDATE_CHECK_DECISION.APPLY);
});

test('shouldReloadAfterManualPinConfirm requires pin confirmation and no-waiting status', () => {
  assert.equal(shouldReloadAfterManualPinConfirm({
    confirmedInServiceWorker: true,
    applyStatus: UPDATE_APPLY_STATUS.NO_WAITING,
  }), true);

  assert.equal(shouldReloadAfterManualPinConfirm({
    confirmedInServiceWorker: false,
    applyStatus: UPDATE_APPLY_STATUS.NO_WAITING,
  }), false);

  assert.equal(shouldReloadAfterManualPinConfirm({
    confirmedInServiceWorker: true,
    applyStatus: UPDATE_APPLY_STATUS.APPLIED,
  }), false);
});

test('shouldResyncManualUpdatePolicy returns false when manual mode already matches local build', () => {
  assert.equal(shouldResyncManualUpdatePolicy({
    localAutoUpdateEnabled: false,
    localBuildNumber: 100,
    swPolicy: {
      autoUpdateEnabled: false,
      pinnedBuildNumber: 100,
      servingBuildNumber: 100,
      pinnedCacheUsable: true,
    },
  }), false);
});

test('shouldResyncManualUpdatePolicy returns false when cache usability is not provided', () => {
  assert.equal(shouldResyncManualUpdatePolicy({
    localAutoUpdateEnabled: false,
    localBuildNumber: 100,
    swPolicy: {
      autoUpdateEnabled: false,
      pinnedBuildNumber: 100,
      servingBuildNumber: 100,
    },
  }), false);
});

test('shouldResyncManualUpdatePolicy returns true when service worker policy drifts', () => {
  assert.equal(shouldResyncManualUpdatePolicy({
    localAutoUpdateEnabled: false,
    localBuildNumber: 100,
    swPolicy: null,
  }), true);

  assert.equal(shouldResyncManualUpdatePolicy({
    localAutoUpdateEnabled: false,
    localBuildNumber: 100,
    swPolicy: {
      autoUpdateEnabled: true,
      pinnedBuildNumber: 100,
      servingBuildNumber: 100,
      pinnedCacheUsable: true,
    },
  }), true);

  assert.equal(shouldResyncManualUpdatePolicy({
    localAutoUpdateEnabled: false,
    localBuildNumber: 100,
    swPolicy: {
      autoUpdateEnabled: false,
      pinnedBuildNumber: 99,
      servingBuildNumber: 99,
      pinnedCacheUsable: true,
    },
  }), true);

  assert.equal(shouldResyncManualUpdatePolicy({
    localAutoUpdateEnabled: false,
    localBuildNumber: 100,
    swPolicy: {
      autoUpdateEnabled: false,
      pinnedBuildNumber: 100,
      servingBuildNumber: 100,
      pinnedCacheUsable: false,
    },
  }), true);
});
