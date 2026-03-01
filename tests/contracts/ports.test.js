import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAdapters } from '../../src/runtime/default_adapters.js';

test('default adapters expose required contract methods', () => {
  const adapters = createDefaultAdapters({ windowObj: null });

  assert.equal(typeof adapters.core.getLevel, 'function');
  assert.equal(typeof adapters.core.evaluate, 'function');
  assert.equal(typeof adapters.core.checkCompletion, 'function');
  assert.equal(typeof adapters.core.getDailyAbsIndex, 'function');
  assert.equal(typeof adapters.core.isDailyAbsIndex, 'function');
  assert.equal(typeof adapters.core.hasDailyLevel, 'function');
  assert.equal(typeof adapters.core.getDailyId, 'function');

  assert.equal(typeof adapters.state.loadLevel, 'function');
  assert.equal(typeof adapters.state.dispatch, 'function');
  assert.equal(typeof adapters.state.getSnapshot, 'function');

  assert.equal(typeof adapters.persistence.readBootState, 'function');
  assert.equal(typeof adapters.persistence.writeTheme, 'function');
  assert.equal(typeof adapters.persistence.writeSessionBoard, 'function');
  assert.equal(typeof adapters.persistence.writeDailySolvedDate, 'function');
  assert.equal(typeof adapters.persistence.writeScoreState, 'function');

  assert.equal(typeof adapters.renderer.mount, 'function');
  assert.equal(typeof adapters.renderer.renderFrame, 'function');
  assert.equal(typeof adapters.renderer.resize, 'function');

  assert.equal(typeof adapters.input.bind, 'function');
  assert.equal(typeof adapters.input.unbind, 'function');
});
