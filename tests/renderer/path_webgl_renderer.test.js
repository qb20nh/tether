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
