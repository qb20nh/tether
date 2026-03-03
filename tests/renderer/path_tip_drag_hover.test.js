import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPathTipDragHoverCell } from '../../src/renderer.js';

const createClassList = (initial = []) => {
  const tokens = new Set(initial);
  return {
    add(...values) {
      values.forEach((value) => tokens.add(value));
    },
    remove(...values) {
      values.forEach((value) => tokens.delete(value));
    },
    contains(value) {
      return tokens.has(value);
    },
  };
};

const createCell = (classes = []) => ({
  classList: createClassList(classes),
});

const hasDragHover = (cell) => cell.classList.contains('pathTipDragHover');

const resetPathTipDragHover = () => {
  syncPathTipDragHoverCell({ isPathDragging: false, pathDragCursor: null }, []);
};

test('syncPathTipDragHoverCell applies drag hover class to non-wall cursor cell', { concurrency: false }, () => {
  resetPathTipDragHover();
  const cell = createCell();
  const cells = [[cell]];

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  }, cells);

  assert.equal(hasDragHover(cell), true);
  resetPathTipDragHover();
});

test('syncPathTipDragHoverCell moves drag hover class to latest cursor cell', { concurrency: false }, () => {
  resetPathTipDragHover();
  const first = createCell();
  const second = createCell();
  const cells = [[first, second]];

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  }, cells);
  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 1 },
  }, cells);

  assert.equal(hasDragHover(first), false);
  assert.equal(hasDragHover(second), true);
  resetPathTipDragHover();
});

test('syncPathTipDragHoverCell clears drag hover class when drag ends or cursor is invalid', { concurrency: false }, () => {
  resetPathTipDragHover();
  const cell = createCell();
  const cells = [[cell]];

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  }, cells);
  assert.equal(hasDragHover(cell), true);

  syncPathTipDragHoverCell({
    isPathDragging: false,
    pathDragCursor: null,
  }, cells);
  assert.equal(hasDragHover(cell), false);

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: null,
  }, cells);
  assert.equal(hasDragHover(cell), false);
  resetPathTipDragHover();
});

test('syncPathTipDragHoverCell ignores wall cells and clears previous hover', { concurrency: false }, () => {
  resetPathTipDragHover();
  const nonWall = createCell();
  const wall = createCell(['wall']);
  const cells = [[nonWall, wall]];

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  }, cells);
  assert.equal(hasDragHover(nonWall), true);

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 1 },
  }, cells);

  assert.equal(hasDragHover(nonWall), false);
  assert.equal(hasDragHover(wall), false);
  resetPathTipDragHover();
});
