import assert from 'node:assert/strict';
import test from '../test.ts';
import { mountLocalDebugPanel } from '../../src/debug/local_debug_panel.ts';

const globalObject = (globalThis as any);

class FakeClassList {
  [key: string]: any;
  constructor(owner: FakeElement) {
    this.owner = owner;
  }

  contains(name: string) {
    return this.owner.classSet.has(name);
  }

  toggle(name: string, force?: boolean) {
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
  [key: string]: any;
  constructor(tagName: string, ownerDocument: Record<string, unknown> | null = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = (ownerDocument as any);
    this.parentNode = null;
    this.children = [] as FakeElement[];
    this.listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
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

  set className(value: string) {
    this.classSet = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.classList = new FakeClassList(this);
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child: FakeElement) => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value: string) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string) {
    const normalizedValue = String(value);
    this.attributes.set(name, normalizedValue);
    if (name === 'id') this.id = normalizedValue;
    if (name === 'class') this.className = normalizedValue;
  }

  getAttribute(name: string) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
    const key = String(eventName);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }

  dispatchEvent(event: Record<string, unknown> = {}) {
    const originalPreventDefault = typeof event.preventDefault === 'function'
      ? event.preventDefault.bind(event)
      : null;
    const payload = ({
      ...event,
      currentTarget: this,
      target: event.target || this,
      defaultPrevented: false,
    } as any);
    payload.preventDefault = () => {
      payload.defaultPrevented = true;
      originalPreventDefault?.();
    };
    const handlers = this.listeners.get(payload.type) || [];
    handlers.forEach((handler: (event: Record<string, unknown>) => void) => handler(payload));
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

const walkTree = (root: FakeElement, visit: (node: FakeElement) => boolean): FakeElement | null => {
  for (const child of root.children) {
    if (visit(child)) return child;
    const nested = walkTree(child, visit);
    if (nested) return nested;
  }
  return null;
};

const findById = (root: FakeElement, id: string): FakeElement | null => {
  if (root.id === id) return root;
  return walkTree(root, (node) => node.id === id);
};

const findByClass = (root: FakeElement, className: string): FakeElement | null => {
  if (root.classList.contains(className)) return root;
  return walkTree(root, (node) => node.classList.contains(className));
};

const createDocumentHarness = (animations: Array<{ playbackRate: number }> = []) => {
  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');

  const documentObj = {
    documentElement,
    head,
    body,
    activeElement: body,
    createElement(tagName: string) {
      return new FakeElement(tagName, (documentObj as any));
    },
    getElementById(id: string) {
      return findById(head, id) || findById(body, id);
    },
    querySelector(selector: string) {
      if (selector === '.brandTitle > span') {
        const brandTitle = findByClass(body, 'brandTitle');
        return brandTitle?.children.find((child: FakeElement) => child.tagName === 'SPAN') || null;
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

const findButtonByText = (root: FakeElement, text: string) => walkTree(root, (node) => (
  node.tagName === 'BUTTON' && node.textContent === text
));

test('local debug panel mounts with tabs and animation controls', () => {
  const animation = { playbackRate: 1 };
  const documentObj = createDocumentHarness([animation]);
  const rafCallbacks: Array<(timestamp: number) => void> = [];
  const canceledRafIds: number[] = [];
  const originalWindow = globalObject.window;
  const originalDocument = globalObject.document;
  const originalRaf = globalObject.requestAnimationFrame;
  const originalCancelRaf = globalObject.cancelAnimationFrame;

  globalObject.window = ({
    matchMedia: () => ({ matches: false, media: '(prefers-reduced-motion: reduce)' }),
    location: {
      reload() { },
    },
  } as any);
  globalObject.document = (documentObj as any);
  globalObject.requestAnimationFrame = (callback: (timestamp: number) => void) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  globalObject.cancelAnimationFrame = (id: number) => {
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
    assert.ok(notificationButton);
    assert.ok(dailyButton);
    assert.ok(animationButton);
    assert.ok(notificationPanel);
    assert.ok(dailyPanel);
    assert.ok(animationPanel);
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
    assert.ok(slowerButton);
    assert.ok(normalSpeedButton);
    slowerButton.click();
    assert.equal(globalObject.window.TETHER_DEBUG_ANIM_SPEED, 4);
    assert.equal(animation.playbackRate, 0.25);
    assert.equal(rafCallbacks.length, 1);

    normalSpeedButton.click();
    assert.equal(globalObject.window.TETHER_DEBUG_ANIM_SPEED, 1);
    assert.equal(animation.playbackRate, 1);
    assert.deepEqual(canceledRafIds, [1]);
  } finally {
    globalObject.window = originalWindow;
    globalObject.document = originalDocument;
    globalObject.requestAnimationFrame = originalRaf;
    globalObject.cancelAnimationFrame = originalCancelRaf;
  }
});

test('local debug panel notification and daily actions invoke callbacks', async () => {
  const documentObj = createDocumentHarness();
  const calls: Array<{ kind: string; payload?: unknown }> = [];
  const originalWindow = globalObject.window;
  const originalDocument = globalObject.document;
  const originalRaf = globalObject.requestAnimationFrame;
  const originalCancelRaf = globalObject.cancelAnimationFrame;

  globalObject.window = ({
    matchMedia: () => ({ matches: false, media: '(prefers-reduced-motion: reduce)' }),
    location: {
      reload() {
        calls.push({ kind: 'reload' });
      },
    },
  } as any);
  globalObject.document = (documentObj as any);
  globalObject.requestAnimationFrame = () => 1;
  globalObject.cancelAnimationFrame = () => {};

  try {
    mountLocalDebugPanel({
      requestNotificationPermission: async () => {
        calls.push({ kind: 'permission' });
        return 'granted';
      },
      showToast: (text: unknown) => {
        calls.push({ kind: 'toast', payload: String(text) });
      },
      triggerSystemNotification: async (payload?: { kind?: string }) => {
        calls.push({ kind: 'system', payload });
        return true;
      },
      clearNotifications: async () => {
        calls.push({ kind: 'clear' });
        return true;
      },
      readDailyDebugSnapshot: () => ({ frozen: false }),
      runDailyCheck: async () => {
        calls.push({ kind: 'daily-check' });
        return true;
      },
      toggleForceDailyFrozenState: () => {
        calls.push({ kind: 'toggle-frozen' });
        return { frozen: true };
      },
      fetchDailyPayload: async (payload?: { bypassCache?: boolean }) => {
        calls.push({ kind: 'fetch-daily', payload });
        return {
          dailyId: '2026-01-01',
          dailySlot: 1,
          generatedAtUtcMs: Date.UTC(2026, 0, 1),
          hardInvalidateAtUtcMs: Date.UTC(2026, 0, 2),
          level: {
            grid: ['..', '..'],
          },
        };
      },
      reloadApp: () => {
        calls.push({ kind: 'reload-app' });
      },
    });

    const root = documentObj.getElementById('tetherLocalDebugPanel');
    const dailyButton = documentObj.getElementById('tetherLocalDebugPanelTabDaily');
    assert.ok(root);
    assert.ok(dailyButton);

    findButtonByText(root, 'Permission')?.click();
    findButtonByText(root, 'Toast')?.click();
    findButtonByText(root, 'System: Warning')?.click();
    findButtonByText(root, 'Clear Notifications')?.click();
    dailyButton.click();
    findButtonByText(root, 'Snapshot')?.click();
    findButtonByText(root, 'Run Daily Check')?.click();
    findButtonByText(root, 'Toggle Force Frozen')?.click();
    findButtonByText(root, 'Fetch Daily (Bypass)')?.click();
    findButtonByText(root, 'Reload App')?.click();

    assert.equal(calls.some((entry) => entry.kind === 'permission'), true);
    assert.equal(calls.some((entry) => entry.kind === 'toast'), true);
    assert.equal(calls.some((entry) => entry.kind === 'system'), true);
    assert.equal(calls.some((entry) => entry.kind === 'clear'), true);
    assert.equal(calls.some((entry) => entry.kind === 'daily-check'), true);
    assert.equal(calls.some((entry) => entry.kind === 'toggle-frozen'), true);
    assert.equal(calls.some((entry) => entry.kind === 'fetch-daily' && (entry.payload as { bypassCache?: boolean })?.bypassCache === true), true);
    assert.equal(calls.some((entry) => entry.kind === 'reload-app'), true);
  } finally {
    globalObject.window = originalWindow;
    globalObject.document = originalDocument;
    globalObject.requestAnimationFrame = originalRaf;
    globalObject.cancelAnimationFrame = originalCancelRaf;
  }
});
