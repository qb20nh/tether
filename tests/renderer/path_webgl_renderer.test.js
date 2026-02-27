import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnifiedPathMesh,
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
