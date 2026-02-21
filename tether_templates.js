import { ELEMENT_IDS } from './tether_config.js';

export const APP_SHELL_TEMPLATE = `
  <div class="app">
    <header>
      <div style="display:flex; align-items:baseline; gap:10px;">
        <h1>TETHER <span class="subtitle">v3</span></h1>
      </div>
    </header>

    <section class="panel">
      <div class="controls">
        <div class="left">
          <label class="small" for="${ELEMENT_IDS.LEVEL_SEL}">레벨</label>
          <select id="${ELEMENT_IDS.LEVEL_SEL}" aria-label="레벨 선택"></select>
          <button id="${ELEMENT_IDS.RESET_BTN}" title="경로 초기화">Reset</button>
          <button id="${ELEMENT_IDS.REVERSE_BTN}" title="경로 방향 뒤집기">Reverse</button>
        </div>
      </div>
      <div class="panelBlock" id="${ELEMENT_IDS.GUIDE_PANEL}">
        <div class="panelHead">
          <span class="panelTitle">가이드</span>
          <button id="${ELEMENT_IDS.GUIDE_TOGGLE_BTN}" class="miniBtn" type="button" aria-controls="${ELEMENT_IDS.GUIDE_PANEL}">
            숨기기
          </button>
        </div>
        <div class="panelBody">
          <div id="${ELEMENT_IDS.MSG}" class="msg"></div>
        </div>
      </div>
    </section>

    <section class="layout">
      <div class="panel">
        <div class="boardWrap" id="${ELEMENT_IDS.BOARD_WRAP}">
          <canvas id="${ELEMENT_IDS.CANVAS}"></canvas>
          <div id="${ELEMENT_IDS.GRID}" role="application" aria-label="퍼즐 그리드"></div>
        </div>
      </div>

      <aside class="panel">
        <div class="panelBlock" id="${ELEMENT_IDS.LEGEND_PANEL}">
          <div class="panelHead">
            <span class="panelTitle">힌트 / 제약</span>
            <button id="${ELEMENT_IDS.LEGEND_TOGGLE_BTN}" class="miniBtn" type="button" aria-controls="${ELEMENT_IDS.LEGEND}">
              숨기기
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

export const buildLegendTemplate = (definitions, icons, iconX) =>
  definitions
    .map((item) => {
      if (item.type === 'group') {
        const badges = item.badgeIds
          .map((id, idx) => `<div class="badge" id="${id}">${icons[item.iconCodes[idx]] || ''}</div>`)
          .join('');
        return `<div class="row"><div class="badgeGroup">${badges}</div><div>${item.html}</div></div>`;
      }

      if (item.badgeId === 'controls') {
        return `<div class="row"><div class="badge">조작</div><div>${item.html}</div></div>`;
      }

      const iconCode = item.iconCode;
      const iconMarkup = iconCode === 'x' ? iconX : icons[iconCode] || '';
      return `<div class="row"><div class="badge" id="${item.badgeId}">${iconMarkup}</div><div>${item.html}</div></div>`;
    })
    .join('');
