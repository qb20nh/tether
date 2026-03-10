import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStateStore } from '../../src/state/game_state_store.js';
import { createDomInputAdapter } from '../../src/input/dom_input_adapter.js';
import {
  GAME_COMMANDS,
  INTENT_TYPES,
  UI_ACTIONS,
  INTERACTION_UPDATES,
} from '../../src/runtime/intents.js';

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
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.listeners = new Map();
    this.style = {
      getPropertyValue: () => '',
      setProperty() {},
    };
    this.dataset = {};
    this.parentElement = null;
    this.open = false;
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

  focus() {
    if (globalThis.document) {
      globalThis.document.activeElement = this;
    }
    this.dispatch('focus', { target: this });
  }

  blur() {
    if (globalThis.document?.activeElement === this) {
      globalThis.document.activeElement = globalThis.document.body || null;
    }
    this.dispatch('blur', { target: this });
  }

  querySelector() {
    return null;
  }

  contains(node) {
    return node === this;
  }

  closest(selector) {
    if (selector === 'dialog' && this.tagName === 'DIALOG') return this;
    return selector === '.cell' ? this : null;
  }

  matches(selector) {
    if (selector === 'dialog') return this.tagName === 'DIALOG';
    return false;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  removeAttribute(name) {
    delete this[name];
  }
}

const createRefs = (gridEl) => ({
  boardFocusProxy: new FakeElement('button'),
  gridEl,
  levelSel: new FakeElement('select'),
  infiniteSel: new FakeElement('select'),
  langSel: new FakeElement('select'),
  themeToggle: new FakeElement('button'),
  lowPowerToggle: new FakeElement('input'),
  keyboardGamepadToggle: new FakeElement('input'),
  settingsToggle: new FakeElement('button'),
  settingsPanel: new FakeElement(),
  resetBtn: new FakeElement('button'),
  reverseBtn: new FakeElement('button'),
  nextLevelBtn: new FakeElement('button'),
  prevInfiniteBtn: new FakeElement('button'),
  guideToggleBtn: new FakeElement('button'),
  legendToggleBtn: new FakeElement('button'),
  themeSwitchDialog: new FakeElement('dialog'),
});

const createPointerEvent = (pointerId, clientX, clientY) => ({
  pointerId,
  clientX,
  clientY,
  cancelable: true,
  preventDefault() {},
});

const createKeyEvent = (key, overrides = {}) => ({
  key,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  preventDefault() {},
  ...overrides,
});

const createGamepad = ({ buttons = {}, axes = [0, 0], mapping = 'standard' } = {}) => {
  const gamepadButtons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  Object.entries(buttons).forEach(([index, pressed]) => {
    gamepadButtons[Number(index)] = {
      pressed: Boolean(pressed),
      value: pressed ? 1 : 0,
    };
  });
  return {
    connected: true,
    mapping,
    buttons: gamepadButtons,
    axes,
  };
};

const getLastIntent = (harness, matcher) => {
  for (let index = harness.emittedIntents.length - 1; index >= 0; index -= 1) {
    const intent = harness.emittedIntents[index];
    if (matcher(intent)) return intent;
  }
  return null;
};

const getLastBoardNavIntent = (harness) => getLastIntent(
  harness,
  (intent) => (
    intent?.type === INTENT_TYPES.INTERACTION_UPDATE
    && intent.payload?.updateType === INTERACTION_UPDATES.BOARD_NAV
  ),
);

const getLastInteractionIntent = (harness, updateType) => getLastIntent(
  harness,
  (intent) => (
    intent?.type === INTENT_TYPES.INTERACTION_UPDATE
    && intent.payload?.updateType === updateType
  ),
);

const getLastWallDragIntent = (harness) => getLastInteractionIntent(
  harness,
  INTERACTION_UPDATES.WALL_DRAG,
);

const getLastWallDropTargetIntent = (harness) => getLastInteractionIntent(
  harness,
  INTERACTION_UPDATES.WALL_DROP_TARGET,
);

const getLastGameCommandIntent = (harness) => getLastIntent(
  harness,
  (intent) => intent?.type === INTENT_TYPES.GAME_COMMAND,
);

const tapDirectionalKeys = (harness, keys, timestamp = 16) => {
  keys.forEach((key) => {
    harness.gridEl.dispatch('keydown', createKeyEvent(key));
  });
  harness.flushAllRafs(timestamp, 6);
  keys.forEach((key) => {
    harness.gridEl.dispatch('keyup', createKeyEvent(key));
  });
};

const installDomGlobals = (t, metrics, elementFromPoint, windowState = null) => {
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalWindow = globalThis.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  const documentElement = new FakeElement('html');
  const documentTarget = new FakeElement('document');
  const body = new FakeElement('body');
  documentTarget.documentElement = documentElement;
  documentTarget.body = body;
  documentTarget.activeElement = body;
  documentTarget.elementFromPoint = elementFromPoint;
  documentTarget.querySelector = () => null;
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
  const rafCallbacks = new Map();
  let nextRafId = 1;
  let currentGamepads = [];

  globalThis.document = documentTarget;
  globalThis.Element = FakeElement;
  globalThis.window = windowTarget;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      getGamepads() {
        return currentGamepads;
      },
    },
  });
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
  };
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
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    globalThis.getComputedStyle = originalGetComputedStyle;
  });

  return {
    documentTarget,
    windowTarget,
    rafCallbacks,
    setGamepads(gamepads) {
      currentGamepads = Array.isArray(gamepads) ? gamepads : [];
    },
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

  const {
    documentTarget,
    windowTarget,
    rafCallbacks,
    setGamepads,
  } = installDomGlobals(
    t,
    metrics,
    elementFromPoint,
    options.windowState,
  );
  const level = options.level || LEVEL;
  const store = createGameStateStore(() => level);
  store.dispatch({ type: GAME_COMMANDS.LOAD_LEVEL, payload: { levelIndex: 0 } });
  const emittedIntents = [];
  const refs = createRefs(gridEl);

  const adapter = createDomInputAdapter();
  adapter.bind({
    refs,
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
    refs,
    gridEl,
    documentTarget,
    metrics,
    windowTarget,
    emittedIntents,
    getRectReads: () => rectReads,
    flushNextRaf: (timestamp = 16) => {
      const nextEntry = rafCallbacks.entries().next().value;
      if (!nextEntry) return false;
      const [id, callback] = nextEntry;
      rafCallbacks.delete(id);
      callback(timestamp);
      return true;
    },
    flushAllRafs: (timestamp = 16, limit = 20) => {
      let count = 0;
      while (count < limit) {
        const didFlush = (() => {
          const nextEntry = rafCallbacks.entries().next().value;
          if (!nextEntry) return false;
          const [id, callback] = nextEntry;
          rafCallbacks.delete(id);
          callback(timestamp);
          return true;
        })();
        if (!didFlush) break;
        count += 1;
      }
      return count;
    },
    setGamepads,
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

test('dom input adapter emits low power toggle actions from settings', (t) => {
  const harness = createGridHarness(t);

  harness.refs.lowPowerToggle.dispatch('change', {
    target: { checked: true },
  });

  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.LOW_POWER_TOGGLE,
      enabled: true,
    },
  });
});

test('dom input adapter emits keyboard/gamepad controls toggle actions from settings', (t) => {
  const harness = createGridHarness(t);

  harness.refs.keyboardGamepadToggle.dispatch('change', {
    target: { checked: true },
  });

  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.KEYBOARD_GAMEPAD_CONTROLS_TOGGLE,
      enabled: true,
    },
  });
});

test('dom input adapter ignores board keyboard input while controls are disabled', (t) => {
  const harness = createGridHarness(t);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowRight'));
  harness.flushNextRaf(16);

  assert.deepEqual(harness.store.getSnapshot().path, []);
  assert.equal(getLastBoardNavIntent(harness), null);
});

test('dom input adapter forwards the board focus proxy to the grid', (t) => {
  const harness = createGridHarness(t);

  assert.notEqual(globalThis.document.activeElement, harness.gridEl);
  harness.refs.boardFocusProxy.dispatch('click', {
    preventDefault() {},
  });

  assert.equal(globalThis.document.activeElement, harness.gridEl);
});

test('dom input adapter drives board cursor and path selection with keyboard when enabled', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(harness.store.getSnapshot().path, [{ r: 0, c: 0 }]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload, {
    updateType: INTERACTION_UPDATES.BOARD_NAV,
    isBoardNavActive: true,
    isBoardNavPressing: true,
    boardCursor: { r: 0, c: 0 },
    boardSelection: { kind: 'path-end', r: 0, c: 0 },
    boardSelectionInteractive: true,
  });

  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 1,
  });

  tapDirectionalKeys(harness, ['ArrowLeft']);
  assert.deepEqual(harness.store.getSnapshot().path, [{ r: 0, c: 0 }]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 0,
  });

  harness.gridEl.dispatch('keydown', createKeyEvent('Spacebar'));
  assert.deepEqual(harness.store.getSnapshot().path, []);
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);

  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(harness.store.getSnapshot().path, []);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 1 });

  tapDirectionalKeys(harness, ['ArrowLeft']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(harness.store.getSnapshot().path, [{ r: 0, c: 0 }]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 0,
  });
});

test('dom input adapter shows a held-only selection highlight for non-interactive confirm', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Path Interior',
      grid: ['...'],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 1,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 0, c: 0 } });
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 0, c: 1 } });
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 0, c: 2 } });
  harness.adapter.syncSnapshot();
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 1,
  });
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavPressing, true);
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelectionInteractive, false);

  harness.gridEl.dispatch('keyup', createKeyEvent('Enter'));
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(getLastBoardNavIntent(harness)?.payload || {}, 'isBoardNavPressing'),
    false,
  );
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelectionInteractive, null);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 1 });
});

test('dom input adapter finalizes a selected path tip when keyboard deselects it', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 0, c: 0 } });
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 0, c: 1 } });
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 1, c: 1 } });
  harness.store.dispatch({ type: GAME_COMMANDS.START_OR_STEP, payload: { r: 1, c: 0 } });
  harness.adapter.syncSnapshot();
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-start',
    r: 0,
    c: 0,
  });

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.equal(getLastGameCommandIntent(harness)?.payload.commandType, GAME_COMMANDS.FINALIZE_PATH);
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 1 },
    { r: 1, c: 0 },
  ]);
});

test('dom input adapter nudges board nav toward invalid keyboard moves only while held', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft'));
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavPressing, true);
  harness.flushNextRaf(16);
  harness.flushNextRaf(16);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavPressing, true);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardNavPreviewDelta, { r: 0, c: -1 });

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowLeft'));
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });
  assert.equal(
    Object.prototype.hasOwnProperty.call(getLastBoardNavIntent(harness)?.payload || {}, 'isBoardNavPressing'),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(getLastBoardNavIntent(harness)?.payload || {}, 'boardNavPreviewDelta'),
    false,
  );
});

test('dom input adapter previews movable wall placement before keyboard confirm and keeps selection after move', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Wall Move',
      grid: ['.m'],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 1,
      cols: 2,
      left: 0,
      top: 0,
      right: 40,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowRight']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'wall',
    r: 0,
    c: 1,
  });
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, true);
  assert.equal(getLastWallDragIntent(harness)?.payload.isWallDragging, false);
  assert.equal(getLastWallDragIntent(harness)?.payload.x, 20 + (20 * (2 / 3)));
  assert.equal(getLastWallDragIntent(harness)?.payload.y, 20 * (2 / 3));
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);

  tapDirectionalKeys(harness, ['ArrowLeft']);
  const previewSnapshot = harness.store.getSnapshot();
  assert.equal(previewSnapshot.gridData[0][0], '.');
  assert.equal(previewSnapshot.gridData[0][1], 'm');
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'wall',
    r: 0,
    c: 1,
  });
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, true);
  assert.equal(getLastWallDragIntent(harness)?.payload.isWallDragging, false);
  assert.equal(getLastWallDragIntent(harness)?.payload.x, 20 * (2 / 3));
  assert.equal(getLastWallDragIntent(harness)?.payload.y, 20 * (2 / 3));
  assert.deepEqual(getLastWallDropTargetIntent(harness)?.payload.dropTarget, { r: 0, c: 0 });

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  const movedSnapshot = harness.store.getSnapshot();
  assert.equal(movedSnapshot.gridData[0][0], 'm');
  assert.equal(movedSnapshot.gridData[0][1], '.');
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'wall',
    r: 0,
    c: 0,
  });
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, false);
  assert.equal(getLastWallDragIntent(harness)?.payload.isWallDragging, false);
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);

  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'wall',
    r: 0,
    c: 0,
  });
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 1 });
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, true);
  assert.deepEqual(getLastWallDropTargetIntent(harness)?.payload.dropTarget, { r: 0, c: 1 });
});

test('dom input adapter lets keyboard wall previews cross hint cells before confirming on a legal empty cell', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Hint Ring',
      grid: [
        '.....',
        '.ttt.',
        '.tmt.',
        '.ttt.',
        '.....',
      ],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 5,
      cols: 5,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  tapDirectionalKeys(harness, ['ArrowRight']);

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'wall',
    r: 2,
    c: 2,
  });
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, true);
  assert.equal(getLastWallDragIntent(harness)?.payload.x, 40 + (20 * (2 / 3)));
  assert.equal(getLastWallDragIntent(harness)?.payload.y, 40 + (20 * (2 / 3)));

  tapDirectionalKeys(harness, ['ArrowUp']);
  assert.equal(harness.store.getSnapshot().gridData[2][2], 'm');
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 1, c: 2 });
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, true);
  assert.equal(getLastWallDragIntent(harness)?.payload.x, 40 + (20 * (2 / 3)));
  assert.equal(getLastWallDragIntent(harness)?.payload.y, 20 + (20 * (2 / 3)));
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);

  tapDirectionalKeys(harness, ['ArrowUp']);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 2 });
  assert.deepEqual(getLastWallDropTargetIntent(harness)?.payload.dropTarget, { r: 0, c: 2 });

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  const movedSnapshot = harness.store.getSnapshot();
  assert.equal(movedSnapshot.gridData[0][2], 'm');
  assert.equal(movedSnapshot.gridData[2][2], '.');
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, false);
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'wall',
    r: 0,
    c: 2,
  });
});

test('dom input adapter cancels keyboard wall previews from source and invalid hint targets', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Wall Cancel',
      grid: ['.mt'],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 1,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowRight']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));

  assert.equal(harness.store.getSnapshot().gridData[0][1], 'm');
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, false);
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 2 });
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.equal(harness.store.getSnapshot().gridData[0][1], 'm');
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, false);
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);
});

test('dom input adapter clears keyboard wall previews on blur and controls disable', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Wall Blur',
      grid: ['.m.'],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 1,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowRight']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowLeft']);
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, true);
  assert.deepEqual(getLastWallDropTargetIntent(harness)?.payload.dropTarget, { r: 0, c: 0 });

  harness.gridEl.blur();
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, false);
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, false);

  harness.adapter.setKeyboardGamepadControlsEnabled(false);
  assert.equal(getLastWallDragIntent(harness)?.payload.visible, false);
  assert.equal(getLastWallDropTargetIntent(harness)?.payload.dropTarget, null);
});

test('dom input adapter does not snap the keyboard cursor to the last clicked cell', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Wall Click',
      grid: ['.m'],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 1,
      cols: 2,
      left: 0,
      top: 0,
      right: 40,
      bottom: 20,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });

  harness.gridEl.dispatch('pointerdown', createPointerEvent(1, 30, 10));
  harness.gridEl.dispatch('pointerup', createPointerEvent(1, 30, 10));

  assert.deepEqual(getLastBoardNavIntent(harness)?.payload, {
    updateType: INTERACTION_UPDATES.BOARD_NAV,
    isBoardNavActive: true,
    boardCursor: { r: 0, c: 0 },
    boardSelection: null,
    boardSelectionInteractive: null,
  });
});

test('dom input adapter emits board shortcut intents only from focused grid and escape remains global', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);

  globalThis.document.activeElement = harness.refs.levelSel;
  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowRight'));
  harness.flushAllRafs(16, 4);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });

  harness.gridEl.focus();
  harness.gridEl.dispatch('keydown', createKeyEvent('Backspace'));
  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.RESET_CLICK },
  });

  harness.gridEl.dispatch('keydown', createKeyEvent('r'));
  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.REVERSE_CLICK },
  });

  harness.store.dispatch({
    type: GAME_COMMANDS.LOAD_LEVEL,
    payload: { levelIndex: 1 },
  });
  harness.adapter.syncSnapshot();
  harness.gridEl.dispatch('keydown', createKeyEvent('PageUp'));
  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.LEVEL_SELECT, value: 0 },
  });

  harness.gridEl.dispatch('keydown', createKeyEvent('PageDown'));
  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.NEXT_LEVEL_CLICK },
  });

  harness.adapter.setKeyboardGamepadControlsEnabled(false);
  harness.documentTarget.dispatch('keydown', createKeyEvent('Escape'));
  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.DOCUMENT_ESCAPE },
  });
});

test('dom input adapter prevents browser scroll defaults for keyboard board controls even on no-op input', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  let arrowPrevented = false;
  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft', {
    preventDefault() {
      arrowPrevented = true;
    },
  }));

  let pagePrevented = false;
  harness.gridEl.dispatch('keydown', createKeyEvent('PageUp', {
    preventDefault() {
      pagePrevented = true;
    },
  }));

  assert.equal(arrowPrevented, true);
  assert.equal(pagePrevented, true);
});

test('dom input adapter hides board highlight when the board is not currently controllable', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);

  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, false);

  harness.gridEl.focus();
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, true);

  harness.gridEl.blur();
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, false);

  harness.setGamepads([createGamepad({ buttons: { 15: true } })]);
  harness.flushNextRaf(100);
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, true);

  globalThis.document.activeElement = harness.refs.levelSel;
  harness.documentTarget.dispatch('focusin', { target: harness.refs.levelSel });
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, false);

  harness.adapter.setBoardControlSuppressed(true);
  assert.equal(getLastBoardNavIntent(harness)?.payload.isBoardNavActive, false);
});

test('dom input adapter supports stitched diagonal keyboard movement from simultaneous axes', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Stitched Diagonal',
      grid: [
        '..',
        '..',
      ],
      stitches: [[1, 1]],
      cornerCounts: [],
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowDown', 'ArrowRight']);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 1,
    c: 1,
  });
});

test('dom input adapter replaces the last single-axis keyboard step with a stitched diagonal when the second axis arrives', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Delayed Stitched Diagonal',
      grid: [
        '..',
        '..',
      ],
      stitches: [[1, 1]],
      cornerCounts: [],
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowDown'));
  harness.flushAllRafs(16, 6);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 0 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowRight'));
  harness.flushAllRafs(32, 6);

  assert.equal(getLastGameCommandIntent(harness)?.payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.side, 'end');
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.steps, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 1,
    c: 1,
  });

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowRight'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowDown'));
});

test('dom input adapter replaces a delayed single-axis detour with diagonal backtrack at a stitch', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Delayed Stitched Diagonal Cancel',
      grid: [
        '..',
        '..',
      ],
      stitches: [[1, 1]],
      cornerCounts: [],
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowDown', 'ArrowRight']);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowUp'));
  harness.flushAllRafs(32, 6);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 0, c: 1 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft'));
  harness.flushAllRafs(48, 6);

  assert.equal(getLastGameCommandIntent(harness)?.payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.side, 'end');
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.steps, [
    { r: 1, c: 1 },
    { r: 0, c: 0 },
  ]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 0,
  });

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowLeft'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowUp'));
});

test('dom input adapter does not immediately step along a remaining axis after a stitched diagonal chord resolves', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Stitched Diagonal Release',
      grid: [
        '...',
        '...',
        '...',
      ],
      stitches: [[1, 1]],
      cornerCounts: [],
    },
    metrics: {
      rows: 3,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 60,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowDown'));
  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowRight'));
  harness.flushAllRafs(16, 6);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowRight'));
  harness.flushAllRafs(32, 6);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowDown'));
});

test('dom input adapter cancels a delayed retract and restores the intended stitched diagonal move', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Stitched Diagonal Retract Replace',
      grid: [
        '..',
        '..',
      ],
      stitches: [[1, 1]],
      cornerCounts: [],
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft'));
  harness.flushAllRafs(16, 6);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowDown'));
  harness.flushAllRafs(32, 6);

  assert.equal(getLastGameCommandIntent(harness)?.payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.side, 'end');
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.steps, [
    { r: 0, c: 1 },
    { r: 1, c: 0 },
  ]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 0 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 1,
    c: 0,
  });

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowDown'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowLeft'));
});

test('dom input adapter replaces a non-retracting delayed axis step with a later stitched diagonal when an earlier diagonal already exists', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Existing Diagonal Delayed Replace',
      grid: [
        '...',
        '...',
      ],
      stitches: [[1, 1], [1, 2]],
      cornerCounts: [],
    },
    metrics: {
      rows: 2,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 40,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowDown', 'ArrowRight']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowUp'));
  harness.flushAllRafs(16, 6);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 0, c: 2 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft'));
  harness.flushAllRafs(32, 6);

  assert.equal(getLastGameCommandIntent(harness)?.payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.side, 'end');
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.steps, [
    { r: 1, c: 2 },
    { r: 0, c: 1 },
  ]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 0, c: 1 },
  ]);

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowLeft'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowUp'));
});

test('dom input adapter can chain a delayed stitched diagonal after an existing diagonal crossing', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Existing Diagonal Chain',
      grid: [
        '...',
        '...',
        '...',
      ],
      stitches: [[1, 1], [2, 2]],
      cornerCounts: [],
    },
    metrics: {
      rows: 3,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 60,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowDown', 'ArrowRight']);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowDown'));
  harness.flushAllRafs(16, 6);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 2, c: 1 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowRight'));
  harness.flushAllRafs(32, 6);

  assert.equal(getLastGameCommandIntent(harness)?.payload.commandType, GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE);
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.side, 'end');
  assert.deepEqual(getLastGameCommandIntent(harness)?.payload.steps, [
    { r: 1, c: 1 },
    { r: 2, c: 2 },
  ]);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 2, c: 2 },
  ]);

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowRight'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowDown'));
});

test('dom input adapter treats a fresh diagonal chord after idle as a new move instead of replacing the previous tap', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Fresh Chord After Idle',
      grid: [
        '...',
        '...',
      ],
      stitches: [[1, 1], [1, 2]],
      cornerCounts: [],
    },
    metrics: {
      rows: 2,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 40,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  tapDirectionalKeys(harness, ['ArrowDown', 'ArrowRight']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  tapDirectionalKeys(harness, ['ArrowUp']);
  tapDirectionalKeys(harness, ['ArrowLeft']);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 0, c: 2 },
    { r: 0, c: 1 },
  ]);

  tapDirectionalKeys(harness, ['ArrowDown', 'ArrowLeft'], 96);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 0, c: 2 },
    { r: 0, c: 1 },
    { r: 1, c: 0 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 1,
    c: 0,
  });
});

test('dom input adapter splits an away-from-stitch diagonal chord into two normal moves', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Away From Stitch Chord',
      grid: [
        '...',
        '...',
        '...',
      ],
      stitches: [[2, 2]],
      cornerCounts: [],
    },
    metrics: {
      rows: 3,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 60,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 1, c: 1 },
  ]);

  tapDirectionalKeys(harness, ['ArrowUp', 'ArrowLeft'], 64);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 1, c: 1 },
    { r: 0, c: 1 },
    { r: 0, c: 0 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 0,
  });
});

test('dom input adapter splits a diagonal chord into two normal moves when no adjacent stitch is present', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'No Stitch Chord',
      grid: [
        '...',
        '...',
        '...',
      ],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 3,
      cols: 3,
      left: 0,
      top: 0,
      right: 60,
      bottom: 60,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));

  tapDirectionalKeys(harness, ['ArrowUp', 'ArrowLeft'], 80);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 1, c: 1 },
    { r: 0, c: 1 },
    { r: 0, c: 0 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 0,
    c: 0,
  });
});

test('dom input adapter does not replay an already-consumed axis when splitting a held non-stitched chord', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'No Stitch Held Chord',
      grid: [
        '....',
        '....',
        '....',
        '....',
      ],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 4,
      cols: 4,
      left: 0,
      top: 0,
      right: 80,
      bottom: 80,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  harness.gridEl.dispatch('keydown', createKeyEvent('Enter'));

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowUp'));
  harness.flushAllRafs(16, 6);
  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 2, c: 2 },
    { r: 1, c: 2 },
  ]);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft'));
  harness.flushAllRafs(32, 6);

  assert.deepEqual(harness.store.getSnapshot().path, [
    { r: 2, c: 2 },
    { r: 1, c: 2 },
    { r: 1, c: 1 },
  ]);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardSelection, {
    kind: 'path-end',
    r: 1,
    c: 1,
  });

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowLeft'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowUp'));
});

test('dom input adapter does not replay an already-consumed axis for free cursor movement when a held chord forms', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Free Cursor Held Chord',
      grid: [
        '....',
        '....',
        '....',
        '....',
      ],
      stitches: [],
      cornerCounts: [],
    },
    metrics: {
      rows: 4,
      cols: 4,
      left: 0,
      top: 0,
      right: 80,
      bottom: 80,
      size: 20,
      gap: 0,
      pad: 0,
      step: 20,
    },
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);
  harness.gridEl.focus();

  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowDown']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  tapDirectionalKeys(harness, ['ArrowRight']);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, {
    r: 2,
    c: 2,
  });
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowUp'));
  harness.flushAllRafs(16, 6);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, {
    r: 1,
    c: 2,
  });

  harness.gridEl.dispatch('keydown', createKeyEvent('ArrowLeft'));
  harness.flushAllRafs(32, 6);

  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, {
    r: 1,
    c: 1,
  });
  assert.equal(getLastBoardNavIntent(harness)?.payload.boardSelection, null);

  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowLeft'));
  harness.gridEl.dispatch('keyup', createKeyEvent('ArrowUp'));
});

test('dom input adapter polls standard gamepad movement with repeat timing and ignores ambiguous directions', (t) => {
  const harness = createGridHarness(t, {
    level: {
      name: 'Gamepad Line',
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
  });
  harness.adapter.setKeyboardGamepadControlsEnabled(true);

  harness.setGamepads([createGamepad({ buttons: { 15: true } })]);
  harness.flushNextRaf(100);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 1 });

  harness.flushNextRaf(250);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 1 });

  harness.flushNextRaf(281);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 2 });

  harness.setGamepads([createGamepad({ axes: [0.5, 0] })]);
  harness.flushNextRaf(400);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 2 });

  harness.setGamepads([createGamepad({ axes: [0.8, 0.8] })]);
  harness.flushNextRaf(500);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 2 });
});

test('dom input adapter ignores blocked or non-standard gamepads and edge-triggers gamepad buttons', (t) => {
  const harness = createGridHarness(t);
  harness.adapter.setKeyboardGamepadControlsEnabled(true);

  globalThis.document.activeElement = harness.refs.levelSel;
  harness.setGamepads([createGamepad({ buttons: { 15: true } })]);
  harness.flushNextRaf(100);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });

  globalThis.document.activeElement = globalThis.document.body;
  harness.setGamepads([createGamepad({ buttons: { 15: true }, mapping: '' })]);
  harness.flushNextRaf(200);
  assert.deepEqual(getLastBoardNavIntent(harness)?.payload.boardCursor, { r: 0, c: 0 });

  harness.setGamepads([createGamepad({ buttons: { 0: true } })]);
  harness.flushNextRaf(300);
  harness.flushNextRaf(400);
  assert.deepEqual(harness.store.getSnapshot().path, [{ r: 0, c: 0 }]);
  assert.equal(
    harness.emittedIntents.filter((intent) => (
      intent?.type === INTENT_TYPES.GAME_COMMAND
      && intent.payload?.commandType === GAME_COMMANDS.START_OR_STEP
    )).length,
    1,
  );
});

test('dom input adapter closes settings on outside pointerdown before click', (t) => {
  const harness = createGridHarness(t);

  harness.documentTarget.dispatch('pointerdown', { target: harness.gridEl });

  assert.deepEqual(harness.emittedIntents.at(-1), {
    type: INTENT_TYPES.UI_ACTION,
    payload: {
      actionType: UI_ACTIONS.SETTINGS_CLOSE,
    },
  });
});

test('dom input adapter ignores pointerdown within settings ui when deciding outside close', (t) => {
  const harness = createGridHarness(t);

  harness.documentTarget.dispatch('pointerdown', { target: harness.refs.settingsToggle });
  harness.documentTarget.dispatch('pointerdown', { target: harness.refs.settingsPanel });

  assert.equal(
    harness.emittedIntents.some((intent) => intent?.payload?.actionType === UI_ACTIONS.SETTINGS_CLOSE),
    false,
  );
});
