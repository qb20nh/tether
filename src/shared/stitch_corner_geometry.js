const defaultVertexKeyOf = (vr, vc) => `${vr},${vc}`;

const forEachCornerOrthEdge = (vr, vc, visit) => {
  visit({ r: vr - 1, c: vc - 1 }, { r: vr - 1, c: vc }, 'N', 0);
  visit({ r: vr - 1, c: vc - 1 }, { r: vr, c: vc - 1 }, 'W', 1);
  visit({ r: vr - 1, c: vc }, { r: vr, c: vc }, 'E', 2);
  visit({ r: vr, c: vc - 1 }, { r: vr, c: vc }, 'S', 3);
};

export const isOrthogonalStep = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

export const buildStitchLookups = (stitches, vertexKeyOf = defaultVertexKeyOf) => {
  const stitchSet = new Set();
  const stitchReq = new Map();

  for (const [vr, vc] of stitches) {
    const vertexKey = vertexKeyOf(vr, vc);
    stitchSet.add(vertexKey);
    stitchReq.set(vertexKey, {
      nw: { r: vr - 1, c: vc - 1 },
      ne: { r: vr - 1, c: vc },
      sw: { r: vr, c: vc - 1 },
      se: { r: vr, c: vc },
    });
  }

  return { stitchSet, stitchReq };
};

export const buildOrthEdgeSet = (path, edgeKeyOf) => {
  const edges = new Set();

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (!isOrthogonalStep(a, b)) continue;
    edges.add(edgeKeyOf(a, b));
  }

  return edges;
};

export const countCornerOrthConnections = (vr, vc, orthEdges, edgeKeyOf) => {
  let count = 0;

  forEachCornerOrthEdge(vr, vc, (a, b) => {
    if (orthEdges.has(edgeKeyOf(a, b))) count += 1;
  });

  return count;
};

export const buildCornerOrthEdgeRefs = (vr, vc, edgeKeyOf) => {
  const refs = [];

  forEachCornerOrthEdge(vr, vc, (a, b, edgeLabel) => {
    refs.push({ edgeKey: edgeKeyOf(a, b), edgeLabel });
  });

  return refs;
};

export const buildCornerEventMask = (vr, vc, orthEdges, edgeKeyOf) => {
  let mask = 0;

  forEachCornerOrthEdge(vr, vc, (a, b, _edgeLabel, index) => {
    if (orthEdges.has(edgeKeyOf(a, b))) {
      mask |= 1 << (3 - index);
    }
  });

  return mask;
};
