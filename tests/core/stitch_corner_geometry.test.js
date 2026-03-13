import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCornerEventMask,
  buildCornerOrthEdgeRefs,
  buildOrthEdgeSet,
  buildStitchLookups,
  countCornerOrthConnections,
} from '../../src/shared/stitch_corner_geometry.ts';

const edgeKey = (a, b) => {
  const ka = `${a.r},${a.c}`;
  const kb = `${b.r},${b.c}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

test('buildStitchLookups builds both vertex lookup shapes from one source', () => {
  const { stitchSet, stitchReq } = buildStitchLookups([[2, 3]]);

  assert.deepEqual([...stitchSet], ['2,3']);
  assert.deepEqual(stitchReq.get('2,3'), {
    nw: { r: 1, c: 2 },
    ne: { r: 1, c: 3 },
    sw: { r: 2, c: 2 },
    se: { r: 2, c: 3 },
  });
});

test('buildOrthEdgeSet ignores diagonal path segments', () => {
  const orthEdges = buildOrthEdgeSet([
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 1 },
  ], edgeKey);

  assert.deepEqual([...orthEdges].sort(), [
    edgeKey({ r: 0, c: 0 }, { r: 0, c: 1 }),
    edgeKey({ r: 1, c: 1 }, { r: 1, c: 2 }),
  ]);
});

test('corner edge refs, counts, and masks stay in the same N/W/E/S order', () => {
  const refs = buildCornerOrthEdgeRefs(2, 3, edgeKey);

  assert.deepEqual(refs, [
    { edgeKey: edgeKey({ r: 1, c: 2 }, { r: 1, c: 3 }), edgeLabel: 'N' },
    { edgeKey: edgeKey({ r: 1, c: 2 }, { r: 2, c: 2 }), edgeLabel: 'W' },
    { edgeKey: edgeKey({ r: 1, c: 3 }, { r: 2, c: 3 }), edgeLabel: 'E' },
    { edgeKey: edgeKey({ r: 2, c: 2 }, { r: 2, c: 3 }), edgeLabel: 'S' },
  ]);

  const orthEdges = new Set([
    refs[0].edgeKey,
    refs[2].edgeKey,
    refs[3].edgeKey,
    edgeKey({ r: 9, c: 9 }, { r: 9, c: 10 }),
  ]);

  assert.equal(countCornerOrthConnections(2, 3, orthEdges, edgeKey), 3);
  assert.equal(buildCornerEventMask(2, 3, orthEdges, edgeKey), 0b1011);
});
