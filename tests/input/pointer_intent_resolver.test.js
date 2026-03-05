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
  assert.ok(highEffectiveLead >= 52, `expected aggressive high-strength lead, got ${highEffectiveLead}`);
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

test('predictPathDragPointer keeps strong high-strength lead at high input rate', () => {
  const out = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 8, y: 0, t: 8 },
      { x: 16, y: 0, t: 16 },
      { x: 24, y: 0, t: 24 },
    ],
    cellSize: 56,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
    nowMs: 24,
    predictionStrengthLevel: 3,
  });

  const leadPx = out.effectiveClient.x - 24;
  assert.ok(leadPx >= 52, `expected >=52px high-Hz lead, got ${leadPx}`);
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

test('predictPathDragPointer sharply reduces lead when movement decelerates quickly', () => {
  const steady = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 16, y: 0, t: 16 },
      { x: 32, y: 0, t: 32 },
      { x: 48, y: 0, t: 48 },
    ],
    cellSize: 56,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
    predictionStrengthLevel: 3,
  });
  const decelerated = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 24, y: 0, t: 16 },
      { x: 40, y: 0, t: 32 },
      { x: 48, y: 0, t: 48 },
    ],
    cellSize: 56,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
    predictionStrengthLevel: 3,
  });

  const steadyLead = steady.effectiveClient.x - 48;
  const decelLead = decelerated.effectiveClient.x - 48;
  assert.ok(decelLead < steadyLead);
  assert.ok(decelLead > steadyLead * 0.6);
});

test('predictPathDragPointer converges to raw pointer when latest movement stops', () => {
  const out = predictPathDragPointer({
    samples: [
      { x: 0, y: 0, t: 0 },
      { x: 24, y: 0, t: 16 },
      { x: 40, y: 0, t: 32 },
      { x: 40, y: 0, t: 48 },
    ],
    cellSize: 56,
    prevEmaErrorPx: 0,
    prevPredictedClient: null,
    frameIntervalMs: 16,
    predictionStrengthLevel: 3,
  });

  assert.deepEqual(out.effectiveClient, { x: 40, y: 0 });
  assert.deepEqual(out.nextPredictedClient, { x: 40, y: 0 });
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

test('chooseSlipperyPathDragStep immediately corrects on turn divergence', () => {
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

test('chooseSlipperyPathDragStep allows predicted lead when raw pointer still implies hold', () => {
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
    rawPointer: { x: 11, y: 10 },
    pointerCell: { r: 1, c: 1 },
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.deepEqual(picked, { r: 1, c: 2 });
});

test('chooseSlipperyPathDragStep immediately corrects on retract divergence', () => {
  const picked = chooseSlipperyPathDragStep({
    snapshot: {
      rows: 3,
      cols: 4,
      visited: new Set(['1,1', '1,2']),
      gridData: [
        ['.', '.', '.', '.'],
        ['.', '.', '.', '.'],
        ['.', '.', '.', '.'],
      ],
      stitchSet: new Set(),
    },
    headNode: { r: 1, c: 2 },
    backtrackNode: { r: 1, c: 1 },
    pointer: { x: 31, y: 10 },
    rawPointer: { x: 10, y: 10 },
    pointerCell: null,
    isUsableCell: () => true,
    isAdjacentMove: (_snapshot, a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,
    cellCenter: (r, c) => ({ x: c * 10, y: r * 10 }),
    cellSize: 10,
  });

  assert.deepEqual(picked, { r: 1, c: 1 });
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
    predThreshold <= rawThreshold - 16,
    `expected >=16px prediction lead, got predThreshold=${predThreshold}, rawThreshold=${rawThreshold}`,
  );
});

test('dense and sparse sampling of the same trajectory resolve to the same final path', () => {
  const rows = 3;
  const cols = 6;
  const cellSize = 56;
  const half = cellSize * 0.5;
  const gridData = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '.'));
  const isAdjacentMove = (_snapshot, a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  const cellCenter = (r, c) => ({
    x: (c * cellSize) + half,
    y: (r * cellSize) + half,
  });
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const snapCell = (x, y) => ({
    r: clamp(Math.round((y - half) / cellSize), 0, rows - 1),
    c: clamp(Math.round((x - half) / cellSize), 0, cols - 1),
  });
  const keyOf = (node) => `${node.r},${node.c}`;

  const runTrajectory = (points, dtMs) => {
    const path = [{ r: 1, c: 1 }];
    const prediction = {
      samples: [],
      emaErrorPx: 0,
      lastPredictedClient: null,
    };

    for (let i = 0; i < points.length; i += 1) {
      const rawPointer = points[i];
      const nowMs = i * dtMs;
      prediction.samples.push({ x: rawPointer.x, y: rawPointer.y, t: nowMs });
      if (prediction.samples.length > 8) prediction.samples.shift();
      const predicted = predictPathDragPointer({
        samples: prediction.samples,
        cellSize,
        prevEmaErrorPx: prediction.emaErrorPx,
        prevPredictedClient: prediction.lastPredictedClient,
        frameIntervalMs: 16,
        nowMs,
        predictionStrengthLevel: 3,
      });
      prediction.emaErrorPx = predicted.nextEmaErrorPx;
      prediction.lastPredictedClient = predicted.nextPredictedClient;

      const pointerCell = snapCell(rawPointer.x, rawPointer.y);
      let stepGuard = 0;
      while (stepGuard < (rows * cols)) {
        const headNode = path[path.length - 1];
        const backtrackNode = path[path.length - 2] || null;
        const snapshot = {
          rows,
          cols,
          visited: new Set(path.map((node) => keyOf(node))),
          gridData,
          stitchSet: new Set(),
        };
        const nextStep = chooseSlipperyPathDragStep({
          snapshot,
          headNode,
          backtrackNode,
          pointer: predicted.effectiveClient,
          rawPointer,
          pointerCell,
          isUsableCell: () => true,
          isAdjacentMove,
          cellCenter,
          cellSize,
        });
        if (!nextStep) break;
        if (backtrackNode && nextStep.r === backtrackNode.r && nextStep.c === backtrackNode.c) {
          path.pop();
        } else {
          path.push({ r: nextStep.r, c: nextStep.c });
        }
        stepGuard += 1;
      }
    }

    return path.map((node) => keyOf(node));
  };

  const densePoints = [
    { x: 84, y: 84 },
    { x: 100, y: 84 },
    { x: 120, y: 84 },
    { x: 140, y: 84 },
    { x: 160, y: 84 },
    { x: 180, y: 84 },
    { x: 200, y: 84 },
    { x: 220, y: 84 },
    { x: 240, y: 84 },
    { x: 252, y: 84 },
    { x: 252, y: 70 },
    { x: 252, y: 56 },
    { x: 252, y: 42 },
    { x: 252, y: 28 },
  ];
  const sparsePoints = [
    densePoints[0],
    densePoints[2],
    densePoints[4],
    densePoints[6],
    densePoints[8],
    densePoints[10],
    densePoints[12],
    densePoints[13],
  ];

  const densePath = runTrajectory(densePoints, 16);
  const sparsePath = runTrajectory(sparsePoints, 32);

  assert.deepEqual(densePath, sparsePath);
  assert.deepEqual(densePath, ['1,1', '1,2', '1,3', '1,4', '0,4']);
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
