import { CELL_TYPES, HINT_CODES, RPS_CODES, RPS_WIN_ORDER } from './tether_config.js';
import { inBounds, keyOf, keyV } from './tether_utils.js';

const isHintCode = (ch) => HINT_CODES.has(ch);
const isRpsCode = (ch) => RPS_CODES.has(ch);

const evalHintAtIndex = (i, clue, path, isComplete) => {
  if (i === 0 || i === path.length - 1) {
    return isComplete ? { state: 'bad', clue } : { state: 'pending', clue };
  }

  const prev = path[i - 1];
  const cur = path[i];
  const next = path[i + 1];

  const vin = { dr: cur.r - prev.r, dc: cur.c - prev.c };
  const vout = { dr: next.r - cur.r, dc: next.c - cur.c };

  const straight = vin.dr === vout.dr && vin.dc === vout.dc;
  const isHoriz = vin.dr === 0 && Math.abs(vin.dc) === 1;
  const isVert = vin.dc === 0 && Math.abs(vin.dr) === 1;

  const z = vin.dc * vout.dr - vin.dr * vout.dc;
  const cw = z > 0;
  const ccw = z < 0;

  let ok = true;
  if (clue === CELL_TYPES.HINT_STRAIGHT) ok = straight;
  else if (clue === CELL_TYPES.HINT_HORIZONTAL) ok = straight && isHoriz;
  else if (clue === CELL_TYPES.HINT_VERTICAL) ok = straight && isVert;
  else if (clue === CELL_TYPES.HINT_TURN) ok = !straight;
  else if (clue === CELL_TYPES.HINT_CW) ok = !straight && cw;
  else if (clue === CELL_TYPES.HINT_CCW) ok = !straight && ccw;

  return { state: ok ? 'good' : 'bad', clue };
};

export function evaluateHints(snapshot) {
  const isComplete = snapshot.path.length === snapshot.totalUsable;
  const idxByKey = new Map();
  for (let i = 0; i < snapshot.path.length; i++) {
    idxByKey.set(keyOf(snapshot.path[i].r, snapshot.path[i].c), i);
  }

  let good = 0;
  let bad = 0;
  let total = 0;
  let pending = 0;
  const goodKeys = [];
  const badKeys = [];

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const clue = snapshot.gridData[r][c];
      if (!isHintCode(clue)) continue;
      total++;
      const k = keyOf(r, c);

      if (!idxByKey.has(k)) {
        pending++;
        continue;
      }

      const i = idxByKey.get(k);
      const res = evalHintAtIndex(i, clue, snapshot.path, isComplete);
      if (res.state === 'good') {
        good++;
        goodKeys.push(k);
      } else if (res.state === 'bad') {
        bad++;
        badKeys.push(k);
      } else {
        pending++;
      }
    }
  }

  const summary = total === 0 ? '—' : `${good}/${total}${bad ? ` (✗${bad})` : ''}`;

  return {
    good,
    bad,
    total,
    pending,
    summary,
    goodKeys,
    badKeys,
  };
}

export function evaluateStitches(snapshot) {
  const idxByKey = new Map();
  for (let i = 0; i < snapshot.path.length; i++) {
    idxByKey.set(keyOf(snapshot.path[i].r, snapshot.path[i].c), i);
  }

  let goodPairs = 0;
  let badPairs = 0;
  const totalPairs = snapshot.stitches.length * 2;

  const vertexStatus = new Map();

  for (const [vr, vc] of snapshot.stitches) {
    const vk = keyOf(vr, vc);
    const req = snapshot.stitchReq.get(vk);

    if (!req) {
      vertexStatus.set(vk, 'bad');
      badPairs += 2;
      continue;
    }

    const cells = [req.nw, req.ne, req.sw, req.se];
    const allIn = cells.every((p) => inBounds(snapshot.rows, snapshot.cols, p.r, p.c));
    const allUsable = cells.every((p) => {
      if (!inBounds(snapshot.rows, snapshot.cols, p.r, p.c)) return false;
      const code = snapshot.gridData[p.r][p.c];
      return code !== CELL_TYPES.WALL && code !== CELL_TYPES.MOVABLE_WALL;
    });

    if (!allIn || !allUsable) {
      vertexStatus.set(vk, 'bad');
      badPairs += 2;
      continue;
    }

    const k1a = keyOf(req.nw.r, req.nw.c);
    const k1b = keyOf(req.se.r, req.se.c);
    const k2a = keyOf(req.ne.r, req.ne.c);
    const k2b = keyOf(req.sw.r, req.sw.c);

    const isInternal = (k) => idxByKey.has(k) && idxByKey.get(k) > 0 && idxByKey.get(k) < snapshot.path.length - 1;

    const has1a = idxByKey.has(k1a);
    const has1b = idxByKey.has(k1b);
    let ok1 = false, bad1 = false;
    if (has1a && has1b) {
      if (Math.abs(idxByKey.get(k1a) - idxByKey.get(k1b)) === 1) ok1 = true;
      else bad1 = true;
    } else {
      if (isInternal(k1a) || isInternal(k1b)) bad1 = true;
    }

    const has2a = idxByKey.has(k2a);
    const has2b = idxByKey.has(k2b);
    let ok2 = false, bad2 = false;
    if (has2a && has2b) {
      if (Math.abs(idxByKey.get(k2a) - idxByKey.get(k2b)) === 1) ok2 = true;
      else bad2 = true;
    } else {
      if (isInternal(k2a) || isInternal(k2b)) bad2 = true;
    }

    const complete = snapshot.path.length === snapshot.totalUsable;

    if (complete) {
      if (!ok1) bad1 = true;
      if (!ok2) bad2 = true;
    }

    if (ok1) goodPairs++;
    if (ok2) goodPairs++;
    if (bad1) badPairs++;
    if (bad2) badPairs++;

    if (bad1 || bad2) {
      vertexStatus.set(vk, 'bad');
    } else if (ok1 && ok2) {
      vertexStatus.set(vk, 'good');
    } else {
      vertexStatus.set(vk, 'pending');
    }
  }

  const summary = snapshot.stitches.length === 0 ? '—' : `${goodPairs}/${totalPairs}${badPairs ? ` (✗${badPairs})` : ''}`;

  return {
    good: goodPairs,
    bad: badPairs,
    total: totalPairs,
    summary,
    vertexStatus,
  };
}

export function evaluateRPS(snapshot) {
  const seq = [];
  for (let i = 0; i < snapshot.path.length; i++) {
    const p = snapshot.path[i];
    const ch = snapshot.gridData[p.r][p.c];
    if (isRpsCode(ch)) seq.push({ i, ch, k: keyOf(p.r, p.c) });
  }

  const badKeys = new Set();
  const goodKeys = new Set();
  let badPairs = 0;
  const totalPairs = Math.max(0, seq.length - 1);

  for (let j = 1; j < seq.length; j++) {
    const prev = seq[j - 1];
    const cur = seq[j];
    const expected = RPS_WIN_ORDER[prev.ch];
    if (cur.ch !== expected) {
      badPairs++;
      badKeys.add(prev.k);
      badKeys.add(cur.k);
    } else {
      goodKeys.add(prev.k);
      goodKeys.add(cur.k);
    }
  }

  const goodPairs = totalPairs - badPairs;
  const summary = totalPairs === 0 ? '—' : `${goodPairs}/${totalPairs}${badPairs ? ` (✗${badPairs})` : ''}`;

  return {
    good: goodPairs,
    bad: badPairs,
    total: totalPairs,
    summary,
    goodKeys: [...goodKeys],
    badKeys: [...badKeys],
  };
}

export function evaluateIsolation(snapshot) {
  const badKeys = [];
  if (snapshot.path.length <= 1) return { badKeys, totalIsolated: 0 };

  const isUsable = (r, c) => {
    if (!inBounds(snapshot.rows, snapshot.cols, r, c)) return false;
    const code = snapshot.gridData[r][c];
    return code !== CELL_TYPES.WALL && code !== CELL_TYPES.MOVABLE_WALL;
  };

  const getNeighbors = (r, c) => {
    const neighbors = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
      const nr = r + dr;
      const nc = c + dc;
      if (isUsable(nr, nc)) neighbors.push({ r: nr, c: nc });
    });
    if (snapshot.stitchSet) {
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        if (isUsable(nr, nc)) {
          const vr = Math.max(r, nr);
          const vc = Math.max(c, nc);
          if (snapshot.stitchSet.has(keyV(vr, vc))) {
            neighbors.push({ r: nr, c: nc });
          }
        }
      });
    }
    return neighbors;
  };

  const pathKeys = new Set(snapshot.path.map((p) => keyOf(p.r, p.c)));
  const head = snapshot.path[0];
  const tail = snapshot.path[snapshot.path.length - 1];

  const queue = [];
  const reachable = new Set();

  const startNodes = [head, tail];
  if (head.r === tail.r && head.c === tail.c) startNodes.pop();

  startNodes.forEach((node) => {
    getNeighbors(node.r, node.c).forEach((n) => {
      const nk = keyOf(n.r, n.c);
      if (!pathKeys.has(nk) && !reachable.has(nk)) {
        reachable.add(nk);
        queue.push(n);
      }
    });
  });

  let headIdx = 0;
  while (headIdx < queue.length) {
    const curr = queue[headIdx++];
    getNeighbors(curr.r, curr.c).forEach((n) => {
      const nk = keyOf(n.r, n.c);
      if (!pathKeys.has(nk) && !reachable.has(nk)) {
        reachable.add(nk);
        queue.push(n);
      }
    });
  }

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      if (isUsable(r, c)) {
        const k = keyOf(r, c);
        if (!pathKeys.has(k) && !reachable.has(k)) {
          badKeys.push(k);
        }
      }
    }
  }

  return { badKeys, totalIsolated: badKeys.length };
}

export function checkCompletion(snapshot, forced = {}) {
  const hintStatus = forced.hintStatus || evaluateHints(snapshot);
  const stitchStatus = forced.stitchStatus || evaluateStitches(snapshot);
  const rpsStatus = forced.rpsStatus || evaluateRPS(snapshot);
  const isolationStatus = forced.isolationStatus || evaluateIsolation(snapshot);

  const allVisited = snapshot.path.length === snapshot.totalUsable;

  const hintsOk = hintStatus.total === 0 ? true : (hintStatus.bad === 0 && hintStatus.good === hintStatus.total);
  const stitchesOk = stitchStatus.total === 0 ? true : (stitchStatus.bad === 0 && stitchStatus.good === stitchStatus.total);
  const rpsOk = rpsStatus.total === 0 ? true : rpsStatus.bad === 0;
  const isolatedOk = isolationStatus.totalIsolated === 0;

  if (allVisited && hintsOk && stitchesOk && rpsOk && isolatedOk) {
    return {
      allVisited,
      hintsOk,
      stitchesOk,
      rpsOk,
      isolatedOk,
      kind: 'good',
      message: '완료 ✅ 모든 칸 방문 + 모든 제약 만족',
      hintStatus,
      stitchStatus,
      rpsStatus,
      isolationStatus,
    };
  }

  const parts = [];
  parts.push(allVisited ? '모든 칸 방문: OK' : `${snapshot.totalUsable - snapshot.path.length}칸 남음`);
  parts.push(hintsOk ? '힌트: OK' : `힌트: 충돌 ${hintStatus.bad}개`);
  parts.push(stitchesOk ? '스티치: OK' : `스티치: 충돌 ${stitchStatus.bad}개`);
  parts.push(rpsOk ? 'RPS: OK' : `RPS: 충돌 ${rpsStatus.bad}개`);
  if (!isolatedOk) parts.push(`고립: ${isolationStatus.totalIsolated}칸`);

  const kind = (!hintsOk || !stitchesOk || !rpsOk || !isolatedOk) ? 'bad' : null;

  return {
    allVisited,
    hintsOk,
    stitchesOk,
    rpsOk,
    isolatedOk,
    kind,
    message: parts.join(' · '),
    hintStatus,
    stitchStatus,
    rpsStatus,
    isolationStatus,
  };
}
