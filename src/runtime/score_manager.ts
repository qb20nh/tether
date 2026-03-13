import { CELL_TYPES, HINT_CODES, RPS_CODES } from '../config.ts';
import type {
  GameSnapshot,
  GridPoint,
  PersistencePort,
  RuntimeData,
} from '../contracts/ports.ts';
import {
  buildCornerEventMask,
  buildCornerOrthEdgeRefs,
  countCornerOrthConnections,
  isOrthogonalStep,
} from '../shared/stitch_corner_geometry.ts';
import { isAdjacentMove, keyOf } from '../utils.ts';

export const SCORE_MODES = Object.freeze({
  INFINITE: 'infinite',
  DAILY: 'daily',
} as const);
type ScoreMode = typeof SCORE_MODES[keyof typeof SCORE_MODES];

interface NormalizedScoreState {
  infiniteTotal: number;
  dailyTotal: number;
  infiniteByLevel: Record<string, string[]>;
  dailyByDate: Record<string, string[]>;
  [key: string]: unknown;
}

interface ScoreBucketPayload {
  infiniteTotal: number;
  dailyTotal: number;
  infiniteByLevel: Map<string, Set<string>>;
  dailyByDate: Map<string, Set<string>>;
}

interface CornerState {
  edgeSeen: Set<string>;
  edgeTrace: string[];
}

interface CornerEdgeRef {
  cornerKey: string;
  edgeLabel: 'N' | 'W' | 'E' | 'S';
}

interface CornerTrackingState {
  cornerRefsByEdgeKey: Map<string, CornerEdgeRef[]>;
  cornerStateByKey: Map<string, CornerState>;
  seenCorners: Set<string>;
}

interface WallIsland {
  x: number;
  y: number;
}

interface TopologyRay extends WallIsland {
  id: string;
}

interface TopologyHit {
  t: number;
  token: string;
}

interface ScoreTotals {
  infiniteTotal: number;
  dailyTotal: number;
}

type GridDataSnapshot = Pick<GameSnapshot, 'gridData'>;

interface ReadDistinctCountOptions {
  mode: ScoreMode;
  levelKey: string;
}

interface RegisterSolvedOptions extends ReadDistinctCountOptions {
  signature: string;
}

interface RegisterSolvedResult {
  mode: ScoreMode;
  levelKey: string;
  awarded: number;
  isNew: boolean;
  levelDistinctCount: number;
  modeTotal: number;
  totals: ScoreTotals;
}

export const EMPTY_SCORE_STATE: Readonly<NormalizedScoreState> = Object.freeze({
  infiniteTotal: 0,
  dailyTotal: 0,
  infiniteByLevel: Object.freeze({}),
  dailyByDate: Object.freeze({}),
});

const WALL_CODES: ReadonlySet<string> = new Set([CELL_TYPES.WALL, CELL_TYPES.MOVABLE_WALL]);
const CONSTRAINT_CODES = new Set([
  ...HINT_CODES,
  ...RPS_CODES,
]);

const DIRECTION_TOKEN_BY_DELTA: Readonly<Record<string, string>> = Object.freeze({
  '-1,0': 'U',
  '1,0': 'D',
  '0,-1': 'L',
  '0,1': 'R',
  '-1,-1': 'UL',
  '-1,1': 'UR',
  '1,-1': 'DL',
  '1,1': 'DR',
});

const ORTHOGONAL_DELTAS: readonly [number, number][] = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);

const toNonNegativeInt = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const normalizeSignatureArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const element of value) {
    const signature = typeof element === 'string' ? element.trim() : '';
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    out.push(signature);
  }
  return out;
};

const normalizeByLevelRecord = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string[]> = {};
  const entries = Object.entries(value);
  for (const element of entries) {
    const [rawKey, signatures] = element;
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const normalized = normalizeSignatureArray(signatures);
    if (normalized.length > 0) out[key] = normalized;
  }
  return out;
};

const scoreAwardForDistinctCount = (distinctCount: number): number => {
  if (!Number.isInteger(distinctCount) || distinctCount <= 0) return 0;
  return Math.max(0, Math.round(Math.sqrt(2 * distinctCount)));
};

const compareStringsAscending = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const toSortedSignatureList = (signatureSet: ReadonlySet<string>): string[] =>
  [...signatureSet].sort(compareStringsAscending);

export const normalizeScoreState = (value: unknown): NormalizedScoreState => {
  const source = value && typeof value === 'object' ? value : EMPTY_SCORE_STATE;
  const sourceRecord = source as Partial<NormalizedScoreState>;
  return {
    infiniteTotal: toNonNegativeInt(sourceRecord.infiniteTotal),
    dailyTotal: toNonNegativeInt(sourceRecord.dailyTotal),
    infiniteByLevel: normalizeByLevelRecord(sourceRecord.infiniteByLevel),
    dailyByDate: normalizeByLevelRecord(sourceRecord.dailyByDate),
  };
};

const serializeScoreState = ({
  infiniteTotal,
  dailyTotal,
  infiniteByLevel,
  dailyByDate,
}: ScoreBucketPayload): NormalizedScoreState => {
  const outInfiniteByLevel: Record<string, string[]> = {};
  const outDailyByDate: Record<string, string[]> = {};

  for (const [levelKey, signatureSet] of infiniteByLevel.entries()) {
    const signatures = toSortedSignatureList(signatureSet);
    if (signatures.length > 0) outInfiniteByLevel[levelKey] = signatures;
  }

  for (const [dailyId, signatureSet] of dailyByDate.entries()) {
    const signatures = toSortedSignatureList(signatureSet);
    if (signatures.length > 0) outDailyByDate[dailyId] = signatures;
  }

  return {
    infiniteTotal,
    dailyTotal,
    infiniteByLevel: outInfiniteByLevel,
    dailyByDate: outDailyByDate,
  };
};

const directionToken = (from: GridPoint, to: GridPoint): string => {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  return DIRECTION_TOKEN_BY_DELTA[`${dr},${dc}`] || '?';
};

const edgeKey = (a: GridPoint, b: GridPoint): string => {
  const ka = keyOf(a.r, a.c);
  const kb = keyOf(b.r, b.c);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const orthEdgeKey = (r1: number, c1: number, r2: number, c2: number): string => {
  const ka = keyOf(r1, c1);
  const kb = keyOf(r2, c2);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const orthEdgeKeyFromPoints = (a: GridPoint, b: GridPoint): string => orthEdgeKey(a.r, a.c, b.r, b.c);

const buildCornerTraversalToken = (cornerState?: CornerState): string => (
  cornerState && cornerState.edgeTrace.length > 0
    ? cornerState.edgeTrace.join(',')
    : '-'
);

const joinEventPart = (events: readonly string[]): string => (events.length > 0 ? events.join('>') : '-');

const cornerKeyOf = (vr: number, vc: number): string => `${vr},${vc}`;

const buildClueEventsForPath = (snapshot: GameSnapshot, path: readonly GridPoint[]): string[] => {
  const clueEvents: string[] = [];
  const lastIndex = path.length - 1;

  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const code = snapshot.gridData?.[point.r]?.[point.c] || '';
    if (!CONSTRAINT_CODES.has(code)) continue;

    if (!HINT_CODES.has(code)) {
      clueEvents.push(`${code}@${point.r},${point.c}`);
      continue;
    }

    if (i === 0 || i === lastIndex) {
      clueEvents.push(`${code}@${point.r},${point.c}:END`);
      continue;
    }

    const prev = path[i - 1];
    const next = path[i + 1];
    const vin = directionToken(prev, point);
    const vout = directionToken(point, next);
    clueEvents.push(`${code}@${point.r},${point.c}:${vin}>${vout}`);
  }

  return clueEvents;
};

const buildStitchEventByEdge = (stitches: GameSnapshot['stitches']): Map<string, string[]> => {
  const stitchEventByEdge = new Map<string, string[]>();

  for (const element of stitches) {
    const [vr, vc] = element;
    const aEdge = edgeKey({ r: vr - 1, c: vc - 1 }, { r: vr, c: vc });
    const bEdge = edgeKey({ r: vr - 1, c: vc }, { r: vr, c: vc - 1 });

    if (!stitchEventByEdge.has(aEdge)) stitchEventByEdge.set(aEdge, []);
    if (!stitchEventByEdge.has(bEdge)) stitchEventByEdge.set(bEdge, []);

    const aEvents = stitchEventByEdge.get(aEdge);
    const bEvents = stitchEventByEdge.get(bEdge);
    if (aEvents) aEvents.push(`${vr},${vc}:A`);
    if (bEvents) bEvents.push(`${vr},${vc}:B`);
  }

  return stitchEventByEdge;
};

const buildCornerTracking = (corners: readonly [number, number, number][]): CornerTrackingState => {
  const cornerStateByKey = new Map<string, CornerState>();
  const cornerRefsByEdgeKey = new Map<string, CornerEdgeRef[]>();

  for (const element of corners) {
    const [vr, vc] = element;
    const cornerKey = cornerKeyOf(vr, vc);
    cornerStateByKey.set(cornerKey, {
      edgeSeen: new Set<string>(),
      edgeTrace: [],
    });

    const edgeRefs = buildCornerOrthEdgeRefs(vr, vc, orthEdgeKeyFromPoints);
    for (const edgeRef of edgeRefs) {
      if (!cornerRefsByEdgeKey.has(edgeRef.edgeKey)) cornerRefsByEdgeKey.set(edgeRef.edgeKey, []);
      const refs = cornerRefsByEdgeKey.get(edgeRef.edgeKey);
      if (!refs) continue;
      refs.push({
        cornerKey,
        edgeLabel: edgeRef.edgeLabel,
      });
    }
  }

  return {
    cornerRefsByEdgeKey,
    cornerStateByKey,
    seenCorners: new Set<string>(),
  };
};

const appendCornerEvent = (
  cornerEvents: string[],
  cornerKey: string,
  vr: number,
  vc: number,
  orthEdgeSet: ReadonlySet<string>,
  cornerStateByKey: ReadonlyMap<string, CornerState>,
): void => {
  const mask = buildCornerEventMask(vr, vc, orthEdgeSet, orthEdgeKeyFromPoints).toString(16);
  cornerEvents.push(`${cornerKey}:${mask}:${buildCornerTraversalToken(cornerStateByKey.get(cornerKey))}`);
};

const appendZeroTargetCornerEvents = (
  corners: readonly [number, number, number][],
  seenCorners: Set<string>,
  orthEdgeSet: ReadonlySet<string>,
  cornerStateByKey: ReadonlyMap<string, CornerState>,
  cornerEvents: string[],
): void => {
  for (const element of corners) {
    const [vr, vc, target] = element;
    if (target !== 0) continue;
    const cornerKey = cornerKeyOf(vr, vc);
    seenCorners.add(cornerKey);
    appendCornerEvent(cornerEvents, cornerKey, vr, vc, orthEdgeSet, cornerStateByKey);
  }
};

const recordStitchEventsForEdge = (
  currentEdgeKey: string,
  stitchEventByEdge: ReadonlyMap<string, string[]>,
  seenStitchEvents: Set<string>,
  stitchEvents: string[],
): void => {
  const events = stitchEventByEdge.get(currentEdgeKey);
  if (!events) return;

  for (const eventKey of events) {
    if (seenStitchEvents.has(eventKey)) continue;
    seenStitchEvents.add(eventKey);
    stitchEvents.push(eventKey);
  }
};

const recordCornerTraversalForEdge = (
  prev: GridPoint,
  cur: GridPoint,
  stepIndex: number,
  currentEdgeKey: string,
  orthEdgeSet: Set<string>,
  cornerRefsByEdgeKey: ReadonlyMap<string, CornerEdgeRef[]>,
  cornerStateByKey: Map<string, CornerState>,
): void => {
  if (!isOrthogonalStep(prev, cur)) return;

  orthEdgeSet.add(currentEdgeKey);
  const cornerRefs = cornerRefsByEdgeKey.get(currentEdgeKey);
  if (!cornerRefs) return;

  const moveDirection = directionToken(prev, cur);
  for (const cornerRef of cornerRefs) {
    const cornerState = cornerStateByKey.get(cornerRef.cornerKey);
    if (!cornerState || cornerState.edgeSeen.has(cornerRef.edgeLabel)) continue;
    cornerState.edgeSeen.add(cornerRef.edgeLabel);
    cornerState.edgeTrace.push(`${cornerRef.edgeLabel}${moveDirection}${stepIndex.toString(36)}`);
  }
};

const appendSatisfiedCornerEvents = (
  corners: readonly [number, number, number][],
  seenCorners: Set<string>,
  orthEdgeSet: ReadonlySet<string>,
  cornerStateByKey: ReadonlyMap<string, CornerState>,
  cornerEvents: string[],
): void => {
  for (const element of corners) {
    const [vr, vc, target] = element;
    const cornerKey = cornerKeyOf(vr, vc);
    if (seenCorners.has(cornerKey)) continue;
    if (countCornerOrthConnections(vr, vc, orthEdgeSet, orthEdgeKeyFromPoints) !== target) continue;
    seenCorners.add(cornerKey);
    appendCornerEvent(cornerEvents, cornerKey, vr, vc, orthEdgeSet, cornerStateByKey);
  }
};

const buildConstraintSignatureForPath = (snapshot: GameSnapshot, path: readonly GridPoint[]): string => {
  const clueEvents = buildClueEventsForPath(snapshot, path);
  const stitchEvents: string[] = [];
  const cornerEvents: string[] = [];
  const stitchEventByEdge = buildStitchEventByEdge(snapshot.stitches);
  const seenStitchEvents = new Set<string>();
  const orthEdgeSet = new Set<string>();
  const corners = snapshot.cornerCounts;
  const { seenCorners, cornerStateByKey, cornerRefsByEdgeKey } = buildCornerTracking(corners);

  appendZeroTargetCornerEvents(corners, seenCorners, orthEdgeSet, cornerStateByKey, cornerEvents);

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const cur = path[i];
    const currentEdgeKey = edgeKey(prev, cur);

    recordStitchEventsForEdge(currentEdgeKey, stitchEventByEdge, seenStitchEvents, stitchEvents);
    recordCornerTraversalForEdge(
      prev,
      cur,
      i,
      currentEdgeKey,
      orthEdgeSet,
      cornerRefsByEdgeKey,
      cornerStateByKey,
    );
    appendSatisfiedCornerEvents(corners, seenCorners, orthEdgeSet, cornerStateByKey, cornerEvents);
  }

  return `${joinEventPart(clueEvents)}|${joinEventPart(stitchEvents)}|${joinEventPart(cornerEvents)}`;
};

const isBoundaryCell = (r: number, c: number, rows: number, cols: number): boolean => (
  r === 0 || r === rows - 1 || c === 0 || c === cols - 1
);

const enqueueAdjacentWallCells = (
  queue: GridPoint[],
  rr: number,
  cc: number,
  rows: number,
  cols: number,
  gridData: readonly string[][],
  visited: boolean[][],
): void => {
  for (const [dr, dc] of ORTHOGONAL_DELTAS) {
    const nr = rr + dr;
    const nc = cc + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    if (visited[nr][nc]) continue;
    if (!WALL_CODES.has(gridData[nr][nc])) continue;
    visited[nr][nc] = true;
    queue.push({ r: nr, c: nc });
  }
};

const collectWallIsland = (
  startR: number,
  startC: number,
  rows: number,
  cols: number,
  gridData: readonly string[][],
  visited: boolean[][],
): WallIsland | null => {
  let touchesBoundary = false;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  const queue = [{ r: startR, c: startC }];
  visited[startR][startC] = true;

  for (const point of queue) {
    const { r: rr, c: cc } = point;

    if (isBoundaryCell(rr, cc, rows, cols)) touchesBoundary = true;

    sumX += cc + 0.5;
    sumY += rr + 0.5;
    count += 1;

    enqueueAdjacentWallCells(queue, rr, cc, rows, cols, gridData, visited);
  }

  if (touchesBoundary || count <= 0) return null;
  return {
    x: sumX / count,
    y: sumY / count,
  };
};

const collectInteriorWallIslands = (gridData: unknown): WallIsland[] => {
  if (!Array.isArray(gridData) || gridData.length === 0) return [];
  const rows = gridData.length;
  const cols = Array.isArray(gridData[0]) ? gridData[0].length : 0;
  if (!rows || !cols) return [];

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const islands: WallIsland[] = [];
  const typedGridData = gridData as string[][];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (visited[r][c]) continue;
      if (!WALL_CODES.has(typedGridData[r][c])) continue;
      const island = collectWallIsland(r, c, rows, cols, typedGridData, visited);
      if (island) islands.push(island);
    }
  }

  islands.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  return islands;
};

const inverseToken = (token: string): string => {
  const sign = token[0] === '+' ? '-' : '+';
  return `${sign}${token.slice(1)}`;
};

const reduceTopologyTokens = (tokens: readonly string[]): string[] => {
  const out: string[] = [];
  for (const element of tokens) {
    const token = element;
    const last = out.at(-1);
    if (last && inverseToken(last) === token) {
      out.pop();
      continue;
    }
    out.push(token);
  }
  return out;
};

const normalizeTokenLabelsByAppearance = (tokens: readonly string[]): string => {
  if (tokens.length === 0) return '-';

  const tokenMap = new Map<string, string>();
  let nextIndex = 0;

  const normalizeId = (id: string): string => {
    if (!tokenMap.has(id)) {
      nextIndex += 1;
      tokenMap.set(id, nextIndex.toString(36));
    }
    return tokenMap.get(id) || '';
  };

  const out: string[] = [];
  for (const element of tokens) {
    const token = element;
    out.push(`${token[0]}${normalizeId(token.slice(1))}`);
  }

  return out.join(',');
};

const buildTopologyRays = (gridData: unknown): TopologyRay[] => collectInteriorWallIslands(gridData).map((island, index) => ({
  id: String(index + 1),
  x: island.x,
  y: island.y + ((index + 1) * 1e-5),
}));

const buildRayHit = (x1: number, y1: number, x2: number, y2: number, ray: TopologyRay): TopologyHit | null => {
  const crossing = (
    (y1 <= ray.y && y2 > ray.y)
    || (y2 <= ray.y && y1 > ray.y)
  );
  if (!crossing) return null;

  const t = (ray.y - y1) / (y2 - y1);
  const xAt = x1 + ((x2 - x1) * t);
  if (xAt <= ray.x) return null;

  return {
    t,
    token: `${y2 > y1 ? '+' : '-'}${ray.id}`,
  };
};

const compareRayHits = (left: TopologyHit, right: TopologyHit): number => {
  if (left.t !== right.t) return left.t - right.t;
  return compareStringsAscending(left.token, right.token);
};

const collectTopologyHitsForSegment = (a: GridPoint, b: GridPoint, rays: readonly TopologyRay[]): TopologyHit[] => {
  const x1 = a.c + 0.5;
  const y1 = a.r + 0.5;
  const x2 = b.c + 0.5;
  const y2 = b.r + 0.5;

  if (y1 === y2) return [];

  const hits: TopologyHit[] = [];
  for (const ray of rays) {
    const hit = buildRayHit(x1, y1, x2, y2, ray);
    if (hit) hits.push(hit);
  }

  hits.sort(compareRayHits);
  return hits;
};

const buildTopologySignatureForPath = (snapshot: GridDataSnapshot, path: readonly GridPoint[]): string => {
  const rays = buildTopologyRays(snapshot.gridData);
  if (rays.length === 0) return '-';

  const rawTokens: string[] = [];

  for (let i = 1; i < path.length; i += 1) {
    const hits = collectTopologyHitsForSegment(path[i - 1], path[i], rays);
    for (const hit of hits) rawTokens.push(hit.token);
  }

  const reduced = reduceTopologyTokens(rawTokens);
  return normalizeTokenLabelsByAppearance(reduced);
};

const pathKey = (path: readonly GridPoint[]): string => path.map((point) => `${point.r},${point.c}`).join('|');

const rotatePath = (path: readonly GridPoint[], offset: number): GridPoint[] => {
  const count = path.length;
  const out = new Array<GridPoint>(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = path[(offset + i) % count] as GridPoint;
  }
  return out;
};

const isCycleCutPath = (path: readonly GridPoint[], stitchSet: Set<string>): boolean => {
  if (!Array.isArray(path) || path.length < 3) return false;
  const last = path[path.length - 1];
  return last ? isAdjacentMove({ stitchSet }, path[0] as GridPoint, last) : false;
};

const enumerateCanonicalCandidates = (snapshot: GameSnapshot): GridPoint[][] => {
  const path = Array.isArray(snapshot.path) ? snapshot.path : [];
  if (path.length === 0) return [];

  const reversed = [...path].reverse();
  const cycleCut = isCycleCutPath(path, snapshot.stitchSet);

  if (!cycleCut) {
    return [path, reversed];
  }

  const out: GridPoint[][] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < path.length; offset += 1) {
    const forwardRotation = rotatePath(path, offset);
    const reverseRotation = rotatePath(reversed, offset);

    const forwardKey = pathKey(forwardRotation);
    const reverseKey = pathKey(reverseRotation);

    if (!seen.has(forwardKey)) {
      seen.add(forwardKey);
      out.push(forwardRotation);
    }

    if (!seen.has(reverseKey)) {
      seen.add(reverseKey);
      out.push(reverseRotation);
    }
  }

  return out;
};

export const buildCanonicalSolutionSignature = (snapshot: GameSnapshot | null | undefined): string => {
  if (!snapshot || !Array.isArray(snapshot.path) || snapshot.path.length === 0) return '';

  const candidates = enumerateCanonicalCandidates(snapshot);
  if (candidates.length === 0) return '';

  let best: string | null = null;

  for (const element of candidates) {
    const path = element;
    const constraint = buildConstraintSignatureForPath(snapshot, path);
    const topology = buildTopologySignatureForPath(snapshot, path);
    const combined = `${constraint}||${topology}`;

    if (best === null || combined < best) {
      best = combined;
    }
  }

  return best || '';
};

export const createScoreManager = (bootScoreState: unknown, persistence: PersistencePort | null) => {
  const normalized = normalizeScoreState(bootScoreState);

  let infiniteTotal = normalized.infiniteTotal;
  let dailyTotal = normalized.dailyTotal;

  const infiniteByLevel = new Map<string, Set<string>>();
  const dailyByDate = new Map<string, Set<string>>();

  for (const [levelKey, signatures] of Object.entries(normalized.infiniteByLevel)) {
    infiniteByLevel.set(levelKey, new Set(signatures));
  }

  for (const [dailyId, signatures] of Object.entries(normalized.dailyByDate)) {
    dailyByDate.set(dailyId, new Set(signatures));
  }

  const writeState = (): void => {
    if (!persistence || typeof persistence.writeScoreState !== 'function') return;
    persistence.writeScoreState(
      serializeScoreState({
        infiniteTotal,
        dailyTotal,
        infiniteByLevel,
        dailyByDate,
      }) as RuntimeData,
    );
  };

  const readTotals = (): ScoreTotals => ({
    infiniteTotal,
    dailyTotal,
  });

  const getBucket = (mode: ScoreMode): Map<string, Set<string>> | null => {
    if (mode === SCORE_MODES.INFINITE) return infiniteByLevel;
    if (mode === SCORE_MODES.DAILY) return dailyByDate;
    return null;
  };

  const getModeTotal = (mode: ScoreMode): number => (mode === SCORE_MODES.INFINITE ? infiniteTotal : dailyTotal);

  const readDistinctCount = ({ mode, levelKey }: ReadDistinctCountOptions): number => {
    const bucket = getBucket(mode);
    const normalizedLevelKey = String(levelKey || '').trim();
    if (!bucket || !normalizedLevelKey || !bucket.has(normalizedLevelKey)) return 0;
    return bucket.get(normalizedLevelKey)?.size || 0;
  };

  const registerSolved = ({ mode, levelKey, signature }: RegisterSolvedOptions): RegisterSolvedResult => {
    const normalizedLevelKey = String(levelKey || '').trim();
    const normalizedSignature = typeof signature === 'string' ? signature.trim() : '';

    const bucket = getBucket(mode);
    if (!bucket || !normalizedLevelKey || !normalizedSignature) {
      return {
        mode,
        levelKey: normalizedLevelKey,
        awarded: 0,
        isNew: false,
        levelDistinctCount: 0,
        modeTotal: getModeTotal(mode),
        totals: readTotals(),
      };
    }

    if (!bucket.has(normalizedLevelKey)) {
      bucket.set(normalizedLevelKey, new Set<string>());
    }

    const signatures = bucket.get(normalizedLevelKey);
    if (!signatures) {
      return {
        mode,
        levelKey: normalizedLevelKey,
        awarded: 0,
        isNew: false,
        levelDistinctCount: 0,
        modeTotal: getModeTotal(mode),
        totals: readTotals(),
      };
    }

    if (signatures.has(normalizedSignature)) {
      return {
        mode,
        levelKey: normalizedLevelKey,
        awarded: 0,
        isNew: false,
        levelDistinctCount: signatures.size,
        modeTotal: getModeTotal(mode),
        totals: readTotals(),
      };
    }

    signatures.add(normalizedSignature);
    const levelDistinctCount = signatures.size;
    const awarded = scoreAwardForDistinctCount(levelDistinctCount);

    if (mode === SCORE_MODES.INFINITE) {
      infiniteTotal += awarded;
    } else {
      dailyTotal += awarded;
    }

    writeState();

    return {
      mode,
      levelKey: normalizedLevelKey,
      awarded,
      isNew: true,
      levelDistinctCount,
      modeTotal: getModeTotal(mode),
      totals: readTotals(),
    };
  };

  const readScoreState = (): NormalizedScoreState => normalizeScoreState(
    serializeScoreState({
      infiniteTotal,
      dailyTotal,
      infiniteByLevel,
      dailyByDate,
    }),
  );

  return {
    readTotals,
    readScoreState,
    readDistinctCount,
    registerSolved,
  };
};

export const __TEST__ = {
  buildConstraintSignatureForPath,
  buildTopologySignatureForPath,
  collectInteriorWallIslands,
  reduceTopologyTokens,
  normalizeTokenLabelsByAppearance,
  enumerateCanonicalCandidates,
  scoreAwardForDistinctCount,
};
