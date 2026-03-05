import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPathDragCandidates,
  choosePathDragCell,
  chooseSlipperyPathDragStep,
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
