import type {
  ElementLike,
  EventTargetLike,
  RuntimeData,
  RuntimeIntent,
} from '../contracts/ports.ts';
import {
  INTENT_TYPES,
} from '../runtime/intents.ts';

export interface ListenerRecord {
  target: EventTargetLike | null | undefined;
  event: string;
  handler: (event?: unknown) => void;
  options?: AddEventListenerOptions | boolean;
}

export const addManagedListener = (
  listeners: ListenerRecord[],
  target: EventTargetLike | null | undefined,
  event: string,
  handler: (event?: unknown) => void,
  options?: AddEventListenerOptions | boolean,
): void => {
  if (!target?.addEventListener) return;
  target.addEventListener(event, handler, options);
  listeners.push({ target, event, handler, options });
};

export const clearManagedListeners = (listeners: ListenerRecord[]): ListenerRecord[] => {
  listeners.forEach(({ target, event, handler, options }) => {
    target?.removeEventListener(event, handler, options);
  });
  return [];
};

export const emitGameCommandIntent = (
  emitIntent: (intent: RuntimeIntent) => void,
  commandType: string,
  payload: RuntimeData = {},
): void => {
  emitIntent({
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType, ...payload },
  });
};

export const emitUiActionIntent = (
  emitIntent: (intent: RuntimeIntent) => void,
  actionType: string,
  payload: RuntimeData = {},
): void => {
  emitIntent({
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType, ...payload },
  });
};

export const emitInteractionUpdateIntent = (
  emitIntent: (intent: RuntimeIntent) => void,
  updateType: string,
  payload: RuntimeData = {},
): void => {
  emitIntent({
    type: INTENT_TYPES.INTERACTION_UPDATE,
    payload: { updateType, ...payload },
  });
};

export const eventTargetWithin = (
  target: unknown,
  element: ElementLike | null | undefined,
): boolean => {
  if (!target || !element) return false;
  return target === element
    || (typeof element.contains === 'function' && element.contains(target as Node | null));
};
