import { CELL_TYPES, HINT_CODES, RPS_CODES, RPS_WIN_ORDER } from './tether_config.js';
import { inBounds, keyOf } from './tether_utils.js';

const isHintCode = (ch) => HINT_CODES.has(ch);
const isRpsCode = (ch) => RPS_CODES.has(ch);
const isWall = (ch) => ch === CELL_TYPES.WALL || ch === CELL_TYPES.MOVABLE_WALL;
const edgeKey = (a, b) => {
  const ka = a.r * 1000 + a.c;
  const kb = b.r * 1000 + b.c;
  return ka < kb ? ka * 1000000 + kb : kb * 1000000 + ka;
};

const makeEndpointSet = (path) => {
  if (path.length === 0) return new Set();
  return new Set([
    keyOf(path[0].r, path[0].c),
    keyOf(path[path.length - 1].r, path[path.length - 1].c),
  ]);
};

const hasCrossStitch = (snapshot, r1, c1, r2, c2) => {
  if (!inBounds(snapshot.rows, snapshot.cols, r2, c2)) return false;
  const vr = Math.max(r1, r2);
  const vc = Math.max(c1, c2);
  return snapshot.stitchSet && snapshot.stitchSet.has(keyOf(vr, vc));
};

const evalHintAtIndex = (i, clue, path, isComplete, suppressEndpointRequirement) => {
  const isEndpoint = i === 0 || i === path.length - 1;
  if (isEndpoint) {
    if (suppressEndpointRequirement) {
      if (path.length < 2) return { state: 'pending', clue };

      const neighbor = i === 0 ? path[1] : path[path.length - 2];
      if (!neighbor) return { state: 'pending', clue };

      const direction = { dr: neighbor.r - path[i].r, dc: neighbor.c - path[i].c };
      const isHoriz = direction.dr === 0;
      const isVert = direction.dc === 0;

      if (clue === CELL_TYPES.HINT_HORIZONTAL) {
        return { state: isHoriz ? 'pending' : 'bad', clue };
      }
      if (clue === CELL_TYPES.HINT_VERTICAL) {
        return { state: isVert ? 'pending' : 'bad', clue };
      }

      return { state: 'pending', clue };
    }
    return { state: 'bad', clue };
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

const buildOrthEdgeSet = (path) => {
  const edges = new Set();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    if (dr + dc !== 1) continue;
    edges.add(edgeKey(a, b));
  }
  return edges;
};

const countCornerOrthConnections = (vr, vc, orthEdges) => {
  const nw = { r: vr - 1, c: vc - 1 };
  const ne = { r: vr - 1, c: vc };
  const sw = { r: vr, c: vc - 1 };
  const se = { r: vr, c: vc };

  let count = 0;
  if (orthEdges.has(edgeKey(nw, ne))) count++;
  if (orthEdges.has(edgeKey(nw, sw))) count++;
  if (orthEdges.has(edgeKey(ne, se))) count++;
  if (orthEdges.has(edgeKey(sw, se))) count++;
  return count;
};

export function evaluateHints(snapshot, options = {}) {
  const suppressEndpointRequirement = Boolean(options.suppressEndpointRequirement);
  const isComplete = snapshot.path.length === snapshot.totalUsable;
  const idxByKey = snapshot.idxByKey;

  let good = 0;
  let bad = 0;
  let total = 0;
  let pending = 0;
  const goodKeys = [];
  const badKeys = [];
  const cornerVertexStatus = new Map();

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
      const res = evalHintAtIndex(i, clue, snapshot.path, isComplete, suppressEndpointRequirement);
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

  const orthEdges = buildOrthEdgeSet(snapshot.path);
  for (const [vr, vc, target] of snapshot.cornerCounts || []) {
    total++;
    const vk = keyOf(vr, vc);
    const actual = countCornerOrthConnections(vr, vc, orthEdges);

    let state = 'pending';
    if (isComplete) {
      state = actual === target ? 'good' : 'bad';
    } else if (actual > target) {
      state = 'bad';
    } else if (actual === target) {
      state = 'good';
    }

    cornerVertexStatus.set(vk, state);

    if (state === 'good') good++;
    else if (state === 'bad') bad++;
    else pending++;
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
    cornerVertexStatus,
  };
}

export function evaluateBlockedCells(snapshot) {
  const blockedKeys = [];
  const path = snapshot.path;
  const visited = snapshot.visited;
  if (path.length === 0) {
    return {
      bad: 0,
      badKeys: [],
      summary: '—',
    };
  }

  const endpointKeys = makeEndpointSet(path);
  const canTraverse = (r, c) => {
    if (!inBounds(snapshot.rows, snapshot.cols, r, c)) return false;
    const code = snapshot.gridData[r][c];
    if (isWall(code)) return false;
    const k = keyOf(r, c);
    if (visited.has(k) && !endpointKeys.has(k)) return false;
    return true;
  };

  const reachable = new Set();
  const queue = [];
  let qHead = 0;
  const enqueue = (r, c) => {
    const k = keyOf(r, c);
    if (reachable.has(k)) return;
    reachable.add(k);
    queue.push({ r, c });
  };

  const startPoints = [path[0]];
  if (path.length > 1) startPoints.push(path[path.length - 1]);
  for (const p of startPoints) {
    if (canTraverse(p.r, p.c)) enqueue(p.r, p.c);
  }

  const orthMoves = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const diagonalMoves = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  while (qHead < queue.length) {
    const cur = queue[qHead++];

    for (const [dr, dc] of orthMoves) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!canTraverse(nr, nc)) continue;
      enqueue(nr, nc);
    }

    for (const [dr, dc] of diagonalMoves) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!hasCrossStitch(snapshot, cur.r, cur.c, nr, nc)) continue;
      if (!canTraverse(nr, nc)) continue;
      enqueue(nr, nc);
    }
  }

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const k = keyOf(r, c);
      const code = snapshot.gridData[r][c];
      if (isWall(code) || visited.has(k)) continue;
      if (!reachable.has(k)) blockedKeys.push(k);
    }
  }

  return {
    bad: blockedKeys.length,
    badKeys: blockedKeys,
    summary: blockedKeys.length === 0 ? '—' : `${blockedKeys.length} blocked`,
  };
}

export function evaluateStitches(snapshot) {
  const idxByKey = snapshot.idxByKey;

  let goodPairs = 0;
  let badPairs = 0;
  const totalPairs = snapshot.stitches.length * 2;

  const vertexStatus = new Map();

  for (const [vr, vc] of snapshot.stitches) {
    const vk = keyOf(vr, vc);
    const req = snapshot.stitchReq.get(vk);

    if (!req) {
      vertexStatus.set(vk, { diagA: 'bad', diagB: 'bad' });
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
      vertexStatus.set(vk, { diagA: 'bad', diagB: 'bad' });
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

    const diagAStatus = has1a && has1b ? (ok1 ? 'good' : 'bad') : (bad1 ? 'bad' : 'pending');
    const diagBStatus = has2a && has2b ? (ok2 ? 'good' : 'bad') : (bad2 ? 'bad' : 'pending');
    vertexStatus.set(vk, { diagA: diagAStatus, diagB: diagBStatus });
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

export function checkCompletion(snapshot, forced = {}, translate = (k) => k) {
  const t = typeof translate === 'function' ? translate : (k) => k;
  const hintStatus = forced.hintStatus || evaluateHints(snapshot);
  const stitchStatus = forced.stitchStatus || evaluateStitches(snapshot);
  const rpsStatus = forced.rpsStatus || evaluateRPS(snapshot);

  const allVisited = snapshot.path.length === snapshot.totalUsable;

  const hintsOk = hintStatus.total === 0 ? true : (hintStatus.bad === 0 && hintStatus.good === hintStatus.total);
  const stitchesOk = stitchStatus.total === 0 ? true : (stitchStatus.bad === 0 && stitchStatus.good === stitchStatus.total);
  const rpsOk = rpsStatus.total === 0 ? true : rpsStatus.bad === 0;

  if (allVisited && hintsOk && stitchesOk && rpsOk) {
    return {
      allVisited,
      hintsOk,
      stitchesOk,
      rpsOk,
      kind: 'good',
      message: t('completion.completed'),
      hintStatus,
      stitchStatus,
      rpsStatus,
    };
  }

  const kind = (!hintsOk || !stitchesOk || !rpsOk) ? 'bad' : null;

  return {
    allVisited,
    hintsOk,
    stitchesOk,
    rpsOk,
    kind,
    message: '',
    hintStatus,
    stitchStatus,
    rpsStatus,
  };
}
