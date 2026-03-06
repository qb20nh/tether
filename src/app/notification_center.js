import {
  HISTORY_DOT_COLORS,
  formatHistoryAbsoluteTime,
  formatHistoryRelativeTime,
  hasUnreadSystemHistory,
  historyEntryDotColor,
  normalizeHistoryAction,
} from '../runtime/notification_history.js';

const HISTORY_RELATIVE_TIME_REFRESH_MS = 60 * 1000;
const HISTORY_MAX_ENTRIES = 10;
const HISTORY_DYING_START_INDEX = 5;
const HISTORY_EMPTY_PLACEHOLDER_TEXT = 'No notifications yet.';

export function createNotificationCenter(options = {}) {
  const {
    elementIds,
    swMessageTypes,
    localBuildNumber = 0,
    notificationEnabledKey,
    autoUpdateEnabledKey,
    notificationAutoPromptDecisions,
    readAutoPromptDecision = () => notificationAutoPromptDecisions?.UNSET,
    writeAutoPromptDecision = () => { },
    readNotificationEnabledPreference = () => false,
    writeNotificationEnabledPreference = () => { },
    readAutoUpdateEnabledPreference = () => false,
    writeAutoUpdateEnabledPreference = () => { },
    hasStoredNotificationEnabledPreference = () => false,
    notificationPermissionState = () => 'unsupported',
    supportsNotifications = () => false,
    canUseServiceWorker = () => false,
    requestNotificationPermission = async () => 'unsupported',
    syncDailyStateToServiceWorker = async () => { },
    syncUpdatePolicyToServiceWorker = async () => { },
    registerBackgroundDailyCheck = async () => { },
    requestServiceWorkerDailyCheck = async () => { },
    postMessageToServiceWorker = async () => false,
    clearAppliedUpdateHistoryActions = async () => { },
    translateNow = (key) => key,
    getLocale = () => 'en',
    showInAppToast = () => { },
    onApplyUpdateRequested = async () => { },
    onOpenDailyRequested = async () => { },
    isOpenDailyHistoryActionable = () => true,
    windowObj = typeof window !== 'undefined' ? window : undefined,
    documentObj = typeof document !== 'undefined' ? document : undefined,
  } = options;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationCenter requires elementIds');
  }
  if (!swMessageTypes || typeof swMessageTypes !== 'object') {
    throw new Error('createNotificationCenter requires swMessageTypes');
  }

  let notificationsToggleEl = null;
  let notificationsToggleBound = false;
  let autoUpdateToggleEl = null;
  let autoUpdateToggleBound = false;
  let notificationHistoryToggleEl = null;
  let notificationHistoryBadgeEl = null;
  let notificationHistoryPanelEl = null;
  let notificationHistoryListEl = null;
  let notificationHistoryToggleBound = false;
  let notificationHistoryOpen = false;
  let notificationHistoryRefreshTimer = 0;
  let notificationHistoryReadAckInFlight = false;
  let notificationHistoryReadAckVersion = null;
  let notificationHistoryValidationFrame = 0;
  let updateApplyDialogEl = null;
  let updateApplyMessageEl = null;
  let updateApplyDialogBound = false;
  let moveDailyDialogEl = null;
  let moveDailyMessageEl = null;
  let moveDailyDialogBound = false;
  let moveDailyDialogResolver = null;
  let updateApplyDialogResolver = null;

  const notificationHistoryState = {
    historyVersion: 1,
    entries: [],
  };

  const refreshNotificationsToggleUi = () => {
    if (!notificationsToggleEl) return;
    const enabled = readNotificationEnabledPreference();
    const permission = notificationPermissionState();
    notificationsToggleEl.checked = enabled;
    notificationsToggleEl.disabled = permission === 'unsupported';
  };

  const refreshAutoUpdateToggleUi = () => {
    if (!autoUpdateToggleEl) return;
    autoUpdateToggleEl.checked = readAutoUpdateEnabledPreference();
  };

  const resolveUpdateApplyDialogPromptText = (buildNumber = null) => {
    const prompt = translateNow('ui.updateApplyDialogPrompt');
    if (prompt !== 'ui.updateApplyDialogPrompt') return prompt;
    if (Number.isInteger(buildNumber) && buildNumber > 0) {
      return `Install build ${buildNumber}?`;
    }
    return 'Install the latest version now?';
  };

  const resolveMoveDailyDialogPromptText = () => {
    const localized = translateNow('ui.moveDailyDialogPrompt');
    if (localized !== 'ui.moveDailyDialogPrompt') return localized;
    return 'You have an unfinished level. Move to Daily level anyway?';
  };

  const resolveNotificationHistoryEntryText = (entry) => {
    let title = entry?.title || '-';
    let body = entry?.body || '';

    if (!entry || entry.source !== 'system') {
      return { title, body };
    }

    if (entry.kind === 'unsolved-warning') {
      const localizedTitle = translateNow('ui.notificationUnsolvedTitle');
      const localizedBody = translateNow('ui.notificationUnsolvedBody');
      if (localizedTitle !== 'ui.notificationUnsolvedTitle') title = localizedTitle;
      if (localizedBody !== 'ui.notificationUnsolvedBody') body = localizedBody;
      return { title, body };
    }

    if (entry.kind === 'new-level') {
      const localizedTitle = translateNow('ui.notificationNewLevelTitle');
      const localizedBody = translateNow('ui.notificationNewLevelBody');
      if (localizedTitle !== 'ui.notificationNewLevelTitle') title = localizedTitle;
      if (localizedBody !== 'ui.notificationNewLevelBody') body = localizedBody;
      return { title, body };
    }

    if (entry.kind === 'new-version-available') {
      const localizedTitle = translateNow('ui.newVersionAvailableTitle');
      const localizedBody = translateNow('ui.newVersionAvailableBody');
      if (localizedTitle !== 'ui.newVersionAvailableTitle') title = localizedTitle;
      if (localizedBody !== 'ui.newVersionAvailableBody') body = localizedBody;
      return { title, body };
    }

    return { title, body };
  };

  const normalizeHistoryEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) return null;
    const source = entry.source === 'system' ? 'system' : 'toast';
    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : (source === 'system' ? 'unsolved-warning' : 'toast');
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const body = typeof entry.body === 'string' ? entry.body.trim() : '';
    const createdAtUtcMs = Number.parseInt(entry.createdAtUtcMs, 10);
    const marker = entry.marker === 'unread' || entry.marker === 'just-read' || entry.marker === 'older'
      ? entry.marker
      : 'older';
    const action = normalizeHistoryAction(entry.action);
    return {
      id,
      source,
      kind,
      title,
      body,
      createdAtUtcMs: Number.isInteger(createdAtUtcMs) ? createdAtUtcMs : Date.now(),
      marker,
      action,
    };
  };

  const applyHistoryPayload = (payload) => {
    const prevVersion = notificationHistoryState.historyVersion;
    const historyVersion = Number.parseInt(payload?.historyVersion, 10);
    const entries = Array.isArray(payload?.entries)
      ? payload.entries.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean).slice(0, HISTORY_MAX_ENTRIES)
      : [];
    notificationHistoryState.historyVersion = Number.isInteger(historyVersion) ? historyVersion : 1;
    notificationHistoryState.entries = entries;

    if (notificationHistoryState.historyVersion !== prevVersion) {
      notificationHistoryReadAckVersion = null;
    }
  };

  const refreshNotificationHistoryBadgeUi = () => {
    if (!notificationHistoryToggleEl || !notificationHistoryBadgeEl) return;
    const hasUnreadSystem = hasUnreadSystemHistory(notificationHistoryState.entries);
    notificationHistoryBadgeEl.hidden = !hasUnreadSystem;
    notificationHistoryToggleEl.classList.toggle('hasUnread', hasUnreadSystem);
  };

  const renderNotificationHistoryRelativeTimes = () => {
    if (!notificationHistoryListEl) return;
    const locale = getLocale();
    const rows = notificationHistoryListEl.querySelectorAll('.notificationHistoryItem');
    for (const row of rows) {
      const tsRaw = row.getAttribute('data-created-at');
      const createdAtUtcMs = Number.parseInt(tsRaw || '', 10);
      const timeEl = row.querySelector('.notificationHistoryItem__time');
      if (!timeEl || !Number.isInteger(createdAtUtcMs)) continue;
      timeEl.textContent = formatHistoryRelativeTime(createdAtUtcMs, locale);
      timeEl.setAttribute('title', formatHistoryAbsoluteTime(createdAtUtcMs, locale));
    }
  };

  const renderNotificationHistoryList = () => {
    if (!notificationHistoryListEl || !documentObj) return;
    const entries = notificationHistoryState.entries;
    notificationHistoryListEl.textContent = '';

    if (entries.length === 0) {
      const placeholder = documentObj.createElement('div');
      placeholder.className = 'notificationHistoryEmpty';
      const localized = translateNow('ui.notificationHistoryEmpty');
      placeholder.textContent = localized === 'ui.notificationHistoryEmpty'
        ? HISTORY_EMPTY_PLACEHOLDER_TEXT
        : localized;
      notificationHistoryListEl.appendChild(placeholder);
      return;
    }

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const row = documentObj.createElement('div');
      row.className = 'notificationHistoryItem';
      row.setAttribute('data-entry-id', entry.id);
      row.setAttribute('data-entry-kind', entry.kind);
      row.setAttribute('data-created-at', String(entry.createdAtUtcMs));
      row.removeAttribute('data-action-type');
      row.removeAttribute('data-action-build-number');
      row.removeAttribute('data-action-daily-id');

      const actionableEntry = (
        entry.action?.type === 'open-daily'
          ? (isOpenDailyHistoryActionable(entry) ? entry.action : null)
          : entry.action
      );

      if (actionableEntry) {
        row.classList.add('isActionable');
        row.setAttribute('data-action-type', actionableEntry.type);
        if (actionableEntry.type === 'apply-update') {
          row.setAttribute('data-action-build-number', String(actionableEntry.buildNumber));
        } else if (actionableEntry.type === 'open-daily') {
          row.setAttribute('data-action-daily-id', actionableEntry.dailyId);
        }
      }

      const deathRank = (
        entries.length > HISTORY_DYING_START_INDEX && i >= HISTORY_DYING_START_INDEX
          ? (i - HISTORY_DYING_START_INDEX)
          : -1
      );
      if (deathRank >= 0) {
        row.classList.add('isDying');
        row.style.setProperty('--death-rank', String(deathRank));
      }

      const dot = documentObj.createElement('span');
      dot.className = 'notificationHistoryItem__dot';
      const dotColor = historyEntryDotColor(entry);
      if (dotColor === HISTORY_DOT_COLORS.RED) {
        dot.classList.add('isRed');
      } else if (dotColor === HISTORY_DOT_COLORS.BLUE) {
        dot.classList.add('isBlue');
      }
      if (entry.marker === 'older') {
        dot.classList.add('isOlder');
      }

      const content = documentObj.createElement('div');
      content.className = 'notificationHistoryItem__content';

      const localizedEntry = resolveNotificationHistoryEntryText(entry);

      const title = documentObj.createElement('div');
      title.className = 'notificationHistoryItem__title';
      title.textContent = localizedEntry.title;

      const body = documentObj.createElement('div');
      body.className = 'notificationHistoryItem__body';
      body.textContent = localizedEntry.body;

      const time = documentObj.createElement('div');
      time.className = 'notificationHistoryItem__time';
      time.textContent = formatHistoryRelativeTime(entry.createdAtUtcMs, getLocale());
      time.setAttribute('title', formatHistoryAbsoluteTime(entry.createdAtUtcMs, getLocale()));

      content.appendChild(title);
      content.appendChild(body);
      content.appendChild(time);
      row.appendChild(dot);
      row.appendChild(content);
      notificationHistoryListEl.appendChild(row);
    }
  };

  const stopNotificationHistoryRefreshTimer = () => {
    if (!notificationHistoryRefreshTimer || !windowObj) return;
    windowObj.clearInterval(notificationHistoryRefreshTimer);
    notificationHistoryRefreshTimer = 0;
  };

  const validateAndMarkNotificationHistoryRead = async () => {
    if (!notificationHistoryOpen || !notificationHistoryListEl || !windowObj) return;
    if (notificationHistoryReadAckInFlight) return;
    if (notificationHistoryReadAckVersion === notificationHistoryState.historyVersion) return;

    const unreadEntries = notificationHistoryState.entries.filter((entry) => entry.marker === 'unread');
    if (unreadEntries.length === 0) return;

    const entryIds = [];
    for (const entry of unreadEntries) {
      const rows = Array.from(notificationHistoryListEl.querySelectorAll('.notificationHistoryItem'));
      const row = rows.find((candidate) => candidate.getAttribute('data-entry-id') === entry.id);
      if (!row || !row.isConnected) return;

      const titleEl = row.querySelector('.notificationHistoryItem__title');
      const bodyEl = row.querySelector('.notificationHistoryItem__body');
      const timeEl = row.querySelector('.notificationHistoryItem__time');
      if (!titleEl || !bodyEl || !timeEl) return;
      const localizedEntry = resolveNotificationHistoryEntryText(entry);
      if (titleEl.textContent !== localizedEntry.title) return;
      if (bodyEl.textContent !== localizedEntry.body) return;
      if (!timeEl.textContent || !timeEl.textContent.trim()) return;

      const style = windowObj.getComputedStyle(row);
      if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') === 0) {
        return;
      }

      entryIds.push(entry.id);
    }

    notificationHistoryReadAckInFlight = true;
    notificationHistoryReadAckVersion = notificationHistoryState.historyVersion;
    const posted = await postMessageToServiceWorker({
      type: swMessageTypes.MARK_HISTORY_READ,
      payload: {
        historyVersion: notificationHistoryState.historyVersion,
        entryIds,
      },
    }, { queueWhenUnavailable: true });
    notificationHistoryReadAckInFlight = false;
    if (!posted) {
      notificationHistoryReadAckVersion = null;
    }
  };

  const startNotificationHistoryRefreshTimer = () => {
    if (!windowObj) return;
    stopNotificationHistoryRefreshTimer();
    notificationHistoryRefreshTimer = windowObj.setInterval(() => {
      if (!notificationHistoryOpen) return;
      renderNotificationHistoryRelativeTimes();
      void validateAndMarkNotificationHistoryRead();
    }, HISTORY_RELATIVE_TIME_REFRESH_MS);
  };

  const closeHistoryPanel = () => {
    notificationHistoryOpen = false;
    stopNotificationHistoryRefreshTimer();
    if (!notificationHistoryPanelEl || !notificationHistoryToggleEl) return;
    notificationHistoryPanelEl.hidden = true;
    notificationHistoryToggleEl.classList.remove('isOpen');
    notificationHistoryToggleEl.setAttribute('aria-expanded', 'false');
  };

  const openNotificationHistoryPanel = async () => {
    notificationHistoryOpen = true;
    if (notificationHistoryPanelEl && notificationHistoryToggleEl) {
      notificationHistoryPanelEl.hidden = false;
      notificationHistoryToggleEl.classList.add('isOpen');
      notificationHistoryToggleEl.setAttribute('aria-expanded', 'true');
    }
    startNotificationHistoryRefreshTimer();
    await postMessageToServiceWorker({ type: swMessageTypes.GET_HISTORY }, { queueWhenUnavailable: true });
    renderNotificationHistoryList();
    refreshNotificationHistoryBadgeUi();
    void validateAndMarkNotificationHistoryRead();
  };

  const toggleNotificationHistoryPanel = () => {
    if (notificationHistoryOpen) {
      closeHistoryPanel();
      return;
    }
    void openNotificationHistoryPanel();
  };

  const scheduleNotificationHistoryReadValidation = () => {
    if (!windowObj || typeof windowObj.requestAnimationFrame !== 'function') {
      void validateAndMarkNotificationHistoryRead();
      return;
    }
    if (notificationHistoryValidationFrame) {
      windowObj.cancelAnimationFrame(notificationHistoryValidationFrame);
      notificationHistoryValidationFrame = 0;
    }
    notificationHistoryValidationFrame = windowObj.requestAnimationFrame(() => {
      notificationHistoryValidationFrame = 0;
      void validateAndMarkNotificationHistoryRead();
    });
  };

  const refreshNotificationHistoryUi = () => {
    renderNotificationHistoryList();
    refreshNotificationHistoryBadgeUi();
    if (notificationHistoryOpen) {
      renderNotificationHistoryRelativeTimes();
      scheduleNotificationHistoryReadValidation();
    }
  };

  const requestUpdateApplyConfirmation = async (buildNumber) => {
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return false;
    if (!updateApplyDialogEl || typeof updateApplyDialogEl.showModal !== 'function') {
      return windowObj.confirm(resolveUpdateApplyDialogPromptText(buildNumber));
    }
    if (updateApplyDialogEl.open || updateApplyDialogResolver) return false;

    updateApplyDialogEl.dataset.pendingBuildNumber = String(buildNumber);
    if (updateApplyMessageEl) {
      updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(buildNumber);
    }

    return new Promise((resolve) => {
      updateApplyDialogResolver = resolve;
      try {
        updateApplyDialogEl.showModal();
      } catch {
        updateApplyDialogResolver = null;
        delete updateApplyDialogEl.dataset.pendingBuildNumber;
        resolve(windowObj.confirm(resolveUpdateApplyDialogPromptText(buildNumber)));
      }
    });
  };

  const requestMoveDailyConfirmation = async () => {
    const promptText = resolveMoveDailyDialogPromptText();
    if (!moveDailyDialogEl || typeof moveDailyDialogEl.showModal !== 'function') {
      return windowObj.confirm(promptText);
    }
    if (moveDailyDialogEl.open || moveDailyDialogResolver) return false;

    if (moveDailyMessageEl) {
      moveDailyMessageEl.textContent = promptText;
    }

    return new Promise((resolve) => {
      moveDailyDialogResolver = resolve;
      try {
        moveDailyDialogEl.showModal();
      } catch {
        moveDailyDialogResolver = null;
        resolve(windowObj.confirm(promptText));
      }
    });
  };

  const requestAndEnableNotifications = async () => {
    writeNotificationEnabledPreference(true);
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      writeNotificationEnabledPreference(false);
      if (permission === 'denied') {
        const deniedText = translateNow('ui.notificationsBlockedToast');
        if (deniedText !== 'ui.notificationsBlockedToast') {
          showInAppToast(deniedText, { recordInHistory: false });
        }
      }
      refreshNotificationsToggleUi();
      await syncDailyStateToServiceWorker();
      return false;
    }

    refreshNotificationsToggleUi();
    await syncDailyStateToServiceWorker();
    await registerBackgroundDailyCheck();
    await requestServiceWorkerDailyCheck();
    return true;
  };

  const disableNotificationsNow = async () => {
    writeNotificationEnabledPreference(false);
    refreshNotificationsToggleUi();
    await syncDailyStateToServiceWorker();
  };

  const maybeAutoPromptForNotifications = async () => {
    if (!supportsNotifications() || !canUseServiceWorker()) return;
    if (hasStoredNotificationEnabledPreference() && !readNotificationEnabledPreference()) return;
    if (notificationPermissionState() === 'granted') return;
    if (readAutoPromptDecision() !== notificationAutoPromptDecisions.UNSET) return;

    const confirmed = windowObj.confirm(translateNow('ui.notificationsAutoPromptConfirm'));
    if (!confirmed) {
      writeAutoPromptDecision(notificationAutoPromptDecisions.DECLINED);
      writeNotificationEnabledPreference(false);
      refreshNotificationsToggleUi();
      await syncDailyStateToServiceWorker();
      return;
    }

    writeAutoPromptDecision(notificationAutoPromptDecisions.ACCEPTED);
    await requestAndEnableNotifications();
  };

  const handleNotificationHistoryItemAction = (event) => {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;
    const row = target.closest('.notificationHistoryItem');
    if (!row || !notificationHistoryListEl?.contains(row)) return;
    const actionType = row.getAttribute('data-action-type') || '';
    if (actionType === 'apply-update') {
      const buildNumber = Number.parseInt(row.getAttribute('data-action-build-number') || '', 10);
      if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
      void onApplyUpdateRequested({
        buildNumber,
        requestUpdateApplyConfirmation,
        closeHistoryPanel,
      });
      return;
    }
    if (actionType === 'open-daily') {
      const dailyId = row.getAttribute('data-action-daily-id') || '';
      const kind = row.getAttribute('data-entry-kind') || '';
      if (!isOpenDailyHistoryActionable({
        kind,
        action: { type: 'open-daily', dailyId },
      })) {
        return;
      }
      void onOpenDailyRequested({
        dailyId,
        kind,
        requestMoveDailyConfirmation,
        closeHistoryPanel,
      });
    }
  };

  const bindNotificationsToggle = () => {
    notificationsToggleEl = documentObj.getElementById(elementIds.NOTIFICATIONS_TOGGLE);

    if (!notificationsToggleEl || notificationsToggleBound) {
      refreshNotificationsToggleUi();
      return;
    }
    notificationsToggleEl.addEventListener('change', () => {
      if (notificationsToggleEl.checked) {
        void requestAndEnableNotifications();
        return;
      }
      void disableNotificationsNow();
    });

    notificationsToggleBound = true;
    refreshNotificationsToggleUi();
  };

  const bindAutoUpdateToggle = () => {
    autoUpdateToggleEl = documentObj.getElementById(elementIds.AUTO_UPDATE_TOGGLE);

    if (!autoUpdateToggleEl || autoUpdateToggleBound) {
      refreshAutoUpdateToggleUi();
      return;
    }

    autoUpdateToggleEl.addEventListener('change', () => {
      writeAutoUpdateEnabledPreference(autoUpdateToggleEl.checked);
      refreshAutoUpdateToggleUi();
      void syncUpdatePolicyToServiceWorker();
    });

    autoUpdateToggleBound = true;
    refreshAutoUpdateToggleUi();
  };

  const bindNotificationHistoryPanel = () => {
    notificationHistoryToggleEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_TOGGLE);
    notificationHistoryBadgeEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_BADGE);
    notificationHistoryPanelEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_PANEL);
    notificationHistoryListEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_LIST);

    if (!notificationHistoryToggleEl || !notificationHistoryPanelEl || !notificationHistoryListEl || notificationHistoryToggleBound) {
      refreshNotificationHistoryUi();
      return;
    }

    notificationHistoryToggleEl.addEventListener('click', () => {
      toggleNotificationHistoryPanel();
    });
    notificationHistoryListEl.addEventListener('click', handleNotificationHistoryItemAction);

    const settingsToggle = documentObj.getElementById(elementIds.SETTINGS_TOGGLE);
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => {
        closeHistoryPanel();
      });
    }

    documentObj.addEventListener('click', (event) => {
      if (!notificationHistoryOpen) return;
      const target = event?.target;
      if (!target) return;
      if (updateApplyDialogEl?.open && updateApplyDialogEl.contains(target)) return;
      if (moveDailyDialogEl?.open && moveDailyDialogEl.contains(target)) return;
      if (notificationHistoryToggleEl.contains(target) || notificationHistoryPanelEl.contains(target)) return;
      closeHistoryPanel();
    });

    documentObj.addEventListener('keydown', (event) => {
      if (!notificationHistoryOpen) return;
      if (event.key === 'Escape') {
        closeHistoryPanel();
      }
    });

    notificationHistoryToggleBound = true;
    refreshNotificationHistoryUi();
  };

  const bindUpdateApplyDialog = () => {
    updateApplyDialogEl = documentObj.getElementById(elementIds.UPDATE_APPLY_DIALOG);
    updateApplyMessageEl = documentObj.getElementById(elementIds.UPDATE_APPLY_MESSAGE);

    if (!updateApplyDialogEl || updateApplyDialogBound) return;

    updateApplyDialogEl.addEventListener('close', () => {
      const shouldApply = updateApplyDialogEl?.returnValue === 'confirm';
      delete updateApplyDialogEl.dataset.pendingBuildNumber;
      updateApplyDialogEl.returnValue = '';
      const resolve = updateApplyDialogResolver;
      updateApplyDialogResolver = null;
      if (typeof resolve === 'function') {
        resolve(shouldApply);
      }
    });

    updateApplyDialogBound = true;
  };

  const bindMoveDailyDialog = () => {
    moveDailyDialogEl = documentObj.getElementById(elementIds.MOVE_DAILY_DIALOG);
    moveDailyMessageEl = documentObj.getElementById(elementIds.MOVE_DAILY_MESSAGE);

    if (!moveDailyDialogEl || moveDailyDialogBound) return;

    moveDailyDialogEl.addEventListener('close', () => {
      const confirmed = moveDailyDialogEl?.returnValue === 'confirm';
      moveDailyDialogEl.returnValue = '';
      const resolve = moveDailyDialogResolver;
      moveDailyDialogResolver = null;
      if (typeof resolve === 'function') {
        resolve(confirmed);
      }
    });

    moveDailyDialogBound = true;
  };

  const refreshLocalizedUi = () => {
    refreshNotificationHistoryUi();
    if (updateApplyMessageEl) {
      updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(
        Number.parseInt(updateApplyDialogEl?.dataset?.pendingBuildNumber || '', 10),
      );
    }
    if (moveDailyMessageEl) {
      moveDailyMessageEl.textContent = resolveMoveDailyDialogPromptText();
    }
  };

  const refreshToggleUi = () => {
    refreshNotificationsToggleUi();
    refreshAutoUpdateToggleUi();
  };

  const handleStorageEvent = (storageKey) => {
    if (storageKey === notificationEnabledKey) {
      refreshNotificationsToggleUi();
      void syncDailyStateToServiceWorker();
    } else if (storageKey === autoUpdateEnabledKey) {
      refreshAutoUpdateToggleUi();
      void syncUpdatePolicyToServiceWorker();
    }
  };

  const bind = () => {
    if (!documentObj || !windowObj) return;

    bindNotificationsToggle();
    bindAutoUpdateToggle();
    bindNotificationHistoryPanel();
    bindUpdateApplyDialog();
    bindMoveDailyDialog();
  };

  return {
    bind,
    refreshLocalizedUi,
    refreshToggleUi,
    refreshHistoryUi: refreshNotificationHistoryUi,
    maybeAutoPromptForNotifications,
    handleStorageEvent,
    applyHistoryPayload,
    getHistoryEntries: () => notificationHistoryState.entries,
    closeHistoryPanel,
    requestNotificationPermission,
    clearAppliedUpdateHistoryActions: (appliedBuildNumber = localBuildNumber) =>
      clearAppliedUpdateHistoryActions(appliedBuildNumber),
  };
}
