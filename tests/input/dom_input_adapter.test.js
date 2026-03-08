import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { createDomInputAdapter } from '../../src/input/dom_input_adapter.js';
import { GAME_COMMANDS, INTENT_TYPES } from '../../src/runtime/intents.js';

const LEVEL = {
  name: 'Input Adapter',
  grid: [
    '..',
    '..',
  ],
  stitches: [],
  cornerCounts: [],
};

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.style = {
      getPropertyValue: () => '',
      setProperty() {},
    };
    this.dataset = {};
  }

  addEventListener(eventName, handler) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(handler);
  }

  removeEventListener(eventName, handler) {
    this.listeners.get(eventName)?.delete(handler);
  }

  dispatch(eventName, event) {
    for (const handler of this.listeners.get(eventName) || []) {
      handler(event);
    }
  }

  querySelector() {
    return null;
  }

  closest(selector) {
    return selector === '.cell' ? this : null;
  }
}

const createRefs = (gridEl) => ({
  gridEl,
  levelSel: new FakeElement(),
  infiniteSel: new FakeElement(),
  langSel: new FakeElement(),
  themeToggle: new FakeElement(),
  settingsToggle: new FakeElement(),
  settingsPanel: new FakeElement(),
  resetBtn: new FakeElement(),
  reverseBtn: new FakeElement(),
  nextLevelBtn: new FakeElement(),
  prevInfiniteBtn: new FakeElement(),
  guideToggleBtn: new FakeElement(),
  legendToggleBtn: new FakeElement(),
  themeSwitchDialog: new FakeElement(),
});

const createPointerEvent = (pointerId, clientX, clientY) => ({
  pointerId,
  clientX,
  clientY,
  cancelable: true,
  preventDefault() {},
});

const installDomGlobals = (t, metrics, elementFromPoint, windowState = null) => {
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalWindow = globalThis.window;

  const documentElement = new FakeElement();
  const documentTarget = new FakeElement();
  documentTarget.documentElement = documentElement;
  documentTarget.elementFromPoint = elementFromPoint;
  const windowTarget = windowState || {
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
  };
  if (typeof windowTarget.addEventListener !== 'function') {
    windowTarget.addEventListener = () => {};
  }
  if (typeof windowTarget.removeEventListener !== 'function') {
    windowTarget.removeEventListener = () => {};
  }
  if (!windowTarget.visualViewport) {
    windowTarget.visualViewport = null;
  }

  globalThis.document = documentTarget;
  globalThis.Element = FakeElement;
  globalThis.window = windowTarget;
  globalThis.getComputedStyle = () => ({
    getPropertyValue(name) {
      if (name === '--cell') return String(metrics.size);
      if (name === '--grid-cols') return String(metrics.cols);
      return '0';
    },
    columnGap: String(metrics.gap),
    gap: String(metrics.gap),
    paddingLeft: String(metrics.pad),
    padding: String(metrics.pad),
  });

  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.Element = originalElement;
    globalThis.window = originalWindow;
    globalThis.getComputedStyle = originalGetComputedStyle;
  });

  return {
    documentTarget,
    windowTarget,
  };
};

const createGridHarness = (t, options = {}) => {
  const metrics = {
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
    ...(options.metrics || {}),
  };
  let rectReads = 0;
  const gridEl = new FakeElement();
  gridEl.id = 'grid';
  gridEl.setPointerCapture = () => {};
  gridEl.getBoundingClientRect = () => {
    rectReads += 1;
    return {
      left: metrics.left,
      top: metrics.top,
      right: metrics.right,
      bottom: metrics.bottom,
      width: metrics.right - metrics.left,
      height: metrics.bottom - metrics.top,
    };
  };

  const elementFromPoint = options.elementFromPoint || ((x, y) => {
    if (x < metrics.left || x >= metrics.right || y < metrics.top || y >= metrics.bottom) {
      return null;
    }
    const c = Math.floor((x - metrics.left) / metrics.step);
    const r = Math.floor((y - metrics.top) / metrics.step);
    const cell = new FakeElement();
    cell.dataset.r = String(r);
    cell.dataset.c = String(c);
    return cell;
  });

  const { documentTarget, windowTarget } = installDomGlobals(
    t,
    metrics,
    elementFromPoint,
    options.windowState,
  );
  const level = options.level || LEVEL;
  const store = createGameStateStore(() => level);
  store.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: 0 } });
  const emittedIntents = [];

  const adapter = createDomInputAdapter();
  adapter.bind({
    refs: createRefs(gridEl),
    readSnapshot: () => store.getSnapshot(),
    readLayoutMetrics: options.readLayoutMetrics || (() => null),
    emitIntent: (intent) => {
      emittedIntents.push(intent);
      if (typeof options.emitIntent === 'function') {
        options.emitIntent(intent, store);
        return;
      }
      if (intent?.type !== INTENT_TYPES.GAME_COMMAND) return;
      store.dispatch({
        type: intent.payload.commandType,
        payload: intent.payload,
      });
    },
  });

  t.after(() => {
    adapter.unbind();
    documentTarget.listeners.clear();
  });

  return {
    adapter,
    store,
    gridEl,
    metrics,
    windowTarget,
    emittedIntents,
    getRectReads: () => rectReads,
  };
};

test('dom input adapter avoids layout reads during drag when renderer metrics are available', (t) => {
  const harness = createGridHarness(t, {
    readLayoutMetrics: () => ({
      version: 7,
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
  });

  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 10, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 30));

  assert.equal(harness.getRectReads(), 0);
  assert.equal(harness.store.getSnapshot().path.length > 0, true);
});

test('dom input adapter falls back to live layout reads during drag without renderer metrics', (t) => {
  const harness = createGridHarness(t);

  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 10, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 30));

  assert.equal(harness.getRectReads() > 0, true);
});

test('dom input adapter adjusts cached metrics when the page scrolls', (t) => {
  const harness = createGridHarness(t, {
    metrics: {
      left: 0,
      top: 40,
      right: 40,
      bottom: 80,
    },
    windowState: {
      scrollX: 0,
      scrollY: 20,
      pageXOffset: 0,
      pageYOffset: 20,
    },
    readLayoutMetrics: () => ({
      version: 11,
      rows: 2,
      cols: 2,
      left: 0,
      top: 40,
      right: 40,
      bottom: 80,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
      scrollX: 0,
      scrollY: 0,
    }),
  });

  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 10, 30));

  assert.deepEqual(harness.store.getSnapshot().path, [{ r: 0, c: 0 }]);
  assert.equal(harness.getRectReads(), 0);
});

test('dom input adapter does not read window scroll during pointermove when metrics are cached', (t) => {
  let scrollReads = 0;
  const windowState = {
    get scrollX() {
      scrollReads += 1;
      return 0;
    },
    get scrollY() {
      scrollReads += 1;
      return 0;
    },
    get pageXOffset() {
      scrollReads += 1;
      return 0;
    },
    get pageYOffset() {
      scrollReads += 1;
      return 0;
    },
    addEventListener() {},
    removeEventListener() {},
    visualViewport: null,
  };
  const harness = createGridHarness(t, {
    windowState,
    readLayoutMetrics: () => ({
      version: 12,
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
      scrollX: 0,
      scrollY: 0,
    }),
  });

  scrollReads = 0;
  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 10, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 30));

  assert.equal(scrollReads, 0);
  assert.equal(harness.getRectReads(), 0);
});

test('dom input adapter batches multi-cell drag moves into one sequence command', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Line',
      grid: ['....'],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 1,
      cols: 4,
      left: 0,
      top: 0,
      right: 80,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
    readLayoutMetrics: () => ({
      version: 3,
      rows: 1,
      cols: 4,
      left: 0,
      top: 0,
      right: 80,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    }),
  });

  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 10, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 78, 10));

  const gameIntents = harness.emittedIntents.filter((intent) => intent?.type === INTENT_TYPES.GAME_COMMAND);
  assert.equal(gameIntents.length, 2);
  assert.equal(gameIntents[0].payload.commandType, GAME_COMMANDS.START_OR_STEP);
  assert.equal(gameIntents[1].payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.equal(gameIntents[1].payload.side, 'end');
  assert.deepEqual(gameIntents[1].payload.steps, [
    { r: 0, c: 1 },
    { r: 0, c: 2 },
    { r: 0, c: 3 },
  ]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 0, c: 2 },
    { r: 0, c: 3 },
  ]);
});

test('dom input adapter uses a one-step sequence command for single-cell drags', (t) => {
  const harness = createGridHarness(t, {
    readLayoutMetrics: () => ({
      version: 4,
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
  });

  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 10, 10));
  harness.gridEl.dispatch('pointermove', createPointerEvent(1, 30, 10));

  const gameIntents = harness.emittedIntents.filter((intent) => intent?.type === INTENT_TYPES.GAME_COMMAND);
  assert.equal(gameIntents.length, 2);
  assert.equal(gameIntents[1].payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.deepEqual(gameIntents[1].payload.steps, [{ r: 0, c: 1 }]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
  ]);
});
