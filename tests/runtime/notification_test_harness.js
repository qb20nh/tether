export class FakeStyle {
  constructor() {
    this.map = new Map();
  }

  setProperty(name, value) {
    this.map.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.map.get(name) || '';
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  add(...names) {
    for (const name of names) this.owner._classSet.add(name);
  }

  remove(...names) {
    for (const name of names) this.owner._classSet.delete(name);
  }

  contains(name) {
    return this.owner._classSet.has(name);
  }

  toggle(name, force) {
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
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.id = '';
    this.ownerDocument = null;
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
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

  set className(value) {
    this._classSet = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
      child.isConnected = false;
    }
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(eventName, handler) {
    const key = String(eventName);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
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

  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    const handlers = this.listeners.get(payload.type) || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }

  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  closest(selector) {
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

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const out = [];
    if (!selector.startsWith('.')) return out;
    const className = selector.slice(1);

    const walk = (node) => {
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
  const elements = new Map();
  const listeners = new Map();
  const body = new FakeElement('body');
  const documentObj = {
    visibilityState: 'visible',
    body,
    activeElement: body,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentObj;
      return element;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener(eventName, handler) {
      const key = String(eventName);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) handler(event);
    },
    register(id, element) {
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

export const createWindowMock = (overrides = {}) => {
  let confirmValue = overrides.confirmValue ?? true;
  const confirmMessages = [];
  let intervalToken = 1;

  return {
    confirm(message) {
      confirmMessages.push(String(message));
      return confirmValue;
    },
    setConfirmValue(value) {
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
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() { },
    getComputedStyle() {
      return {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      };
    },
  };
};

export const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
