import { ELEMENT_IDS } from './config.js';

const buildOptionList = (localeOptions, currentLocale) =>
  (localeOptions || [])
    .map(
      ({ value, label }) =>
        `<option value="${value}" ${value === currentLocale ? 'selected' : ''}>${label}</option>`,
    )
    .join('');

export const APP_SHELL_TEMPLATE = (t = (k) => k, localeOptions = [], currentLocale = 'ko') => `
  <div class="app">
  <header>
    <div class="topbarRow">
      <h1>TETHER <span class="subtitle">v3</span></h1>
        <div class="topbarControls">
          <label id="${ELEMENT_IDS.LANG_LABEL}" class="small" for="${ELEMENT_IDS.LANG_SEL}" data-i18n="ui.language">${t(
            'ui.language',
          )}</label>
          <select id="${ELEMENT_IDS.LANG_SEL}">
            ${buildOptionList(localeOptions, currentLocale)}
          </select>
          <span id="${ELEMENT_IDS.THEME_LABEL}" class="small" data-i18n="ui.theme">${t('ui.theme')}</span>
          <button id="${ELEMENT_IDS.THEME_TOGGLE}" type="button">${t('ui.themeDark')}</button>
          <dialog id="${ELEMENT_IDS.THEME_SWITCH_DIALOG}">
            <form method="dialog" class="themeSwitchDialog">
              <div class="themeSwitchDialog__header">
                <span class="themeSwitchDialog__icon" aria-hidden="true">⚠</span>
                <h3 class="themeSwitchDialog__title" data-i18n="ui.themeSwitchTitle">
                  ${t('ui.themeSwitchTitle')}
                </h3>
              </div>
              <p id="${ELEMENT_IDS.THEME_SWITCH_MESSAGE}"></p>
              <div class="themeSwitchDialog__actions">
                <button
                  id="${ELEMENT_IDS.THEME_SWITCH_CANCEL_BTN}"
                  value="cancel"
                  formmethod="dialog"
                  type="submit"
                  class="themeSwitchDialog__actionBtn themeSwitchDialog__actionBtn--no"
                >
                  <span class="themeSwitchDialog__actionIcon" aria-hidden="true">✕</span>
                  <span class="themeSwitchDialog__actionText" data-i18n="ui.cancel">${t('ui.cancel')}</span>
                </button>
                <button
                  id="${ELEMENT_IDS.THEME_SWITCH_CONFIRM_BTN}"
                  value="confirm"
                  type="submit"
                  class="themeSwitchDialog__actionBtn themeSwitchDialog__actionBtn--yes"
                >
                  <span class="themeSwitchDialog__actionIcon" aria-hidden="true">✓</span>
                  <span class="themeSwitchDialog__actionText" data-i18n="ui.themeSwitchConfirm">${t(
                    'ui.themeSwitchConfirm',
                  )}</span>
                </button>
              </div>
            </form>
          </dialog>
        </div>
      </div>
    </header>

    <section class="panel">
      <div class="controls">
        <div class="left">
          <label id="${ELEMENT_IDS.LEVEL_LABEL}" class="small" for="${ELEMENT_IDS.LEVEL_SEL}" data-i18n="ui.levelLabel">${t(
            'ui.levelLabel',
          )}</label>
          <div id="${ELEMENT_IDS.LEVEL_SELECT_GROUP}" class="levelSelectGroup">
            <select id="${ELEMENT_IDS.LEVEL_SEL}" aria-label="${t('ui.levelSelectAria')}" data-i18n-aria-label="ui.levelSelectAria"></select>
            <select
              id="${ELEMENT_IDS.INFINITE_SEL}"
              aria-label="${t('ui.levelSelectAria')}"
              data-i18n-aria-label="ui.levelSelectAria"
              hidden
              disabled
            ></select>
          </div>
          <button id="${ELEMENT_IDS.RESET_BTN}" title="${t('ui.resetTitle')}" data-i18n="ui.reset" data-i18n-title="ui.resetTitle">${t(
            'ui.reset',
          )}</button>
          <button id="${ELEMENT_IDS.REVERSE_BTN}" title="${t('ui.reverseTitle')}" data-i18n="ui.reverse" data-i18n-title="ui.reverseTitle">${t(
            'ui.reverse',
          )}</button>
        </div>
      </div>
      <div class="panelBlock" id="${ELEMENT_IDS.GUIDE_PANEL}">
        <div class="panelHead">
          <span class="panelTitle" data-i18n="ui.guide">${t('ui.guide')}</span>
          <button id="${ELEMENT_IDS.GUIDE_TOGGLE_BTN}" class="miniBtn" type="button" aria-controls="${ELEMENT_IDS.GUIDE_PANEL}">
            ${t('ui.hide')}
          </button>
        </div>
        <div class="panelBody">
          <div class="msgWrap">
            <div id="${ELEMENT_IDS.MSG}" class="msg"></div>
            <div class="progressNav">
              <button
                id="${ELEMENT_IDS.PREV_INFINITE_BTN}"
                class="nextLevelBtn"
                type="button"
                data-i18n="ui.prevInfinite"
                hidden
              >
                ${t('ui.prevInfinite')}
              </button>
              <button
                id="${ELEMENT_IDS.NEXT_LEVEL_BTN}"
                class="nextLevelBtn"
                type="button"
                data-i18n="ui.nextLevel"
                hidden
              >
                ${t('ui.nextLevel')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="layout">
      <div class="panel">
        <div class="boardWrap" id="${ELEMENT_IDS.BOARD_WRAP}">
          <canvas id="${ELEMENT_IDS.CANVAS}"></canvas>
          <canvas id="${ELEMENT_IDS.SYMBOL_CANVAS}"></canvas>
          <div id="${ELEMENT_IDS.GRID}" role="application" aria-label="${t('ui.puzzleGridAria')}" data-i18n-aria-label="ui.puzzleGridAria"></div>
        </div>
      </div>

      <aside class="panel">
        <div class="panelBlock" id="${ELEMENT_IDS.LEGEND_PANEL}">
          <div class="panelHead">
            <span class="panelTitle" data-i18n="ui.legend">${t('ui.legend')}</span>
            <button id="${ELEMENT_IDS.LEGEND_TOGGLE_BTN}" class="miniBtn" type="button" aria-controls="${ELEMENT_IDS.LEGEND}">
              ${t('ui.hide')}
            </button>
          </div>
          <div class="panelBody">
            <div id="${ELEMENT_IDS.LEGEND}" class="legend"></div>
          </div>
        </div>
      </aside>
    </section>
  </div>
`;

export const buildLegendTemplate = (definitions, icons, iconX, t = (k) => k) =>
  definitions
    .map((item) => {
      if (item.type === 'controls') {
        return `<div class="row"><div class="badge">${item.badgeText || ''}</div><div>${t('legend.controls')}</div></div>`;
      }

      if (item.type === 'group') {
        const badges = item.badgeIds
          .map((id, idx) => `<div class="badge" id="${id}">${icons[item.iconCodes[idx]] || ''}</div>`)
          .join('');
        return `<div class="row"><div class="badgeGroup">${badges}</div><div>${t(item.htmlKey || '')}</div></div>`;
      }

      const iconCode = item.iconCode;
      const iconMarkup = iconCode === 'x'
        ? iconX
        : icons[iconCode] || item.badgeText || '';
      return `<div class="row"><div class="badge" id="${item.badgeId}">${iconMarkup}</div><div>${t(item.htmlKey)}</div></div>`;
    })
    .join('');
