import { normalizeScoreState } from '../runtime/score_manager.ts';
import type {
  BootState,
  PersistencePort,
  RuntimeData,
  SessionBoardState,
} from '../contracts/ports.ts';

const normalizeScoreStateTyped = normalizeScoreState as (value: unknown) => RuntimeData;
const readInteger = (value: unknown, fallback = 0): number =>
  Number.isInteger(value) ? value as number : fallback;

interface CreateMemoryPersistenceOptions {
  dailyAbsIndex?: number | null;
  activeDailyId?: string | null;
}

export function createMemoryPersistence(
  initialState: Partial<BootState> = {},
  options: CreateMemoryPersistenceOptions = {},
): PersistencePort {
  const dailyAbsIndex = Number.isInteger(options.dailyAbsIndex) ? options.dailyAbsIndex : null;
  const activeDailyId = typeof options.activeDailyId === 'string' && options.activeDailyId.length > 0
    ? options.activeDailyId
    : null;

  const state = {
    theme: initialState.theme || 'dark',
    lowPowerModeEnabled: Boolean(initialState.lowPowerModeEnabled),
    keyboardGamepadControlsEnabled: Boolean(initialState.keyboardGamepadControlsEnabled),
    hiddenPanels: {
      guide: Boolean(initialState.hiddenPanels?.guide),
      legend: initialState.hiddenPanels?.legend ?? true,
    },
    campaignProgress: readInteger(initialState.campaignProgress),
    infiniteProgress: readInteger(initialState.infiniteProgress),
    dailySolvedDate: typeof initialState.dailySolvedDate === 'string' ? initialState.dailySolvedDate : null,
    scoreState: normalizeScoreStateTyped(initialState.scoreState),
    sessionBoard: (initialState.sessionBoard || null) as SessionBoardState | null,
  };

  return {
    readBootState() {
      return {
        theme: state.theme,
        lowPowerModeEnabled: state.lowPowerModeEnabled,
        keyboardGamepadControlsEnabled: state.keyboardGamepadControlsEnabled,
        hiddenPanels: {
          guide: state.hiddenPanels.guide,
          legend: state.hiddenPanels.legend,
        },
        campaignProgress: state.campaignProgress,
        infiniteProgress: state.infiniteProgress,
        dailySolvedDate: state.dailySolvedDate,
        scoreState: normalizeScoreStateTyped(state.scoreState),
        sessionBoard: state.sessionBoard
          ? {
            levelIndex: state.sessionBoard.levelIndex,
            path: state.sessionBoard.path.map(([r, c]) => [r, c]),
            movableWalls: Array.isArray(state.sessionBoard.movableWalls)
              ? state.sessionBoard.movableWalls.map(([r, c]) => [r, c])
              : null,
            dailyId: typeof state.sessionBoard.dailyId === 'string' ? state.sessionBoard.dailyId : null,
          }
          : null,
      };
    },

    writeTheme(theme) {
      state.theme = theme;
    },

    writeLowPowerModeEnabled(enabled) {
      state.lowPowerModeEnabled = Boolean(enabled);
    },

    writeKeyboardGamepadControlsEnabled(enabled) {
      state.keyboardGamepadControlsEnabled = Boolean(enabled);
    },

    writeHiddenPanel(panel, hidden) {
      if (panel !== 'guide' && panel !== 'legend') return;
      state.hiddenPanels[panel] = Boolean(hidden);
    },

    writeCampaignProgress(value) {
      state.campaignProgress = Number.isInteger(value) ? value : state.campaignProgress;
    },

    writeInfiniteProgress(value) {
      state.infiniteProgress = Number.isInteger(value) ? value : state.infiniteProgress;
    },

    writeDailySolvedDate(dailyId) {
      state.dailySolvedDate = typeof dailyId === 'string' ? dailyId : state.dailySolvedDate;
    },

    writeScoreState(scoreState) {
      state.scoreState = normalizeScoreStateTyped(scoreState);
    },

    writeSessionBoard(board) {
      if (!board) {
        state.sessionBoard = null;
        return;
      }
      state.sessionBoard = {
        levelIndex: board.levelIndex,
        path: Array.isArray(board.path) ? board.path.map(([r, c]) => [r, c]) : [],
        movableWalls: Array.isArray(board.movableWalls)
          ? board.movableWalls.map(([r, c]) => [r, c])
          : null,
        dailyId: (
          Number.isInteger(dailyAbsIndex)
          && board.levelIndex === dailyAbsIndex
          && activeDailyId
        )
          ? activeDailyId
          : null,
      };
    },

    clearSessionBoard() {
      state.sessionBoard = null;
    },
  };
}
