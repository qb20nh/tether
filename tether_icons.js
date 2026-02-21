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
    htmlKey: 'legend.turn',
  },
  {
    badgeId: 'bCW',
    iconCode: 'r',
    htmlKey: 'legend.cw',
  },
  {
    badgeId: 'bCCW',
    iconCode: 'l',
    htmlKey: 'legend.ccw',
  },
  {
    badgeId: 'bStraight',
    iconCode: 's',
    htmlKey: 'legend.straight',
  },
  {
    badgeId: 'bH',
    iconCode: 'h',
    htmlKey: 'legend.horizontal',
  },
  {
    badgeId: 'bV',
    iconCode: 'v',
    htmlKey: 'legend.vertical',
  },
  {
    badgeId: 'bSc',
    iconCode: 'g',
    htmlKey: 'legend.scissors',
  },
  {
    badgeId: 'bRo',
    iconCode: 'b',
    htmlKey: 'legend.rock',
  },
  {
    badgeId: 'bPa',
    iconCode: 'p',
    htmlKey: 'legend.paper',
  },
  {
    badgeId: 'bX',
    iconCode: 'x',
    htmlKey: 'legend.crossStitch',
  },
  {
    badgeId: 'bCornerCount',
    iconCode: 'cornerCount',
    badgeText: '0-3',
    htmlKey: 'legend.cornerCount',
  },
  {
    badgeId: 'bMoveWall',
    iconCode: 'm',
    htmlKey: 'legend.movableWall',
  },
];
