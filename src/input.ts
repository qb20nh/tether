// @ts-nocheck
import { createDomInputAdapter } from './input/dom_input_adapter.ts';
import { INTENT_TYPES, GAME_COMMANDS, INTERACTION_UPDATES } from './runtime/intents.ts';

const NO_OP_TRANSITION = Object.freeze({
  changed: false,
  validate: false,
  rebuildGrid: false,
});

const makeCompatTransition = (changed, validate = false) => ({
  changed: Boolean(changed),
  validate: Boolean(validate),
  rebuildGrid: false,
});

const runLegacyPathDragSequence = (state, payload = {}) => {
  if (typeof state.applyPathDragSequence === 'function') {
    return makeCompatTransition(state.applyPathDragSequence(payload.side, payload.steps));
  }

  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const runLegacyStep = payload.side === 'start'
    ? (step) => state.startOrTryStepFromStart(step.r, step.c)
    : (step) => state.startOrTryStep(step.r, step.c);
  let changed = false;

  for (const step of steps) {
    if (!Number.isInteger(step?.r) || !Number.isInteger(step?.c)) break;
    if (!runLegacyStep(step)) break;
    changed = true;
  }

  return makeCompatTransition(changed);
};

const LEGACY_COMMAND_HANDLERS = Object.freeze({
  [GAME_COMMANDS.START_OR_STEP]: (state, payload) => (
    makeCompatTransition(state.startOrTryStep(payload.r, payload.c))
  ),
  [GAME_COMMANDS.START_OR_STEP_FROM_START]: (state, payload) => (
    makeCompatTransition(state.startOrTryStepFromStart(payload.r, payload.c))
  ),
  [GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE]: runLegacyPathDragSequence,
  [GAME_COMMANDS.FINALIZE_PATH]: (state) => (
    makeCompatTransition(state.finalizePathAfterPointerUp?.(), true)
  ),
  [GAME_COMMANDS.WALL_MOVE_ATTEMPT]: (state, payload) => {
    const changed = state.moveWall(payload.from, payload.to);
    return makeCompatTransition(changed, changed);
  },
});

const runLegacyCommandCompat = (state, commandType, payload = {}) => {
  const handler = LEGACY_COMMAND_HANDLERS[commandType];
  return handler ? handler(state, payload) : NO_OP_TRANSITION;
};

const notifyGameCommandStateChange = (onStateChange, transition) => {
  onStateChange(Boolean(transition.validate), {
    rebuildGrid: Boolean(transition.rebuildGrid),
    isPathDragging: false,
    pathDragSide: null,
    pathDragCursor: null,
  });
};

const notifyPathDragStateChange = (onStateChange, payload = {}) => {
  onStateChange(false, {
    rebuildGrid: false,
    isPathDragging: Boolean(payload.isPathDragging),
    pathDragSide: payload.pathDragSide ?? null,
    pathDragCursor: payload.pathDragCursor ?? null,
  });
};

export function bindInputHandlers(refs, state, onStateChange = () => { }) {
  const adapter = createDomInputAdapter();

  const runCommandCompat = (commandType, payload = {}) => (
    typeof state.dispatch === 'function'
      ? state.dispatch({ type: commandType, payload })
      : runLegacyCommandCompat(state, commandType, payload)
  );

  adapter.bind({
    refs,
    readSnapshot: () => state.getSnapshot(),
    readLayoutMetrics: typeof refs?.readLayoutMetrics === 'function'
      ? () => refs.readLayoutMetrics()
      : () => null,
    emitIntent: (intent) => {
      if (!intent?.type) return;

      if (intent.type === INTENT_TYPES.GAME_COMMAND) {
        const transition = runCommandCompat(intent.payload.commandType, intent.payload);
        notifyGameCommandStateChange(onStateChange, transition);
        return;
      }

      if (intent.type !== INTENT_TYPES.INTERACTION_UPDATE) return;
      if (intent.payload.updateType !== INTERACTION_UPDATES.PATH_DRAG) return;

      notifyPathDragStateChange(onStateChange, intent.payload);
    },
  });

  return {
    unbind: () => adapter.unbind(),
  };
}
