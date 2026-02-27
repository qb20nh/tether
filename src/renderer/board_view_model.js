const createCellState = () => ({
  classes: ['cell'],
  idx: '',
  markHtml: '',
});

const ensureOutputMatrix = (rows, cols, out) => {
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

const keyScratch = { r: 0, c: 0 };

const parseGridKey = (key, out = keyScratch) => {
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

/**
 * Build cell classes/index/mark HTML from state + evaluation.
 */
export function buildBoardCellViewModel(snapshot, results, resolveMarkHtml, out = null) {
  const { hintStatus, rpsStatus, blockedStatus } = results || {};
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

  if (hintStatus) {
    hintStatus.badKeys?.forEach((k) => {
      const parsed = parseGridKey(k);
      if (parsed && desired[parsed.r]?.[parsed.c]) desired[parsed.r][parsed.c].classes.push('badHint');
    });

    hintStatus.goodKeys?.forEach((k) => {
      const parsed = parseGridKey(k);
      if (parsed && desired[parsed.r]?.[parsed.c]) desired[parsed.r][parsed.c].classes.push('goodHint');
    });
  }

  if (rpsStatus) {
    rpsStatus.badKeys?.forEach((k) => {
      const parsed = parseGridKey(k);
      if (parsed && desired[parsed.r]?.[parsed.c]) desired[parsed.r][parsed.c].classes.push('badRps');
    });

    rpsStatus.goodKeys?.forEach((k) => {
      const parsed = parseGridKey(k);
      if (parsed && desired[parsed.r]?.[parsed.c] && !desired[parsed.r][parsed.c].classes.includes('badRps')) {
        desired[parsed.r][parsed.c].classes.push('goodRps');
      }
    });
  }

  if (blockedStatus) {
    blockedStatus.badKeys?.forEach((k) => {
      const parsed = parseGridKey(k);
      if (parsed && desired[parsed.r]?.[parsed.c]) desired[parsed.r][parsed.c].classes.push('badBlocked');
    });
  }

  return desired;
}
