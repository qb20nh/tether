import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.js';
import { createHeadlessRuntime } from '../../src/runtime/create_runtime.js';

const LEVEL = {
  name: 'Headless',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

const INFINITE_SCORE_LEVEL = {
  name: 'Infinite Score',
  grid: [
    '...',
    '.s.',
    '...',
  ],
  stitches: [],
  cornerCounts: [],
};

const playPath = (runtime, cells) => {
  for (let i = 0; i < cells.length; i += 1) {
    const [r, c] = cells[i];
    runtime.dispatch('path/start-or-step', { r, c });
  }
  return runtime.dispatch('path/finalize-after-pointer', {});
};

test('headless runtime executes commands and updates progress', () => {
  const levelProvider = createLevelProvider({
    levels: [LEVEL],
    infiniteMaxLevels: 8,
    generateInfiniteLevel: () => LEVEL,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((i) => core.getLevel(i));
  const persistence = createMemoryPersistence();

  const runtime = createHeadlessRuntime({ core, state, persistence });
  runtime.start(0);

  runtime.dispatch('path/start-or-step', { r: 0, c: 0 });
  runtime.dispatch('path/start-or-step', { r: 0, c: 1 });
  runtime.dispatch('path/start-or-step', { r: 1, c: 1 });
  runtime.dispatch('path/start-or-step', { r: 1, c: 0 });
  const out = runtime.dispatch('path/finalize-after-pointer', {});

  assert.equal(out.completion.kind, 'good');
  assert.equal(runtime.getProgress().campaignProgress, 1);
});

test('headless runtime clears daily level without touching campaign or infinite progress', () => {
  const dailyLevel = {
    name: 'Daily',
    grid: [
      '..',
      '..',
    ],
    stitches: [],
    cornerCounts: [],
  };

  const levelProvider = createLevelProvider({
    levels: [LEVEL],
    infiniteMaxLevels: 8,
    generateInfiniteLevel: () => LEVEL,
    dailyLevel,
    dailyId: '2026-02-27',
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((i) => core.getLevel(i));
  const persistence = createMemoryPersistence({}, {
    dailyAbsIndex: core.getDailyAbsIndex(),
    activeDailyId: core.getDailyId(),
  });

  const runtime = createHeadlessRuntime({ core, state, persistence });
  const dailyIndex = core.getDailyAbsIndex();
  runtime.start(dailyIndex);

  runtime.dispatch('path/start-or-step', { r: 0, c: 0 });
  runtime.dispatch('path/start-or-step', { r: 0, c: 1 });
  runtime.dispatch('path/start-or-step', { r: 1, c: 1 });
  const out = runtime.dispatch('path/start-or-step', { r: 1, c: 0 });

  assert.equal(out.completion, null);
  const final = runtime.dispatch('path/finalize-after-pointer', {});
  assert.equal(final.completion.kind, 'good');
  assert.deepEqual(runtime.getProgress(), {
    campaignProgress: 0,
    infiniteProgress: 0,
    dailySolvedDate: '2026-02-27',
  });
  assert.deepEqual(persistence.readBootState().scoreState, {
    infiniteTotal: 0,
    dailyTotal: 1,
    infiniteByLevel: {},
    dailyByDate: {
      '2026-02-27': ['-|-|-||-'],
    },
  });
});

test('headless runtime scores unique infinite solutions and ignores equivalent duplicates', () => {
  const levelProvider = createLevelProvider({
    levels: [],
    infiniteMaxLevels: 4,
    generateInfiniteLevel: () => INFINITE_SCORE_LEVEL,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((i) => core.getLevel(i));
  const persistence = createMemoryPersistence();
  const runtime = createHeadlessRuntime({ core, state, persistence });

  runtime.start(0);

  const pathA = [
    [0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0], [2, 0], [2, 1], [2, 2],
  ];
  const pathB = [
    [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2],
  ];

  const first = playPath(runtime, pathA);
  assert.equal(first.completion.kind, 'good');
  assert.equal(persistence.readBootState().scoreState.infiniteTotal, 1);

  runtime.dispatch('path/reset', {});
  const duplicate = playPath(runtime, [...pathA].reverse());
  assert.equal(duplicate.completion.kind, 'good');
  assert.equal(persistence.readBootState().scoreState.infiniteTotal, 1);

  runtime.dispatch('path/reset', {});
  const secondUnique = playPath(runtime, pathB);
  assert.equal(secondUnique.completion.kind, 'good');

  const scoreState = persistence.readBootState().scoreState;
  assert.equal(scoreState.infiniteTotal, 3);
  assert.equal(scoreState.dailyTotal, 0);
  assert.equal(Array.isArray(scoreState.infiniteByLevel['0']), true);
  assert.equal(scoreState.infiniteByLevel['0'].length, 2);
});
