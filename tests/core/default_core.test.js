import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';

const LEVEL = {
  name: 'Core Test',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

test('default core evaluates snapshot and completion', () => {
  const levelProvider = createLevelProvider({
    levels: [LEVEL],
    infiniteMaxLevels: 4,
    generateInfiniteLevel: () => LEVEL,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore(() => LEVEL);

  state.dispatch({ type: 'level/load', payload: { levelIndex: 0 } });

  const snapshot = state.getSnapshot();
  const result = core.evaluate(snapshot, {});
  const completion = core.checkCompletion(snapshot, result, (k) => k);

  assert.ok(result.hintStatus);
  assert.ok(result.stitchStatus);
  assert.ok(result.rpsStatus);
  assert.ok(result.blockedStatus);
  assert.equal(completion.kind, null);
  assert.equal(typeof core.goalText(0, (k) => k), 'string');
  assert.equal(typeof core.getDailyAbsIndex(), 'number');
  assert.equal(core.hasDailyLevel(), false);
});
