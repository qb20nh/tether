import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordPathTransitionCompensation,
  consumePathTransitionCompensation,
  clearPathTransitionCompensationBuffer,
} from '../../src/renderer.js';

test('path flow compensation buffer accumulates transitions and consumes once', () => {
  clearPathTransitionCompensationBuffer();
  const snapshotA = {
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ],
  };
  const snapshotB = {
    path: [
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 0, c: 3 },
    ],
  };
  const snapshotC = {
    path: [
      { r: 0, c: 2 },
      { r: 0, c: 3 },
      { r: 1, c: 3 },
    ],
  };

  recordPathTransitionCompensation(snapshotA, snapshotB);
  recordPathTransitionCompensation(snapshotB, snapshotC);

  const consumed = consumePathTransitionCompensation(snapshotC.path, 128);
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.stale, false);
  assert.equal(consumed.transitionCount, 2);

  const secondConsume = consumePathTransitionCompensation(snapshotC.path, 128);
  assert.equal(secondConsume.consumed, false);
  assert.equal(secondConsume.transitionCount, 0);
});

test('path flow compensation buffer clears stale signature mismatches', () => {
  clearPathTransitionCompensationBuffer();
  const previousSnapshot = {
    path: [
      { r: 1, c: 1 },
      { r: 1, c: 2 },
      { r: 1, c: 3 },
    ],
  };
  const nextSnapshot = {
    path: [
      { r: 1, c: 2 },
      { r: 1, c: 3 },
      { r: 2, c: 3 },
    ],
  };
  const unrelatedPath = [
    { r: 3, c: 3 },
    { r: 3, c: 4 },
  ];

  recordPathTransitionCompensation(previousSnapshot, nextSnapshot);
  const stale = consumePathTransitionCompensation(unrelatedPath, 128);
  assert.equal(stale.consumed, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.transitionCount, 1);

  const afterStale = consumePathTransitionCompensation(nextSnapshot.path, 128);
  assert.equal(afterStale.consumed, false);
  assert.equal(afterStale.transitionCount, 0);
});

test('path flow compensation buffer can be cleared explicitly', () => {
  clearPathTransitionCompensationBuffer();
  const previousSnapshot = {
    path: [
      { r: 2, c: 0 },
      { r: 2, c: 1 },
    ],
  };
  const nextSnapshot = {
    path: [
      { r: 2, c: 1 },
      { r: 2, c: 2 },
    ],
  };

  recordPathTransitionCompensation(previousSnapshot, nextSnapshot);
  clearPathTransitionCompensationBuffer();

  const consumed = consumePathTransitionCompensation(nextSnapshot.path, 128);
  assert.equal(consumed.consumed, false);
  assert.equal(consumed.transitionCount, 0);
});
