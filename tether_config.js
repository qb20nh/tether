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
  LEVEL_LABEL: 'levelLabel',
  LANG_LABEL: 'langLabel',
  LANG_SEL: 'langSel',
  RESET_BTN: 'resetBtn',
  REVERSE_BTN: 'reverseBtn',
  GUIDE_PANEL: 'guidePanel',
  GUIDE_TOGGLE_BTN: 'guideToggleBtn',
  LEGEND_PANEL: 'legendPanel',
  LEGEND_TOGGLE_BTN: 'legendToggleBtn',
  MSG: 'msg',
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

export function baseGoalText(level, t = (key) => key) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const descText = level?.descKey ? translate(level.descKey) : '';
  const desc = descText !== level?.descKey
    ? `${translate('goal.thisLevelPrefix')}${descText}`
    : level?.desc
      ? `${translate('goal.thisLevelPrefix')}${level.desc}`
      : '';

  return `${translate('goal.intro')}${desc}`;
}
