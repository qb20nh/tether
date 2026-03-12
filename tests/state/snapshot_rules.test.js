import assert from 'node:assert/strict';
import test from 'node:test';
import { canDropWall, isUsableCell } from '../../src/state/snapshot_rules.ts';

const buildSnapshot = (overrides = {}) => ({
  rows: 3,
  cols: 3,
  gridData: [
    ['.', '.', '.'],
    ['.', 'm', '.'],
    ['#', '.', '.'],
  ],
  visited: new Set(),
  ...overrides,
});

test('isUsableCell excludes fixed and movable walls', () => {
  const snapshot = buildSnapshot();

  assert.equal(isUsableCell(snapshot, 0, 0), true);
  assert.equal(isUsableCell(snapshot, 1, 1), false);
  assert.equal(isUsableCell(snapshot, 2, 0), false);
});

test('canDropWall rejects invalid wall-drop targets and accepts valid empty cells', () => {
  const snapshot = buildSnapshot({
    visited: new Set(['0,2']),
  });

  assert.equal(canDropWall(snapshot, { r: 1, c: 1 }, { r: 1, c: 1 }), false);
  assert.equal(canDropWall(snapshot, { r: 1, c: 1 }, { r: -1, c: 1 }), false);
  assert.equal(canDropWall(snapshot, { r: 1, c: 1 }, { r: 2, c: 0 }), false);
  assert.equal(canDropWall(snapshot, { r: 1, c: 1 }, { r: 0, c: 2 }), false);
  assert.equal(canDropWall(snapshot, { r: 1, c: 1 }, { r: 0, c: 1 }), true);
});
