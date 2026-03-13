import { CELL_TYPES, HINT_CODES, RPS_CODES, RPS_WIN_ORDER } from './config.ts';
import type {
  CompletionResult,
  EvaluateResult,
  GameSnapshot,
  GridPoint,
  RuleStatus,
  StitchRequirement,
  Translator,
} from './contracts/ports.ts';
import { buildOrthEdgeSet, countCornerOrthConnections } from './shared/stitch_corner_geometry.ts';
import { inBounds, keyOf } from './utils.ts';

type RuleState = 'good' | 'bad' | 'pending';
type RpsCode = keyof typeof RPS_WIN_ORDER;

interface HintRuleStatus extends RuleStatus {
  good: number;
  bad: number;
  total: number;
  pending: number;
  goodKeys: string[];
  badKeys: string[];
  cornerVertexStatus: Map<string, RuleState>;
}

interface CornerHintStatus extends RuleStatus {
  good: number;
  bad: number;
  total: number;
  pending: number;
  cornerVertexStatus: Map<string, RuleState>;
}

interface BlockedCellStatus extends RuleStatus {
  bad: number;
  badKeys: string[];
  summary: string;
}

interface StitchVertexRuleStatus {
  diagA: RuleState;
  diagB: RuleState;
}

interface StitchRuleStatus extends RuleStatus {
  good: number;
  bad: number;
  total: number;
  summary: string;
  vertexStatus: Map<string, StitchVertexRuleStatus>;
}

interface RpsRuleStatus extends RuleStatus {
  good: number;
  bad: number;
  total: number;
  summary: string;
  goodKeys: string[];
  badKeys: string[];
}

interface EvaluateHintOptions {
  suppressEndpointRequirement?: boolean;
  suppressEndpointKey?: string;
}

const isHintCode = (ch: string): boolean => HINT_CODES.has(ch);
const isRpsCode = (ch: string): ch is RpsCode => RPS_CODES.has(ch);
const isWall = (ch: string): boolean => ch === CELL_TYPES.WALL || ch === CELL_TYPES.MOVABLE_WALL;
const ORTHOGONAL_MOVES: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAGONAL_MOVES: readonly [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const edgeKey = (a: GridPoint, b: GridPoint): string => {
  const ka = keyOf(a.r, a.c);
  const kb = keyOf(b.r, b.c);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const makeEndpointSet = (path: readonly GridPoint[]): Set<string> => {
  if (path.length === 0) return new Set<string>();
  return new Set<string>([
    keyOf(path[0].r, path[0].c),
    keyOf(path[path.length - 1].r, path[path.length - 1].c),
  ]);
};

const hasCrossStitch = (snapshot: GameSnapshot, r1: number, c1: number, r2: number, c2: number): boolean => {
  if (!inBounds(snapshot.rows, snapshot.cols, r2, c2)) return false;
  const vr = Math.max(r1, r2);
  const vc = Math.max(c1, c2);
  return snapshot.stitchSet?.has(keyOf(vr, vc)) ?? false;
};

const formatProgressSummary = (good: number, total: number, bad: number): string => {
  if (total === 0) return '—';
  let summary = `${good}/${total}`;
  if (bad > 0) summary += ` (✗${bad})`;
  return summary;
};

const addStateCount = (
  result: { good: number; bad: number; pending: number; goodKeys?: string[]; badKeys?: string[] },
  state: RuleState,
  key = '',
): void => {
  if (state === 'good') {
    result.good++;
    if (key && result.goodKeys) result.goodKeys.push(key);
    return;
  }

  if (state === 'bad') {
    result.bad++;
    if (key && result.badKeys) result.badKeys.push(key);
    return;
  }

  result.pending++;
};

const getHintNeighbor = (path: readonly GridPoint[], i: number): GridPoint | undefined =>
  (i === 0 ? path[1] : path[path.length - 2]);

const evaluateSuppressedEndpointHint = (
  clue: string,
  path: readonly GridPoint[],
  i: number,
  suppressEndpointKey: string,
): RuleState => {
  const endpoint = path[i];
  const endpointKey = keyOf(endpoint.r, endpoint.c);
  if (suppressEndpointKey && endpointKey !== suppressEndpointKey) return 'bad';
  if (path.length < 2) return 'pending';

  const neighbor = getHintNeighbor(path, i);
  if (!neighbor) return 'pending';

  const isHoriz = neighbor.r === endpoint.r;
  const isVert = neighbor.c === endpoint.c;

  if (clue === CELL_TYPES.HINT_HORIZONTAL) return isHoriz ? 'pending' : 'bad';
  if (clue === CELL_TYPES.HINT_VERTICAL) return isVert ? 'pending' : 'bad';
  return 'pending';
};

const evaluateEndpointHint = (
  clue: string,
  path: readonly GridPoint[],
  i: number,
  suppressEndpointRequirement: boolean,
  suppressEndpointKey: string,
): RuleState => {
  if (!suppressEndpointRequirement) return 'bad';
  return evaluateSuppressedEndpointHint(clue, path, i, suppressEndpointKey);
};

const doesInteriorHintMatch = (
  clue: string,
  straight: boolean,
  isHoriz: boolean,
  isVert: boolean,
  cw: boolean,
  ccw: boolean,
): boolean => {
  switch (clue) {
    case CELL_TYPES.HINT_STRAIGHT:
      return straight;
    case CELL_TYPES.HINT_HORIZONTAL:
      return straight && isHoriz;
    case CELL_TYPES.HINT_VERTICAL:
      return straight && isVert;
    case CELL_TYPES.HINT_TURN:
      return !straight;
    case CELL_TYPES.HINT_CW:
      return !straight && cw;
    case CELL_TYPES.HINT_CCW:
      return !straight && ccw;
    default:
      return true;
  }
};

const evaluateInteriorHint = (clue: string, path: readonly GridPoint[], i: number): RuleState => {
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

  return doesInteriorHintMatch(clue, straight, isHoriz, isVert, cw, ccw)
    ? 'good'
    : 'bad';
};

const evalHintAtIndex = (
  i: number,
  clue: string,
  path: readonly GridPoint[],
  suppressEndpointRequirement: boolean,
  suppressEndpointKey: string,
): RuleState => {
  const isEndpoint = i === 0 || i === path.length - 1;
  return isEndpoint
    ? evaluateEndpointHint(clue, path, i, suppressEndpointRequirement, suppressEndpointKey)
    : evaluateInteriorHint(clue, path, i);
};

const cornerWallStats = (snapshot: GameSnapshot, vr: number, vc: number) => {
  const nwWall = isWall(snapshot.gridData[vr - 1][vc - 1]);
  const neWall = isWall(snapshot.gridData[vr - 1][vc]);
  const swWall = isWall(snapshot.gridData[vr][vc - 1]);
  const seWall = isWall(snapshot.gridData[vr][vc]);

  let maxPossible = 0;
  if (!nwWall && !neWall) maxPossible += 1;
  if (!nwWall && !swWall) maxPossible += 1;
  if (!neWall && !seWall) maxPossible += 1;
  if (!swWall && !seWall) maxPossible += 1;

  return {
    nwWall,
    neWall,
    swWall,
    seWall,
    maxPossible,
  };
};

const isCornerAdjacentClosed = (
  snapshot: GameSnapshot,
  vr: number,
  vc: number,
  wallStats: ReturnType<typeof cornerWallStats>,
): boolean => (
  (snapshot.visited.has(keyOf(vr - 1, vc - 1)) || wallStats.nwWall)
  && (snapshot.visited.has(keyOf(vr - 1, vc)) || wallStats.neWall)
  && (snapshot.visited.has(keyOf(vr, vc - 1)) || wallStats.swWall)
  && (snapshot.visited.has(keyOf(vr, vc)) || wallStats.seWall)
);

const evaluateCornerCount = (
  snapshot: GameSnapshot,
  orthEdges: ReadonlySet<string>,
  isComplete: boolean,
  vr: number,
  vc: number,
  target: number,
): RuleState => {
  const actual = countCornerOrthConnections(vr, vc, orthEdges, edgeKey);
  const wallStats = cornerWallStats(snapshot, vr, vc);
  const allAdjacentClosed = isCornerAdjacentClosed(snapshot, vr, vc, wallStats);

  if (isComplete) return actual === target ? 'good' : 'bad';
  if (actual > target) return 'bad';
  if (target > wallStats.maxPossible) return 'bad';
  if (allAdjacentClosed && actual !== target) return 'bad';
  if (actual === target) return 'good';
  return 'pending';
};

const evaluateGridHints = (
  snapshot: GameSnapshot,
  suppressEndpointRequirement: boolean,
  suppressEndpointKey: string,
): HintRuleStatus => {
  const result: HintRuleStatus = {
    good: 0,
    bad: 0,
    total: 0,
    pending: 0,
    goodKeys: [],
    badKeys: [],
    cornerVertexStatus: new Map<string, RuleState>(),
  };

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const clue = snapshot.gridData[r][c];
      if (!isHintCode(clue)) continue;

      result.total++;
      const k = keyOf(r, c);
      if (!snapshot.idxByKey.has(k)) {
        result.pending++;
        continue;
      }

      const i = snapshot.idxByKey.get(k);
      if (i === undefined) continue;
      const state = evalHintAtIndex(
        i,
        clue,
        snapshot.path,
        suppressEndpointRequirement,
        suppressEndpointKey,
      );
      addStateCount(result, state, k);
    }
  }

  return result;
};

const evaluateCornerHints = (snapshot: GameSnapshot, isComplete: boolean): CornerHintStatus => {
  const result: CornerHintStatus = {
    good: 0,
    bad: 0,
    total: 0,
    pending: 0,
    cornerVertexStatus: new Map<string, RuleState>(),
  };
  const orthEdges = buildOrthEdgeSet(snapshot.path, edgeKey);

  for (const [vr, vc, target] of snapshot.cornerCounts) {
    result.total++;
    const vk = keyOf(vr, vc);
    const state = evaluateCornerCount(snapshot, orthEdges, isComplete, vr, vc, target);
    result.cornerVertexStatus.set(vk, state);
    addStateCount(result, state);
  }

  return result;
};

export function evaluateHints(snapshot: GameSnapshot, options: EvaluateHintOptions = {}): HintRuleStatus {
  const suppressEndpointRequirement = Boolean(options.suppressEndpointRequirement);
  const suppressEndpointKey = typeof options.suppressEndpointKey === 'string'
    ? options.suppressEndpointKey
    : '';
  const isComplete = snapshot.path.length === snapshot.totalUsable;
  const gridHints = evaluateGridHints(snapshot, suppressEndpointRequirement, suppressEndpointKey);
  const cornerHints = evaluateCornerHints(snapshot, isComplete);
  const good = gridHints.good + cornerHints.good;
  const bad = gridHints.bad + cornerHints.bad;
  const total = gridHints.total + cornerHints.total;
  const pending = gridHints.pending + cornerHints.pending;
  const summary = formatProgressSummary(good, total, bad);

  return {
    good,
    bad,
    total,
    pending,
    summary,
    goodKeys: gridHints.goodKeys,
    badKeys: gridHints.badKeys,
    cornerVertexStatus: cornerHints.cornerVertexStatus,
  };
}

const createTraversalGuard = (
  snapshot: GameSnapshot,
  visited: ReadonlySet<string>,
  endpointKeys: ReadonlySet<string>,
) => (r: number, c: number): boolean => {
  if (!inBounds(snapshot.rows, snapshot.cols, r, c)) return false;
  if (isWall(snapshot.gridData[r][c])) return false;

  const k = keyOf(r, c);
  return !visited.has(k) || endpointKeys.has(k);
};

const enqueueReachable = (reachable: Set<string>, queue: GridPoint[], r: number, c: number): void => {
  const k = keyOf(r, c);
  if (reachable.has(k)) return;
  reachable.add(k);
  queue.push({ r, c });
};

const seedReachable = (
  path: readonly GridPoint[],
  canTraverse: (r: number, c: number) => boolean,
  reachable: Set<string>,
  queue: GridPoint[],
): void => {
  const startPoints = [path[0]];
  if (path.length > 1) startPoints.push(path[path.length - 1]);

  for (const point of startPoints) {
    if (canTraverse(point.r, point.c)) {
      enqueueReachable(reachable, queue, point.r, point.c);
    }
  }
};

const traverseNeighbors = (
  snapshot: GameSnapshot,
  cur: GridPoint,
  moves: readonly [number, number][],
  canTraverse: (r: number, c: number) => boolean,
  reachable: Set<string>,
  queue: GridPoint[],
  requireCrossStitch = false,
): void => {
  for (const [dr, dc] of moves) {
    const nr = cur.r + dr;
    const nc = cur.c + dc;
    if (requireCrossStitch && !hasCrossStitch(snapshot, cur.r, cur.c, nr, nc)) continue;
    if (!canTraverse(nr, nc)) continue;
    enqueueReachable(reachable, queue, nr, nc);
  }
};

const collectReachableCells = (
  snapshot: GameSnapshot,
  path: readonly GridPoint[],
  canTraverse: (r: number, c: number) => boolean,
): Set<string> => {
  const reachable = new Set<string>();
  const queue: GridPoint[] = [];
  let qHead = 0;

  seedReachable(path, canTraverse, reachable, queue);

  while (qHead < queue.length) {
    const cur = queue[qHead++];
    traverseNeighbors(snapshot, cur, ORTHOGONAL_MOVES, canTraverse, reachable, queue);
    traverseNeighbors(snapshot, cur, DIAGONAL_MOVES, canTraverse, reachable, queue, true);
  }

  return reachable;
};

const collectBlockedKeys = (
  snapshot: GameSnapshot,
  visited: ReadonlySet<string>,
  reachable: ReadonlySet<string>,
): string[] => {
  const blockedKeys: string[] = [];

  for (let r = 0; r < snapshot.rows; r++) {
    for (let c = 0; c < snapshot.cols; c++) {
      const k = keyOf(r, c);
      if (isWall(snapshot.gridData[r][c]) || visited.has(k)) continue;
      if (!reachable.has(k)) blockedKeys.push(k);
    }
  }

  return blockedKeys;
};

export function evaluateBlockedCells(snapshot: GameSnapshot): BlockedCellStatus {
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
  const canTraverse = createTraversalGuard(snapshot, visited, endpointKeys);
  const reachable = collectReachableCells(snapshot, path, canTraverse);
  const blockedKeys = collectBlockedKeys(snapshot, visited, reachable);

  return {
    bad: blockedKeys.length,
    badKeys: blockedKeys,
    summary: blockedKeys.length === 0 ? '—' : `${blockedKeys.length} blocked`,
  };
}

const isUsableSnapshotCell = (snapshot: GameSnapshot, point: GridPoint): boolean => (
  inBounds(snapshot.rows, snapshot.cols, point.r, point.c)
  && !isWall(snapshot.gridData[point.r][point.c])
);

const isInternalPathKey = (idxByKey: ReadonlyMap<string, number>, pathLength: number, key: string): boolean => {
  if (!idxByKey.has(key)) return false;
  const index = idxByKey.get(key);
  return index !== undefined && index > 0 && index < pathLength - 1;
};

const getStitchDiagonalState = ({
  blocked,
  hasA,
  hasB,
  ok,
  bad,
}: {
  blocked: boolean;
  hasA: boolean;
  hasB: boolean;
  ok: boolean;
  bad: boolean;
}): RuleState => {
  if (blocked) return 'bad';
  if (hasA && hasB) return ok ? 'good' : 'bad';
  return bad ? 'bad' : 'pending';
};

const evaluateStitchDiagonal = (
  idxByKey: ReadonlyMap<string, number>,
  pathLength: number,
  complete: boolean,
  blocked: boolean,
  keyA: string,
  keyB: string,
) => {
  const hasA = idxByKey.has(keyA);
  const hasB = idxByKey.has(keyB);
  const indexA = idxByKey.get(keyA);
  const indexB = idxByKey.get(keyB);
  const ok = !blocked && hasA && hasB && indexA !== undefined && indexB !== undefined && Math.abs(indexA - indexB) === 1;

  let bad = blocked;
  if (!blocked && hasA && hasB && !ok) bad = true;
  if (!blocked && !(hasA && hasB) && (isInternalPathKey(idxByKey, pathLength, keyA) || isInternalPathKey(idxByKey, pathLength, keyB))) {
    bad = true;
  }
  if (complete && !ok) bad = true;

  return {
    ok,
    bad,
    status: getStitchDiagonalState({ blocked, hasA, hasB, ok, bad }),
  };
};

const evaluateStitchRequirement = (
  snapshot: GameSnapshot,
  idxByKey: ReadonlyMap<string, number>,
  req: StitchRequirement,
  complete: boolean,
) => {
  const pathLength = snapshot.path.length;
  const diagA = evaluateStitchDiagonal(
    idxByKey,
    pathLength,
    complete,
    !isUsableSnapshotCell(snapshot, req.nw) || !isUsableSnapshotCell(snapshot, req.se),
    keyOf(req.nw.r, req.nw.c),
    keyOf(req.se.r, req.se.c),
  );
  const diagB = evaluateStitchDiagonal(
    idxByKey,
    pathLength,
    complete,
    !isUsableSnapshotCell(snapshot, req.ne) || !isUsableSnapshotCell(snapshot, req.sw),
    keyOf(req.ne.r, req.ne.c),
    keyOf(req.sw.r, req.sw.c),
  );

  return { diagA, diagB };
};

export function evaluateStitches(snapshot: GameSnapshot): StitchRuleStatus {
  const idxByKey = snapshot.idxByKey;
  let goodPairs = 0;
  let badPairs = 0;
  const totalPairs = snapshot.stitches.length * 2;
  const vertexStatus = new Map<string, StitchVertexRuleStatus>();
  const complete = snapshot.path.length === snapshot.totalUsable;

  for (const [vr, vc] of snapshot.stitches) {
    const vk = keyOf(vr, vc);
    const req = snapshot.stitchReq.get(vk);

    if (!req) {
      vertexStatus.set(vk, { diagA: 'bad', diagB: 'bad' });
      badPairs += 2;
      continue;
    }

    const { diagA, diagB } = evaluateStitchRequirement(snapshot, idxByKey, req, complete);
    if (diagA.ok) goodPairs++;
    if (diagB.ok) goodPairs++;
    if (diagA.bad) badPairs++;
    if (diagB.bad) badPairs++;
    vertexStatus.set(vk, { diagA: diagA.status, diagB: diagB.status });
  }

  const summary = formatProgressSummary(goodPairs, totalPairs, badPairs);

  return {
    good: goodPairs,
    bad: badPairs,
    total: totalPairs,
    summary,
    vertexStatus,
  };
}

export function evaluateRPS(snapshot: GameSnapshot): RpsRuleStatus {
  const seq: Array<{ i: number; ch: RpsCode; k: string }> = [];
  for (let i = 0; i < snapshot.path.length; i++) {
    const p = snapshot.path[i];
    const ch = snapshot.gridData[p.r][p.c];
    if (isRpsCode(ch)) seq.push({ i, ch, k: keyOf(p.r, p.c) });
  }

  const badKeys = new Set<string>();
  const goodKeys = new Set<string>();
  let badPairs = 0;
  const totalPairs = Math.max(0, seq.length - 1);

  for (let j = 1; j < seq.length; j++) {
    const prev = seq[j - 1];
    const cur = seq[j];
    const expected = RPS_WIN_ORDER[prev.ch];
    if (cur.ch === expected) {
      goodKeys.add(prev.k);
      goodKeys.add(cur.k);
    } else {
      badPairs++;
      badKeys.add(prev.k);
      badKeys.add(cur.k);
    }
  }

  const goodPairs = totalPairs - badPairs;
  const summary = formatProgressSummary(goodPairs, totalPairs, badPairs);

  return {
    good: goodPairs,
    bad: badPairs,
    total: totalPairs,
    summary,
    goodKeys: [...goodKeys],
    badKeys: [...badKeys],
  };
}

export function checkCompletion(
  snapshot: GameSnapshot,
  forced: EvaluateResult = {
    hintStatus: null,
    stitchStatus: null,
    rpsStatus: null,
    blockedStatus: null,
  },
  translate: Translator = (k) => k,
): CompletionResult {
  const t = typeof translate === 'function' ? translate : ((k: string) => k);
  const hintStatus = (forced.hintStatus as HintRuleStatus | null | undefined) || evaluateHints(snapshot);
  const stitchStatus = (forced.stitchStatus as StitchRuleStatus | null | undefined) || evaluateStitches(snapshot);
  const rpsStatus = (forced.rpsStatus as RpsRuleStatus | null | undefined) || evaluateRPS(snapshot);

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
