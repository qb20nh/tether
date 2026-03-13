import assert from 'node:assert/strict';
import test from '../test.ts';
import { createDefaultCore } from '../../src/core/default_core.ts';
import { createLevelProvider } from '../../src/core/level_provider.ts';
import { createMemoryPersistence } from '../../src/persistence/memory_persistence.ts';
import { createRuntime } from '../../src/runtime/create_runtime.ts';
import { GAME_COMMANDS, INTENT_TYPES, INTERACTION_UPDATES, UI_ACTIONS } from '../../src/runtime/intents.ts';
import { createGameStateStore } from '../../src/state/game_state_store.ts';
import type {
  BoardLayoutMetrics,
  RendererRenderPayload,
  RuntimeController,
  SessionBoardState,
  TranslateVars,
} from '../../src/contracts/ports.ts';

const globalObject = (globalThis as any);

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

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createClassList = () => {
  const tokens = new Set<string>();
  return ({
    add: (...values: string[]) => values.forEach((value) => tokens.add(value)),
    remove: (...values: string[]) => values.forEach((value) => tokens.delete(value)),
    toggle: (value: string, force?: boolean) => {
      const shouldHave = force === undefined ? !tokens.has(value) : Boolean(force);
      if (shouldHave) tokens.add(value);
      else tokens.delete(value);
      return shouldHave;
    },
    contains: (value: string) => tokens.has(value),
  } as any);
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
  setAttribute() { },
  removeAttribute() { },
  querySelector() {
    return createElement();
  },
  closest() {
    return createElement();
  },
} as any);

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

  return ({
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
    keyboardGamepadToggle: createElement(),
    themeSwitchMessage: createElement(),
    themeSwitchDialog: createElement(),
    resetBtn: createElement(),
    reverseBtn: createElement(),
    langSel: createElement(),
    msgEl: createElement(),
  } as any);
};

const flushQueuedRafs = (
  env: { rafCallbacks: Map<number, (timestamp: number) => void> },
  ts: number,
) => {
  const callbacks = [...env.rafCallbacks.values()];
  env.rafCallbacks.clear();
  for (const element of callbacks) {
    element?.(ts);
  }
};

const installBrowserEnv = (t: { after: (cleanup: () => void) => void }) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const ensureListeners = (eventName: string) => {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    return listeners.get(eventName)!;
  };

  const rafCallbacks = new Map<number, (timestamp: number) => void>();
  let nextRafId = 1;
  const timeoutCallbacks = new Map<number, () => void>();
  let nextTimeoutId = 1;
  const resizeObservers: FakeResizeObserver[] = [];

  class FakeResizeObserver {
    callback: () => void;
    observeCount: number;
    disconnectCount: number;

    constructor(callback: () => void) {
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

  globalObject.window = ({
    addEventListener(eventName: string, handler: (...args: unknown[]) => void) {
      ensureListeners(eventName).add(handler);
    },
    removeEventListener(eventName: string, handler: (...args: unknown[]) => void) {
      ensureListeners(eventName).delete(handler);
    },
  } as any);
  globalObject.document = ({
    documentElement: {
      lang: '',
      dataset: {},
      classList: createClassList(),
      setAttribute() { },
    },
    body: null,
  } as any);
  globalObject.ResizeObserver = (FakeResizeObserver as any);
  globalObject.requestAnimationFrame = (callback: (timestamp: number) => void) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, (...args) => {
      rafCallbacks.delete(id);
      return callback(...args);
    });
    return id;
  };
  globalObject.cancelAnimationFrame = (id: number) => {
    rafCallbacks.delete(id);
  };
  globalObject.setTimeout = (callback: () => void) => {
    const id = nextTimeoutId;
    nextTimeoutId += 1;
    timeoutCallbacks.set(id, (...args) => {
      timeoutCallbacks.delete(id);
      return callback(...args);
    });
    return id;
  };
  globalObject.clearTimeout = (id: number) => {
    timeoutCallbacks.delete(id);
  };

  t.after(() => {
    globalObject.window = originalWindow;
    globalObject.document = originalDocument;
    globalObject.ResizeObserver = originalResizeObserver;
    globalObject.requestAnimationFrame = originalRaf;
    globalObject.cancelAnimationFrame = originalCancelRaf;
    globalObject.setTimeout = originalSetTimeout;
    globalObject.clearTimeout = originalClearTimeout;
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
  createRuntimeImpl = createRuntime,
}: any = {}) => {
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
  let lastBindPayload: { readLayoutMetrics?: () => BoardLayoutMetrics | null } | null = null;
  const lowPowerSetCalls: boolean[] = [];
  const keyboardGamepadControlsSetCalls: boolean[] = [];
  const inputSyncSnapshots: unknown[] = [];

  const persistence = ({
    ...basePersistence,
    ...persistenceOverrides,
  } as any);
  if (!persistence.writeSessionBoard) persistence.writeSessionBoard = basePersistence.writeSessionBoard;
  if (!persistence.clearSessionBoard) persistence.clearSessionBoard = basePersistence.clearSessionBoard;

  const renderer = ({
    mount: () => { },
    getRefs: () => refs,
    rebuildGrid: (...args: unknown[]) => {
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
    setLowPowerMode: (enabled: boolean) => {
      lowPowerSetCalls.push(Boolean(enabled));
      rendererOverrides.setLowPowerMode?.(enabled);
    },
    unmount: () => {
      unmountCount += 1;
    },
  } as any);
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

  const i18n = ({
    resolveLocale: () => 'en',
    createTranslator: () => (key: string, vars: TranslateVars = {}) => {
      if (key === 'ui.infiniteLevelOption') return `Infinite ${vars.n ?? ''}`.trim();
      if (key === 'ui.dailyLevelOptionWithDate') return `${vars.label} ${vars.date}`.trim();
      return key;
    },
    getLocale: () => 'en',
    setLocale: async () => 'en',
    getLocaleOptions: () => [{ value: 'en', label: 'English' }],
    ...i18nOverrides,
  } as any);

  const runtime = createRuntimeImpl({
    appEl: ({
      querySelectorAll: () => [],
    } as any),
    core,
    state,
    persistence,
    renderer,
    input: ({
      bind: (payload: { readLayoutMetrics?: () => BoardLayoutMetrics | null }) => {
        bindCount += 1;
        lastBindPayload = payload;
      },
      setKeyboardGamepadControlsEnabled: (enabled: boolean) => {
        keyboardGamepadControlsSetCalls.push(Boolean(enabled));
      },
      syncSnapshot: (snapshot: unknown) => {
        inputSyncSnapshots.push(snapshot);
      },
      setBoardControlSuppressed: () => { },
      unbind: () => {
        unbindCount += 1;
      },
    } as any),
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
    getKeyboardGamepadControlsSetCalls: () => [...keyboardGamepadControlsSetCalls],
    getInputSyncSnapshots: () => [...inputSyncSnapshots],
  };
};

const flushCallbacks = (
  callbackMap: Map<number, (...args: unknown[]) => void>,
  arg?: unknown,
) => {
  let guard = 0;
  while (callbackMap.size > 0 && guard < 20) {
    const callbacks = [...callbackMap.values()];
    callbacks.forEach((callback) => {
      if (arg === undefined) {
        callback();
        return;
      }
      callback(arg);
    });
    guard += 1;
  }
};

const emitSolvePath = (runtime: RuntimeController, cells: Array<[number, number]>) => {
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

test('createRuntime omits daily freeze debug hooks when __TETHER_DEV__ is false', async (t) => {
  installBrowserEnv(t);

  const hadDevFlag = Object.hasOwn(globalObject, '__TETHER_DEV__');
  const previousDevFlag = globalObject.__TETHER_DEV__;
  globalObject.__TETHER_DEV__ = false;

  t.after(() => {
    if (hadDevFlag) globalObject.__TETHER_DEV__ = previousDevFlag;
    else Reflect.deleteProperty(globalObject, '__TETHER_DEV__');
  });

  const moduleUrl = new URL(`../../src/runtime/create_runtime.ts?prod-gate=${Date.now()}`, import.meta.url);
  const { createRuntime: createRuntimeProd } = await import(moduleUrl.href);
  const { runtime } = createRuntimeHarness({
    dailyLevel: DAILY_LEVEL,
    createRuntimeImpl: createRuntimeProd,
  });

  assert.equal('readDebugDailyFreezeState' in runtime, false);
  assert.equal('setDebugForceDailyFrozen' in runtime, false);
  assert.equal('toggleDebugForceDailyFrozen' in runtime, false);
});

test('createRuntime destroy removes listeners, disconnects observers, and cancels pending work', (t) => {
  const env = installBrowserEnv(t);
  const writeSessionBoards: SessionBoardState[] = [];
  const harness = createRuntimeHarness({
    persistenceOverrides: {
      writeSessionBoard(board: SessionBoardState) {
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
  installBrowserEnv(t);
  const unmountOptions: Array<{ releaseWebglContext: boolean }> = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      unmount: (options: { releaseWebglContext: boolean }) => {
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
  const calls: string[] = [];
  const harness = createRuntimeHarness({
    dailyLevel: DAILY_LEVEL,
    effects: {
      onDailySolvedDateChanged: (dailyId: string) => {
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
  const renderCalls: Array<{
    pathLength: number;
    messageHtml: string | undefined;
    isBoardSolved: boolean | undefined;
  }> = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      renderFrame: (payload: RendererRenderPayload) => {
        renderCalls.push({
          pathLength: payload.snapshot.path.length,
          messageHtml: payload.uiModel?.messageHtml,
          isBoardSolved: payload.uiModel?.isBoardSolved,
        });
      },
    },
  });

  const flushNextRaf = (ts: number) => {
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
  const renderCalls: Array<{
    pathLength: number;
    messageHtml: string | undefined;
    isBoardSolved: boolean | undefined;
  }> = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      renderFrame: (payload: RendererRenderPayload) => {
        renderCalls.push({
          pathLength: payload.snapshot.path.length,
          messageHtml: payload.uiModel?.messageHtml,
          isBoardSolved: payload.uiModel?.isBoardSolved,
        });
      },
    },
  });

  const flushNextRaf = (ts: number) => {
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

test('createRuntime targets the latest unlocked campaign level for primary bucket options', (t) => {
  installBrowserEnv(t);
  const campaignLevels = [
    { ...LEVEL, nameKey: 'level.tutorial_1' },
    { ...LEVEL, nameKey: 'level.tutorial_2' },
    { ...LEVEL, nameKey: 'level.pilot_1' },
    { ...LEVEL, nameKey: 'level.pilot_2' },
  ];
  const harness = createRuntimeHarness({
    levels: campaignLevels,
    persistenceInitialState: {
      campaignProgress: 3,
      sessionBoard: {
        levelIndex: 2,
        path: [],
        movableWalls: [],
        dailyId: null,
      },
    },
  });

  harness.runtime.start();

  assert.match(harness.refs.levelSel.innerHTML, /<option value="1"[^>]*>ui\.levelGroupTutorial<\/option>/);
  assert.match(harness.refs.levelSel.innerHTML, /<option value="3"[^>]*>ui\.levelGroupPractice<\/option>/);
  assert.equal(harness.refs.levelSel.value, '3');
  assert.equal(harness.refs.infiniteSel.value, '2');

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

test('createRuntime saves in-progress keyboard path steps after the debounce window', (t) => {
  const env = installBrowserEnv(t);
  const harness = createRuntimeHarness();

  harness.runtime.start();

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
  flushCallbacks(env.timeoutCallbacks);

  assert.deepEqual(harness.persistence.readBootState().sessionBoard, {
    levelIndex: 0,
    path: [[0, 0], [0, 1]],
    movableWalls: [],
    dailyId: null,
  });
  harness.runtime.destroy();
});

test('createRuntime locale changes keep only the latest async selection', async (t) => {
  installBrowserEnv(t);
  let currentLocale = 'en';
  const pendingLoads = new Map<string, ReturnType<typeof createDeferred<string>>>();
  const harness = createRuntimeHarness({
    i18nOverrides: {
      getLocale: () => currentLocale,
      resolveLocale: (locale: string) => locale,
      createTranslator: (locale: string) => (key: string) => `${locale}:${key}`,
      getLocaleOptions: () => [
        { value: 'en', label: 'English' },
        { value: 'fr-FR', label: 'Francais' },
        { value: 'de-DE', label: 'Deutsch' },
      ],
      setLocale: (locale: string) => {
        const deferred = createDeferred<string>();
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

  const frLoad = pendingLoads.get('fr-FR');
  assert.ok(frLoad);
  frLoad.resolve('fr-FR');
  await Promise.resolve();

  assert.equal(globalThis.document.documentElement.lang, 'en');
  assert.equal(harness.refs.langSel.disabled, true);

  const deLoad = pendingLoads.get('de-DE');
  assert.ok(deLoad);
  deLoad.resolve('de-DE');
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

  assert.equal(harness.refs.langSel.innerHTML.includes('value="fr-FR" disabled'), true);

  harness.runtime.destroy();
});

test('createRuntime does not fire onDailySolvedDateChanged for campaign or infinite clears', (t) => {
  const env = installBrowserEnv(t);
  const calls: string[] = [];
  const harness = createRuntimeHarness({
    effects: {
      onDailySolvedDateChanged: (dailyId: string) => {
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

  const flushNextRaf = (ts: number) => {
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
  installBrowserEnv(t);
  const callOrder: string[] = [];
  const harness = createRuntimeHarness({
    persistenceInitialState: {
      lowPowerModeEnabled: true,
    },
    rendererOverrides: {
      mount: () => {
        callOrder.push('mount');
      },
      setLowPowerMode: (enabled: boolean) => {
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

  const flushNextRaf = (ts: number) => {
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

test('createRuntime applies persisted keyboard / gamepad controls and syncs board input on startup', (t) => {
  installBrowserEnv(t);
  const harness = createRuntimeHarness({
    persistenceInitialState: {
      keyboardGamepadControlsEnabled: true,
    },
  });

  harness.runtime.start();

  assert.equal(harness.refs.keyboardGamepadToggle.checked, true);
  assert.deepEqual(harness.getKeyboardGamepadControlsSetCalls(), [true]);
  assert.equal(harness.getInputSyncSnapshots().length > 0, true);

  harness.runtime.destroy();
});

test('createRuntime forwards board-nav key press state to renderer interaction updates', (t) => {
  installBrowserEnv(t);
  const interactionUpdates: Array<{
    isBoardNavActive: boolean | undefined;
    isBoardNavPressing: boolean | undefined;
    boardCursor: { r: number; c: number } | null | undefined;
  }> = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      updateInteraction: (interactionModel: RendererRenderPayload['interactionModel']) => {
        interactionUpdates.push({
          isBoardNavActive: interactionModel?.isBoardNavActive,
          isBoardNavPressing: interactionModel?.isBoardNavPressing,
          boardCursor: interactionModel?.boardCursor,
        });
      },
    },
  });

  harness.runtime.start();
  harness.runtime.emitIntent({
    type: INTENT_TYPES.INTERACTION_UPDATE,
    payload: {
      updateType: INTERACTION_UPDATES.BOARD_NAV,
      isBoardNavActive: true,
      isBoardNavPressing: true,
      boardCursor: { r: 0, c: 1 },
    },
  });

  assert.deepEqual(interactionUpdates.at(-1), {
    isBoardNavActive: true,
    isBoardNavPressing: true,
    boardCursor: { r: 0, c: 1 },
  });

  harness.runtime.destroy();
});

test('createRuntime toggles keyboard / gamepad controls through runtime-owned state', (t) => {
  installBrowserEnv(t);
  const harness = createRuntimeHarness({
    persistenceInitialState: {
      keyboardGamepadControlsEnabled: true,
    },
  });

  harness.runtime.start();
  harness.runtime.emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.KEYBOARD_GAMEPAD_CONTROLS_TOGGLE,
      enabled: false,
    },
  });

  assert.equal(harness.refs.keyboardGamepadToggle.checked, false);
  assert.equal(harness.persistence.readBootState().keyboardGamepadControlsEnabled, false);
  assert.deepEqual(harness.getKeyboardGamepadControlsSetCalls(), [true, false]);

  harness.runtime.destroy();
});

test('createRuntime suggests low power mode for ordinary single-step drag stutter', (t) => {
  const env = installBrowserEnv(t);
  const lowFpsHintCalls: string[] = [];
  const harness = createRuntimeHarness({
    effects: {
      shouldSuggestLowPowerMode: () => true,
      onLowPowerModeSuggestion: () => {
        lowFpsHintCalls.push('hint');
      },
    },
  });

  const flushAllRafs = (ts: number) => flushQueuedRafs(env, ts);

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
  const lowFpsHintCalls: string[] = [];
  const harness = createRuntimeHarness({
    effects: {
      shouldSuggestLowPowerMode: () => true,
      onLowPowerModeSuggestion: () => {
        lowFpsHintCalls.push('hint');
      },
    },
  });

  const flushAllRafs = (ts: number) => flushQueuedRafs(env, ts);

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
  const transitionCalls: Array<{ previousLength: number; nextLength: number }> = [];
  const harness = createRuntimeHarness({
    rendererOverrides: {
      recordPathTransition: (
        previousSnapshot: RendererRenderPayload['snapshot'],
        nextSnapshot: RendererRenderPayload['snapshot'],
      ) => {
        transitionCalls.push({
          previousLength: previousSnapshot.path.length,
          nextLength: nextSnapshot.path.length,
        });
      },
    },
  });

  const flushNextRaf = (ts: number) => {
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
  const renderCalls: RendererRenderPayload[] = [];
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
      renderFrame: (payload: RendererRenderPayload) => {
        renderCalls.push(payload);
      },
    },
  });

  const flushNextRaf = (ts: number) => {
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
