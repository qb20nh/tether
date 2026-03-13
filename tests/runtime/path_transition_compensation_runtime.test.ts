import assert from 'node:assert/strict';
import test from '../test.ts';
import { createDefaultCore } from '../../src/core/default_core.ts';
import { createLevelProvider } from '../../src/core/level_provider.ts';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.ts';
import { createRuntime } from '../../src/runtime/create_runtime.ts';
import { GAME_COMMANDS, INTENT_TYPES } from '../../src/runtime/intents.ts';
import { createGameStateStore } from '../../src/state/game_state_store.ts';
import type { RendererPort } from '../../src/contracts/ports.ts';

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

const globalObject = (globalThis as any);

const createRuntimeHarness = (renderer: Partial<RendererPort>) => {
  const levelProvider = createLevelProvider({
    levels: [LEVEL],
    infiniteMaxLevels: 4,
    generateInfiniteLevel: () => LEVEL,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((idx) => core.getLevel(idx));
  const persistence = createMemoryPersistence();
  state.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: 0 } });

  const runtimeRenderer: RendererPort = {
    mount: () => { },
    getRefs: () => ({} as any),
    rebuildGrid: () => { },
    renderFrame: () => { },
    resize: () => { },
    unmount: () => { },
    ...renderer,
  };

  return createRuntime({
    appEl: ({} as any),
    core,
    state,
    persistence,
    renderer: runtimeRenderer,
    input: {
      bind: () => { },
      setKeyboardGamepadControlsEnabled: () => { },
      setBoardControlSuppressed: () => { },
      syncSnapshot: () => { },
      unbind: () => { },
    },
    i18n: ({
      resolveLocale: () => 'en',
      createTranslator: () => (key: string) => key,
      getLocale: () => 'en',
      setLocale: async () => 'en',
      getLocaleOptions: () => [{ value: 'en', label: 'English' }],
    } as any),
    ui: ({} as any),
  });
};

const installRafQueue = (t: { after: (cleanup: () => void) => void }) => {
  const queue: Array<(timestamp: number) => void> = [];
  const previousRaf = globalThis.requestAnimationFrame;
  globalObject.requestAnimationFrame = (callback: (timestamp: number) => void) => {
    queue.push(callback);
    return queue.length;
  };
  t.after(() => {
    if (typeof previousRaf === 'function') {
      globalObject.requestAnimationFrame = previousRaf;
    } else {
      Reflect.deleteProperty(globalObject, 'requestAnimationFrame');
    }
  });
  return queue;
};

test('runtime records each path-step transition before RAF-batched render flush', (t) => {
  const rafQueue = installRafQueue(t);
  const recordCalls: Array<{ previousLength: number; nextLength: number }> = [];
  const clearCalls: string[] = [];
  let renderCount = 0;

  const runtime = createRuntimeHarness({
    mount: () => { },
    getRefs: () => ({} as any),
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
  assert.ok(rafFlush);
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
  const recordCalls: Array<{ previousPath: string; nextPath: string }> = [];
  let renderCount = 0;

  const runtime = createRuntimeHarness({
    mount: () => { },
    getRefs: () => ({} as any),
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
  assert.ok(rafFlush);
  rafFlush(16);
  assert.equal(renderCount, 1);
});

test('runtime treats transition-compensation renderer methods as optional', (t) => {
  const rafQueue = installRafQueue(t);
  let renderCount = 0;

  const runtime = createRuntimeHarness({
    mount: () => { },
    getRefs: () => ({} as any),
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
  assert.ok(rafFlush);
  rafFlush(16);
  assert.equal(renderCount, 1);
});
