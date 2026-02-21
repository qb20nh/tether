function makeIcon(body, options = '') {
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><g ${options}><g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></g></svg>`;
}

export const ICONS = {
  t: makeIcon(`
    <path d="M10 14 H24 V34 H38"/>
    <path d="M16 8 L10 14 L16 20"/>
    <path d="M32 28 L38 34 L32 40"/>
  `),
  r: makeIcon(`
    <path d="M 42 24 A 18 18 0 1 1 24 6 C 29.04 6 33.86 8 37.48 11.48 L 42 16"/>
    <path d="M 42 6 V 16 H 32"/>
  `),
  l: makeIcon(`
    <path d="M 6 24 A 18 18 0 1 0 24 6 C 18.96 6 14.14 8 10.52 11.48 L 6 16"/>
    <path d="M 6 6 V 16 H 16"/>
  `),
  s: makeIcon(`
    <path d="M6 24 H42 M24 6 V42"/>
    <path d="M18 12 L24 6 L30 12"/>
    <path d="M18 36 L24 42 L30 36"/>
    <path d="M12 18 L6 24 L12 30"/>
    <path d="M36 18 L42 24 L36 30"/>
  `),
  h: makeIcon(`
    <path d="M6 24 H42"/>
    <path d="M34 16 L42 24 L34 32"/>
    <path d="M14 16 L6 24 L14 32"/>
  `),
  v: makeIcon(`
    <path d="M24 6 V42"/>
    <path d="M16 14 L24 6 L32 14"/>
    <path d="M16 34 L24 42 L32 34"/>
  `),
  g: makeIcon(`
    <circle cx="16" cy="32" r="4"/>
    <circle cx="32" cy="32" r="4"/>
    <path d="M18 28 L32 12"/>
    <path d="M30 28 L16 12"/>
  `),
  b: makeIcon(`
    <path d="M24 12 L36 18 V30 L24 36 L12 30 V18 Z"/>
    <path d="M24 12 V24 L36 30"/>
    <path d="M24 24 L12 30"/>
  `),
  p: makeIcon(`
    <path d="M14 10 H28 L36 18 V38 H14 Z"/>
    <path d="M28 10 V18 H36"/>
    <path d="M20 26 H30"/>
    <path d="M20 32 H26"/>
  `),
  m: makeIcon(`
    <path d="M24 6 L18 14 H30 Z"/>
    <path d="M24 42 L18 34 H30 Z"/>
    <path d="M6 24 L14 18 V30 Z"/>
    <path d="M42 24 L34 18 V30 Z"/>
  `),
};

export const ICON_X = makeIcon(
  `
    <circle cx="14" cy="14" r="2" fill="currentColor" stroke="none"/>
    <circle cx="34" cy="14" r="2" fill="currentColor" stroke="none"/>
    <circle cx="14" cy="34" r="2" fill="currentColor" stroke="none"/>
    <circle cx="34" cy="34" r="2" fill="currentColor" stroke="none"/>
    <path d="M14 14 L34 34"/>
    <path d="M34 14 L14 34"/>
  `,
);

export const BADGE_DEFINITIONS = [
  {
    badgeId: 'bTurn',
    iconCode: 't',
    html: '<strong>Turn (t)</strong>: 이전·다음 이동 방향이 달라야 함',
  },
  {
    badgeId: 'bCW',
    iconCode: 'r',
    html: '<strong>CW (r)</strong>: 이전→다음이 시계 방향 회전',
  },
  {
    badgeId: 'bCCW',
    iconCode: 'l',
    html: '<strong>CCW (l)</strong>: 이전→다음이 반시계 방향 회전',
  },
  {
    badgeId: 'bStraight',
    iconCode: 's',
    html: '<strong>Straight (s)</strong>: 직진만 허용',
  },
  {
    badgeId: 'bH',
    iconCode: 'h',
    html: '<strong>Horizontal (h)</strong>: 가로로 직진',
  },
  {
    badgeId: 'bV',
    iconCode: 'v',
    html: '<strong>Vertical (v)</strong>: 세로로 직진',
  },
  {
    badgeId: 'bSc',
    iconCode: 'g',
    html: '<strong>Scissors (g)</strong>: 가위',
  },
  {
    badgeId: 'bRo',
    iconCode: 'b',
    html: '<strong>Rock (b)</strong>: 바위',
  },
  {
    badgeId: 'bPa',
    iconCode: 'p',
    html: '<strong>Paper (p)</strong>: 보',
  },
  {
    badgeId: 'bX',
    iconCode: 'x',
    html: '<strong>Cross stitch (x)</strong>: 십자수',
  },
  {
    badgeId: 'bCornerCount',
    iconCode: 'cornerCount',
    badgeText: '0-3',
    html: '<strong>Corner count</strong>: 꼭짓점 주변 4칸 사이 연결 수(0~3)를 강제',
  },
  {
    badgeId: 'bMoveWall',
    iconCode: 'm',
    html: '<strong>Movable wall (m)</strong>: 드래그로 이동',
  },
];
