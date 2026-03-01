import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { evaluateBlockedCells } from '../../src/rules.js';

const CHAMBER_LEVEL = {
  name: 'Blocked Chamber Regression',
  grid: [
    '#####',
    '#...#',
    '#...#',
    '##.##',
    '##.##',
  ],
  stitches: [[3, 3]],
  cornerCounts: [],
};

const buildStateWithPath = (steps) => {
  const state = createGameStateStore(() => CHAMBER_LEVEL);
  state.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  for (const [r, c] of steps) {
    const transition = state.dispatch({
      type: 'path/start-or-step',
      payload: { r, c },
    });
    assert.equal(transition.changed, true, `expected path step ${r},${c} to be accepted`);
  }

  return state.getSnapshot();
};

test('blocked cells include empty chamber surrounded by non-tip path', () => {
  const snapshot = buildStateWithPath([
    [1, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [2, 3],
    [1, 3],
  ]);

  const blocked = evaluateBlockedCells(snapshot);
  assert.equal(blocked.badKeys.includes('4,2'), true);
});

test('chamber is not blocked while its gate remains a path tip', () => {
  const snapshot = buildStateWithPath([
    [1, 1],
    [1, 2],
    [2, 2],
    [3, 2],
  ]);

  const blocked = evaluateBlockedCells(snapshot);
  assert.equal(blocked.badKeys.includes('4,2'), false);
});
