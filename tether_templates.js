import { ELEMENT_IDS } from './tether_config.js';

export const APP_SHELL_TEMPLATE = `
  <div class="app">
    <header>
      <div style="display:flex; align-items:baseline; gap:10px;">
        <h1>TETHER <span class="subtitle">v3 (RPS + movable wall)</span></h1>
      </div>
      <div class="small">빈 칸에서 시작 → 드래그로 확장</div>
    </header>

    <section class="panel">
      <div class="controls">
        <div class="left">
          <label class="small" for="${ELEMENT_IDS.LEVEL_SEL}">레벨</label>
          <select id="${ELEMENT_IDS.LEVEL_SEL}" aria-label="레벨 선택"></select>
          <button id="${ELEMENT_IDS.RESET_BTN}" title="경로 초기화">Reset</button>
          <button id="${ELEMENT_IDS.UNDO_BTN}" title="한 칸 되돌리기">Undo</button>
          <button id="${ELEMENT_IDS.REVERSE_BTN}" title="경로 방향 뒤집기">Reverse</button>
          <button id="${ELEMENT_IDS.TOGGLE_IDX_BTN}" title="방문 순서 표시 토글">Show #</button>
        </div>
        <div class="right stat">
          <span class="pill"><small>Visited</small> <span id="${ELEMENT_IDS.VISITED_TEXT}">0/0</span></span>
          <span class="pill"><small>Hint</small> <span id="${ELEMENT_IDS.HINT_TEXT}">—</span></span>
          <span class="pill"><small>Stitch</small> <span id="${ELEMENT_IDS.STITCH_TEXT}">—</span></span>
          <span class="pill"><small>RPS</small> <span id="${ELEMENT_IDS.RPS_TEXT}">—</span></span>
        </div>
      </div>
      <div id="${ELEMENT_IDS.MSG}" class="msg"></div>
    </section>

    <section class="layout">
      <div class="panel">
        <div class="boardWrap" id="${ELEMENT_IDS.BOARD_WRAP}">
          <canvas id="${ELEMENT_IDS.CANVAS}"></canvas>
          <div id="${ELEMENT_IDS.GRID}" role="application" aria-label="퍼즐 그리드"></div>
        </div>
      </div>

      <aside class="panel">
        <div id="${ELEMENT_IDS.LEGEND}" class="legend"></div>
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
