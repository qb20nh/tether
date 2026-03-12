import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __TEST__,
  buildCanonicalSolutionSignature,
  createScoreManager,
  SCORE_MODES,
} from '../../src/runtime/score_manager.ts';
import { createGameStateStore } from '../../src/state/game_state_store.ts';

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

const LEVEL_CORNER = {
  name: 'Corner',
  grid: [
    '...',
    '...',
    '...',
  ],
  stitches: [],
  cornerCounts: [[1, 1, 2]],
};

const buildSnapshotForPath = (level, path) => {
  const store = createGameStateStore(() => level);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  for (const element of path) {
    const [r, c] = element;
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

test('corner event order differences produce distinct signatures', () => {
  const pathA = [
    [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2],
  ];
  const pathB = [
    [0, 2], [0, 1], [1, 1], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0], [0, 0],
  ];

  const a = buildSnapshotForPath(LEVEL_CORNER, pathA);
  const b = buildSnapshotForPath(LEVEL_CORNER, pathB);

  assert.notEqual(
    buildCanonicalSolutionSignature(a),
    buildCanonicalSolutionSignature(b),
  );
});

test('corner event direction differences produce distinct signatures', () => {
  const pathA = [
    [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2],
  ];
  const pathB = [
    [0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [1, 1],
  ];

  const a = buildSnapshotForPath(LEVEL_CORNER, pathA);
  const b = buildSnapshotForPath(LEVEL_CORNER, pathB);

  assert.notEqual(
    buildCanonicalSolutionSignature(a),
    buildCanonicalSolutionSignature(b),
  );
});

test('topology word helpers reduce and normalize generator labels deterministically', () => {
  assert.deepEqual(__TEST__.reduceTopologyTokens(['+1', '-1', '+2', '+2', '-2']), ['+2']);
  assert.equal(__TEST__.normalizeTokenLabelsByAppearance(['+7', '-3', '+7']), '+1,-2,+1');
});

test('interior wall islands ignore boundary walls and stay sorted by position', () => {
  const islands = __TEST__.collectInteriorWallIslands([
    ['#', '.', '.', '.', '.'],
    ['.', '.', '.', '#', '.'],
    ['.', '.', '.', '.', '.'],
    ['.', '#', '.', '.', '.'],
    ['.', '.', '.', '.', '#'],
  ]);

  assert.deepEqual(islands, [
    { x: 3.5, y: 1.5 },
    { x: 1.5, y: 3.5 },
  ]);
});

test('topology signature records winding around an interior wall island', () => {
  const snapshot = {
    gridData: [
      ['.', '.', '.'],
      ['.', '#', '.'],
      ['.', '.', '.'],
    ],
  };

  assert.equal(__TEST__.buildTopologySignatureForPath(snapshot, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 0, c: 2 },
    { r: 1, c: 2 },
    { r: 2, c: 2 },
    { r: 2, c: 1 },
    { r: 2, c: 0 },
    { r: 1, c: 0 },
  ]), '+1');

  assert.equal(__TEST__.buildTopologySignatureForPath(snapshot, [
    { r: 0, c: 0 },
    { r: 1, c: 0 },
    { r: 2, c: 0 },
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 1, c: 2 },
    { r: 0, c: 2 },
    { r: 0, c: 1 },
  ]), '-1');
});

test('unique solution bonus follows rounded sqrt(2n) progression', () => {
  const scoreManager = createScoreManager({}, null);
  const awarded = [];

  for (let i = 1; i <= 6; i += 1) {
    const result = scoreManager.registerSolved({
      mode: SCORE_MODES.INFINITE,
      levelKey: '0',
      signature: `sig-${i}`,
    });
    awarded.push(result.awarded);
  }

  assert.deepEqual(awarded, [1, 2, 2, 3, 3, 3]);
  assert.equal(scoreManager.readTotals().infiniteTotal, 14);
});
