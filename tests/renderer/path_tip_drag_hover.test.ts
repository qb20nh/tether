import assert from 'node:assert/strict';
import test from '../test.ts';
import { syncPathTipDragHoverCell } from '../../src/renderer.ts';

const createClassList = (initial: string[] = []) => {
  const tokens = new Set<string>(initial);
  return {
    add(...values: string[]) {
      values.forEach((value) => tokens.add(value));
    },
    remove(...values: string[]) {
      values.forEach((value) => tokens.delete(value));
    },
    contains(value: string) {
      return tokens.has(value);
    },
  };
};

const createCell = (classes: string[] = []) => ({
  classList: createClassList(classes),
} as any);

const createTrackedCell = (classes: string[] = []) => {
  const cell = createCell(classes);
  const add = cell.classList.add;
  const remove = cell.classList.remove;
  let addCount = 0;
  let removeCount = 0;
  cell.classList.add = (...values: string[]) => {
    addCount += 1;
    add(...values);
  };
  cell.classList.remove = (...values: string[]) => {
    removeCount += 1;
    remove(...values);
  };
  return {
    cell,
    getAddCount: () => addCount,
    getRemoveCount: () => removeCount,
  };
};

const hasDragHover = (cell: ReturnType<typeof createCell>) => cell.classList.contains('pathTipDragHover');

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

test('syncPathTipDragHoverCell does not churn class updates when cursor cell is unchanged', { concurrency: false }, () => {
  resetPathTipDragHover();
  const tracked = createTrackedCell();
  const cells = [[tracked.cell]];

  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  }, cells);
  syncPathTipDragHoverCell({
    isPathDragging: true,
    pathDragCursor: { r: 0, c: 0 },
  }, cells);

  assert.equal(hasDragHover(tracked.cell), true);
  assert.equal(tracked.getAddCount(), 1);
  assert.equal(tracked.getRemoveCount(), 0);
  resetPathTipDragHover();
});
