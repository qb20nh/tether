import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStateStore } from '../../src/state/game_state_store.js';

const LEVEL = {
  name: 'Test',
  grid: [
    '...',
    '.m.',
    '...',
  ],
  stitches: [],
  cornerCounts: [],
};

test('game state store supports command dispatch semantics', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  let transition = store.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 0 } });
  assert.equal(transition.changed, true);
  assert.equal(store.getSnapshot().path.length, 1);

  transition = store.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 1 } });
  assert.equal(transition.changed, true);
  assert.equal(store.getSnapshot().path.length, 2);

  transition = store.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 0 } });
  assert.equal(transition.changed, true);
  assert.equal(store.getSnapshot().path.length, 1);

  transition = store.dispatch({ type: 'path/finalize-after-pointer', payload: {} });
  assert.equal(transition.changed, true);
  assert.equal(store.getSnapshot().path.length, 0);

  transition = store.dispatch({ type: 'wall/move-attempt', payload: { from: { r: 1, c: 1 }, to: { r: 0, c: 0 } } });
  assert.equal(transition.changed, true);
  assert.equal(store.getSnapshot().gridData[0][0], 'm');
  assert.equal(store.getSnapshot().gridData[1][1], '.');
});
