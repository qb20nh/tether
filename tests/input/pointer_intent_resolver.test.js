import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPathDragCandidates,
  choosePathDragCell,
  predictPathDragPointer,
} from '../../src/input/pointer_intent_resolver.js';

test('buildPathDragCandidates filters visited non-backtrack candidates', () => {
  const snapshot = {
    rows: 3,
    cols: 3,
    gridData: [
      ['.', '.', '.'],
      ['.', '.', '.'],
      ['.', '.', '.'],
    ],
    visited: new Set(['0,1']),
  };

  const out = buildPathDragCandidates({
    snapshot,
    headNode: { r: 1, c: 1 },
    backtrackNode: { r: 0, c: 1 },
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1,
  });

  assert.ok(out.find((p) => p.r === 0 && p.c === 1 && p.isBacktrack));
  assert.ok(!out.find((p) => p.r === 0 && p.c === 1 && !p.isBacktrack));
});

test('predictPathDragPointer returns raw pointer when sample history is insufficient', () => {
  const out = predictPathDragPointer({
    samples: [{ x: 10, y: 20, t: 100 }],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
  });

  assert.deepEqual(out.effectiveClient, { x: 10, y: 20 });
  assert.equal(out.nextPredictedClient, null);
});

test('predictPathDragPointer projects forward on steady movement', () => {
  const out = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 16, y: 0, t: 16 },
      { x: 32, y: 0, t: 32 },
      { x: 48, y: 0, t: 48 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
  });

  assert.ok(out.effectiveClient.x > 48);
  assert.ok(out.nextPredictedClient.x > 48);
});

test('predictPathDragPointer adaptively reduces prediction when recent error is high', () => {
  const basePayload = {
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 16, y: 0, t: 16 },
      { x: 32, y: 0, t: 32 },
      { x: 48, y: 0, t: 48 },
    ],
    cellSize: 40,
    prevPredictedClient: null,
  };

  const lowError = predictPathDragPointer({
    ...basePayload,
    prevEmaErrorPx: 0,
  });
  const highError = predictPathDragPointer({
    ...basePayload,
    prevEmaErrorPx: 60,
  });

  assert.ok(lowError.effectiveClient.x > highError.effectiveClient.x);
  assert.equal(highError.effectiveClient.x, 48);
});

test('predictPathDragPointer caps projection distance to a fraction of cell size', () => {
  const out = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 200, y: 0, t: 16 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
  });

  const current = { x: 200, y: 0 };
  const projected = out.nextPredictedClient;
  const projectedDist = Math.hypot(projected.x - current.x, projected.y - current.y);
  assert.ok(projectedDist <= 30.0001);
});

test('choosePathDragCell applies nearest + hysteresis selection', () => {
  const picked = choosePathDragCell({
    headNode: { r: 1, c: 1 },
    candidates: [{ r: 1, c: 2, isBacktrack: false }],
    pointer: { x: 95, y: 50 },
    holdCell: { r: 1, c: 1 },
    size: 40,
    cellCenter: (r, c) => ({ x: c * 50, y: r * 50 }),
  });

  assert.deepEqual(picked, { r: 1, c: 2 });
});
