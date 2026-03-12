import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHints, evaluateRPS, evaluateStitches } from '../../src/rules.ts';
import { createGameStateStore } from '../../src/state/game_state_store.ts';
import { keyOf } from '../../src/utils.ts';

const buildSnapshot = (level, steps) => {
  const state = createGameStateStore(() => level);
  state.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  for (const [r, c] of steps) {
    const transition = state.dispatch({
      type: 'path/start-or-step',
      payload: { r, c },
    });
    assert.equal(transition.changed, true, `expected step ${r},${c} to be accepted`);
  }

  return state.getSnapshot();
};

const compareCoordinateKeys = (left, right) => {
  const [leftRow, leftCol] = left.split(',').map(Number);
  const [rightRow, rightCol] = right.split(',').map(Number);
  return (leftRow - rightRow) || (leftCol - rightCol);
};

test('evaluateHints keeps matching endpoint direction pending during drag suppression', () => {
  const snapshot = buildSnapshot({
    name: 'Horizontal Endpoint Hint',
    grid: ['h.'],
    stitches: [],
    cornerCounts: [],
  }, [
    [0, 0],
    [0, 1],
  ]);

  const status = evaluateHints(snapshot, {
    suppressEndpointRequirement: true,
    suppressEndpointKey: keyOf(0, 0),
  });

  assert.equal(status.good, 0);
  assert.equal(status.bad, 0);
  assert.equal(status.pending, 1);
  assert.deepEqual(status.badKeys, []);
});

test('evaluateStitches leaves an unused stitch diagonal pending before completion', () => {
  const snapshot = buildSnapshot({
    name: 'Pending Stitch Diagonal',
    grid: [
      '..',
      '..',
    ],
    stitches: [[1, 1]],
    cornerCounts: [],
  }, [
    [0, 0],
    [1, 1],
  ]);

  const status = evaluateStitches(snapshot);

  assert.equal(status.good, 1);
  assert.equal(status.bad, 0);
  assert.deepEqual(status.vertexStatus.get('1,1'), {
    diagA: 'good',
    diagB: 'pending',
  });
});

test('evaluateStitches marks unresolved stitch diagonals bad on completion', () => {
  const snapshot = buildSnapshot({
    name: 'Complete Stitch Diagonal',
    grid: [
      '..',
      '..',
    ],
    stitches: [[1, 1]],
    cornerCounts: [],
  }, [
    [0, 1],
    [0, 0],
    [1, 1],
    [1, 0],
  ]);

  const status = evaluateStitches(snapshot);

  assert.equal(status.good, 1);
  assert.equal(status.bad, 1);
  assert.equal(status.summary, '1/2 (✗1)');
  assert.deepEqual(status.vertexStatus.get('1,1'), {
    diagA: 'good',
    diagB: 'bad',
  });
});

test('evaluateRPS distinguishes expected and unexpected win-order transitions', () => {
  const goodSnapshot = buildSnapshot({
    name: 'Good RPS',
    grid: ['gb'],
    stitches: [],
    cornerCounts: [],
  }, [
    [0, 0],
    [0, 1],
  ]);
  const badSnapshot = buildSnapshot({
    name: 'Bad RPS',
    grid: ['gp'],
    stitches: [],
    cornerCounts: [],
  }, [
    [0, 0],
    [0, 1],
  ]);

  const goodStatus = evaluateRPS(goodSnapshot);
  const badStatus = evaluateRPS(badSnapshot);

  assert.equal(goodStatus.good, 1);
  assert.equal(goodStatus.bad, 0);
  assert.deepEqual(goodStatus.goodKeys.toSorted(compareCoordinateKeys), ['0,0', '0,1']);
  assert.equal(badStatus.good, 0);
  assert.equal(badStatus.bad, 1);
  assert.deepEqual(badStatus.badKeys.toSorted(compareCoordinateKeys), ['0,0', '0,1']);
});
