import { buildCanonicalSolutionSignature, SCORE_MODES } from './score_manager.ts';
import type {
  CorePort,
  GameSnapshot,
  GridTuple,
  SessionBoardState,
} from '../contracts/ports.ts';

interface ScoreContext {
  mode: string;
  levelKey: string;
}

interface ScoreManagerLike {
  registerSolved: (payload: {
    mode: string;
    levelKey: string;
    signature: string;
  }) => unknown;
}

const buildCanonicalSolutionSignatureTyped = buildCanonicalSolutionSignature as (
  snapshot: GameSnapshot,
) => string | null;

export const resolveScoreContext = (core: CorePort | null | undefined, levelIndex: number): ScoreContext | null => {
  if (!core || !Number.isInteger(levelIndex)) return null;

  if (typeof core.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex)) {
    const dailyId = typeof core.getDailyId === 'function' ? core.getDailyId() : null;
    if (!dailyId) return null;
    return {
      mode: SCORE_MODES.DAILY,
      levelKey: dailyId,
    };
  }

  if (typeof core.isInfiniteAbsIndex !== 'function' || !core.isInfiniteAbsIndex(levelIndex)) {
    return null;
  }

  return {
    mode: SCORE_MODES.INFINITE,
    levelKey: String(core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex))),
  };
};

export const registerSolvedSnapshot = ({
  snapshot,
  core,
  scoreManager,
}: {
  snapshot: GameSnapshot | null | undefined;
  core: CorePort | null | undefined;
  scoreManager: ScoreManagerLike | null | undefined;
}) => {
  if (!snapshot || !core || !scoreManager) return null;
  const context = resolveScoreContext(core, snapshot.levelIndex);
  if (!context) return null;

  const signature = buildCanonicalSolutionSignatureTyped(snapshot);
  if (!signature) return null;

  return scoreManager.registerSolved({
    mode: context.mode,
    levelKey: context.levelKey,
    signature,
  });
};

export const markClearedLevel = ({
  levelIndex,
  core,
  activeDailyId = null,
  dailySolvedDate = null,
  onCampaignCleared = () => {},
  onInfiniteCleared = () => {},
  onDailyCleared = () => {},
}: {
  levelIndex: number;
  core: CorePort;
  activeDailyId?: string | null;
  dailySolvedDate?: string | null;
  onCampaignCleared?: (levelIndex: number) => void;
  onInfiniteCleared?: (infiniteIndex: number) => void;
  onDailyCleared?: (dailyId: string, changedDailySolvedDate: boolean) => void;
}) => {
  let nextDailySolvedDate = dailySolvedDate;
  let changedDailySolvedDate = false;

  if (typeof core?.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex)) {
    if (activeDailyId) {
      nextDailySolvedDate = activeDailyId;
      changedDailySolvedDate = nextDailySolvedDate !== dailySolvedDate;
      onDailyCleared(activeDailyId, changedDailySolvedDate);
    }

    return {
      nextDailySolvedDate,
      changedDailySolvedDate,
    };
  }

  if (typeof core?.isInfiniteAbsIndex === 'function' && core.isInfiniteAbsIndex(levelIndex)) {
    onInfiniteCleared(core.toInfiniteIndex(levelIndex));
    return {
      nextDailySolvedDate,
      changedDailySolvedDate,
    };
  }

  onCampaignCleared(levelIndex);
  return {
    nextDailySolvedDate,
    changedDailySolvedDate,
  };
};

export const collectMovableWalls = (gridData: string[][], movableWallToken = 'm'): GridTuple[] => {
  if (!Array.isArray(gridData)) return [];
  const walls: GridTuple[] = [];
  for (let r = 0; r < gridData.length; r += 1) {
    const row = gridData[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] === movableWallToken) walls.push([r, c]);
    }
  }
  return walls;
};

export const buildSessionBoardFromSnapshot = ({
  snapshot,
  activeDailyId = null,
  isDailyLevelIndex = () => false,
}: {
  snapshot: GameSnapshot | null | undefined;
  activeDailyId?: string | null;
  isDailyLevelIndex?: (levelIndex: number) => boolean;
}) => {
  if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return null;
  if (!Array.isArray(snapshot.path) || !Array.isArray(snapshot.gridData)) return null;

  const sessionBoard: SessionBoardState = {
    levelIndex: snapshot.levelIndex,
    path: snapshot.path.map((point) => [point.r, point.c]),
    movableWalls: collectMovableWalls(snapshot.gridData),
    dailyId: isDailyLevelIndex(snapshot.levelIndex) ? activeDailyId : null,
  };
  return sessionBoard;
};
