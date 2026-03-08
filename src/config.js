export const CELL_TYPES = {
  EMPTY: '.',
  WALL: '#',
  MOVABLE_WALL: 'm',
  HINT_TURN: 't',
  HINT_CW: 'r',
  HINT_CCW: 'l',
  HINT_STRAIGHT: 's',
  HINT_HORIZONTAL: 'h',
  HINT_VERTICAL: 'v',
  RPS_SCISSORS: 'g',
  RPS_ROCK: 'b',
  RPS_PAPER: 'p',
};

export const isObstacle = (ch) => ch === CELL_TYPES.WALL || ch === CELL_TYPES.MOVABLE_WALL;

export const HINT_CODES = new Set([
  CELL_TYPES.HINT_TURN,
  CELL_TYPES.HINT_CW,
  CELL_TYPES.HINT_CCW,
  CELL_TYPES.HINT_STRAIGHT,
  CELL_TYPES.HINT_HORIZONTAL,
  CELL_TYPES.HINT_VERTICAL,
]);

export const RPS_CODES = new Set([
  CELL_TYPES.RPS_SCISSORS,
  CELL_TYPES.RPS_ROCK,
  CELL_TYPES.RPS_PAPER,
]);

export const RPS_WIN_ORDER = {
  [CELL_TYPES.RPS_SCISSORS]: CELL_TYPES.RPS_ROCK,
  [CELL_TYPES.RPS_ROCK]: CELL_TYPES.RPS_PAPER,
  [CELL_TYPES.RPS_PAPER]: CELL_TYPES.RPS_SCISSORS,
};

export const ELEMENT_IDS = Object.freeze({
  APP: 'app',
  LEVEL_SEL: 'levelSel',
  LEVEL_SELECT_GROUP: 'levelSelectGroup',
  INFINITE_SEL: 'infiniteSel',
  DAILY_META: 'dailyMeta',
  DAILY_DATE_VALUE: 'dailyDateValue',
  DAILY_COUNTDOWN_VALUE: 'dailyCountdownValue',
  SCORE_META: 'scoreMeta',
  INFINITE_SCORE_LABEL: 'infiniteScoreLabel',
  INFINITE_SCORE_VALUE: 'infiniteScoreValue',
  DAILY_SCORE_LABEL: 'dailyScoreLabel',
  DAILY_SCORE_VALUE: 'dailyScoreValue',
  LEVEL_LABEL: 'levelLabel',
  LANG_LABEL: 'langLabel',
  LANG_SEL: 'langSel',
  THEME_LABEL: 'themeLabel',
  THEME_TOGGLE: 'themeToggle',
  LOW_POWER_LABEL: 'lowPowerLabel',
  LOW_POWER_TOGGLE: 'lowPowerToggle',
  NOTIFICATIONS_LABEL: 'notificationsLabel',
  NOTIFICATIONS_TOGGLE: 'notificationsToggle',
  AUTO_UPDATE_LABEL: 'autoUpdateLabel',
  AUTO_UPDATE_TOGGLE: 'autoUpdateToggle',
  NOTIFICATION_HISTORY_TOGGLE: 'notificationHistoryToggle',
  NOTIFICATION_HISTORY_BADGE: 'notificationHistoryBadge',
  NOTIFICATION_HISTORY_PANEL: 'notificationHistoryPanel',
  NOTIFICATION_HISTORY_LIST: 'notificationHistoryList',
  SETTINGS_TOGGLE: 'settingsToggle',
  SETTINGS_PANEL: 'settingsPanel',
  SETTINGS_VERSION: 'settingsVersion',
  THEME_SWITCH_DIALOG: 'themeSwitchDialog',
  THEME_SWITCH_MESSAGE: 'themeSwitchMessage',
  THEME_SWITCH_CANCEL_BTN: 'themeSwitchCancelBtn',
  THEME_SWITCH_CONFIRM_BTN: 'themeSwitchConfirmBtn',
  UPDATE_APPLY_DIALOG: 'updateApplyDialog',
  UPDATE_APPLY_MESSAGE: 'updateApplyMessage',
  UPDATE_APPLY_CANCEL_BTN: 'updateApplyCancelBtn',
  UPDATE_APPLY_CONFIRM_BTN: 'updateApplyConfirmBtn',
  MOVE_DAILY_DIALOG: 'moveDailyDialog',
  MOVE_DAILY_MESSAGE: 'moveDailyMessage',
  MOVE_DAILY_CANCEL_BTN: 'moveDailyCancelBtn',
  MOVE_DAILY_CONFIRM_BTN: 'moveDailyConfirmBtn',
  RESET_BTN: 'resetBtn',
  REVERSE_BTN: 'reverseBtn',
  GUIDE_PANEL: 'guidePanel',
  GUIDE_TOGGLE_BTN: 'guideToggleBtn',
  LEGEND_PANEL: 'legendPanel',
  LEGEND_TOGGLE_BTN: 'legendToggleBtn',
  MSG: 'msg',
  PREV_INFINITE_BTN: 'prevInfiniteBtn',
  NEXT_LEVEL_BTN: 'nextLevelBtn',
  GRID: 'grid',
  BOARD_WRAP: 'boardWrap',
  CANVAS: 'pathCanvas',
  SYMBOL_CANVAS: 'symbolCanvas',
  LEGEND: 'legend',
  B_TURN: 'bTurn',
  B_CW: 'bCW',
  B_CCW: 'bCCW',
  B_STRAIGHT: 'bStraight',
  B_H: 'bH',
  B_V: 'bV',
  B_X: 'bX',
  B_SCISSORS: 'bSc',
  B_ROCK: 'bRo',
  B_PAPER: 'bPa',
  B_MOVE_WALL: 'bMoveWall',
});

export function baseGoalText(level, translate = (k) => k) {
  if (!level) return translate('goal.intro');

  let desc = level.descKey ? translate(level.descKey) : '';
  if (desc === level.descKey) {
    desc = level.desc || '';
  }

  const prefix = desc ? translate('goal.thisLevelPrefix') : '';
  return `${translate('goal.intro')}${prefix}${desc}`;
}
