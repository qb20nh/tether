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
const VIEWPORT = Object.freeze({
  width: 1200,
  height: 860,
});

const MODE_TO_LOW_POWER = Object.freeze({
  normal: false,
  'low-power': true,
});

const toFixedNumber = (value) => (Number.isFinite(value) ? Number(value) : 0);

const mean = (values) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i];
  }
  return total / values.length;
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, ratio));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * clamped) - 1));
  return sorted[index];
};

const summarizeCases = (caseResults) => {
  const syncValues = [];
  const rafValues = [];
  const dragValues = [];
  const stepValues = [];
  let totalPointerMoves = 0;
  let totalPathSteps = 0;

  for (let i = 0; i < caseResults.length; i += 1) {
    const result = caseResults[i];
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
    syncMsPerPointerMove: {
      mean: mean(syncValues),
      median: percentile(syncValues, 0.5),
      p95: percentile(syncValues, 0.95),
    },
    rafMsPerPointerMove: {
      mean: mean(rafValues),
      median: percentile(rafValues, 0.5),
      p95: percentile(rafValues, 0.95),
    },
    dragWallClockMs: {
      mean: mean(dragValues),
      median: percentile(dragValues, 0.5),
      p95: percentile(dragValues, 0.95),
    },
    totalMsPerPathStep: {
      mean: mean(stepValues),
      median: percentile(stepValues, 0.5),
      p95: percentile(stepValues, 0.95),
    },
  };
};

const pathsEqual = (expected, actual) => {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    const expectedPoint = expected[i];
    const actualPoint = actual[i];
    if (expectedPoint?.[0] !== actualPoint?.[0] || expectedPoint?.[1] !== actualPoint?.[1]) {
      return false;
    }
  }
  return true;
};

const primeBootState = async (page, { infiniteIndex, lowPowerEnabled }) => {
  await page.evaluate(({ keys, infiniteIndex, lowPowerEnabled }) => {
    localStorage.clear();
    localStorage.setItem(keys.levelProgress, JSON.stringify({
      version: 1,
      latestLevel: 999,
    }));
    localStorage.setItem(keys.infiniteProgress, JSON.stringify({
      version: 1,
      latestLevel: infiniteIndex,
    }));
    localStorage.setItem(keys.lowPowerMode, lowPowerEnabled ? '1' : '0');
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

const waitForBoardReady = async (page, { infiniteIndex, lowPowerEnabled }) => {
  await page.waitForSelector('#pathCanvas', { timeout: 20000 });
  await page.waitForSelector('#grid .cell', { timeout: 20000 });
  await page.waitForFunction(({ infiniteIndex, lowPowerEnabled }) => {
    const infiniteSel = document.getElementById('infiniteSel');
    const lowPowerToggle = document.getElementById('lowPowerToggle');
    if (!infiniteSel || !(lowPowerToggle instanceof HTMLInputElement)) return false;
    return String(infiniteSel.value) === String(infiniteIndex)
      && lowPowerToggle.checked === Boolean(lowPowerEnabled);
  }, { infiniteIndex, lowPowerEnabled }, { timeout: 20000 });

  const state = await page.evaluate(() => {
    const canvas = document.getElementById('pathCanvas');
    const grid = document.getElementById('grid');
    const gl = canvas?.getContext?.('webgl2');
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

const patchPointerCapture = async (page) => {
  await page.evaluate(() => {
    const proto = Element.prototype;
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

const benchmarkDragCase = async (page, {
  workloadCase,
  mode,
  revisionLabel,
  pointerMovesPerSegment,
}) => page.evaluate(async ({
  workloadCase,
  mode,
  revisionLabel,
  pointerMovesPerSegment,
}) => {
  const fractions = [];
  for (let i = 1; i <= pointerMovesPerSegment; i += 1) {
    fractions.push(i / pointerMovesPerSegment);
  }

  const grid = document.getElementById('grid');
  if (!grid) {
    throw new Error('Missing #grid element');
  }

  const resolveCellCenter = (r, c) => {
    const cell = document.querySelector(`#grid .cell[data-r="${r}"][data-c="${c}"]`);
    if (!cell) {
      throw new Error(`Missing board cell for workload coordinate ${r},${c}`);
    }
    const rect = cell.getBoundingClientRect();
    return {
      x: rect.left + (rect.width * 0.5),
      y: rect.top + (rect.height * 0.5),
    };
  };

  const waitForAnimationFrame = () =>
    new Promise((resolve) => {
      requestAnimationFrame((timestamp) => resolve(timestamp));
    });

  const readRenderedPath = () =>
    Array.from(document.querySelectorAll('#grid .cell.visited'))
      .map((cell) => ({
        r: Number.parseInt(cell.dataset.r || '', 10),
        c: Number.parseInt(cell.dataset.c || '', 10),
        idx: Number.parseInt(cell.firstElementChild?.textContent || '', 10),
      }))
      .filter((item) => Number.isInteger(item.idx))
      .sort((a, b) => a.idx - b.idx)
      .map((item) => [item.r, item.c]);

  const pathsEqual = (expected, actual) => {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
    if (expected.length !== actual.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i]?.[0] !== actual[i]?.[0] || expected[i]?.[1] !== actual[i]?.[1]) {
        return false;
      }
    }
    return true;
  };

  const dispatchPointer = (type, point, buttons) => {
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

  const orderedPath = workloadCase.pathCells.map(([r, c]) => resolveCellCenter(r, c));
  const interpolatedMoves = [];
  for (let i = 1; i < orderedPath.length; i += 1) {
    const from = orderedPath[i - 1];
    const to = orderedPath[i];
    for (let j = 0; j < fractions.length; j += 1) {
      const ratio = fractions[j];
      interpolatedMoves.push({
        x: from.x + ((to.x - from.x) * ratio),
        y: from.y + ((to.y - from.y) * ratio),
      });
    }
  }

  const moveMetrics = [];
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
      caseId: workloadCase.caseId,
      mode,
      revision: revisionLabel,
      syncDispatchMs: afterDispatchMs - startMs,
      toNextRafMs: afterRafMs - startMs,
    });
  }

  dispatchPointer('pointerup', orderedPath[orderedPath.length - 1], 0);
  let renderedPath = [];
  for (let i = 0; i < 12; i += 1) {
    await waitForAnimationFrame();
    renderedPath = readRenderedPath();
    if (pathsEqual(workloadCase.pathCells, renderedPath)) break;
  }

  const startCell = workloadCase.pathCells[0];
  const endCell = workloadCase.pathCells[workloadCase.pathCells.length - 1];
  const startEl = document.querySelector(
    `#grid .cell[data-r="${startCell[0]}"][data-c="${startCell[1]}"]`,
  );
  const endEl = document.querySelector(
    `#grid .cell[data-r="${endCell[0]}"][data-c="${endCell[1]}"]`,
  );
  const canvas = document.getElementById('pathCanvas');
  const gl = canvas?.getContext?.('webgl2');
  const totalSyncDispatchMs = moveMetrics.reduce((sum, item) => sum + item.syncDispatchMs, 0);
  const totalToNextRafMs = moveMetrics.reduce((sum, item) => sum + item.toNextRafMs, 0);
  const pathStepCount = Math.max(0, workloadCase.pathCells.length - 1);

  return {
    caseId: workloadCase.caseId,
    infiniteIndex: workloadCase.infiniteIndex,
    revision: revisionLabel,
    mode,
    pathCells: workloadCase.pathCells,
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

const assertCaseBenchmark = (caseResult, expectedPath) => {
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
}) => {
  if (!browser) throw new Error('runRenderDragBenchmarkSuite requires a Playwright browser instance');
  if (!Object.prototype.hasOwnProperty.call(MODE_TO_LOW_POWER, mode)) {
    throw new Error(`Unsupported benchmark mode: ${mode}`);
  }

  const context = await browser.newContext({
    viewport: VIEWPORT,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.stack || error?.message || error));
  });

  const lowPowerEnabled = MODE_TO_LOW_POWER[mode];
  const caseResults = [];

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    for (let i = 0; i < workload.cases.length; i += 1) {
      const workloadCase = workload.cases[i];
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
