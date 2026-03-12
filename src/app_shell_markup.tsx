import renderToString from 'preact-render-to-string';
import type { ComponentChildren } from 'preact';
import { ELEMENT_IDS } from './config.ts';

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
  'ui.keyboardGamepadControls': 'Keyboard / gamepad controls',
  'ui.keyboardGamepadControlsEnable': 'Enable keyboard / gamepad controls',
  'ui.notificationsEnable': 'Enable notifications',
  'ui.autoUpdate': 'Auto update',
  'ui.autoUpdateEnable': 'Enable auto update',
});

const BOOT_GUIDE_PLACEHOLDERS = Object.freeze([
  'Goal visit every open cell once.',
  'This level start anywhere.',
]);

const translateBoot = (key: string) => BOOT_LABELS[key as keyof typeof BOOT_LABELS] || key;

export type ShellTranslator = (key: string) => string;

export type ShellLocaleOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export type ShellRenderOptions = {
  currentLocale?: string;
  localeOptions?: readonly ShellLocaleOption[];
  t?: ShellTranslator;
};

type ShellProps = {
  boot?: boolean;
  currentLocale: string;
  localeOptions: readonly ShellLocaleOption[];
  t: ShellTranslator;
};

type ConfirmDialogProps = {
  cancelBtnId: string;
  confirmBtnId: string;
  confirmKey: string;
  dialogId: string;
  disabled?: boolean;
  iconCode: 'event' | 'system_update' | 'warning';
  messageId: string;
  messageKey?: string;
  messageText?: string;
  t: ShellTranslator;
  titleKey: string;
};

type BootTextBlockProps = {
  modifier?: string;
};

const interactiveProps = (disabled = false) => (
  disabled
    ? {
      disabled: true,
      tabIndex: -1,
    }
    : {}
);

const BootTextBlock = ({ modifier = 'mid' }: BootTextBlockProps) => (
  <span class={`bootShellTextBlock bootShellTextBlock--${modifier}`} aria-hidden="true" />
);

const BootGuideMessage = () => (
  <div class="bootShellMessageText" aria-hidden="true">
    <span class="bootShellGuideLine">
      {BOOT_GUIDE_PLACEHOLDERS[0]}
      <br />
      {BOOT_GUIDE_PLACEHOLDERS[1]}
    </span>
  </div>
);

const DialogIcon = ({ code }: { code: ConfirmDialogProps['iconCode'] }) => (
  <span class="themeSwitchDialog__icon uiIconMaterial" aria-hidden="true">
    {code}
  </span>
);

const BoardFocusProxy = ({ t, boot = false }: Pick<ShellProps, 't'> & { boot?: boolean }) => (
  <button
    id={ELEMENT_IDS.BOARD_FOCUS_PROXY}
    class="boardFocusProxy"
    type="button"
    data-i18n="ui.puzzleGridAria"
    {...interactiveProps(boot)}
  >
    {t('ui.puzzleGridAria')}
  </button>
);

const ConfirmDialog = ({
  cancelBtnId,
  confirmBtnId,
  confirmKey,
  dialogId,
  disabled = false,
  iconCode,
  messageId,
  messageKey = '',
  messageText = '',
  t,
  titleKey,
}: ConfirmDialogProps) => {
  const resolvedMessage = messageKey ? t(messageKey) : messageText;

  return (
    <dialog id={dialogId} class="appConfirmDialog">
      <form method="dialog" class="themeSwitchDialog">
        <div class="themeSwitchDialog__header">
          <DialogIcon code={iconCode} />
          <h3 class="themeSwitchDialog__title" data-i18n={titleKey}>
            {t(titleKey)}
          </h3>
        </div>
        <p id={messageId} data-i18n={messageKey || undefined}>
          {resolvedMessage}
        </p>
        <div class="themeSwitchDialog__actions">
          <button
            id={cancelBtnId}
            value="cancel"
            formMethod="dialog"
            type="submit"
            class="themeSwitchDialog__actionBtn themeSwitchDialog__actionBtn--no"
            {...interactiveProps(disabled)}
          >
            <span class="themeSwitchDialog__actionIcon uiIconMaterial" aria-hidden="true">
              close
            </span>
            <span class="themeSwitchDialog__actionText" data-i18n="ui.cancel">
              {t('ui.cancel')}
            </span>
          </button>
          <button
            id={confirmBtnId}
            value="confirm"
            type="submit"
            class="themeSwitchDialog__actionBtn themeSwitchDialog__actionBtn--yes"
            {...interactiveProps(disabled)}
          >
            <span class="themeSwitchDialog__actionIcon uiIconMaterial" aria-hidden="true">
              check
            </span>
            <span class="themeSwitchDialog__actionText" data-i18n={confirmKey}>
              {t(confirmKey)}
            </span>
          </button>
        </div>
      </form>
    </dialog>
  );
};

const Header = ({ t, localeOptions, currentLocale, boot = false }: ShellProps) => (
  <header>
    <div class="topbarRow">
      <h1 class="brandTitle">
        <span class="brandLogo" aria-hidden="true" />
        <span>TETHER</span>
      </h1>
      <div class="topbarControls">
        <div id={ELEMENT_IDS.SCORE_META} class="scoreMeta isInactive" aria-live="polite" aria-hidden="true">
          <span class="scoreMetaItem">
            <span id={ELEMENT_IDS.INFINITE_SCORE_LABEL} class="scoreMetaLabel">
              ∞
            </span>
            <strong id={ELEMENT_IDS.INFINITE_SCORE_VALUE} class="scoreMetaValue">
              0
            </strong>
          </span>
          <span class="scoreMetaSeparator" aria-hidden="true">
            •
          </span>
          <span class="scoreMetaItem">
            <span id={ELEMENT_IDS.DAILY_SCORE_LABEL} class="scoreMetaLabel">
              {t('ui.dailyLevelOption')}
            </span>
            <strong id={ELEMENT_IDS.DAILY_SCORE_VALUE} class="scoreMetaValue">
              0
            </strong>
          </span>
        </div>
        <button
          id={ELEMENT_IDS.NOTIFICATION_HISTORY_TOGGLE}
          class="settingsToggle notificationHistoryToggle"
          type="button"
          aria-haspopup="true"
          aria-expanded="false"
          aria-controls={ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL}
          aria-label={t('ui.notifications')}
          title={t('ui.notifications')}
          data-i18n-aria-label="ui.notifications"
          data-i18n-title="ui.notifications"
          {...interactiveProps(boot)}
        >
          <span class="uiIconMaterial" aria-hidden="true">
            notifications
          </span>
          <span id={ELEMENT_IDS.NOTIFICATION_HISTORY_BADGE} class="notificationHistoryBadge" hidden />
        </button>
        <div id={ELEMENT_IDS.NOTIFICATION_HISTORY_PANEL} class="notificationHistoryPanel" hidden>
          <div id={ELEMENT_IDS.NOTIFICATION_HISTORY_LIST} class="notificationHistoryList" />
        </div>
        <button
          id={ELEMENT_IDS.SETTINGS_TOGGLE}
          class="settingsToggle"
          type="button"
          aria-haspopup="true"
          aria-expanded="false"
          aria-controls={ELEMENT_IDS.SETTINGS_PANEL}
          aria-label={`${t('ui.language')} / ${t('ui.theme')}`}
          title={`${t('ui.language')} / ${t('ui.theme')}`}
          {...interactiveProps(boot)}
        >
          <span class="uiIconMaterial" aria-hidden="true">
            settings
          </span>
        </button>
        <div id={ELEMENT_IDS.SETTINGS_PANEL} class="settingsPanel" hidden>
          <div class="settingsField">
            <label id={ELEMENT_IDS.LANG_LABEL} class="small settingsLabelWithIcon" htmlFor={ELEMENT_IDS.LANG_SEL}>
              <span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">
                language
              </span>
              <span data-i18n="ui.language">{t('ui.language')}</span>
            </label>
            <select id={ELEMENT_IDS.LANG_SEL} {...interactiveProps(boot)}>
              {localeOptions.map((option) => (
                <option value={option.value} disabled={option.disabled} selected={option.value === currentLocale}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div class="settingsField">
            <span id={ELEMENT_IDS.THEME_LABEL} class="small settingsLabelWithIcon">
              <span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">
                palette
              </span>
              <span data-i18n="ui.theme">{t('ui.theme')}</span>
            </span>
            <button id={ELEMENT_IDS.THEME_TOGGLE} type="button" {...interactiveProps(boot)}>
              {t('ui.themeDark')}
            </button>
          </div>
          <div class="settingsField">
            <span id={ELEMENT_IDS.LOW_POWER_LABEL} class="small" data-i18n="ui.lowPowerMode">
              {t('ui.lowPowerMode')}
            </span>
            <label class="settingsCheckbox">
              <input id={ELEMENT_IDS.LOW_POWER_TOGGLE} type="checkbox" {...interactiveProps(boot)} />
              <span data-i18n="ui.lowPowerModeEnable">{t('ui.lowPowerModeEnable')}</span>
            </label>
          </div>
          <div class="settingsField">
            <span
              id={ELEMENT_IDS.KEYBOARD_GAMEPAD_LABEL}
              class="small"
              data-i18n="ui.keyboardGamepadControls"
            >
              {t('ui.keyboardGamepadControls')}
            </span>
            <label class="settingsCheckbox">
              <input id={ELEMENT_IDS.KEYBOARD_GAMEPAD_TOGGLE} type="checkbox" {...interactiveProps(boot)} />
              <span data-i18n="ui.keyboardGamepadControlsEnable">
                {t('ui.keyboardGamepadControlsEnable')}
              </span>
            </label>
          </div>
          <div class="settingsField">
            <span id={ELEMENT_IDS.NOTIFICATIONS_LABEL} class="small" data-i18n="ui.notifications">
              {t('ui.notifications')}
            </span>
            <label class="settingsCheckbox">
              <input id={ELEMENT_IDS.NOTIFICATIONS_TOGGLE} type="checkbox" {...interactiveProps(boot)} />
              <span data-i18n="ui.notificationsEnable">{t('ui.notificationsEnable')}</span>
            </label>
          </div>
          <div class="settingsField">
            <span id={ELEMENT_IDS.AUTO_UPDATE_LABEL} class="small" data-i18n="ui.autoUpdate">
              {t('ui.autoUpdate')}
            </span>
            <label class="settingsCheckbox">
              <input id={ELEMENT_IDS.AUTO_UPDATE_TOGGLE} type="checkbox" {...interactiveProps(boot)} />
              <span data-i18n="ui.autoUpdateEnable">{t('ui.autoUpdateEnable')}</span>
            </label>
          </div>
          <div id={ELEMENT_IDS.SETTINGS_VERSION} class="settingsVersion" hidden />
        </div>
        <ConfirmDialog
          dialogId={ELEMENT_IDS.THEME_SWITCH_DIALOG}
          iconCode="warning"
          titleKey="ui.themeSwitchTitle"
          messageId={ELEMENT_IDS.THEME_SWITCH_MESSAGE}
          messageText=""
          cancelBtnId={ELEMENT_IDS.THEME_SWITCH_CANCEL_BTN}
          confirmBtnId={ELEMENT_IDS.THEME_SWITCH_CONFIRM_BTN}
          confirmKey="ui.themeSwitchConfirm"
          disabled={boot}
          t={t}
        />
        <ConfirmDialog
          dialogId={ELEMENT_IDS.UPDATE_APPLY_DIALOG}
          iconCode="system_update"
          titleKey="ui.updateApplyDialogTitle"
          messageId={ELEMENT_IDS.UPDATE_APPLY_MESSAGE}
          messageKey="ui.updateApplyDialogPrompt"
          cancelBtnId={ELEMENT_IDS.UPDATE_APPLY_CANCEL_BTN}
          confirmBtnId={ELEMENT_IDS.UPDATE_APPLY_CONFIRM_BTN}
          confirmKey="ui.updateApplyDialogConfirm"
          disabled={boot}
          t={t}
        />
        <ConfirmDialog
          dialogId={ELEMENT_IDS.MOVE_DAILY_DIALOG}
          iconCode="event"
          titleKey="ui.moveDailyDialogTitle"
          messageId={ELEMENT_IDS.MOVE_DAILY_MESSAGE}
          messageKey="ui.moveDailyDialogPrompt"
          cancelBtnId={ELEMENT_IDS.MOVE_DAILY_CANCEL_BTN}
          confirmBtnId={ELEMENT_IDS.MOVE_DAILY_CONFIRM_BTN}
          confirmKey="ui.moveDailyDialogConfirm"
          disabled={boot}
          t={t}
        />
      </div>
    </div>
  </header>
);

const ControlsPanel = ({ t, boot = false }: Pick<ShellProps, 't'> & { boot?: boolean }) => {
  const bootLevelOptions = boot
    ? [<option selected></option>]
    : [];
  const levelLabel: ComponentChildren = boot ? <BootTextBlock modifier="label" /> : t('ui.levelLabel');
  const resetLabel = boot
    ? (
      <span class="controlActionText">
        <BootTextBlock modifier="button" />
      </span>
      )
    : (
      <span class="controlActionText" data-i18n="ui.reset">
        {t('ui.reset')}
      </span>
      );
  const reverseLabel = boot
    ? (
      <span class="controlActionText">
        <BootTextBlock modifier="button" />
      </span>
      )
    : (
      <span class="controlActionText" data-i18n="ui.reverse">
        {t('ui.reverse')}
      </span>
      );
  const guideTitle: ComponentChildren = boot ? <BootTextBlock modifier="panel-title" /> : t('ui.guide');
  const guideToggle: ComponentChildren = boot ? <BootTextBlock modifier="mini" /> : t('ui.hide');

  return (
    <section class="panel">
      <div class="controls">
        <div class="left">
          <label id={ELEMENT_IDS.LEVEL_LABEL} class="small" htmlFor={ELEMENT_IDS.LEVEL_SEL} data-i18n="ui.levelLabel">
            {levelLabel}
          </label>
          <div id={ELEMENT_IDS.LEVEL_SELECT_GROUP} class="levelSelectGroup">
            {boot ? (
              <div class="bootShellSelectWrap">
                <select
                  id={ELEMENT_IDS.LEVEL_SEL}
                  class="bootShellSelect"
                  aria-label={t('ui.levelSelectAria')}
                  data-i18n-aria-label="ui.levelSelectAria"
                  {...interactiveProps(true)}
                >
                  {bootLevelOptions}
                </select>
                <span class="bootShellSelectText" aria-hidden="true" />
              </div>
            ) : (
              <select
                id={ELEMENT_IDS.LEVEL_SEL}
                aria-label={t('ui.levelSelectAria')}
                data-i18n-aria-label="ui.levelSelectAria"
              />
            )}
            <select
              id={ELEMENT_IDS.INFINITE_SEL}
              aria-label={t('ui.levelSelectAria')}
              data-i18n-aria-label="ui.levelSelectAria"
              hidden
              disabled
              tabIndex={boot ? -1 : undefined}
            />
            <div id={ELEMENT_IDS.DAILY_META} class="dailyMeta" hidden>
              <span class="dailyMetaItem">
                <span class="dailyMetaLabel" data-i18n="ui.dailyDateLabel">
                  {t('ui.dailyDateLabel')}
                </span>
                <strong id={ELEMENT_IDS.DAILY_DATE_VALUE} class="dailyMetaValue">
                  -
                </strong>
              </span>
              <span class="dailyMetaSeparator" aria-hidden="true">
                •
              </span>
              <span class="dailyMetaItem">
                <span class="dailyMetaLabel" data-i18n="ui.dailyResetLabel">
                  {t('ui.dailyResetLabel')}
                </span>
                <strong id={ELEMENT_IDS.DAILY_COUNTDOWN_VALUE} class="dailyMetaValue">
                  00:00:00
                </strong>
              </span>
            </div>
          </div>
          <button
            id={ELEMENT_IDS.RESET_BTN}
            class="controlActionBtn"
            title={t('ui.resetTitle')}
            data-i18n-title="ui.resetTitle"
            type="button"
            {...interactiveProps(boot)}
          >
            <span class="uiIconMaterial controlActionIcon" aria-hidden="true">
              restart_alt
            </span>
            {resetLabel}
          </button>
          <button
            id={ELEMENT_IDS.REVERSE_BTN}
            class="controlActionBtn"
            title={t('ui.reverseTitle')}
            data-i18n-title="ui.reverseTitle"
            type="button"
            {...interactiveProps(boot)}
          >
            <span class="uiIconMaterial controlActionIcon" aria-hidden="true">
              swap_horiz
            </span>
            {reverseLabel}
          </button>
        </div>
      </div>
      <div class="progressNav">
        <button
          id={ELEMENT_IDS.PREV_INFINITE_BTN}
          class="nextLevelBtn"
          type="button"
          data-i18n="ui.prevInfinite"
          hidden
          {...interactiveProps(boot)}
        >
          {t('ui.prevInfinite')}
        </button>
        <button
          id={ELEMENT_IDS.NEXT_LEVEL_BTN}
          class="nextLevelBtn"
          type="button"
          data-i18n="ui.nextLevel"
          hidden
          {...interactiveProps(boot)}
        >
          {t('ui.nextLevel')}
        </button>
      </div>
      <div class="panelBlock" id={ELEMENT_IDS.GUIDE_PANEL}>
        <div class="panelHead">
          <span class="panelTitle" data-i18n="ui.guide">
            {guideTitle}
          </span>
          <button
            id={ELEMENT_IDS.GUIDE_TOGGLE_BTN}
            class="miniBtn"
            type="button"
            aria-controls={ELEMENT_IDS.GUIDE_PANEL}
            {...interactiveProps(boot)}
          >
            {guideToggle}
          </button>
        </div>
        <div class="panelBody">
          <div class="msgWrap">
            <div id={ELEMENT_IDS.MSG} class={`msg${boot ? ' bootShellMessage' : ''}`}>
              {boot ? <BootGuideMessage /> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const Board = ({ t, boot = false }: Pick<ShellProps, 't'> & { boot?: boolean }) => (
  <div class="panel">
    <div class="boardWrap" id={ELEMENT_IDS.BOARD_WRAP}>
      {boot ? (
        <div class="bootShellBoard" aria-hidden="true" />
      ) : (
        <>
          <canvas id={ELEMENT_IDS.CANVAS}></canvas>
          <canvas id={ELEMENT_IDS.SYMBOL_CANVAS}></canvas>
          <div
            id={ELEMENT_IDS.GRID}
            role="application"
            tabIndex={0}
            aria-label={t('ui.puzzleGridAria')}
            data-i18n-aria-label="ui.puzzleGridAria"
          />
        </>
      )}
    </div>
  </div>
);

const Legend = ({ t, boot = false }: Pick<ShellProps, 't'> & { boot?: boolean }) => {
  const legendTitle: ComponentChildren = boot ? <BootTextBlock modifier="panel-title" /> : t('ui.legend');
  const legendToggle: ComponentChildren = boot ? <BootTextBlock modifier="mini" /> : t('ui.hide');

  return (
    <aside class="panel">
      <div class={`panelBlock${boot ? ' is-hidden' : ''}`} id={ELEMENT_IDS.LEGEND_PANEL}>
        <div class="panelHead">
          <span class="panelTitle" data-i18n="ui.legend">
            {legendTitle}
          </span>
          <button
            id={ELEMENT_IDS.LEGEND_TOGGLE_BTN}
            class="miniBtn"
            type="button"
            aria-controls={ELEMENT_IDS.LEGEND}
            {...interactiveProps(boot)}
          >
            {legendToggle}
          </button>
        </div>
        <div class="panelBody">
          {boot ? (
            <div id={ELEMENT_IDS.LEGEND} class="legend">
              <div class="row bootShellLegendRow">
                <div class="badge bootShellLegendBadge" />
                <div class="bootShellLegendText" />
              </div>
              <div class="row bootShellLegendRow">
                <div class="badge bootShellLegendBadge" />
                <div class="bootShellLegendText bootShellLegendText--short" />
              </div>
              <div class="row bootShellLegendRow">
                <div class="badge bootShellLegendBadge" />
                <div class="bootShellLegendText" />
              </div>
            </div>
          ) : (
            <div id={ELEMENT_IDS.LEGEND} class="legend" />
          )}
        </div>
      </div>
    </aside>
  );
};

const Footer = ({ t, boot = false }: Pick<ShellProps, 't'> & { boot?: boolean }) => (
  <footer class="appFooter">
    <span class="appFooterCopyright">
      {boot ? <BootTextBlock modifier="footer" /> : '© 2026 qb20nh'}
    </span>
    <a
      class="appFooterGithub"
      href="https://github.com/qb20nh/tether"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('ui.githubRepoAria')}
      title={t('ui.githubRepoTitle')}
      data-i18n-aria-label="ui.githubRepoAria"
      data-i18n-title="ui.githubRepoTitle"
      tabIndex={boot ? -1 : undefined}
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
  </footer>
);

export const AppShell = ({
  boot = false,
  currentLocale,
  localeOptions,
  t,
}: ShellProps) => (
  <div class={`app${boot ? ' bootShell' : ''}`} data-boot-shell={boot ? '' : undefined}>
    <BoardFocusProxy t={t} boot={boot} />
    <Header t={t} localeOptions={localeOptions} currentLocale={currentLocale} boot={boot} />
    <ControlsPanel t={t} boot={boot} />
    <section class="layout">
      <Board t={t} boot={boot} />
      <Legend t={t} boot={boot} />
    </section>
    <Footer t={t} boot={boot} />
  </div>
);

const renderShellMarkup = ({
  boot = false,
  currentLocale = 'ko',
  localeOptions = [],
  t = (key) => key,
}: ShellProps) =>
  renderToString(
    <AppShell
      boot={boot}
      currentLocale={currentLocale}
      localeOptions={localeOptions}
      t={t}
    />,
  );

export const renderAppShellMarkup = (options: ShellRenderOptions = {}) =>
  renderShellMarkup({
    ...options,
    boot: false,
    currentLocale: options.currentLocale ?? 'ko',
    localeOptions: options.localeOptions ?? [],
    t: options.t ?? ((key) => key),
  });

export const renderBootShellMarkup = (options: ShellRenderOptions = {}) =>
  renderShellMarkup({
    ...options,
    boot: true,
    currentLocale: options.currentLocale ?? 'en',
    localeOptions: options.localeOptions ?? [],
    t: options.t ?? translateBoot,
  });
