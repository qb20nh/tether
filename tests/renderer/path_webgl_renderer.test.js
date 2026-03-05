import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnifiedPathMesh,
  buildTutorialBracketMesh,
  createPathWebglRenderer,
} from '../../src/renderer/path_webgl_renderer.js';

const assertIndexBounds = (mesh) => {
  for (const index of mesh.indices) {
    assert.equal(Number.isInteger(index), true);
    assert.equal(index >= 0, true);
    assert.equal(index < mesh.vertexCount, true);
  }
};

const assertTravelFinite = (mesh) => {
  let minTravel = Infinity;
  let maxTravel = -Infinity;
  for (const travel of mesh.travels) {
    assert.equal(Number.isFinite(travel), true);
    minTravel = Math.min(minTravel, travel);
    maxTravel = Math.max(maxTravel, travel);
  }
  if (mesh.travels.length > 0) {
    assert.equal(minTravel <= maxTravel, true);
  }
};

const createFakeWebgl2 = () => {
  let nextId = 1;
  const counters = {
    bufferData: 0,
    bufferSubData: 0,
    drawElements: 0,
  };
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    DYNAMIC_DRAW: 0x88e8,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    TRIANGLES: 0x0004,
    UNSIGNED_SHORT: 0x1403,
    FLOAT: 0x1406,
    createShader() { return { id: nextId++ }; },
    shaderSource() {},
    compileShader() {},
    getShaderParameter() { return true; },
    getShaderInfoLog() { return ''; },
    deleteShader() {},
    createProgram() { return { id: nextId++ }; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true; },
    getProgramInfoLog() { return ''; },
    deleteProgram() {},
    createVertexArray() { return { id: nextId++ }; },
    createBuffer() { return { id: nextId++ }; },
    bindVertexArray() {},
    bindBuffer() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    disable() {},
    enable() {},
    blendFunc() {},
    clearColor() {},
    clear() {},
    viewport() {},
    useProgram() {},
    bufferData() { counters.bufferData += 1; },
    bufferSubData() { counters.bufferSubData += 1; },
    uniform2f() {},
    uniform1f() {},
    uniform3f() {},
    drawElements() { counters.drawElements += 1; },
    deleteBuffer() {},
    deleteVertexArray() {},
    getUniformLocation() { return { id: nextId++ }; },
  };
  return { gl, counters };
};

test('buildUnifiedPathMesh handles empty and single-point paths', () => {
  const empty = buildUnifiedPathMesh([]);
  assert.equal(empty.vertexCount, 0);
  assert.equal(empty.indexCount, 0);
  assert.equal(empty.mainTravel, 0);

  const onePoint = buildUnifiedPathMesh(
    [{ x: 12, y: 18 }],
    { width: 9, startRadius: 7, arrowLength: 10, endHalfWidth: 6 },
  );
  assert.equal(onePoint.vertexCount > 0, true);
  assert.equal(onePoint.indexCount > 0, true);
  assert.equal(Number.isFinite(onePoint.mainTravel), true);
  assert.equal(onePoint.mainTravel, 0);
  assertIndexBounds(onePoint);
  assertTravelFinite(onePoint);
});

test('buildUnifiedPathMesh emits valid mesh data for multi-segment paths', () => {
  const mesh = buildUnifiedPathMesh(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 80, y: 40 },
    ],
    {
      width: 10,
      startRadius: 8,
      arrowLength: 14,
      endHalfWidth: 8,
      maxPathPoints: 64,
    },
  );

  assert.equal(mesh.vertexCount > 0, true);
  assert.equal(mesh.indexCount > 0, true);
  assert.equal(Number.isFinite(mesh.mainTravel), true);
  assert.equal(mesh.mainTravel > 0, true);
  assert.equal(mesh.positions.length, mesh.vertexCount * 2);
  assert.equal(mesh.travels.length, mesh.vertexCount);
  assertIndexBounds(mesh);
  assertTravelFinite(mesh);
});

test('buildUnifiedPathMesh handles two-point path and keeps indices in range', () => {
  const mesh = buildUnifiedPathMesh(
    [
      { x: 4, y: 6 },
      { x: 44, y: 6 },
    ],
    {
      width: 7,
      startRadius: 6,
      arrowLength: 12,
      endHalfWidth: 7,
    },
  );

  assert.equal(mesh.vertexCount > 0, true);
  assert.equal(mesh.indexCount > 0, true);
  assert.equal(Number.isFinite(mesh.mainTravel), true);
  assert.equal(mesh.mainTravel > 0, true);
  assertIndexBounds(mesh);
  assertTravelFinite(mesh);
});

test('buildUnifiedPathMesh shrinks corner travel when adjacent segment becomes tiny', () => {
  const options = {
    width: 10,
    startRadius: 0,
    arrowLength: 0,
    endHalfWidth: 0,
    renderStartCap: false,
    renderEndCap: false,
  };
  const longTail = buildUnifiedPathMesh(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 1 },
    ],
    options,
  );
  const tinyTail = buildUnifiedPathMesh(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 0.1 },
    ],
    options,
  );
  const straight = buildUnifiedPathMesh(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ],
    options,
  );

  assert.equal(tinyTail.mainTravel < longTail.mainTravel, true);
  assert.equal(tinyTail.mainTravel > straight.mainTravel, true);
  assert.equal(
    (tinyTail.mainTravel - straight.mainTravel) < (longTail.mainTravel - straight.mainTravel),
    true,
  );
});

test('buildUnifiedPathMesh keeps start corner geometry when first segment is tiny', () => {
  const mesh = buildUnifiedPathMesh(
    [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 20 },
    ],
    {
      width: 8,
      startRadius: 0,
      arrowLength: 0,
      endHalfWidth: 0,
      renderStartCap: false,
      renderEndCap: false,
    },
  );

  const hasCornerVertices = mesh.cornerFlags.some((flag) => flag > 0.5);
  assert.equal(hasCornerVertices, true);
});

test('buildUnifiedPathMesh keeps tiny tip-adjacent corner when end cap is rendered', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 2 },
  ];
  const meshWithoutCaps = buildUnifiedPathMesh(points, {
    width: 10,
    startRadius: 0,
    arrowLength: 0,
    endHalfWidth: 0,
    renderStartCap: false,
    renderEndCap: false,
  });
  const meshWithEndCap = buildUnifiedPathMesh(points, {
    width: 10,
    startRadius: 8,
    arrowLength: 12,
    endHalfWidth: 8,
    renderStartCap: true,
    renderEndCap: true,
  });

  const hasCornerWithoutCaps = meshWithoutCaps.cornerFlags.some((flag) => flag > 0.5);
  const hasCornerWithEndCap = meshWithEndCap.cornerFlags.some((flag) => flag > 0.5);
  assert.equal(hasCornerWithoutCaps, true);
  assert.equal(hasCornerWithEndCap, true);
});

test('buildUnifiedPathMesh appends start tip geometry after path body geometry', () => {
  const head = { x: 0, y: 0 };
  const mesh = buildUnifiedPathMesh(
    [
      head,
      { x: 40, y: 0 },
      { x: 40, y: 20 },
    ],
    {
      width: 10,
      startRadius: 8,
      arrowLength: 0,
      endHalfWidth: 0,
      renderStartCap: true,
      renderEndCap: false,
    },
  );

  let headCenterVertexIndex = -1;
  for (let i = 0; i < mesh.vertexCount; i++) {
    if (mesh.positions[i * 2] === head.x && mesh.positions[(i * 2) + 1] === head.y) {
      headCenterVertexIndex = i;
      break;
    }
  }

  assert.equal(headCenterVertexIndex > 0, true);
});

test('buildUnifiedPathMesh honors end arrow direction override', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ];
  const shared = {
    width: 8,
    startRadius: 0,
    arrowLength: 12,
    endHalfWidth: 7,
  };
  const defaultMesh = buildUnifiedPathMesh(points, shared);
  const overrideMesh = buildUnifiedPathMesh(points, {
    ...shared,
    endArrowDirX: 0,
    endArrowDirY: 1,
  });

  const getApexDir = (mesh) => {
    let apexIndex = 0;
    let apexTravel = -Infinity;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const travel = mesh.travels[i];
      if (travel > apexTravel) {
        apexTravel = travel;
        apexIndex = i;
      }
    }
    const tail = points[points.length - 1];
    const x = mesh.positions[apexIndex * 2];
    const y = mesh.positions[(apexIndex * 2) + 1];
    const dx = x - tail.x;
    const dy = y - tail.y;
    const len = Math.hypot(dx, dy);
    return len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  };

  const defaultDir = getApexDir(defaultMesh);
  const overrideDir = getApexDir(overrideMesh);
  assert.equal(defaultDir.x > 0.9, true);
  assert.equal(Math.abs(defaultDir.y) < 0.2, true);
  assert.equal(Math.abs(overrideDir.x) < 0.2, true);
  assert.equal(overrideDir.y > 0.9, true);
});

test('buildUnifiedPathMesh honors start flow direction override', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ];
  const base = {
    width: 8,
    startRadius: 8,
    arrowLength: 0,
    endHalfWidth: 0,
  };
  const defaultMesh = buildUnifiedPathMesh(points, base);
  const overrideMesh = buildUnifiedPathMesh(points, {
    ...base,
    startFlowDirX: 0,
    startFlowDirY: 1,
  });

  const resolveStartCapTravel = (mesh, scoreFn) => {
    const centerX = points[0].x;
    const centerY = points[0].y;
    const radius = base.startRadius;
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions[i * 2];
      const y = mesh.positions[(i * 2) + 1];
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance < radius * 0.7 || distance > radius * 1.15) continue;
      const score = scoreFn(x - centerX, y - centerY);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    assert.equal(bestIndex >= 0, true);
    return mesh.travels[bestIndex];
  };

  const defaultRightRimTravel = resolveStartCapTravel(defaultMesh, (dx, dy) => dx - (Math.abs(dy) * 0.2));
  const overrideRightRimTravel = resolveStartCapTravel(overrideMesh, (dx, dy) => dx - (Math.abs(dy) * 0.2));
  const defaultNearVerticalTravel = resolveStartCapTravel(
    defaultMesh,
    (dx, dy) => (dx >= 0 ? 1 : -1e6) + (dy * 10) - Math.abs(dx),
  );
  const overrideNearVerticalTravel = resolveStartCapTravel(
    overrideMesh,
    (dx, dy) => (dx >= 0 ? 1 : -1e6) + (dy * 10) - Math.abs(dx),
  );

  assert.equal(defaultRightRimTravel > 6, true);
  assert.equal(Math.abs(overrideRightRimTravel) < 3, true);
  assert.equal(Math.abs(defaultNearVerticalTravel) < 3, true);
  assert.equal(Math.abs(overrideNearVerticalTravel) > 6, true);
});

test('buildUnifiedPathMesh applies end direction override to tail flow orientation', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ];
  const base = {
    width: 8,
    startRadius: 0,
    arrowLength: 0,
    endHalfWidth: 0,
  };
  const defaultMesh = buildUnifiedPathMesh(points, base);
  const overrideMesh = buildUnifiedPathMesh(points, {
    ...base,
    endArrowDirX: 0,
    endArrowDirY: 1,
  });

  const tailRightRimIndex = 5;
  assert.equal(defaultMesh.travels[tailRightRimIndex] - overrideMesh.travels[tailRightRimIndex] > 2, true);
});

test('buildTutorialBracketMesh handles empty and finite points', () => {
  const empty = buildTutorialBracketMesh([]);
  assert.equal(empty.vertexCount, 0);
  assert.equal(empty.indexCount, 0);

  const mesh = buildTutorialBracketMesh([
    { x: 12, y: 18 },
    { x: 48, y: 54 },
    { x: Number.NaN, y: 10 },
  ]);
  assert.equal(mesh.vertexCount, 8);
  assert.equal(mesh.indexCount, 12);
  assert.equal(mesh.centers.length, 16);
  assert.equal(mesh.corners.length, 16);
  assertIndexBounds(mesh);
});

test('createPathWebglRenderer throws when WebGL2 is unavailable', () => {
  const fakeCanvas = {
    getContext(kind) {
      if (kind === 'webgl2') return null;
      return null;
    },
  };

  assert.throws(() => {
    createPathWebglRenderer(fakeCanvas);
  }, /WebGL2 is required for path rendering/);
});

test('createPathWebglRenderer skips geometry uploads when geometry is unchanged', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const fake = createFakeWebgl2();
    const fakeCanvas = {
      width: 0,
      height: 0,
      clientWidth: 100,
      clientHeight: 100,
      style: {},
      getContext(kind) {
        if (kind === 'webgl2') return fake.gl;
        return null;
      },
    };

    const renderer = createPathWebglRenderer(fakeCanvas);
    const frame = {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
      ],
      width: 10,
      startRadius: 8,
      arrowLength: 12,
      endHalfWidth: 8,
      mainColorRgb: { r: 255, g: 255, b: 255 },
      completeColorRgb: { r: 10, g: 220, b: 100 },
      flowEnabled: true,
      flowOffset: 0,
      flowCycle: 128,
      flowPulse: 64,
    };

    renderer.drawPathFrame(frame);
    const uploadCountAfterFirst = fake.counters.bufferSubData;
    renderer.drawPathFrame(frame);
    const uploadCountAfterSecond = fake.counters.bufferSubData;
    assert.equal(uploadCountAfterSecond, uploadCountAfterFirst);

    renderer.drawPathFrame({
      ...frame,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
      ],
    });
    assert.equal(fake.counters.bufferSubData > uploadCountAfterSecond, true);
    renderer.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('createPathWebglRenderer does not reupload geometry when only flowMix changes', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const fake = createFakeWebgl2();
    const fakeCanvas = {
      width: 0,
      height: 0,
      clientWidth: 100,
      clientHeight: 100,
      style: {},
      getContext(kind) {
        if (kind === 'webgl2') return fake.gl;
        return null;
      },
    };

    const renderer = createPathWebglRenderer(fakeCanvas);
    const frame = {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
      ],
      width: 10,
      startRadius: 8,
      arrowLength: 12,
      endHalfWidth: 8,
      mainColorRgb: { r: 255, g: 255, b: 255 },
      completeColorRgb: { r: 10, g: 220, b: 100 },
      flowEnabled: true,
      flowMix: 1,
      flowOffset: 0,
      flowCycle: 128,
      flowPulse: 64,
    };

    renderer.drawPathFrame(frame);
    const uploadCountAfterFirst = fake.counters.bufferSubData;
    renderer.drawPathFrame({
      ...frame,
      flowMix: 0.25,
    });
    const uploadCountAfterSecond = fake.counters.bufferSubData;

    assert.equal(uploadCountAfterSecond, uploadCountAfterFirst);
    renderer.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('createPathWebglRenderer draws and reuses retained arc geometry with stable token', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const fake = createFakeWebgl2();
    const fakeCanvas = {
      width: 0,
      height: 0,
      clientWidth: 100,
      clientHeight: 100,
      style: {},
      getContext(kind) {
        if (kind === 'webgl2') return fake.gl;
        return null;
      },
    };

    const renderer = createPathWebglRenderer(fakeCanvas);
    const frame = {
      points: [],
      retainedStartArcPoints: [
        { x: 20, y: 20 },
        { x: 30, y: 12 },
        { x: 40, y: 20 },
      ],
      retainedStartArcGeometryToken: 17,
      width: 10,
      startRadius: 0,
      arrowLength: 0,
      endHalfWidth: 0,
      mainColorRgb: { r: 255, g: 255, b: 255 },
      completeColorRgb: { r: 10, g: 220, b: 100 },
      flowEnabled: true,
      flowMix: 1,
      flowOffset: 0,
      flowCycle: 128,
      flowPulse: 64,
    };

    renderer.drawPathFrame(frame);
    const drawCountAfterFirst = fake.counters.drawElements;
    const uploadCountAfterFirst = fake.counters.bufferSubData;
    assert.equal(drawCountAfterFirst > 0, true);

    renderer.drawPathFrame(frame);
    const drawCountAfterSecond = fake.counters.drawElements;
    const uploadCountAfterSecond = fake.counters.bufferSubData;
    assert.equal(drawCountAfterSecond > drawCountAfterFirst, true);
    assert.equal(uploadCountAfterSecond, uploadCountAfterFirst);

    renderer.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('createPathWebglRenderer uploads one-point geometry when startRadius changes with NaN token', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const fake = createFakeWebgl2();
    const fakeCanvas = {
      width: 0,
      height: 0,
      clientWidth: 100,
      clientHeight: 100,
      style: {},
      getContext(kind) {
        if (kind === 'webgl2') return fake.gl;
        return null;
      },
    };

    const renderer = createPathWebglRenderer(fakeCanvas);
    const frame = {
      points: [{ x: 16, y: 16 }],
      geometryToken: Number.NaN,
      width: 10,
      startRadius: 6,
      arrowLength: 0,
      endHalfWidth: 0,
      mainColorRgb: { r: 255, g: 255, b: 255 },
      completeColorRgb: { r: 10, g: 220, b: 100 },
      flowEnabled: false,
      flowOffset: 0,
      flowCycle: 128,
      flowPulse: 64,
    };

    renderer.drawPathFrame(frame);
    const uploadCountAfterFirst = fake.counters.bufferSubData;
    renderer.drawPathFrame({
      ...frame,
      startRadius: 10,
    });
    const uploadCountAfterSecond = fake.counters.bufferSubData;

    assert.equal(uploadCountAfterSecond > uploadCountAfterFirst, true);
    renderer.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('createPathWebglRenderer draws tutorial brackets without a path and reuses bracket geometry', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const fake = createFakeWebgl2();
    const fakeCanvas = {
      width: 0,
      height: 0,
      clientWidth: 120,
      clientHeight: 120,
      style: {},
      getContext(kind) {
        if (kind === 'webgl2') return fake.gl;
        return null;
      },
    };

    const renderer = createPathWebglRenderer(fakeCanvas);
    const frame = {
      points: [],
      drawTutorialBracketsInPathLayer: true,
      tutorialBracketCenters: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 20, y: 80 },
      ],
      tutorialBracketGeometryToken: 4,
      tutorialBracketCellSize: 40,
      tutorialBracketPulseEnabled: true,
      tutorialBracketColorRgb: { r: 120, g: 190, b: 255 },
      flowOffset: 10,
      flowCycle: 128,
    };

    renderer.drawPathFrame(frame);
    const drawCountAfterFirst = fake.counters.drawElements;
    const uploadCountAfterFirst = fake.counters.bufferSubData;
    assert.equal(drawCountAfterFirst > 0, true);

    renderer.drawPathFrame(frame);
    const drawCountAfterSecond = fake.counters.drawElements;
    const uploadCountAfterSecond = fake.counters.bufferSubData;
    assert.equal(drawCountAfterSecond > drawCountAfterFirst, true);
    assert.equal(uploadCountAfterSecond, uploadCountAfterFirst);

    renderer.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});
