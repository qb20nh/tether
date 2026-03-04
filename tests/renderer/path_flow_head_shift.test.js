import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHeadShiftStepCount } from '../../src/renderer.js';

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
