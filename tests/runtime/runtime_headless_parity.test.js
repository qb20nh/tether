import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.js';
import { createHeadlessRuntime, createRuntime } from '../../src/runtime/create_runtime.js';
import { GAME_COMMANDS, INTENT_TYPES } from '../../src/runtime/intents.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';

const CAMPAIGN_LEVEL = {
  name: 'Campaign',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

const DAILY_LEVEL = {
  name: 'Daily',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

const DAILY_SESSION_LEVEL = {
  name: 'Daily Session',
  grid: [
    'm.',
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
  setAttribute() { },
  removeAttribute() { },
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
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  const listeners = new Map();
  const ensureListeners = (eventName) => {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    return listeners.get(eventName);
  };

  const rafCallbacks = new Map();
  let nextRafId = 1;
  const timeoutCallbacks = new Map();
  let nextTimeoutId = 1;
  const intervalCallbacks = new Map();
  let nextIntervalId = 1;

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {
      // noop
    }

    disconnect() {
      // noop
    }
  }

  globalThis.window = {
    addEventListener(eventName, handler) {
      ensureListeners(eventName).add(handler);
    },
    removeEventListener(eventName, handler) {
      ensureListeners(eventName).delete(handler);
    },
    setInterval(callback) {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervalCallbacks.delete(id);
    },
  };
  globalThis.document = {
    documentElement: {
      lang: '',
      dataset: {},
      classList: createClassList(),
      setAttribute() { },
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
  globalThis.setInterval = globalThis.window.setInterval;
  globalThis.clearInterval = globalThis.window.clearInterval;

  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  return {
    rafCallbacks,
    timeoutCallbacks,
    intervalCallbacks,
    listeners,
  };
};

const flushCallbacks = (callbackMap, arg) => {
  let guard = 0;
  while (callbackMap.size > 0 && guard < 20) {
    const callbacks = [...callbackMap.values()];
    callbacks.forEach((callback) => callback(arg));
    guard += 1;
  }
};

const createUiHarness = ({ levels, infiniteMaxLevels = 4, generateInfiniteLevel, dailyLevel = null, dailyId = null }, t) => {
  const env = installBrowserEnv(t);
  const levelProvider = createLevelProvider({
    levels,
    infiniteMaxLevels,
    generateInfiniteLevel,
    dailyLevel,
    dailyId,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((index) => core.getLevel(index));
  const persistence = createMemoryPersistence({}, {
    dailyAbsIndex: core.getDailyAbsIndex(),
    activeDailyId: core.getDailyId(),
  });
  const refs = createRefs();

  const runtime = createRuntime({
    appEl: {
      querySelectorAll: () => [],
    },
    core,
    state,
    persistence,
    renderer: {
      mount() { },
      getRefs() {
        return refs;
      },
      rebuildGrid() { },
      renderFrame() { },
      resize() { },
      notifyResizeInteraction() { },
      unmount() { },
      recordPathTransition() { },
      clearPathTransitionCompensation() { },
      updateInteraction() { },
      setPathFlowFreezeImmediate() { },
    },
    input: {
      bind() { },
      unbind() { },
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
  });

  return {
    env,
    runtime,
    core,
    state,
    persistence,
  };
};

const createHeadlessHarness = ({ levels, infiniteMaxLevels = 4, generateInfiniteLevel, dailyLevel = null, dailyId = null }) => {
  const levelProvider = createLevelProvider({
    levels,
    infiniteMaxLevels,
    generateInfiniteLevel,
    dailyLevel,
    dailyId,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((index) => core.getLevel(index));
  const persistence = createMemoryPersistence({}, {
    dailyAbsIndex: core.getDailyAbsIndex(),
    activeDailyId: core.getDailyId(),
  });
  const runtime = createHeadlessRuntime({ core, state, persistence });

  return {
    runtime,
    core,
    state,
    persistence,
  };
};

const emitUiPath = (runtime, cells) => {
  for (const element of cells) {
    runtime.emitIntent({
      type: INTENT_TYPES.GAME_COMMAND,
      payload: {
        commandType: GAME_COMMANDS.START_OR_STEP,
        r: element[0],
        c: element[1],
      },
    });
  }
  runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.FINALIZE_PATH },
  });
};

const dispatchHeadlessPath = (runtime, cells, finalize = true) => {
  for (const element of cells) {
    runtime.dispatch('path/start-or-step', { r: element[0], c: element[1] });
  }
  if (finalize) runtime.dispatch('path/finalize-after-pointer', {});
};

test('ui and headless runtimes keep daily solve score and solved date in parity', (t) => {
  const options = {
    levels: [CAMPAIGN_LEVEL],
    generateInfiniteLevel: () => CAMPAIGN_LEVEL,
    dailyLevel: DAILY_LEVEL,
    dailyId: '2026-03-08',
  };
  const ui = createUiHarness(options, t);
  const headless = createHeadlessHarness(options);
  const dailyIndex = ui.core.getDailyAbsIndex();

  ui.runtime.start();
  ui.state.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: dailyIndex } });
  emitUiPath(ui.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  flushCallbacks(ui.env.rafCallbacks, 16);
  flushCallbacks(ui.env.timeoutCallbacks);

  headless.runtime.start(dailyIndex);
  dispatchHeadlessPath(headless.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);

  const uiBoot = ui.persistence.readBootState();
  const headlessBoot = headless.persistence.readBootState();

  assert.equal(uiBoot.dailySolvedDate, '2026-03-08');
  assert.equal(headlessBoot.dailySolvedDate, '2026-03-08');
  assert.equal(uiBoot.campaignProgress, headlessBoot.campaignProgress);
  assert.equal(uiBoot.infiniteProgress, headlessBoot.infiniteProgress);
  assert.deepEqual(uiBoot.scoreState, headlessBoot.scoreState);
  ui.runtime.destroy();
});

test('ui and headless runtimes keep infinite solve score and progress in parity', (t) => {
  const options = {
    levels: [CAMPAIGN_LEVEL],
    generateInfiniteLevel: () => INFINITE_SCORE_LEVEL,
  };
  const ui = createUiHarness(options, t);
  const headless = createHeadlessHarness(options);
  const infiniteIndex = ui.core.ensureInfiniteAbsIndex(0);
  const path = [
    [0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0], [2, 0], [2, 1], [2, 2],
  ];

  ui.runtime.start();
  ui.state.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: infiniteIndex } });
  emitUiPath(ui.runtime, path);
  flushCallbacks(ui.env.rafCallbacks, 16);
  flushCallbacks(ui.env.timeoutCallbacks);

  headless.runtime.start(infiniteIndex);
  dispatchHeadlessPath(headless.runtime, path);

  const uiBoot = ui.persistence.readBootState();
  const headlessBoot = headless.persistence.readBootState();

  assert.equal(uiBoot.infiniteProgress, headlessBoot.infiniteProgress);
  assert.deepEqual(uiBoot.scoreState, headlessBoot.scoreState);
  ui.runtime.destroy();
});

test('ui and headless runtimes serialize session boards identically', (t) => {
  const options = {
    levels: [CAMPAIGN_LEVEL],
    generateInfiniteLevel: () => CAMPAIGN_LEVEL,
    dailyLevel: DAILY_SESSION_LEVEL,
    dailyId: '2026-03-08',
  };
  const ui = createUiHarness(options, t);
  const headless = createHeadlessHarness(options);
  const dailyIndex = ui.core.getDailyAbsIndex();

  ui.runtime.start();
  ui.state.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: dailyIndex } });
  ui.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 1,
      c: 0,
    },
  });
  ui.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 1,
      c: 1,
    },
  });
  flushCallbacks(ui.env.rafCallbacks, 16);
  flushCallbacks(ui.env.timeoutCallbacks);

  headless.runtime.start(dailyIndex);
  dispatchHeadlessPath(headless.runtime, [
    [1, 0],
    [1, 1],
  ], false);

  assert.deepEqual(ui.persistence.readBootState().sessionBoard, headless.persistence.readBootState().sessionBoard);
  assert.deepEqual(ui.persistence.readBootState().sessionBoard, {
    levelIndex: dailyIndex,
    path: [[1, 0], [1, 1]],
    movableWalls: [[0, 0]],
    dailyId: '2026-03-08',
  });
  ui.runtime.destroy();
});
