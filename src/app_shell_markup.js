import { ELEMENT_IDS } from './config.js';

const BOOT_LABELS = Object.freeze({
  'ui.notifications': 'Notifications',
  'ui.language': 'Language',
  'ui.theme': 'Theme',
  'ui.themeDark': 'Dark',
  'ui.dailyLevelOption': 'Daily',
  'ui.levelLabel': 'Level',
  'ui.levelSelectAria': 'Level select',
  'ui.dailyDateLabel': 'Date',
  'ui.dailyResetLabel': 'Reset',
  'ui.resetTitle': 'Reset path',
  'ui.reset': 'Reset',
  'ui.reverseTitle': 'Reverse path',
  'ui.reverse': 'Reverse',
  'ui.prevInfinite': 'Previous',
  'ui.nextLevel': 'Next level',
  'ui.guide': 'Guide',
  'ui.hide': 'Hide',
  'ui.legend': 'Legend',
  'ui.githubRepoAria': 'GitHub repository',
  'ui.githubRepoTitle': 'GitHub repository',
  'ui.puzzleGridAria': 'Puzzle grid',
  'ui.cancel': 'Cancel',
  'ui.themeSwitchTitle': 'Switch theme',
  'ui.themeSwitchConfirm': 'Switch',
  'ui.updateApplyDialogTitle': 'Apply update',
  'ui.updateApplyDialogPrompt': 'Apply the latest update?',
  'ui.updateApplyDialogConfirm': 'Update',
  'ui.moveDailyDialogTitle': 'Daily level',
  'ui.moveDailyDialogPrompt': 'Move to the daily level?',
  'ui.moveDailyDialogConfirm': 'Move',
  'ui.lowPowerMode': 'Low power mode',
  'ui.lowPowerModeEnable': 'Enable low power mode',
  'ui.notificationsEnable': 'Enable notifications',
  'ui.autoUpdate': 'Auto update',
  'ui.autoUpdateEnable': 'Enable auto update',
});

const translateBoot = (key) => BOOT_LABELS[key] || key;

const buildOptionList = (localeOptions, currentLocale) =>
  (localeOptions || [])
    .map(
      ({ value, label, disabled }) =>
        `<option value="${value}" ${disabled ? 'disabled' : ''} ${value === currentLocale ? 'selected' : ''}>${label}</option>`,
    )
    .join('');

const DIALOG_ICON_HTML = Object.freeze({
  WARNING: '<span class="themeSwitchDialog__icon uiIconMaterial" aria-hidden="true">warning</span>',
  SYSTEM_UPDATE: '<span class="themeSwitchDialog__icon uiIconMaterial" aria-hidden="true">system_update</span>',
  EVENT: '<span class="themeSwitchDialog__icon uiIconMaterial" aria-hidden="true">event</span>',
});
const BOOT_GUIDE_PLACEHOLDERS = Object.freeze([
  'Goal visit every open cell once.',
  'This level start anywhere.',
]);

const interactiveAttrs = (disabled = false) => (disabled ? ' disabled tabindex="-1"' : '');
const renderBootTextBlock = (modifier = 'mid') =>
  `<span class="bootShellTextBlock bootShellTextBlock--${modifier}" aria-hidden="true"></span>`;
const renderBootGuideMessage = () =>
  `<div class="bootShellMessageText" aria-hidden="true">
    <span class="bootShellGuideLine">${BOOT_GUIDE_PLACEHOLDERS[0]}<br>${BOOT_GUIDE_PLACEHOLDERS[1]}</span>
  </div>`;

const buildConfirmDialogTemplate = (t, options = {}) => {
  const {
    dialogId,
    iconHtml,
    titleKey,
    messageId,
    messageKey = '',
    messageText = '',
    cancelBtnId,
    confirmBtnId,
    confirmKey,
    disabled = false,
  } = options;

  const actionAttrs = interactiveAttrs(disabled);
  const messageI18nAttr = messageKey ? ` data-i18n="${messageKey}"` : '';
  const resolvedMessage = messageKey ? t(messageKey) : messageText;

  return `
          <dialog id="${dialogId}" class="appConfirmDialog">
            <form method="dialog" class="themeSwitchDialog">
              <div class="themeSwitchDialog__header">
                ${iconHtml}
                <h3 class="themeSwitchDialog__title" data-i18n="${titleKey}">
                  ${t(titleKey)}
                </h3>
              </div>
              <p id="${messageId}"${messageI18nAttr}>${resolvedMessage}</p>
              <div class="themeSwitchDialog__actions">
                <button
                  id="${cancelBtnId}"
                  value="cancel"
                  formmethod="dialog"
                  type="submit"
                  class="themeSwitchDialog__actionBtn themeSwitchDialog__actionBtn--no"
                  ${actionAttrs}
                >
                  <span class="themeSwitchDialog__actionIcon uiIconMaterial" aria-hidden="true">close</span>
                  <span class="themeSwitchDialog__actionText" data-i18n="ui.cancel">${t('ui.cancel')}</span>
                </button>
                <button
                  id="${confirmBtnId}"
                  value="confirm"
                  type="submit"
                  class="themeSwitchDialog__actionBtn themeSwitchDialog__actionBtn--yes"
                  ${actionAttrs}
                >
                  <span class="themeSwitchDialog__actionIcon uiIconMaterial" aria-hidden="true">check</span>
                  <span class="themeSwitchDialog__actionText" data-i18n="${confirmKey}">${t(confirmKey)}</span>
                </button>
              </div>
            </form>
          </dialog>`;
};

const buildHeaderMarkup = ({ t, localeOptions, currentLocale, boot = false }) => {
  const topbarButtonAttrs = interactiveAttrs(boot);
  const hiddenControlAttrs = interactiveAttrs(boot);

  return `
  <header>
    <div class="topbarRow">
      <h1 class="brandTitle">
        <span class="brandLogo" aria-hidden="true"></span>
        <span>TETHER</span>
      </h1>
        <div class="topbarControls">
          <div id="${ELEMENT_IDS.SCORE_META}" class="scoreMeta isInactive" aria-live="polite" aria-hidden="true">
            <span class="scoreMetaItem">
              <span id="${ELEMENT_IDS.INFINITE_SCORE_LABEL}" class="scoreMetaLabel">∞</span>
              <strong id="${ELEMENT_IDS.INFINITE_SCORE_VALUE}" class="scoreMetaValue">0</strong>
            </span>
            <span class="scoreMetaSeparator" aria-hidden="true">•</span>
            <span class="scoreMetaItem">
              <span id="${ELEMENT_IDS.DAILY_SCORE_LABEL}" class="scoreMetaLabel">${t('ui.dailyLevelOption')}</span>
              <strong id="${ELEMENT_IDS.DAILY_SCORE_VALUE}" class="scoreMetaValue">0</strong>
            </span>
          </div>
          <button
            id="${ELEMENT_IDS.NOTIFICATION_HISTORY_TOGGLE}"
            class="settingsToggle notificationHistoryToggle"
            type="button"
            aria-haspopup="true"
            aria-expanded="false"
            aria-controls="${ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL}"
            aria-label="${t('ui.notifications')}"
            title="${t('ui.notifications')}"
            data-i18n-aria-label="ui.notifications"
            data-i18n-title="ui.notifications"
            ${topbarButtonAttrs}
          >
            <span class="uiIconMaterial" aria-hidden="true">notifications</span>
            <span id="${ELEMENT_IDS.NOTIFICATION_HISTORY_BADGE}" class="notificationHistoryBadge" hidden></span>
          </button>
          <button
            id="${ELEMENT_IDS.SETTINGS_TOGGLE}"
            class="settingsToggle"
            type="button"
            aria-haspopup="true"
            aria-expanded="false"
            aria-controls="${ELEMENT_IDS.SETTINGS_PANEL}"
            aria-label="${t('ui.language')} / ${t('ui.theme')}"
            title="${t('ui.language')} / ${t('ui.theme')}"
            ${topbarButtonAttrs}
          >
            <span class="uiIconMaterial" aria-hidden="true">settings</span>
          </button>
          <div id="${ELEMENT_IDS.SETTINGS_PANEL}" class="settingsPanel" hidden>
            <div class="settingsField">
              <label id="${ELEMENT_IDS.LANG_LABEL}" class="small settingsLabelWithIcon" for="${ELEMENT_IDS.LANG_SEL}">
                <span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">language</span>
                <span data-i18n="ui.language">${t('ui.language')}</span>
              </label>
              <select id="${ELEMENT_IDS.LANG_SEL}"${hiddenControlAttrs}>
                ${buildOptionList(localeOptions, currentLocale)}
              </select>
            </div>
            <div class="settingsField">
              <span id="${ELEMENT_IDS.THEME_LABEL}" class="small settingsLabelWithIcon">
                <span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">palette</span>
                <span data-i18n="ui.theme">${t('ui.theme')}</span>
              </span>
              <button id="${ELEMENT_IDS.THEME_TOGGLE}" type="button"${hiddenControlAttrs}>${t('ui.themeDark')}</button>
            </div>
            <div class="settingsField">
              <span id="${ELEMENT_IDS.LOW_POWER_LABEL}" class="small" data-i18n="ui.lowPowerMode">${t('ui.lowPowerMode')}</span>
              <label class="settingsCheckbox">
                <input id="${ELEMENT_IDS.LOW_POWER_TOGGLE}" type="checkbox"${hiddenControlAttrs} />
                <span data-i18n="ui.lowPowerModeEnable">${t('ui.lowPowerModeEnable')}</span>
              </label>
            </div>
            <div class="settingsField">
              <span id="${ELEMENT_IDS.NOTIFICATIONS_LABEL}" class="small" data-i18n="ui.notifications">${t('ui.notifications')}</span>
              <label class="settingsCheckbox">
                <input id="${ELEMENT_IDS.NOTIFICATIONS_TOGGLE}" type="checkbox"${hiddenControlAttrs} />
                <span data-i18n="ui.notificationsEnable">${t('ui.notificationsEnable')}</span>
              </label>
            </div>
            <div class="settingsField">
              <span id="${ELEMENT_IDS.AUTO_UPDATE_LABEL}" class="small" data-i18n="ui.autoUpdate">${t('ui.autoUpdate')}</span>
              <label class="settingsCheckbox">
                <input id="${ELEMENT_IDS.AUTO_UPDATE_TOGGLE}" type="checkbox"${hiddenControlAttrs} />
                <span data-i18n="ui.autoUpdateEnable">${t('ui.autoUpdateEnable')}</span>
              </label>
            </div>
            <div id="${ELEMENT_IDS.SETTINGS_VERSION}" class="settingsVersion" hidden></div>
          </div>
          <div id="${ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL}" class="notificationHistoryPanel" hidden>
            <div id="${ELEMENT_IDS.NOTIFICATION_HISTORY_LIST}" class="notificationHistoryList"></div>
          </div>
          ${buildConfirmDialogTemplate(t, {
    dialogId: ELEMENT_IDS.THEME_SWITCH_DIALOG,
    iconHtml: DIALOG_ICON_HTML.WARNING,
    titleKey: 'ui.themeSwitchTitle',
    messageId: ELEMENT_IDS.THEME_SWITCH_MESSAGE,
    messageText: '',
    cancelBtnId: ELEMENT_IDS.THEME_SWITCH_CANCEL_BTN,
    confirmBtnId: ELEMENT_IDS.THEME_SWITCH_CONFIRM_BTN,
    confirmKey: 'ui.themeSwitchConfirm',
    disabled: boot,
  })}
          ${buildConfirmDialogTemplate(t, {
    dialogId: ELEMENT_IDS.UPDATE_APPLY_DIALOG,
    iconHtml: DIALOG_ICON_HTML.SYSTEM_UPDATE,
    titleKey: 'ui.updateApplyDialogTitle',
    messageId: ELEMENT_IDS.UPDATE_APPLY_MESSAGE,
    messageKey: 'ui.updateApplyDialogPrompt',
    cancelBtnId: ELEMENT_IDS.UPDATE_APPLY_CANCEL_BTN,
    confirmBtnId: ELEMENT_IDS.UPDATE_APPLY_CONFIRM_BTN,
    confirmKey: 'ui.updateApplyDialogConfirm',
    disabled: boot,
  })}
          ${buildConfirmDialogTemplate(t, {
    dialogId: ELEMENT_IDS.MOVE_DAILY_DIALOG,
    iconHtml: DIALOG_ICON_HTML.EVENT,
    titleKey: 'ui.moveDailyDialogTitle',
    messageId: ELEMENT_IDS.MOVE_DAILY_MESSAGE,
    messageKey: 'ui.moveDailyDialogPrompt',
    cancelBtnId: ELEMENT_IDS.MOVE_DAILY_CANCEL_BTN,
    confirmBtnId: ELEMENT_IDS.MOVE_DAILY_CONFIRM_BTN,
    confirmKey: 'ui.moveDailyDialogConfirm',
    disabled: boot,
  })}
        </div>
      </div>
    </header>`;
};

const buildControlsPanelMarkup = ({ t, boot = false }) => {
  const controlAttrs = interactiveAttrs(boot);
  const bootLevelOptions = boot ? '<option selected></option>' : '';
  const bootMessage = boot ? renderBootGuideMessage() : '';
  const levelSelectControl = boot
    ? `<div class="bootShellSelectWrap">
            <select id="${ELEMENT_IDS.LEVEL_SEL}" class="bootShellSelect" aria-label="${t('ui.levelSelectAria')}" data-i18n-aria-label="ui.levelSelectAria"${controlAttrs}>${bootLevelOptions}</select>
            <span class="bootShellSelectText" aria-hidden="true"></span>
          </div>`
    : `<select id="${ELEMENT_IDS.LEVEL_SEL}" aria-label="${t('ui.levelSelectAria')}" data-i18n-aria-label="ui.levelSelectAria"${controlAttrs}>${bootLevelOptions}</select>`;
  const levelLabel = boot ? renderBootTextBlock('label') : t('ui.levelLabel');
  const resetLabel = boot
    ? `<span class="controlActionText">${renderBootTextBlock('button')}</span>`
    : `<span class="controlActionText" data-i18n="ui.reset">${t('ui.reset')}</span>`;
  const reverseLabel = boot
    ? `<span class="controlActionText">${renderBootTextBlock('button')}</span>`
    : `<span class="controlActionText" data-i18n="ui.reverse">${t('ui.reverse')}</span>`;
  const guideTitle = boot ? renderBootTextBlock('panel-title') : t('ui.guide');
  const guideToggle = boot ? renderBootTextBlock('mini') : t('ui.hide');

  return `
    <section class="panel">
      <div class="controls">
        <div class="left">
          <label id="${ELEMENT_IDS.LEVEL_LABEL}" class="small" for="${ELEMENT_IDS.LEVEL_SEL}" data-i18n="ui.levelLabel">${levelLabel}</label>
          <div id="${ELEMENT_IDS.LEVEL_SELECT_GROUP}" class="levelSelectGroup">
            ${levelSelectControl}
            <select
              id="${ELEMENT_IDS.INFINITE_SEL}"
              aria-label="${t('ui.levelSelectAria')}"
              data-i18n-aria-label="ui.levelSelectAria"
              hidden
              disabled
              ${boot ? 'tabindex="-1"' : ''}
            ></select>
            <div id="${ELEMENT_IDS.DAILY_META}" class="dailyMeta" hidden>
              <span class="dailyMetaItem">
                <span class="dailyMetaLabel" data-i18n="ui.dailyDateLabel">${t('ui.dailyDateLabel')}</span>
                <strong id="${ELEMENT_IDS.DAILY_DATE_VALUE}" class="dailyMetaValue">-</strong>
              </span>
              <span class="dailyMetaSeparator" aria-hidden="true">•</span>
              <span class="dailyMetaItem">
                <span class="dailyMetaLabel" data-i18n="ui.dailyResetLabel">${t('ui.dailyResetLabel')}</span>
                <strong id="${ELEMENT_IDS.DAILY_COUNTDOWN_VALUE}" class="dailyMetaValue">00:00:00</strong>
              </span>
            </div>
          </div>
          <button id="${ELEMENT_IDS.RESET_BTN}" class="controlActionBtn" title="${t('ui.resetTitle')}" data-i18n-title="ui.resetTitle" type="button"${controlAttrs}>
            <span class="uiIconMaterial controlActionIcon" aria-hidden="true">restart_alt</span>
            ${resetLabel}
          </button>
          <button id="${ELEMENT_IDS.REVERSE_BTN}" class="controlActionBtn" title="${t('ui.reverseTitle')}" data-i18n-title="ui.reverseTitle" type="button"${controlAttrs}>
            <span class="uiIconMaterial controlActionIcon" aria-hidden="true">swap_horiz</span>
            ${reverseLabel}
          </button>
        </div>
      </div>
      <div class="progressNav">
        <button
          id="${ELEMENT_IDS.PREV_INFINITE_BTN}"
          class="nextLevelBtn"
          type="button"
          data-i18n="ui.prevInfinite"
          hidden
          ${boot ? 'disabled tabindex="-1"' : ''}
        >
          ${t('ui.prevInfinite')}
        </button>
        <button
          id="${ELEMENT_IDS.NEXT_LEVEL_BTN}"
          class="nextLevelBtn"
          type="button"
          data-i18n="ui.nextLevel"
          hidden
          ${boot ? 'disabled tabindex="-1"' : ''}
        >
          ${t('ui.nextLevel')}
        </button>
      </div>
      <div class="panelBlock" id="${ELEMENT_IDS.GUIDE_PANEL}">
        <div class="panelHead">
          <span class="panelTitle" data-i18n="ui.guide">${guideTitle}</span>
          <button id="${ELEMENT_IDS.GUIDE_TOGGLE_BTN}" class="miniBtn" type="button" aria-controls="${ELEMENT_IDS.GUIDE_PANEL}"${controlAttrs}>
            ${guideToggle}
          </button>
        </div>
        <div class="panelBody">
          <div class="msgWrap">
            <div id="${ELEMENT_IDS.MSG}" class="msg${boot ? ' bootShellMessage' : ''}">${bootMessage}
            </div>
          </div>
        </div>
      </div>
    </section>`;
};

const buildBoardMarkup = ({ t, boot = false }) => {
  const boardInner = boot
    ? '<div class="bootShellBoard" aria-hidden="true"></div>'
    : `
          <canvas id="${ELEMENT_IDS.CANVAS}"></canvas>
          <canvas id="${ELEMENT_IDS.SYMBOL_CANVAS}"></canvas>
          <div id="${ELEMENT_IDS.GRID}" role="application" aria-label="${t('ui.puzzleGridAria')}" data-i18n-aria-label="ui.puzzleGridAria"></div>`;

  return `
      <div class="panel">
        <div class="boardWrap" id="${ELEMENT_IDS.BOARD_WRAP}">
          ${boardInner}
        </div>
      </div>`;
};

const buildLegendMarkup = ({ t, boot = false }) => {
  const legendTitle = boot ? renderBootTextBlock('panel-title') : t('ui.legend');
  const legendToggle = boot ? renderBootTextBlock('mini') : t('ui.hide');
  const legendBody = boot
    ? `
            <div id="${ELEMENT_IDS.LEGEND}" class="legend">
              <div class="row bootShellLegendRow">
                <div class="badge bootShellLegendBadge"></div>
                <div class="bootShellLegendText"></div>
              </div>
              <div class="row bootShellLegendRow">
                <div class="badge bootShellLegendBadge"></div>
                <div class="bootShellLegendText bootShellLegendText--short"></div>
              </div>
              <div class="row bootShellLegendRow">
                <div class="badge bootShellLegendBadge"></div>
                <div class="bootShellLegendText"></div>
              </div>
            </div>`
    : `
            <div id="${ELEMENT_IDS.LEGEND}" class="legend"></div>`;

  return `
      <aside class="panel">
        <div class="panelBlock${boot ? ' is-hidden' : ''}" id="${ELEMENT_IDS.LEGEND_PANEL}">
          <div class="panelHead">
            <span class="panelTitle" data-i18n="ui.legend">${legendTitle}</span>
            <button id="${ELEMENT_IDS.LEGEND_TOGGLE_BTN}" class="miniBtn" type="button" aria-controls="${ELEMENT_IDS.LEGEND}"${boot ? ' disabled tabindex="-1"' : ''}>
              ${legendToggle}
            </button>
          </div>
          <div class="panelBody">
            ${legendBody}
          </div>
        </div>
      </aside>`;
};

const buildFooterMarkup = ({ t, boot = false }) => `
    <footer class="appFooter">
      <span class="appFooterCopyright">${boot ? renderBootTextBlock('footer') : '&copy; 2026 qb20nh'}</span>
      <a
        class="appFooterGithub"
        href="https://github.com/qb20nh/tether"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="${t('ui.githubRepoAria')}"
        title="${t('ui.githubRepoTitle')}"
        data-i18n-aria-label="ui.githubRepoAria"
        data-i18n-title="ui.githubRepoTitle"
        ${boot ? 'tabindex="-1"' : ''}
      >
        <img
          class="appFooterGithubIcon"
          src="https://github.githubassets.com/favicons/favicon.svg"
          alt=""
          aria-hidden="true"
          width="16"
          height="16"
        />
      </a>
    </footer>`;

const renderShellMarkup = ({
  t = (key) => key,
  localeOptions = [],
  currentLocale = 'ko',
  boot = false,
}) => `
  <div class="app${boot ? ' bootShell' : ''}"${boot ? ' data-boot-shell' : ''}>
${buildHeaderMarkup({ t, localeOptions, currentLocale, boot })}
${buildControlsPanelMarkup({ t, boot })}
    <section class="layout">
${buildBoardMarkup({ t, boot })}
${buildLegendMarkup({ t, boot })}
    </section>
${buildFooterMarkup({ t, boot })}
  </div>
`;

export const renderAppShellMarkup = (options = {}) => {
  return renderShellMarkup({
    ...options,
    boot: false,
  });
};

export const renderBootShellMarkup = (options = {}) =>
  renderShellMarkup({
    t: translateBoot,
    localeOptions: [],
    currentLocale: 'en',
    ...options,
    boot: true,
  });
