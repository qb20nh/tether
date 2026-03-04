import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPathDragCandidates,
  choosePathDragCell,
  chooseSlipperyPathDragStep,
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

test('predictPathDragPointer returns raw pointer when prediction strength is none', () => {
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
    predictionStrengthLevel: 0,
  });

  assert.deepEqual(out.effectiveClient, { x: 48, y: 0 });
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

test('predictPathDragPointer scales lead distance by exact 1x/2x/3x strength multipliers', () => {
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

  const low = predictPathDragPointer({
    ...payload,
    predictionStrengthLevel: 1,
  });
  const moderate = predictPathDragPointer({
    ...payload,
    predictionStrengthLevel: 2,
  });
  const high = predictPathDragPointer({
    ...payload,
    predictionStrengthLevel: 3,
  });

  const lowEffectiveLead = low.effectiveClient.x - 48;
  const moderateEffectiveLead = moderate.effectiveClient.x - 48;
  const highEffectiveLead = high.effectiveClient.x - 48;
  const lowPredictedLead = low.nextPredictedClient.x - 48;
  const moderatePredictedLead = moderate.nextPredictedClient.x - 48;
  const highPredictedLead = high.nextPredictedClient.x - 48;
  const epsilon = 1e-6;

  assert.ok(lowEffectiveLead > 0);
  assert.ok(Math.abs(moderateEffectiveLead - (lowEffectiveLead * 2)) < epsilon);
  assert.ok(Math.abs(highEffectiveLead - (lowEffectiveLead * 3)) < epsilon);
  assert.ok(Math.abs(moderatePredictedLead - (lowPredictedLead * 2)) < epsilon);
  assert.ok(Math.abs(highPredictedLead - (lowPredictedLead * 3)) < epsilon);
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

test('chooseSlipperyPathDragStep picks nearest orthogonal candidate', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
      stitchSet: new Set(),
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 24, y: 10 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
  });

  assert.deepEqual(picked, { r: 1, c: 2 });
});

test('chooseSlipperyPathDragStep selects legal stitched diagonal when nearest', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
      stitchSet: new Set(['2,2']),
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 19, y: 19 },
    rawPointer: { x: 19, y: 19 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (snapshot, a, b) => {
      const dr = Math.abs(a.r - b.r);
      const dc = Math.abs(a.c - b.c);
      if (dr + dc === 1) return true;
      if (dr === 1 && dc === 1) {
        return snapshot.stitchSet.has(`${Math.max(a.r, b.r)},${Math.max(a.c, b.c)}`);
      }
      return false;
    },
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.deepEqual(picked, { r: 2, c: 2 });
});

test('chooseSlipperyPathDragStep crosses stitched bridge when pointer crosses opposite diagonal', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
      stitchSet: new Set(['2,2']),
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 16.5, y: 16.5 },
    rawPointer: { x: 16.5, y: 16.5 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (snapshot, a, b) => {
      const dr = Math.abs(a.r - b.r);
      const dc = Math.abs(a.c - b.c);
      if (dr + dc === 1) return true;
      if (dr === 1 && dc === 1) {
        return snapshot.stitchSet.has(`${Math.max(a.r, b.r)},${Math.max(a.c, b.c)}`);
      }
      return false;
    },
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.deepEqual(picked, { r: 2, c: 2 });
});

test('chooseSlipperyPathDragStep holds inside stitched circle before crossing bridge', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
      stitchSet: new Set(['2,2']),
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 14, y: 14 },
    rawPointer: { x: 14, y: 14 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (snapshot, a, b) => {
      const dr = Math.abs(a.r - b.r);
      const dc = Math.abs(a.c - b.c);
      if (dr + dc === 1) return true;
      if (dr === 1 && dc === 1) {
        return snapshot.stitchSet.has(`${Math.max(a.r, b.r)},${Math.max(a.c, b.c)}`);
      }
      return false;
    },
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.equal(picked, null);
});

test('chooseSlipperyPathDragStep rejects predicted-best step that diverges from raw pointer', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
      stitchSet: new Set(),
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 17, y: 4 },
    rawPointer: { x: 10, y: 1 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.deepEqual(picked, { r: 0, c: 1 });
});

test('chooseSlipperyPathDragStep keeps predicted-best step when raw pointer agrees', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
      stitchSet: new Set(),
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 19, y: 10 },
    rawPointer: { x: 18, y: 10 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.deepEqual(picked, { r: 1, c: 2 });
});

test('chooseSlipperyPathDragStep gives visible lead over raw-only drag', () => {
  const snapshot = {
    rows: 3,
    cols: 3,
    visited: new Set(),
    gridData: [
      ['.', '.', '.'],
      ['.', '.', '.'],
      ['.', '.', '.'],
    ],
    stitchSet: new Set(),
  };
  const cellSize = 56;
  const centerY = (cellSize * 1) + (cellSize * 0.5);
  const basePayload = {
    snapshot,
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointerCell: { r: 1, c: 1 },
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,
    cellCenter: (r, c) => ({
      x: (c * cellSize) + (cellSize * 0.5),
      y: (r * cellSize) + (cellSize * 0.5),
    }),
    cellSize,
  };

  let predThreshold = null;
  let rawThreshold = null;
  for (let rawX = 84; rawX <= 160; rawX += 1) {
    const rawPointer = { x: rawX, y: centerY };
    const predictedPointer = { x: rawX + 20, y: centerY };
    const predictedStep = chooseSlipperyPathDragStep({
      ...basePayload,
      pointer: predictedPointer,
      rawPointer,
    });
    const rawOnlyStep = chooseSlipperyPathDragStep({
      ...basePayload,
      pointer: rawPointer,
      rawPointer,
    });

    if (predThreshold === null && predictedStep?.r === 1 && predictedStep?.c === 2) {
      predThreshold = rawX;
    }
    if (rawThreshold === null && rawOnlyStep?.r === 1 && rawOnlyStep?.c === 2) {
      rawThreshold = rawX;
    }
  }

  assert.notEqual(predThreshold, null);
  assert.notEqual(rawThreshold, null);
  assert.ok(
    predThreshold <= rawThreshold - 8,
    `expected >=8px prediction lead, got predThreshold=${predThreshold}, rawThreshold=${rawThreshold}`,
  );
});

test('chooseSlipperyPathDragStep returns null when pointer is already on head cell', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 10, y: 10 },
    pointerCell: { r: 1, c: 1 },
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
  });

  assert.equal(picked, null);
});

test('chooseSlipperyPathDragStep keeps current cell when it is nearest', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 11, y: 10 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
  });

  assert.equal(picked, null);
});

test('chooseSlipperyPathDragStep breaks ties toward pointer cell', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 3,
      visited: new Set(),
      gridData: [
        ['.', '.', '.'],
        ['.', '.', '.'],
        ['.', '.', '.'],
      ],
    },
    headNode: { r: 1, c: 1 },
    backtrackNode: null,
    pointer: { x: 15, y: 5 },
    pointerCell: { r: 1, c: 2 },
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
  });

  assert.deepEqual(picked, { r: 1, c: 2 });
});
