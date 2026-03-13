export class FakeStyle {
  [key: string]: any;
  constructor() {
    this.map = new Map<string, string>();
  }

  setProperty(name: string, value: string) {
    this.map.set(name, String(value));
  }

  getPropertyValue(name: string) {
    return this.map.get(name) || '';
  }
}

class FakeClassList {
  [key: string]: any;
  constructor(owner: FakeElement) {
    this.owner = owner;
  }

  add(...names: string[]) {
    for (const name of names) this.owner._classSet.add(name);
  }

  remove(...names: string[]) {
    for (const name of names) this.owner._classSet.delete(name);
  }

  contains(name: string) {
    return this.owner._classSet.has(name);
  }

  toggle(name: string, force?: boolean) {
    if (force === true) {
      this.owner._classSet.add(name);
      return true;
    }
    if (force === false) {
      this.owner._classSet.delete(name);
      return false;
    }
    if (this.owner._classSet.has(name)) {
      this.owner._classSet.delete(name);
      return false;
    }
    this.owner._classSet.add(name);
    return true;
  }
}

export class FakeElement {
  [key: string]: any;
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.id = '';
    this.ownerDocument = null;
    this.parentNode = null;
    this.children = [] as FakeElement[];
    this.listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
    this.attributes = new Map<string, string>();
    this.dataset = {};
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.returnValue = '';
    this.style = new FakeStyle();
    this._textContent = '';
    this._classSet = new Set();
    this.classList = new FakeClassList(this);
    this.isConnected = true;
  }

  get className() {
    return Array.from(this._classSet).join(' ');
  }

  set className(value: string) {
    this._classSet = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child: FakeElement) => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value: string) {
    this._textContent = String(value || '');
    this.children = [];
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
      child.isConnected = false;
    }
    return child;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
    const key = String(eventName);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }

  removeEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
    const key = String(eventName);
    const handlers = this.listeners.get(key);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
    this.dispatchEvent({ type: 'focus', target: this });
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body || null;
    }
    this.dispatchEvent({ type: 'blur', target: this });
  }

  dispatchEvent(event: Record<string, unknown>) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    const handlers = this.listeners.get(payload.type) || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }

  contains(node: FakeElement | null) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  closest(selector: string) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    if (this.classList.contains(className)) return this;
    let node = this.parentNode;
    while (node) {
      if (node.classList.contains(className)) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector: string) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string) {
    const out: FakeElement[] = [];
    if (!selector.startsWith('.')) return out;
    const className = selector.slice(1);

    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.classList.contains(className)) out.push(child);
        walk(child);
      }
    };

    walk(this);
    return out;
  }
}

export const createDocumentMock = () => {
  const elements = new Map<string, FakeElement>();
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const body = new FakeElement('body');
  const documentObj: any = {
    visibilityState: 'visible',
    body,
    activeElement: body,
    createElement(tagName: string) {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentObj;
      return element;
    },
    getElementById(id: string) {
      return elements.get(id) || null;
    },
    addEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
      const key = String(eventName);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key)!.push(handler);
    },
    removeEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
      const key = String(eventName);
      const handlers = listeners.get(key);
      if (!handlers) return;
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    dispatchEvent(event: Record<string, unknown>) {
      const handlers = listeners.get(String(event.type)) || [];
      for (const handler of handlers) handler(event);
    },
    register(id: string, element: FakeElement) {
      element.id = id;
      element.ownerDocument = documentObj;
      elements.set(id, element);
      documentObj.body.appendChild(element);
      return element;
    },
  };

  body.ownerDocument = documentObj;

  return documentObj;
};

export const createWindowMock = (overrides: any = {}) => {
  let confirmValue = overrides.confirmValue ?? true;
  const confirmMessages: string[] = [];
  let intervalToken = 1;
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();

  return {
    confirm(message: string) {
      confirmMessages.push(String(message));
      return confirmValue;
    },
    setConfirmValue(value: boolean) {
      confirmValue = value;
    },
    getConfirmMessages() {
      return confirmMessages;
    },
    setInterval() {
      intervalToken += 1;
      return intervalToken;
    },
    clearInterval() { },
    requestAnimationFrame(callback: () => void) {
      callback();
      return 1;
    },
    cancelAnimationFrame() { },
    getComputedStyle(_node?: unknown) {
      return {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      };
    },
    addEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
      const key = String(eventName);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key)!.push(handler);
    },
    removeEventListener(eventName: string, handler: (event: Record<string, unknown>) => void) {
      const key = String(eventName);
      const handlers = listeners.get(key);
      if (!handlers) return;
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
  };
};

export const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
