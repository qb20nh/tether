// @ts-nocheck
import { applyCanvasElementSize, resolveCanvasSize } from './canvas_size_utils.ts';

const TAU = Math.PI * 2;
const FLOW_STOP_EPSILON = 1e-4;
const COMPLETE_PATH_THRESHOLD = 0.999;
const DEFAULT_MAX_PATH_POINTS = 64;
const BRACKET_PULSE_CYCLES = 3;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const UINT16_BYTES = Uint16Array.BYTES_PER_ELEMENT;

const clampUnit = (value) => Math.max(0, Math.min(1, value));
const EMPTY_CORNER_VERTEX_META = Object.freeze({
  flag: 0,
  cx: 0,
  cy: 0,
  angleIn: 0,
  sweep: 0,
  travelStart: 0,
  travelSpan: 0,
});

const createMeshStorage = () => ({
  positions: new Float32Array(0),
  travels: new Float32Array(0),
  cornerFlags: new Float32Array(0),
  cornerCenters: new Float32Array(0),
  cornerAngles: new Float32Array(0),
  cornerTravels: new Float32Array(0),
  indices: new Uint16Array(0),
  vertexCount: 0,
  indexCount: 0,
  mainTravel: 0,
});

const createBracketStorage = () => ({
  centers: new Float32Array(0),
  corners: new Float32Array(0),
  indices: new Uint16Array(0),
  vertexCount: 0,
  indexCount: 0,
});

const normalizeAngle = (angle) => {
  const normalized = angle % TAU;
  return normalized >= 0 ? normalized : normalized + TAU;
};

const angleDeltaSigned = (from, to) => {
  const delta = normalizeAngle(to - from);
  return delta > Math.PI ? delta - TAU : delta;
};

const toFinitePoint = (point) => {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const createEmptyMesh = createMeshStorage;
const createEmptyBracketMesh = createBracketStorage;

const createCornerVertexMeta = (cornerMeta) => {
  if (!cornerMeta) return EMPTY_CORNER_VERTEX_META;
  return {
    flag: 1,
    cx: cornerMeta.cx || 0,
    cy: cornerMeta.cy || 0,
    angleIn: cornerMeta.angleIn || 0,
    sweep: cornerMeta.sweep || 0,
    travelStart: cornerMeta.travelStart || 0,
    travelSpan: cornerMeta.travelSpan || 0,
  };
};

const buildCornerTurn = (
  points,
  segmentLengths,
  segmentUx,
  segmentUy,
  cornerRadius,
  cornerIndex,
) => {
  const angleTolerance = 1e-4;
  const corner = points[cornerIndex];
  const inLen = segmentLengths[cornerIndex - 1];
  const outLen = segmentLengths[cornerIndex];
  if (inLen <= 0 || outLen <= 0) return null;

  const inUx = segmentUx[cornerIndex - 1];
  const inUy = segmentUy[cornerIndex - 1];
  const outUx = segmentUx[cornerIndex];
  const outUy = segmentUy[cornerIndex];
  const inAngle = Math.atan2(inUy, inUx);
  const outAngle = Math.atan2(outUy, outUx);
  const headingTurn = angleDeltaSigned(inAngle, outAngle);
  const absTurn = Math.abs(headingTurn);
  if (absTurn <= angleTolerance || absTurn >= Math.PI - angleTolerance) return null;

  const tangentScale = Math.tan(absTurn * 0.5);
  if (tangentScale <= 0 || !Number.isFinite(tangentScale)) return null;
  const tangentOffset = cornerRadius * tangentScale;
  const maxTangentOffset = Math.max(0, Math.min(inLen, outLen));
  const effectiveTangentOffset = Math.min(tangentOffset, maxTangentOffset);
  if (effectiveTangentOffset <= 0 || !Number.isFinite(effectiveTangentOffset)) return null;
  const effectiveRadius = effectiveTangentOffset / tangentScale;
  if (effectiveRadius <= 0 || !Number.isFinite(effectiveRadius)) return null;

  const tangentInX = corner.x - inUx * effectiveTangentOffset;
  const tangentInY = corner.y - inUy * effectiveTangentOffset;
  const tangentOutX = corner.x + outUx * effectiveTangentOffset;
  const tangentOutY = corner.y + outUy * effectiveTangentOffset;
  const inNormalX = headingTurn > 0 ? -inUy : inUy;
  const inNormalY = headingTurn > 0 ? inUx : -inUx;
  const cx = tangentInX + inNormalX * effectiveRadius;
  const cy = tangentInY + inNormalY * effectiveRadius;
  const centerAngleIn = normalizeAngle(Math.atan2(tangentInY - cy, tangentInX - cx));
  const centerAngleOut = normalizeAngle(Math.atan2(tangentOutY - cy, tangentOutX - cx));
  const centerSweep = angleDeltaSigned(centerAngleIn, centerAngleOut);
  const centerSweepAbs = Math.abs(centerSweep);
  if (centerSweepAbs <= angleTolerance) return null;

  return {
    tangentOffset: effectiveTangentOffset,
    arcLength: Math.max(0, effectiveRadius * centerSweepAbs),
    tangentInX,
    tangentInY,
    tangentOutX,
    tangentOutY,
    inUx,
    inUy,
    outUx,
    outUy,
    turnSigned: centerSweep < 0 ? -1 : 1,
    cx,
    cy,
    centerAngleIn,
    centerSweep,
    absTurn: centerSweepAbs,
  };
};

const buildCornerTurns = (
  points,
  segmentLengths,
  segmentUx,
  segmentUy,
  cornerRadius,
) => {
  const cornerTurns = new Array(points.length).fill(null);

  for (let i = 1; i < points.length - 1; i++) {
    cornerTurns[i] = buildCornerTurn(
      points,
      segmentLengths,
      segmentUx,
      segmentUy,
      cornerRadius,
      i,
    );
  }

  return cornerTurns;
};

const buildFlowPrimitives = (points, segmentLengths, cornerTurns) => {
  const linearPrimitives = [];
  const cornerPrimitives = [];
  let flowTravel = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const len = segmentLengths[i];
    if (len <= 0) continue;

    const startCorner = cornerTurns[i];
    const endCorner = cornerTurns[i + 1];
    const trimStart = startCorner ? Math.min(len, startCorner.tangentOffset) : 0;
    const trimEnd = endCorner ? Math.min(len, endCorner.tangentOffset) : 0;
    const drawableStart = trimStart;
    const drawableEnd = Math.max(drawableStart, len - trimEnd);
    const drawableLength = drawableEnd - drawableStart;

    if (drawableLength > 0) {
      linearPrimitives.push({
        segmentIndex: i,
        localStart: drawableStart,
        localEnd: drawableEnd,
        travelStart: flowTravel,
        travelEnd: flowTravel + drawableLength,
      });
      flowTravel += drawableLength;
    }

    if (endCorner && endCorner.arcLength > 0) {
      cornerPrimitives.push({
        cornerIndex: i + 1,
        travelStart: flowTravel,
        travelEnd: flowTravel + endCorner.arcLength,
      });
      flowTravel += endCorner.arcLength;
    }
  }

  return {
    linearPrimitives,
    cornerPrimitives,
    mainTravel: flowTravel,
  };
};

const createUnifiedPathMeshBuildState = (points, options = {}) => {
  if (!Array.isArray(points) || points.length === 0) return null;

  const maxPathPoints = Number.isInteger(options.maxPathPoints) && options.maxPathPoints > 0
    ? options.maxPathPoints
    : DEFAULT_MAX_PATH_POINTS;
  const safePoints = points
    .slice(0, maxPathPoints)
    .map(toFinitePoint)
    .filter(Boolean);
  if (safePoints.length === 0) return null;

  const width = Math.max(1, Number(options.width) || 1);
  const halfWidth = width * 0.5;
  const startRadius = Math.max(0, Number(options.startRadius) || 0);
  const arrowLength = Math.max(0, Number(options.arrowLength) || 0);
  const endHalfWidth = Math.max(0, Number(options.endHalfWidth) || 0);
  const startFlowDirX = Number(options.startFlowDirX);
  const startFlowDirY = Number(options.startFlowDirY);
  const hasStartFlowOverride = Number.isFinite(startFlowDirX)
    && Number.isFinite(startFlowDirY)
    && Math.hypot(startFlowDirX, startFlowDirY) > FLOW_STOP_EPSILON;
  const endArrowDirX = Number(options.endArrowDirX);
  const endArrowDirY = Number(options.endArrowDirY);
  const hasEndArrowOverride = Number.isFinite(endArrowDirX)
    && Number.isFinite(endArrowDirY)
    && Math.hypot(endArrowDirX, endArrowDirY) > FLOW_STOP_EPSILON;
  const reverseHeadArrowLength = Math.max(0, Number(options.reverseHeadArrowLength) || 0);
  const reverseHeadArrowHalfWidth = Math.max(0, Number(options.reverseHeadArrowHalfWidth) || 0);
  const reverseTailCircleRadius = Math.max(0, Number(options.reverseTailCircleRadius) || 0);
  const renderStartCap = options.renderStartCap !== false;
  const renderEndCap = options.renderEndCap !== false;

  const segmentCount = Math.max(0, safePoints.length - 1);
  const segmentLengths = new Array(segmentCount).fill(0);
  const segmentUx = new Array(segmentCount).fill(0);
  const segmentUy = new Array(segmentCount).fill(0);

  let firstSegmentIndex = -1;
  let lastSegmentIndex = -1;
  for (let i = 0; i < segmentCount; i++) {
    const start = safePoints[i];
    const end = safePoints[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    segmentLengths[i] = len;
    if (len > 0) {
      segmentUx[i] = dx / len;
      segmentUy[i] = dy / len;
      if (firstSegmentIndex < 0) firstSegmentIndex = i;
      lastSegmentIndex = i;
    }
  }

  const cornerTurns = buildCornerTurns(
    safePoints,
    segmentLengths,
    segmentUx,
    segmentUy,
    halfWidth,
  );

  return {
    safePoints,
    halfWidth,
    startRadius,
    arrowLength,
    endHalfWidth,
    startFlowDirX,
    startFlowDirY,
    hasStartFlowOverride,
    endArrowDirX,
    endArrowDirY,
    hasEndArrowOverride,
    reverseHeadArrowLength,
    reverseHeadArrowHalfWidth,
    reverseTailCircleRadius,
    renderStartCap,
    renderEndCap,
    firstSegmentIndex,
    lastSegmentIndex,
    segmentUx,
    segmentUy,
    cornerTurns,
    flow: buildFlowPrimitives(safePoints, segmentLengths, cornerTurns),
  };
};

const appendQuad = (writer, startPoint, endPoint, radius, travelRange, cornerMeta = null) => {
  const { addVertex, addTriangle } = writer;
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const len = Math.hypot(dx, dy);
  if (len <= FLOW_STOP_EPSILON) return;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * radius;
  const py = ux * radius;
  const vertexCornerMeta = createCornerVertexMeta(cornerMeta);
  const v0 = addVertex(startPoint.x + px, startPoint.y + py, travelRange.start, vertexCornerMeta);
  const v1 = addVertex(startPoint.x - px, startPoint.y - py, travelRange.start, vertexCornerMeta);
  const v2 = addVertex(endPoint.x + px, endPoint.y + py, travelRange.end, vertexCornerMeta);
  const v3 = addVertex(endPoint.x - px, endPoint.y - py, travelRange.end, vertexCornerMeta);
  addTriangle(v0, v1, v2);
  addTriangle(v2, v1, v3);
};

const appendCircle = (writer, center, radius, segments, travelValueOrFn) => {
  const { addVertex, addTriangle } = writer;
  if (radius <= 0) return;

  const stepCount = Math.max(8, Math.trunc(Number(segments)));
  const resolveTravel = typeof travelValueOrFn === 'function'
    ? travelValueOrFn
    : (() => Number(travelValueOrFn) || 0);
  const centerIndex = addVertex(center.x, center.y, resolveTravel(center.x, center.y));
  let previousRimIndex = -1;

  for (let i = 0; i <= stepCount; i++) {
    const unit = i / stepCount;
    const angle = unit * TAU;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    const rimIndex = addVertex(x, y, resolveTravel(x, y));
    if (i > 0) addTriangle(centerIndex, previousRimIndex, rimIndex);
    previousRimIndex = rimIndex;
  }
};

const appendArrowHead = (writer, anchorPoint, direction, length, halfWidth, travelRange) => {
  const { addVertex, addTriangle } = writer;
  const perpX = -direction.uy;
  const perpY = direction.ux;
  const baseCenterShift = length / 3;
  const baseCenterX = anchorPoint.x - (direction.ux * baseCenterShift);
  const baseCenterY = anchorPoint.y - (direction.uy * baseCenterShift);
  const left = addVertex(
    baseCenterX - perpX * halfWidth,
    baseCenterY - perpY * halfWidth,
    travelRange.start,
  );
  const right = addVertex(
    baseCenterX + perpX * halfWidth,
    baseCenterY + perpY * halfWidth,
    travelRange.start,
  );
  const apex = addVertex(
    baseCenterX + direction.ux * length,
    baseCenterY + direction.uy * length,
    travelRange.end,
  );
  addTriangle(apex, left, right);
};

const appendCornerPrimitiveGeometry = (
  writer,
  safePoints,
  cornerTurns,
  halfWidth,
  cornerIndex,
  cornerPrimitive,
) => {
  const { addVertex, addTriangle } = writer;
  const corner = cornerTurns[cornerIndex];
  const base = safePoints[cornerIndex];
  if (!corner || !cornerPrimitive || !base) return;

  const travelStart = cornerPrimitive.travelStart;
  const travelEnd = cornerPrimitive.travelEnd;
  const travelSpan = Math.max(0, travelEnd - travelStart);
  const cornerMeta = createCornerVertexMeta({
    cx: corner.cx,
    cy: corner.cy,
    angleIn: corner.centerAngleIn,
    sweep: corner.centerSweep,
    travelStart,
    travelSpan,
  });

  appendQuad(
    writer,
    { x: corner.tangentInX, y: corner.tangentInY },
    base,
    halfWidth,
    { start: travelStart, end: travelStart },
    cornerMeta,
  );
  appendQuad(
    writer,
    base,
    { x: corner.tangentOutX, y: corner.tangentOutY },
    halfWidth,
    { start: travelStart, end: travelStart },
    cornerMeta,
  );

  const inOuterNx = corner.turnSigned > 0 ? corner.inUy : -corner.inUy;
  const inOuterNy = corner.turnSigned > 0 ? -corner.inUx : corner.inUx;
  const outOuterNx = corner.turnSigned > 0 ? corner.outUy : -corner.outUy;
  const outOuterNy = corner.turnSigned > 0 ? -corner.outUx : corner.outUx;
  const joinAngleIn = Math.atan2(inOuterNy, inOuterNx);
  const joinAngleOut = Math.atan2(outOuterNy, outOuterNx);
  let joinSweep = angleDeltaSigned(joinAngleIn, joinAngleOut);
  if (corner.turnSigned > 0 && joinSweep < 0) joinSweep += TAU;
  if (corner.turnSigned < 0 && joinSweep > 0) joinSweep -= TAU;
  if (Math.abs(joinSweep) <= FLOW_STOP_EPSILON) return;

  const joinSteps = Math.max(2, Math.ceil((Math.abs(joinSweep) / Math.PI) * 18));
  const centerIndex = addVertex(base.x, base.y, travelStart, cornerMeta);
  let previousRimIndex = -1;

  for (let step = 0; step <= joinSteps; step++) {
    const t = step / joinSteps;
    const angle = joinAngleIn + (joinSweep * t);
    const rimX = base.x + Math.cos(angle) * halfWidth;
    const rimY = base.y + Math.sin(angle) * halfWidth;
    const rimIndex = addVertex(rimX, rimY, travelStart, cornerMeta);
    if (step > 0) addTriangle(centerIndex, previousRimIndex, rimIndex);
    previousRimIndex = rimIndex;
  }
};

const resolveDirection = (fallbackUx, fallbackUy, hasOverride, overrideX, overrideY) => {
  if (!hasOverride) return { ux: fallbackUx, uy: fallbackUy };
  const norm = Math.hypot(overrideX, overrideY);
  return { ux: overrideX / norm, uy: overrideY / norm };
};

const createTravelProjector = (origin, direction, baseTravel = 0) => (x, y) => (
  baseTravel
  + ((x - origin.x) * direction.ux)
  + ((y - origin.y) * direction.uy)
);

const buildUnifiedPathMeshGeometry = (build, writer) => {
  const {
    safePoints,
    halfWidth,
    startRadius,
    arrowLength,
    endHalfWidth,
    startFlowDirX,
    startFlowDirY,
    hasStartFlowOverride,
    endArrowDirX,
    endArrowDirY,
    hasEndArrowOverride,
    reverseHeadArrowLength,
    reverseHeadArrowHalfWidth,
    reverseTailCircleRadius,
    renderStartCap,
    renderEndCap,
    firstSegmentIndex,
    lastSegmentIndex,
    segmentUx,
    segmentUy,
    cornerTurns,
    flow,
  } = build;
  const head = safePoints[0];
  const headDirection = resolveDirection(
    firstSegmentIndex >= 0 ? segmentUx[firstSegmentIndex] : 0,
    firstSegmentIndex >= 0 ? segmentUy[firstSegmentIndex] : 0,
    hasStartFlowOverride,
    startFlowDirX,
    startFlowDirY,
  );
  const headTravelAt = createTravelProjector(head, headDirection);

  for (const primitive of flow.linearPrimitives) {
    const i = primitive.segmentIndex;
    const start = safePoints[i];
    const ux = segmentUx[i];
    const uy = segmentUy[i];
    appendQuad(
      writer,
      {
        x: start.x + ux * primitive.localStart,
        y: start.y + uy * primitive.localStart,
      },
      {
        x: start.x + ux * primitive.localEnd,
        y: start.y + uy * primitive.localEnd,
      },
      halfWidth,
      { start: primitive.travelStart, end: primitive.travelEnd },
    );
  }
  for (const cornerPrimitive of flow.cornerPrimitives) {
    appendCornerPrimitiveGeometry(
      writer,
      safePoints,
      cornerTurns,
      halfWidth,
      cornerPrimitive.cornerIndex,
      cornerPrimitive,
    );
  }
  if (renderStartCap) appendCircle(writer, head, startRadius, 18, headTravelAt);
  if (reverseHeadArrowLength > 0 && reverseHeadArrowHalfWidth > 0 && firstSegmentIndex >= 0) {
    appendArrowHead(
      writer,
      head,
      {
        ux: -segmentUx[firstSegmentIndex],
        uy: -segmentUy[firstSegmentIndex],
      },
      reverseHeadArrowLength,
      reverseHeadArrowHalfWidth,
      {
        start: -(reverseHeadArrowLength / 3),
        end: reverseHeadArrowLength - (reverseHeadArrowLength / 3),
      },
    );
  }

  if (lastSegmentIndex >= 0) {
    const tail = safePoints[safePoints.length - 1];
    const tailDirection = resolveDirection(
      segmentUx[lastSegmentIndex],
      segmentUy[lastSegmentIndex],
      hasEndArrowOverride,
      endArrowDirX,
      endArrowDirY,
    );
    const tailTravelAt = createTravelProjector(tail, tailDirection, flow.mainTravel);
    if (renderEndCap) appendCircle(writer, tail, halfWidth, 12, tailTravelAt);
    appendCircle(writer, tail, reverseTailCircleRadius, 18, tailTravelAt);
  }

  if (arrowLength > 0 && endHalfWidth > 0 && lastSegmentIndex >= 0) {
    const tail = safePoints[safePoints.length - 1];
    const tailDirection = resolveDirection(
      segmentUx[lastSegmentIndex],
      segmentUy[lastSegmentIndex],
      hasEndArrowOverride,
      endArrowDirX,
      endArrowDirY,
    );
    appendArrowHead(
      writer,
      tail,
      tailDirection,
      arrowLength,
      endHalfWidth,
      {
        start: flow.mainTravel - (arrowLength / 3),
        end: flow.mainTravel + (arrowLength * (2 / 3)),
      },
    );
  }
};

const createMeshCountWriter = () => {
  let vertexCount = 0;
  let indexCount = 0;
  return {
    addVertex() {
      const index = vertexCount;
      vertexCount += 1;
      return index;
    },
    addTriangle() {
      indexCount += 3;
    },
    finish() {
      return { vertexCount, indexCount };
    },
  };
};

const createFixedMeshStorage = (vertexCount, indexCount) => ({
  positions: new Float32Array(vertexCount * 2),
  travels: new Float32Array(vertexCount),
  cornerFlags: new Float32Array(vertexCount),
  cornerCenters: new Float32Array(vertexCount * 2),
  cornerAngles: new Float32Array(vertexCount * 2),
  cornerTravels: new Float32Array(vertexCount * 2),
  indices: new Uint16Array(indexCount),
  vertexCount: 0,
  indexCount: 0,
  mainTravel: 0,
});

const createMeshFillWriter = (target) => {
  let vertexCount = 0;
  let indexCount = 0;
  return {
    addVertex(x, y, travel, cornerMeta = EMPTY_CORNER_VERTEX_META) {
      const index = vertexCount;
      const vectorOffset = index * 2;
      target.positions[vectorOffset] = x;
      target.positions[vectorOffset + 1] = y;
      target.travels[index] = travel;
      target.cornerFlags[index] = cornerMeta.flag;
      target.cornerCenters[vectorOffset] = cornerMeta.cx;
      target.cornerCenters[vectorOffset + 1] = cornerMeta.cy;
      target.cornerAngles[vectorOffset] = cornerMeta.angleIn;
      target.cornerAngles[vectorOffset + 1] = cornerMeta.sweep;
      target.cornerTravels[vectorOffset] = cornerMeta.travelStart;
      target.cornerTravels[vectorOffset + 1] = cornerMeta.travelSpan;
      vertexCount += 1;
      return index;
    },
    addTriangle(a, b, c) {
      target.indices[indexCount] = a;
      target.indices[indexCount + 1] = b;
      target.indices[indexCount + 2] = c;
      indexCount += 3;
    },
    finish(mainTravel) {
      target.vertexCount = vertexCount;
      target.indexCount = indexCount;
      target.mainTravel = Number(mainTravel) || 0;
      return target;
    },
  };
};

const countUnifiedPathMeshGeometry = (build) => {
  const writer = createMeshCountWriter();
  buildUnifiedPathMeshGeometry(build, writer);
  return writer.finish();
};

const fillUnifiedPathMeshStorage = (build, target) => {
  const writer = createMeshFillWriter(target);
  buildUnifiedPathMeshGeometry(build, writer);
  return writer.finish(build.flow.mainTravel);
};

export function buildUnifiedPathMesh(points, options = {}) {
  const build = createUnifiedPathMeshBuildState(points, options);
  if (!build) return createEmptyMesh();
  const counts = countUnifiedPathMeshGeometry(build);
  return fillUnifiedPathMeshStorage(
    build,
    createFixedMeshStorage(counts.vertexCount, counts.indexCount),
  );
}

const nextPowerOfTwo = (value) => {
  let size = 1;
  const target = Math.max(1, Math.trunc(value));
  while (size < target) size <<= 1;
  return size;
};

const ensureFloatCapacity = (array, minLength) => {
  if (array.length >= minLength) return array;
  return new Float32Array(nextPowerOfTwo(minLength));
};

const ensureIndexCapacity = (array, minLength) => {
  if (array.length >= minLength) return array;
  return new Uint16Array(nextPowerOfTwo(minLength));
};

const createMutableMeshStorage = createMeshStorage;

const resetMutableMeshStorage = (out) => {
  const target = out || createMutableMeshStorage();
  target.vertexCount = 0;
  target.indexCount = 0;
  target.mainTravel = 0;
  return target;
};

const buildUnifiedPathMeshInto = (points, options, out = null) => {
  const build = createUnifiedPathMeshBuildState(points, options || {});
  if (!build) return resetMutableMeshStorage(out);
  const counts = countUnifiedPathMeshGeometry(build);
  const target = out || createMutableMeshStorage();
  target.positions = ensureFloatCapacity(target.positions, counts.vertexCount * 2);
  target.travels = ensureFloatCapacity(target.travels, counts.vertexCount);
  target.cornerFlags = ensureFloatCapacity(target.cornerFlags, counts.vertexCount);
  target.cornerCenters = ensureFloatCapacity(target.cornerCenters, counts.vertexCount * 2);
  target.cornerAngles = ensureFloatCapacity(target.cornerAngles, counts.vertexCount * 2);
  target.cornerTravels = ensureFloatCapacity(target.cornerTravels, counts.vertexCount * 2);
  target.indices = ensureIndexCapacity(target.indices, counts.indexCount);
  return fillUnifiedPathMeshStorage(build, target);
};

const toFiniteCenter = toFinitePoint;
const createMutableBracketStorage = createBracketStorage;

const resetMutableBracketStorage = (out) => {
  const target = out || createMutableBracketStorage();
  target.vertexCount = 0;
  target.indexCount = 0;
  return target;
};

const getSafeBracketCenters = (centers) => {
  if (!Array.isArray(centers) || centers.length === 0) return [];
  return centers
    .map(toFiniteCenter)
    .filter(Boolean);
};

const fillTutorialBracketMeshStorage = (safeCenters, target) => {
  const maxBracketCount = Math.floor(65535 / 4);
  const bracketCount = Math.min(safeCenters.length, maxBracketCount);
  let vertexBase = 0;
  let indexBase = 0;

  for (let i = 0; i < bracketCount; i++) {
    const center = safeCenters[i];
    const vertexOffset = i * 8;
    target.centers[vertexOffset] = center.x;
    target.centers[vertexOffset + 1] = center.y;
    target.centers[vertexOffset + 2] = center.x;
    target.centers[vertexOffset + 3] = center.y;
    target.centers[vertexOffset + 4] = center.x;
    target.centers[vertexOffset + 5] = center.y;
    target.centers[vertexOffset + 6] = center.x;
    target.centers[vertexOffset + 7] = center.y;

    target.corners[vertexOffset] = -1;
    target.corners[vertexOffset + 1] = -1;
    target.corners[vertexOffset + 2] = -1;
    target.corners[vertexOffset + 3] = 1;
    target.corners[vertexOffset + 4] = 1;
    target.corners[vertexOffset + 5] = -1;
    target.corners[vertexOffset + 6] = 1;
    target.corners[vertexOffset + 7] = 1;

    target.indices[indexBase] = vertexBase;
    target.indices[indexBase + 1] = vertexBase + 1;
    target.indices[indexBase + 2] = vertexBase + 2;
    target.indices[indexBase + 3] = vertexBase + 2;
    target.indices[indexBase + 4] = vertexBase + 1;
    target.indices[indexBase + 5] = vertexBase + 3;
    vertexBase += 4;
    indexBase += 6;
  }

  target.vertexCount = bracketCount * 4;
  target.indexCount = bracketCount * 6;
  return target;
};

export const buildTutorialBracketMesh = (centers) => {
  const safeCenters = getSafeBracketCenters(centers);
  if (safeCenters.length === 0) return createEmptyBracketMesh();
  const bracketCount = Math.min(safeCenters.length, Math.floor(65535 / 4));
  return fillTutorialBracketMeshStorage(safeCenters, {
    centers: new Float32Array(bracketCount * 8),
    corners: new Float32Array(bracketCount * 8),
    indices: new Uint16Array(bracketCount * 6),
    vertexCount: 0,
    indexCount: 0,
  });
};

const buildTutorialBracketMeshInto = (centers, out) => {
  const safeCenters = getSafeBracketCenters(centers);
  if (safeCenters.length === 0) return resetMutableBracketStorage(out);
  const bracketCount = Math.min(safeCenters.length, Math.floor(65535 / 4));
  const target = out || createMutableBracketStorage();
  target.centers = ensureFloatCapacity(target.centers, bracketCount * 8);
  target.corners = ensureFloatCapacity(target.corners, bracketCount * 8);
  target.indices = ensureIndexCapacity(target.indices, bracketCount * 6);
  return fillTutorialBracketMeshStorage(safeCenters, target);
};

const createShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to allocate shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const info = gl.getShaderInfoLog(shader) || 'unknown error';
  gl.deleteShader(shader);
  throw new Error(`Shader compile failed: ${info}`);
};

const createProgram = (gl, vertexSource, fragmentSource) => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error('Failed to allocate WebGL program');
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  const info = gl.getProgramInfoLog(program) || 'unknown error';
  gl.deleteProgram(program);
  throw new Error(`Program link failed: ${info}`);
};

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
layout(location = 1) in float aTravel;
layout(location = 2) in float aCornerFlag;
layout(location = 3) in vec2 aCornerCenter;
layout(location = 4) in vec2 aCornerAngle;
layout(location = 5) in vec2 aCornerTravel;
uniform vec2 uCanvasSizePx;
uniform float uDeviceScale;
out float vTravel;
out vec2 vPositionCss;
flat out float vCornerFlag;
flat out vec2 vCornerCenter;
flat out vec2 vCornerAngle;
flat out vec2 vCornerTravel;

void main() {
  vec2 pixel = aPosition * uDeviceScale;
  vec2 clip = vec2(
    (pixel.x / uCanvasSizePx.x) * 2.0 - 1.0,
    1.0 - (pixel.y / uCanvasSizePx.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  vTravel = aTravel;
  vPositionCss = aPosition;
  vCornerFlag = aCornerFlag;
  vCornerCenter = aCornerCenter;
  vCornerAngle = aCornerAngle;
  vCornerTravel = aCornerTravel;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in float vTravel;
in vec2 vPositionCss;
flat in float vCornerFlag;
flat in vec2 vCornerCenter;
flat in vec2 vCornerAngle;
flat in vec2 vCornerTravel;
uniform vec3 uMainColor;
uniform vec3 uCompleteColor;
uniform float uCompletionEnabled;
uniform float uCompletionBoundary;
uniform float uCompletionFeather;
uniform float uCompletionProgress;
uniform float uCompletionThreshold;
uniform float uFlowEnabled;
uniform float uFlowMix;
uniform float uFlowOffset;
uniform float uFlowCycle;
uniform float uFlowPulse;
uniform float uFlowRise;
uniform float uFlowDrop;
uniform float uReverseColorBlend;
uniform float uReverseFromFlowOffset;
uniform float uReverseTravelSpan;
out vec4 outColor;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

float clampUnit(float value) {
  return clamp(value, 0.0, 1.0);
}

float normalizeAngle(float angle) {
  float normalized = mod(angle, TAU);
  return normalized >= 0.0 ? normalized : normalized + TAU;
}

float angleDeltaSigned(float from, float to) {
  float delta = normalizeAngle(to - from);
  return delta > PI ? delta - TAU : delta;
}

float normalizeModulo(float value, float modulus) {
  if (!(modulus > 0.0)) return 0.0;
  float modValue = mod(value, modulus);
  return modValue >= 0.0 ? modValue : modValue + modulus;
}

float resolveTravel(float fallbackTravel) {
  if (vCornerFlag < 0.5) return fallbackTravel;
  float sweep = vCornerAngle.y;
  if (abs(sweep) <= 0.0001) return vCornerTravel.x;

  float angle = atan(
    vPositionCss.y - vCornerCenter.y,
    vPositionCss.x - vCornerCenter.x
  );
  float delta = angleDeltaSigned(vCornerAngle.x, angle);
  float unit = clampUnit(delta / sweep);
  return vCornerTravel.x + unit * vCornerTravel.y;
}

float completionMixAtTravel(float travel) {
  if (uCompletionEnabled < 0.5) return 0.0;
  if (uCompletionProgress >= uCompletionThreshold) return 1.0;

  float feather = max(0.0001, uCompletionFeather);
  float startEdge = uCompletionBoundary - feather * 0.5;
  float endEdge = uCompletionBoundary + feather * 0.5;
  if (travel <= startEdge) return 1.0;
  if (travel >= endEdge) return 0.0;
  return 1.0 - ((travel - startEdge) / (endEdge - startEdge));
}

float flowAlphaAtPhase(float phase, float pulse) {
  if (!(pulse > 0.0) || phase >= pulse) return 0.0;
  float rise = clamp(uFlowRise, 0.001, 0.995);
  float drop = clamp(uFlowDrop, rise + 0.001, 0.999);
  float unit = phase / pulse;

  if (unit <= rise) return unit / rise;
  if (unit <= drop) {
    float t = (unit - rise) / (drop - rise);
    return 1.0 - t;
  }
  return 0.0;
}

float flowAlphaAtTravelWithOffset(float travel, float flowOffset) {
  float phase = normalizeModulo(travel + flowOffset, uFlowCycle);
  return flowAlphaAtPhase(phase, uFlowPulse);
}

vec3 colorAtTravel(float travel, float flowOffset) {
  float completionMix = completionMixAtTravel(travel);
  vec3 color = mix(uMainColor, uCompleteColor, completionMix);

  if (uFlowEnabled > 0.5) {
    float glow = clampUnit(flowAlphaAtTravelWithOffset(travel, flowOffset) * clampUnit(uFlowMix));
    color = mix(color, vec3(1.0), glow);
  }
  return color;
}

void main() {
  float travel = resolveTravel(vTravel);
  vec3 color = colorAtTravel(travel, uFlowOffset);
  if (uReverseColorBlend < 0.9999 && uReverseTravelSpan > 0.0) {
    float reverseTravel = max(0.0, uReverseTravelSpan - travel);
    vec3 reverseColor = colorAtTravel(reverseTravel, uReverseFromFlowOffset);
    color = mix(reverseColor, color, clampUnit(uReverseColorBlend));
  }
  outColor = vec4(color, 1.0);
}
`;

const BRACKET_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCenter;
layout(location = 1) in vec2 aCorner;
uniform vec2 uCanvasSizePx;
uniform float uDeviceScale;
uniform float uHalfSize;
out vec2 vLocalPx;

void main() {
  vec2 positionCss = aCenter + (aCorner * uHalfSize);
  vec2 pixel = positionCss * uDeviceScale;
  vec2 clip = vec2(
    (pixel.x / uCanvasSizePx.x) * 2.0 - 1.0,
    1.0 - (pixel.y / uCanvasSizePx.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  vLocalPx = aCorner * uHalfSize;
}
`;

const BRACKET_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 vLocalPx;
uniform float uCornerAnchor;
uniform float uCornerRadius;
uniform float uCornerThickness;
uniform vec3 uColor;
uniform float uPulse;
out vec4 outColor;

float ringMask(vec2 point, vec2 center, vec2 quadrantSign, float innerRadius, float outerRadius) {
  vec2 delta = point - center;
  float distanceFromCenter = length(delta);
  float aa = max(0.35, fwidth(distanceFromCenter) * 0.95);
  float outerMask = 1.0 - smoothstep(outerRadius - aa, outerRadius + aa, distanceFromCenter);
  float innerMask = smoothstep(innerRadius - aa, innerRadius + aa, distanceFromCenter);
  float quadrantMask = step(0.0, quadrantSign.x * delta.x) * step(0.0, quadrantSign.y * delta.y);
  return innerMask * outerMask * quadrantMask;
}

void main() {
  vec2 point = vLocalPx;
  float outerRadius = max(0.0, uCornerRadius);
  float innerRadius = max(0.0, outerRadius - max(0.0, uCornerThickness));
  float inwardShift = min(uCornerAnchor, (uCornerRadius * 0.16) * uPulse);
  vec2 anchor = vec2(max(0.0, uCornerAnchor - inwardShift));

  float mask = 0.0;
  mask = max(mask, ringMask(point, vec2(-anchor.x, -anchor.y), vec2(-1.0, -1.0), innerRadius, outerRadius));
  mask = max(mask, ringMask(point, vec2(anchor.x, -anchor.y), vec2(1.0, -1.0), innerRadius, outerRadius));
  mask = max(mask, ringMask(point, vec2(-anchor.x, anchor.y), vec2(-1.0, 1.0), innerRadius, outerRadius));
  mask = max(mask, ringMask(point, vec2(anchor.x, anchor.y), vec2(1.0, 1.0), innerRadius, outerRadius));
  if (mask <= 0.001) discard;

  float alpha = (0.88 + (uPulse * 0.12)) * mask;
  vec3 color = mix(uColor, vec3(1.0), 0.14 + (uPulse * 0.18));
  outColor = vec4(color, alpha);
}
`;

const getUniforms = (gl, program) => ({
  canvasSizePx: gl.getUniformLocation(program, 'uCanvasSizePx'),
  deviceScale: gl.getUniformLocation(program, 'uDeviceScale'),
  mainColor: gl.getUniformLocation(program, 'uMainColor'),
  completeColor: gl.getUniformLocation(program, 'uCompleteColor'),
  completionEnabled: gl.getUniformLocation(program, 'uCompletionEnabled'),
  completionBoundary: gl.getUniformLocation(program, 'uCompletionBoundary'),
  completionFeather: gl.getUniformLocation(program, 'uCompletionFeather'),
  completionProgress: gl.getUniformLocation(program, 'uCompletionProgress'),
  completionThreshold: gl.getUniformLocation(program, 'uCompletionThreshold'),
  flowEnabled: gl.getUniformLocation(program, 'uFlowEnabled'),
  flowMix: gl.getUniformLocation(program, 'uFlowMix'),
  flowOffset: gl.getUniformLocation(program, 'uFlowOffset'),
  flowCycle: gl.getUniformLocation(program, 'uFlowCycle'),
  flowPulse: gl.getUniformLocation(program, 'uFlowPulse'),
  flowRise: gl.getUniformLocation(program, 'uFlowRise'),
  flowDrop: gl.getUniformLocation(program, 'uFlowDrop'),
  reverseColorBlend: gl.getUniformLocation(program, 'uReverseColorBlend'),
  reverseFromFlowOffset: gl.getUniformLocation(program, 'uReverseFromFlowOffset'),
  reverseTravelSpan: gl.getUniformLocation(program, 'uReverseTravelSpan'),
});

const getBracketUniforms = (gl, program) => ({
  canvasSizePx: gl.getUniformLocation(program, 'uCanvasSizePx'),
  deviceScale: gl.getUniformLocation(program, 'uDeviceScale'),
  halfSize: gl.getUniformLocation(program, 'uHalfSize'),
  cornerAnchor: gl.getUniformLocation(program, 'uCornerAnchor'),
  cornerRadius: gl.getUniformLocation(program, 'uCornerRadius'),
  cornerThickness: gl.getUniformLocation(program, 'uCornerThickness'),
  color: gl.getUniformLocation(program, 'uColor'),
  pulse: gl.getUniformLocation(program, 'uPulse'),
});

const toRgb01Into = (color, out) => {
  out.r = clampUnit((Number(color?.r) || 0) / 255);
  out.g = clampUnit((Number(color?.g) || 0) / 255);
  out.b = clampUnit((Number(color?.b) || 0) / 255);
  return out;
};

export function createPathWebglRenderer(canvas, options = {}) {
  if (!canvas) throw new Error('Path canvas is required');
  const antialiasEnabled = options.antialias !== false;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: antialiasEnabled,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
  });
  if (!gl) throw new Error('WebGL2 is required for path rendering');

  const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
  const uniforms = getUniforms(gl, program);
  const bracketProgram = createProgram(gl, BRACKET_VERTEX_SHADER_SOURCE, BRACKET_FRAGMENT_SHADER_SOURCE);
  const bracketUniforms = getBracketUniforms(gl, bracketProgram);

  const vao = gl.createVertexArray();
  const positionBuffer = gl.createBuffer();
  const travelBuffer = gl.createBuffer();
  const cornerFlagBuffer = gl.createBuffer();
  const cornerCenterBuffer = gl.createBuffer();
  const cornerAngleBuffer = gl.createBuffer();
  const cornerTravelBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  const bracketVao = gl.createVertexArray();
  const bracketCenterBuffer = gl.createBuffer();
  const bracketCornerBuffer = gl.createBuffer();
  const bracketIndexBuffer = gl.createBuffer();
  if (
    !vao
    || !positionBuffer
    || !travelBuffer
    || !cornerFlagBuffer
    || !cornerCenterBuffer
    || !cornerAngleBuffer
    || !cornerTravelBuffer
    || !indexBuffer
    || !bracketVao
    || !bracketCenterBuffer
    || !bracketCornerBuffer
    || !bracketIndexBuffer
  ) {
    throw new Error('Failed to allocate WebGL buffers');
  }

  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, travelBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, cornerFlagBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, cornerCenterBuffer);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, cornerAngleBuffer);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, cornerTravelBuffer);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);

  gl.bindVertexArray(bracketVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bracketCenterBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bracketCornerBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bracketIndexBuffer);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const isContextLost = () => (
    typeof gl.isContextLost === 'function'
    && gl.isContextLost()
  );

  let deviceScale = 1;
  const reusableMesh = createMutableMeshStorage();
  let geometryCached = false;
  let cachedPointCount = 0;
  let cachedWidth = 0;
  let cachedStartRadius = 0;
  let cachedStartFlowDirX = Number.NaN;
  let cachedStartFlowDirY = Number.NaN;
  let cachedArrowLength = 0;
  let cachedEndHalfWidth = 0;
  let cachedEndArrowDirX = Number.NaN;
  let cachedEndArrowDirY = Number.NaN;
  let cachedReverseHeadArrowLength = 0;
  let cachedReverseHeadArrowHalfWidth = 0;
  let cachedReverseTailCircleRadius = 0;
  let cachedMaxPathPoints = DEFAULT_MAX_PATH_POINTS;
  let cachedGeometryToken = Number.NaN;
  let cachedPoints = new Float32Array(0);
  const reusableRetainedStartArcMesh = createMutableMeshStorage();
  const reusableRetainedEndArcMesh = createMutableMeshStorage();
  let retainedStartArcGeometryCached = false;
  let retainedEndArcGeometryCached = false;
  let cachedRetainedStartArcGeometryToken = Number.NaN;
  let cachedRetainedEndArcGeometryToken = Number.NaN;
  let cachedRetainedStartArcWidth = Number.NaN;
  let cachedRetainedEndArcWidth = Number.NaN;
  let retainedStartArcUsedStartFlowOverride = false;
  let retainedEndArcUsedEndFlowOverride = false;
  let uploadedPathMeshTag = '';
  const reusableBracketMesh = createMutableBracketStorage();
  let bracketGeometryCached = false;
  let cachedBracketPointCount = 0;
  let cachedBracketGeometryToken = Number.NaN;
  let cachedBracketPoints = new Float32Array(0);
  const gpuCapacities = {
    position: 0,
    travel: 0,
    cornerFlag: 0,
    cornerCenter: 0,
    cornerAngle: 0,
    cornerTravel: 0,
    index: 0,
    bracketCenter: 0,
    bracketCorner: 0,
    bracketIndex: 0,
  };
  const uniformCache = {
    canvasWidth: Number.NaN,
    canvasHeight: Number.NaN,
    deviceScale: Number.NaN,
    mainR: Number.NaN,
    mainG: Number.NaN,
    mainB: Number.NaN,
    completeR: Number.NaN,
    completeG: Number.NaN,
    completeB: Number.NaN,
    completionEnabled: Number.NaN,
    completionBoundary: Number.NaN,
    completionFeather: Number.NaN,
    completionProgress: Number.NaN,
    completionThreshold: Number.NaN,
    flowEnabled: Number.NaN,
    flowMix: Number.NaN,
    flowOffset: Number.NaN,
    flowCycle: Number.NaN,
    flowPulse: Number.NaN,
    flowRise: Number.NaN,
    flowDrop: Number.NaN,
    reverseColorBlend: Number.NaN,
    reverseFromFlowOffset: Number.NaN,
    reverseTravelSpan: Number.NaN,
    bracketHalfSize: Number.NaN,
    bracketCornerAnchor: Number.NaN,
    bracketCornerRadius: Number.NaN,
    bracketCornerThickness: Number.NaN,
    bracketPulse: Number.NaN,
    bracketColorR: Number.NaN,
    bracketColorG: Number.NaN,
    bracketColorB: Number.NaN,
  };
  const mainColorScratch = { r: 1, g: 1, b: 1 };
  const completeColorScratch = { r: 1, g: 1, b: 1 };
  const bracketColorScratch = { r: 1, g: 1, b: 1 };

  const setUniform1fCached = (location, key, value) => {
    if (Object.is(uniformCache[key], value)) return;
    gl.uniform1f(location, value);
    uniformCache[key] = value;
  };

  const setUniform2fCached = (location, keyX, keyY, x, y) => {
    if (Object.is(uniformCache[keyX], x) && Object.is(uniformCache[keyY], y)) return;
    gl.uniform2f(location, x, y);
    uniformCache[keyX] = x;
    uniformCache[keyY] = y;
  };

  const setUniform3fCached = (location, keyX, keyY, keyZ, x, y, z) => {
    if (
      Object.is(uniformCache[keyX], x)
      && Object.is(uniformCache[keyY], y)
      && Object.is(uniformCache[keyZ], z)
    ) {
      return;
    }
    gl.uniform3f(location, x, y, z);
    uniformCache[keyX] = x;
    uniformCache[keyY] = y;
    uniformCache[keyZ] = z;
  };

  const scanFinitePoints = (points, maxPointCount, visitor = null) => {
    const limit = Math.min(points.length, maxPointCount);
    let safeIndex = 0;
    for (let i = 0; i < limit; i++) {
      const x = Number(points[i]?.x);
      const y = Number(points[i]?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (visitor) visitor(x, y, safeIndex);
      safeIndex += 1;
    }
    return safeIndex;
  };

  const copyPointSignature = (points, maxPointCount, target) => {
    scanFinitePoints(points, maxPointCount, (x, y, safeIndex) => {
      const base = safeIndex * 2;
      target[base] = x;
      target[base + 1] = y;
    });
  };

  const pointSignatureChanged = (points, maxPointCount, signature) => {
    let changed = false;
    scanFinitePoints(points, maxPointCount, (x, y, safeIndex) => {
      const base = safeIndex * 2;
      if (signature[base] !== x || signature[base + 1] !== y) changed = true;
    });
    return changed;
  };

  const ensurePointSignatureCapacity = (pointCount) => {
    const minLength = pointCount * 2;
    if (cachedPoints.length >= minLength) return;
    cachedPoints = new Float32Array(nextPowerOfTwo(minLength));
  };

  const computeSafePointCount = (points, maxPathPoints) => scanFinitePoints(points, maxPathPoints);

  const hasGeometryChange = (points, geometry) => {
    const pointCount = computeSafePointCount(points, geometry.maxPathPoints);
    const geometrySignatureChanged = (
      !geometryCached
      || cachedPointCount !== pointCount
      || cachedWidth !== geometry.width
      || cachedStartRadius !== geometry.startRadius
      || !Object.is(cachedStartFlowDirX, geometry.startFlowDirX)
      || !Object.is(cachedStartFlowDirY, geometry.startFlowDirY)
      || cachedArrowLength !== geometry.arrowLength
      || cachedEndHalfWidth !== geometry.endHalfWidth
      || !Object.is(cachedEndArrowDirX, geometry.endArrowDirX)
      || !Object.is(cachedEndArrowDirY, geometry.endArrowDirY)
      || cachedReverseHeadArrowLength !== geometry.reverseHeadArrowLength
      || cachedReverseHeadArrowHalfWidth !== geometry.reverseHeadArrowHalfWidth
      || cachedReverseTailCircleRadius !== geometry.reverseTailCircleRadius
      || cachedMaxPathPoints !== geometry.maxPathPoints
    );
    if (geometrySignatureChanged) return true;
    return pointSignatureChanged(points, geometry.maxPathPoints, cachedPoints);
  };

  const updateGeometrySignature = (points, geometry) => {
    const pointCount = computeSafePointCount(points, geometry.maxPathPoints);
    ensurePointSignatureCapacity(pointCount);
    copyPointSignature(points, geometry.maxPathPoints, cachedPoints);
    cachedPointCount = pointCount;
    cachedWidth = geometry.width;
    cachedStartRadius = geometry.startRadius;
    cachedStartFlowDirX = geometry.startFlowDirX;
    cachedStartFlowDirY = geometry.startFlowDirY;
    cachedArrowLength = geometry.arrowLength;
    cachedEndHalfWidth = geometry.endHalfWidth;
    cachedEndArrowDirX = geometry.endArrowDirX;
    cachedEndArrowDirY = geometry.endArrowDirY;
    cachedReverseHeadArrowLength = geometry.reverseHeadArrowLength;
    cachedReverseHeadArrowHalfWidth = geometry.reverseHeadArrowHalfWidth;
    cachedReverseTailCircleRadius = geometry.reverseTailCircleRadius;
    cachedMaxPathPoints = geometry.maxPathPoints;
    geometryCached = true;
  };

  const ensureBracketPointSignatureCapacity = (pointCount) => {
    const minLength = pointCount * 2;
    if (cachedBracketPoints.length >= minLength) return;
    cachedBracketPoints = new Float32Array(nextPowerOfTwo(minLength));
  };

  const computeSafeBracketPointCount = (points) => scanFinitePoints(points, points.length);

  const hasBracketGeometryChange = (points) => {
    const pointCount = computeSafeBracketPointCount(points);
    if (!bracketGeometryCached) return true;
    if (cachedBracketPointCount !== pointCount) return true;
    return pointSignatureChanged(points, points.length, cachedBracketPoints);
  };

  const updateBracketGeometrySignature = (points) => {
    const pointCount = computeSafeBracketPointCount(points);
    ensureBracketPointSignatureCapacity(pointCount);
    copyPointSignature(points, points.length, cachedBracketPoints);
    cachedBracketPointCount = pointCount;
    bracketGeometryCached = true;
  };

  const resolveDirectionOverride = (xValue, yValue) => {
    const x = Number(xValue);
    const y = Number(yValue);
    const hasOverride = Number.isFinite(x)
      && Number.isFinite(y)
      && Math.hypot(x, y) > FLOW_STOP_EPSILON;
    return {
      hasOverride,
      x: hasOverride ? x : Number.NaN,
      y: hasOverride ? y : Number.NaN,
    };
  };

  const createPathGeometryOptions = (frame) => {
    const width = Math.max(1, Number(frame.width) || 1);
    const startFlowOverride = resolveDirectionOverride(frame.startFlowDirX, frame.startFlowDirY);
    const endArrowOverride = resolveDirectionOverride(frame.endArrowDirX, frame.endArrowDirY);
    return {
      width,
      startRadius: Math.max(0, Number(frame.startRadius) || 0),
      startFlowDirX: startFlowOverride.x,
      startFlowDirY: startFlowOverride.y,
      hasStartFlowOverride: startFlowOverride.hasOverride,
      arrowLength: Math.max(0, Number(frame.arrowLength) || 0),
      endHalfWidth: Math.max(0, Number(frame.endHalfWidth) || 0),
      endArrowDirX: endArrowOverride.x,
      endArrowDirY: endArrowOverride.y,
      hasEndArrowOverride: endArrowOverride.hasOverride,
      reverseHeadArrowLength: Math.max(0, Number(frame.reverseHeadArrowLength) || 0),
      reverseHeadArrowHalfWidth: Math.max(0, Number(frame.reverseHeadArrowHalfWidth) || 0),
      reverseTailCircleRadius: Math.max(0, Number(frame.reverseTailCircleRadius) || 0),
      maxPathPoints: Number.isInteger(frame.maxPathPoints) && frame.maxPathPoints > 0
        ? frame.maxPathPoints
        : DEFAULT_MAX_PATH_POINTS,
    };
  };

  const createPathFrameState = (frame) => {
    const points = Array.isArray(frame.points) ? frame.points : [];
    const retainedStartArcPoints = Array.isArray(frame.retainedStartArcPoints)
      ? frame.retainedStartArcPoints
      : [];
    const retainedEndArcPoints = Array.isArray(frame.retainedEndArcPoints)
      ? frame.retainedEndArcPoints
      : [];
    const bracketCenters = Array.isArray(frame.tutorialBracketCenters)
      ? frame.tutorialBracketCenters
      : [];
    const pathGeometry = createPathGeometryOptions(frame);
    const bracketCellSize = Math.max(0, Number(frame.tutorialBracketCellSize) || 0);
    const flowCycle = Math.max(1, Number(frame.flowCycle) || 1);
    const flowPulse = Math.max(1, Math.min(Number(frame.flowPulse) || 1, flowCycle));
    const flowMixRaw = Number(frame.flowMix);
    const reverseColorBlendRaw = Number(frame.reverseColorBlend);
    return {
      frame,
      points,
      retainedStartArcPoints,
      retainedEndArcPoints,
      bracketCenters,
      bracketCellSize,
      hasPathPoints: points.length > 0,
      hasRetainedStartArc: retainedStartArcPoints.length > 1,
      hasRetainedEndArc: retainedEndArcPoints.length > 1,
      hasTutorialBrackets: frame.drawTutorialBracketsInPathLayer === true
        && bracketCellSize > 0
        && bracketCenters.length > 0,
      geometryToken: Number(frame.geometryToken),
      retainedStartArcGeometryToken: Number(frame.retainedStartArcGeometryToken),
      retainedEndArcGeometryToken: Number(frame.retainedEndArcGeometryToken),
      tutorialBracketGeometryToken: Number(frame.tutorialBracketGeometryToken),
      flowCycle,
      flowPulse,
      flowOffset: Number(frame.flowOffset) || 0,
      flowEnabled: frame.flowEnabled ? 1 : 0,
      flowMix: clampUnit(Number.isFinite(flowMixRaw) ? flowMixRaw : 1),
      flowRise: Number.isFinite(frame.flowRise) ? frame.flowRise : 0.82,
      flowDrop: Number.isFinite(frame.flowDrop) ? frame.flowDrop : 0.83,
      reverseColorBlend: clampUnit(
        Number.isFinite(reverseColorBlendRaw) ? reverseColorBlendRaw : 1,
      ),
      reverseFromFlowOffset: Number(frame.reverseFromFlowOffset) || 0,
      reverseTravelSpanFromFrame: Math.max(0, Number(frame.reverseTravelSpan) || 0),
      pathGeometry,
      retainedStartArcWidth: Math.max(
        0.5,
        Number(frame.retainedStartArcWidth) || pathGeometry.width,
      ),
      retainedEndArcWidth: Math.max(
        0.5,
        Number(frame.retainedEndArcWidth) || pathGeometry.width,
      ),
    };
  };

  const clearPathMesh = (mesh) => {
    mesh.vertexCount = 0;
    mesh.indexCount = 0;
    mesh.mainTravel = 0;
  };

  const clearBracketMesh = (mesh) => {
    mesh.vertexCount = 0;
    mesh.indexCount = 0;
  };

  const resetMainPathGeometryCache = () => {
    clearPathMesh(reusableMesh);
    geometryCached = false;
    cachedGeometryToken = Number.NaN;
  };

  const resetRetainedStartArcGeometryCache = () => {
    clearPathMesh(reusableRetainedStartArcMesh);
    retainedStartArcGeometryCached = false;
    cachedRetainedStartArcGeometryToken = Number.NaN;
    cachedRetainedStartArcWidth = Number.NaN;
    retainedStartArcUsedStartFlowOverride = false;
  };

  const resetRetainedEndArcGeometryCache = () => {
    clearPathMesh(reusableRetainedEndArcMesh);
    retainedEndArcGeometryCached = false;
    cachedRetainedEndArcGeometryToken = Number.NaN;
    cachedRetainedEndArcWidth = Number.NaN;
    retainedEndArcUsedEndFlowOverride = false;
  };

  const resetBracketGeometryCache = () => {
    clearBracketMesh(reusableBracketMesh);
    bracketGeometryCached = false;
    cachedBracketGeometryToken = Number.NaN;
  };

  const updateMainPathGeometry = (frameState) => {
    if (!frameState.hasPathPoints) {
      resetMainPathGeometryCache();
      return false;
    }

    const hasGeometryToken = Number.isFinite(frameState.geometryToken);
    const geometryChanged = hasGeometryToken
      ? (!geometryCached || cachedGeometryToken !== frameState.geometryToken)
      : hasGeometryChange(frameState.points, frameState.pathGeometry);
    if (!geometryChanged) return false;

    buildUnifiedPathMeshInto(frameState.points, frameState.pathGeometry, reusableMesh);
    updateGeometrySignature(frameState.points, frameState.pathGeometry);
    cachedGeometryToken = hasGeometryToken ? frameState.geometryToken : Number.NaN;
    return true;
  };

  const updateRetainedStartArcGeometry = (frameState) => {
    if (!frameState.hasRetainedStartArc) {
      resetRetainedStartArcGeometryCache();
      return false;
    }

    const hasGeometryToken = Number.isFinite(frameState.retainedStartArcGeometryToken);
    const widthChanged = !Object.is(cachedRetainedStartArcWidth, frameState.retainedStartArcWidth);
    const refreshByDirection = (
      frameState.pathGeometry.hasStartFlowOverride
      || retainedStartArcUsedStartFlowOverride
    );
    let geometryChanged = !hasGeometryToken
      || !retainedStartArcGeometryCached
      || cachedRetainedStartArcGeometryToken !== frameState.retainedStartArcGeometryToken;
    if (refreshByDirection || widthChanged) geometryChanged = true;
    if (!geometryChanged) return false;

    buildUnifiedPathMeshInto(frameState.retainedStartArcPoints, {
      width: frameState.retainedStartArcWidth,
      startRadius: 0,
      startFlowDirX: frameState.pathGeometry.startFlowDirX,
      startFlowDirY: frameState.pathGeometry.startFlowDirY,
      arrowLength: 0,
      endHalfWidth: 0,
      reverseHeadArrowLength: 0,
      reverseHeadArrowHalfWidth: 0,
      reverseTailCircleRadius: 0,
      renderStartCap: false,
      renderEndCap: false,
      maxPathPoints: frameState.pathGeometry.maxPathPoints,
    }, reusableRetainedStartArcMesh);
    cachedRetainedStartArcGeometryToken = hasGeometryToken
      ? frameState.retainedStartArcGeometryToken
      : Number.NaN;
    cachedRetainedStartArcWidth = frameState.retainedStartArcWidth;
    retainedStartArcGeometryCached = true;
    retainedStartArcUsedStartFlowOverride = frameState.pathGeometry.hasStartFlowOverride;
    return true;
  };

  const updateRetainedEndArcGeometry = (frameState) => {
    if (!frameState.hasRetainedEndArc) {
      resetRetainedEndArcGeometryCache();
      return false;
    }

    const hasGeometryToken = Number.isFinite(frameState.retainedEndArcGeometryToken);
    const widthChanged = !Object.is(cachedRetainedEndArcWidth, frameState.retainedEndArcWidth);
    const refreshByDirection = (
      frameState.pathGeometry.hasEndArrowOverride
      || retainedEndArcUsedEndFlowOverride
    );
    let geometryChanged = !hasGeometryToken
      || !retainedEndArcGeometryCached
      || cachedRetainedEndArcGeometryToken !== frameState.retainedEndArcGeometryToken;
    if (refreshByDirection || widthChanged) geometryChanged = true;
    if (!geometryChanged) return false;

    buildUnifiedPathMeshInto(frameState.retainedEndArcPoints, {
      width: frameState.retainedEndArcWidth,
      startRadius: 0,
      arrowLength: 0,
      endHalfWidth: 0,
      endArrowDirX: frameState.pathGeometry.endArrowDirX,
      endArrowDirY: frameState.pathGeometry.endArrowDirY,
      reverseHeadArrowLength: 0,
      reverseHeadArrowHalfWidth: 0,
      reverseTailCircleRadius: 0,
      renderStartCap: false,
      renderEndCap: false,
      maxPathPoints: frameState.pathGeometry.maxPathPoints,
    }, reusableRetainedEndArcMesh);
    cachedRetainedEndArcGeometryToken = hasGeometryToken
      ? frameState.retainedEndArcGeometryToken
      : Number.NaN;
    cachedRetainedEndArcWidth = frameState.retainedEndArcWidth;
    retainedEndArcGeometryCached = true;
    retainedEndArcUsedEndFlowOverride = frameState.pathGeometry.hasEndArrowOverride;
    return true;
  };

  const updateTutorialBracketGeometry = (frameState) => {
    if (!frameState.hasTutorialBrackets) {
      resetBracketGeometryCache();
      return false;
    }

    const hasBracketGeometryToken = Number.isFinite(frameState.tutorialBracketGeometryToken);
    const geometryChanged = hasBracketGeometryToken
      ? (!bracketGeometryCached || cachedBracketGeometryToken !== frameState.tutorialBracketGeometryToken)
      : hasBracketGeometryChange(frameState.bracketCenters);
    if (!geometryChanged) return false;

    buildTutorialBracketMeshInto(frameState.bracketCenters, reusableBracketMesh);
    updateBracketGeometrySignature(frameState.bracketCenters);
    cachedBracketGeometryToken = hasBracketGeometryToken
      ? frameState.tutorialBracketGeometryToken
      : Number.NaN;
    return true;
  };

  const ensureGpuCapacity = (kind, target, requiredBytes) => {
    const required = Math.max(0, Math.trunc(requiredBytes));
    if (required <= gpuCapacities[kind]) return;
    const nextCapacity = nextPowerOfTwo(required);
    gl.bufferData(target, nextCapacity, gl.DYNAMIC_DRAW);
    gpuCapacities[kind] = nextCapacity;
  };

  const uploadMeshToGpu = (mesh) => {
    const vertexCount = mesh.vertexCount;
    const indexCount = mesh.indexCount;
    const positionsLength = vertexCount * 2;
    const centersLength = vertexCount * 2;
    const anglesLength = vertexCount * 2;
    const cornerTravelsLength = vertexCount * 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    ensureGpuCapacity('position', gl.ARRAY_BUFFER, positionsLength * FLOAT_BYTES);
    if (positionsLength > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.positions, 0, positionsLength);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, travelBuffer);
    ensureGpuCapacity('travel', gl.ARRAY_BUFFER, vertexCount * FLOAT_BYTES);
    if (vertexCount > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.travels, 0, vertexCount);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, cornerFlagBuffer);
    ensureGpuCapacity('cornerFlag', gl.ARRAY_BUFFER, vertexCount * FLOAT_BYTES);
    if (vertexCount > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.cornerFlags, 0, vertexCount);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, cornerCenterBuffer);
    ensureGpuCapacity('cornerCenter', gl.ARRAY_BUFFER, centersLength * FLOAT_BYTES);
    if (centersLength > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.cornerCenters, 0, centersLength);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, cornerAngleBuffer);
    ensureGpuCapacity('cornerAngle', gl.ARRAY_BUFFER, anglesLength * FLOAT_BYTES);
    if (anglesLength > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.cornerAngles, 0, anglesLength);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, cornerTravelBuffer);
    ensureGpuCapacity('cornerTravel', gl.ARRAY_BUFFER, cornerTravelsLength * FLOAT_BYTES);
    if (cornerTravelsLength > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.cornerTravels, 0, cornerTravelsLength);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    ensureGpuCapacity('index', gl.ELEMENT_ARRAY_BUFFER, indexCount * UINT16_BYTES);
    if (indexCount > 0) {
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh.indices, 0, indexCount);
    }
  };

  const uploadTutorialBracketMeshToGpu = (mesh) => {
    const vertexCount = mesh.vertexCount;
    const indexCount = mesh.indexCount;
    const centersLength = vertexCount * 2;
    const cornersLength = vertexCount * 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, bracketCenterBuffer);
    ensureGpuCapacity('bracketCenter', gl.ARRAY_BUFFER, centersLength * FLOAT_BYTES);
    if (centersLength > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.centers, 0, centersLength);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, bracketCornerBuffer);
    ensureGpuCapacity('bracketCorner', gl.ARRAY_BUFFER, cornersLength * FLOAT_BYTES);
    if (cornersLength > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.corners, 0, cornersLength);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bracketIndexBuffer);
    ensureGpuCapacity('bracketIndex', gl.ELEMENT_ARRAY_BUFFER, indexCount * UINT16_BYTES);
    if (indexCount > 0) {
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh.indices, 0, indexCount);
    }
  };

  const clear = () => {
    if (isContextLost()) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const resize = (cssWidth, cssHeight, dpr = 1) => {
    if (isContextLost()) return;
    const {
      safeDpr,
      safeCssWidth,
      safeCssHeight,
      pixelWidth,
      pixelHeight,
    } = resolveCanvasSize(cssWidth, cssHeight, dpr);
    deviceScale = safeDpr;

    applyCanvasElementSize(canvas, safeCssWidth, safeCssHeight, pixelWidth, pixelHeight);

    gl.viewport(0, 0, pixelWidth, pixelHeight);
    clear();
  };

  const createPathDrawState = (frameState) => ({
    completionProgress: clampUnit(Number(frameState.frame.completionProgress) || 0),
    completionEnabled: frameState.frame.isCompletionSolved ? 1 : 0,
    completionFeather: Math.max(frameState.pathGeometry.width * 2.2, 14),
    mainColor: toRgb01Into(
      frameState.frame.mainColorRgb || { r: 255, g: 255, b: 255 },
      mainColorScratch,
    ),
    completeColor: toRgb01Into(
      frameState.frame.completeColorRgb || { r: 46, g: 204, b: 113 },
      completeColorScratch,
    ),
  });

  const drawPathMesh = ({
    mesh,
    shouldUpload,
    meshTag,
    frameState,
    drawState,
    tailExtension = 0,
    useFrameReverseSpan = false,
    options = null,
  }) => {
    if (mesh.indexCount <= 0 || mesh.vertexCount <= 0) return;

    const flowEnabledForMesh = options?.disableFlow ? 0 : frameState.flowEnabled;
    const flowMixForMesh = options?.disableFlow ? 0 : frameState.flowMix;
    const flowOffsetForMesh = Number.isFinite(options?.flowOffsetOverride)
      ? options.flowOffsetOverride
      : frameState.flowOffset;
    const reverseColorBlendForMesh = options?.disableReverse ? 1 : frameState.reverseColorBlend;
    const reverseFromFlowOffsetForMesh = options?.disableReverse ? 0 : frameState.reverseFromFlowOffset;
    const completionBoundary = drawState.completionProgress >= COMPLETE_PATH_THRESHOLD
      ? (mesh.mainTravel + Math.max(0, tailExtension))
      : (mesh.mainTravel * drawState.completionProgress);
    const reverseTravelSpan = (
      useFrameReverseSpan && frameState.reverseTravelSpanFromFrame > 0
    ) ? frameState.reverseTravelSpanFromFrame : mesh.mainTravel;

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    if (shouldUpload || uploadedPathMeshTag !== meshTag) {
      uploadMeshToGpu(mesh);
      uploadedPathMeshTag = meshTag;
    }

    setUniform2fCached(uniforms.canvasSizePx, 'canvasWidth', 'canvasHeight', canvas.width, canvas.height);
    setUniform1fCached(uniforms.deviceScale, 'deviceScale', deviceScale);
    setUniform3fCached(
      uniforms.mainColor,
      'mainR',
      'mainG',
      'mainB',
      drawState.mainColor.r,
      drawState.mainColor.g,
      drawState.mainColor.b,
    );
    setUniform3fCached(
      uniforms.completeColor,
      'completeR',
      'completeG',
      'completeB',
      drawState.completeColor.r,
      drawState.completeColor.g,
      drawState.completeColor.b,
    );
    setUniform1fCached(uniforms.completionEnabled, 'completionEnabled', drawState.completionEnabled);
    setUniform1fCached(uniforms.completionBoundary, 'completionBoundary', completionBoundary);
    setUniform1fCached(uniforms.completionFeather, 'completionFeather', drawState.completionFeather);
    setUniform1fCached(uniforms.completionProgress, 'completionProgress', drawState.completionProgress);
    setUniform1fCached(uniforms.completionThreshold, 'completionThreshold', COMPLETE_PATH_THRESHOLD);
    setUniform1fCached(uniforms.flowEnabled, 'flowEnabled', flowEnabledForMesh);
    setUniform1fCached(uniforms.flowMix, 'flowMix', flowMixForMesh);
    setUniform1fCached(uniforms.flowOffset, 'flowOffset', flowOffsetForMesh);
    setUniform1fCached(uniforms.flowCycle, 'flowCycle', frameState.flowCycle);
    setUniform1fCached(uniforms.flowPulse, 'flowPulse', frameState.flowPulse);
    setUniform1fCached(uniforms.flowRise, 'flowRise', frameState.flowRise);
    setUniform1fCached(uniforms.flowDrop, 'flowDrop', frameState.flowDrop);
    setUniform1fCached(uniforms.reverseColorBlend, 'reverseColorBlend', reverseColorBlendForMesh);
    setUniform1fCached(
      uniforms.reverseFromFlowOffset,
      'reverseFromFlowOffset',
      reverseFromFlowOffsetForMesh,
    );
    setUniform1fCached(uniforms.reverseTravelSpan, 'reverseTravelSpan', reverseTravelSpan);

    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  };

  const drawPathMeshes = (frameState, drawState, geometryChanges) => {
    if (frameState.hasRetainedStartArc) {
      drawPathMesh({
        mesh: reusableRetainedStartArcMesh,
        shouldUpload: geometryChanges.retainedStartArc,
        meshTag: 'retainedStart',
        frameState,
        drawState,
        options: { disableReverse: true },
      });
    }
    if (frameState.hasRetainedEndArc) {
      drawPathMesh({
        mesh: reusableRetainedEndArcMesh,
        shouldUpload: geometryChanges.retainedEndArc,
        meshTag: 'retainedEnd',
        frameState,
        drawState,
        options: {
          disableReverse: true,
          flowOffsetOverride: frameState.flowOffset + (Number(reusableMesh.mainTravel) || 0),
        },
      });
    }
    if (frameState.hasPathPoints) {
      drawPathMesh({
        mesh: reusableMesh,
        shouldUpload: geometryChanges.path,
        meshTag: 'main',
        frameState,
        drawState,
        tailExtension: frameState.pathGeometry.arrowLength,
        useFrameReverseSpan: true,
      });
    }
  };

  const drawTutorialBrackets = (frameState, bracketGeometryChanged) => {
    if (
      !frameState.hasTutorialBrackets
      || reusableBracketMesh.indexCount <= 0
      || reusableBracketMesh.vertexCount <= 0
    ) {
      return;
    }

    const bracketColor = toRgb01Into(
      frameState.frame.tutorialBracketColorRgb || { r: 120, g: 190, b: 255 },
      bracketColorScratch,
    );
    const bracketPulseEnabled = frameState.frame.tutorialBracketPulseEnabled ? 1 : 0;
    const flowPhase = frameState.flowOffset % frameState.flowCycle;
    const phaseUnit = ((flowPhase >= 0 ? flowPhase : flowPhase + frameState.flowCycle) / frameState.flowCycle);
    const pulse = bracketPulseEnabled > 0
      ? (0.5 - (0.5 * Math.cos(phaseUnit * TAU * BRACKET_PULSE_CYCLES)))
      : 1;
    const halfSize = frameState.bracketCellSize * 0.5;
    const inset = frameState.bracketCellSize * 0.05;
    const cornerRadius = Math.max(1, (frameState.bracketCellSize * 0.2142857143) - inset);
    const cornerThickness = Math.max(1.2, cornerRadius * 0.31);
    const cornerAnchor = Math.max(0, halfSize - inset - cornerRadius);

    gl.useProgram(bracketProgram);
    gl.bindVertexArray(bracketVao);

    if (bracketGeometryChanged) {
      uploadTutorialBracketMeshToGpu(reusableBracketMesh);
    }

    setUniform2fCached(
      bracketUniforms.canvasSizePx,
      'bracketCanvasWidth',
      'bracketCanvasHeight',
      canvas.width,
      canvas.height,
    );
    setUniform1fCached(bracketUniforms.deviceScale, 'bracketDeviceScale', deviceScale);
    setUniform1fCached(bracketUniforms.halfSize, 'bracketHalfSize', halfSize);
    setUniform1fCached(bracketUniforms.cornerAnchor, 'bracketCornerAnchor', cornerAnchor);
    setUniform1fCached(bracketUniforms.cornerRadius, 'bracketCornerRadius', cornerRadius);
    setUniform1fCached(bracketUniforms.cornerThickness, 'bracketCornerThickness', cornerThickness);
    setUniform3fCached(
      bracketUniforms.color,
      'bracketColorR',
      'bracketColorG',
      'bracketColorB',
      bracketColor.r,
      bracketColor.g,
      bracketColor.b,
    );
    setUniform1fCached(bracketUniforms.pulse, 'bracketPulse', pulse);

    gl.drawElements(gl.TRIANGLES, reusableBracketMesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  };

  const drawPathFrame = (frame = {}) => {
    if (isContextLost()) return 0;

    const frameState = createPathFrameState(frame);
    const geometryChanges = {
      path: updateMainPathGeometry(frameState),
      retainedStartArc: updateRetainedStartArcGeometry(frameState),
      retainedEndArc: updateRetainedEndArcGeometry(frameState),
      bracket: updateTutorialBracketGeometry(frameState),
    };

    if (
      !frameState.hasPathPoints
      && !frameState.hasRetainedStartArc
      && !frameState.hasRetainedEndArc
      && !frameState.hasTutorialBrackets
    ) {
      clear();
      return 0;
    }

    clear();
    const drawState = createPathDrawState(frameState);
    drawPathMeshes(frameState, drawState, geometryChanges);
    drawTutorialBrackets(frameState, geometryChanges.bracket);
    return reusableMesh.mainTravel;
  };

  const destroy = (options = {}) => {
    const releaseContext = options.releaseContext !== false;
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(travelBuffer);
    gl.deleteBuffer(cornerFlagBuffer);
    gl.deleteBuffer(cornerCenterBuffer);
    gl.deleteBuffer(cornerAngleBuffer);
    gl.deleteBuffer(cornerTravelBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteBuffer(bracketCenterBuffer);
    gl.deleteBuffer(bracketCornerBuffer);
    gl.deleteBuffer(bracketIndexBuffer);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(bracketVao);
    gl.deleteProgram(program);
    gl.deleteProgram(bracketProgram);
    const loseContextExt = typeof gl.getExtension === 'function'
      ? gl.getExtension('WEBGL_lose_context')
      : null;
    if (
      releaseContext
      && !isContextLost()
      && loseContextExt
      && typeof loseContextExt.loseContext === 'function'
    ) {
      loseContextExt.loseContext();
    }
  };

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1, window.devicePixelRatio || 1);

  return {
    antialiasEnabled,
    resize,
    clear,
    drawPathFrame,
    destroy,
    isContextLost,
  };
}
