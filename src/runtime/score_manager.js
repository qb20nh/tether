import { CELL_TYPES, HINT_CODES, RPS_CODES } from '../config.js';
import {
  buildCornerEventMask,
  buildCornerOrthEdgeRefs,
  countCornerOrthConnections,
  isOrthogonalStep,
} from '../shared/stitch_corner_geometry.js';
import { isAdjacentMove, keyOf } from '../utils.js';

export const SCORE_MODES = Object.freeze({
  INFINITE: 'infinite',
  DAILY: 'daily',
});

export const EMPTY_SCORE_STATE = Object.freeze({
  infiniteTotal: 0,
  dailyTotal: 0,
  infiniteByLevel: Object.freeze({}),
  dailyByDate: Object.freeze({}),
});

const WALL_CODES = new Set([CELL_TYPES.WALL, CELL_TYPES.MOVABLE_WALL]);
const CONSTRAINT_CODES = new Set([
  ...HINT_CODES,
  ...RPS_CODES,
]);

const DIRECTION_TOKEN_BY_DELTA = Object.freeze({
  '-1,0': 'U',
  '1,0': 'D',
  '0,-1': 'L',
  '0,1': 'R',
  '-1,-1': 'UL',
  '-1,1': 'UR',
  '1,-1': 'DL',
  '1,1': 'DR',
});

const ORTHOGONAL_DELTAS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);

const toNonNegativeInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const normalizeSignatureArray = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const element of value) {
    const signature = typeof element === 'string' ? element.trim() : '';
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    out.push(signature);
  }
  return out;
};

const normalizeByLevelRecord = (value) => {
  if (!value || typeof value !== 'object') return {};
  const out = {};
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

const scoreAwardForDistinctCount = (distinctCount) => {
  if (!Number.isInteger(distinctCount) || distinctCount <= 0) return 0;
  return Math.max(0, Math.round(Math.sqrt(2 * distinctCount)));
};

const compareStringsAscending = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const toSortedSignatureList = (signatureSet) => [...signatureSet].sort(compareStringsAscending);

export const normalizeScoreState = (value) => {
  const source = value && typeof value === 'object' ? value : EMPTY_SCORE_STATE;
  return {
    infiniteTotal: toNonNegativeInt(source.infiniteTotal),
    dailyTotal: toNonNegativeInt(source.dailyTotal),
    infiniteByLevel: normalizeByLevelRecord(source.infiniteByLevel),
    dailyByDate: normalizeByLevelRecord(source.dailyByDate),
  };
};

const serializeScoreState = ({
  infiniteTotal,
  dailyTotal,
  infiniteByLevel,
  dailyByDate,
}) => {
  const outInfiniteByLevel = {};
  const outDailyByDate = {};

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

const directionToken = (from, to) => {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  return DIRECTION_TOKEN_BY_DELTA[`${dr},${dc}`] || '?';
};

const edgeKey = (a, b) => {
  const ka = keyOf(a.r, a.c);
  const kb = keyOf(b.r, b.c);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const orthEdgeKey = (r1, c1, r2, c2) => {
  const ka = keyOf(r1, c1);
  const kb = keyOf(r2, c2);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const orthEdgeKeyFromPoints = (a, b) => orthEdgeKey(a.r, a.c, b.r, b.c);

const buildCornerTraversalToken = (cornerState) => (
  cornerState && cornerState.edgeTrace.length > 0
    ? cornerState.edgeTrace.join(',')
    : '-'
);

const joinEventPart = (events) => (events.length > 0 ? events.join('>') : '-');

const cornerKeyOf = (vr, vc) => `${vr},${vc}`;

const buildClueEventsForPath = (snapshot, path) => {
  const clueEvents = [];
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

const buildStitchEventByEdge = (stitches) => {
  const stitchEventByEdge = new Map();
  const entries = Array.isArray(stitches) ? stitches : [];

  for (const element of entries) {
    const [vr, vc] = element;
    const aEdge = edgeKey({ r: vr - 1, c: vc - 1 }, { r: vr, c: vc });
    const bEdge = edgeKey({ r: vr - 1, c: vc }, { r: vr, c: vc - 1 });

    if (!stitchEventByEdge.has(aEdge)) stitchEventByEdge.set(aEdge, []);
    if (!stitchEventByEdge.has(bEdge)) stitchEventByEdge.set(bEdge, []);

    stitchEventByEdge.get(aEdge).push(`${vr},${vc}:A`);
    stitchEventByEdge.get(bEdge).push(`${vr},${vc}:B`);
  }

  return stitchEventByEdge;
};

const buildCornerTracking = (corners) => {
  const cornerStateByKey = new Map();
  const cornerRefsByEdgeKey = new Map();

  for (const element of corners) {
    const [vr, vc] = element;
    const cornerKey = cornerKeyOf(vr, vc);
    cornerStateByKey.set(cornerKey, {
      edgeSeen: new Set(),
      edgeTrace: [],
    });

    const edgeRefs = buildCornerOrthEdgeRefs(vr, vc, orthEdgeKeyFromPoints);
    for (const edgeRef of edgeRefs) {
      if (!cornerRefsByEdgeKey.has(edgeRef.edgeKey)) cornerRefsByEdgeKey.set(edgeRef.edgeKey, []);
      cornerRefsByEdgeKey.get(edgeRef.edgeKey).push({
        cornerKey,
        edgeLabel: edgeRef.edgeLabel,
      });
    }
  }

  return {
    cornerRefsByEdgeKey,
    cornerStateByKey,
    seenCorners: new Set(),
  };
};

const appendCornerEvent = (cornerEvents, cornerKey, vr, vc, orthEdgeSet, cornerStateByKey) => {
  const mask = buildCornerEventMask(vr, vc, orthEdgeSet, orthEdgeKeyFromPoints).toString(16);
  cornerEvents.push(`${cornerKey}:${mask}:${buildCornerTraversalToken(cornerStateByKey.get(cornerKey))}`);
};

const appendZeroTargetCornerEvents = (
  corners,
  seenCorners,
  orthEdgeSet,
  cornerStateByKey,
  cornerEvents,
) => {
  for (const element of corners) {
    const [vr, vc, target] = element;
    if (target !== 0) continue;
    const cornerKey = cornerKeyOf(vr, vc);
    seenCorners.add(cornerKey);
    appendCornerEvent(cornerEvents, cornerKey, vr, vc, orthEdgeSet, cornerStateByKey);
  }
};

const recordStitchEventsForEdge = (
  currentEdgeKey,
  stitchEventByEdge,
  seenStitchEvents,
  stitchEvents,
) => {
  const events = stitchEventByEdge.get(currentEdgeKey);
  if (!events) return;

  for (const eventKey of events) {
    if (seenStitchEvents.has(eventKey)) continue;
    seenStitchEvents.add(eventKey);
    stitchEvents.push(eventKey);
  }
};

const recordCornerTraversalForEdge = (
  prev,
  cur,
  stepIndex,
  currentEdgeKey,
  orthEdgeSet,
  cornerRefsByEdgeKey,
  cornerStateByKey,
) => {
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
  corners,
  seenCorners,
  orthEdgeSet,
  cornerStateByKey,
  cornerEvents,
) => {
  for (const element of corners) {
    const [vr, vc, target] = element;
    const cornerKey = cornerKeyOf(vr, vc);
    if (seenCorners.has(cornerKey)) continue;
    if (countCornerOrthConnections(vr, vc, orthEdgeSet, orthEdgeKeyFromPoints) !== target) continue;
    seenCorners.add(cornerKey);
    appendCornerEvent(cornerEvents, cornerKey, vr, vc, orthEdgeSet, cornerStateByKey);
  }
};

const buildConstraintSignatureForPath = (snapshot, path) => {
  const clueEvents = buildClueEventsForPath(snapshot, path);
  const stitchEvents = [];
  const cornerEvents = [];
  const stitchEventByEdge = buildStitchEventByEdge(snapshot.stitches);
  const seenStitchEvents = new Set();
  const orthEdgeSet = new Set();

  const corners = Array.isArray(snapshot.cornerCounts) ? snapshot.cornerCounts : [];
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

const isBoundaryCell = (r, c, rows, cols) => (
  r === 0 || r === rows - 1 || c === 0 || c === cols - 1
);

const enqueueAdjacentWallCells = (queue, rr, cc, rows, cols, gridData, visited) => {
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

const collectWallIsland = (startR, startC, rows, cols, gridData, visited) => {
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

const collectInteriorWallIslands = (gridData) => {
  if (!Array.isArray(gridData) || gridData.length === 0) return [];
  const rows = gridData.length;
  const cols = Array.isArray(gridData[0]) ? gridData[0].length : 0;
  if (!rows || !cols) return [];

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const islands = [];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (visited[r][c]) continue;
      if (!WALL_CODES.has(gridData[r][c])) continue;
      const island = collectWallIsland(r, c, rows, cols, gridData, visited);
      if (island) islands.push(island);
    }
  }

  islands.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  return islands;
};

const inverseToken = (token) => {
  const sign = token[0] === '+' ? '-' : '+';
  return `${sign}${token.slice(1)}`;
};

const reduceTopologyTokens = (tokens) => {
  const out = [];
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

const normalizeTokenLabelsByAppearance = (tokens) => {
  if (tokens.length === 0) return '-';

  const tokenMap = new Map();
  let nextIndex = 0;

  const normalizeId = (id) => {
    if (!tokenMap.has(id)) {
      nextIndex += 1;
      tokenMap.set(id, nextIndex.toString(36));
    }
    return tokenMap.get(id);
  };

  const out = [];
  for (const element of tokens) {
    const token = element;
    out.push(`${token[0]}${normalizeId(token.slice(1))}`);
  }

  return out.join(',');
};

const buildTopologyRays = (gridData) => collectInteriorWallIslands(gridData).map((island, index) => ({
  id: String(index + 1),
  x: island.x,
  y: island.y + ((index + 1) * 1e-5),
}));

const buildRayHit = (x1, y1, x2, y2, ray) => {
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

const compareRayHits = (left, right) => {
  if (left.t !== right.t) return left.t - right.t;
  return compareStringsAscending(left.token, right.token);
};

const collectTopologyHitsForSegment = (a, b, rays) => {
  const x1 = a.c + 0.5;
  const y1 = a.r + 0.5;
  const x2 = b.c + 0.5;
  const y2 = b.r + 0.5;

  if (y1 === y2) return [];

  const hits = [];
  for (const ray of rays) {
    const hit = buildRayHit(x1, y1, x2, y2, ray);
    if (hit) hits.push(hit);
  }

  hits.sort(compareRayHits);
  return hits;
};

const buildTopologySignatureForPath = (snapshot, path) => {
  const rays = buildTopologyRays(snapshot.gridData);
  if (rays.length === 0) return '-';

  const rawTokens = [];

  for (let i = 1; i < path.length; i += 1) {
    const hits = collectTopologyHitsForSegment(path[i - 1], path[i], rays);
    for (const hit of hits) rawTokens.push(hit.token);
  }

  const reduced = reduceTopologyTokens(rawTokens);
  return normalizeTokenLabelsByAppearance(reduced);
};

const pathKey = (path) => path.map((point) => `${point.r},${point.c}`).join('|');

const rotatePath = (path, offset) => {
  const count = path.length;
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = path[(offset + i) % count];
  }
  return out;
};

const isCycleCutPath = (path, stitchSet) => {
  if (!Array.isArray(path) || path.length < 3) return false;
  return isAdjacentMove({ stitchSet }, path[0], path.at(-1));
};

const enumerateCanonicalCandidates = (snapshot) => {
  const path = Array.isArray(snapshot.path) ? snapshot.path : [];
  if (path.length === 0) return [];

  const reversed = [...path].reverse();
  const cycleCut = isCycleCutPath(path, snapshot.stitchSet);

  if (!cycleCut) {
    return [path, reversed];
  }

  const out = [];
  const seen = new Set();
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

export const buildCanonicalSolutionSignature = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.path) || snapshot.path.length === 0) return '';

  const candidates = enumerateCanonicalCandidates(snapshot);
  if (candidates.length === 0) return '';

  let best = null;

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

export const createScoreManager = (bootScoreState, persistence) => {
  const normalized = normalizeScoreState(bootScoreState);

  let infiniteTotal = normalized.infiniteTotal;
  let dailyTotal = normalized.dailyTotal;

  const infiniteByLevel = new Map();
  const dailyByDate = new Map();

  for (const [levelKey, signatures] of Object.entries(normalized.infiniteByLevel)) {
    infiniteByLevel.set(levelKey, new Set(signatures));
  }

  for (const [dailyId, signatures] of Object.entries(normalized.dailyByDate)) {
    dailyByDate.set(dailyId, new Set(signatures));
  }

  const writeState = () => {
    if (!persistence || typeof persistence.writeScoreState !== 'function') return;
    persistence.writeScoreState(
      serializeScoreState({
        infiniteTotal,
        dailyTotal,
        infiniteByLevel,
        dailyByDate,
      }),
    );
  };

  const readTotals = () => ({
    infiniteTotal,
    dailyTotal,
  });

  const getBucket = (mode) => {
    if (mode === SCORE_MODES.INFINITE) return infiniteByLevel;
    if (mode === SCORE_MODES.DAILY) return dailyByDate;
    return null;
  };

  const getModeTotal = (mode) => (mode === SCORE_MODES.INFINITE ? infiniteTotal : dailyTotal);

  const readDistinctCount = ({ mode, levelKey }) => {
    const bucket = getBucket(mode);
    const normalizedLevelKey = String(levelKey || '').trim();
    if (!bucket || !normalizedLevelKey || !bucket.has(normalizedLevelKey)) return 0;
    return bucket.get(normalizedLevelKey).size;
  };

  const registerSolved = ({ mode, levelKey, signature }) => {
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
      bucket.set(normalizedLevelKey, new Set());
    }

    const signatures = bucket.get(normalizedLevelKey);

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

  const readScoreState = () => normalizeScoreState(
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
