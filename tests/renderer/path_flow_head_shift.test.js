import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHeadShiftStepCount,
  resolveTipArrivalSyntheticPrevPath,
} from '../../src/renderer.js';

test('resolveHeadShiftStepCount detects single-step head growth', () => {
  const previousPath = [
    { r: 10, c: 10 },
    { r: 10, c: 11 },
    { r: 10, c: 12 },
  ];
  const nextPath = [
    { r: 10, c: 9 },
    { r: 10, c: 10 },
    { r: 10, c: 11 },
    { r: 10, c: 12 },
  ];

  assert.equal(resolveHeadShiftStepCount(nextPath, previousPath), 1);
});

test('resolveHeadShiftStepCount detects multi-step head growth', () => {
  const previousPath = [
    { r: 5, c: 5 },
    { r: 5, c: 6 },
    { r: 5, c: 7 },
  ];
  const nextPath = [
    { r: 5, c: 2 },
    { r: 5, c: 3 },
    { r: 5, c: 4 },
    { r: 5, c: 5 },
    { r: 5, c: 6 },
    { r: 5, c: 7 },
  ];

  assert.equal(resolveHeadShiftStepCount(nextPath, previousPath), 3);
});

test('resolveHeadShiftStepCount detects multi-step head shrink', () => {
  const previousPath = [
    { r: 5, c: 2 },
    { r: 5, c: 3 },
    { r: 5, c: 4 },
    { r: 5, c: 5 },
    { r: 5, c: 6 },
    { r: 5, c: 7 },
  ];
  const nextPath = [
    { r: 5, c: 4 },
    { r: 5, c: 5 },
    { r: 5, c: 6 },
    { r: 5, c: 7 },
  ];

  assert.equal(resolveHeadShiftStepCount(nextPath, previousPath), -2);
});

test('resolveHeadShiftStepCount does not treat tail growth as head shift', () => {
  const previousPath = [
    { r: 3, c: 3 },
    { r: 3, c: 4 },
    { r: 3, c: 5 },
  ];
  const nextPath = [
    { r: 3, c: 3 },
    { r: 3, c: 4 },
    { r: 3, c: 5 },
    { r: 3, c: 6 },
  ];

  assert.equal(resolveHeadShiftStepCount(nextPath, previousPath), 0);
});

test('resolveHeadShiftStepCount returns 0 when paths are not shifted prefixes', () => {
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ];
  const nextPath = [
    { r: 1, c: 9 },
    { r: 1, c: 1 },
    { r: 1, c: 3 },
    { r: 1, c: 4 },
  ];

  assert.equal(resolveHeadShiftStepCount(nextPath, previousPath), 0);
});

test('resolveTipArrivalSyntheticPrevPath returns prior one-step path for multi-step end growth', () => {
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
  ];
  const nextPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 1, c: 4 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath('end', previousPath, nextPath);
  assert.deepEqual(syntheticPrev, [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath returns prior one-step path for multi-step end retract', () => {
  const previousPath = [
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 2, c: 3 },
    { r: 2, c: 4 },
  ];
  const nextPath = [
    { r: 2, c: 1 },
    { r: 2, c: 2 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath('end', previousPath, nextPath);
  assert.deepEqual(syntheticPrev, [
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 2, c: 3 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath returns prior one-step path for multi-step start growth', () => {
  const previousPath = [
    { r: 4, c: 4 },
    { r: 4, c: 5 },
  ];
  const nextPath = [
    { r: 4, c: 2 },
    { r: 4, c: 3 },
    { r: 4, c: 4 },
    { r: 4, c: 5 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath('start', previousPath, nextPath);
  assert.deepEqual(syntheticPrev, [
    { r: 4, c: 3 },
    { r: 4, c: 4 },
    { r: 4, c: 5 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath returns prior one-step path for multi-step start retract', () => {
  const previousPath = [
    { r: 7, c: 1 },
    { r: 7, c: 2 },
    { r: 7, c: 3 },
    { r: 7, c: 4 },
  ];
  const nextPath = [
    { r: 7, c: 3 },
    { r: 7, c: 4 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath('start', previousPath, nextPath);
  assert.deepEqual(syntheticPrev, [
    { r: 7, c: 2 },
    { r: 7, c: 3 },
    { r: 7, c: 4 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath handles equal-length end retract-then-expand', () => {
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 1, c: 4 },
  ];
  const nextPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 2, c: 3 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath('end', previousPath, nextPath);
  assert.deepEqual(syntheticPrev, [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath handles equal-length start retract-then-expand', () => {
  const previousPath = [
    { r: 3, c: 1 },
    { r: 3, c: 2 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
  ];
  const nextPath = [
    { r: 2, c: 2 },
    { r: 3, c: 2 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath('start', previousPath, nextPath);
  assert.deepEqual(syntheticPrev, [
    { r: 3, c: 2 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath uses hint for mixed end transition with net -1', () => {
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 1, c: 4 },
    { r: 1, c: 5 },
  ];
  const nextPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 2, c: 3 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath(
    'end',
    previousPath,
    nextPath,
    {
      side: 'end',
      from: { r: 1, c: 3 },
      to: { r: 2, c: 3 },
    },
  );
  assert.deepEqual(syntheticPrev, [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath uses hint for mixed start transition with net +1', () => {
  const previousPath = [
    { r: 3, c: 2 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
    { r: 3, c: 5 },
  ];
  const nextPath = [
    { r: 1, c: 3 },
    { r: 2, c: 3 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
    { r: 3, c: 5 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath(
    'start',
    previousPath,
    nextPath,
    {
      side: 'start',
      from: { r: 2, c: 3 },
      to: { r: 1, c: 3 },
    },
  );
  assert.deepEqual(syntheticPrev, [
    { r: 2, c: 3 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
    { r: 3, c: 5 },
  ]);
});

test('resolveTipArrivalSyntheticPrevPath uses hint for retract final step', () => {
  const previousPath = [
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 2, c: 3 },
    { r: 2, c: 4 },
    { r: 1, c: 4 },
  ];
  const nextPath = [
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 2, c: 3 },
    { r: 2, c: 4 },
  ];

  const syntheticPrev = resolveTipArrivalSyntheticPrevPath(
    'end',
    previousPath,
    nextPath,
    {
      side: 'end',
      from: { r: 1, c: 4 },
      to: { r: 2, c: 4 },
    },
  );
  assert.deepEqual(syntheticPrev, [
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 2, c: 3 },
    { r: 2, c: 4 },
    { r: 1, c: 4 },
  ]);
});
