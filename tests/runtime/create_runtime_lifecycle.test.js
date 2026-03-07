import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.js';
import { createRuntime } from '../../src/runtime/create_runtime.js';
import { GAME_COMMANDS, INTENT_TYPES } from '../../src/runtime/intents.js';

const LEVEL = {
  name: 'Runtime Lifecycle',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

const DAILY_LEVEL = {
  name: 'Daily Lifecycle',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

const createClassList = () => {
  const tokens = new Set();
  return {
    add: (...values) => values.forEach((value) => tokens.add(value)),
    remove: (...values) => values.forEach((value) => tokens.delete(value)),
    toggle: (value, force) => {
      const shouldHave = force === undefined ? !tokens.has(value) : Boolean(force);
      if (shouldHave) tokens.add(value);
      else tokens.delete(value);
      return shouldHave;
    },
    contains: (value) => tokens.has(value),
  };
};

const createElement = () => ({
  hidden: false,
  disabled: false,
  textContent: '',
  innerHTML: '',
  value: '',
  dataset: {},
  style: {},
  classList: createClassList(),
  setAttribute() {},
  removeAttribute() {},
  querySelector() {
    return createElement();
  },
  closest() {
    return createElement();
  },
});

const createRefs = () => {
  const infiniteItem = createElement();
  const dailyItem = createElement();
  const separator = createElement();
  const scoreMeta = createElement();
  scoreMeta.querySelector = () => separator;

  const infiniteScoreLabel = createElement();
  infiniteScoreLabel.closest = () => infiniteItem;
  const dailyScoreLabel = createElement();
  dailyScoreLabel.closest = () => dailyItem;

  const levelSelectGroup = createElement();
  levelSelectGroup.parentElement = createElement();

  return {
    boardWrap: createElement(),
    gridEl: createElement(),
    legend: createElement(),
    guidePanel: createElement(),
    guideToggleBtn: createElement(),
    legendPanel: createElement(),
    legendToggleBtn: createElement(),
    levelSel: createElement(),
    levelSelectGroup,
    infiniteSel: createElement(),
    prevInfiniteBtn: createElement(),
    nextLevelBtn: createElement(),
    scoreMeta,
    infiniteScoreLabel,
    dailyScoreLabel,
    infiniteScoreValue: createElement(),
    dailyScoreValue: createElement(),
    dailyMeta: createElement(),
    dailyDateValue: createElement(),
    dailyCountdownValue: createElement(),
    settingsPanel: createElement(),
    settingsToggle: createElement(),
    themeSwitchMessage: createElement(),
    themeSwitchDialog: createElement(),
    resetBtn: createElement(),
    reverseBtn: createElement(),
    langSel: createElement(),
    msgEl: createElement(),
  };
};

const installBrowserEnv = (t) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const listeners = new Map();
  const ensureListeners = (eventName) => {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    return listeners.get(eventName);
  };

  const rafCallbacks = new Map();
  let nextRafId = 1;
  const timeoutCallbacks = new Map();
  let nextTimeoutId = 1;
  const resizeObservers = [];

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observeCount = 0;
      this.disconnectCount = 0;
      resizeObservers.push(this);
    }

    observe() {
      this.observeCount += 1;
    }

    disconnect() {
      this.disconnectCount += 1;
    }
  }

  globalThis.window = {
    addEventListener(eventName, handler) {
      ensureListeners(eventName).add(handler);
    },
    removeEventListener(eventName, handler) {
      ensureListeners(eventName).delete(handler);
    },
  };
  globalThis.document = {
    documentElement: {
      lang: '',
      dataset: {},
      classList: createClassList(),
      setAttribute() {},
    },
    body: null,
  };
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, (...args) => {
      rafCallbacks.delete(id);
      return callback(...args);
    });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
  };
  globalThis.setTimeout = (callback) => {
    const id = nextTimeoutId;
    nextTimeoutId += 1;
    timeoutCallbacks.set(id, (...args) => {
      timeoutCallbacks.delete(id);
      return callback(...args);
    });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timeoutCallbacks.delete(id);
  };

  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  return {
    listeners,
    rafCallbacks,
    timeoutCallbacks,
    resizeObservers,
  };
};

const createRuntimeHarness = ({
  dailyLevel = null,
  effects = {},
  rendererOverrides = {},
  persistenceOverrides = {},
} = {}) => {
  const levelProvider = createLevelProvider({
    levels: [LEVEL],
    infiniteMaxLevels: 4,
    generateInfiniteLevel: () => LEVEL,
    dailyLevel,
    dailyId: dailyLevel ? '2026-03-08' : null,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((idx) => core.getLevel(idx));
  const basePersistence = createMemoryPersistence({}, {
    dailyAbsIndex: core.getDailyAbsIndex(),
    activeDailyId: core.getDailyId(),
  });
  const refs = createRefs();
  let renderCount = 0;
  let resizeCount = 0;
  let rebuildGridCount = 0;
  let unmountCount = 0;
  let bindCount = 0;
  let unbindCount = 0;
  let lastBindPayload = null;

  const persistence = {
    ...basePersistence,
    ...persistenceOverrides,
  };
  if (!persistence.writeSessionBoard) persistence.writeSessionBoard = basePersistence.writeSessionBoard;
  if (!persistence.clearSessionBoard) persistence.clearSessionBoard = basePersistence.clearSessionBoard;

  const renderer = {
    mount: () => {},
    getRefs: () => refs,
    rebuildGrid: (...args) => {
      rebuildGridCount += 1;
      rendererOverrides.rebuildGrid?.(...args);
    },
    renderFrame: () => {
      renderCount += 1;
    },
    resize: () => {
      resizeCount += 1;
      rendererOverrides.resize?.();
    },
    unmount: () => {
      unmountCount += 1;
    },
  };
  if (rendererOverrides.mount) renderer.mount = rendererOverrides.mount;
  if (rendererOverrides.getRefs) renderer.getRefs = rendererOverrides.getRefs;
  if (rendererOverrides.renderFrame) renderer.renderFrame = rendererOverrides.renderFrame;
  if (rendererOverrides.unmount) renderer.unmount = rendererOverrides.unmount;
  if (rendererOverrides.getLayoutMetrics) renderer.getLayoutMetrics = rendererOverrides.getLayoutMetrics;
  if (rendererOverrides.notifyResizeInteraction) renderer.notifyResizeInteraction = rendererOverrides.notifyResizeInteraction;
  if (rendererOverrides.clearPathTransitionCompensation) {
    renderer.clearPathTransitionCompensation = rendererOverrides.clearPathTransitionCompensation;
  }
  if (rendererOverrides.recordPathTransition) renderer.recordPathTransition = rendererOverrides.recordPathTransition;
  if (rendererOverrides.updateInteraction) renderer.updateInteraction = rendererOverrides.updateInteraction;
  if (rendererOverrides.setPathFlowFreezeImmediate) {
    renderer.setPathFlowFreezeImmediate = rendererOverrides.setPathFlowFreezeImmediate;
  }

  const runtime = createRuntime({
    appEl: {
      querySelectorAll: () => [],
    },
    core,
    state,
    persistence,
    renderer,
    input: {
      bind: (payload) => {
        bindCount += 1;
        lastBindPayload = payload;
      },
      unbind: () => {
        unbindCount += 1;
      },
    },
    i18n: {
      resolveLocale: () => 'en',
      createTranslator: () => (key, vars = {}) => {
        if (key === 'ui.infiniteLevelOption') return `Infinite ${vars.n ?? ''}`.trim();
        if (key === 'ui.dailyLevelOptionWithDate') return `${vars.label} ${vars.date}`.trim();
        return key;
      },
      getLocale: () => 'en',
      setLocale: () => 'en',
      getLocaleOptions: () => [{ value: 'en', label: 'English' }],
    },
    ui: {
      buildLegendTemplate: () => '',
      badgeDefinitions: {},
      icons: {},
      iconX: '',
    },
    effects,
  });

  return {
    runtime,
    core,
    state,
    persistence,
    renderer,
    refs,
    getRenderCount: () => renderCount,
    getResizeCount: () => resizeCount,
    getRebuildGridCount: () => rebuildGridCount,
    getUnmountCount: () => unmountCount,
    getBindCount: () => bindCount,
    getUnbindCount: () => unbindCount,
    getLastBindPayload: () => lastBindPayload,
  };
};

const emitSolvePath = (runtime, cells) => {
  for (let i = 0; i < cells.length; i += 1) {
    runtime.emitIntent({
      type: INTENT_TYPES.GAME_COMMAND,
      payload: {
        commandType: GAME_COMMANDS.START_OR_STEP,
        r: cells[i][0],
        c: cells[i][1],
      },
    });
  }
  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.FINALIZE_PATH },
  });
};

test('createRuntime destroy removes listeners, disconnects observers, and cancels pending work', (t) => {
  const env = installBrowserEnv(t);
  const writeSessionBoards = [];
  const harness = createRuntimeHarness({
    persistenceOverrides: {
      writeSessionBoard(board) {
        writeSessionBoards.push(board);
      },
    },
  });

  harness.runtime.start();

  assert.equal(harness.getBindCount(), 1);
  assert.equal(env.listeners.get('beforeunload')?.size || 0, 2);
  assert.equal(env.listeners.get('resize')?.size || 0, 1);
  assert.equal(env.resizeObservers.length, 1);
  assert.equal(env.rafCallbacks.size, 1);
  assert.equal(env.timeoutCallbacks.size, 1);

  const queuedRaf = [...env.rafCallbacks.values()][0];
  const queuedTimeout = [...env.timeoutCallbacks.values()][0];

  harness.runtime.destroy();

  assert.equal(harness.getUnbindCount(), 1);
  assert.equal(harness.getUnmountCount(), 1);
  assert.equal(env.listeners.get('beforeunload')?.size || 0, 0);
  assert.equal(env.listeners.get('resize')?.size || 0, 0);
  assert.equal(env.resizeObservers[0].disconnectCount, 1);
  assert.equal(env.rafCallbacks.size, 0);
  assert.equal(env.timeoutCallbacks.size, 0);

  queuedRaf?.(16);
  queuedTimeout?.();
  assert.equal(harness.getRenderCount(), 0);
  assert.equal(writeSessionBoards.length, 0);
});

test('createRuntime daily solve fires onDailySolvedDateChanged exactly once', (t) => {
  const env = installBrowserEnv(t);
  const calls = [];
  const harness = createRuntimeHarness({
    dailyLevel: DAILY_LEVEL,
    effects: {
      onDailySolvedDateChanged: (dailyId) => {
        calls.push(dailyId);
      },
    },
  });

  harness.state.dispatch({
    type: GAME_COMMANDS.LOAD_LEVEL,
    payload: { levelIndex: harness.core.getDailyAbsIndex() },
  });

  emitSolvePath(harness.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);

  const rafFlush = [...env.rafCallbacks.values()][0];
  rafFlush?.(16);

  assert.deepEqual(calls, ['2026-03-08']);
  harness.runtime.destroy();
});

test('createRuntime does not fire onDailySolvedDateChanged for campaign or infinite clears', (t) => {
  const env = installBrowserEnv(t);
  const calls = [];
  const harness = createRuntimeHarness({
    effects: {
      onDailySolvedDateChanged: (dailyId) => {
        calls.push(dailyId);
      },
    },
  });

  harness.state.dispatch({
    type: GAME_COMMANDS.LOAD_LEVEL,
    payload: { levelIndex: 0 },
  });
  emitSolvePath(harness.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  [...env.rafCallbacks.values()][0]?.(16);

  harness.state.dispatch({
    type: GAME_COMMANDS.LOAD_LEVEL,
    payload: { levelIndex: harness.core.ensureInfiniteAbsIndex(0) },
  });
  emitSolvePath(harness.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  [...env.rafCallbacks.values()][0]?.(32);

  assert.deepEqual(calls, []);
  harness.runtime.destroy();
});

test('createRuntime only resizes on layout-invalidating board updates', (t) => {
  const env = installBrowserEnv(t);
  const harness = createRuntimeHarness({
    rendererOverrides: {
      getLayoutMetrics: () => ({
        version: 1,
        rows: 2,
        cols: 2,
        left: 0,
        top: 0,
        right: 40,
        bottom: 40,
        size: 20,
        gap: 0,
        pad: 0,
        step: 20,
      }),
    },
  });

  const flushNextRaf = (ts) => {
    const callback = [...env.rafCallbacks.values()][0];
    callback?.(ts);
  };

  harness.runtime.start();
  assert.equal(typeof harness.getLastBindPayload()?.readLayoutMetrics, 'function');
  flushNextRaf(16);

  assert.equal(harness.getResizeCount(), 1);
  assert.equal(harness.getRebuildGridCount(), 1);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 0,
      c: 0,
    },
  });
  flushNextRaf(32);
  assert.equal(harness.getResizeCount(), 1);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.LOAD_LEVEL,
      levelIndex: harness.core.ensureInfiniteAbsIndex(0),
    },
  });
  flushNextRaf(48);
  assert.equal(harness.getResizeCount(), 2);
  assert.equal(harness.getRebuildGridCount(), 2);

  env.resizeObservers[0].callback();
  flushNextRaf(64);
  assert.equal(harness.getResizeCount(), 3);

  harness.runtime.destroy();
});
