import { createDomInputAdapter } from './input/dom_input_adapter.ts';
import type {
  BoardLayoutMetrics,
  GameSnapshot,
  InputPort,
  RendererRefs,
  RuntimeIntent,
  StateTransition,
} from './contracts/ports.ts';
import { INTENT_TYPES, GAME_COMMANDS, INTERACTION_UPDATES } from './runtime/intents.ts';

interface CompatTransition extends Pick<StateTransition, 'changed' | 'validate' | 'rebuildGrid'> {}

interface LegacyPathDragPayload {
  side?: string;
  steps?: Array<{ r?: unknown; c?: unknown }>;
}

interface LegacyPathDragStep {
  r: number;
  c: number;
}

interface LegacyStateAdapter {
  getSnapshot: () => GameSnapshot;
  dispatch?: (command: { type: string; payload?: Record<string, unknown> }) => CompatTransition;
  startOrTryStep: (r: number, c: number) => boolean;
  startOrTryStepFromStart: (r: number, c: number) => boolean;
  applyPathDragSequence?: (side: unknown, steps: unknown) => boolean;
  finalizePathAfterPointerUp?: () => boolean;
  moveWall: (from: unknown, to: unknown) => boolean;
}

interface CompatRefs extends RendererRefs {
  readLayoutMetrics?: () => BoardLayoutMetrics | null;
}

interface InputStateChangePayload {
  rebuildGrid: boolean;
  isPathDragging: boolean;
  pathDragSide: string | null;
  pathDragCursor: { r: number; c: number } | null;
}

const NO_OP_TRANSITION: CompatTransition = Object.freeze({
  changed: false,
  validate: false,
  rebuildGrid: false,
});

const makeCompatTransition = (changed: unknown, validate = false): CompatTransition => ({
  changed: Boolean(changed),
  validate: Boolean(validate),
  rebuildGrid: false,
});

const runLegacyPathDragSequence = (
  state: LegacyStateAdapter,
  payload: LegacyPathDragPayload = {},
): CompatTransition => {
  if (typeof state.applyPathDragSequence === 'function') {
    return makeCompatTransition(state.applyPathDragSequence(payload.side, payload.steps));
  }

  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const runLegacyStep = payload.side === 'start'
    ? (step: LegacyPathDragStep) => state.startOrTryStepFromStart(step.r, step.c)
    : (step: LegacyPathDragStep) => state.startOrTryStep(step.r, step.c);
  let changed = false;

  for (const step of steps) {
    if (!isLegacyPathDragStep(step)) break;
    if (!runLegacyStep(step)) break;
    changed = true;
  }

  return makeCompatTransition(changed);
};

const LEGACY_COMMAND_HANDLERS: Record<string, (state: LegacyStateAdapter, payload?: Record<string, unknown>) => CompatTransition> = Object.freeze({
  [GAME_COMMANDS.START_OR_STEP]: (state, payload) => (
    makeCompatTransition(state.startOrTryStep(Number(payload?.r), Number(payload?.c)))
  ),
  [GAME_COMMANDS.START_OR_STEP_FROM_START]: (state, payload) => (
    makeCompatTransition(state.startOrTryStepFromStart(Number(payload?.r), Number(payload?.c)))
  ),
  [GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE]: (state, payload) => (
    runLegacyPathDragSequence(state, payload as LegacyPathDragPayload)
  ),
  [GAME_COMMANDS.FINALIZE_PATH]: (state) => (
    makeCompatTransition(state.finalizePathAfterPointerUp?.(), true)
  ),
  [GAME_COMMANDS.WALL_MOVE_ATTEMPT]: (state, payload) => {
    const changed = state.moveWall(payload?.from, payload?.to);
    return makeCompatTransition(changed, changed);
  },
});

const runLegacyCommandCompat = (
  state: LegacyStateAdapter,
  commandType: string,
  payload: Record<string, unknown> = {},
): CompatTransition => {
  const handler = LEGACY_COMMAND_HANDLERS[commandType];
  return handler ? handler(state, payload) : NO_OP_TRANSITION;
};

const notifyGameCommandStateChange = (
  onStateChange: (validate: boolean, payload: InputStateChangePayload) => void,
  transition: CompatTransition,
): void => {
  onStateChange(Boolean(transition.validate), {
    rebuildGrid: Boolean(transition.rebuildGrid),
    isPathDragging: false,
    pathDragSide: null,
    pathDragCursor: null,
  });
};

const notifyPathDragStateChange = (
  onStateChange: (validate: boolean, payload: InputStateChangePayload) => void,
  payload: Record<string, unknown> = {},
): void => {
  onStateChange(false, {
    rebuildGrid: false,
    isPathDragging: Boolean(payload.isPathDragging),
    pathDragSide: typeof payload.pathDragSide === 'string' ? payload.pathDragSide : null,
    pathDragCursor: (
      payload.pathDragCursor
      && typeof payload.pathDragCursor === 'object'
      && Number.isInteger((payload.pathDragCursor as { r?: unknown }).r)
      && Number.isInteger((payload.pathDragCursor as { c?: unknown }).c)
    )
      ? {
        r: (payload.pathDragCursor as { r: number }).r,
        c: (payload.pathDragCursor as { c: number }).c,
      }
      : null,
  });
};

const isLegacyPathDragStep = (step: { r?: unknown; c?: unknown }): step is LegacyPathDragStep => (
  Number.isInteger(step.r) && Number.isInteger(step.c)
);

export function bindInputHandlers(
  refs: CompatRefs,
  state: LegacyStateAdapter,
  onStateChange: (validate: boolean, payload: InputStateChangePayload) => void = () => { },
): { unbind: () => void } {
  const adapter: InputPort = createDomInputAdapter();

  const runCommandCompat = (commandType: string, payload: Record<string, unknown> = {}): CompatTransition => (
    typeof state.dispatch === 'function'
      ? state.dispatch({ type: commandType, payload })
      : runLegacyCommandCompat(state, commandType, payload)
  );
  const readLayoutMetrics = typeof refs.readLayoutMetrics === 'function'
    ? (): BoardLayoutMetrics | null => refs.readLayoutMetrics!()
    : (): null => null;

  adapter.bind({
    refs,
    readSnapshot: () => state.getSnapshot(),
    readLayoutMetrics,
    emitIntent: (intent: RuntimeIntent) => {
      if (!intent?.type) return;

      if (intent.type === INTENT_TYPES.GAME_COMMAND) {
        const payload = intent.payload as (Record<string, unknown> & { commandType?: unknown }) | undefined;
        const transition = runCommandCompat(
          typeof payload?.commandType === 'string' ? payload.commandType : '',
          payload || {},
        );
        notifyGameCommandStateChange(onStateChange, transition);
        return;
      }

      const payload = intent.payload as (Record<string, unknown> & { updateType?: unknown }) | undefined;
      if (intent.type !== INTENT_TYPES.INTERACTION_UPDATE) return;
      if (payload?.updateType !== INTERACTION_UPDATES.PATH_DRAG) return;

      notifyPathDragStateChange(onStateChange, payload || {});
    },
  });

  return {
    unbind: () => adapter.unbind(),
  };
}
