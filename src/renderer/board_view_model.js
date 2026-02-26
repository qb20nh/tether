/**
 * Build cell classes/index/mark HTML from state + evaluation.
 */
export function buildBoardCellViewModel(snapshot, results, resolveMarkHtml) {
  const { hintStatus, rpsStatus, blockedStatus } = results || {};

  const desired = Array.from({ length: snapshot.rows }, () =>
    Array.from({ length: snapshot.cols }, () => ({
      classes: ['cell'],
      idx: '',
      markHtml: '',
    }))
  );

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const code = snapshot.gridData[r][c];
      if (code === 'm') desired[r][c].classes.push('wall', 'movable');
      else if (code === '#') desired[r][c].classes.push('wall');
      desired[r][c].markHtml = typeof resolveMarkHtml === 'function'
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
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('badHint');
    });

    hintStatus.goodKeys?.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('goodHint');
    });
  }

  if (rpsStatus) {
    rpsStatus.badKeys?.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('badRps');
    });

    rpsStatus.goodKeys?.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c] && !desired[r][c].classes.includes('badRps')) {
        desired[r][c].classes.push('goodRps');
      }
    });
  }

  if (blockedStatus) {
    blockedStatus.badKeys?.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (desired[r]?.[c]) desired[r][c].classes.push('badBlocked');
    });
  }

  return desired;
}
