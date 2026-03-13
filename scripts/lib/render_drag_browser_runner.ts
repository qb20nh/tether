import type { Browser, Page } from 'playwright';
import type { GridTuple } from '../../src/contracts/ports.ts';
import type { RenderDragPathCase, RenderDragWorkload } from './render_drag_workload.ts';
import { buildMetricSummary, mean, pathsEqual, percentile } from './stats.ts';

const STORAGE_KEYS = Object.freeze({
  levelProgress: 'tetherLevelProgress',
  infiniteProgress: 'tetherInfiniteProgress',
  lowPowerMode: 'tetherLowPowerMode',
  theme: 'tetherTheme',
  sessionSave: 'tetherSessionSave',
  dailySolved: 'tetherDailySolved',
  scoreState: 'tetherScoreState',
  guideHidden: 'tetherGuideHidden',
  legendHidden: 'tetherLegendHidden',
});

const LEVEL_PROGRESS_VERSION = 1;
const INFINITE_PROGRESS_VERSION = 1;
export const VIEWPORT = Object.freeze({
  width: 1200,
  height: 860,
});

export type BenchmarkMode = 'normal' | 'low-power';

const MODE_TO_LOW_POWER: Readonly<Record<BenchmarkMode, boolean>> = Object.freeze({
  normal: false,
  'low-power': true,
});

interface PrimeBootStateOptions {
  infiniteIndex: number;
  lowPowerEnabled: boolean;
}

interface CasePoint {
  x: number;
  y: number;
}

export interface RenderDragMoveMetric {
  moveIndex: number;
  caseId: string;
  mode: BenchmarkMode;
  revision: string;
  syncDispatchMs: number;
  toNextRafMs: number;
}

export interface RenderDragCaseResult {
  caseId: string;
  infiniteIndex: number;
  revision: string;
  mode: BenchmarkMode;
  pathCells: GridTuple[];
  actualPathCells: GridTuple[];
  pointerMoveCount: number;
  pathStepCount: number;
  totalSyncDispatchMs: number;
  totalToNextRafMs: number;
  syncMsPerPointerMove: number;
  rafMsPerPointerMove: number;
  totalMsPerPathStep: number;
  dragWallClockMs: number;
  moveMetrics: RenderDragMoveMetric[];
  hasPathStartClass: boolean;
  hasPathEndClass: boolean;
  hasWebgl2: boolean;
  isContextLost: boolean | null;
}

export interface RenderDragSuiteAggregate {
  caseCount: number;
  totalPointerMoves: number;
  totalPathSteps: number;
  syncMsPerPointerMove: ReturnType<typeof buildMetricSummary>;
  rafMsPerPointerMove: ReturnType<typeof buildMetricSummary>;
  dragWallClockMs: ReturnType<typeof buildMetricSummary>;
  totalMsPerPathStep: ReturnType<typeof buildMetricSummary>;
}

export interface RenderDragBenchmarkSuiteResult {
  revision: string;
  mode: BenchmarkMode;
  repeatIndex: number;
  viewport: typeof VIEWPORT;
  caseResults: RenderDragCaseResult[];
  aggregate: RenderDragSuiteAggregate;
  pageErrors: string[];
}

interface BenchmarkDragCaseOptions {
  workloadCase: RenderDragPathCase;
  mode: BenchmarkMode;
  revisionLabel: string;
  pointerMovesPerSegment: number;
}

interface RunRenderDragBenchmarkSuiteOptions {
  browser: Browser;
  baseUrl: string;
  workload: RenderDragWorkload;
  revisionLabel: string;
  mode: BenchmarkMode;
  repeatIndex?: number;
}

const summarizeCases = (caseResults: readonly RenderDragCaseResult[]): RenderDragSuiteAggregate => {
  const syncValues: number[] = [];
  const rafValues: number[] = [];
  const dragValues: number[] = [];
  const stepValues: number[] = [];
  let totalPointerMoves = 0;
  let totalPathSteps = 0;

  for (const result of caseResults) {
    syncValues.push(result.syncMsPerPointerMove);
    rafValues.push(result.rafMsPerPointerMove);
    dragValues.push(result.dragWallClockMs);
    stepValues.push(result.totalMsPerPathStep);
    totalPointerMoves += result.pointerMoveCount;
    totalPathSteps += result.pathStepCount;
  }

  return {
    caseCount: caseResults.length,
    totalPointerMoves,
    totalPathSteps,
    syncMsPerPointerMove: buildMetricSummary(syncValues, (values) => percentile(values, 0.5)),
    rafMsPerPointerMove: buildMetricSummary(rafValues, (values) => percentile(values, 0.5)),
    dragWallClockMs: buildMetricSummary(dragValues, (values) => percentile(values, 0.5)),
    totalMsPerPathStep: buildMetricSummary(stepValues, (values) => percentile(values, 0.5)),
  };
};

const primeBootState = async (page: Page, { infiniteIndex, lowPowerEnabled }: PrimeBootStateOptions): Promise<void> => {
  await page.evaluate(({ keys, infiniteIndex: nextInfiniteIndex, lowPowerEnabled: nextLowPowerEnabled }) => {
    localStorage.clear();
    localStorage.setItem(keys.levelProgress, JSON.stringify({
      version: 1,
      latestLevel: 999,
    }));
    localStorage.setItem(keys.infiniteProgress, JSON.stringify({
      version: 1,
      latestLevel: nextInfiniteIndex,
    }));
    localStorage.setItem(keys.lowPowerMode, nextLowPowerEnabled ? '1' : '0');
    localStorage.setItem(keys.theme, 'dark');
    localStorage.setItem(keys.guideHidden, '0');
    localStorage.setItem(keys.legendHidden, '1');
    localStorage.removeItem(keys.sessionSave);
    localStorage.removeItem(keys.dailySolved);
    localStorage.removeItem(keys.scoreState);
  }, {
    keys: STORAGE_KEYS,
    infiniteIndex,
    lowPowerEnabled,
  });
};

const waitForBoardReady = async (page: Page, { infiniteIndex, lowPowerEnabled }: PrimeBootStateOptions): Promise<void> => {
  await page.waitForSelector('#pathCanvas', { timeout: 20000 });
  await page.waitForSelector('#grid .cell', { timeout: 20000 });
  await page.waitForFunction(({ infiniteIndex: nextInfiniteIndex, lowPowerEnabled: nextLowPowerEnabled }) => {
    const infiniteSel = document.getElementById('infiniteSel');
    const lowPowerToggle = document.getElementById('lowPowerToggle');
    if (!(infiniteSel instanceof HTMLSelectElement) || !(lowPowerToggle instanceof HTMLInputElement)) {
      return false;
    }
    return String(infiniteSel.value) === String(nextInfiniteIndex)
      && lowPowerToggle.checked === Boolean(nextLowPowerEnabled);
  }, { infiniteIndex, lowPowerEnabled }, { timeout: 20000 });

  const state = await page.evaluate(() => {
    const canvas = document.getElementById('pathCanvas');
    const grid = document.getElementById('grid');
    const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext('webgl2') : null;
    return {
      hasCanvas: Boolean(canvas),
      hasGrid: Boolean(grid),
      hasWebgl2: Boolean(gl),
      isContextLost: gl && typeof gl.isContextLost === 'function'
        ? gl.isContextLost()
        : null,
    };
  });

  if (!state.hasCanvas || !state.hasGrid) {
    throw new Error('Benchmark page did not load path canvas and grid');
  }
  if (!state.hasWebgl2) {
    throw new Error('Benchmark page does not expose a WebGL2 path canvas');
  }
  if (state.isContextLost) {
    throw new Error('Benchmark page path canvas context is already lost');
  }
};

const patchPointerCapture = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const proto = Element.prototype as Element & {
      __tetherRenderDragBenchPatched?: boolean;
      setPointerCapture?: (pointerId: number) => void;
      releasePointerCapture?: (pointerId: number) => void;
    };
    if (proto.__tetherRenderDragBenchPatched) return;
    proto.__tetherRenderDragBenchPatched = true;
    if (typeof proto.setPointerCapture === 'function') {
      proto.setPointerCapture = function noopSetPointerCapture() {};
    }
    if (typeof proto.releasePointerCapture === 'function') {
      proto.releasePointerCapture = function noopReleasePointerCapture() {};
    }
  });
};

const benchmarkDragCase = async (
  page: Page,
  {
    workloadCase,
    mode,
    revisionLabel,
    pointerMovesPerSegment,
  }: BenchmarkDragCaseOptions,
): Promise<RenderDragCaseResult> => page.evaluate<RenderDragCaseResult, BenchmarkDragCaseOptions>(async ({
  workloadCase: nextWorkloadCase,
  mode: nextMode,
  revisionLabel: nextRevisionLabel,
  pointerMovesPerSegment: nextPointerMovesPerSegment,
}) => {
  const fractions: number[] = [];
  for (let i = 1; i <= nextPointerMovesPerSegment; i += 1) {
    fractions.push(i / nextPointerMovesPerSegment);
  }

  const grid = document.getElementById('grid');
  if (!(grid instanceof HTMLElement)) {
    throw new Error('Missing #grid element');
  }

  const resolveCellCenter = (r: number, c: number): CasePoint => {
    const cell = document.querySelector<HTMLElement>(`#grid .cell[data-r="${r}"][data-c="${c}"]`);
    if (!cell) {
      throw new Error(`Missing board cell for workload coordinate ${r},${c}`);
    }
    const rect = cell.getBoundingClientRect();
    return {
      x: rect.left + (rect.width * 0.5),
      y: rect.top + (rect.height * 0.5),
    };
  };

  const waitForAnimationFrame = (): Promise<number> =>
    new Promise((resolve) => {
      requestAnimationFrame((timestamp) => resolve(timestamp));
    });

  const readRenderedPath = (): GridTuple[] =>
    Array.from(document.querySelectorAll<HTMLElement>('#grid .cell.visited'))
      .map((cell) => ({
        r: Number.parseInt(cell.dataset.r || '', 10),
        c: Number.parseInt(cell.dataset.c || '', 10),
        idx: Number.parseInt(cell.firstElementChild?.textContent || '', 10),
      }))
      .filter((item) => Number.isInteger(item.idx))
      .sort((a, b) => a.idx - b.idx)
      .map((item): GridTuple => [item.r, item.c]);

  const pathsEqualLocal = (expected: readonly GridTuple[], actual: readonly GridTuple[]): boolean => {
    if (expected.length !== actual.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i]?.[0] !== actual[i]?.[0] || expected[i]?.[1] !== actual[i]?.[1]) {
        return false;
      }
    }
    return true;
  };

  const dispatchPointer = (type: string, point: CasePoint, buttons: number): void => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
    });
    grid.dispatchEvent(event);
  };

  const orderedPath = nextWorkloadCase.pathCells.map(([r, c]) => resolveCellCenter(r, c));
  const interpolatedMoves: CasePoint[] = [];
  for (let i = 1; i < orderedPath.length; i += 1) {
    const from = orderedPath[i - 1];
    const to = orderedPath[i];
    for (const ratio of fractions) {
      interpolatedMoves.push({
        x: from.x + ((to.x - from.x) * ratio),
        y: from.y + ((to.y - from.y) * ratio),
      });
    }
  }

  const moveMetrics: RenderDragMoveMetric[] = [];
  const dragStartMs = performance.now();
  dispatchPointer('pointerdown', orderedPath[0], 1);

  for (let i = 0; i < interpolatedMoves.length; i += 1) {
    const point = interpolatedMoves[i];
    const startMs = performance.now();
    dispatchPointer('pointermove', point, 1);
    const afterDispatchMs = performance.now();
    await waitForAnimationFrame();
    const afterRafMs = performance.now();
    moveMetrics.push({
      moveIndex: i,
      caseId: nextWorkloadCase.caseId,
      mode: nextMode,
      revision: nextRevisionLabel,
      syncDispatchMs: afterDispatchMs - startMs,
      toNextRafMs: afterRafMs - startMs,
    });
  }

  dispatchPointer('pointerup', orderedPath[orderedPath.length - 1], 0);
  let renderedPath: GridTuple[] = [];
  for (let i = 0; i < 12; i += 1) {
    await waitForAnimationFrame();
    renderedPath = readRenderedPath();
    if (pathsEqualLocal(nextWorkloadCase.pathCells, renderedPath)) break;
  }

  const startCell = nextWorkloadCase.pathCells[0];
  const endCell = nextWorkloadCase.pathCells[nextWorkloadCase.pathCells.length - 1];
  const startEl = document.querySelector<HTMLElement>(
    `#grid .cell[data-r="${startCell[0]}"][data-c="${startCell[1]}"]`,
  );
  const endEl = document.querySelector<HTMLElement>(
    `#grid .cell[data-r="${endCell[0]}"][data-c="${endCell[1]}"]`,
  );
  const canvas = document.getElementById('pathCanvas');
  const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext('webgl2') : null;
  const totalSyncDispatchMs = moveMetrics.reduce((sum, item) => sum + item.syncDispatchMs, 0);
  const totalToNextRafMs = moveMetrics.reduce((sum, item) => sum + item.toNextRafMs, 0);
  const pathStepCount = Math.max(0, nextWorkloadCase.pathCells.length - 1);

  return {
    caseId: nextWorkloadCase.caseId,
    infiniteIndex: nextWorkloadCase.infiniteIndex,
    revision: nextRevisionLabel,
    mode: nextMode,
    pathCells: nextWorkloadCase.pathCells,
    actualPathCells: renderedPath,
    pointerMoveCount: moveMetrics.length,
    pathStepCount,
    totalSyncDispatchMs,
    totalToNextRafMs,
    syncMsPerPointerMove: moveMetrics.length > 0 ? (totalSyncDispatchMs / moveMetrics.length) : 0,
    rafMsPerPointerMove: moveMetrics.length > 0 ? (totalToNextRafMs / moveMetrics.length) : 0,
    totalMsPerPathStep: pathStepCount > 0 ? (totalToNextRafMs / pathStepCount) : 0,
    dragWallClockMs: performance.now() - dragStartMs,
    moveMetrics,
    hasPathStartClass: startEl?.classList?.contains('pathStart') === true,
    hasPathEndClass: pathStepCount > 0 ? (endEl?.classList?.contains('pathEnd') === true) : true,
    hasWebgl2: Boolean(gl),
    isContextLost: gl && typeof gl.isContextLost === 'function' ? gl.isContextLost() : null,
  };
}, {
  workloadCase,
  mode,
  revisionLabel,
  pointerMovesPerSegment,
});

const assertCaseBenchmark = (caseResult: RenderDragCaseResult, expectedPath: readonly GridTuple[]): void => {
  if (!caseResult.hasWebgl2) {
    throw new Error(`Case ${caseResult.caseId} lost WebGL2 availability during benchmark`);
  }
  if (caseResult.isContextLost) {
    throw new Error(`Case ${caseResult.caseId} lost the path canvas context during benchmark`);
  }
  if (!pathsEqual(expectedPath, caseResult.actualPathCells)) {
    throw new Error(
      `Case ${caseResult.caseId} rendered path mismatch.\nExpected: ${JSON.stringify(expectedPath)}\nActual: ${JSON.stringify(caseResult.actualPathCells)}`,
    );
  }
  if (!caseResult.hasPathStartClass) {
    throw new Error(`Case ${caseResult.caseId} is missing .pathStart on the first cell`);
  }
  if (!caseResult.hasPathEndClass) {
    throw new Error(`Case ${caseResult.caseId} is missing .pathEnd on the last cell`);
  }
};

export const runRenderDragBenchmarkSuite = async ({
  browser,
  baseUrl,
  workload,
  revisionLabel,
  mode,
  repeatIndex = 0,
}: RunRenderDragBenchmarkSuiteOptions): Promise<RenderDragBenchmarkSuiteResult> => {
  if (!browser) throw new Error('runRenderDragBenchmarkSuite requires a Playwright browser instance');
  if (!Object.prototype.hasOwnProperty.call(MODE_TO_LOW_POWER, mode)) {
    throw new Error(`Unsupported benchmark mode: ${mode}`);
  }

  const context = await browser.newContext({
    viewport: VIEWPORT,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.stack || error?.message || error));
  });

  const lowPowerEnabled = MODE_TO_LOW_POWER[mode];
  const caseResults: RenderDragCaseResult[] = [];

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    for (const workloadCase of workload.cases) {
      await primeBootState(page, {
        infiniteIndex: workloadCase.infiniteIndex,
        lowPowerEnabled,
      });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForBoardReady(page, {
        infiniteIndex: workloadCase.infiniteIndex,
        lowPowerEnabled,
      });
      await patchPointerCapture(page);

      const caseResult = await benchmarkDragCase(page, {
        workloadCase,
        mode,
        revisionLabel,
        pointerMovesPerSegment: workload.pointerMovesPerSegment,
      });
      assertCaseBenchmark(caseResult, workloadCase.pathCells);
      caseResults.push(caseResult);

      if (pageErrors.length > 0) {
        throw new Error(`Unexpected page errors:\n${pageErrors.join('\n')}`);
      }
    }

    return {
      revision: revisionLabel,
      mode,
      repeatIndex,
      viewport: VIEWPORT,
      caseResults,
      aggregate: summarizeCases(caseResults),
      pageErrors,
    };
  } finally {
    await page.close();
    await context.close();
  }
};

export const __TEST__ = Object.freeze({
  summarizeCases,
  percentile,
  mean,
  pathsEqual,
  storageKeys: STORAGE_KEYS,
  versions: Object.freeze({
    levelProgress: LEVEL_PROGRESS_VERSION,
    infiniteProgress: INFINITE_PROGRESS_VERSION,
  }),
});
