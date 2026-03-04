import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPDATE_APPLY_STATUS,
  UPDATE_CHECK_DECISION,
  resolveUpdateCheckDecision,
  shouldReloadAfterManualPinConfirm,
} from '../../src/runtime/update_flow_policy.js';

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

