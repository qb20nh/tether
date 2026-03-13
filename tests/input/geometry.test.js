import assert from 'node:assert/strict';
import test from 'node:test';
import { getCellSize } from '../../src/geometry.ts';

class FakeElement {
  constructor({ id = '', inlineCell = '', width = 0 } = {}) {
    this.id = id;
    this.inlineCell = inlineCell;
    this.width = width;
    this.children = [];
    this.parentElement = null;
    this.style = {
      getPropertyValue: (name) => (name === '--cell' ? this.inlineCell : ''),
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  querySelector(selector) {
    if (selector !== '#grid') return null;
    return this.children.find((child) => child.id === 'grid') || null;
  }

  getBoundingClientRect() {
    return { width: this.width };
  }
}

const createComputedStyle = ({
  cell = '',
  cols = '',
  gap = '0',
  pad = '0',
} = {}) => ({
  getPropertyValue(name) {
    if (name === '--cell') return cell;
    if (name === '--grid-cols') return cols;
    return '';
  },
  columnGap: gap,
  gap,
  paddingLeft: pad,
  padding: pad,
});

const installGeometryDomGlobals = (t) => {
  const globalObject = /** @type {{ document?: any, Element?: any, getComputedStyle?: any }} */ (globalThis);
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const computedStyles = new WeakMap();
  const documentElement = new FakeElement({ id: 'document-root' });

  globalObject.Element = FakeElement;
  globalObject.document = { documentElement };
  globalObject.getComputedStyle = (el) => computedStyles.get(el) || createComputedStyle();

  t.after(() => {
    globalObject.document = originalDocument;
    globalObject.Element = originalElement;
    globalObject.getComputedStyle = originalGetComputedStyle;
  });

  return {
    documentElement,
    createElement: (options) => new FakeElement(options),
    setComputedStyle: (el, style) => {
      computedStyles.set(el, createComputedStyle(style));
    },
  };
};

test('getCellSize prefers a nested grid cell CSS variable over the source cell value', (t) => {
  const { createElement, setComputedStyle } = installGeometryDomGlobals(t);
  const source = createElement({ inlineCell: '64' });
  const grid = createElement({ id: 'grid' });
  source.appendChild(grid);
  setComputedStyle(grid, { cell: '48' });

  assert.equal(getCellSize(/** @type {any} */ (source)), 48);
});

test('getCellSize infers the grid cell size from width, columns, gap, and padding', (t) => {
  const { createElement, setComputedStyle } = installGeometryDomGlobals(t);
  const grid = createElement({ id: 'grid', width: 128 });
  setComputedStyle(grid, {
    cols: '4',
    gap: '4',
    pad: '10',
  });

  assert.equal(getCellSize(/** @type {any} */ (grid)), 24);
});

test('getCellSize falls back to the document cell variable and then the default size', (t) => {
  const { documentElement, setComputedStyle } = installGeometryDomGlobals(t);
  setComputedStyle(documentElement, { cell: '72' });
  assert.equal(getCellSize(null), 72);

  setComputedStyle(documentElement, {});
  assert.equal(getCellSize(null), 56);
});
