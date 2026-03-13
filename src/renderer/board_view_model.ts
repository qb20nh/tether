import type {
  EvaluateResult,
  GameSnapshot,
  GridPoint,
} from '../contracts/ports.ts';

export interface BoardCellViewState {
  classes: string[];
  idx: string;
  markHtml: string;
}

type BoardCellMatrix = BoardCellViewState[][];
type KeyStatus = { badKeys?: readonly string[]; goodKeys?: readonly string[] } | null | undefined;
type BlockedStatus = { badKeys?: readonly string[] } | null | undefined;

const createCellState = (): BoardCellViewState => ({
  classes: ['cell'],
  idx: '',
  markHtml: '',
});

const ensureOutputMatrix = (
  rows: number,
  cols: number,
  out: BoardCellMatrix | null,
): BoardCellMatrix => {
  const matrix = Array.isArray(out) ? out : [];
  if (matrix.length !== rows) matrix.length = rows;

  for (let r = 0; r < rows; r++) {
    let row = matrix[r];
    if (!Array.isArray(row)) {
      row = [];
      matrix[r] = row;
    }
    if (row.length !== cols) row.length = cols;
    for (let c = 0; c < cols; c++) {
      if (!row[c]) row[c] = createCellState();
    }
  }
  return matrix;
};

const keyScratch: GridPoint = { r: 0, c: 0 };

const parseGridKey = (key: unknown, out: GridPoint = keyScratch): GridPoint | null => {
  if (typeof key !== 'string') return null;
  const commaIndex = key.indexOf(',');
  if (commaIndex <= 0 || commaIndex >= key.length - 1) return null;
  const r = Number(key.slice(0, commaIndex));
  const c = Number(key.slice(commaIndex + 1));
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  out.r = r;
  out.c = c;
  return out;
};

const applyClassToKeys = (
  keys: readonly string[] | undefined,
  desired: BoardCellMatrix,
  className: string,
  shouldApply: ((cell: BoardCellViewState) => boolean) | null = null,
): void => {
  keys?.forEach((key) => {
    const parsed = parseGridKey(key);
    const cell = parsed ? desired[parsed.r]?.[parsed.c] : null;
    if (cell && (!shouldApply || shouldApply(cell))) cell.classes.push(className);
  });
};

/**
 * Build cell classes/index/mark HTML from state + evaluation.
 */
export function buildBoardCellViewModel(
  snapshot: GameSnapshot,
  results: EvaluateResult | null | undefined,
  resolveMarkHtml: ((code: string) => string) | null | undefined,
  out: BoardCellMatrix | null = null,
): BoardCellMatrix {
  const hintStatus = (results?.hintStatus || null) as KeyStatus;
  const rpsStatus = (results?.rpsStatus || null) as KeyStatus;
  const blockedStatus = (results?.blockedStatus || null) as BlockedStatus;
  const desired = ensureOutputMatrix(snapshot.rows, snapshot.cols, out);

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const state = desired[r][c];
      state.classes.length = 1;
      state.classes[0] = 'cell';
      state.idx = '';

      const code = snapshot.gridData[r][c];
      if (code === 'm') state.classes.push('wall', 'movable');
      else if (code === '#') state.classes.push('wall');
      state.markHtml = typeof resolveMarkHtml === 'function'
        ? resolveMarkHtml(code)
        : '';
    }
  }

  for (let i = 0; i < snapshot.path.length; i++) {
    const p = snapshot.path[i];
    desired[p.r][p.c].classes.push('visited');
    desired[p.r][p.c].idx = String(i + 1);
  }

  if (snapshot.path.length > 0) {
    const head = snapshot.path[0];
    desired[head.r][head.c].classes.push('pathStart');

    if (snapshot.path.length > 1) {
      const tail = snapshot.path[snapshot.path.length - 1];
      desired[tail.r][tail.c].classes.push('pathEnd');
    }
  }

  applyClassToKeys(hintStatus?.badKeys, desired, 'badHint');
  applyClassToKeys(hintStatus?.goodKeys, desired, 'goodHint');
  applyClassToKeys(rpsStatus?.badKeys, desired, 'badRps');
  applyClassToKeys(
    rpsStatus?.goodKeys,
    desired,
    'goodRps',
    (cell) => !cell.classes.includes('badRps'),
  );
  applyClassToKeys(blockedStatus?.badKeys, desired, 'badBlocked');

  return desired;
}
