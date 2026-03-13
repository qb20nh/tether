import assert from 'node:assert/strict';
import test from '../test.ts';
import {
  cellFromPoint,
  pathCellFromPoint,
  snapCellFromMetrics,
  snapPathCellFromPoint,
  snapWallCellFromPoint,
  wallCellFromPoint,
} from '../../src/input/dom_input_adapter_cells.ts';
import {
  applyPathStepToSimulation,
  createPathDragSimulation,
  queuePathDragSteps,
  readPathDragPointerContext,
} from '../../src/input/dom_input_adapter_path_drag.ts';

test('cell resolution helpers use metrics, fallback lookup, and bounds checks', () => {
  const metrics = {
    version: 1,
    left: 10,
    top: 20,
    right: 110,
    bottom: 120,
    gap: 5,
    pad: 4,
    size: 20,
    step: 25,
    rows: 3,
    cols: 3,
    scrollX: 0,
    scrollY: 0,
  };
  assert.deepEqual(snapCellFromMetrics(39, 49, metrics), { r: 1, c: 1 });
  assert.equal(snapWallCellFromPoint({
    x: -100,
    y: -100,
    snapshot: { rows: 3, cols: 3 },
    metrics,
    gridEl: null,
    viewportScroll: { x: 0, y: 0 },
  }), null);
  assert.deepEqual(snapPathCellFromPoint({
    x: 39,
    y: 49,
    snapshot: { rows: 3, cols: 3 },
    metrics,
    gridEl: null,
    viewportScroll: { x: 0, y: 0 },
  }), { r: 1, c: 1 });

  const documentObj = {
    elementFromPoint() {
      return {
        closest() {
          return {
            dataset: { r: '2', c: '1' },
          };
        },
      };
    },
  };
  assert.deepEqual(cellFromPoint(0, 0, documentObj as any), { r: 2, c: 1 });
  assert.deepEqual(pathCellFromPoint({
    x: 0,
    y: 0,
    snapshot: { rows: 3, cols: 3 },
    metrics: null,
    gridEl: null,
    layoutMetrics: null,
    viewportScroll: { x: 0, y: 0 },
  }), null);
  assert.deepEqual(wallCellFromPoint({
    x: 10,
    y: 20,
    snapshot: { rows: 3, cols: 3 },
    metrics,
    gridEl: null,
    viewportScroll: { x: 0, y: 0 },
  }), { r: 0, c: 0 });
});

test('path drag helpers simulate extension backtracking and pointer context resolution', () => {
  const snapshot = {
    rows: 2,
    cols: 2,
    gridData: [['.', '.'], ['.', '.']],
    stitchSet: new Set<string>(),
    path: [{ r: 0, c: 0 }, { r: 0, c: 1 }],
    visited: new Set(['0,0', '0,1']),
  };
  const simulation = createPathDragSimulation(snapshot as any);
  assert.ok(simulation);

  applyPathStepToSimulation({
    snapshot: simulation,
    side: 'end',
    nextStep: { r: 1, c: 1 },
    pointsMatch: (left, right) => left?.r === right?.r && left?.c === right?.c,
  });
  assert.deepEqual(simulation?.path.at(-1), { r: 1, c: 1 });

  applyPathStepToSimulation({
    snapshot: simulation,
    side: 'end',
    nextStep: { r: 0, c: 1 },
    pointsMatch: (left, right) => left?.r === right?.r && left?.c === right?.c,
  });
  assert.deepEqual(simulation?.path, [{ r: 0, c: 0 }, { r: 0, c: 1 }]);

  const queued = queuePathDragSteps({
    snapshot: snapshot as any,
    side: 'end',
    pointerContext: {
      px: 10,
      py: 15,
      pointerCell: { r: 1, c: 1 },
      cellSize: 20,
      cellCenter: (r, c) => ({ x: (c * 20) + 10, y: (r * 20) + 10 }),
    },
    chooseStep: ({ headNode, pointerCell }) => (
      headNode.r === 0 && headNode.c === 1 && pointerCell
        ? pointerCell
        : null
    ),
    isUsableCell: () => true,
    isAdjacentMove: () => true,
    pointsMatch: (left, right) => left?.r === right?.r && left?.c === right?.c,
  });
  assert.deepEqual(queued.steps, [{ r: 1, c: 1 }]);
  assert.equal(queued.moved, true);

  const pointerContext = readPathDragPointerContext({
    snapshot: snapshot as any,
    pointerClientX: 30,
    pointerClientY: 40,
    metrics: {
      version: 1,
      left: 10,
      top: 20,
      right: 60,
      bottom: 70,
      gap: 10,
      pad: 5,
      size: 10,
      step: 20,
      rows: 2,
      cols: 2,
      scrollX: 0,
      scrollY: 0,
    },
    gridEl: null,
    snapPathCellFromPoint: () => ({ r: 1, c: 0 }),
    getCellSize: () => 99,
    cellCenter: () => ({ x: 0, y: 0 }),
  });
  assert.deepEqual(pointerContext.pointerCell, { r: 1, c: 0 });
  assert.equal(pointerContext.px, 20);
  assert.equal(pointerContext.py, 20);
  assert.deepEqual(pointerContext.cellCenter(1, 1), { x: 30, y: 30 });
});
