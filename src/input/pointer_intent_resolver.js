const STITCH_BRIDGE_MIN_HALF_LEN_PX = 2;
const STITCH_BRIDGE_HALF_LEN_CELL_RATIO = 0.18;
const STITCH_BRIDGE_MIN_RADIUS_PX = 1;
const STITCH_BRIDGE_MIN_WIDTH_PX = 1;
const STITCH_BRIDGE_WIDTH_CELL_RATIO = 0.06;
const DEFAULT_CELL_SIZE_PX = 56;

const sameCell = (a, b) =>
  Boolean(a && b && a.r === b.r && a.c === b.c);

const resolveCellSize = (cellSize) => {
  const value = Number(cellSize);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_CELL_SIZE_PX;
};

export function buildPathDragCandidates({
  snapshot,
  headNode,
  backtrackNode,
  isUsableCell,
  isAdjacentMove,
}) {
  if (!snapshot || !headNode) return [];

  const candidates = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = headNode.r + dr;
      const nc = headNode.c + dc;
      if (nr < 0 || nr >= snapshot.rows || nc < 0 || nc >= snapshot.cols) continue;

      const cand = { r: nr, c: nc };
      if (!isAdjacentMove(snapshot, headNode, cand)) continue;
      if (!isUsableCell(snapshot, cand.r, cand.c)) continue;

      const isBacktrack = Boolean(backtrackNode)
        && cand.r === backtrackNode.r
        && cand.c === backtrackNode.c;
      const k = `${cand.r},${cand.c}`;
      if (!isBacktrack && snapshot.visited.has(k)) continue;

      candidates.push({ ...cand, isBacktrack });
    }
  }

  return candidates;
}

export function choosePathDragCell({
  headNode,
  candidates,
  pointer,
  holdCell,
  cellCenter,
  size,
}) {
  if (!headNode || !holdCell || !Array.isArray(candidates) || candidates.length === 0) {
    return holdCell;
  }

  const holdCenter = cellCenter(holdCell.r, holdCell.c);
  const holdDist = Math.hypot(pointer.x - holdCenter.x, pointer.y - holdCenter.y);

  let bestMoveCell = null;
  let bestMoveDist = Infinity;

  for (const cand of candidates) {
    const center = cellCenter(cand.r, cand.c);
    let dist = Math.hypot(pointer.x - center.x, pointer.y - center.y);

    const isDiag = Math.abs(cand.r - headNode.r) === 1 && Math.abs(cand.c - headNode.c) === 1;
    if (isDiag) dist -= size * 0.18;

    if (dist < bestMoveDist) {
      bestMoveDist = dist;
      bestMoveCell = cand;
    }
  }

  if (!bestMoveCell) return holdCell;

  const hysteresis = bestMoveCell.isBacktrack ? size * 0.24 : size * 0.12;
  return bestMoveDist + hysteresis < holdDist
    ? { r: bestMoveCell.r, c: bestMoveCell.c }
    : holdCell;
}

export function chooseSlipperyPathDragStep({
  snapshot,
  headNode,
  backtrackNode,
  pointer,
  rawPointer,
  pointerCell,
  isUsableCell,
  isAdjacentMove,
  cellCenter,
  cellSize,
}) {
  if (!snapshot || !headNode || !pointer || typeof cellCenter !== 'function') return null;

  const headCenter = cellCenter(headNode.r, headNode.c);
  const holdDistance = Math.hypot(pointer.x - headCenter.x, pointer.y - headCenter.y);
  const holdIsPointerCell = sameCell(pointerCell, headNode);
  const resolvedCellSize = resolveCellSize(cellSize);
  const halfLen = Math.max(
    STITCH_BRIDGE_MIN_HALF_LEN_PX,
    resolvedCellSize * STITCH_BRIDGE_HALF_LEN_CELL_RATIO,
  );
  const symbolStrokeWidth = Math.max(
    STITCH_BRIDGE_MIN_WIDTH_PX,
    resolvedCellSize * STITCH_BRIDGE_WIDTH_CELL_RATIO,
  );
  const symbolRadius = Math.max(
    STITCH_BRIDGE_MIN_RADIUS_PX,
    (halfLen * Math.SQRT2) + (symbolStrokeWidth * 0.5),
  );
  const bridgePointer = (
    Number.isFinite(rawPointer?.x) && Number.isFinite(rawPointer?.y)
      ? rawPointer
      : pointer
  );
  const candidate = { r: 0, c: 0 };
  let shouldHold = false;
  let bestR = NaN;
  let bestC = NaN;
  let bestDistance = Infinity;
  let bestIsPointerCell = false;

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = headNode.r + dr;
      const nc = headNode.c + dc;
      if (nr < 0 || nr >= snapshot.rows || nc < 0 || nc >= snapshot.cols) continue;

      candidate.r = nr;
      candidate.c = nc;
      if (!isAdjacentMove(snapshot, headNode, candidate)) continue;
      if (!isUsableCell(snapshot, nr, nc)) continue;

      const isBacktrack = Boolean(backtrackNode)
        && nr === backtrackNode.r
        && nc === backtrackNode.c;
      if (!isBacktrack && snapshot.visited?.has?.(`${nr},${nc}`)) continue;

      const isDiagonal = Math.abs(dr) === 1 && Math.abs(dc) === 1;
      const candidateCenter = cellCenter(nr, nc);
      const candidateCenterX = candidateCenter.x;
      const candidateCenterY = candidateCenter.y;

      if (isDiagonal && snapshot?.stitchSet?.size > 0) {
        const stitchKey = `${Math.max(headNode.r, nr)},${Math.max(headNode.c, nc)}`;
        if (snapshot.stitchSet.has(stitchKey)) {
          const centerX = (headCenter.x + candidateCenterX) * 0.5;
          const centerY = (headCenter.y + candidateCenterY) * 0.5;
          if (Math.hypot(bridgePointer.x - centerX, bridgePointer.y - centerY) <= symbolRadius) {
            shouldHold = true;
            const usesDiagA = dr === dc;
            const bridgeStartX = usesDiagA ? (centerX + halfLen) : (centerX - halfLen);
            const bridgeStartY = centerY - halfLen;
            const bridgeEndX = usesDiagA ? (centerX - halfLen) : (centerX + halfLen);
            const bridgeEndY = centerY + halfLen;
            const headSide = (
              (headCenter.x - bridgeStartX) * (bridgeEndY - bridgeStartY)
              - (headCenter.y - bridgeStartY) * (bridgeEndX - bridgeStartX)
            );
            if (Math.abs(headSide) > 1e-6) {
              const pointerSide = (
                (bridgePointer.x - bridgeStartX) * (bridgeEndY - bridgeStartY)
                - (bridgePointer.y - bridgeStartY) * (bridgeEndX - bridgeStartX)
              );
              if ((headSide * pointerSide) <= 0) {
                return { r: nr, c: nc };
              }
            }
          }
        }
      }

      const distance = Math.hypot(pointer.x - candidateCenterX, pointer.y - candidateCenterY);
      const isPointer = sameCell(pointerCell, candidate);
      const betterDistance = distance < bestDistance - 1e-6;
      const equalDistance = Math.abs(distance - bestDistance) <= 1e-6;
      if (!betterDistance && !(equalDistance && isPointer && !bestIsPointerCell)) continue;

      bestR = nr;
      bestC = nc;
      bestDistance = distance;
      bestIsPointerCell = isPointer;
    }
  }

  if (shouldHold || !Number.isInteger(bestR) || !Number.isInteger(bestC)) return null;
  const equalToHold = Math.abs(bestDistance - holdDistance) <= 1e-6;
  const improves = bestDistance < holdDistance - 1e-6
    || (equalToHold && bestIsPointerCell && !holdIsPointerCell);
  if (!improves) return null;
  return { r: bestR, c: bestC };
}
