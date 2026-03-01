import { CELL_TYPES, HINT_CODES, RPS_CODES } from '../config.js';
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

const toNonNegativeInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const normalizeSignatureArray = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const signature = typeof value[i] === 'string' ? value[i].trim() : '';
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
  for (let i = 0; i < entries.length; i += 1) {
    const [rawKey, signatures] = entries[i];
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const normalized = normalizeSignatureArray(signatures);
    if (normalized.length > 0) out[key] = normalized;
  }
  return out;
};

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
    const signatures = [...signatureSet].sort();
    if (signatures.length > 0) outInfiniteByLevel[levelKey] = signatures;
  }

  for (const [dailyId, signatureSet] of dailyByDate.entries()) {
    const signatures = [...signatureSet].sort();
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

const isOrthEdge = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

const buildCornerEventMask = (vr, vc, orthEdges) => {
  const north = orthEdges.has(orthEdgeKey(vr - 1, vc - 1, vr - 1, vc)) ? 1 : 0;
  const west = orthEdges.has(orthEdgeKey(vr - 1, vc - 1, vr, vc - 1)) ? 1 : 0;
  const east = orthEdges.has(orthEdgeKey(vr - 1, vc, vr, vc)) ? 1 : 0;
  const south = orthEdges.has(orthEdgeKey(vr, vc - 1, vr, vc)) ? 1 : 0;
  return (north << 3) | (west << 2) | (east << 1) | south;
};

const countCornerOrthConnections = (vr, vc, orthEdges) => {
  let count = 0;
  if (orthEdges.has(orthEdgeKey(vr - 1, vc - 1, vr - 1, vc))) count += 1;
  if (orthEdges.has(orthEdgeKey(vr - 1, vc - 1, vr, vc - 1))) count += 1;
  if (orthEdges.has(orthEdgeKey(vr - 1, vc, vr, vc))) count += 1;
  if (orthEdges.has(orthEdgeKey(vr, vc - 1, vr, vc))) count += 1;
  return count;
};

const buildConstraintSignatureForPath = (snapshot, path) => {
  const clueEvents = [];
  const stitchEvents = [];
  const cornerEvents = [];

  const lastIndex = path.length - 1;

  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const code = snapshot.gridData?.[point.r]?.[point.c] || '';
    if (!CONSTRAINT_CODES.has(code)) continue;

    if (HINT_CODES.has(code)) {
      if (i === 0 || i === lastIndex) {
        clueEvents.push(`${code}@${point.r},${point.c}:END`);
        continue;
      }
      const prev = path[i - 1];
      const next = path[i + 1];
      const vin = directionToken(prev, point);
      const vout = directionToken(point, next);
      clueEvents.push(`${code}@${point.r},${point.c}:${vin}>${vout}`);
      continue;
    }

    clueEvents.push(`${code}@${point.r},${point.c}`);
  }

  const stitchEventByEdge = new Map();
  const stitches = Array.isArray(snapshot.stitches) ? snapshot.stitches : [];
  for (let i = 0; i < stitches.length; i += 1) {
    const [vr, vc] = stitches[i];
    const aEdge = edgeKey({ r: vr - 1, c: vc - 1 }, { r: vr, c: vc });
    const bEdge = edgeKey({ r: vr - 1, c: vc }, { r: vr, c: vc - 1 });

    if (!stitchEventByEdge.has(aEdge)) stitchEventByEdge.set(aEdge, []);
    if (!stitchEventByEdge.has(bEdge)) stitchEventByEdge.set(bEdge, []);

    stitchEventByEdge.get(aEdge).push(`${vr},${vc}:A`);
    stitchEventByEdge.get(bEdge).push(`${vr},${vc}:B`);
  }

  const seenStitchEvents = new Set();
  const orthEdgeSet = new Set();

  const corners = Array.isArray(snapshot.cornerCounts) ? snapshot.cornerCounts : [];
  const seenCorners = new Set();

  for (let i = 0; i < corners.length; i += 1) {
    const [vr, vc, target] = corners[i];
    if (target !== 0) continue;
    const cornerKey = `${vr},${vc}`;
    seenCorners.add(cornerKey);
    const mask = buildCornerEventMask(vr, vc, orthEdgeSet).toString(16);
    cornerEvents.push(`${cornerKey}:${mask}`);
  }

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const cur = path[i];
    const currentEdgeKey = edgeKey(prev, cur);

    if (stitchEventByEdge.has(currentEdgeKey)) {
      const events = stitchEventByEdge.get(currentEdgeKey);
      for (let j = 0; j < events.length; j += 1) {
        const eventKey = events[j];
        if (seenStitchEvents.has(eventKey)) continue;
        seenStitchEvents.add(eventKey);
        stitchEvents.push(eventKey);
      }
    }

    if (isOrthEdge(prev, cur)) {
      orthEdgeSet.add(currentEdgeKey);
    }

    for (let j = 0; j < corners.length; j += 1) {
      const [vr, vc, target] = corners[j];
      const cornerKey = `${vr},${vc}`;
      if (seenCorners.has(cornerKey)) continue;
      if (countCornerOrthConnections(vr, vc, orthEdgeSet) !== target) continue;
      seenCorners.add(cornerKey);
      const mask = buildCornerEventMask(vr, vc, orthEdgeSet).toString(16);
      cornerEvents.push(`${cornerKey}:${mask}`);
    }
  }

  const cluePart = clueEvents.length > 0 ? clueEvents.join('>') : '-';
  const stitchPart = stitchEvents.length > 0 ? stitchEvents.join('>') : '-';
  const cornerPart = cornerEvents.length > 0 ? cornerEvents.join('>') : '-';

  return `${cluePart}|${stitchPart}|${cornerPart}`;
};

const collectInteriorWallIslands = (gridData) => {
  if (!Array.isArray(gridData) || gridData.length === 0) return [];
  const rows = gridData.length;
  const cols = Array.isArray(gridData[0]) ? gridData[0].length : 0;
  if (!rows || !cols) return [];

  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const islands = [];
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (visited[r][c]) continue;
      if (!WALL_CODES.has(gridData[r][c])) continue;

      let touchesBoundary = false;
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      const queue = [{ r, c }];
      visited[r][c] = true;

      for (let qi = 0; qi < queue.length; qi += 1) {
        const point = queue[qi];
        const { r: rr, c: cc } = point;

        if (rr === 0 || rr === rows - 1 || cc === 0 || cc === cols - 1) {
          touchesBoundary = true;
        }

        sumX += cc + 0.5;
        sumY += rr + 0.5;
        count += 1;

        for (let di = 0; di < deltas.length; di += 1) {
          const nr = rr + deltas[di][0];
          const nc = cc + deltas[di][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (visited[nr][nc]) continue;
          if (!WALL_CODES.has(gridData[nr][nc])) continue;
          visited[nr][nc] = true;
          queue.push({ r: nr, c: nc });
        }
      }

      if (touchesBoundary || count <= 0) continue;
      islands.push({
        x: sumX / count,
        y: sumY / count,
      });
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
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const last = out[out.length - 1];
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
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    out.push(`${token[0]}${normalizeId(token.slice(1))}`);
  }

  return out.join(',');
};

const buildTopologySignatureForPath = (snapshot, path) => {
  const islands = collectInteriorWallIslands(snapshot.gridData);
  if (islands.length === 0) return '-';

  const rays = islands.map((island, index) => ({
    id: String(index + 1),
    x: island.x,
    y: island.y + ((index + 1) * 1e-5),
  }));

  const rawTokens = [];

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const x1 = a.c + 0.5;
    const y1 = a.r + 0.5;
    const x2 = b.c + 0.5;
    const y2 = b.r + 0.5;

    if (y1 === y2) continue;

    const hits = [];
    for (let ri = 0; ri < rays.length; ri += 1) {
      const ray = rays[ri];
      const yr = ray.y;
      const crossing = (
        (y1 <= yr && y2 > yr)
        || (y2 <= yr && y1 > yr)
      );
      if (!crossing) continue;

      const t = (yr - y1) / (y2 - y1);
      const xAt = x1 + ((x2 - x1) * t);
      if (!(xAt > ray.x)) continue;

      hits.push({
        t,
        token: `${y2 > y1 ? '+' : '-'}${ray.id}`,
      });
    }

    if (hits.length === 0) continue;

    hits.sort((left, right) => {
      if (left.t !== right.t) return left.t - right.t;
      if (left.token < right.token) return -1;
      if (left.token > right.token) return 1;
      return 0;
    });

    for (let hi = 0; hi < hits.length; hi += 1) {
      rawTokens.push(hits[hi].token);
    }
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
  return isAdjacentMove({ stitchSet }, path[0], path[path.length - 1]);
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

  for (let i = 0; i < candidates.length; i += 1) {
    const path = candidates[i];
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
    const awarded = signatures.size;

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
      levelDistinctCount: signatures.size,
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
};
