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

test('game state store caches snapshots and preserves prior path-derived data', () => {
  const store = createGameStateStore(() => LEVEL);
  const loadTransition = store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  const initialSnapshot = store.getSnapshot();
  const repeatedInitialSnapshot = store.getSnapshot();

  assert.equal(loadTransition.snapshot, initialSnapshot);
  assert.equal(initialSnapshot, repeatedInitialSnapshot);
  assert.equal(typeof initialSnapshot.version, 'number');
  assert.equal(initialSnapshot.pathKey, '');

  store.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 0 } });
  const firstPathSnapshot = store.getSnapshot();
  assert.notEqual(firstPathSnapshot, initialSnapshot);
  assert.equal(firstPathSnapshot.pathKey, '0,0;');
  assert.equal(firstPathSnapshot.version > initialSnapshot.version, true);
  assert.equal(store.getSnapshot(), firstPathSnapshot);

  store.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 1 } });
  const secondPathSnapshot = store.getSnapshot();
  assert.notEqual(secondPathSnapshot, firstPathSnapshot);
  assert.equal(secondPathSnapshot.pathKey, '0,0;0,1;');
  assert.equal(secondPathSnapshot.version > firstPathSnapshot.version, true);
  assert.deepEqual(firstPathSnapshot.path, [{ r: 0, c: 0 }]);
  assert.equal(firstPathSnapshot.idxByKey.get('0,0'), 0);
  assert.equal(firstPathSnapshot.idxByKey.has('0,1'), false);
  assert.deepEqual(secondPathSnapshot.path, [{ r: 0, c: 0 }, { r: 0, c: 1 }]);
});

test('game state store applies end drag batches in one state version', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  const initialSnapshot = store.getSnapshot();

  const transition = store.dispatch({
    type: 'path/apply-drag-sequence',
    payload: {
      side: 'end',
      steps: [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
        { r: 0, c: 2 },
      ],
    },
  });

  assert.equal(transition.changed, true);
  assert.deepEqual(transition.snapshot.path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 0, c: 2 },
  ]);
  assert.equal(transition.snapshot.version, initialSnapshot.version + 1);
  assert.equal(transition.snapshot.pathKey, '0,0;0,1;0,2;');
});

test('game state store applies start drag batches with legacy parity', () => {
  const store = createGameStateStore(() => LEVEL);
  const legacyStore = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  legacyStore.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  store.dispatch({
    type: 'path/apply-drag-sequence',
    payload: {
      side: 'end',
      steps: [
        { r: 2, c: 1 },
        { r: 2, c: 2 },
      ],
    },
  });
  legacyStore.dispatch({ type: 'path/start-or-step', payload: { r: 2, c: 1 } });
  legacyStore.dispatch({ type: 'path/start-or-step', payload: { r: 2, c: 2 } });

  const previousSnapshot = store.getSnapshot();
  const transition = store.dispatch({
    type: 'path/apply-drag-sequence',
    payload: {
      side: 'start',
      steps: [
        { r: 2, c: 0 },
        { r: 1, c: 0 },
      ],
    },
  });

  legacyStore.dispatch({ type: 'path/start-or-step-from-start', payload: { r: 2, c: 0 } });
  legacyStore.dispatch({ type: 'path/start-or-step-from-start', payload: { r: 1, c: 0 } });

  assert.equal(transition.changed, true);
  assert.deepEqual(store.getSnapshot().path, legacyStore.getSnapshot().path);
  assert.equal(store.getSnapshot().pathKey, legacyStore.getSnapshot().pathKey);
  assert.equal(store.getSnapshot().version, previousSnapshot.version + 1);
});

test('game state store batched retract matches repeated single-step dispatch', () => {
  const store = createGameStateStore(() => LEVEL);
  const legacyStore = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  legacyStore.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  const seedSteps = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 0, c: 2 },
    { r: 1, c: 2 },
  ];
  store.dispatch({ type: 'path/apply-drag-sequence', payload: { side: 'end', steps: seedSteps } });
  legacyStore.dispatch({ type: 'path/apply-drag-sequence', payload: { side: 'end', steps: seedSteps } });

  const previousSnapshot = store.getSnapshot();
  const transition = store.dispatch({
    type: 'path/apply-drag-sequence',
    payload: {
      side: 'end',
      steps: [
        { r: 0, c: 2 },
        { r: 0, c: 1 },
      ],
    },
  });

  legacyStore.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 2 } });
  legacyStore.dispatch({ type: 'path/start-or-step', payload: { r: 0, c: 1 } });

  assert.equal(transition.changed, true);
  assert.deepEqual(store.getSnapshot().path, legacyStore.getSnapshot().path);
  assert.equal(store.getSnapshot().version, previousSnapshot.version + 1);
});
