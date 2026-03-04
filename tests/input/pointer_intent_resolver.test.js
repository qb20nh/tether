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

test('predictPathDragPointer increases forward lead when frame interval is higher', () => {
  const payload = {
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 16, y: 0, t: 16 },
      { x: 32, y: 0, t: 32 },
      { x: 48, y: 0, t: 48 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
  };

  const lowFrame = predictPathDragPointer({
    ...payload,
    frameIntervalMs: 16,
  });
  const highFrame = predictPathDragPointer({
    ...payload,
    frameIntervalMs: 40,
  });

  assert.ok(highFrame.effectiveClient.x > lowFrame.effectiveClient.x);
});

test('predictPathDragPointer increases forward lead when input cadence is sparse', () => {
  const dense = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 16, y: 0, t: 16 },
      { x: 32, y: 0, t: 32 },
      { x: 48, y: 0, t: 48 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
  });
  const sparse = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 32, y: 0, t: 32 },
      { x: 64, y: 0, t: 64 },
      { x: 96, y: 0, t: 96 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
  });

  const denseLead = dense.effectiveClient.x - 48;
  const sparseLead = sparse.effectiveClient.x - 96;
  assert.ok(sparseLead > denseLead);
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

test('predictPathDragPointer uses adaptive projection cap and keeps it bounded', () => {
  const lowCadence = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 400, y: 0, t: 16 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
  });
  const highCadence = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 400, y: 0, t: 16 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 50,
  });

  const lowProjectedDist = Math.hypot(
    lowCadence.nextPredictedClient.x - 400,
    lowCadence.nextPredictedClient.y,
  );
  const highProjectedDist = Math.hypot(
    highCadence.nextPredictedClient.x - 400,
    highCadence.nextPredictedClient.y,
  );

  assert.ok(highProjectedDist > lowProjectedDist);
  assert.ok(highProjectedDist <= 46.0001);
});

test('predictPathDragPointer avoids projection when movement speed is near-stationary', () => {
  const out = predictPathDragPointer({
    samples: [
      { x: 10, y: 20, t: 0 },
      { x: 10.1, y: 20, t: 16 },
      { x: 10.2, y: 20, t: 32 },
    ],
    cellSize: 40,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
  });

  assert.deepEqual(out.effectiveClient, { x: 10.2, y: 20 });
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
