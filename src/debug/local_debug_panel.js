import {
  DEBUG_REDUCED_MOTION_CLASS,
  readDebugReducedMotionSimulation,
  setDebugReducedMotionSimulation,
} from './reduced_motion_debug.js';

const PANEL_ID = 'tetherLocalDebugPanel';
const STYLE_ID = 'tetherLocalDebugPanelStyle';
const LOGO_TEXT_SELECTOR = '.brandTitle > span';
const MIDDLE_DOUBLE_CLICK_WINDOW_MS = 360;
const TOGGLE_BIND_ATTR = 'data-debug-toggle-bound';
const DEBUG_TAB_NOTIFICATION = 'notification';
const DEBUG_TAB_DAILY = 'daily';
const DEBUG_TAB_ANIMATION = 'animation';

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
    #${PANEL_ID} .debugCheckbox {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
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
    #${PANEL_ID} input[type='checkbox'] {
      inline-size: 14px;
      block-size: 14px;
      margin: 0;
      padding: 0;
      accent-color: #7dd3fc;
    }
    #${PANEL_ID} button {
      cursor: pointer;
    }
    #${PANEL_ID} .debugTitle {
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    #${PANEL_ID} .debugTabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.22);
      padding: 0 2px;
    }
    #${PANEL_ID} .debugTabBtn {
      flex: 1;
      text-align: center;
      border-radius: 8px 8px 0 0;
      border: 1px solid transparent;
      border-bottom: none;
      background: rgba(255, 255, 255, 0.02);
      color: rgba(245, 247, 250, 0.82);
    }
    #${PANEL_ID} .debugTabBtn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #f5f7fa;
    }
    #${PANEL_ID} .debugTabBtn[aria-selected='true'] {
      background: rgba(255, 255, 255, 0.22);
      border-color: rgba(255, 255, 255, 0.42);
      color: #ffffff;
      transform: translateY(1px);
    }
    #${PANEL_ID} .debugTabPanel {
      display: grid;
      gap: 8px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 0 8px 8px 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 8px;
    }
    #${PANEL_ID} .debugTabPanel[hidden] {
      display: none;
    }
    #${PANEL_ID} .debugOutput {
      margin: 0;
      min-block-size: 72px;
      max-block-size: 180px;
      overflow: auto;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.03);
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    :root.${DEBUG_REDUCED_MOTION_CLASS} .boardWrap {
      --complete-cascade-total-ms: 0ms;
      --complete-cascade-cell-ms: 0ms;
      --complete-step-ms: 0ms;
      --complete-cell-duration-ms: 0ms;
      --complete-done-pulse-ms: 0ms;
      --complete-done-pulse-step-ms: 0ms;
    }
    :root.${DEBUG_REDUCED_MOTION_CLASS} #grid {
      animation: none;
    }
  `;
  document.head.appendChild(style);
};

const buildValue = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const summarizeDailyPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const grid = Array.isArray(payload.level?.grid) ? payload.level.grid : [];
  return {
    dailyId: typeof payload.dailyId === 'string' ? payload.dailyId : null,
    hardInvalidateAtUtcMs: Number.parseInt(payload.hardInvalidateAtUtcMs, 10) || null,
    generatedAtUtcMs: Number.parseInt(payload.generatedAtUtcMs, 10) || null,
    dailySlot: Number.parseInt(payload.dailySlot, 10) || null,
    levelName: typeof payload.level?.name === 'string' ? payload.level.name : null,
    rows: grid.length,
    cols: grid.length > 0 ? String(grid[0] || '').length : 0,
  };
};

const formatDebugOutput = (value) => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const setDebugOutput = (outputEl, value) => {
  if (!outputEl) return;
  outputEl.textContent = formatDebugOutput(value);
};

const setPanelVisible = (panelEl, visible) => {
  if (!panelEl) return;
  panelEl.hidden = !visible;
  panelEl.style.display = visible ? 'grid' : 'none';
  panelEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
};

const bindLogoToggle = (panelEl, onToggle = () => {}) => {
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
      const nextVisible = panelEl.hidden;
      setPanelVisible(panelEl, nextVisible);
      onToggle(nextVisible);
      lastMiddleClickAt = 0;
      return;
    }
    lastMiddleClickAt = clickAt;
  });
};

const resolveFunction = (value, fallback) => (
  typeof value === 'function' ? value : fallback
);

const resolvePanelCallbacks = (callbacks = {}) => ({
  requestPermission: resolveFunction(callbacks.requestNotificationPermission, async () => 'unsupported'),
  showToast: resolveFunction(callbacks.showToast, () => { }),
  triggerSystemNotification: resolveFunction(callbacks.triggerSystemNotification, async () => false),
  clearNotifications: resolveFunction(callbacks.clearNotifications, async () => false),
  fetchDailyPayload: resolveFunction(callbacks.fetchDailyPayload, async () => null),
  runDailyCheck: resolveFunction(callbacks.runDailyCheck, async () => false),
  readDailyDebugSnapshot: resolveFunction(callbacks.readDailyDebugSnapshot, () => null),
  toggleForceDailyFrozenState: resolveFunction(callbacks.toggleForceDailyFrozenState, () => null),
  reloadApp: resolveFunction(callbacks.reloadApp, () => window.location.reload()),
});

const createDebugButton = (label, onClick) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
};

const appendDebugButtons = (container, buttons) => {
  buttons.forEach(({ label, onClick }) => {
    container.appendChild(createDebugButton(label, onClick));
  });
};

const createTabEntry = ({ key, label, suffix }) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'debugTabBtn';
  button.textContent = label;
  button.id = `${PANEL_ID}Tab${suffix}`;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', `${PANEL_ID}Panel${suffix}`);

  const panel = document.createElement('div');
  panel.className = 'debugTabPanel';
  panel.dataset.tab = key;
  panel.id = `${PANEL_ID}Panel${suffix}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', button.id);

  return { key, button, panel };
};

const createTabLayout = () => {
  const tabs = document.createElement('div');
  tabs.className = 'debugTabs';
  tabs.setAttribute('role', 'tablist');

  const notificationEntry = createTabEntry({
    key: DEBUG_TAB_NOTIFICATION,
    label: 'Notifications',
    suffix: 'Notification',
  });
  const dailyEntry = createTabEntry({
    key: DEBUG_TAB_DAILY,
    label: 'Daily',
    suffix: 'Daily',
  });
  const animationEntry = createTabEntry({
    key: DEBUG_TAB_ANIMATION,
    label: 'Animations',
    suffix: 'Animation',
  });
  const tabEntries = [notificationEntry, dailyEntry, animationEntry];

  tabEntries.forEach(({ button }) => {
    tabs.appendChild(button);
  });

  return {
    tabs,
    tabEntries,
    notificationEntry,
    dailyEntry,
    animationEntry,
  };
};

const createNotificationTabContent = (panel, callbacks) => {
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
  appendDebugButtons(buttonGrid, [
    {
      label: 'Permission',
      onClick: async () => {
        await callbacks.requestPermission();
      },
    },
    {
      label: 'Toast',
      onClick: () => {
        const titleText = buildValue(titleInput.value, 'Debug toast');
        const bodyText = buildValue(bodyInput.value, '');
        const text = bodyText ? `${titleText}\n${bodyText}` : titleText;
        callbacks.showToast(text, { recordInHistory: true });
      },
    },
    {
      label: 'System: Warning',
      onClick: async () => {
        await callbacks.triggerSystemNotification({
          kind: 'unsolved-warning',
        });
      },
    },
    {
      label: 'System: New',
      onClick: async () => {
        await callbacks.triggerSystemNotification({
          kind: 'new-level',
        });
      },
    },
    {
      label: 'Clear Notifications',
      onClick: async () => {
        await callbacks.clearNotifications();
      },
    },
  ]);

  panel.appendChild(titleRow);
  panel.appendChild(bodyRow);
  panel.appendChild(buttonGrid);
};

const createDailyTabContent = (panel, callbacks) => {
  const dailyOutput = document.createElement('pre');
  dailyOutput.className = 'debugOutput';
  setDebugOutput(dailyOutput, 'Daily debug output');

  const dailyButtons = document.createElement('div');
  dailyButtons.className = 'debugGrid';
  appendDebugButtons(dailyButtons, [
    {
      label: 'Snapshot',
      onClick: () => {
        setDebugOutput(dailyOutput, {
          nowIsoUtc: new Date().toISOString(),
          snapshot: callbacks.readDailyDebugSnapshot(),
        });
      },
    },
    {
      label: 'Run Daily Check',
      onClick: async () => {
        const ok = await callbacks.runDailyCheck();
        setDebugOutput(dailyOutput, {
          nowIsoUtc: new Date().toISOString(),
          action: 'runDailyCheck',
          ok,
        });
      },
    },
    {
      label: 'Toggle Force Frozen',
      onClick: () => {
        const nextState = callbacks.toggleForceDailyFrozenState();
        setDebugOutput(dailyOutput, {
          nowIsoUtc: new Date().toISOString(),
          action: 'toggleForceFrozen',
          state: nextState,
        });
      },
    },
    {
      label: 'Fetch Daily',
      onClick: async () => {
        const payload = await callbacks.fetchDailyPayload({ bypassCache: false });
        setDebugOutput(dailyOutput, {
          nowIsoUtc: new Date().toISOString(),
          bypassCache: false,
          payload: summarizeDailyPayload(payload),
        });
      },
    },
    {
      label: 'Fetch Daily (Bypass)',
      onClick: async () => {
        const payload = await callbacks.fetchDailyPayload({ bypassCache: true });
        setDebugOutput(dailyOutput, {
          nowIsoUtc: new Date().toISOString(),
          bypassCache: true,
          payload: summarizeDailyPayload(payload),
        });
      },
    },
    {
      label: 'Reload App',
      onClick: () => {
        callbacks.reloadApp();
      },
    },
  ]);

  panel.appendChild(dailyButtons);
  panel.appendChild(dailyOutput);
};

const ensureAnimationDebugSpeed = () => {
  if (typeof window.TETHER_DEBUG_ANIM_SPEED !== 'number') {
    window.TETHER_DEBUG_ANIM_SPEED = 1;
  }
};

const resolveAnimationSpeed = () => (
  typeof window.TETHER_DEBUG_ANIM_SPEED === 'number' ? window.TETHER_DEBUG_ANIM_SPEED : 1
);

const createAnimationTabController = (root, panel) => {
  ensureAnimationDebugSpeed();

  const animationButtons = document.createElement('div');
  animationButtons.className = 'debugGrid';
  const reducedMotionToggleLabel = document.createElement('label');
  reducedMotionToggleLabel.className = 'debugCheckbox';
  const reducedMotionToggle = document.createElement('input');
  reducedMotionToggle.type = 'checkbox';
  reducedMotionToggle.checked = setDebugReducedMotionSimulation(readDebugReducedMotionSimulation());
  const reducedMotionToggleText = document.createElement('span');
  reducedMotionToggleText.textContent = 'Simulate prefers-reduced-motion';
  reducedMotionToggleLabel.appendChild(reducedMotionToggle);
  reducedMotionToggleLabel.appendChild(reducedMotionToggleText);

  let animationRafId = 0;
  let animationTabActive = false;

  const stopAnimationSync = () => {
    if (!animationRafId) return;
    cancelAnimationFrame(animationRafId);
    animationRafId = 0;
  };

  const applyAnimationsSpeed = () => {
    const targetPlaybackRate = 1 / Math.max(0.1, resolveAnimationSpeed());
    document.getAnimations().forEach((anim) => {
      if (anim.playbackRate !== targetPlaybackRate) {
        anim.playbackRate = targetPlaybackRate;
      }
    });
  };

  const shouldSyncAnimations = () => (
    resolveAnimationSpeed() !== 1 || (animationTabActive && !root.hidden)
  );

  const syncAnimationsSpeed = () => {
    applyAnimationsSpeed();
    if (!shouldSyncAnimations()) {
      animationRafId = 0;
      return;
    }
    animationRafId = requestAnimationFrame(syncAnimationsSpeed);
  };

  const refreshAnimationSync = () => {
    applyAnimationsSpeed();
    if (shouldSyncAnimations()) {
      if (!animationRafId) {
        animationRafId = requestAnimationFrame(syncAnimationsSpeed);
      }
      return;
    }
    stopAnimationSync();
  };

  reducedMotionToggle.addEventListener('change', () => {
    reducedMotionToggle.checked = setDebugReducedMotionSimulation(reducedMotionToggle.checked);
    refreshAnimationSync();
  });

  appendDebugButtons(animationButtons, [
    {
      label: 'Speed: 1x',
      onClick: () => {
        window.TETHER_DEBUG_ANIM_SPEED = 1;
        refreshAnimationSync();
      },
    },
    {
      label: 'Speed: 0.25x (4x slower)',
      onClick: () => {
        window.TETHER_DEBUG_ANIM_SPEED = 4;
        refreshAnimationSync();
      },
    },
    {
      label: 'Speed: 0.1x (10x slower)',
      onClick: () => {
        window.TETHER_DEBUG_ANIM_SPEED = 10;
        refreshAnimationSync();
      },
    },
  ]);

  panel.appendChild(reducedMotionToggleLabel);
  panel.appendChild(animationButtons);

  return {
    refreshAnimationSync,
    setAnimationTabActive(isActive) {
      animationTabActive = isActive;
      refreshAnimationSync();
    },
  };
};

const applyActiveTab = (tabEntries, activeTabKey) => {
  tabEntries.forEach(({ key, button, panel }) => {
    const isActive = key === activeTabKey;
    panel.hidden = !isActive;
    button.classList.toggle('isActive', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });
};

const bindTabInteractions = (tabEntries, onTabChange) => {
  tabEntries.forEach(({ key, button }, index) => {
    button.addEventListener('click', () => onTabChange(key));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();

      const dir = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (index + dir + tabEntries.length) % tabEntries.length;
      const nextEntry = tabEntries[nextIndex];
      nextEntry.button.focus();
      onTabChange(nextEntry.key);
    });
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

  const panelCallbacks = resolvePanelCallbacks(callbacks);

  const root = document.createElement('section');
  root.id = PANEL_ID;
  setPanelVisible(root, false);

  const title = document.createElement('div');
  title.className = 'debugTitle';
  title.textContent = 'Local Debug';

  const {
    tabs,
    tabEntries,
    notificationEntry,
    dailyEntry,
    animationEntry,
  } = createTabLayout();
  createNotificationTabContent(notificationEntry.panel, panelCallbacks);
  createDailyTabContent(dailyEntry.panel, panelCallbacks);
  const animationController = createAnimationTabController(root, animationEntry.panel);

  const setActiveTab = (tabKey) => {
    applyActiveTab(tabEntries, tabKey);
    animationController.setAnimationTabActive(tabKey === DEBUG_TAB_ANIMATION);
  };

  bindTabInteractions(tabEntries, setActiveTab);
  setActiveTab(DEBUG_TAB_NOTIFICATION);

  root.appendChild(title);
  root.appendChild(tabs);
  tabEntries.forEach(({ panel }) => {
    root.appendChild(panel);
  });
  document.body.appendChild(root);
  bindLogoToggle(root, () => {
    animationController.refreshAnimationSync();
  });
};
