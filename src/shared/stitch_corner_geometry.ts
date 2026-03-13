import type {
  GridPoint,
  GridTuple,
  StitchRequirement,
} from '../contracts/ports.ts';

type VertexKeyOf = (vr: number, vc: number) => string;
type EdgeKeyOf = (a: GridPoint, b: GridPoint) => string;
type CornerEdgeVisitor = (
  a: GridPoint,
  b: GridPoint,
  edgeLabel: 'N' | 'W' | 'E' | 'S',
  index: number,
) => void;

const defaultVertexKeyOf: VertexKeyOf = (vr, vc) => `${vr},${vc}`;

const forEachCornerOrthEdge = (vr: number, vc: number, visit: CornerEdgeVisitor): void => {
  visit({ r: vr - 1, c: vc - 1 }, { r: vr - 1, c: vc }, 'N', 0);
  visit({ r: vr - 1, c: vc - 1 }, { r: vr, c: vc - 1 }, 'W', 1);
  visit({ r: vr - 1, c: vc }, { r: vr, c: vc }, 'E', 2);
  visit({ r: vr, c: vc - 1 }, { r: vr, c: vc }, 'S', 3);
};

export const isOrthogonalStep = (a: GridPoint, b: GridPoint): boolean =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

export const buildStitchLookups = (
  stitches: readonly GridTuple[],
  vertexKeyOf: VertexKeyOf = defaultVertexKeyOf,
): {
  stitchSet: Set<string>;
  stitchReq: Map<string, StitchRequirement>;
} => {
  const stitchSet = new Set<string>();
  const stitchReq = new Map<string, StitchRequirement>();

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

export const buildOrthEdgeSet = (path: readonly GridPoint[], edgeKeyOf: EdgeKeyOf): Set<string> => {
  const edges = new Set<string>();

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (!isOrthogonalStep(a, b)) continue;
    edges.add(edgeKeyOf(a, b));
  }

  return edges;
};

export const countCornerOrthConnections = (
  vr: number,
  vc: number,
  orthEdges: ReadonlySet<string>,
  edgeKeyOf: EdgeKeyOf,
): number => {
  let count = 0;

  forEachCornerOrthEdge(vr, vc, (a, b) => {
    if (orthEdges.has(edgeKeyOf(a, b))) count += 1;
  });

  return count;
};

export const buildCornerOrthEdgeRefs = (
  vr: number,
  vc: number,
  edgeKeyOf: EdgeKeyOf,
): Array<{ edgeKey: string; edgeLabel: 'N' | 'W' | 'E' | 'S' }> => {
  const refs: Array<{ edgeKey: string; edgeLabel: 'N' | 'W' | 'E' | 'S' }> = [];

  forEachCornerOrthEdge(vr, vc, (a, b, edgeLabel) => {
    refs.push({ edgeKey: edgeKeyOf(a, b), edgeLabel });
  });

  return refs;
};

export const buildCornerEventMask = (
  vr: number,
  vc: number,
  orthEdges: ReadonlySet<string>,
  edgeKeyOf: EdgeKeyOf,
): number => {
  let mask = 0;

  forEachCornerOrthEdge(vr, vc, (a, b, _edgeLabel, index) => {
    if (orthEdges.has(edgeKeyOf(a, b))) {
      mask |= 1 << (3 - index);
    }
  });

  return mask;
};
