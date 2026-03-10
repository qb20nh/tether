import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelProvider } from '../../src/core/level_provider.js';
import { createDefaultCore } from '../../src/core/default_core.js';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.js';
import { createRuntime } from '../../src/runtime/create_runtime.js';
import { GAME_COMMANDS, INTENT_TYPES, INTERACTION_UPDATES, UI_ACTIONS } from '../../src/runtime/intents.js';

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

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  checked: false,
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
    lowPowerToggle: createElement(),
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
  levels = [LEVEL],
  dailyLevel = null,
  effects = {},
  i18nOverrides = {},
  rendererOverrides = {},
  persistenceInitialState = {},
  persistenceOverrides = {},
} = {}) => {
  const levelProvider = createLevelProvider({
    levels,
    infiniteMaxLevels: 4,
    generateInfiniteLevel: () => levels[0],
    dailyLevel,
    dailyId: dailyLevel ? '2026-03-08' : null,
  });
  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((idx) => core.getLevel(idx));
  const basePersistence = createMemoryPersistence(persistenceInitialState, {
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
  const lowPowerSetCalls = [];

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
    setLowPowerMode: (enabled) => {
      lowPowerSetCalls.push(Boolean(enabled));
      rendererOverrides.setLowPowerMode?.(enabled);
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

  const i18n = {
    resolveLocale: () => 'en',
    createTranslator: () => (key, vars = {}) => {
      if (key === 'ui.infiniteLevelOption') return `Infinite ${vars.n ?? ''}`.trim();
      if (key === 'ui.dailyLevelOptionWithDate') return `${vars.label} ${vars.date}`.trim();
      return key;
    },
    getLocale: () => 'en',
    setLocale: () => 'en',
    getLocaleOptions: () => [{ value: 'en', label: 'English' }],
    ...i18nOverrides,
  };

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
    i18n,
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
    getLowPowerSetCalls: () => [...lowPowerSetCalls],
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

test('createRuntime destroy forwards renderer teardown options', (t) => {
  const env = installBrowserEnv(t);
  const unmountOptions = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      unmount: (options) => {
        unmountOptions.push(options);
      },
    },
  });

  harness.runtime.start();
  harness.runtime.destroy({ releaseWebglContext: false });

  assert.deepEqual(unmountOptions, [{ releaseWebglContext: false }]);
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

test('createRuntime reset restores the last untouched board state on the next click', (t) => {
  const env = installBrowserEnv(t);
  const renderCalls = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      renderFrame: (payload) => {
        renderCalls.push({
          pathLength: payload.snapshot.path.length,
          messageHtml: payload.uiModel.messageHtml,
          isBoardSolved: payload.uiModel.isBoardSolved,
        });
      },
    },
  });

  const flushNextRaf = (ts) => {
    const callback = [...env.rafCallbacks.values()][0];
    callback?.(ts);
  };

  harness.runtime.start();
  flushNextRaf(16);

  emitSolvePath(harness.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  flushNextRaf(32);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.RESET_CLICK,
    },
  });
  flushNextRaf(48);

  assert.deepEqual(renderCalls.at(-1), {
    pathLength: 0,
    messageHtml: harness.core.goalText(0, (key) => key),
    isBoardSolved: false,
  });

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.RESET_CLICK,
    },
  });
  flushNextRaf(64);

  assert.deepEqual(renderCalls.at(-1), {
    pathLength: 4,
    messageHtml: 'completion.completed',
    isBoardSolved: true,
  });
  harness.runtime.destroy();
});

test('createRuntime keeps reset restore state through zero-segment path attempts', (t) => {
  const env = installBrowserEnv(t);
  const renderCalls = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      renderFrame: (payload) => {
        renderCalls.push({
          pathLength: payload.snapshot.path.length,
          messageHtml: payload.uiModel.messageHtml,
          isBoardSolved: payload.uiModel.isBoardSolved,
        });
      },
    },
  });

  const flushNextRaf = (ts) => {
    const callback = [...env.rafCallbacks.values()][0];
    callback?.(ts);
  };

  harness.runtime.start();
  flushNextRaf(16);

  emitSolvePath(harness.runtime, [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  flushNextRaf(32);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.RESET_CLICK,
    },
  });
  flushNextRaf(48);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 0,
      c: 0,
    },
  });
  flushNextRaf(64);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.RESET_CLICK,
    },
  });
  flushNextRaf(80);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.RESET_CLICK,
    },
  });
  flushNextRaf(96);

  assert.deepEqual(renderCalls.at(-1), {
    pathLength: 4,
    messageHtml: 'completion.completed',
    isBoardSolved: true,
  });
  harness.runtime.destroy();
});

test('createRuntime keeps existing session progress when switching to an untouched level', (t) => {
  const env = installBrowserEnv(t);
  const savedBoard = {
    levelIndex: 0,
    path: [[0, 0], [0, 1]],
    movableWalls: [],
    dailyId: null,
  };
  const harness = createRuntimeHarness({
    levels: [LEVEL, LEVEL],
    persistenceInitialState: {
      campaignProgress: 1,
      sessionBoard: savedBoard,
    },
  });

  harness.runtime.start();

  assert.deepEqual(harness.state.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
  ]);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.LEVEL_SELECT,
      value: 1,
    },
  });
  flushCallbacks(env.timeoutCallbacks);

  assert.deepEqual(harness.persistence.readBootState().sessionBoard, savedBoard);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.LEVEL_SELECT,
      value: 0,
    },
  });

  assert.deepEqual(harness.state.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
  ]);
  harness.runtime.destroy();
});

test('createRuntime replaces the prior session save after a new level is attempted', (t) => {
  const env = installBrowserEnv(t);
  const harness = createRuntimeHarness({
    levels: [LEVEL, LEVEL],
    persistenceInitialState: {
      campaignProgress: 1,
      sessionBoard: {
        levelIndex: 0,
        path: [[0, 0], [0, 1]],
        movableWalls: [],
        dailyId: null,
      },
    },
  });

  harness.runtime.start();
  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.LEVEL_SELECT,
      value: 1,
    },
  });
  flushCallbacks(env.timeoutCallbacks);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 0,
      c: 0,
    },
  });
  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.LEVEL_SELECT,
      value: 0,
    },
  });
  flushCallbacks(env.timeoutCallbacks);

  assert.deepEqual(harness.persistence.readBootState().sessionBoard, {
    levelIndex: 1,
    path: [[0, 0]],
    movableWalls: [],
    dailyId: null,
  });
  assert.deepEqual(harness.state.getSnapshot().path, []);
  harness.runtime.destroy();
});

test('createRuntime locale changes keep only the latest async selection', async (t) => {
  installBrowserEnv(t);
  let currentLocale = 'en';
  const pendingLoads = new Map();
  const harness = createRuntimeHarness({
    i18nOverrides: {
      getLocale: () => currentLocale,
      resolveLocale: (locale) => locale,
      createTranslator: (locale) => (key) => `${locale}:${key}`,
      getLocaleOptions: () => [
        { value: 'en', label: 'English' },
        { value: 'fr-FR', label: 'Francais' },
        { value: 'de-DE', label: 'Deutsch' },
      ],
      setLocale: (locale) => {
        const deferred = createDeferred();
        pendingLoads.set(locale, deferred);
        return deferred.promise.then((resolved) => {
          currentLocale = resolved;
          return resolved;
        });
      },
    },
  });

  harness.runtime.start();

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.LOCALE_CHANGE, value: 'fr-FR' },
  });
  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.LOCALE_CHANGE, value: 'de-DE' },
  });

  assert.equal(harness.refs.langSel.disabled, true);

  pendingLoads.get('fr-FR').resolve('fr-FR');
  await Promise.resolve();

  assert.equal(globalThis.document.documentElement.lang, 'en');
  assert.equal(harness.refs.langSel.disabled, true);

  pendingLoads.get('de-DE').resolve('de-DE');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(globalThis.document.documentElement.lang, 'de-DE');
  assert.equal(harness.refs.langSel.value, 'de-DE');
  assert.equal(harness.refs.langSel.disabled, false);

  harness.runtime.destroy();
});

test('createRuntime refreshLocalizationUi updates disabled locale options', (t) => {
  installBrowserEnv(t);
  let offlineUnavailable = false;
  const harness = createRuntimeHarness({
    i18nOverrides: {
      getLocaleOptions: () => [
        { value: 'en', label: 'English', disabled: false },
        { value: 'fr-FR', label: 'Francais', disabled: offlineUnavailable },
      ],
    },
  });

  harness.runtime.start();
  assert.equal(harness.refs.langSel.innerHTML.includes('disabled'), false);

  offlineUnavailable = true;
  harness.runtime.refreshLocalizationUi();

  assert.equal(harness.refs.langSel.innerHTML.includes('value=\"fr-FR\" disabled'), true);

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

test('createRuntime applies persisted low power mode before first level render', (t) => {
  const env = installBrowserEnv(t);
  const harness = createRuntimeHarness({
    persistenceInitialState: {
      lowPowerModeEnabled: true,
    },
  });

  harness.runtime.start();

  assert.deepEqual(harness.getLowPowerSetCalls(), [true]);
  assert.equal(harness.refs.lowPowerToggle.checked, true);
  assert.equal(env.rafCallbacks.size, 1);

  harness.runtime.destroy();
});

test('createRuntime applies persisted low power mode before mounting the renderer', (t) => {
  const env = installBrowserEnv(t);
  const callOrder = [];
  const harness = createRuntimeHarness({
    persistenceInitialState: {
      lowPowerModeEnabled: true,
    },
    rendererOverrides: {
      mount: () => {
        callOrder.push('mount');
      },
      setLowPowerMode: (enabled) => {
        callOrder.push(`lowPower:${enabled}`);
      },
    },
  });

  harness.runtime.start();

  assert.deepEqual(callOrder.slice(0, 2), ['lowPower:true', 'mount']);

  harness.runtime.destroy();
});

test('createRuntime toggles low power mode through runtime-owned state and queues a resize redraw', (t) => {
  const env = installBrowserEnv(t);
  const harness = createRuntimeHarness();

  const flushNextRaf = (ts) => {
    const callback = [...env.rafCallbacks.values()][0];
    callback?.(ts);
  };

  harness.runtime.start();
  flushNextRaf(16);
  assert.equal(harness.getResizeCount(), 1);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.LOW_POWER_TOGGLE,
      enabled: true,
    },
  });

  assert.equal(harness.refs.lowPowerToggle.checked, true);
  assert.equal(harness.persistence.readBootState().lowPowerModeEnabled, true);
  assert.deepEqual(harness.getLowPowerSetCalls(), [false, true]);
  assert.equal(env.rafCallbacks.size, 1);

  flushNextRaf(32);
  assert.equal(harness.getResizeCount(), 2);

  harness.runtime.destroy();
});

test('createRuntime suggests low power mode for ordinary single-step drag stutter', (t) => {
  const env = installBrowserEnv(t);
  const lowFpsHintCalls = [];
  const harness = createRuntimeHarness({
    effects: {
      shouldSuggestLowPowerMode: () => true,
      onLowPowerModeSuggestion: () => {
        lowFpsHintCalls.push('hint');
      },
    },
  });

  const flushAllRafs = (ts) => {
    const callbacks = [...env.rafCallbacks.values()];
    env.rafCallbacks.clear();
    for (let i = 0; i < callbacks.length; i += 1) {
      callbacks[i]?.(ts);
    }
  };

  harness.runtime.start();
  flushAllRafs(16);

  for (let i = 1; i <= 80; i += 1) {
    flushAllRafs(16 + (i * 16));
  }

  harness.runtime.emitIntent({
    type: INTENT_TYPES.INTERACTION_UPDATE,
    payload: {
      updateType: INTERACTION_UPDATES.PATH_DRAG,
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 0 },
    },
  });
  let ts = 2000;
  flushAllRafs(ts);

  for (let i = 0; i < 12; i += 1) {
    harness.runtime.emitIntent({
      type: INTENT_TYPES.INTERACTION_UPDATE,
      payload: {
        updateType: INTERACTION_UPDATES.PATH_DRAG,
        isPathDragging: true,
        pathDragSide: 'end',
        pathDragCursor: { r: 0, c: (i + 1) % 2 },
      },
    });
    ts += 40;
    flushAllRafs(ts);
    ts += 16;
    flushAllRafs(ts);
    ts += 16;
    flushAllRafs(ts);
  }

  assert.equal(lowFpsHintCalls.length, 1);

  for (let i = 0; i < 4; i += 1) {
    ts += 40;
    flushAllRafs(ts);
  }

  assert.equal(lowFpsHintCalls.length, 1);
  harness.runtime.destroy();
});

test('createRuntime low power suggestion compares idle and drag fps before showing', (t) => {
  const env = installBrowserEnv(t);
  const lowFpsHintCalls = [];
  const harness = createRuntimeHarness({
    effects: {
      shouldSuggestLowPowerMode: () => true,
      onLowPowerModeSuggestion: () => {
        lowFpsHintCalls.push('hint');
      },
    },
  });

  const flushAllRafs = (ts) => {
    const callbacks = [...env.rafCallbacks.values()];
    env.rafCallbacks.clear();
    for (let i = 0; i < callbacks.length; i += 1) {
      callbacks[i]?.(ts);
    }
  };

  harness.runtime.start();
  flushAllRafs(16);

  for (let i = 1; i <= 80; i += 1) {
    flushAllRafs(16 + (i * 40));
  }

  harness.runtime.emitIntent({
    type: INTENT_TYPES.INTERACTION_UPDATE,
    payload: {
      updateType: INTERACTION_UPDATES.PATH_DRAG,
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 0 },
    },
  });
  let ts = 6000;
  flushAllRafs(ts);

  for (let i = 0; i < 12; i += 1) {
    harness.runtime.emitIntent({
      type: INTENT_TYPES.INTERACTION_UPDATE,
      payload: {
        updateType: INTERACTION_UPDATES.PATH_DRAG,
        isPathDragging: true,
        pathDragSide: 'end',
        pathDragCursor: { r: 0, c: (i + 1) % 2 },
      },
    });
    ts += 40;
    flushAllRafs(ts);
    ts += 16;
    flushAllRafs(ts);
    ts += 16;
    flushAllRafs(ts);
  }

  assert.equal(lowFpsHintCalls.length, 0);
  harness.runtime.destroy();
});

test('createRuntime coalesces batched drag commands and records one transition per batch', (t) => {
  const env = installBrowserEnv(t);
  const transitionCalls = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      recordPathTransition: (previousSnapshot, nextSnapshot) => {
        transitionCalls.push({
          previousLength: previousSnapshot.path.length,
          nextLength: nextSnapshot.path.length,
        });
      },
    },
  });

  const flushNextRaf = (ts) => {
    const callback = [...env.rafCallbacks.values()][0];
    callback?.(ts);
  };

  harness.runtime.start();
  flushNextRaf(16);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE,
      side: 'end',
      steps: [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
      ],
    },
  });

  assert.deepEqual(transitionCalls, [
    { previousLength: 0, nextLength: 2 },
  ]);
  assert.equal(env.rafCallbacks.size, 1);
  flushNextRaf(32);
  assert.equal(harness.getRenderCount(), 2);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE,
      side: 'end',
      steps: [{ r: 1, c: 1 }],
    },
  });
  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE,
      side: 'end',
      steps: [{ r: 1, c: 0 }],
    },
  });

  assert.deepEqual(transitionCalls, [
    { previousLength: 0, nextLength: 2 },
    { previousLength: 2, nextLength: 3 },
    { previousLength: 3, nextLength: 4 },
  ]);
  assert.equal(env.rafCallbacks.size, 1);
  flushNextRaf(48);
  assert.equal(harness.getRenderCount(), 3);

  harness.runtime.destroy();
});

test('createRuntime builds drag-sequence tip-arrival hint from the final applied step', (t) => {
  const env = installBrowserEnv(t);
  const renderCalls = [];
  const mixedTurnLevel = {
    name: 'Mixed Turn Hint',
    grid: [
      '...',
      '...',
      '...',
    ],
    stitches: [],
    cornerCounts: [],
  };
  const harness = createRuntimeHarness({
    levels: [mixedTurnLevel],
    rendererOverrides: {
      renderFrame: (payload) => {
        renderCalls.push(payload);
      },
    },
  });

  const flushNextRaf = (ts) => {
    const callback = [...env.rafCallbacks.values()][0];
    callback?.(ts);
  };

  harness.runtime.start();
  flushNextRaf(16);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 0,
      c: 0,
    },
  });
  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 0,
      c: 1,
    },
  });
  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 1,
      c: 1,
    },
  });
  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.START_OR_STEP,
      r: 1,
      c: 2,
    },
  });
  flushNextRaf(32);

  harness.runtime.emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: {
      commandType: GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE,
      side: 'end',
      steps: [
        { r: 1, c: 1 },
        { r: 2, c: 1 },
      ],
    },
  });
  flushNextRaf(48);

  assert.deepEqual(renderCalls.at(-1)?.interactionModel?.pathTipArrivalHint, {
    side: 'end',
    from: { r: 1, c: 1 },
    to: { r: 2, c: 1 },
  });

  harness.runtime.destroy();
});
