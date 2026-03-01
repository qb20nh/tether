import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { buildCanonicalSolutionSignature, __TEST__ } from '../../src/runtime/score_manager.js';

const LEVEL_STRAIGHT = {
  name: 'Straight',
  grid: [
    '...',
    '.s.',
    '...',
  ],
  stitches: [],
  cornerCounts: [],
};

const LEVEL_CYCLE = {
  name: 'Cycle',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

const buildSnapshotForPath = (level, path) => {
  const store = createGameStateStore(() => level);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  for (let i = 0; i < path.length; i += 1) {
    const [r, c] = path[i];
    store.dispatch({ type: 'path/start-or-step', payload: { r, c } });
  }
  return store.getSnapshot();
};

test('canonical solution signature rejects simple reversal as distinct', () => {
  const path = [
    [0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0], [2, 0], [2, 1], [2, 2],
  ];

  const forward = buildSnapshotForPath(LEVEL_STRAIGHT, path);
  const reversed = buildSnapshotForPath(LEVEL_STRAIGHT, [...path].reverse());

  assert.equal(
    buildCanonicalSolutionSignature(forward),
    buildCanonicalSolutionSignature(reversed),
  );
});

test('canonical solution signature rejects cycle phase shifts as distinct', () => {
  const pathA = [
    [0, 0], [0, 1], [1, 1], [1, 0],
  ];
  const pathB = [
    [0, 1], [1, 1], [1, 0], [0, 0],
  ];

  const a = buildSnapshotForPath(LEVEL_CYCLE, pathA);
  const b = buildSnapshotForPath(LEVEL_CYCLE, pathB);

  assert.equal(
    buildCanonicalSolutionSignature(a),
    buildCanonicalSolutionSignature(b),
  );
});

test('constraint behavior differences produce distinct signatures', () => {
  const horizontal = [
    [0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0], [2, 0], [2, 1], [2, 2],
  ];
  const vertical = [
    [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2],
  ];

  const a = buildSnapshotForPath(LEVEL_STRAIGHT, horizontal);
  const b = buildSnapshotForPath(LEVEL_STRAIGHT, vertical);

  assert.notEqual(
    buildCanonicalSolutionSignature(a),
    buildCanonicalSolutionSignature(b),
  );
});

test('topology word helpers reduce and normalize generator labels deterministically', () => {
  assert.deepEqual(__TEST__.reduceTopologyTokens(['+1', '-1', '+2', '+2', '-2']), ['+2']);
  assert.equal(__TEST__.normalizeTokenLabelsByAppearance(['+7', '-3', '+7']), '+1,-2,+1');
});
