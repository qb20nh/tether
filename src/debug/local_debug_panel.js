const PANEL_ID = 'tetherLocalDebugPanel';
const STYLE_ID = 'tetherLocalDebugPanelStyle';
const LOGO_TEXT_SELECTOR = '.brandTitle > span';
const MIDDLE_DOUBLE_CLICK_WINDOW_MS = 360;
const TOGGLE_BIND_ATTR = 'data-debug-toggle-bound';
const DEBUG_TAB_NOTIFICATION = 'notification';
const DEBUG_TAB_DAILY = 'daily';

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
    : () => { };
  const triggerSystemNotification = typeof callbacks.triggerSystemNotification === 'function'
    ? callbacks.triggerSystemNotification
    : async () => false;
  const clearNotifications = typeof callbacks.clearNotifications === 'function'
    ? callbacks.clearNotifications
    : async () => false;
  const fetchDailyPayload = typeof callbacks.fetchDailyPayload === 'function'
    ? callbacks.fetchDailyPayload
    : async () => null;
  const runDailyCheck = typeof callbacks.runDailyCheck === 'function'
    ? callbacks.runDailyCheck
    : async () => false;
  const readDailyDebugSnapshot = typeof callbacks.readDailyDebugSnapshot === 'function'
    ? callbacks.readDailyDebugSnapshot
    : () => null;
  const toggleForceDailyFrozenState = typeof callbacks.toggleForceDailyFrozenState === 'function'
    ? callbacks.toggleForceDailyFrozenState
    : () => null;
  const reloadApp = typeof callbacks.reloadApp === 'function'
    ? callbacks.reloadApp
    : () => window.location.reload();

  const root = document.createElement('section');
  root.id = PANEL_ID;
  setPanelVisible(root, false);

  const title = document.createElement('div');
  title.className = 'debugTitle';
  title.textContent = 'Local Debug';

  const tabs = document.createElement('div');
  tabs.className = 'debugTabs';
  tabs.setAttribute('role', 'tablist');
  const notificationTabBtn = document.createElement('button');
  notificationTabBtn.type = 'button';
  notificationTabBtn.className = 'debugTabBtn';
  notificationTabBtn.textContent = 'Notifications';
  notificationTabBtn.id = `${PANEL_ID}TabNotification`;
  notificationTabBtn.setAttribute('role', 'tab');
  notificationTabBtn.setAttribute('aria-controls', `${PANEL_ID}PanelNotification`);
  const dailyTabBtn = document.createElement('button');
  dailyTabBtn.type = 'button';
  dailyTabBtn.className = 'debugTabBtn';
  dailyTabBtn.textContent = 'Daily';
  dailyTabBtn.id = `${PANEL_ID}TabDaily`;
  dailyTabBtn.setAttribute('role', 'tab');
  dailyTabBtn.setAttribute('aria-controls', `${PANEL_ID}PanelDaily`);
  tabs.appendChild(notificationTabBtn);
  tabs.appendChild(dailyTabBtn);

  const notificationTab = document.createElement('div');
  notificationTab.className = 'debugTabPanel';
  notificationTab.dataset.tab = DEBUG_TAB_NOTIFICATION;
  notificationTab.id = `${PANEL_ID}PanelNotification`;
  notificationTab.setAttribute('role', 'tabpanel');
  notificationTab.setAttribute('aria-labelledby', notificationTabBtn.id);

  const dailyTab = document.createElement('div');
  dailyTab.className = 'debugTabPanel';
  dailyTab.dataset.tab = DEBUG_TAB_DAILY;
  dailyTab.id = `${PANEL_ID}PanelDaily`;
  dailyTab.setAttribute('role', 'tabpanel');
  dailyTab.setAttribute('aria-labelledby', dailyTabBtn.id);

  const animationTabBtn = document.createElement('button');
  animationTabBtn.type = 'button';
  animationTabBtn.className = 'debugTabBtn';
  animationTabBtn.textContent = 'Animations';
  animationTabBtn.id = `${PANEL_ID}TabAnimation`;
  animationTabBtn.setAttribute('role', 'tab');
  animationTabBtn.setAttribute('aria-controls', `${PANEL_ID}PanelAnimation`);
  tabs.appendChild(animationTabBtn);

  const animationTab = document.createElement('div');
  animationTab.className = 'debugTabPanel';
  animationTab.dataset.tab = 'animation';
  animationTab.id = `${PANEL_ID}PanelAnimation`;
  animationTab.setAttribute('role', 'tabpanel');
  animationTab.setAttribute('aria-labelledby', animationTabBtn.id);

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

  notificationTab.appendChild(titleRow);
  notificationTab.appendChild(bodyRow);
  notificationTab.appendChild(buttonGrid);

  const dailyOutput = document.createElement('pre');
  dailyOutput.className = 'debugOutput';
  setDebugOutput(dailyOutput, 'Daily debug output');

  const dailyButtons = document.createElement('div');
  dailyButtons.className = 'debugGrid';
  dailyButtons.appendChild(mkButton('Snapshot', () => {
    setDebugOutput(dailyOutput, {
      nowIsoUtc: new Date().toISOString(),
      snapshot: readDailyDebugSnapshot(),
    });
  }));
  dailyButtons.appendChild(mkButton('Run Daily Check', async () => {
    const ok = await runDailyCheck();
    setDebugOutput(dailyOutput, {
      nowIsoUtc: new Date().toISOString(),
      action: 'runDailyCheck',
      ok,
    });
  }));
  dailyButtons.appendChild(mkButton('Toggle Force Frozen', () => {
    const nextState = toggleForceDailyFrozenState();
    setDebugOutput(dailyOutput, {
      nowIsoUtc: new Date().toISOString(),
      action: 'toggleForceFrozen',
      state: nextState,
    });
  }));
  dailyButtons.appendChild(mkButton('Fetch Daily', async () => {
    const payload = await fetchDailyPayload({ bypassCache: false });
    setDebugOutput(dailyOutput, {
      nowIsoUtc: new Date().toISOString(),
      bypassCache: false,
      payload: summarizeDailyPayload(payload),
    });
  }));
  dailyButtons.appendChild(mkButton('Fetch Daily (Bypass)', async () => {
    const payload = await fetchDailyPayload({ bypassCache: true });
    setDebugOutput(dailyOutput, {
      nowIsoUtc: new Date().toISOString(),
      bypassCache: true,
      payload: summarizeDailyPayload(payload),
    });
  }));
  dailyButtons.appendChild(mkButton('Reload App', () => {
    reloadApp();
  }));

  dailyTab.appendChild(dailyButtons);
  dailyTab.appendChild(dailyOutput);

  if (typeof window.TETHER_DEBUG_ANIM_SPEED !== 'number') {
    window.TETHER_DEBUG_ANIM_SPEED = 1;
  }
  const animationButtons = document.createElement('div');
  animationButtons.className = 'debugGrid';
  let activeTabKey = DEBUG_TAB_NOTIFICATION;
  animationButtons.appendChild(mkButton('Speed: 1x', () => {
    window.TETHER_DEBUG_ANIM_SPEED = 1;
    refreshAnimationSync();
  }));
  animationButtons.appendChild(mkButton('Speed: 0.25x (4x slower)', () => {
    window.TETHER_DEBUG_ANIM_SPEED = 4;
    refreshAnimationSync();
  }));
  animationButtons.appendChild(mkButton('Speed: 0.1x (10x slower)', () => {
    window.TETHER_DEBUG_ANIM_SPEED = 10;
    refreshAnimationSync();
  }));
  animationTab.appendChild(animationButtons);

  let animationRafId = 0;
  const resolveAnimationSpeed = () => (
    typeof window.TETHER_DEBUG_ANIM_SPEED === 'number' ? window.TETHER_DEBUG_ANIM_SPEED : 1
  );
  const shouldSyncAnimations = () => (
    resolveAnimationSpeed() !== 1 || (activeTabKey === 'animation' && !root.hidden)
  );
  const stopAnimationSync = () => {
    if (!animationRafId) return;
    cancelAnimationFrame(animationRafId);
    animationRafId = 0;
  };
  const applyAnimationsSpeed = () => {
    const currentSpeed = resolveAnimationSpeed();
    const targetPlaybackRate = 1 / Math.max(0.1, currentSpeed);
    document.getAnimations().forEach((anim) => {
      if (anim.playbackRate !== targetPlaybackRate) {
        anim.playbackRate = targetPlaybackRate;
      }
    });
  };
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

  const setActiveTab = (tabKey) => {
    activeTabKey = tabKey;
    const useNotification = tabKey === DEBUG_TAB_NOTIFICATION;
    const useDaily = tabKey === DEBUG_TAB_DAILY;
    const useAnimation = tabKey === 'animation';
    notificationTab.hidden = !useNotification;
    dailyTab.hidden = !useDaily;
    animationTab.hidden = !useAnimation;
    notificationTabBtn.classList.toggle('isActive', useNotification);
    dailyTabBtn.classList.toggle('isActive', useDaily);
    animationTabBtn.classList.toggle('isActive', useAnimation);
    notificationTabBtn.setAttribute('aria-selected', useNotification ? 'true' : 'false');
    dailyTabBtn.setAttribute('aria-selected', useDaily ? 'true' : 'false');
    animationTabBtn.setAttribute('aria-selected', useAnimation ? 'true' : 'false');
    notificationTabBtn.tabIndex = useNotification ? 0 : -1;
    dailyTabBtn.tabIndex = useDaily ? 0 : -1;
    animationTabBtn.tabIndex = useAnimation ? 0 : -1;
    refreshAnimationSync();
  };
  const tabButtons = [notificationTabBtn, dailyTabBtn, animationTabBtn];
  tabButtons.forEach((button, index) => {
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (index + dir + tabButtons.length) % tabButtons.length;
      tabButtons[nextIndex].focus();
      setActiveTab(nextIndex === 0 ? DEBUG_TAB_NOTIFICATION : (nextIndex === 1 ? DEBUG_TAB_DAILY : 'animation'));
    });
  });
  notificationTabBtn.addEventListener('click', () => setActiveTab(DEBUG_TAB_NOTIFICATION));
  dailyTabBtn.addEventListener('click', () => setActiveTab(DEBUG_TAB_DAILY));
  animationTabBtn.addEventListener('click', () => setActiveTab('animation'));
  setActiveTab(DEBUG_TAB_NOTIFICATION);

  root.appendChild(title);
  root.appendChild(tabs);
  root.appendChild(notificationTab);
  root.appendChild(dailyTab);
  root.appendChild(animationTab);
  document.body.appendChild(root);
  bindLogoToggle(root, () => {
    refreshAnimationSync();
  });
};
