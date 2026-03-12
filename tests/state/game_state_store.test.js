import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameStateStore } from '../../src/state/game_state_store.ts';

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

const STITCHED_LEVEL = {
  name: 'Stitched',
  grid: [
    '...',
    '...',
    '...',
  ],
  stitches: [[1, 1]],
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

test('game state store restores saved movable wall positions and path', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  const restored = store.restoreMutableState({
    movableWalls: [[0, 0]],
    path: [[2, 0], [2, 1]],
  });

  assert.equal(restored, true);
  assert.deepEqual(store.getSnapshot().path, [{ r: 2, c: 0 }, { r: 2, c: 1 }]);
  assert.equal(store.getSnapshot().gridData[0][0], 'm');
  assert.equal(store.getSnapshot().gridData[1][1], '.');
});

test('game state store restores legacy grid saves', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  const restored = store.restoreMutableState({
    grid: [
      'm..',
      '...',
      '...',
    ],
    path: [{ r: 2, c: 0 }, { r: 2, c: 1 }],
  });

  assert.equal(restored, true);
  assert.deepEqual(store.getSnapshot().path, [{ r: 2, c: 0 }, { r: 2, c: 1 }]);
  assert.equal(store.getSnapshot().gridData[0][0], 'm');
  assert.equal(store.getSnapshot().gridData[1][1], '.');
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

test('game state store preserves start-side stitched diagonal advance and retract', () => {
  const store = createGameStateStore(() => STITCHED_LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  store.dispatch({ type: 'path/start-or-step', payload: { r: 1, c: 1 } });
  store.dispatch({ type: 'path/start-or-step', payload: { r: 1, c: 2 } });

  let transition = store.dispatch({ type: 'path/start-or-step-from-start', payload: { r: 0, c: 0 } });
  assert.equal(transition.changed, true);
  assert.deepEqual(store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
  ]);

  transition = store.dispatch({ type: 'path/start-or-step-from-start', payload: { r: 1, c: 1 } });
  assert.equal(transition.changed, true);
  assert.deepEqual(store.getSnapshot().path, [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
  ]);
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

test('game state store reset restores the last cleared path when no new progress overwrote it', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  store.dispatch({
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

  const originalPath = store.getSnapshot().path;
  const cleared = store.dispatch({ type: 'path/reset', payload: {} });
  assert.equal(cleared.changed, true);
  assert.equal(cleared.meta?.resetMode, 'cleared');
  assert.deepEqual(cleared.snapshot.path, []);

  const restored = store.dispatch({ type: 'path/reset', payload: {} });
  assert.equal(restored.changed, true);
  assert.equal(restored.meta?.resetMode, 'restored');
  assert.deepEqual(restored.snapshot.path, originalPath);
});

test('game state store reset restore candidate is replaced once new path progress is made', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  store.dispatch({
    type: 'path/apply-drag-sequence',
    payload: {
      side: 'end',
      steps: [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
      ],
    },
  });

  const originalPath = store.getSnapshot().path;
  store.dispatch({ type: 'path/reset', payload: {} });
  store.dispatch({ type: 'path/start-or-step', payload: { r: 2, c: 1 } });
  store.dispatch({ type: 'path/start-or-step', payload: { r: 2, c: 2 } });

  const replacementPath = store.getSnapshot().path;
  assert.notDeepEqual(replacementPath, originalPath);

  const clearedReplacement = store.dispatch({ type: 'path/reset', payload: {} });
  assert.equal(clearedReplacement.meta?.resetMode, 'cleared');
  assert.deepEqual(clearedReplacement.snapshot.path, []);

  const restoredReplacement = store.dispatch({ type: 'path/reset', payload: {} });
  assert.equal(restoredReplacement.meta?.resetMode, 'restored');
  assert.deepEqual(restoredReplacement.snapshot.path, replacementPath);
  assert.notDeepEqual(restoredReplacement.snapshot.path, originalPath);
});

test('game state store zero-segment path does not overwrite reset restore state', () => {
  const store = createGameStateStore(() => LEVEL);
  store.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });
  store.dispatch({
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

  const originalPath = store.getSnapshot().path;
  store.dispatch({ type: 'path/reset', payload: {} });
  store.dispatch({ type: 'path/start-or-step', payload: { r: 2, c: 1 } });

  const clearedZeroSegmentPath = store.dispatch({ type: 'path/reset', payload: {} });
  assert.equal(clearedZeroSegmentPath.meta?.resetMode, 'cleared');
  assert.equal(clearedZeroSegmentPath.meta?.storedResetCandidate, false);
  assert.deepEqual(clearedZeroSegmentPath.snapshot.path, []);

  const restoredOriginal = store.dispatch({ type: 'path/reset', payload: {} });
  assert.equal(restoredOriginal.meta?.resetMode, 'restored');
  assert.deepEqual(restoredOriginal.snapshot.path, originalPath);
});
