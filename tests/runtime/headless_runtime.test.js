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
});
