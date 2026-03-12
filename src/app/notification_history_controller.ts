// @ts-nocheck
import {
  HISTORY_DOT_COLORS,
  formatHistoryAbsoluteTime,
  formatHistoryRelativeTime,
  hasUnreadSystemHistory,
  historyEntryDotColor,
  normalizeHistoryAction,
} from '../runtime/notification_history.ts';

const HISTORY_RELATIVE_TIME_REFRESH_MS = 60 * 1000;
const HISTORY_MAX_ENTRIES = 10;
const HISTORY_DYING_START_INDEX = 5;
const HISTORY_EMPTY_PLACEHOLDER_TEXT = 'No notifications yet.';
const HISTORY_ENTRY_TRANSLATION_KEYS = Object.freeze({
  'unsolved-warning': Object.freeze({
    title: 'ui.notificationUnsolvedTitle',
    body: 'ui.notificationUnsolvedBody',
  }),
  'new-level': Object.freeze({
    title: 'ui.notificationNewLevelTitle',
    body: 'ui.notificationNewLevelBody',
  }),
  'new-version-available': Object.freeze({
    title: 'ui.newVersionAvailableTitle',
    body: 'ui.newVersionAvailableBody',
  }),
  'new-version-toast': Object.freeze({
    title: 'ui.newVersionAvailableToast',
  }),
  'update-apply-failed': Object.freeze({
    title: 'ui.updateApplyFailedToast',
  }),
  'update-applied': Object.freeze({
    title: 'ui.updateAppliedToast',
  }),
  'low-power-hint': Object.freeze({
    title: 'ui.lowPowerModeHintToast',
  }),
});
const isHistoryActionActivationKey = (key) => key === 'Enter' || key === ' ' || key === 'Spacebar';

export function createNotificationHistoryController(options = {}) {
  const {
    elementIds,
    swMessageTypes,
    postMessageToServiceWorker = async () => false,
    translateNow = (key) => key,
    getLocale = () => 'en',
    onApplyUpdateRequested = async () => { },
    onOpenDailyRequested = async () => { },
    isOpenDailyHistoryActionable = () => true,
    requestUpdateApplyConfirmation = async () => false,
    requestMoveDailyConfirmation = async () => false,
    containsOpenDialogTarget = () => false,
    windowObj = typeof window === 'undefined' ? undefined : window,
    documentObj = typeof document === 'undefined' ? undefined : document,
  } = options;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationHistoryController requires elementIds');
  }
  if (!swMessageTypes || typeof swMessageTypes !== 'object') {
    throw new Error('createNotificationHistoryController requires swMessageTypes');
  }

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

  const notificationHistoryState = {
    historyVersion: 1,
    entries: [],
  };

  const resolveHistoryEntryLocalizedText = (translationKey, fallback) => {
    const localized = translateNow(translationKey);
    return localized === translationKey ? fallback : localized;
  };

  const resolveNotificationHistoryEntryText = (entry) => {
    const title = entry?.title || '-';
    const body = entry?.body || '';

    if (!entry) {
      return { title, body };
    }

    const translationKeys = HISTORY_ENTRY_TRANSLATION_KEYS[entry.kind];
    if (!translationKeys) return { title, body };

    return {
      title: translationKeys.title
        ? resolveHistoryEntryLocalizedText(translationKeys.title, title)
        : title,
      body: translationKeys.body
        ? resolveHistoryEntryLocalizedText(translationKeys.body, body)
        : body,
    };
  };

  const normalizeHistoryEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) return null;
    const source = entry.source === 'system' ? 'system' : 'toast';
    const defaultKind = source === 'system' ? 'unsolved-warning' : 'toast';
    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : defaultKind;
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
      const tsRaw = row.dataset.createdAt;
      const createdAtUtcMs = Number.parseInt(tsRaw || '', 10);
      const timeEl = row.querySelector('.notificationHistoryItem__time');
      if (!timeEl || !Number.isInteger(createdAtUtcMs)) continue;
      timeEl.textContent = formatHistoryRelativeTime(createdAtUtcMs, locale);
      timeEl.setAttribute('title', formatHistoryAbsoluteTime(createdAtUtcMs, locale));
    }
  };

  const renderEmptyNotificationHistoryList = () => {
    const placeholder = documentObj.createElement('div');
    placeholder.className = 'notificationHistoryEmpty';
    const localized = translateNow('ui.notificationHistoryEmpty');
    placeholder.textContent = localized === 'ui.notificationHistoryEmpty'
      ? HISTORY_EMPTY_PLACEHOLDER_TEXT
      : localized;
    notificationHistoryListEl.appendChild(placeholder);
  };

  const resolveActionableNotificationHistoryEntry = (entry) => {
    if (entry.action?.type !== 'open-daily') return entry.action;
    return isOpenDailyHistoryActionable(entry) ? entry.action : null;
  };

  const applyNotificationHistoryRowAction = (row, entry) => {
    const actionableEntry = resolveActionableNotificationHistoryEntry(entry);
    if (!actionableEntry) return;

    row.classList.add('isActionable');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.dataset.actionType = actionableEntry.type;

    if (actionableEntry.type === 'apply-update') {
      row.dataset.actionBuildNumber = String(actionableEntry.buildNumber);
      return;
    }

    if (actionableEntry.type === 'open-daily') {
      row.dataset.actionDailyId = actionableEntry.dailyId;
    }
  };

  const applyNotificationHistoryRowDeathRank = (row, entryIndex, entryCount) => {
    if (entryCount <= HISTORY_DYING_START_INDEX || entryIndex < HISTORY_DYING_START_INDEX) return;
    row.classList.add('isDying');
    row.style.setProperty('--death-rank', String(entryIndex - HISTORY_DYING_START_INDEX));
  };

  const createNotificationHistoryDot = (entry) => {
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

    return dot;
  };

  const createNotificationHistoryContent = (entry, locale) => {
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
    time.textContent = formatHistoryRelativeTime(entry.createdAtUtcMs, locale);
    time.setAttribute('title', formatHistoryAbsoluteTime(entry.createdAtUtcMs, locale));

    content.appendChild(title);
    content.appendChild(body);
    content.appendChild(time);
    return content;
  };

  const createNotificationHistoryRow = (entry, entryIndex, entryCount, locale) => {
    const row = documentObj.createElement('div');
    row.className = 'notificationHistoryItem';
    row.dataset.entryId = entry.id;
    row.dataset.entryKind = entry.kind;
    row.dataset.createdAt = String(entry.createdAtUtcMs);

    applyNotificationHistoryRowAction(row, entry);
    applyNotificationHistoryRowDeathRank(row, entryIndex, entryCount);
    row.appendChild(createNotificationHistoryDot(entry));
    row.appendChild(createNotificationHistoryContent(entry, locale));
    return row;
  };

  const renderNotificationHistoryList = () => {
    if (!notificationHistoryListEl || !documentObj) return;
    const entries = notificationHistoryState.entries;
    notificationHistoryListEl.textContent = '';

    if (entries.length === 0) {
      renderEmptyNotificationHistoryList();
      return;
    }

    const locale = getLocale();
    for (let i = 0; i < entries.length; i += 1) {
      notificationHistoryListEl.appendChild(createNotificationHistoryRow(entries[i], i, entries.length, locale));
    }
  };

  const stopNotificationHistoryRefreshTimer = () => {
    if (!notificationHistoryRefreshTimer || !windowObj) return;
    windowObj.clearInterval(notificationHistoryRefreshTimer);
    notificationHistoryRefreshTimer = 0;
  };

  const createNotificationHistoryRowIndex = () => {
    const rows = notificationHistoryListEl.querySelectorAll('.notificationHistoryItem');
    return new Map(Array.from(rows, (row) => [row.dataset.entryId, row]));
  };

  const isNotificationHistoryRowVisible = (row) => {
    const style = windowObj.getComputedStyle(row);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity || '1') !== 0;
  };

  const isNotificationHistoryRowReadyForReadAck = (row, entry) => {
    if (!row?.isConnected) return false;

    const titleEl = row.querySelector('.notificationHistoryItem__title');
    const bodyEl = row.querySelector('.notificationHistoryItem__body');
    const timeEl = row.querySelector('.notificationHistoryItem__time');
    if (!titleEl || !bodyEl || !timeEl) return false;

    const localizedEntry = resolveNotificationHistoryEntryText(entry);
    if (titleEl.textContent !== localizedEntry.title) return false;
    if (bodyEl.textContent !== localizedEntry.body) return false;
    if (!timeEl.textContent?.trim()) return false;

    return isNotificationHistoryRowVisible(row);
  };

  const collectNotificationHistoryReadAckEntryIds = (entries) => {
    const rowsByEntryId = createNotificationHistoryRowIndex();
    const entryIds = [];
    for (const entry of entries) {
      const row = rowsByEntryId.get(entry.id);
      if (!isNotificationHistoryRowReadyForReadAck(row, entry)) return null;
      entryIds.push(entry.id);
    }
    return entryIds;
  };

  const validateAndMarkNotificationHistoryRead = async () => {
    if (!notificationHistoryOpen || !notificationHistoryListEl || !windowObj) return;
    if (notificationHistoryReadAckInFlight) return;
    if (notificationHistoryReadAckVersion === notificationHistoryState.historyVersion) return;

    const unreadEntries = notificationHistoryState.entries.filter((entry) => entry.marker === 'unread');
    if (unreadEntries.length === 0) return;

    const entryIds = collectNotificationHistoryReadAckEntryIds(unreadEntries);
    if (!entryIds) return;

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

  const closePanel = () => {
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
      closePanel();
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

  const refreshUi = () => {
    renderNotificationHistoryList();
    refreshNotificationHistoryBadgeUi();
    if (notificationHistoryOpen) {
      renderNotificationHistoryRelativeTimes();
      scheduleNotificationHistoryReadValidation();
    }
  };

  const handleNotificationHistoryItemAction = (event) => {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;
    const row = target.closest('.notificationHistoryItem');
    if (!row || !notificationHistoryListEl?.contains(row)) return;
    const actionType = row.dataset.actionType || '';
    if (actionType === 'apply-update') {
      const buildNumber = Number.parseInt(row.dataset.actionBuildNumber || '', 10);
      if (!Number.isInteger(buildNumber) || buildNumber <= 0) return;
      void onApplyUpdateRequested({
        buildNumber,
        requestUpdateApplyConfirmation,
        closeHistoryPanel: closePanel,
      });
      return;
    }
    if (actionType === 'open-daily') {
      const dailyId = row.dataset.actionDailyId || '';
      const kind = row.dataset.entryKind || '';
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
        closeHistoryPanel: closePanel,
      });
    }
  };

  const handleNotificationHistoryItemKeydown = (event) => {
    if (!isHistoryActionActivationKey(event?.key)) return;
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;
    const row = target.closest('.notificationHistoryItem');
    if (!row || !notificationHistoryListEl?.contains(row)) return;
    if (!row.dataset.actionType) return;
    event.preventDefault?.();
    handleNotificationHistoryItemAction(event);
  };

  const shouldIgnoreOutsideCloseTarget = (target) => {
    if (!target) return false;
    if (containsOpenDialogTarget(target)) return true;
    if (notificationHistoryToggleEl?.contains(target)) return true;
    return Boolean(notificationHistoryPanelEl?.contains(target));
  };

  const bind = () => {
    if (!documentObj) return;

    notificationHistoryToggleEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_TOGGLE);
    notificationHistoryBadgeEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_BADGE);
    notificationHistoryPanelEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_PANEL);
    notificationHistoryListEl = documentObj.getElementById(elementIds.NOTIFICATION_HISTORY_LIST);

    if (!notificationHistoryToggleEl || !notificationHistoryPanelEl || !notificationHistoryListEl || notificationHistoryToggleBound) {
      refreshUi();
      return;
    }

    notificationHistoryToggleEl.addEventListener('click', () => {
      toggleNotificationHistoryPanel();
    });
    notificationHistoryListEl.addEventListener('click', handleNotificationHistoryItemAction);
    notificationHistoryListEl.addEventListener('keydown', handleNotificationHistoryItemKeydown);

    const settingsToggle = documentObj.getElementById(elementIds.SETTINGS_TOGGLE);
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => {
        closePanel();
      });
    }

    documentObj.addEventListener('pointerdown', (event) => {
      if (!notificationHistoryOpen) return;
      const target = event?.target;
      if (shouldIgnoreOutsideCloseTarget(target)) return;
      closePanel();
    });

    documentObj.addEventListener('click', (event) => {
      if (!notificationHistoryOpen) return;
      const target = event?.target;
      if (shouldIgnoreOutsideCloseTarget(target)) return;
      closePanel();
    });

    documentObj.addEventListener('keydown', (event) => {
      if (!notificationHistoryOpen) return;
      if (event.key === 'Escape') {
        closePanel();
      }
    });

    notificationHistoryToggleBound = true;
    refreshUi();
  };

  return {
    bind,
    applyHistoryPayload,
    refreshUi,
    closePanel,
    getEntries: () => notificationHistoryState.entries,
  };
}
