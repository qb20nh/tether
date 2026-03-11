import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.js';
import { createRuntime } from '../../src/runtime/create_runtime.js';
import { GAME_COMMANDS, INTENT_TYPES } from '../../src/runtime/intents.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';

const LEVEL = {
  name: 'Runtime Transition Compensation',
  grid: [
    '...',
    '...',
    '...',
  ],
  stitches: [],
  cornerCounts: [],
};

const createRuntimeHarness = (renderer) => {
  const levelProvider = createLevelProvider({
    levels: [LEVEL],
    infiniteMaxLevels: 4,
    generateInfiniteLevel: () => LEVEL,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((idx) => core.getLevel(idx));
  const persistence = createMemoryPersistence();
  state.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: 0 } });

  return createRuntime({
    appEl: {},
    core,
    state,
    persistence,
    renderer,
    input: {
      bind: () => { },
      unbind: () => { },
    },
    i18n: {
      resolveLocale: () => 'en',
      createTranslator: () => (key) => key,
      getLocale: () => 'en',
      setLocale: () => 'en',
      getLocaleOptions: () => [{ value: 'en', label: 'English' }],
    },
    ui: {},
  });
};

const installRafQueue = (t) => {
  const queue = [];
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    queue.push(callback);
    return queue.length;
  };
  t.after(() => {
    if (typeof previousRaf === 'function') {
      globalThis.requestAnimationFrame = previousRaf;
    } else {
      delete globalThis.requestAnimationFrame;
    }
  });
  return queue;
};

test('runtime records each path-step transition before RAF-batched render flush', (t) => {
  const rafQueue = installRafQueue(t);
  const recordCalls = [];
  const clearCalls = [];
  let renderCount = 0;

  const runtime = createRuntimeHarness({
    mount: () => { },
    getRefs: () => ({}),
    rebuildGrid: () => { },
    renderFrame: () => {
      renderCount += 1;
    },
    resize: () => { },
    unmount: () => { },
    recordPathTransition: (previousSnapshot, nextSnapshot) => {
      recordCalls.push({
        previousLength: previousSnapshot.path.length,
        nextLength: nextSnapshot.path.length,
      });
    },
    clearPathTransitionCompensation: () => {
      clearCalls.push('clear');
    },
  });

  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.START_OR_STEP, r: 0, c: 0 },
  });
  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.START_OR_STEP, r: 0, c: 1 },
  });
  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.START_OR_STEP, r: 1, c: 1 },
  });

  assert.deepEqual(recordCalls, [
    { previousLength: 0, nextLength: 1 },
    { previousLength: 1, nextLength: 2 },
    { previousLength: 2, nextLength: 3 },
  ]);
  assert.equal(clearCalls.length, 0);
  assert.equal(rafQueue.length, 1);

  const rafFlush = rafQueue.shift();
  rafFlush(16);
  assert.equal(renderCount, 1);

  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.RESET_PATH },
  });
  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.LOAD_LEVEL, levelIndex: 0 },
  });
  assert.equal(clearCalls.length, 2);
});

test('runtime records one transition per batched drag command before RAF-batched render flush', (t) => {
  const rafQueue = installRafQueue(t);
  const recordCalls = [];
  let renderCount = 0;

  const runtime = createRuntimeHarness({
    mount: () => { },
    getRefs: () => ({}),
    rebuildGrid: () => { },
    renderFrame: () => {
      renderCount += 1;
    },
    resize: () => { },
    unmount: () => { },
    recordPathTransition: (previousSnapshot, nextSnapshot) => {
      recordCalls.push({
        previousPath: previousSnapshot.path.map((point) => `${point.r},${point.c}`).join('|'),
        nextPath: nextSnapshot.path.map((point) => `${point.r},${point.c}`).join('|'),
      });
    },
  });

  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE,
      side: 'end',
      steps: [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
        { r: 1, c: 1 },
      ],
    },
  });

  assert.deepEqual(recordCalls, [
    {
      previousPath: '',
      nextPath: '0,0|0,1|1,1',
    },
  ]);
  assert.equal(rafQueue.length, 1);

  const rafFlush = rafQueue.shift();
  rafFlush(16);
  assert.equal(renderCount, 1);
});

test('runtime treats transition-compensation renderer methods as optional', (t) => {
  const rafQueue = installRafQueue(t);
  let renderCount = 0;

  const runtime = createRuntimeHarness({
    mount: () => { },
    getRefs: () => ({}),
    rebuildGrid: () => { },
    renderFrame: () => {
      renderCount += 1;
    },
    resize: () => { },
    unmount: () => { },
  });

  assert.doesNotThrow(() => {
    runtime.emitIntent({
      type: INTENT_TYPES.GAME_COMMAND,
      payload: { commandType: GAME_COMMANDS.START_OR_STEP, r: 0, c: 0 },
    });
    runtime.emitIntent({
      type: INTENT_TYPES.GAME_COMMAND,
      payload: { commandType: GAME_COMMANDS.RESET_PATH },
    });
  });

  assert.equal(rafQueue.length, 1);
  const rafFlush = rafQueue.shift();
  rafFlush(16);
  assert.equal(renderCount, 1);
});
