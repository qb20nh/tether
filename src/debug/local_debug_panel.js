const PANEL_ID = 'tetherLocalDebugPanel';
const STYLE_ID = 'tetherLocalDebugPanelStyle';
const LOGO_TEXT_SELECTOR = '.brandTitle > span';
const MIDDLE_DOUBLE_CLICK_WINDOW_MS = 360;
const TOGGLE_BIND_ATTR = 'data-debug-toggle-bound';

const ensurePanelStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      inset-inline-end: 10px;
      inset-block-end: 10px;
      z-index: 9999;
      inline-size: min(320px, calc(100dvw - 20px));
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(12, 16, 22, 0.95);
      color: #f5f7fa;
      padding: 10px;
      display: grid;
      gap: 8px;
      font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    }
    #${PANEL_ID} .debugRow {
      display: grid;
      gap: 4px;
    }
    #${PANEL_ID} .debugGrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    #${PANEL_ID} input,
    #${PANEL_ID} textarea,
    #${PANEL_ID} button {
      font: inherit;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.06);
      color: inherit;
      padding: 6px 8px;
    }
    #${PANEL_ID} textarea {
      resize: vertical;
      min-block-size: 54px;
    }
    #${PANEL_ID} button {
      cursor: pointer;
    }
    #${PANEL_ID} .debugTitle {
      font-weight: 700;
      letter-spacing: 0.2px;
    }
  `;
  document.head.appendChild(style);
};

const buildValue = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const setPanelVisible = (panelEl, visible) => {
  if (!panelEl) return;
  panelEl.hidden = !visible;
  panelEl.style.display = visible ? 'grid' : 'none';
  panelEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
};

const bindLogoToggle = (panelEl) => {
  if (!panelEl) return;
  const logoTextEl = document.querySelector(LOGO_TEXT_SELECTOR) || document.querySelector('.brandTitle');
  if (!logoTextEl) return;
  if (logoTextEl.getAttribute(TOGGLE_BIND_ATTR) === '1') return;
  logoTextEl.setAttribute(TOGGLE_BIND_ATTR, '1');

  let lastMiddleClickAt = 0;
  logoTextEl.addEventListener('mousedown', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();

    const clickAt = typeof event.timeStamp === 'number' ? event.timeStamp : Date.now();
    if (clickAt - lastMiddleClickAt <= MIDDLE_DOUBLE_CLICK_WINDOW_MS) {
      setPanelVisible(panelEl, panelEl.hidden);
      lastMiddleClickAt = 0;
      return;
    }
    lastMiddleClickAt = clickAt;
  });
};

export const mountLocalDebugPanel = (callbacks = {}) => {
  ensurePanelStyles();
  const existingRoot = document.getElementById(PANEL_ID);
  if (existingRoot) {
    setPanelVisible(existingRoot, false);
    bindLogoToggle(existingRoot);
    return;
  }

  const requestPermission = typeof callbacks.requestNotificationPermission === 'function'
    ? callbacks.requestNotificationPermission
    : async () => 'unsupported';
  const showToast = typeof callbacks.showToast === 'function'
    ? callbacks.showToast
    : () => {};
  const triggerSystemNotification = typeof callbacks.triggerSystemNotification === 'function'
    ? callbacks.triggerSystemNotification
    : async () => false;
  const clearNotifications = typeof callbacks.clearNotifications === 'function'
    ? callbacks.clearNotifications
    : async () => false;

  const root = document.createElement('section');
  root.id = PANEL_ID;
  setPanelVisible(root, false);

  const title = document.createElement('div');
  title.className = 'debugTitle';
  title.textContent = 'Local Debug';

  const titleRow = document.createElement('div');
  titleRow.className = 'debugRow';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title (optional)';
  titleRow.appendChild(titleInput);

  const bodyRow = document.createElement('div');
  bodyRow.className = 'debugRow';
  const bodyInput = document.createElement('textarea');
  bodyInput.placeholder = 'Body (optional)';
  bodyRow.appendChild(bodyInput);

  const buttonGrid = document.createElement('div');
  buttonGrid.className = 'debugGrid';

  const mkButton = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };

  buttonGrid.appendChild(mkButton('Permission', async () => {
    await requestPermission();
  }));

  buttonGrid.appendChild(mkButton('Toast', () => {
    const titleText = buildValue(titleInput.value, 'Debug toast');
    const bodyText = buildValue(bodyInput.value, '');
    const text = bodyText ? `${titleText}\n${bodyText}` : titleText;
    showToast(text, { recordInHistory: true });
  }));

  buttonGrid.appendChild(mkButton('System: Warning', async () => {
    await triggerSystemNotification({
      kind: 'unsolved-warning',
    });
  }));

  buttonGrid.appendChild(mkButton('System: New', async () => {
    await triggerSystemNotification({
      kind: 'new-level',
    });
  }));

  buttonGrid.appendChild(mkButton('Clear Notifications', async () => {
    await clearNotifications();
  }));

  root.appendChild(title);
  root.appendChild(titleRow);
  root.appendChild(bodyRow);
  root.appendChild(buttonGrid);
  document.body.appendChild(root);
  bindLogoToggle(root);
};
