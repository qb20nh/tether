import { normalizeScoreState } from '../runtime/score_manager.js';

export function createMemoryPersistence(initialState = {}, options = {}) {
  const dailyAbsIndex = Number.isInteger(options.dailyAbsIndex) ? options.dailyAbsIndex : null;
  const activeDailyId = typeof options.activeDailyId === 'string' && options.activeDailyId.length > 0
    ? options.activeDailyId
    : null;

  const state = {
    theme: initialState.theme || 'dark',
    hiddenPanels: {
      guide: Boolean(initialState.hiddenPanels?.guide),
      legend: initialState.hiddenPanels?.legend ?? true,
    },
    campaignProgress: Number.isInteger(initialState.campaignProgress) ? initialState.campaignProgress : 0,
    infiniteProgress: Number.isInteger(initialState.infiniteProgress) ? initialState.infiniteProgress : 0,
    dailySolvedDate: typeof initialState.dailySolvedDate === 'string' ? initialState.dailySolvedDate : null,
    scoreState: normalizeScoreState(initialState.scoreState),
    sessionBoard: initialState.sessionBoard || null,
  };

  return {
    readBootState() {
      return {
        theme: state.theme,
        hiddenPanels: {
          guide: state.hiddenPanels.guide,
          legend: state.hiddenPanels.legend,
        },
        campaignProgress: state.campaignProgress,
        infiniteProgress: state.infiniteProgress,
        dailySolvedDate: state.dailySolvedDate,
        scoreState: normalizeScoreState(state.scoreState),
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
      state.scoreState = normalizeScoreState(scoreState);
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
