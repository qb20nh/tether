export function createMemoryPersistence(initialState = {}) {
  const state = {
    theme: initialState.theme || 'dark',
    hiddenPanels: {
      guide: Boolean(initialState.hiddenPanels?.guide),
      legend: initialState.hiddenPanels?.legend ?? true,
    },
    campaignProgress: Number.isInteger(initialState.campaignProgress) ? initialState.campaignProgress : 0,
    infiniteProgress: Number.isInteger(initialState.infiniteProgress) ? initialState.infiniteProgress : 0,
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
        sessionBoard: state.sessionBoard
          ? {
            levelIndex: state.sessionBoard.levelIndex,
            path: state.sessionBoard.path.map(([r, c]) => [r, c]),
            movableWalls: Array.isArray(state.sessionBoard.movableWalls)
              ? state.sessionBoard.movableWalls.map(([r, c]) => [r, c])
              : null,
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
      };
    },

    clearSessionBoard() {
      state.sessionBoard = null;
    },
  };
}
