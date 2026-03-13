import type {
  GridTuple,
  LevelDefinition,
} from './contracts/ports.ts';

const HINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v']);
const RPS_ROTATE = Object.freeze({
  g: 'b',
  b: 'p',
  p: 'g',
});
type RpsCode = keyof typeof RPS_ROTATE;

const TRANSFORMS = Object.freeze([
  { swapAxes: false, mirrorsOrientation: false },
  { swapAxes: true, mirrorsOrientation: false },
  { swapAxes: false, mirrorsOrientation: false },
  { swapAxes: true, mirrorsOrientation: false },
  { swapAxes: false, mirrorsOrientation: true },
  { swapAxes: false, mirrorsOrientation: true },
  { swapAxes: true, mirrorsOrientation: true },
  { swapAxes: true, mirrorsOrientation: true },
]);

const MASK_64 = (1n << 64n) - 1n;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const FINGERPRINT_SEED_A = 0x6a09e667f3bcc909n;
const FINGERPRINT_SEED_B = 0xbb67ae8584caa73bn;

const transformedDimensions = (rows: number, cols: number, transformIndex: number): { rows: number; cols: number } => {
  const transform = TRANSFORMS[transformIndex];
  if (!transform) throw new Error(`Unknown transform index: ${transformIndex}`);
  if (transform.swapAxes) return { rows: cols, cols: rows };
  return { rows, cols };
};

const mapCellCoord = (r: number, c: number, rows: number, cols: number, transformIndex: number): { r: number; c: number } => {
  switch (transformIndex) {
    case 0:
      return { r, c };
    case 1:
      return { r: c, c: rows - 1 - r };
    case 2:
      return { r: rows - 1 - r, c: cols - 1 - c };
    case 3:
      return { r: cols - 1 - c, c: r };
    case 4:
      return { r, c: cols - 1 - c };
    case 5:
      return { r: rows - 1 - r, c };
    case 6:
      return { r: c, c: r };
    case 7:
      return { r: cols - 1 - c, c: rows - 1 - r };
    default:
      throw new Error(`Unknown transform index: ${transformIndex}`);
  }
};

const mapPointCoord = (pr: number, pc: number, rows: number, cols: number, transformIndex: number): { r: number; c: number } => {
  switch (transformIndex) {
    case 0:
      return { r: pr, c: pc };
    case 1:
      return { r: pc, c: rows - pr };
    case 2:
      return { r: rows - pr, c: cols - pc };
    case 3:
      return { r: cols - pc, c: pr };
    case 4:
      return { r: pr, c: cols - pc };
    case 5:
      return { r: rows - pr, c: pc };
    case 6:
      return { r: pc, c: pr };
    case 7:
      return { r: cols - pc, c: rows - pr };
    default:
      throw new Error(`Unknown transform index: ${transformIndex}`);
  }
};

const mapHintCodeForTransform = (ch: string, transformIndex: number): string => {
  const transform = TRANSFORMS[transformIndex];
  if (!transform) return ch;

  let out = ch;
  if (transform.swapAxes) {
    if (out === 'h') out = 'v';
    else if (out === 'v') out = 'h';
  }

  if (transform.mirrorsOrientation) {
    if (out === 'r') out = 'l';
    else if (out === 'l') out = 'r';
  }

  return out;
};

const sortPairs = (pairs: readonly GridTuple[]): GridTuple[] =>
  pairs
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

const sortCornerCounts = (entries: readonly [number, number, number][]): [number, number, number][] =>
  entries
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));

const applyRpsShift = (ch: string, shift: number): string => {
  let out = ch;
  for (let i = 0; i < shift; i++) {
    if (!isRpsCode(out)) break;
    out = RPS_ROTATE[out];
  }
  return out;
};

const serializeShape = (
  gridRows: readonly string[],
  stitches: readonly GridTuple[],
  cornerCounts: readonly [number, number, number][],
  movableCount: number,
): string => {
  const stitchesKey = stitches.map(([vr, vc]) => `${vr},${vc}`).join(';');
  const cornersKey = cornerCounts.map(([vr, vc, count]) => `${vr},${vc},${count}`).join(';');
  return `${gridRows.join('/')}|s:${stitchesKey}|c:${cornersKey}|m:${movableCount}`;
};

const shapeSignatureWithTransform = (level: LevelDefinition, transformIndex: number, rpsShift: number): string => {
  const rows = level.grid.length;
  const cols = rows > 0 ? level.grid[0].length : 0;
  const dims = transformedDimensions(rows, cols, transformIndex);
  const dstGrid = Array.from({ length: dims.rows }, () => new Array(dims.cols).fill('.'));
  let movableCount = 0;

  for (let r = 0; r < rows; r++) {
    const row = level.grid[r];
    for (let c = 0; c < cols; c++) {
      const mapped = mapCellCoord(r, c, rows, cols, transformIndex);
      let out = mapHintCodeForTransform(row[c], transformIndex);
      out = applyRpsShift(out, rpsShift);
      if (out === 'm') {
        movableCount += 1;
        // Movable-wall positions are canonicalized as walls; only movable count is position-agnostic.
        out = '#';
      }
      dstGrid[mapped.r][mapped.c] = out;
    }
  }

  const stitches = sortPairs(
    (level.stitches || []).map(([vr, vc]): GridTuple => {
      const mapped = mapPointCoord(vr, vc, rows, cols, transformIndex);
      return [mapped.r, mapped.c];
    }),
  );
  const cornerCounts = sortCornerCounts(
    (level.cornerCounts || []).map(([vr, vc, count]): [number, number, number] => {
      const mapped = mapPointCoord(vr, vc, rows, cols, transformIndex);
      return [mapped.r, mapped.c, count];
    }),
  );

  return serializeShape(
    dstGrid.map((row) => row.join('')),
    stitches,
    cornerCounts,
    movableCount,
  );
};

export const canonicalConstraintSignature = (level: LevelDefinition): string => {
  const rows = level.grid || [];
  let hasRps = false;
  for (let r = 0; r < rows.length && !hasRps; r++) {
    const row = rows[r];
    for (const element of row) {
      if (element === 'g' || element === 'b' || element === 'p') {
        hasRps = true;
        break;
      }
    }
  }

  let best: string | null = null;
  const shiftLimit = hasRps ? 3 : 1;
  for (let transformIndex = 0; transformIndex < TRANSFORMS.length; transformIndex++) {
    for (let shift = 0; shift < shiftLimit; shift++) {
      const signature = shapeSignatureWithTransform(level, transformIndex, shift);
      if (best === null || signature < best) best = signature;
    }
  }
  return best || '';
};

const fnv1a64 = (input: string, seed: bigint): bigint => {
  let hash = (FNV_OFFSET_BASIS_64 ^ (seed & MASK_64)) & MASK_64;
  for (let i = 0; i < input.length; i++) {
    const code = input.codePointAt(i);
    if (code == null) continue;
    hash ^= BigInt(code & 0xff);
    hash = (hash * FNV_PRIME_64) & MASK_64;
    hash ^= BigInt((code >>> 8) & 0xff);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash & MASK_64;
};

const toHex64 = (value: bigint): string => value.toString(16).padStart(16, '0');

export const canonicalConstraintFingerprint = (level: LevelDefinition) => {
  const signature = canonicalConstraintSignature(level);
  const laneA = fnv1a64(signature, FINGERPRINT_SEED_A);
  const laneB = fnv1a64(signature, FINGERPRINT_SEED_B);
  const laneAHex = toHex64(laneA);
  const laneBHex = toHex64(laneB);
  return {
    signature,
    laneA: laneAHex,
    laneB: laneBHex,
    key: `${laneAHex}${laneBHex}`,
  };
};

export const canonicalConstraintKey = (level: LevelDefinition): string =>
  canonicalConstraintFingerprint(level).key;

export const isHintCode = (ch: string): boolean => HINT_CODES.has(ch);
const isRpsCode = (ch: string): ch is RpsCode => ch === 'g' || ch === 'b' || ch === 'p';
