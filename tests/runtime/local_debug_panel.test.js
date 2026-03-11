import assert from 'node:assert/strict';
import test from 'node:test';
import { mountLocalDebugPanel } from '../../src/debug/local_debug_panel.js';

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  contains(name) {
    return this.owner.classSet.has(name);
  }

  toggle(name, force) {
    if (force === true) {
      this.owner.classSet.add(name);
      return true;
    }
    if (force === false) {
      this.owner.classSet.delete(name);
      return false;
    }
    if (this.owner.classSet.has(name)) {
      this.owner.classSet.delete(name);
      return false;
    }
    this.owner.classSet.add(name);
    return true;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classSet = new Set();
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.checked = false;
    this.tabIndex = 0;
    this.type = '';
    this.id = '';
    this.value = '';
    this.placeholder = '';
    this._textContent = '';
  }

  get className() {
    return Array.from(this.classSet).join(' ');
  }

  set className(value) {
    this.classSet = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.classList = new FakeClassList(this);
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    const normalizedValue = String(value);
    this.attributes.set(name, normalizedValue);
    if (name === 'id') this.id = normalizedValue;
    if (name === 'class') this.className = normalizedValue;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(eventName, handler) {
    const key = String(eventName);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }

  dispatchEvent(event = {}) {
    const originalPreventDefault = typeof event.preventDefault === 'function'
      ? event.preventDefault.bind(event)
      : null;
    const payload = {
      ...event,
      currentTarget: this,
      target: event.target || this,
      defaultPrevented: false,
    };
    payload.preventDefault = () => {
      payload.defaultPrevented = true;
      originalPreventDefault?.();
    };
    const handlers = this.listeners.get(payload.type) || [];
    handlers.forEach((handler) => handler(payload));
    return !payload.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
}

const walkTree = (root, visit) => {
  for (const child of root.children) {
    if (visit(child)) return child;
    const nested = walkTree(child, visit);
    if (nested) return nested;
  }
  return null;
};

const findById = (root, id) => {
  if (root.id === id) return root;
  return walkTree(root, (node) => node.id === id);
};

const findByClass = (root, className) => {
  if (root.classList.contains(className)) return root;
  return walkTree(root, (node) => node.classList.contains(className));
};

const createDocumentHarness = (animations = []) => {
  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');

  const documentObj = {
    documentElement,
    head,
    body,
    activeElement: body,
    createElement(tagName) {
      return new FakeElement(tagName, documentObj);
    },
    getElementById(id) {
      return findById(head, id) || findById(body, id);
    },
    querySelector(selector) {
      if (selector === '.brandTitle > span') {
        const brandTitle = findByClass(body, 'brandTitle');
        return brandTitle?.children.find((child) => child.tagName === 'SPAN') || null;
      }
      if (selector === '.brandTitle') {
        return findByClass(body, 'brandTitle');
      }
      return null;
    },
    getAnimations() {
      return animations;
    },
  };

  documentElement.ownerDocument = documentObj;
  head.ownerDocument = documentObj;
  body.ownerDocument = documentObj;

  return documentObj;
};

const findButtonByText = (root, text) => walkTree(root, (node) => (
  node.tagName === 'BUTTON' && node.textContent === text
));

test('local debug panel mounts with tabs and animation controls', () => {
  const animation = { playbackRate: 1 };
  const documentObj = createDocumentHarness([animation]);
  const rafCallbacks = [];
  const canceledRafIds = [];
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  globalThis.window = {
    matchMedia: () => ({ matches: false, media: '(prefers-reduced-motion: reduce)' }),
    location: {
      reload() { },
    },
  };
  globalThis.document = documentObj;
  globalThis.requestAnimationFrame = (callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  globalThis.cancelAnimationFrame = (id) => {
    canceledRafIds.push(id);
  };

  try {
    mountLocalDebugPanel();

    const root = documentObj.getElementById('tetherLocalDebugPanel');
    const notificationButton = documentObj.getElementById('tetherLocalDebugPanelTabNotification');
    const dailyButton = documentObj.getElementById('tetherLocalDebugPanelTabDaily');
    const animationButton = documentObj.getElementById('tetherLocalDebugPanelTabAnimation');
    const notificationPanel = documentObj.getElementById('tetherLocalDebugPanelPanelNotification');
    const dailyPanel = documentObj.getElementById('tetherLocalDebugPanelPanelDaily');
    const animationPanel = documentObj.getElementById('tetherLocalDebugPanelPanelAnimation');

    assert.ok(root);
    assert.equal(root.hidden, true);
    assert.equal(notificationPanel.hidden, false);
    assert.equal(dailyPanel.hidden, true);
    assert.equal(animationPanel.hidden, true);
    assert.equal(notificationButton.getAttribute('aria-selected'), 'true');
    assert.equal(dailyButton.getAttribute('aria-selected'), 'false');

    let prevented = false;
    notificationButton.dispatchEvent({
      type: 'keydown',
      key: 'ArrowRight',
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(documentObj.activeElement, dailyButton);
    assert.equal(notificationPanel.hidden, true);
    assert.equal(dailyPanel.hidden, false);

    animationButton.click();
    assert.equal(animationPanel.hidden, false);
    assert.equal(animationButton.getAttribute('aria-selected'), 'true');

    const slowerButton = findButtonByText(animationPanel, 'Speed: 0.25x (4x slower)');
    const normalSpeedButton = findButtonByText(animationPanel, 'Speed: 1x');
    slowerButton.click();
    assert.equal(globalThis.window.TETHER_DEBUG_ANIM_SPEED, 4);
    assert.equal(animation.playbackRate, 0.25);
    assert.equal(rafCallbacks.length, 1);

    normalSpeedButton.click();
    assert.equal(globalThis.window.TETHER_DEBUG_ANIM_SPEED, 1);
    assert.equal(animation.playbackRate, 1);
    assert.deepEqual(canceledRafIds, [1]);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  }
});
