const TAU = Math.PI * 2;
const FLOW_STOP_EPSILON = 1e-4;
const COMPLETE_PATH_THRESHOLD = 0.999;
const DEFAULT_MAX_PATH_POINTS = 64;

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
  const indices = [];

  const addVertex = (x, y, travel) => {
    positions.push(x, y);
    travels.push(travel);
    return (travels.length - 1);
  };

  const addTriangle = (a, b, c) => {
    indices.push(a, b, c);
  };

  const addQuad = (x1, y1, x2, y2, radius, tStart, tEnd) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (!(len > FLOW_STOP_EPSILON)) return;

    const ux = dx / len;
    const uy = dy / len;
    const px = -uy * radius;
    const py = ux * radius;

    const v0 = addVertex(x1 + px, y1 + py, tStart);
    const v1 = addVertex(x1 - px, y1 - py, tStart);
    const v2 = addVertex(x2 + px, y2 + py, tEnd);
    const v3 = addVertex(x2 - px, y2 - py, tEnd);
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
    const turnAbs = Math.max(0, corner.absTurn || Math.abs(corner.centerSweep || 0));
    const cornerSteps = Math.max(2, Math.ceil((turnAbs / Math.PI) * 18));
    const outerRadius = width;

    for (let step = 0; step < cornerSteps; step++) {
      const t0 = step / cornerSteps;
      const t1 = (step + 1) / cornerSteps;
      const angle0 = corner.centerAngleIn + (corner.centerSweep * t0);
      const angle1 = corner.centerAngleIn + (corner.centerSweep * t1);
      const travel0 = travelStart + (travelSpan * t0);
      const travel1 = travelStart + (travelSpan * t1);

      const c0 = addVertex(corner.cx, corner.cy, travel0);
      const o0 = addVertex(
        corner.cx + Math.cos(angle0) * outerRadius,
        corner.cy + Math.sin(angle0) * outerRadius,
        travel0,
      );
      const c1 = addVertex(corner.cx, corner.cy, travel1);
      const o1 = addVertex(
        corner.cx + Math.cos(angle1) * outerRadius,
        corner.cy + Math.sin(angle1) * outerRadius,
        travel1,
      );

      addTriangle(c0, o0, o1);
      addTriangle(c0, o1, c1);
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
    indices: new Uint16Array(indices),
    vertexCount: travels.length,
    indexCount: indices.length,
    mainTravel: flow.mainTravel,
  };
}

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
uniform vec2 uCanvasSizePx;
uniform float uDeviceScale;
out float vTravel;

void main() {
  vec2 pixel = aPosition * uDeviceScale;
  vec2 clip = vec2(
    (pixel.x / uCanvasSizePx.x) * 2.0 - 1.0,
    1.0 - (pixel.y / uCanvasSizePx.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  vTravel = aTravel;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in float vTravel;
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

float clampUnit(float value) {
  return clamp(value, 0.0, 1.0);
}

float normalizeModulo(float value, float modulus) {
  if (!(modulus > 0.0)) return 0.0;
  float modValue = mod(value, modulus);
  return modValue >= 0.0 ? modValue : modValue + modulus;
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
  float completionMix = completionMixAtTravel(vTravel);
  vec3 color = mix(uMainColor, uCompleteColor, completionMix);

  if (uFlowEnabled > 0.5) {
    float glow = clampUnit(flowAlphaAtTravel(vTravel));
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

const toRgb01 = (color) => {
  const r = clampUnit((Number(color?.r) || 0) / 255);
  const g = clampUnit((Number(color?.g) || 0) / 255);
  const b = clampUnit((Number(color?.b) || 0) / 255);
  return [r, g, b];
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
  const indexBuffer = gl.createBuffer();
  if (!vao || !positionBuffer || !travelBuffer || !indexBuffer) {
    throw new Error('Failed to allocate WebGL buffers');
  }

  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, travelBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let deviceScale = 1;

  const clear = () => {
    gl.clearColor(0, 0, 0, 0);
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
      return 0;
    }

    const width = Math.max(1, Number(frame.width) || 1);
    const startRadius = Math.max(0, Number(frame.startRadius) || 0);
    const arrowLength = Math.max(0, Number(frame.arrowLength) || 0);
    const endHalfWidth = Math.max(0, Number(frame.endHalfWidth) || 0);
    const mesh = buildUnifiedPathMesh(points, {
      width,
      startRadius,
      arrowLength,
      endHalfWidth,
      maxPathPoints: frame.maxPathPoints || DEFAULT_MAX_PATH_POINTS,
    });

    clear();
    if (mesh.indexCount === 0 || mesh.vertexCount === 0) {
      return mesh.mainTravel;
    }

    const completionProgress = clampUnit(Number(frame.completionProgress) || 0);
    const completionEnabled = frame.isCompletionSolved ? 1 : 0;
    const completionBoundary = completionProgress >= COMPLETE_PATH_THRESHOLD
      ? (mesh.mainTravel + arrowLength)
      : (mesh.mainTravel * completionProgress);
    const completionFeather = Math.max(width * 2.2, 14);

    const flowCycle = Math.max(1, Number(frame.flowCycle) || 1);
    const flowPulse = Math.max(1, Math.min(Number(frame.flowPulse) || 1, flowCycle));
    const flowOffset = Number(frame.flowOffset) || 0;
    const flowEnabled = frame.flowEnabled ? 1 : 0;
    const flowRise = Number.isFinite(frame.flowRise) ? frame.flowRise : 0.82;
    const flowDrop = Number.isFinite(frame.flowDrop) ? frame.flowDrop : 0.83;

    const [mainR, mainG, mainB] = toRgb01(frame.mainColorRgb || { r: 255, g: 255, b: 255 });
    const [doneR, doneG, doneB] = toRgb01(frame.completeColorRgb || { r: 46, g: 204, b: 113 });

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, travelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.travels, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);

    gl.uniform2f(uniforms.canvasSizePx, canvas.width, canvas.height);
    gl.uniform1f(uniforms.deviceScale, deviceScale);
    gl.uniform3f(uniforms.mainColor, mainR, mainG, mainB);
    gl.uniform3f(uniforms.completeColor, doneR, doneG, doneB);
    gl.uniform1f(uniforms.completionEnabled, completionEnabled);
    gl.uniform1f(uniforms.completionBoundary, completionBoundary);
    gl.uniform1f(uniforms.completionFeather, completionFeather);
    gl.uniform1f(uniforms.completionProgress, completionProgress);
    gl.uniform1f(uniforms.completionThreshold, COMPLETE_PATH_THRESHOLD);
    gl.uniform1f(uniforms.flowEnabled, flowEnabled);
    gl.uniform1f(uniforms.flowOffset, flowOffset);
    gl.uniform1f(uniforms.flowCycle, flowCycle);
    gl.uniform1f(uniforms.flowPulse, flowPulse);
    gl.uniform1f(uniforms.flowRise, flowRise);
    gl.uniform1f(uniforms.flowDrop, flowDrop);

    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    return mesh.mainTravel;
  };

  const destroy = () => {
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(travelBuffer);
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
