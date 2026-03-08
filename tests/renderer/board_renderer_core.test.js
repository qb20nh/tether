import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardRendererCore } from '../../src/renderer/board_renderer_core.js';

class FakeStyle {
  constructor() {
    this.values = new Map();
    this.width = '';
    this.height = '';
    this.display = '';
    this.left = '';
    this.top = '';
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) || '';
  }

  removeProperty(name) {
    this.values.delete(name);
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.tokens = new Set();
  }

  setFromString(value) {
    this.tokens = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.owner._className = [...this.tokens].join(' ');
  }

  add(...values) {
    values.forEach((value) => {
      if (value) this.tokens.add(value);
    });
    this.owner._className = [...this.tokens].join(' ');
  }

  remove(...values) {
    values.forEach((value) => this.tokens.delete(value));
    this.owner._className = [...this.tokens].join(' ');
  }

  contains(value) {
    return this.tokens.has(value);
  }

  toggle(value, force) {
    const shouldHave = force === undefined ? !this.tokens.has(value) : Boolean(force);
    if (shouldHave) this.tokens.add(value);
    else this.tokens.delete(value);
    this.owner._className = [...this.tokens].join(' ');
    return shouldHave;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.id = '';
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.style = new FakeStyle();
    this._className = '';
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.clientWidth = 240;
    this.clientHeight = 240;
    this.clientLeft = 0;
    this.clientTop = 0;
    this._rect = {
      left: 0,
      top: 0,
      width: this.clientWidth,
      height: this.clientHeight,
    };
    this._innerHTML = '';
    this._context2d = null;
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this.classList.setFromString(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    if (this._innerHTML === '') {
      this.children = [];
    }
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] || null : null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  setBoundingClientRect(rect = {}) {
    this._rect = {
      left: Number(rect.left) || 0,
      top: Number(rect.top) || 0,
      width: Number(rect.width) || this.clientWidth,
      height: Number(rect.height) || this.clientHeight,
    };
    this.clientWidth = this._rect.width;
    this.clientHeight = this._rect.height;
  }

  getBoundingClientRect() {
    return {
      left: this._rect.left,
      top: this._rect.top,
      width: this._rect.width,
      height: this._rect.height,
      right: this._rect.left + this._rect.width,
      bottom: this._rect.top + this._rect.height,
    };
  }

  matches(selector) {
    if (selector === ':active' || selector === ':hover') return false;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return false;
  }

  querySelector(selector) {
    const stack = [...this.children];
    while (stack.length > 0) {
      const node = stack.shift();
      if (node?.matches(selector)) return node;
      if (Array.isArray(node?.children) && node.children.length > 0) {
        stack.unshift(...node.children);
      }
    }
    return null;
  }

  getContext(type) {
    if (this.tagName !== 'CANVAS' || type !== '2d') return null;
    if (!this._context2d) {
      let fillStyle = '#000000';
      let strokeStyle = '#000000';
      let lineWidth = 1;
      let font = '';
      let textAlign = 'left';
      let textBaseline = 'alphabetic';
      let globalAlpha = 1;
      let imageSmoothingEnabled = true;
      let shadowColor = '';
      let shadowBlur = 0;
      let lineCap = 'butt';
      let lineJoin = 'miter';
      this._context2d = {
        get fillStyle() {
          return fillStyle;
        },
        set fillStyle(value) {
          fillStyle = String(value || '');
        },
        get strokeStyle() {
          return strokeStyle;
        },
        set strokeStyle(value) {
          strokeStyle = String(value || '');
        },
        get lineWidth() {
          return lineWidth;
        },
        set lineWidth(value) {
          lineWidth = Number(value) || 0;
        },
        get font() {
          return font;
        },
        set font(value) {
          font = String(value || '');
        },
        get textAlign() {
          return textAlign;
        },
        set textAlign(value) {
          textAlign = String(value || '');
        },
        get textBaseline() {
          return textBaseline;
        },
        set textBaseline(value) {
          textBaseline = String(value || '');
        },
        get globalAlpha() {
          return globalAlpha;
        },
        set globalAlpha(value) {
          globalAlpha = Number(value) || 0;
        },
        get imageSmoothingEnabled() {
          return imageSmoothingEnabled;
        },
        set imageSmoothingEnabled(value) {
          imageSmoothingEnabled = Boolean(value);
        },
        get shadowColor() {
          return shadowColor;
        },
        set shadowColor(value) {
          shadowColor = String(value || '');
        },
        get shadowBlur() {
          return shadowBlur;
        },
        set shadowBlur(value) {
          shadowBlur = Number(value) || 0;
        },
        get lineCap() {
          return lineCap;
        },
        set lineCap(value) {
          lineCap = String(value || '');
        },
        get lineJoin() {
          return lineJoin;
        },
        set lineJoin(value) {
          lineJoin = String(value || '');
        },
        save() {},
        restore() {},
        setTransform() {},
        getTransform() {
          return { a: 1, d: 1 };
        },
        clearRect() {},
        beginPath() {},
        arc() {},
        stroke() {},
        fill() {},
        moveTo() {},
        lineTo() {},
        fillText() {},
      };
    }
    return this._context2d;
  }
}

const createComputedStyle = (element) => ({
  getPropertyValue(name) {
    return element?.style?.getPropertyValue(name) || '';
  },
  get columnGap() {
    return element?.style?.getPropertyValue('--gap') || '0px';
  },
  get gap() {
    return element?.style?.getPropertyValue('--gap') || '0px';
  },
  get paddingLeft() {
    return element?.style?.getPropertyValue('padding-left') || '0px';
  },
  get paddingRight() {
    return element?.style?.getPropertyValue('padding-right') || '0px';
  },
  get paddingTop() {
    return element?.style?.getPropertyValue('padding-top') || '0px';
  },
  get paddingBottom() {
    return element?.style?.getPropertyValue('padding-bottom') || '0px';
  },
  get borderLeftWidth() {
    return element?.style?.getPropertyValue('border-left-width') || '0px';
  },
  get borderRightWidth() {
    return element?.style?.getPropertyValue('border-right-width') || '0px';
  },
});

const installRendererEnv = (t) => {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalPerformance = globalThis.performance;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  const rafCallbacks = new Map();
  let nextRafId = 1;

  const documentElement = new FakeElement('html');
  documentElement.clientWidth = 1280;
  documentElement.clientHeight = 720;

  globalThis.Element = FakeElement;
  globalThis.document = {
    body: new FakeElement('body'),
    documentElement,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    visualViewport: null,
    matchMedia() {
      return { matches: false };
    },
  };
  globalThis.getComputedStyle = (element) => createComputedStyle(element);
  globalThis.performance = {
    now() {
      return 100;
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
  };

  t.after(() => {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.performance = originalPerformance;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  return { rafCallbacks };
};

const flushNextRaf = (env, timestamp = 16) => {
  const nextEntry = env.rafCallbacks.entries().next().value;
  if (!nextEntry) return false;
  const [id, callback] = nextEntry;
  env.rafCallbacks.delete(id);
  callback(timestamp);
  return true;
};

const createFakePathRenderer = () => ({
  calls: [],
  destroyed: false,
  resizeCalls: [],
  drawPathFrame(payload) {
    this.calls.push({
      flowOffset: payload.flowOffset,
      geometryToken: payload.geometryToken,
      pointCount: Array.isArray(payload.points) ? payload.points.length : 0,
    });
    return 64;
  },
  resize(width, height, dpr) {
    this.resizeCalls.push({ width, height, dpr });
  },
  destroy() {
    this.destroyed = true;
  },
});

const createShellRefs = () => {
  const app = new FakeElement('div');
  app.clientWidth = 960;
  app.style.setProperty('padding-left', '0px');
  app.style.setProperty('padding-right', '0px');
  app.style.setProperty('padding-top', '0px');
  app.style.setProperty('padding-bottom', '0px');
  app.style.setProperty('--ui-reserve', '0px');

  const boardHost = new FakeElement('div');
  boardHost.clientWidth = 960;
  boardHost.style.setProperty('padding-left', '0px');
  boardHost.style.setProperty('padding-right', '0px');

  const boardWrap = new FakeElement('div');
  boardWrap.clientWidth = 240;
  boardWrap.clientHeight = 240;
  boardWrap.style.setProperty('--gap', '0px');
  boardWrap.setBoundingClientRect({ left: 10, top: 20, width: 240, height: 240 });
  boardHost.appendChild(boardWrap);

  const gridEl = new FakeElement('div');
  gridEl.id = 'grid';
  gridEl.clientWidth = 240;
  gridEl.clientHeight = 240;
  gridEl.style.setProperty('--gap', '0px');
  gridEl.style.setProperty('padding-left', '0px');
  gridEl.style.setProperty('padding-right', '0px');
  gridEl.style.setProperty('padding-top', '0px');
  gridEl.style.setProperty('padding-bottom', '0px');
  gridEl.setBoundingClientRect({ left: 10, top: 20, width: 240, height: 240 });
  boardWrap.appendChild(gridEl);

  const canvas = new FakeElement('canvas');
  canvas.clientWidth = 240;
  canvas.clientHeight = 240;
  boardWrap.appendChild(canvas);

  const symbolCanvas = new FakeElement('canvas');
  symbolCanvas.clientWidth = 240;
  symbolCanvas.clientHeight = 240;
  boardWrap.appendChild(symbolCanvas);

  return {
    app,
    boardWrap,
    canvas,
    gridEl,
    symbolCanvas,
    symbolCtx: symbolCanvas.getContext('2d'),
    msgEl: new FakeElement('div'),
    legend: new FakeElement('div'),
    pathRenderer: createFakePathRenderer(),
  };
};

const createSnapshot = ({ gridData, path = [], levelIndex = 0 }) => {
  const rows = gridData.length;
  const cols = gridData[0].length;
  const visited = new Set(path.map((point) => `${point.r},${point.c}`));
  const idxByKey = new Map(path.map((point, index) => [`${point.r},${point.c}`, index]));
  const totalUsable = gridData.flat().filter((cell) => cell !== '#' && cell !== 'm').length;
  return {
    levelIndex,
    rows,
    cols,
    gridData,
    path,
    visited,
    idxByKey,
    stitches: [],
    cornerCounts: [],
    totalUsable,
  };
};

const getGridCell = (refs, r, c, cols) => refs.gridEl.children[(r * cols) + c] || null;

test('createBoardRendererCore keeps refs, interaction state, and ghosts isolated per instance', (t) => {
  const env = installRendererEnv(t);
  const gridData = [
    ['.', '.'],
    ['.', '.'],
  ];
  const snapshot = createSnapshot({ gridData });
  const first = createBoardRendererCore();
  const second = createBoardRendererCore();
  const firstRefs = createShellRefs();
  const secondRefs = createShellRefs();

  first.mount(firstRefs);
  second.mount(secondRefs);
  first.rebuildGrid(snapshot);
  second.rebuildGrid(snapshot);

  first.updateInteraction({
    dropTarget: { r: 1, c: 1 },
    wallGhost: { visible: true, x: 80, y: 96 },
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 1 },
  });

  second.updateInteraction({
    dropTarget: { r: 0, c: 0 },
    isPathDragging: true,
    pathDragCursor: { r: 1, c: 0 },
  });
  flushNextRaf(env, 16);
  flushNextRaf(env, 16);

  const firstDropTarget = getGridCell(firstRefs, 1, 1, 2);
  const secondDropTarget = getGridCell(secondRefs, 0, 0, 2);
  const firstHover = getGridCell(firstRefs, 0, 1, 2);
  const secondHover = getGridCell(secondRefs, 1, 0, 2);

  assert.equal(first.getRefs(), firstRefs);
  assert.equal(second.getRefs(), secondRefs);
  assert.equal(firstDropTarget.classList.contains('dropTarget'), true);
  assert.equal(secondDropTarget.classList.contains('dropTarget'), true);
  assert.equal(getGridCell(firstRefs, 0, 0, 2).classList.contains('dropTarget'), false);
  assert.equal(getGridCell(secondRefs, 1, 1, 2).classList.contains('dropTarget'), false);
  assert.equal(firstHover.classList.contains('pathTipDragHover'), true);
  assert.equal(secondHover.classList.contains('pathTipDragHover'), true);
  assert.equal(firstRefs.boardWrap.querySelector('.wallDragGhost') !== null, true);
  assert.equal(secondRefs.boardWrap.querySelector('.wallDragGhost'), null);
});

test('createBoardRendererCore does not share transition compensation state across instances', (t) => {
  const env = installRendererEnv(t);
  const gridData = [['.', '.', '.', '.']];
  const previousSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ],
  });
  const nextSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 0, c: 3 },
    ],
  });
  const first = createBoardRendererCore();
  const second = createBoardRendererCore();
  const firstRefs = createShellRefs();
  const secondRefs = createShellRefs();

  first.mount(firstRefs);
  second.mount(secondRefs);
  first.rebuildGrid(previousSnapshot);
  second.rebuildGrid(previousSnapshot);

  first.recordPathTransition(previousSnapshot, nextSnapshot);
  first.renderFrame({
    snapshot: nextSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {},
  });
  second.renderFrame({
    snapshot: nextSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {},
  });
  flushNextRaf(env, 16);
  flushNextRaf(env, 16);

  assert.equal(firstRefs.pathRenderer.calls.length > 0, true);
  assert.equal(secondRefs.pathRenderer.calls.length > 0, true);
  assert.notEqual(firstRefs.pathRenderer.calls.at(-1).flowOffset, 0);
  assert.equal(secondRefs.pathRenderer.calls.at(-1).flowOffset, 0);
});

test('createBoardRendererCore destroy clears animation and remount starts clean', (t) => {
  const env = installRendererEnv(t);
  const gridData = [['.', '.']];
  const snapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ],
  });
  const core = createBoardRendererCore();
  const firstRefs = createShellRefs();

  core.mount(firstRefs);
  core.rebuildGrid(snapshot);
  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {},
  });
  core.updateInteraction({
    dropTarget: { r: 0, c: 1 },
    wallGhost: { visible: true, x: 30, y: 42 },
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  });

  assert.equal(env.rafCallbacks.size > 0, true);
  assert.equal(firstRefs.boardWrap.querySelector('.wallDragGhost') !== null, true);

  core.destroy();

  assert.equal(env.rafCallbacks.size, 0);
  assert.equal(core.getRefs(), null);
  assert.equal(firstRefs.pathRenderer.destroyed, true);
  assert.equal(firstRefs.boardWrap.querySelector('.wallDragGhost'), null);
  assert.equal(getGridCell(firstRefs, 0, 1, 2).classList.contains('dropTarget'), false);
  assert.equal(getGridCell(firstRefs, 0, 0, 2).classList.contains('pathTipDragHover'), false);

  const secondRefs = createShellRefs();
  core.mount(secondRefs);
  core.rebuildGrid(snapshot);
  core.updateInteraction({});

  assert.equal(core.getRefs(), secondRefs);
  assert.equal(getGridCell(secondRefs, 0, 0, 2).classList.contains('pathTipDragHover'), false);
  assert.equal(getGridCell(secondRefs, 0, 1, 2).classList.contains('dropTarget'), false);
});

test('createBoardRendererCore applies incremental path patches for end/start batches and mixed endpoint turns', (t) => {
  const env = installRendererEnv(t);
  const counters = {};
  const gridData = [['.', '.', '.', '.'], ['.', '.', '.', '.']];
  const core = createBoardRendererCore({ debugCounters: counters });
  const refs = createShellRefs();
  const baseSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ],
  });
  const endExtendedSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 0, c: 3 },
    ],
  });
  const startExtendedSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 0, c: 3 },
    ],
  });
  const endTurnedSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 1 },
    ],
  });
  const endUnturnedTurnedSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ],
  });
  const startTurnedSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 1, c: 1 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ],
  });
  const startUnturnedTurnedSnapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ],
  });

  core.mount(refs);
  core.rebuildGrid(baseSnapshot);
  core.renderFrame({
    snapshot: baseSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 2 },
    },
  });
  flushNextRaf(env, 16);

  const initialFullRebuilds = counters.fullCellRebuilds || 0;
  assert.equal(initialFullRebuilds > 0, true);

  core.renderFrame({
    snapshot: endExtendedSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 3 },
    },
  });
  flushNextRaf(env, 32);

  assert.equal(counters.fullCellRebuilds, initialFullRebuilds);
  assert.equal((counters.incrementalCellPatches || 0) >= 1, true);
  assert.equal(getGridCell(refs, 0, 3, 4).classList.contains('pathEnd'), true);
  assert.equal(getGridCell(refs, 0, 3, 4).firstElementChild.textContent, '3');

  core.renderFrame({
    snapshot: startExtendedSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'start',
      pathDragCursor: { r: 0, c: 0 },
    },
  });
  flushNextRaf(env, 48);

  assert.equal(counters.fullCellRebuilds, initialFullRebuilds);
  assert.equal((counters.incrementalCellPatches || 0) >= 2, true);
  assert.equal(getGridCell(refs, 0, 0, 4).classList.contains('pathStart'), true);
  assert.equal(getGridCell(refs, 0, 3, 4).classList.contains('pathEnd'), true);
  assert.equal(getGridCell(refs, 0, 1, 4).firstElementChild.textContent, '2');

  core.renderFrame({
    snapshot: endTurnedSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 1, c: 1 },
    },
  });
  flushNextRaf(env, 64);

  const mixedFullRebuilds = counters.fullCellRebuilds;

  core.renderFrame({
    snapshot: endUnturnedTurnedSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 2 },
    },
  });
  flushNextRaf(env, 80);

  assert.equal(counters.fullCellRebuilds, mixedFullRebuilds);
  assert.equal((counters.incrementalCellPatches || 0) >= 3, true);
  assert.equal(getGridCell(refs, 0, 2, 4).classList.contains('pathEnd'), true);

  core.renderFrame({
    snapshot: startTurnedSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'start',
      pathDragCursor: { r: 1, c: 1 },
    },
  });
  flushNextRaf(env, 96);

  const mixedStartFullRebuilds = counters.fullCellRebuilds;

  core.renderFrame({
    snapshot: startUnturnedTurnedSnapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'start',
      pathDragCursor: { r: 0, c: 0 },
    },
  });
  flushNextRaf(env, 112);

  assert.equal(counters.fullCellRebuilds, mixedStartFullRebuilds);
  assert.equal((counters.incrementalCellPatches || 0) >= 4, true);
  assert.equal(getGridCell(refs, 0, 0, 4).classList.contains('pathStart'), true);
});

test('createBoardRendererCore performs one heavy render per RAF and skips symbol redraws on animation-only frames', (t) => {
  const env = installRendererEnv(t);
  const counters = {};
  const gridData = [['.', '.']];
  const snapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ],
  });
  const core = createBoardRendererCore({ debugCounters: counters });
  const refs = createShellRefs();

  core.mount(refs);
  core.rebuildGrid(snapshot);
  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {},
  });
  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {},
  });
  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {},
  });

  assert.equal(env.rafCallbacks.size, 1);
  flushNextRaf(env, 16);
  assert.equal(counters.heavyFrameRenders, 1);
  assert.equal(counters.symbolRedraws, 1);
  assert.equal((counters.pathDraws || 0) >= 1, true);

  flushNextRaf(env, 32);
  assert.equal(counters.heavyFrameRenders, 1);
  assert.equal(counters.symbolRedraws, 1);
  assert.equal((counters.pathDraws || 0) >= 2, true);
});

test('createBoardRendererCore does not rewrite message DOM when message content is unchanged', (t) => {
  const env = installRendererEnv(t);
  const gridData = [['.', '.']];
  const snapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ],
  });
  const core = createBoardRendererCore();
  const refs = createShellRefs();
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(FakeElement.prototype, 'innerHTML');
  let messageHtmlWrites = 0;
  let messageClassAdds = 0;
  let messageClassRemoves = 0;

  Object.defineProperty(refs.msgEl, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      messageHtmlWrites += 1;
      innerHtmlDescriptor.set.call(this, value);
    },
  });
  const originalAdd = refs.msgEl.classList.add.bind(refs.msgEl.classList);
  const originalRemove = refs.msgEl.classList.remove.bind(refs.msgEl.classList);
  refs.msgEl.classList.add = (...values) => {
    messageClassAdds += 1;
    return originalAdd(...values);
  };
  refs.msgEl.classList.remove = (...values) => {
    messageClassRemoves += 1;
    return originalRemove(...values);
  };

  core.mount(refs);
  core.rebuildGrid(snapshot);
  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {
      messageKind: 'good',
      messageHtml: '<strong>stable</strong>',
    },
    interactionModel: {},
  });
  flushNextRaf(env, 16);

  assert.equal(messageHtmlWrites, 1);
  assert.equal(messageClassAdds, 1);
  assert.equal(messageClassRemoves, 0);

  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {
      messageKind: 'good',
      messageHtml: '<strong>stable</strong>',
    },
    interactionModel: {},
  });
  flushNextRaf(env, 32);

  assert.equal(messageHtmlWrites, 1);
  assert.equal(messageClassAdds, 1);
  assert.equal(messageClassRemoves, 0);
});

test('createBoardRendererCore keeps path flow moving across consecutive state render frames', (t) => {
  const env = installRendererEnv(t);
  const gridData = [['.', '.']];
  const snapshot = createSnapshot({
    gridData,
    path: [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ],
  });
  const core = createBoardRendererCore();
  const refs = createShellRefs();

  core.mount(refs);
  core.rebuildGrid(snapshot);

  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 1 },
    },
  });
  flushNextRaf(env, 16);
  const firstFlowOffset = refs.pathRenderer.calls.at(-1)?.flowOffset ?? 0;

  core.renderFrame({
    snapshot,
    evaluation: {},
    completion: null,
    uiModel: {},
    interactionModel: {
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 0, c: 1 },
    },
  });
  flushNextRaf(env, 32);
  const secondFlowOffset = refs.pathRenderer.calls.at(-1)?.flowOffset ?? 0;

  assert.equal(firstFlowOffset, 0);
  assert.equal(secondFlowOffset > firstFlowOffset, true);
});
