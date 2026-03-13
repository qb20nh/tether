import assert from 'node:assert/strict';
import test from '../test.ts';
import {
  VIEWPORT,
  __TEST__,
  runRenderDragBenchmarkSuite,
} from '../../scripts/lib/render_drag_browser_runner.ts';

const installBrowserLikeGlobals = (
  pathCells: Array<[number, number]>,
  { infiniteIndex, lowPowerEnabled }: { infiniteIndex: number; lowPowerEnabled: boolean },
) => {
  class FakeClassList {
    private readonly tokens = new Set<string>();

    add(...next: string[]) {
      for (const token of next) this.tokens.add(token);
    }

    remove(...next: string[]) {
      for (const token of next) this.tokens.delete(token);
    }

    contains(token: string): boolean {
      return this.tokens.has(token);
    }
  }

  class FakeElement {
    dataset: Record<string, string> = {};
    classList = new FakeClassList();
    firstElementChild: { textContent?: string } | null = null;
    constructor(
      public id = '',
      public rect = { left: 0, top: 0, width: 24, height: 24 },
    ) {}

    getBoundingClientRect() {
      return this.rect;
    }
  }

  class FakeCanvasElement extends FakeElement {
    getContext(name: string) {
      if (name !== 'webgl2') return null;
      return {
        isContextLost: () => false,
      };
    }
  }

  class FakeSelectElement extends FakeElement {
    value = String(infiniteIndex);
  }

  class FakeInputElement extends FakeElement {
    checked = lowPowerEnabled;
  }

  class FakePointerEvent {
    type: string;
    clientX: number;
    clientY: number;
    constructor(type: string, init: { clientX: number; clientY: number }) {
      this.type = type;
      this.clientX = init.clientX;
      this.clientY = init.clientY;
    }
  }

  const originalDocument = (globalThis as Record<string, unknown>).document;
  const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
  const originalPerformance = (globalThis as Record<string, unknown>).performance;
  const originalRequestAnimationFrame = (globalThis as Record<string, unknown>).requestAnimationFrame;
  const originalPointerEvent = (globalThis as Record<string, unknown>).PointerEvent;
  const originalElement = (globalThis as Record<string, unknown>).Element;
  const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
  const originalHTMLCanvasElement = (globalThis as Record<string, unknown>).HTMLCanvasElement;
  const originalHTMLSelectElement = (globalThis as Record<string, unknown>).HTMLSelectElement;
  const originalHTMLInputElement = (globalThis as Record<string, unknown>).HTMLInputElement;

  const localStorageData = new Map<string, string>();
  let now = 0;
  const cells = pathCells.map(([r, c], index) => {
    const cell = new FakeElement('', {
      left: 100 + (c * 30),
      top: 100 + (r * 30),
      width: 24,
      height: 24,
    });
    cell.dataset.r = String(r);
    cell.dataset.c = String(c);
    cell.firstElementChild = { textContent: String(index + 1) };
    return cell;
  });
  const visited: FakeElement[] = [];

  const updateVisitedClasses = () => {
    for (const cell of cells) {
      cell.classList.remove('visited', 'pathStart', 'pathEnd');
      cell.firstElementChild = null;
    }
    for (const [index, cell] of visited.entries()) {
      cell.classList.add('visited');
      if (index === 0) cell.classList.add('pathStart');
      if (index === (visited.length - 1)) cell.classList.add('pathEnd');
      cell.firstElementChild = { textContent: String(index + 1) };
    }
  };

  const resolveCellByPoint = (x: number, y: number): FakeElement | null => {
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      const cx = rect.left + (rect.width * 0.5);
      const cy = rect.top + (rect.height * 0.5);
      if (Math.abs(cx - x) < 1 && Math.abs(cy - y) < 1) {
        return cell;
      }
    }
    return null;
  };

  const grid = new FakeElement('grid');
  (grid as FakeElement & { dispatchEvent: (event: FakePointerEvent) => void }).dispatchEvent = (event: FakePointerEvent) => {
    const cell = resolveCellByPoint(event.clientX, event.clientY);
    if (!cell) return;
    if (event.type === 'pointerdown') {
      visited.splice(0, visited.length, cell);
    } else if (!visited.includes(cell)) {
      visited.push(cell);
    }
    updateVisitedClasses();
  };

  const pathCanvas = new FakeCanvasElement('pathCanvas');
  const infiniteSel = new FakeSelectElement('infiniteSel');
  const lowPowerToggle = new FakeInputElement('lowPowerToggle');

  const documentMock = {
    getElementById(id: string) {
      if (id === 'grid') return grid;
      if (id === 'pathCanvas') return pathCanvas;
      if (id === 'infiniteSel') return infiniteSel;
      if (id === 'lowPowerToggle') return lowPowerToggle;
      return null;
    },
    querySelector(selector: string) {
      const match = /#grid \.cell\[data-r="(\d+)"\]\[data-c="(\d+)"\]/.exec(selector);
      if (!match) return null;
      return cells.find((cell) => cell.dataset.r === match[1] && cell.dataset.c === match[2]) ?? null;
    },
    querySelectorAll(selector: string) {
      if (selector === '#grid .cell.visited') return visited.slice();
      return [];
    },
  };

  (globalThis as Record<string, unknown>).document = documentMock;
  (globalThis as Record<string, unknown>).localStorage = {
    clear: () => localStorageData.clear(),
    setItem: (key: string, value: string) => {
      localStorageData.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageData.delete(key);
    },
  };
  (globalThis as Record<string, unknown>).performance = {
    now: () => {
      now += 1;
      return now;
    },
  };
  (globalThis as Record<string, unknown>).requestAnimationFrame = (callback: (timestamp: number) => void) => {
    now += 16;
    callback(now);
    return 1;
  };
  (globalThis as Record<string, unknown>).PointerEvent = FakePointerEvent;
  (globalThis as Record<string, unknown>).Element = FakeElement;
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
  (globalThis as Record<string, unknown>).HTMLCanvasElement = FakeCanvasElement;
  (globalThis as Record<string, unknown>).HTMLSelectElement = FakeSelectElement;
  (globalThis as Record<string, unknown>).HTMLInputElement = FakeInputElement;

  return {
    restore() {
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).requestAnimationFrame = originalRequestAnimationFrame;
      (globalThis as Record<string, unknown>).PointerEvent = originalPointerEvent;
      (globalThis as Record<string, unknown>).Element = originalElement;
      (globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
      (globalThis as Record<string, unknown>).HTMLCanvasElement = originalHTMLCanvasElement;
      (globalThis as Record<string, unknown>).HTMLSelectElement = originalHTMLSelectElement;
      (globalThis as Record<string, unknown>).HTMLInputElement = originalHTMLInputElement;
    },
  };
};

test('render drag browser runner helpers summarize case metrics', () => {
  const summary = __TEST__.summarizeCases([
    {
      caseId: 'a',
      infiniteIndex: 1,
      revision: 'rev-a',
      mode: 'normal',
      pathCells: [[0, 0], [0, 1]],
      actualPathCells: [[0, 0], [0, 1]],
      pointerMoveCount: 4,
      pathStepCount: 1,
      totalSyncDispatchMs: 8,
      totalToNextRafMs: 12,
      syncMsPerPointerMove: 2,
      rafMsPerPointerMove: 3,
      totalMsPerPathStep: 12,
      dragWallClockMs: 14,
      moveMetrics: [],
      hasPathStartClass: true,
      hasPathEndClass: true,
      hasWebgl2: true,
      isContextLost: false,
    },
    {
      caseId: 'b',
      infiniteIndex: 2,
      revision: 'rev-a',
      mode: 'normal',
      pathCells: [[1, 1], [1, 2], [1, 3]],
      actualPathCells: [[1, 1], [1, 2], [1, 3]],
      pointerMoveCount: 6,
      pathStepCount: 2,
      totalSyncDispatchMs: 18,
      totalToNextRafMs: 30,
      syncMsPerPointerMove: 3,
      rafMsPerPointerMove: 5,
      totalMsPerPathStep: 15,
      dragWallClockMs: 18,
      moveMetrics: [],
      hasPathStartClass: true,
      hasPathEndClass: true,
      hasWebgl2: true,
      isContextLost: false,
    },
  ]);

  assert.equal(summary.caseCount, 2);
  assert.equal(summary.totalPointerMoves, 10);
  assert.equal(summary.totalPathSteps, 3);
  assert.equal(summary.syncMsPerPointerMove.median, 2);
  assert.equal(summary.rafMsPerPointerMove.median, 3);
});

test('runRenderDragBenchmarkSuite rejects invalid browser inputs and modes', async () => {
  await assert.rejects(
    runRenderDragBenchmarkSuite({
      browser: null as never,
      baseUrl: 'http://example.test/',
      workload: { version: 1, seed: 'test', cases: [], pointerMovesPerSegment: 2 },
      revisionLabel: 'rev-a',
      mode: 'normal',
    }),
    /requires a Playwright browser instance/,
  );

  const browser = {
    newContext: async () => ({
      newPage: async () => ({
        on() {},
        close: async () => {},
      }),
      close: async () => {},
    }),
  };

  await assert.rejects(
    runRenderDragBenchmarkSuite({
      browser: browser as never,
      baseUrl: 'http://example.test/',
      workload: { version: 1, seed: 'test', cases: [], pointerMovesPerSegment: 2 },
      revisionLabel: 'rev-a',
      mode: 'unsupported' as never,
    }),
    /Unsupported benchmark mode/,
  );
});

test('runRenderDragBenchmarkSuite executes a mocked browser workflow and returns aggregated results', async () => {
  let evaluateCall = 0;
  let pageClosed = false;
  let contextClosed = false;

  const caseResult = {
    caseId: 'case-1',
    infiniteIndex: 3,
    revision: 'candidate',
    mode: 'low-power',
    pathCells: [[0, 0], [0, 1], [1, 1]] as Array<[number, number]>,
    actualPathCells: [[0, 0], [0, 1], [1, 1]] as Array<[number, number]>,
    pointerMoveCount: 6,
    pathStepCount: 2,
    totalSyncDispatchMs: 12,
    totalToNextRafMs: 24,
    syncMsPerPointerMove: 2,
    rafMsPerPointerMove: 4,
    totalMsPerPathStep: 12,
    dragWallClockMs: 30,
    moveMetrics: [],
    hasPathStartClass: true,
    hasPathEndClass: true,
    hasWebgl2: true,
    isContextLost: false,
  };

  const page = {
    on(_event: string, _handler: (value: unknown) => void) {},
    goto: async (baseUrl: string, options: Record<string, unknown>) => {
      assert.equal(baseUrl, 'http://127.0.0.1:4274/');
      assert.equal(options.waitUntil, 'domcontentloaded');
    },
    reload: async () => {},
    waitForSelector: async () => {},
    waitForFunction: async () => {},
    evaluate: async () => {
      evaluateCall += 1;
      if (evaluateCall === 1) return undefined;
      if (evaluateCall === 2) {
        return {
          hasCanvas: true,
          hasGrid: true,
          hasWebgl2: true,
          isContextLost: false,
        };
      }
      if (evaluateCall === 3) return undefined;
      if (evaluateCall === 4) return caseResult;
      throw new Error(`Unexpected evaluate call ${evaluateCall}`);
    },
    close: async () => {
      pageClosed = true;
    },
  };

  const context = {
    newPage: async () => page,
    close: async () => {
      contextClosed = true;
    },
  };

  const browser = {
    newContext: async (options: Record<string, unknown>) => {
      assert.deepEqual(options, {
        viewport: VIEWPORT,
        serviceWorkers: 'block',
      });
      return context;
    },
  };

  const result = await runRenderDragBenchmarkSuite({
    browser: browser as never,
    baseUrl: 'http://127.0.0.1:4274/',
    workload: {
      version: 1,
      seed: 'candidate-seed',
      pointerMovesPerSegment: 3,
      cases: [{
        caseId: 'case-1',
        infiniteIndex: 3,
        pathCells: [[0, 0], [0, 1], [1, 1]],
      }],
    },
    revisionLabel: 'candidate',
    mode: 'low-power',
    repeatIndex: 2,
  });

  assert.equal(result.revision, 'candidate');
  assert.equal(result.mode, 'low-power');
  assert.equal(result.repeatIndex, 2);
  assert.equal(result.caseResults.length, 1);
  assert.equal(result.aggregate.caseCount, 1);
  assert.equal(result.aggregate.totalPointerMoves, 6);
  assert.equal(result.aggregate.totalPathSteps, 2);
  assert.equal(result.aggregate.syncMsPerPointerMove.median, 2);
  assert.equal(result.aggregate.rafMsPerPointerMove.median, 4);
  assert.equal(pageClosed, true);
  assert.equal(contextClosed, true);
});

test('runRenderDragBenchmarkSuite can execute the in-page benchmark callbacks against a fake DOM', async (t) => {
  const globals = installBrowserLikeGlobals([[0, 0], [0, 1], [1, 1]], {
    infiniteIndex: 7,
    lowPowerEnabled: false,
  });
  t.after(() => {
    globals.restore();
  });

  let pageClosed = false;
  let contextClosed = false;
  const page = {
    on(_event: string, _handler: (value: unknown) => void) {},
    goto: async () => {},
    reload: async () => {},
    waitForSelector: async () => {},
    waitForFunction: async (
      callback: (arg: { infiniteIndex: number; lowPowerEnabled: boolean }) => boolean,
      arg: { infiniteIndex: number; lowPowerEnabled: boolean },
    ) => {
      assert.equal(callback(arg), true);
    },
    evaluate: async <TArg, TResult>(callback: (arg: TArg) => TResult | Promise<TResult>, arg: TArg) => callback(arg),
    close: async () => {
      pageClosed = true;
    },
  };
  const context = {
    newPage: async () => page,
    close: async () => {
      contextClosed = true;
    },
  };
  const browser = {
    newContext: async () => context,
  };

  const result = await runRenderDragBenchmarkSuite({
    browser: browser as never,
    baseUrl: 'http://127.0.0.1:4274/',
    workload: {
      version: 1,
      seed: 'dom-seed',
      pointerMovesPerSegment: 1,
      cases: [{
        caseId: 'case-dom',
        infiniteIndex: 7,
        pathCells: [[0, 0], [0, 1], [1, 1]],
      }],
    },
    revisionLabel: 'rev-dom',
    mode: 'normal',
  });

  assert.equal(result.caseResults.length, 1);
  assert.deepEqual(result.caseResults[0].actualPathCells, [[0, 0], [0, 1], [1, 1]]);
  assert.equal(result.caseResults[0].hasPathStartClass, true);
  assert.equal(result.caseResults[0].hasPathEndClass, true);
  assert.equal(pageClosed, true);
  assert.equal(contextClosed, true);
});
