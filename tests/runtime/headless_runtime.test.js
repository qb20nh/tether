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
