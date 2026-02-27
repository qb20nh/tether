const TAU = Math.PI * 2;
const FLOW_STOP_EPSILON = 1e-4;
const COMPLETE_PATH_THRESHOLD = 0.999;
const DEFAULT_MAX_PATH_POINTS = 64;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const UINT16_BYTES = Uint16Array.BYTES_PER_ELEMENT;

const clampUnit = (value) => Math.max(0, Math.min(1, value));

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

const createEmptyMesh = () => ({
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

const buildCornerTurns = (points, segmentLengths, segmentUx, segmentUy, cornerRadius) => {
  const cornerTurns = new Array(points.length).fill(null);
  const angleTolerance = 1e-4;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLen = segmentLengths[i - 1];
    const outLen = segmentLengths[i];
    if (inLen <= 0 || outLen <= 0) continue;

    const inUx = segmentUx[i - 1];
    const inUy = segmentUy[i - 1];
    const outUx = segmentUx[i];
    const outUy = segmentUy[i];

    const inAngle = Math.atan2(inUy, inUx);
    const outAngle = Math.atan2(outUy, outUx);
    const headingTurn = angleDeltaSigned(inAngle, outAngle);
    const absTurn = Math.abs(headingTurn);
    if (absTurn <= angleTolerance || absTurn >= Math.PI - angleTolerance) continue;

    const tangentOffset = cornerRadius * Math.tan(absTurn * 0.5);
    if (!(tangentOffset > 0) || !Number.isFinite(tangentOffset)) continue;

    const tangentInX = corner.x - inUx * tangentOffset;
    const tangentInY = corner.y - inUy * tangentOffset;
    const tangentOutX = corner.x + outUx * tangentOffset;
    const tangentOutY = corner.y + outUy * tangentOffset;
    const inNormalX = headingTurn > 0 ? -inUy : inUy;
    const inNormalY = headingTurn > 0 ? inUx : -inUx;
    const cx = tangentInX + inNormalX * cornerRadius;
    const cy = tangentInY + inNormalY * cornerRadius;
    const centerAngleIn = normalizeAngle(Math.atan2(tangentInY - cy, tangentInX - cx));
    const centerAngleOut = normalizeAngle(Math.atan2(tangentOutY - cy, tangentOutX - cx));
    const centerSweep = angleDeltaSigned(centerAngleIn, centerAngleOut);
    const centerSweepAbs = Math.abs(centerSweep);
    if (centerSweepAbs <= angleTolerance) continue;

    cornerTurns[i] = {
      tangentOffset,
      arcLength: Math.max(0, cornerRadius * centerSweepAbs),
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
  }

  return cornerTurns;
};

const buildFlowPrimitives = (points, segmentLengths, cornerTurns) => {
  const linearPrimitives = [];
  const cornerPrimitives = [];
  let flowTravel = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const len = segmentLengths[i];
    if (!(len > 0)) continue;

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

export function buildUnifiedPathMesh(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) return createEmptyMesh();

  const maxPathPoints = Number.isInteger(options.maxPathPoints) && options.maxPathPoints > 0
    ? options.maxPathPoints
    : DEFAULT_MAX_PATH_POINTS;
  const safePoints = points
    .slice(0, maxPathPoints)
    .map(toFinitePoint)
    .filter(Boolean);
  if (safePoints.length === 0) return createEmptyMesh();

  const width = Math.max(1, Number(options.width) || 1);
  const halfWidth = width * 0.5;
  const startRadius = Math.max(0, Number(options.startRadius) || 0);
  const arrowLength = Math.max(0, Number(options.arrowLength) || 0);
  const endHalfWidth = Math.max(0, Number(options.endHalfWidth) || 0);

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
  const flow = buildFlowPrimitives(safePoints, segmentLengths, cornerTurns);
  const cornerByIndex = new Map(flow.cornerPrimitives.map((entry) => [entry.cornerIndex, entry]));

  const positions = [];
  const travels = [];
  const cornerFlags = [];
  const cornerCenters = [];
  const cornerAngles = [];
  const cornerTravels = [];
  const indices = [];

  const addVertex = (
    x,
    y,
    travel,
    cornerFlag = 0,
    cornerCx = 0,
    cornerCy = 0,
    cornerAngleIn = 0,
    cornerSweep = 0,
    cornerTravelStart = 0,
    cornerTravelSpan = 0,
  ) => {
    positions.push(x, y);
    travels.push(travel);
    cornerFlags.push(cornerFlag);
    cornerCenters.push(cornerCx, cornerCy);
    cornerAngles.push(cornerAngleIn, cornerSweep);
    cornerTravels.push(cornerTravelStart, cornerTravelSpan);
    return (travels.length - 1);
  };

  const addTriangle = (a, b, c) => {
    indices.push(a, b, c);
  };

  const addQuad = (
    x1,
    y1,
    x2,
    y2,
    radius,
    tStart,
    tEnd,
    cornerMeta = null,
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (!(len > FLOW_STOP_EPSILON)) return;

    const ux = dx / len;
    const uy = dy / len;
    const px = -uy * radius;
    const py = ux * radius;

    const cornerFlag = cornerMeta ? 1 : 0;
    const cornerCx = cornerMeta?.cx || 0;
    const cornerCy = cornerMeta?.cy || 0;
    const cornerAngleIn = cornerMeta?.angleIn || 0;
    const cornerSweep = cornerMeta?.sweep || 0;
    const cornerTravelStart = cornerMeta?.travelStart || 0;
    const cornerTravelSpan = cornerMeta?.travelSpan || 0;
    const v0 = addVertex(
      x1 + px,
      y1 + py,
      tStart,
      cornerFlag,
      cornerCx,
      cornerCy,
      cornerAngleIn,
      cornerSweep,
      cornerTravelStart,
      cornerTravelSpan,
    );
    const v1 = addVertex(
      x1 - px,
      y1 - py,
      tStart,
      cornerFlag,
      cornerCx,
      cornerCy,
      cornerAngleIn,
      cornerSweep,
      cornerTravelStart,
      cornerTravelSpan,
    );
    const v2 = addVertex(
      x2 + px,
      y2 + py,
      tEnd,
      cornerFlag,
      cornerCx,
      cornerCy,
      cornerAngleIn,
      cornerSweep,
      cornerTravelStart,
      cornerTravelSpan,
    );
    const v3 = addVertex(
      x2 - px,
      y2 - py,
      tEnd,
      cornerFlag,
      cornerCx,
      cornerCy,
      cornerAngleIn,
      cornerSweep,
      cornerTravelStart,
      cornerTravelSpan,
    );
    addTriangle(v0, v1, v2);
    addTriangle(v2, v1, v3);
  };

  const addCircle = (cx, cy, radius, segments, travelValueOrFn) => {
    if (!(radius > 0)) return;

    const stepCount = Math.max(8, Number(segments) | 0);
    const resolveTravel = typeof travelValueOrFn === 'function'
      ? travelValueOrFn
      : (() => Number(travelValueOrFn) || 0);
    const centerIndex = addVertex(cx, cy, resolveTravel(cx, cy));
    let previousRimIndex = -1;

    for (let i = 0; i <= stepCount; i++) {
      const unit = i / stepCount;
      const angle = unit * TAU;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const rimIndex = addVertex(
        x,
        y,
        resolveTravel(x, y),
      );
      if (i > 0) {
        addTriangle(centerIndex, previousRimIndex, rimIndex);
      }
      previousRimIndex = rimIndex;
    }
  };

  const head = safePoints[0];
  const headTravelAt = firstSegmentIndex >= 0
    ? ((x, y) => (
      ((x - head.x) * segmentUx[firstSegmentIndex])
      + ((y - head.y) * segmentUy[firstSegmentIndex])
    ))
    : (() => 0);
  addCircle(head.x, head.y, startRadius, 18, headTravelAt);

  for (const primitive of flow.linearPrimitives) {
    const i = primitive.segmentIndex;
    const start = safePoints[i];
    const ux = segmentUx[i];
    const uy = segmentUy[i];
    const x1 = start.x + ux * primitive.localStart;
    const y1 = start.y + uy * primitive.localStart;
    const x2 = start.x + ux * primitive.localEnd;
    const y2 = start.y + uy * primitive.localEnd;
    addQuad(x1, y1, x2, y2, halfWidth, primitive.travelStart, primitive.travelEnd);

    const cornerPrimitive = cornerByIndex.get(i + 1);
    const corner = cornerTurns[i + 1];
    if (!cornerPrimitive || !corner) continue;

    const travelStart = cornerPrimitive.travelStart;
    const travelEnd = cornerPrimitive.travelEnd;
    const travelSpan = Math.max(0, travelEnd - travelStart);
    const cornerMeta = {
      cx: corner.cx,
      cy: corner.cy,
      angleIn: corner.centerAngleIn,
      sweep: corner.centerSweep,
      travelStart,
      travelSpan,
    };
    const base = safePoints[i + 1];

    addQuad(
      corner.tangentInX,
      corner.tangentInY,
      base.x,
      base.y,
      halfWidth,
      travelStart,
      travelStart,
      cornerMeta,
    );
    addQuad(
      base.x,
      base.y,
      corner.tangentOutX,
      corner.tangentOutY,
      halfWidth,
      travelStart,
      travelStart,
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
    const joinSteps = Math.max(2, Math.ceil((Math.abs(joinSweep) / Math.PI) * 18));
    if (!(Math.abs(joinSweep) > FLOW_STOP_EPSILON)) continue;

    const joinTravel = travelStart;
    const centerIndex = addVertex(
      base.x,
      base.y,
      joinTravel,
      1,
      cornerMeta.cx,
      cornerMeta.cy,
      cornerMeta.angleIn,
      cornerMeta.sweep,
      cornerMeta.travelStart,
      cornerMeta.travelSpan,
    );
    let previousRimIndex = -1;

    for (let step = 0; step <= joinSteps; step++) {
      const t = step / joinSteps;
      const angle = joinAngleIn + (joinSweep * t);
      const rimX = base.x + Math.cos(angle) * halfWidth;
      const rimY = base.y + Math.sin(angle) * halfWidth;
      const rimIndex = addVertex(
        rimX,
        rimY,
        joinTravel,
        1,
        cornerMeta.cx,
        cornerMeta.cy,
        cornerMeta.angleIn,
        cornerMeta.sweep,
        cornerMeta.travelStart,
        cornerMeta.travelSpan,
      );
      if (step > 0) addTriangle(centerIndex, previousRimIndex, rimIndex);
      previousRimIndex = rimIndex;
    }
  }

  if (lastSegmentIndex >= 0) {
    const tail = safePoints[safePoints.length - 1];
    const tailTravelAt = (x, y) => (
      flow.mainTravel
      + ((x - tail.x) * segmentUx[lastSegmentIndex])
      + ((y - tail.y) * segmentUy[lastSegmentIndex])
    );
    addCircle(tail.x, tail.y, halfWidth, 12, tailTravelAt);
  }

  if (arrowLength > 0 && endHalfWidth > 0 && lastSegmentIndex >= 0) {
    const tail = safePoints[safePoints.length - 1];
    const ux = segmentUx[lastSegmentIndex];
    const uy = segmentUy[lastSegmentIndex];
    const perpX = -uy;
    const perpY = ux;
    const apexTravel = flow.mainTravel + arrowLength;

    const left = addVertex(
      tail.x - perpX * endHalfWidth,
      tail.y - perpY * endHalfWidth,
      flow.mainTravel,
    );
    const right = addVertex(
      tail.x + perpX * endHalfWidth,
      tail.y + perpY * endHalfWidth,
      flow.mainTravel,
    );
    const apex = addVertex(
      tail.x + ux * arrowLength,
      tail.y + uy * arrowLength,
      apexTravel,
    );
    addTriangle(apex, left, right);
  }

  return {
    positions: new Float32Array(positions),
    travels: new Float32Array(travels),
    cornerFlags: new Float32Array(cornerFlags),
    cornerCenters: new Float32Array(cornerCenters),
    cornerAngles: new Float32Array(cornerAngles),
    cornerTravels: new Float32Array(cornerTravels),
    indices: new Uint16Array(indices),
    vertexCount: travels.length,
    indexCount: indices.length,
    mainTravel: flow.mainTravel,
  };
}

const nextPowerOfTwo = (value) => {
  let size = 1;
  const target = Math.max(1, value | 0);
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

const createMutableMeshStorage = () => ({
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

const copyIntoMutableMeshStorage = (mesh, out) => {
  const target = out || createMutableMeshStorage();
  const vertexCount = Number(mesh?.vertexCount) || 0;
  const indexCount = Number(mesh?.indexCount) || 0;

  target.positions = ensureFloatCapacity(target.positions, vertexCount * 2);
  target.travels = ensureFloatCapacity(target.travels, vertexCount);
  target.cornerFlags = ensureFloatCapacity(target.cornerFlags, vertexCount);
  target.cornerCenters = ensureFloatCapacity(target.cornerCenters, vertexCount * 2);
  target.cornerAngles = ensureFloatCapacity(target.cornerAngles, vertexCount * 2);
  target.cornerTravels = ensureFloatCapacity(target.cornerTravels, vertexCount * 2);
  target.indices = ensureIndexCapacity(target.indices, indexCount);

  if (vertexCount > 0) {
    target.positions.set(mesh.positions, 0);
    target.travels.set(mesh.travels, 0);
    target.cornerFlags.set(mesh.cornerFlags, 0);
    target.cornerCenters.set(mesh.cornerCenters, 0);
    target.cornerAngles.set(mesh.cornerAngles, 0);
    target.cornerTravels.set(mesh.cornerTravels, 0);
  }
  if (indexCount > 0) {
    target.indices.set(mesh.indices, 0);
  }

  target.vertexCount = vertexCount;
  target.indexCount = indexCount;
  target.mainTravel = Number(mesh?.mainTravel) || 0;
  return target;
};

const buildUnifiedPathMeshInto = (points, options = {}, out) => {
  const mesh = buildUnifiedPathMesh(points, options);
  return copyIntoMutableMeshStorage(mesh, out);
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
uniform float uFlowOffset;
uniform float uFlowCycle;
uniform float uFlowPulse;
uniform float uFlowRise;
uniform float uFlowDrop;
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

float flowAlphaAtTravel(float travel) {
  float phase = normalizeModulo(travel + uFlowOffset, uFlowCycle);
  return flowAlphaAtPhase(phase, uFlowPulse);
}

void main() {
  float travel = resolveTravel(vTravel);
  float completionMix = completionMixAtTravel(travel);
  vec3 color = mix(uMainColor, uCompleteColor, completionMix);

  if (uFlowEnabled > 0.5) {
    float glow = clampUnit(flowAlphaAtTravel(travel));
    color = mix(color, vec3(1.0), glow);
  }

  outColor = vec4(color, 1.0);
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
  flowOffset: gl.getUniformLocation(program, 'uFlowOffset'),
  flowCycle: gl.getUniformLocation(program, 'uFlowCycle'),
  flowPulse: gl.getUniformLocation(program, 'uFlowPulse'),
  flowRise: gl.getUniformLocation(program, 'uFlowRise'),
  flowDrop: gl.getUniformLocation(program, 'uFlowDrop'),
});

const toRgb01Into = (color, out) => {
  out.r = clampUnit((Number(color?.r) || 0) / 255);
  out.g = clampUnit((Number(color?.g) || 0) / 255);
  out.b = clampUnit((Number(color?.b) || 0) / 255);
  return out;
};

export function createPathWebglRenderer(canvas) {
  if (!canvas) throw new Error('Path canvas is required');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
  });
  if (!gl) throw new Error('WebGL2 is required for path rendering');

  const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
  const uniforms = getUniforms(gl, program);

  const vao = gl.createVertexArray();
  const positionBuffer = gl.createBuffer();
  const travelBuffer = gl.createBuffer();
  const cornerFlagBuffer = gl.createBuffer();
  const cornerCenterBuffer = gl.createBuffer();
  const cornerAngleBuffer = gl.createBuffer();
  const cornerTravelBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (
    !vao
    || !positionBuffer
    || !travelBuffer
    || !cornerFlagBuffer
    || !cornerCenterBuffer
    || !cornerAngleBuffer
    || !cornerTravelBuffer
    || !indexBuffer
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

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let deviceScale = 1;
  const reusableMesh = createMutableMeshStorage();
  let geometryCached = false;
  let cachedPointCount = 0;
  let cachedWidth = 0;
  let cachedStartRadius = 0;
  let cachedArrowLength = 0;
  let cachedEndHalfWidth = 0;
  let cachedMaxPathPoints = DEFAULT_MAX_PATH_POINTS;
  let cachedGeometryToken = NaN;
  let cachedPoints = new Float32Array(0);
  const gpuCapacities = {
    position: 0,
    travel: 0,
    cornerFlag: 0,
    cornerCenter: 0,
    cornerAngle: 0,
    cornerTravel: 0,
    index: 0,
  };
  const uniformCache = {
    canvasWidth: NaN,
    canvasHeight: NaN,
    deviceScale: NaN,
    mainR: NaN,
    mainG: NaN,
    mainB: NaN,
    completeR: NaN,
    completeG: NaN,
    completeB: NaN,
    completionEnabled: NaN,
    completionBoundary: NaN,
    completionFeather: NaN,
    completionProgress: NaN,
    completionThreshold: NaN,
    flowEnabled: NaN,
    flowOffset: NaN,
    flowCycle: NaN,
    flowPulse: NaN,
    flowRise: NaN,
    flowDrop: NaN,
  };
  const mainColorScratch = { r: 1, g: 1, b: 1 };
  const completeColorScratch = { r: 1, g: 1, b: 1 };

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

  const ensurePointSignatureCapacity = (pointCount) => {
    const minLength = pointCount * 2;
    if (cachedPoints.length >= minLength) return;
    cachedPoints = new Float32Array(nextPowerOfTwo(minLength));
  };

  const computeSafePointCount = (points, maxPathPoints) => {
    const limit = Math.min(points.length, maxPathPoints);
    let count = 0;
    for (let i = 0; i < limit; i++) {
      const x = Number(points[i]?.x);
      const y = Number(points[i]?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      count += 1;
    }
    return count;
  };

  const hasGeometryChange = (points, width, startRadius, arrowLength, endHalfWidth, maxPathPoints) => {
    const pointCount = computeSafePointCount(points, maxPathPoints);
    if (!geometryCached) return true;
    if (cachedPointCount !== pointCount) return true;
    if (cachedWidth !== width) return true;
    if (cachedStartRadius !== startRadius) return true;
    if (cachedArrowLength !== arrowLength) return true;
    if (cachedEndHalfWidth !== endHalfWidth) return true;
    if (cachedMaxPathPoints !== maxPathPoints) return true;

    let safeIndex = 0;
    const limit = Math.min(points.length, maxPathPoints);
    for (let i = 0; i < limit; i++) {
      const x = Number(points[i]?.x);
      const y = Number(points[i]?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const base = safeIndex * 2;
      if (cachedPoints[base] !== x || cachedPoints[base + 1] !== y) return true;
      safeIndex += 1;
    }
    return false;
  };

  const updateGeometrySignature = (
    points,
    width,
    startRadius,
    arrowLength,
    endHalfWidth,
    maxPathPoints,
  ) => {
    const pointCount = computeSafePointCount(points, maxPathPoints);
    ensurePointSignatureCapacity(pointCount);
    let safeIndex = 0;
    const limit = Math.min(points.length, maxPathPoints);
    for (let i = 0; i < limit; i++) {
      const x = Number(points[i]?.x);
      const y = Number(points[i]?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const base = safeIndex * 2;
      cachedPoints[base] = x;
      cachedPoints[base + 1] = y;
      safeIndex += 1;
    }

    cachedPointCount = pointCount;
    cachedWidth = width;
    cachedStartRadius = startRadius;
    cachedArrowLength = arrowLength;
    cachedEndHalfWidth = endHalfWidth;
    cachedMaxPathPoints = maxPathPoints;
    geometryCached = true;
  };

  const ensureGpuCapacity = (kind, target, requiredBytes) => {
    const required = Math.max(0, requiredBytes | 0);
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

  const clear = () => {
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const resize = (cssWidth, cssHeight, dpr = 1) => {
    const safeCssWidth = Math.max(1, Number(cssWidth) || 1);
    const safeCssHeight = Math.max(1, Number(cssHeight) || 1);
    const safeDpr = Math.max(1, Number(dpr) || 1);
    deviceScale = safeDpr;

    const pixelWidth = Math.max(1, Math.round(safeCssWidth * safeDpr));
    const pixelHeight = Math.max(1, Math.round(safeCssHeight * safeDpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const cssWidthPx = `${safeCssWidth}px`;
    const cssHeightPx = `${safeCssHeight}px`;
    if (canvas.style.width !== cssWidthPx) canvas.style.width = cssWidthPx;
    if (canvas.style.height !== cssHeightPx) canvas.style.height = cssHeightPx;

    gl.viewport(0, 0, pixelWidth, pixelHeight);
    clear();
  };

  const drawPathFrame = (frame = {}) => {
    const points = Array.isArray(frame.points) ? frame.points : [];
    if (points.length === 0) {
      clear();
      reusableMesh.vertexCount = 0;
      reusableMesh.indexCount = 0;
      reusableMesh.mainTravel = 0;
      geometryCached = false;
      cachedGeometryToken = NaN;
      return 0;
    }

    const width = Math.max(1, Number(frame.width) || 1);
    const startRadius = Math.max(0, Number(frame.startRadius) || 0);
    const arrowLength = Math.max(0, Number(frame.arrowLength) || 0);
    const endHalfWidth = Math.max(0, Number(frame.endHalfWidth) || 0);
    const maxPathPoints = Number.isInteger(frame.maxPathPoints) && frame.maxPathPoints > 0
      ? frame.maxPathPoints
      : DEFAULT_MAX_PATH_POINTS;
    const nextGeometryToken = Number(frame.geometryToken);
    const hasGeometryToken = Number.isFinite(nextGeometryToken);
    const geometryChanged = hasGeometryToken
      ? (!geometryCached || cachedGeometryToken !== nextGeometryToken)
      : hasGeometryChange(
        points,
        width,
        startRadius,
        arrowLength,
        endHalfWidth,
        maxPathPoints,
      );
    if (geometryChanged) {
      buildUnifiedPathMeshInto(points, {
        width,
        startRadius,
        arrowLength,
        endHalfWidth,
        maxPathPoints,
      }, reusableMesh);
      updateGeometrySignature(
        points,
        width,
        startRadius,
        arrowLength,
        endHalfWidth,
        maxPathPoints,
      );
      if (hasGeometryToken) {
        cachedGeometryToken = nextGeometryToken;
      } else {
        cachedGeometryToken = NaN;
      }
    }

    clear();
    if (reusableMesh.indexCount === 0 || reusableMesh.vertexCount === 0) {
      return reusableMesh.mainTravel;
    }

    const completionProgress = clampUnit(Number(frame.completionProgress) || 0);
    const completionEnabled = frame.isCompletionSolved ? 1 : 0;
    const completionBoundary = completionProgress >= COMPLETE_PATH_THRESHOLD
      ? (reusableMesh.mainTravel + arrowLength)
      : (reusableMesh.mainTravel * completionProgress);
    const completionFeather = Math.max(width * 2.2, 14);

    const flowCycle = Math.max(1, Number(frame.flowCycle) || 1);
    const flowPulse = Math.max(1, Math.min(Number(frame.flowPulse) || 1, flowCycle));
    const flowOffset = Number(frame.flowOffset) || 0;
    const flowEnabled = frame.flowEnabled ? 1 : 0;
    const flowRise = Number.isFinite(frame.flowRise) ? frame.flowRise : 0.82;
    const flowDrop = Number.isFinite(frame.flowDrop) ? frame.flowDrop : 0.83;

    const mainColor = toRgb01Into(frame.mainColorRgb || { r: 255, g: 255, b: 255 }, mainColorScratch);
    const completeColor = toRgb01Into(
      frame.completeColorRgb || { r: 46, g: 204, b: 113 },
      completeColorScratch,
    );

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    if (geometryChanged) {
      uploadMeshToGpu(reusableMesh);
    }

    setUniform2fCached(uniforms.canvasSizePx, 'canvasWidth', 'canvasHeight', canvas.width, canvas.height);
    setUniform1fCached(uniforms.deviceScale, 'deviceScale', deviceScale);
    setUniform3fCached(
      uniforms.mainColor,
      'mainR',
      'mainG',
      'mainB',
      mainColor.r,
      mainColor.g,
      mainColor.b,
    );
    setUniform3fCached(
      uniforms.completeColor,
      'completeR',
      'completeG',
      'completeB',
      completeColor.r,
      completeColor.g,
      completeColor.b,
    );
    setUniform1fCached(uniforms.completionEnabled, 'completionEnabled', completionEnabled);
    setUniform1fCached(uniforms.completionBoundary, 'completionBoundary', completionBoundary);
    setUniform1fCached(uniforms.completionFeather, 'completionFeather', completionFeather);
    setUniform1fCached(uniforms.completionProgress, 'completionProgress', completionProgress);
    setUniform1fCached(uniforms.completionThreshold, 'completionThreshold', COMPLETE_PATH_THRESHOLD);
    setUniform1fCached(uniforms.flowEnabled, 'flowEnabled', flowEnabled);
    setUniform1fCached(uniforms.flowOffset, 'flowOffset', flowOffset);
    setUniform1fCached(uniforms.flowCycle, 'flowCycle', flowCycle);
    setUniform1fCached(uniforms.flowPulse, 'flowPulse', flowPulse);
    setUniform1fCached(uniforms.flowRise, 'flowRise', flowRise);
    setUniform1fCached(uniforms.flowDrop, 'flowDrop', flowDrop);

    gl.drawElements(gl.TRIANGLES, reusableMesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    return reusableMesh.mainTravel;
  };

  const destroy = () => {
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(travelBuffer);
    gl.deleteBuffer(cornerFlagBuffer);
    gl.deleteBuffer(cornerCenterBuffer);
    gl.deleteBuffer(cornerAngleBuffer);
    gl.deleteBuffer(cornerTravelBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  };

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1, window.devicePixelRatio || 1);

  return {
    resize,
    clear,
    drawPathFrame,
    destroy,
  };
}
