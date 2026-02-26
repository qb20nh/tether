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
