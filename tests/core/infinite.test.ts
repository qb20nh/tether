import assert from 'node:assert/strict';
import test from '../test.ts';

import {
  INFINITE_FEATURE_CYCLE,
  generateInfiniteLevelFromVariant,
} from '../../src/infinite.ts';
import type { LevelDefinition } from '../../src/contracts/ports.ts';

const assertGeneratedLevelShape = (level: LevelDefinition & { infiniteMeta: Record<string, any> }, infiniteIndex: number) => {
  assert.equal(level.name, `Infinite ${infiniteIndex + 1}`);
  assert.ok(Array.isArray(level.grid));
  assert.ok(level.grid.length >= 5);
  assert.ok(level.grid.length <= 6);
  assert.ok(level.grid.every((row) => typeof row === 'string'));
  const gridRows = level.grid as string[];
  assert.ok(gridRows.every((row) => row.length === gridRows[0]!.length));
  assert.equal(level.infiniteMeta.index, infiniteIndex);
  assert.equal(level.infiniteMeta.requiredFeature, INFINITE_FEATURE_CYCLE[infiniteIndex % INFINITE_FEATURE_CYCLE.length]);
  assert.ok(Array.isArray(level.infiniteMeta.witnessPath));
  assert.ok(level.infiniteMeta.witnessPath.length > 0);
  assert.ok(Array.isArray(level.infiniteMeta.witnessMovableWalls));
};

test('generateInfiniteLevelFromVariant is deterministic across the feature cycle', () => {
  for (let infiniteIndex = 0; infiniteIndex < INFINITE_FEATURE_CYCLE.length; infiniteIndex++) {
    const first = generateInfiniteLevelFromVariant(infiniteIndex, 0);
    const second = generateInfiniteLevelFromVariant(infiniteIndex, 0);
    assert.deepEqual(first, second);
    assertGeneratedLevelShape(first, infiniteIndex);
  }
});

test('movable infinite variants include movable walls and witness data', () => {
  const level = generateInfiniteLevelFromVariant(1, 0);
  assert.ok(level.grid.some((row) => typeof row === 'string' && row.includes('m')));
  assert.ok(level.infiniteMeta.witnessMovableWalls.length > 0);
});
