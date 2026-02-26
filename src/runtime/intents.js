export const INTENT_TYPES = Object.freeze({
  GAME_COMMAND: 'game.command',
  UI_ACTION: 'ui.action',
  INTERACTION_UPDATE: 'interaction.update',
});

export const gameCommandIntent = (commandType, payload = {}) => ({
  type: INTENT_TYPES.GAME_COMMAND,
  payload: {
    commandType,
    ...payload,
  },
});

export const uiActionIntent = (actionType, payload = {}) => ({
  type: INTENT_TYPES.UI_ACTION,
  payload: {
    actionType,
    ...payload,
  },
});

export const interactionIntent = (updateType, payload = {}) => ({
  type: INTENT_TYPES.INTERACTION_UPDATE,
  payload: {
    updateType,
    ...payload,
  },
});

export const GAME_COMMANDS = Object.freeze({
  LOAD_LEVEL: 'level/load',
  START_OR_STEP: 'path/start-or-step',
  START_OR_STEP_FROM_START: 'path/start-or-step-from-start',
  FINALIZE_PATH: 'path/finalize-after-pointer',
  RESET_PATH: 'path/reset',
  REVERSE_PATH: 'path/reverse',
  WALL_MOVE_ATTEMPT: 'wall/move-attempt',
});

export const UI_ACTIONS = Object.freeze({
  LEVEL_SELECT: 'level/select',
  INFINITE_SELECT: 'infinite/select',
  NEXT_LEVEL_CLICK: 'next-level/click',
  PREV_INFINITE_CLICK: 'prev-infinite/click',
  RESET_CLICK: 'reset/click',
  REVERSE_CLICK: 'reverse/click',
  LOCALE_CHANGE: 'locale/change',
  THEME_TOGGLE: 'theme/toggle',
  PANEL_TOGGLE: 'panel/toggle',
  SETTINGS_TOGGLE: 'settings/toggle',
  SETTINGS_CLOSE: 'settings/close',
  DOCUMENT_ESCAPE: 'document/escape',
  THEME_DIALOG_CLOSE: 'theme/dialog-close',
});

export const INTERACTION_UPDATES = Object.freeze({
  PATH_DRAG: 'path-drag',
  WALL_DRAG: 'wall-drag',
  WALL_DROP_TARGET: 'wall-drop-target',
});
