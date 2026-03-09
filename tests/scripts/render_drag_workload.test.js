import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderDragWorkload } from '../../scripts/lib/render_drag_workload.js';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { isUsableCell } from '../../src/state/snapshot_rules.js';

const buildBoardSnapshot = (infiniteIndex) => {
  const levelProvider = createLevelProvider();
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((levelIndex) => core.getLevel(levelIndex));
  state.loadLevel(core.ensureInfiniteAbsIndex(infiniteIndex));
  return state.getSnapshot();
};

test('render drag workload is deterministic for the same seed', () => {
  const first = createRenderDragWorkload({
    seed: 'stable-seed',
    boards: 3,
  });
  const second = createRenderDragWorkload({
    seed: 'stable-seed',
    boards: 3,
  });

  assert.deepEqual(second, first);
});

test('render drag workload changes when the seed changes', () => {
  const first = createRenderDragWorkload({
    seed: 'seed-a',
    boards: 3,
  });
  const second = createRenderDragWorkload({
    seed: 'seed-b',
    boards: 3,
  });

  assert.notDeepEqual(second, first);
});

test('render drag workload paths stay usable orthogonal and non-revisiting', () => {
  const workload = createRenderDragWorkload({
    seed: 'validate-paths',
    boards: 4,
  });

  for (let i = 0; i < workload.cases.length; i += 1) {
    const workloadCase = workload.cases[i];
    const snapshot = buildBoardSnapshot(workloadCase.infiniteIndex);
    const visited = new Set();

    assert.equal(workloadCase.pathCells.length >= 14, true);
    assert.equal(workloadCase.pathCells.length <= 22, true);

    for (let j = 0; j < workloadCase.pathCells.length; j += 1) {
      const [r, c] = workloadCase.pathCells[j];
      assert.equal(isUsableCell(snapshot, r, c), true);
      const key = `${r},${c}`;
      assert.equal(visited.has(key), false);
      visited.add(key);

      if (j === 0) continue;
      const [prevR, prevC] = workloadCase.pathCells[j - 1];
      const manhattanDistance = Math.abs(prevR - r) + Math.abs(prevC - c);
      assert.equal(manhattanDistance, 1);
    }
  }
});
