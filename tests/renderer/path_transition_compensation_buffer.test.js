import test from 'node:test';
import assert from 'node:assert/strict';
import { createPathTransitionCompensationBuffer } from '../../src/renderer/path_transition_compensation_buffer.js';

const createBuffer = () => createPathTransitionCompensationBuffer({
  resolveShift: () => 4,
});

test('path flow compensation buffer accumulates transitions and consumes once', () => {
  const buffer = createBuffer();
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

  buffer.record(snapshotA, snapshotB);
  buffer.record(snapshotB, snapshotC);

  const consumed = buffer.consume(snapshotC.path, 0, 128);
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.stale, false);
  assert.equal(consumed.transitionCount, 2);
  assert.equal(consumed.nextOffset, 8);

  const secondConsume = buffer.consume(snapshotC.path, 0, 128);
  assert.equal(secondConsume.consumed, false);
  assert.equal(secondConsume.transitionCount, 0);
});

test('path flow compensation buffer clears stale signature mismatches', () => {
  const buffer = createBuffer();
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

  buffer.record(previousSnapshot, nextSnapshot);
  const stale = buffer.consume(unrelatedPath, 0, 128);
  assert.equal(stale.consumed, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.transitionCount, 1);

  const afterStale = buffer.consume(nextSnapshot.path, 0, 128);
  assert.equal(afterStale.consumed, false);
  assert.equal(afterStale.transitionCount, 0);
});

test('path flow compensation buffer can be cleared explicitly', () => {
  const buffer = createBuffer();
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

  buffer.record(previousSnapshot, nextSnapshot);
  buffer.clear();

  const consumed = buffer.consume(nextSnapshot.path, 0, 128);
  assert.equal(consumed.consumed, false);
  assert.equal(consumed.transitionCount, 0);
});
