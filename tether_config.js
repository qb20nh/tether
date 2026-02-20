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
  RESET_BTN: 'resetBtn',
  UNDO_BTN: 'undoBtn',
  REVERSE_BTN: 'reverseBtn',
  TOGGLE_IDX_BTN: 'toggleIdxBtn',
  VISITED_TEXT: 'visitedText',
  HINT_TEXT: 'hintText',
  STITCH_TEXT: 'stitchText',
  RPS_TEXT: 'rpsText',
  MSG: 'msg',
  GRID: 'grid',
  BOARD_WRAP: 'boardWrap',
  CANVAS: 'pathCanvas',
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

const GOAL_INTRO =
  '<b>목표</b>: 벽(#)이 아닌 모든 칸을 <b>정확히 1번씩</b> 방문하는 연속 경로를 만드세요. 시작/끝은 표시되지 않습니다.';
const DEPENDENCY =
  '<span class="small">CW/CCW 및 RPS는 “그리는 방향(시작→끝)”에 의존합니다. 반대로 시작하면 제약이 뒤집히니, Reverse 버튼으로 시작점을 쉽게 바꿔보세요.</span>';

export function baseGoalText(level) {
  const desc = level && level.desc ? `<br><b>이 레벨</b>: ${level.desc}` : '';
  return `${GOAL_INTRO}${desc}<br>${DEPENDENCY}`;
}
