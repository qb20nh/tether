import { createDomInputAdapter } from './input/dom_input_adapter.js';
import { INTENT_TYPES, GAME_COMMANDS, INTERACTION_UPDATES } from './runtime/intents.js';

export function bindInputHandlers(refs, state, onStateChange = () => { }) {
  const adapter = createDomInputAdapter();

  const runCommandCompat = (commandType, payload = {}) => {
    if (typeof state.dispatch === 'function') {
      return state.dispatch({ type: commandType, payload });
    }

    if (commandType === GAME_COMMANDS.START_OR_STEP) {
      return { changed: state.startOrTryStep(payload.r, payload.c), validate: false, rebuildGrid: false };
    }
    if (commandType === GAME_COMMANDS.START_OR_STEP_FROM_START) {
      return { changed: state.startOrTryStepFromStart(payload.r, payload.c), validate: false, rebuildGrid: false };
    }
    if (commandType === GAME_COMMANDS.FINALIZE_PATH) {
      return {
        changed: Boolean(state.finalizePathAfterPointerUp?.()),
        validate: true,
        rebuildGrid: false,
      };
    }
    if (commandType === GAME_COMMANDS.WALL_MOVE_ATTEMPT) {
      const changed = state.moveWall(payload.from, payload.to);
      return { changed, validate: changed, rebuildGrid: false };
    }
    return { changed: false, validate: false, rebuildGrid: false };
  };

  adapter.bind({
    refs,
    readSnapshot: () => state.getSnapshot(),
    emitIntent: (intent) => {
      if (!intent || !intent.type) return;

      if (intent.type === INTENT_TYPES.GAME_COMMAND) {
        const transition = runCommandCompat(intent.payload.commandType, intent.payload);
        onStateChange(Boolean(transition.validate), {
          rebuildGrid: Boolean(transition.rebuildGrid),
          isPathDragging: false,
          pathDragSide: null,
          pathDragCursor: null,
        });
        return;
      }

      if (intent.type === INTENT_TYPES.INTERACTION_UPDATE) {
        if (intent.payload.updateType === INTERACTION_UPDATES.PATH_DRAG) {
          onStateChange(false, {
            rebuildGrid: false,
            isPathDragging: Boolean(intent.payload.isPathDragging),
            pathDragSide: intent.payload.pathDragSide ?? null,
            pathDragCursor: intent.payload.pathDragCursor ?? null,
          });
        }
      }
    },
  });

  return {
    unbind: () => adapter.unbind(),
  };
}
