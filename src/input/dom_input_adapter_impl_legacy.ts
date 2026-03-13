import { CELL_TYPES } from '../config.ts';
import type {
  BoardLayoutMetrics,
  ElementLike,
  EventTargetLike,
  GameSnapshot,
  GridPoint,
  RuntimeData,
  InputPort,
  RendererRefs,
  RuntimeIntent,
} from '../contracts/ports.ts';
import {
  cellCenter,
  getCellSize,
} from '../geometry.ts';
import {
  GAME_COMMANDS,
  INTERACTION_UPDATES,
  UI_ACTIONS,
} from '../runtime/intents.ts';
import {
  canDropWall,
  isUsableCell,
} from '../state/snapshot_rules.ts';
import { isAdjacentMove } from '../utils.ts';
import {
  chooseSlipperyPathDragStep,
} from './pointer_intent_resolver.ts';
import {
  boardNavPayloadsMatch,
  clampToRange,
  cloneBoardSelection,
  cloneCursor,
  cloneDirectionDelta,
  isOrthogonalDelta,
  isPathEndpointSelectionKind,
  isPointInBounds,
  normalizeDirectionDelta,
  parseDirectionKeyDelta,
  pointsMatch,
  resolveBoardOriginCursor,
  resolvePathSelectionSide,
} from './dom_input_adapter_support.ts';
import {
  captureGridMetrics,
  readCachedGridMetrics,
  resolveDragGridMetrics,
  syncViewportScrollState,
} from './dom_input_adapter_metrics.ts';
import type {
  GridMetrics,
  ViewportScrollState,
} from './dom_input_adapter_metrics.ts';
import {
  addManagedListener,
  clearManagedListeners,
  emitGameCommandIntent,
  emitInteractionUpdateIntent,
  emitUiActionIntent,
  eventTargetWithin,
} from './dom_input_adapter_events.ts';
import {
  cellFromPoint as readCellFromPoint,
  pathCellFromPoint as resolvePathCellFromPoint,
  snapCellFromMetrics as resolveSnapCellFromMetrics,
  snapPathCellFromPoint as resolveSnapPathCellFromPoint,
  snapWallCellFromPoint as resolveSnapWallCellFromPoint,
  wallCellFromPoint as resolveWallCellFromPoint,
} from './dom_input_adapter_cells.ts';
import {
  queuePathDragSteps as buildQueuedPathDragSteps,
  readPathDragPointerContext as buildPathDragPointerContext,
} from './dom_input_adapter_path_drag.ts';

type DragMode = 'wall' | 'path' | null;
type BoardSelectionKind = 'path-start' | 'path-end' | 'wall' | null;
type PathSelectionSide = 'start' | 'end';
type DirectionKey = 'up' | 'down' | 'left' | 'right';
type ShortcutAction = 'confirm' | 'reset' | 'reverse' | 'prevLevel' | 'nextLevel';
type GamepadButtonKey = 'confirm' | 'reverse' | 'reset' | 'prevLevel' | 'nextLevel';

interface ListenerRecord {
  target: EventTargetLike | null | undefined;
  event: string;
  handler: (event?: unknown) => void;
  options?: AddEventListenerOptions | boolean;
}

interface PointLike {
  r?: unknown;
  c?: unknown;
}

interface WallDragState {
  from: GridPoint;
  hover: GridPoint | null;
}

interface PathDragState {
  side: PathSelectionSide | null;
  applyPathCommands: boolean;
  moved: boolean;
  origin: GridPoint;
  lastCursorKey: string;
  lastHoverKey: string;
}

interface BoardNavState {
  cursor: GridPoint | null;
  selectionCursor: GridPoint | null;
  selectionKind: BoardSelectionKind;
  navActive: boolean;
  transientSelectionVisible: boolean;
  invalidMovePreviewDelta: GridPoint | null;
}

interface BoardNavPayload extends RuntimeData {
  isBoardNavActive: boolean;
  boardCursor?: GridPoint | null;
  boardSelection?: { kind: string; r: number; c: number } | null;
  isBoardNavPressing?: boolean;
  boardSelectionInteractive?: boolean | null;
  boardNavPreviewDelta?: GridPoint | null;
}

interface BoardNavSyncState {
  selectionKind: BoardSelectionKind;
  selectionCursor: GridPoint | null;
  cursor: GridPoint | null;
}

interface BoardNavStatePatch {
  cursor?: GridPoint | null;
  selectionCursor?: GridPoint | null;
  selectionKind?: BoardSelectionKind;
  navActive?: boolean;
}

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  cancelable?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  target?: EventTarget | null;
}

interface KeyEventLike {
  key: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  target?: EventTarget | null;
}

interface ChangeEventTargetLike extends EventTarget {
  value?: string;
  checked?: boolean;
}

interface ChangeEventLike {
  target?: ChangeEventTargetLike | null;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

interface StandardGamepadButtonLike {
  pressed?: boolean;
  value?: number;
}

interface StandardGamepadLike {
  connected?: boolean;
  mapping?: string;
  buttons?: ArrayLike<StandardGamepadButtonLike | boolean | null | undefined>;
  axes?: ArrayLike<number | null | undefined>;
}

interface KeyboardDirectionState {
  directionKey: string | null;
  nextActionAtMs: number;
  hasDispatched: boolean;
}

interface GamepadDirectionState {
  direction: DirectionKey | null;
  nextRepeatAtMs: number;
}

interface PendingKeyboardDiagonalReplacement {
  side: PathSelectionSide;
  delta: GridPoint;
  sourceTip: GridPoint;
  afterVersion: number | null;
}

interface KeyboardDirectionComponent {
  key: DirectionKey;
  order: number;
  delta: GridPoint;
}

type PathSelectionKind = Exclude<BoardSelectionKind, 'wall' | null>;
type ConfirmKeyId = 'enter' | 'space';

interface BeginPathDragOptions {
  side: PathSelectionSide | null;
  applyPathCommands: boolean;
  metrics: GridMetrics | null;
  pointerId: number;
  originCell: GridPoint;
}

interface GameCommandResult {
  beforeSnapshot: GameSnapshot | null;
  afterSnapshot: GameSnapshot | null;
  changed: boolean;
}

type PathPointerContext = ReturnType<typeof buildPathDragPointerContext>;
type QueuedPathDragStepsBuilder = typeof buildQueuedPathDragSteps;
type ChooseQueuedPathDragStep = Parameters<QueuedPathDragStepsBuilder>[0]['chooseStep'];

const chooseSlipperyPathDragStepTyped = chooseSlipperyPathDragStep as unknown as ChooseQueuedPathDragStep;

export function createDomInputAdapter(): InputPort {
  let refs: RendererRefs | null = null;
  let readSnapshot: () => GameSnapshot | null = () => null;
  let readLayoutMetrics: () => BoardLayoutMetrics | null = () => null;
  let emitIntent: (intent: RuntimeIntent) => void = () => { };
  let listeners: ListenerRecord[] = [];

  let dragMode: DragMode = null;
  let activePointerId: number | null = null;
  let wallDrag: WallDragState | null = null;
  let pathDrag: PathDragState | null = null;
  let dragGridMetrics: GridMetrics | null = null;
  let wallDragFrame = 0;
  let wallDragQueuedPoint: { x: number; y: number } | null = null;
  const viewportScroll: ViewportScrollState = { x: 0, y: 0 };
  let keyboardGamepadControlsEnabled = false;
  let boardControlSuppressed = false;
  let lastBoardNavLevelIndex: number | null = null;
  let lastBoardNavPayload: BoardNavPayload | null = null;
  let gamepadPollFrame = 0;
  let keyboardDirectionFrame = 0;
  const boardNav: BoardNavState = {
    cursor: null as GridPoint | null,
    selectionCursor: null as GridPoint | null,
    selectionKind: null as BoardSelectionKind,
    navActive: false,
    transientSelectionVisible: false,
    invalidMovePreviewDelta: null as GridPoint | null,
  };
  let keyboardWallPreviewVisible = false;
  const keyboardConfirmKeysPressed = {
    enter: false,
    space: false,
  };
  const keyboardDirectionsPressed = {
    up: false,
    down: false,
    left: false,
    right: false,
  };
  const keyboardDirectionPressOrder = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
  };
  let nextKeyboardDirectionPressOrder = 1;
  const keyboardDirectionState = {
    directionKey: null,
    nextActionAtMs: 0,
    hasDispatched: false,
  } as KeyboardDirectionState;
  let pendingKeyboardDiagonalReplacement: PendingKeyboardDiagonalReplacement | null = null;
  const gamepadButtonsPressed = {
    confirm: false,
    reverse: false,
    reset: false,
    prevLevel: false,
    nextLevel: false,
  };
  const gamepadDirectionState = {
    direction: null,
    nextRepeatAtMs: 0,
  } as GamepadDirectionState;
  const BOARD_SELECTION_KINDS = Object.freeze({
    PATH_START: 'path-start',
    PATH_END: 'path-end',
    WALL: 'wall',
  }) as Readonly<Record<'PATH_START' | 'PATH_END' | 'WALL', Exclude<BoardSelectionKind, null>>>;
  const DIRECTION_DELTAS = Object.freeze({
    up: { r: -1, c: 0 },
    down: { r: 1, c: 0 },
    left: { r: 0, c: -1 },
    right: { r: 0, c: 1 },
  }) as Readonly<Record<DirectionKey, GridPoint>>;
  const KEYBOARD_DIRECTION_KEYS = Object.freeze({
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  }) as Readonly<Record<'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', DirectionKey>>;
  const GAMEPLAY_KEYBOARD_KEYS = new Set([
    ...Object.keys(KEYBOARD_DIRECTION_KEYS),
    'Enter',
    ' ',
    'Spacebar',
    'Backspace',
    'Delete',
    'r',
    'R',
    'PageUp',
    'PageDown',
  ]);
  const KEYBOARD_SHORTCUT_ACTIONS = Object.freeze({
    Backspace: 'reset',
    Delete: 'reset',
    r: 'reverse',
    R: 'reverse',
    PageUp: 'prevLevel',
    PageDown: 'nextLevel',
  }) as Readonly<Record<'Backspace' | 'Delete' | 'r' | 'R' | 'PageUp' | 'PageDown', ShortcutAction>>;
  const GAMEPAD_BUTTON_INDEX = Object.freeze({
    confirm: 0,
    reverse: 2,
    reset: 3,
    prevLevel: 4,
    nextLevel: 5,
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
  });
  const GAMEPAD_STICK_DEADZONE = 0.55;
  const GAMEPAD_DIRECTION_INITIAL_DELAY_MS = 180;
  const GAMEPAD_DIRECTION_REPEAT_MS = 90;
  const KEYBOARD_DIRECTION_CHORD_DELAY_MS = 0;
  const KEYBOARD_DIRECTION_INITIAL_DELAY_MS = 180;
  const KEYBOARD_DIRECTION_REPEAT_MS = 90;

  const addListener = <TEvent = unknown>(
    target: EventTargetLike | null | undefined,
    event: string,
    handler: (event: TEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void => {
    addManagedListener(
      listeners,
      target,
      event,
      handler as unknown as (event?: unknown) => void,
      options,
    );
  };

  const clearListeners = (): void => {
    listeners = clearManagedListeners(listeners);
  };

  const sendGameCommand = (commandType: string, payload: RuntimeData = {}): void => {
    emitGameCommandIntent(emitIntent, commandType, payload);
  };

  const sendUiAction = (actionType: string, payload: RuntimeData = {}): void => {
    emitUiActionIntent(emitIntent, actionType, payload);
  };

  const sendInteractionUpdate = (updateType: string, payload: RuntimeData = {}): void => {
    emitInteractionUpdateIntent(emitIntent, updateType, payload);
  };

  const queueWallDragGhostUpdate = (x: number, y: number): void => {
    wallDragQueuedPoint = {
      x: Number(x) || 0,
      y: Number(y) || 0,
    };
    if (wallDragFrame) return;
    wallDragFrame = requestAnimationFrame(() => {
      wallDragFrame = 0;
      if (!wallDragQueuedPoint) return;
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: wallDragQueuedPoint.x,
        y: wallDragQueuedPoint.y,
        isWallDragging: true,
      });
    });
  };

  const clearQueuedWallDragGhostUpdate = () => {
    wallDragQueuedPoint = null;
    if (!wallDragFrame) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(wallDragFrame);
    }
    wallDragFrame = 0;
  };

  const syncViewportScroll = (): ViewportScrollState => {
    return syncViewportScrollState(viewportScroll);
  };

  const getViewportScroll = (): ViewportScrollState => viewportScroll;
  const refreshDragGridMetrics = (
    snapshot: GameSnapshot | null = null,
    forceMeasure = false,
  ): GridMetrics | null => {
    dragGridMetrics = resolveDragGridMetrics({
      snapshot,
      forceMeasure,
      currentDragGridMetrics: dragGridMetrics,
      cachedLayoutMetrics: readLayoutMetrics(),
      gridEl: refs?.gridEl,
      viewportScroll: getViewportScroll(),
    });
    return dragGridMetrics;
  };

  const nowMs = (): number => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  const isBoardNavKeyboardPressActive = (): boolean => (
    isGridFocusedForKeyboardBoardInput()
    && (
      keyboardConfirmKeysPressed.enter
      || keyboardConfirmKeysPressed.space
      || keyboardDirectionsPressed.up
      || keyboardDirectionsPressed.down
      || keyboardDirectionsPressed.left
      || keyboardDirectionsPressed.right
    )
  );

  const isGridFocusedForKeyboardBoardInput = (): boolean => {
    const gridEl = refs?.gridEl;
    return (
      !boardControlSuppressed
      && Boolean(gridEl)
      && !refs?.themeSwitchDialog?.open
      && typeof document !== 'undefined'
      && document.activeElement === gridEl
    );
  };

  const getConnectedStandardGamepad = (): StandardGamepadLike | null => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    const pads = navigator.getGamepads();
    return Array.from(pads || []).find((candidate) => (
      candidate
      && candidate.connected !== false
      && candidate.mapping === 'standard'
    )) || null;
  };

  const canUseGamepadBoardInput = (): boolean => (
    keyboardGamepadControlsEnabled
    && !boardControlSuppressed
    && Boolean(getConnectedStandardGamepad())
    && !activeElementBlocksGamepadBoardInput()
  );

  const isBoardNavCurrentlyControllable = (): boolean => (
    keyboardGamepadControlsEnabled
    && !boardControlSuppressed
    && (isGridFocusedForKeyboardBoardInput() || canUseGamepadBoardInput())
  );

  const clearKeyboardWallPreviewInteraction = (): void => {
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
      visible: false,
      isWallDragging: false,
    });
  };

  const readBoardPreviewGridMetrics = (snapshot: GameSnapshot | null = null): GridMetrics | null => {
    const cachedMetrics = readCachedGridMetrics(
      readLayoutMetrics(),
      snapshot,
      getViewportScroll(),
    );
    if (cachedMetrics) {
      dragGridMetrics = cachedMetrics;
      return cachedMetrics;
    }
    if (!snapshot) return null;
    dragGridMetrics = captureGridMetrics(
      refs?.gridEl,
      snapshot,
      getViewportScroll(),
    );
    return dragGridMetrics;
  };

  const resolveKeyboardWallGhostPoint = (
    cursor: GridPoint | null,
    snapshot: GameSnapshot | null = readSnapshot(),
  ): { x: number; y: number } | null => {
    const nextCursor = cloneCursor(cursor);
    if (!snapshot || !nextCursor || !refs?.gridEl) return null;
    const metrics = readBoardPreviewGridMetrics(snapshot);
    if (!metrics) return null;
    return {
      x: metrics.left + metrics.pad + (nextCursor.c * metrics.step) + (metrics.size * (2 / 3)),
      y: metrics.top + metrics.pad + (nextCursor.r * metrics.step) + (metrics.size * (2 / 3)),
    };
  };

  const refreshKeyboardWallPreview = (snapshot: GameSnapshot | null = readSnapshot()): void => {
    if (
      !keyboardGamepadControlsEnabled
      || boardControlSuppressed
      || !keyboardWallPreviewVisible
      || boardNav.selectionKind !== BOARD_SELECTION_KINDS.WALL
    ) {
      clearKeyboardWallPreviewInteraction();
      return;
    }

    const cursor = cloneCursor(boardNav.cursor);
    const anchor = cloneCursor(boardNav.selectionCursor);
    if (!snapshot || !cursor || !anchor) {
      clearKeyboardWallPreviewInteraction();
      return;
    }

    const ghostPoint = resolveKeyboardWallGhostPoint(cursor, snapshot);
    if (ghostPoint) {
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: ghostPoint.x,
        y: ghostPoint.y,
        isWallDragging: false,
      });
    } else {
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: false,
        isWallDragging: false,
      });
    }

    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, {
      dropTarget: canDropWall(snapshot, anchor, cursor) ? cursor : null,
    });
  };

  const setKeyboardWallPreviewVisible = (
    visible: boolean,
    snapshot: GameSnapshot | null = readSnapshot(),
  ): void => {
    keyboardWallPreviewVisible = Boolean(visible);
    refreshKeyboardWallPreview(snapshot);
  };

  const clearKeyboardWallPreviewState = (snapshot: GameSnapshot | null = readSnapshot()): void => {
    const hadVisiblePreview = keyboardWallPreviewVisible;
    keyboardWallPreviewVisible = false;
    if (!hadVisiblePreview) return;
    refreshKeyboardWallPreview(snapshot);
  };

  const resolveBoardSelectionCursorForDisplay = (
    snapshot: GameSnapshot | null,
    cursor: GridPoint | null,
  ): GridPoint | null => {
    if (typeof boardNav.selectionKind === 'string') {
      return cloneCursor(boardNav.selectionCursor) || cloneCursor(cursor);
    }
    if (
      boardNav.transientSelectionVisible
      && cloneCursor(cursor)
      && !isBoardCursorInteractive(snapshot, cursor)
    ) {
      return cloneCursor(cursor);
    }
    return null;
  };

  const emitBoardNavUpdate = (): void => {
    const snapshot = readSnapshot();
    const cursor = cloneCursor(boardNav.cursor);
    const selectionKind = resolveBoardSelectionKindForDisplay(snapshot, cursor);
    const selection = cloneBoardSelection(
      selectionKind,
      resolveBoardSelectionCursorForDisplay(snapshot, cursor),
    );
    const previewDelta = cloneDirectionDelta(boardNav.invalidMovePreviewDelta);
    const payload: BoardNavPayload = {
      isBoardNavActive: Boolean(boardNav.navActive) && isBoardNavCurrentlyControllable(),
      boardCursor: cursor,
      boardSelection: selection,
      boardSelectionInteractive: selection ? isBoardCursorInteractive(snapshot, selection) : null,
    };
    if (isBoardNavKeyboardPressActive()) payload.isBoardNavPressing = true;
    if (previewDelta) payload.boardNavPreviewDelta = previewDelta;
    if (boardNavPayloadsMatch(payload, lastBoardNavPayload)) return;
    lastBoardNavPayload = payload;
    sendInteractionUpdate(INTERACTION_UPDATES.BOARD_NAV, payload);
  };

  const refreshBoardNavVisibility = (): void => {
    if (!keyboardGamepadControlsEnabled) return;
    emitBoardNavUpdate();
  };

  const commitBoardNavState = (nextState: BoardNavStatePatch = {}): boolean => {
    const nextCursor = Object.hasOwn(nextState, 'cursor')
      ? cloneCursor(nextState.cursor)
      : cloneCursor(boardNav.cursor);
    let nextSelectionKind = boardNav.selectionKind;
    if (Object.hasOwn(nextState, 'selectionKind')) {
      nextSelectionKind = typeof nextState.selectionKind === 'string'
        ? nextState.selectionKind as BoardSelectionKind
        : null;
    }
    const nextSelectionCursor = Object.hasOwn(nextState, 'selectionCursor')
      ? cloneCursor(nextState.selectionCursor)
      : cloneCursor(boardNav.selectionCursor);
    const normalizedSelectionCursor = nextSelectionKind
      ? (nextSelectionCursor || cloneCursor(nextCursor))
      : null;
    const nextNavActive = Object.hasOwn(nextState, 'navActive')
      ? Boolean(nextState.navActive)
      : boardNav.navActive;
    const changed = (
      (boardNav.cursor?.r ?? null) !== (nextCursor?.r ?? null)
      || (boardNav.cursor?.c ?? null) !== (nextCursor?.c ?? null)
      || (boardNav.selectionKind ?? null) !== (nextSelectionKind ?? null)
      || (boardNav.selectionCursor?.r ?? null) !== (normalizedSelectionCursor?.r ?? null)
      || (boardNav.selectionCursor?.c ?? null) !== (normalizedSelectionCursor?.c ?? null)
      || boardNav.navActive !== nextNavActive
    );
    const shouldRefreshKeyboardWallPreview = (
      keyboardWallPreviewVisible
      || boardNav.selectionKind === BOARD_SELECTION_KINDS.WALL
      || nextSelectionKind === BOARD_SELECTION_KINDS.WALL
    );
    if (!changed) {
      if (shouldRefreshKeyboardWallPreview) refreshKeyboardWallPreview();
      return false;
    }

    boardNav.cursor = nextCursor;
    boardNav.selectionCursor = normalizedSelectionCursor;
    boardNav.selectionKind = nextSelectionKind;
    boardNav.navActive = nextNavActive;
    boardNav.invalidMovePreviewDelta = null;
    if (shouldRefreshKeyboardWallPreview) refreshKeyboardWallPreview();
    emitBoardNavUpdate();
    return true;
  };

  const setTransientBoardSelectionVisible = (visible: boolean): boolean => {
    const nextVisible = Boolean(visible);
    if (boardNav.transientSelectionVisible === nextVisible) return false;
    boardNav.transientSelectionVisible = nextVisible;
    emitBoardNavUpdate();
    return true;
  };

  const setBoardNavInvalidMovePreview = (
    directionOrDelta: string | GridPoint | null | undefined,
  ): boolean => {
    const nextPreview = normalizeDirectionDelta(directionOrDelta, DIRECTION_DELTAS);
    if (!nextPreview) return false;
    if (
      (boardNav.invalidMovePreviewDelta?.r ?? null) === nextPreview.r
      && (boardNav.invalidMovePreviewDelta?.c ?? null) === nextPreview.c
    ) {
      return false;
    }
    boardNav.invalidMovePreviewDelta = nextPreview;
    emitBoardNavUpdate();
    return true;
  };

  const clearBoardNavInvalidMovePreview = (): boolean => {
    if (!boardNav.invalidMovePreviewDelta) return false;
    boardNav.invalidMovePreviewDelta = null;
    emitBoardNavUpdate();
    return true;
  };

  const clearBoardNavState = (): void => {
    pendingKeyboardDiagonalReplacement = null;
    boardNav.transientSelectionVisible = false;
    boardNav.invalidMovePreviewDelta = null;
    clearKeyboardWallPreviewState();
    commitBoardNavState({
      cursor: null,
      selectionCursor: null,
      selectionKind: null,
      navActive: false,
    });
    lastBoardNavLevelIndex = null;
  };

  const isBoardCursorInteractive = (
    snapshot: GameSnapshot | null,
    cursor: GridPoint | null,
  ): boolean => {
    if (!snapshot || !isPointInBounds(snapshot, cursor)) return false;
    if (snapshot.gridData?.[cursor.r]?.[cursor.c] === CELL_TYPES.MOVABLE_WALL) return true;

    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      return isUsableCell(snapshot, cursor.r, cursor.c);
    }

    const tail = snapshot.path[snapshot.path.length - 1] || null;
    if (tail && pointsMatch(cursor, tail)) return true;
    if (snapshot.path.length > 1) {
      const head = snapshot.path[0] || null;
      if (head && pointsMatch(cursor, head)) return true;
    }
    return false;
  };

  const resolveBoardSelectionKindForDisplay = (
    snapshot: GameSnapshot | null,
    cursor: GridPoint | null,
  ): BoardSelectionKind => {
    if (typeof boardNav.selectionKind === 'string') return boardNav.selectionKind;
    if (
      boardNav.transientSelectionVisible
      && cloneCursor(cursor)
      && !isBoardCursorInteractive(snapshot, cursor)
    ) {
      return BOARD_SELECTION_KINDS.PATH_END;
    }
    return null;
  };

  const resolveSelectedPathEndpoint = (
    snapshot: GameSnapshot | null,
    selectionKind: BoardSelectionKind,
  ): GridPoint | null => {
    if (!snapshot || !Array.isArray(snapshot.path) || snapshot.path.length === 0) return null;
    if (selectionKind === BOARD_SELECTION_KINDS.PATH_START && snapshot.path.length > 1) {
      return snapshot.path[0];
    }
    return snapshot.path[snapshot.path.length - 1];
  };

  const createBoardNavSyncState = (levelChanged: boolean): BoardNavSyncState => ({
    selectionKind: levelChanged ? null : boardNav.selectionKind,
    selectionCursor: levelChanged ? null : cloneCursor(boardNav.selectionCursor),
    cursor: levelChanged ? null : cloneCursor(boardNav.cursor),
  });

  const clearSyncedBoardNavSelection = (state: BoardNavSyncState): void => {
    state.selectionKind = null;
    state.selectionCursor = null;
    keyboardWallPreviewVisible = false;
  };

  const syncWallBoardNavSelection = (snapshot: GameSnapshot, state: BoardNavSyncState): void => {
    if (
      !isPointInBounds(snapshot, state.selectionCursor)
      || snapshot.gridData?.[state.selectionCursor.r]?.[state.selectionCursor.c] !== CELL_TYPES.MOVABLE_WALL
    ) {
      clearSyncedBoardNavSelection(state);
      return;
    }
    if (!isPointInBounds(snapshot, state.cursor)) {
      state.cursor = cloneCursor(state.selectionCursor);
    }
  };

  const syncPathBoardNavSelection = (snapshot: GameSnapshot, state: BoardNavSyncState): void => {
    keyboardWallPreviewVisible = false;
    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      state.selectionKind = null;
      state.selectionCursor = null;
      return;
    }
    if (snapshot.path.length <= 1) {
      state.selectionKind = BOARD_SELECTION_KINDS.PATH_END;
    }
    const endpoint = resolveSelectedPathEndpoint(snapshot, state.selectionKind);
    if (!endpoint) return;
    state.cursor = { r: endpoint.r, c: endpoint.c };
    state.selectionCursor = { r: endpoint.r, c: endpoint.c };
  };

  const syncBoardNavSnapshot = (snapshot: GameSnapshot | null = readSnapshot()): void => {
    if (!keyboardGamepadControlsEnabled) return;
    if (!snapshot || snapshot.rows <= 0 || snapshot.cols <= 0) {
      clearBoardNavState();
      return;
    }

    const levelIndex = Number.isInteger(snapshot.levelIndex) ? snapshot.levelIndex : null;
    const levelChanged = levelIndex !== lastBoardNavLevelIndex;
    const nextState = createBoardNavSyncState(levelChanged);
    if (levelChanged) keyboardWallPreviewVisible = false;

    if (nextState.selectionKind === BOARD_SELECTION_KINDS.WALL) {
      syncWallBoardNavSelection(snapshot, nextState);
    } else if (isPathEndpointSelectionKind(nextState.selectionKind)) {
      syncPathBoardNavSelection(snapshot, nextState);
    } else {
      nextState.selectionCursor = null;
      keyboardWallPreviewVisible = false;
    }

    if (!nextState.cursor || !isPointInBounds(snapshot, nextState.cursor)) {
      nextState.cursor = resolveBoardOriginCursor(snapshot);
    }

    lastBoardNavLevelIndex = levelIndex;
    commitBoardNavState({
      cursor: nextState.cursor,
      selectionCursor: nextState.selectionCursor,
      selectionKind: nextState.selectionKind,
      navActive: Boolean(nextState.cursor),
    });
  };

  const currentBoardCursor = (snapshot: GameSnapshot | null = readSnapshot()): GridPoint | null => {
    if (!snapshot) return null;
    const cursor = cloneCursor(boardNav.cursor);
    if (cursor && isPointInBounds(snapshot, cursor)) return cursor;
    return resolveBoardOriginCursor(snapshot);
  };

  const runGameCommand = (commandType: string, payload: RuntimeData = {}): GameCommandResult => {
    const beforeSnapshot = readSnapshot();
    sendGameCommand(commandType, payload);
    const afterSnapshot = readSnapshot();
    return {
      beforeSnapshot,
      afterSnapshot,
      changed: afterSnapshot?.version !== beforeSnapshot?.version,
    };
  };

  const runUiAction = (actionType: string, payload: RuntimeData = {}): GameSnapshot | null => {
    sendUiAction(actionType, payload);
    return readSnapshot();
  };

  const suspendBoardNavForPointerInteraction = (): void => {
    if (!keyboardGamepadControlsEnabled) return;
    boardNav.transientSelectionVisible = false;
    clearKeyboardWallPreviewState();
    commitBoardNavState({
      cursor: boardNav.cursor,
      selectionCursor: null,
      selectionKind: null,
      navActive: false,
    });
  };

  const snapCellFromMetrics = (
    x: number,
    y: number,
    resolved: BoardLayoutMetrics | null | undefined,
  ): GridPoint | null => resolveSnapCellFromMetrics(x, y, resolved);

  const cellFromPoint = (x: number, y: number): GridPoint | null => readCellFromPoint(x, y);

  const snapWallCellFromPoint = (
    x: number,
    y: number,
    snapshot: GameSnapshot | null | undefined,
    metrics: GridMetrics | null = null,
  ): GridPoint | null => resolveSnapWallCellFromPoint({
    x,
    y,
    snapshot,
    metrics,
    gridEl: refs?.gridEl,
    viewportScroll: getViewportScroll(),
  });

  const snapPathCellFromPoint = (
    x: number,
    y: number,
    snapshot: GameSnapshot | null | undefined,
    metrics: GridMetrics | null = null,
  ): GridPoint | null => resolveSnapPathCellFromPoint({
    x,
    y,
    snapshot,
    metrics,
    gridEl: refs?.gridEl,
    viewportScroll: getViewportScroll(),
  });

  const pathCellFromPoint = (
    x: number,
    y: number,
    snapshot: GameSnapshot | null | undefined,
    metrics: GridMetrics | null = null,
  ): GridPoint | null => resolvePathCellFromPoint({
    x,
    y,
    snapshot,
    metrics,
    gridEl: refs?.gridEl,
    layoutMetrics: readLayoutMetrics(),
    viewportScroll: getViewportScroll(),
  });

  const wallCellFromPoint = (
    x: number,
    y: number,
    snapshot: GameSnapshot | null | undefined,
    metrics: GridMetrics | null = null,
  ): GridPoint | null => resolveWallCellFromPoint({
    x,
    y,
    snapshot,
    metrics,
    gridEl: refs?.gridEl,
    viewportScroll: getViewportScroll(),
  });

  const boardCursorOrDefault = (
    snapshot: GameSnapshot | null = readSnapshot(),
  ): GridPoint | null => {
    const cursor = currentBoardCursor(snapshot);
    if (!cursor || !snapshot) return null;
    if (!boardNav.navActive || !boardNav.cursor) {
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: true,
      });
    }
    return cursor;
  };

  const moveFreeBoardCursor = (
    directionOrDelta: string | GridPoint | null | undefined,
    snapshot: GameSnapshot | null = readSnapshot(),
  ): boolean => {
    const delta = normalizeDirectionDelta(directionOrDelta, DIRECTION_DELTAS);
    const cursor = boardCursorOrDefault(snapshot);
    if (!delta || !snapshot || !cursor) return false;
    pendingKeyboardDiagonalReplacement = null;
    const nextCursor = {
      r: clampToRange(cursor.r + delta.r, 0, snapshot.rows - 1),
      c: clampToRange(cursor.c + delta.c, 0, snapshot.cols - 1),
    };
    return commitBoardNavState({
      cursor: nextCursor,
      selectionKind: null,
      navActive: true,
    });
  };

  const commitBoardNavSelection = (
    cursor: GridPoint | null,
    selectionKind: BoardSelectionKind,
    selectionCursor: GridPoint | null = cursor,
  ): boolean => commitBoardNavState({
    cursor,
    selectionCursor,
    selectionKind,
    navActive: true,
  });

  const clearBoardNavSelection = (
    cursor: GridPoint | null,
    snapshot: GameSnapshot | null = readSnapshot(),
  ): boolean => {
    clearKeyboardWallPreviewState(snapshot);
    return commitBoardNavState({
      cursor,
      selectionKind: null,
      navActive: true,
    });
  };

  const finalizeBoardPathSelection = (cursor: GridPoint): boolean => {
    const { afterSnapshot } = runGameCommand(GAME_COMMANDS.FINALIZE_PATH);
    clearBoardNavSelection(cursor, afterSnapshot);
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const tryMoveKeyboardWallSelection = (snapshot: GameSnapshot, cursor: GridPoint): boolean => {
    const anchor = cloneCursor(boardNav.selectionCursor) || cursor;
    if (!anchor || !canDropWall(snapshot, anchor, cursor)) return false;
    const target = { r: cursor.r, c: cursor.c };
    const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.WALL_MOVE_ATTEMPT, {
      from: anchor,
      to: target,
    });
    if (!changed) return false;
    clearKeyboardWallPreviewState(afterSnapshot);
    commitBoardNavSelection(target, BOARD_SELECTION_KINDS.WALL, target);
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const startBoardPathFromCursor = (snapshot: GameSnapshot, cursor: GridPoint): boolean => {
    if (!isUsableCell(snapshot, cursor.r, cursor.c)) return false;
    const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.START_OR_STEP, {
      r: cursor.r,
      c: cursor.c,
    });
    if (!changed) {
      syncBoardNavSnapshot(afterSnapshot);
      return false;
    }
    const endpoint = afterSnapshot?.path?.[afterSnapshot.path.length - 1] || cursor;
    commitBoardNavSelection(endpoint, BOARD_SELECTION_KINDS.PATH_END);
    return true;
  };

  const selectBoardPathEndpointAtCursor = (
    snapshot: GameSnapshot,
    cursor: GridPoint,
  ): boolean => {
    const head = snapshot.path[0] || null;
    const tail = snapshot.path[snapshot.path.length - 1] || null;
    if (tail && pointsMatch(cursor, tail)) {
      return commitBoardNavSelection(cursor, BOARD_SELECTION_KINDS.PATH_END);
    }
    if (snapshot.path.length > 1 && head && pointsMatch(cursor, head)) {
      return commitBoardNavSelection(cursor, BOARD_SELECTION_KINDS.PATH_START);
    }
    return false;
  };

  const handleUnselectedBoardConfirm = (snapshot: GameSnapshot, cursor: GridPoint): boolean => {
    const cellType = snapshot.gridData?.[cursor.r]?.[cursor.c];
    if (cellType === CELL_TYPES.MOVABLE_WALL) {
      setKeyboardWallPreviewVisible(true, snapshot);
      return commitBoardNavSelection(cursor, BOARD_SELECTION_KINDS.WALL);
    }
    if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) {
      return startBoardPathFromCursor(snapshot, cursor);
    }
    return selectBoardPathEndpointAtCursor(snapshot, cursor);
  };

  const handleBoardConfirmAction = (): boolean => {
    if (!keyboardGamepadControlsEnabled) return false;
    pendingKeyboardDiagonalReplacement = null;
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    if (!snapshot || !cursor) return false;

    const selectionKind = boardNav.selectionKind;
    if (isPathEndpointSelectionKind(selectionKind)) {
      return finalizeBoardPathSelection(cursor);
    }
    if (selectionKind === BOARD_SELECTION_KINDS.WALL) {
      if (tryMoveKeyboardWallSelection(snapshot, cursor)) return true;
      return clearBoardNavSelection(cursor, snapshot);
    }
    if (selectionKind) {
      return clearBoardNavSelection(cursor, snapshot);
    }
    return handleUnselectedBoardConfirm(snapshot, cursor);
  };

  const moveKeyboardWallSelection = (
    snapshot: GameSnapshot,
    cursor: GridPoint,
    delta: GridPoint | null | undefined,
  ): boolean => {
    pendingKeyboardDiagonalReplacement = null;
    const nextDelta = cloneDirectionDelta(delta);
    if (!nextDelta || !isOrthogonalDelta(nextDelta)) return false;
    const target = {
      r: cursor.r + nextDelta.r,
      c: cursor.c + nextDelta.c,
    };
    if (!isPointInBounds(snapshot, target)) return false;
    keyboardWallPreviewVisible = true;
    commitBoardNavState({
      cursor: target,
      selectionKind: BOARD_SELECTION_KINDS.WALL,
      navActive: true,
    });
    return true;
  };

  const tryApplyPendingKeyboardPathReplacement = (
    snapshot: GameSnapshot,
    selectionKind: PathSelectionKind,
    delta: GridPoint,
  ): boolean => {
    if (!canUsePendingKeyboardDiagonalReplacement(snapshot, selectionKind, delta)) return false;
    const replaceSourceTip = pendingKeyboardDiagonalReplacement?.sourceTip;
    if (!replaceSourceTip) return false;
    const replacementTarget = {
      r: replaceSourceTip.r + delta.r,
      c: replaceSourceTip.c + delta.c,
    };
    pendingKeyboardDiagonalReplacement = null;
    const { afterSnapshot, changed } = runGameCommand(GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE, {
      side: resolvePathSelectionSide(selectionKind),
      steps: [
        { r: replaceSourceTip.r, c: replaceSourceTip.c },
        replacementTarget,
      ],
    });
    if (!changed) return false;
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const rememberPendingKeyboardPathReplacement = (
    selectionKind: PathSelectionKind,
    delta: GridPoint,
    source: GridPoint,
    afterSnapshot: GameSnapshot | null,
  ): void => {
    if (!isOrthogonalDelta(delta)) {
      pendingKeyboardDiagonalReplacement = null;
      return;
    }
    pendingKeyboardDiagonalReplacement = {
      side: resolvePathSelectionSide(selectionKind),
      delta,
      sourceTip: { r: source.r, c: source.c },
      afterVersion: afterSnapshot?.version ?? null,
    };
  };

  const handleSelectedPathDirectionalAction = (
    snapshot: GameSnapshot,
    delta: GridPoint,
  ): boolean => {
    const selectionKind = boardNav.selectionKind;
    if (!isPathEndpointSelectionKind(selectionKind)) return false;
    const source = resolveSelectedPathEndpoint(snapshot, selectionKind);
    if (!source) {
      pendingKeyboardDiagonalReplacement = null;
      syncBoardNavSnapshot(snapshot);
      return false;
    }
    if (tryApplyPendingKeyboardPathReplacement(snapshot, selectionKind, delta)) {
      return true;
    }
    const target = {
      r: source.r + delta.r,
      c: source.c + delta.c,
    };
    if (!isPointInBounds(snapshot, target)) return false;
    const commandType = selectionKind === BOARD_SELECTION_KINDS.PATH_START
      ? GAME_COMMANDS.START_OR_STEP_FROM_START
      : GAME_COMMANDS.START_OR_STEP;
    const { afterSnapshot, changed } = runGameCommand(commandType, target);
    if (!changed) return false;
    rememberPendingKeyboardPathReplacement(selectionKind, delta, source, afterSnapshot);
    syncBoardNavSnapshot(afterSnapshot);
    return true;
  };

  const handleBoardDirectionalAction = (
    directionOrDelta: string | GridPoint | null | undefined,
  ): boolean => {
    if (!keyboardGamepadControlsEnabled) return false;
    const delta = normalizeDirectionDelta(directionOrDelta, DIRECTION_DELTAS);
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    if (!delta || !snapshot || !cursor) return false;

    if (!boardNav.selectionKind) {
      return moveFreeBoardCursor(delta, snapshot);
    }
    if (boardNav.selectionKind === BOARD_SELECTION_KINDS.WALL) {
      return moveKeyboardWallSelection(snapshot, cursor, delta);
    }
    return handleSelectedPathDirectionalAction(snapshot, delta);
  };

  const handleBoardShortcutAction = (shortcut: ShortcutAction): boolean => {
    if (!keyboardGamepadControlsEnabled) return false;
    pendingKeyboardDiagonalReplacement = null;
    const snapshot = readSnapshot();
    const cursor = currentBoardCursor(snapshot);

    if (shortcut === 'confirm') {
      return handleBoardConfirmAction();
    }

    if (shortcut === 'reset') {
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.RESET_CLICK));
      return true;
    }

    if (shortcut === 'reverse') {
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.REVERSE_CLICK));
      return true;
    }

    if (shortcut === 'nextLevel') {
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.NEXT_LEVEL_CLICK));
      return true;
    }

    if (shortcut === 'prevLevel') {
      if (!snapshot || !Number.isInteger(snapshot.levelIndex) || snapshot.levelIndex <= 0) return false;
      clearKeyboardWallPreviewState(snapshot);
      commitBoardNavState({
        cursor,
        selectionKind: null,
        navActive: Boolean(cursor),
      });
      syncBoardNavSnapshot(runUiAction(UI_ACTIONS.LEVEL_SELECT, {
        value: snapshot.levelIndex - 1,
      }));
      return true;
    }

    return false;
  };

  const resolvePressedKeyboardDirection = (): GridPoint | null => {
    let vertical = 0;
    if (keyboardDirectionsPressed.up !== keyboardDirectionsPressed.down) {
      vertical = keyboardDirectionsPressed.up ? -1 : 1;
    }
    let horizontal = 0;
    if (keyboardDirectionsPressed.left !== keyboardDirectionsPressed.right) {
      horizontal = keyboardDirectionsPressed.left ? -1 : 1;
    }
    if (vertical === 0 && horizontal === 0) return null;
    return { r: vertical, c: horizontal };
  };

  const resolvePressedKeyboardDirectionComponents = (): KeyboardDirectionComponent[] => {
    const components: KeyboardDirectionComponent[] = [];
    if (keyboardDirectionsPressed.up !== keyboardDirectionsPressed.down) {
      const key: DirectionKey = keyboardDirectionsPressed.up ? 'up' : 'down';
      components.push({
        key,
        order: keyboardDirectionPressOrder[key],
        delta: DIRECTION_DELTAS[key],
      });
    }
    if (keyboardDirectionsPressed.left !== keyboardDirectionsPressed.right) {
      const key: DirectionKey = keyboardDirectionsPressed.left ? 'left' : 'right';
      components.push({
        key,
        order: keyboardDirectionPressOrder[key],
        delta: DIRECTION_DELTAS[key],
      });
    }
    components.sort((left, right) => left.order - right.order);
    return components;
  };

  const canUsePendingKeyboardDiagonalReplacement = (
    snapshot: GameSnapshot | null | undefined,
    selectionKind: PathSelectionKind,
    delta: GridPoint | null | undefined,
  ): boolean => {
    const nextDelta = cloneDirectionDelta(delta);
    if (!nextDelta || !(Math.abs(nextDelta.r) === 1 && Math.abs(nextDelta.c) === 1)) return false;
    const replaceSide = selectionKind === BOARD_SELECTION_KINDS.PATH_START ? 'start' : 'end';
    const replaceDelta = pendingKeyboardDiagonalReplacement?.delta;
    const replaceSourceTip = pendingKeyboardDiagonalReplacement?.sourceTip;
    if (
      pendingKeyboardDiagonalReplacement?.side !== replaceSide
      || pendingKeyboardDiagonalReplacement.afterVersion !== snapshot?.version
      || !Number.isInteger(replaceSourceTip?.r)
      || !Number.isInteger(replaceSourceTip?.c)
      || (
        (replaceDelta?.r !== nextDelta.r || replaceDelta?.c !== 0)
        && (replaceDelta?.r !== 0 || replaceDelta?.c !== nextDelta.c)
      )
    ) {
      return false;
    }
    if (!replaceSourceTip) return false;

    const replacementTarget = {
      r: replaceSourceTip.r + nextDelta.r,
      c: replaceSourceTip.c + nextDelta.c,
    };
    return (
      isPointInBounds(snapshot, replacementTarget)
      && isUsableCell(snapshot, replacementTarget.r, replacementTarget.c)
      && isAdjacentMove(snapshot, replaceSourceTip, replacementTarget)
    );
  };

  const canUseDirectKeyboardPathDiagonal = (
    snapshot: GameSnapshot | null | undefined,
    selectionKind: PathSelectionKind,
    delta: GridPoint | null | undefined,
  ): boolean => {
    const nextDelta = cloneDirectionDelta(delta);
    if (!nextDelta || !(Math.abs(nextDelta.r) === 1 && Math.abs(nextDelta.c) === 1)) return false;
    if (!snapshot) return false;
    const source = resolveSelectedPathEndpoint(snapshot ?? null, selectionKind);
    if (!source) return false;
    const target = {
      r: source.r + nextDelta.r,
      c: source.c + nextDelta.c,
    };
    return (
      isPointInBounds(snapshot, target)
      && isUsableCell(snapshot, target.r, target.c)
      && isAdjacentMove(snapshot, source, target)
    );
  };

  const shouldSplitSelectedPathDiagonalChord = (
    snapshot: GameSnapshot | null | undefined,
    delta: GridPoint | null | undefined,
    components: KeyboardDirectionComponent[],
  ): boolean => {
    const nextDelta = cloneDirectionDelta(delta);
    if (components.length !== 2) return false;
    if (!nextDelta || !(Math.abs(nextDelta.r) === 1 && Math.abs(nextDelta.c) === 1)) return false;
    const selectionKind = boardNav.selectionKind;
    if (!isPathEndpointSelectionKind(selectionKind)) return false;
    return !(
      canUsePendingKeyboardDiagonalReplacement(snapshot, selectionKind, nextDelta)
      || canUseDirectKeyboardPathDiagonal(snapshot, selectionKind, nextDelta)
    );
  };

  const handleBoardDirectionalChord = (
    components: KeyboardDirectionComponent[] = [],
    consumedDelta: GridPoint | null = null,
  ): boolean => {
    let changed = false;
    const skippedDelta = cloneDirectionDelta(consumedDelta);
    for (const element of components) {
      if (
        skippedDelta
        && element.delta.r === skippedDelta.r
        && element.delta.c === skippedDelta.c
      ) {
        continue;
      }
      const didChange = handleBoardDirectionalAction(element.delta);
      changed = didChange || changed;
    }
    return changed;
  };

  const resetKeyboardDirectionState = (): void => {
    keyboardDirectionState.directionKey = null;
    keyboardDirectionState.nextActionAtMs = 0;
    keyboardDirectionState.hasDispatched = false;
  };

  const armHeldKeyboardDirectionForRepeat = (
    direction: string | GridPoint | null | undefined,
    timestamp = nowMs(),
  ): void => {
    const normalized = normalizeDirectionDelta(direction, DIRECTION_DELTAS);
    if (!normalized) {
      resetKeyboardDirectionState();
      return;
    }
    keyboardDirectionState.directionKey = `${normalized.r},${normalized.c}`;
    keyboardDirectionState.hasDispatched = true;
    keyboardDirectionState.nextActionAtMs = timestamp + KEYBOARD_DIRECTION_INITIAL_DELAY_MS;
  };

  const resolveConfirmKeyId = (key: string): ConfirmKeyId | null => {
    if (key === 'Enter') return 'enter';
    if (key === ' ' || key === 'Spacebar') return 'space';
    return null;
  };

  const clearKeyboardConfirmPressed = (): void => {
    keyboardConfirmKeysPressed.enter = false;
    keyboardConfirmKeysPressed.space = false;
    setTransientBoardSelectionVisible(false);
  };

  const stopKeyboardDirectionPolling = (): void => {
    if (keyboardDirectionFrame && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(keyboardDirectionFrame);
    }
    keyboardDirectionFrame = 0;
    resetKeyboardDirectionState();
  };

  const clearKeyboardDirectionPressed = (): void => {
    keyboardDirectionsPressed.up = false;
    keyboardDirectionsPressed.down = false;
    keyboardDirectionsPressed.left = false;
    keyboardDirectionsPressed.right = false;
    keyboardDirectionPressOrder.up = 0;
    keyboardDirectionPressOrder.down = 0;
    keyboardDirectionPressOrder.left = 0;
    keyboardDirectionPressOrder.right = 0;
    pendingKeyboardDiagonalReplacement = null;
    stopKeyboardDirectionPolling();
    clearBoardNavInvalidMovePreview();
  };

  const scheduleKeyboardDirectionPolling = (): void => {
    if (
      !keyboardGamepadControlsEnabled
      || boardControlSuppressed
      || keyboardDirectionFrame
      || typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    keyboardDirectionFrame = requestAnimationFrame((timestamp) => {
      pollKeyboardDirectionFrame(timestamp);
    });
  };

  const resetKeyboardDirectionFrameState = (): void => {
    resetKeyboardDirectionState();
    clearBoardNavInvalidMovePreview();
    refreshBoardNavVisibility();
  };

  const syncHeldKeyboardDirectionState = (
    directionKey: string,
    previousDirectionKey: string | null,
    timestamp: number,
  ): void => {
    if (directionKey === previousDirectionKey) return;
    const cameFromIdle = previousDirectionKey === null;
    keyboardDirectionState.directionKey = directionKey;
    keyboardDirectionState.hasDispatched = false;
    keyboardDirectionState.nextActionAtMs = cameFromIdle
      ? (timestamp + KEYBOARD_DIRECTION_CHORD_DELAY_MS)
      : timestamp;
  };

  const resolveHeldKeyboardDirectionAction = (
    snapshot: GameSnapshot | null,
    direction: GridPoint,
    directionComponents: KeyboardDirectionComponent[],
    consumedSplitAxisDelta: GridPoint | null,
  ): boolean => {
    const shouldHandleChord = (
      shouldSplitSelectedPathDiagonalChord(snapshot, direction, directionComponents)
      || (
        !boardNav.selectionKind
        && consumedSplitAxisDelta
        && directionComponents.length === 2
      )
    );
    if (shouldHandleChord) {
      return handleBoardDirectionalChord(directionComponents, consumedSplitAxisDelta);
    }
    return handleBoardDirectionalAction(direction);
  };

  const resolveKeyboardDirectionRepeatDelay = (
    directionKey: string,
    previousDirectionKey: string | null,
  ): number => (
    previousDirectionKey !== null && directionKey === previousDirectionKey
      ? KEYBOARD_DIRECTION_REPEAT_MS
      : KEYBOARD_DIRECTION_INITIAL_DELAY_MS
  );

  const dispatchHeldKeyboardDirection = (
    timestamp: number,
    direction: GridPoint,
    directionComponents: KeyboardDirectionComponent[],
    directionKey: string,
    previousDirectionKey: string | null,
    previousDirectionHadDispatched: boolean,
  ): void => {
    if (timestamp < keyboardDirectionState.nextActionAtMs) return;
    const previouslyConsumedDelta = parseDirectionKeyDelta(previousDirectionKey);
    const consumedSplitAxisDelta = (
      directionKey !== previousDirectionKey
      && previousDirectionHadDispatched === true
      && isOrthogonalDelta(previouslyConsumedDelta)
    )
      ? previouslyConsumedDelta
      : null;
    const snapshot = readSnapshot();
    const handled = resolveHeldKeyboardDirectionAction(
      snapshot,
      direction,
      directionComponents,
      consumedSplitAxisDelta,
    );
    if (handled) clearBoardNavInvalidMovePreview();
    else setBoardNavInvalidMovePreview(direction);
    keyboardDirectionState.hasDispatched = true;
    keyboardDirectionState.nextActionAtMs = timestamp + resolveKeyboardDirectionRepeatDelay(
      directionKey,
      previousDirectionKey,
    );
  };

  const pollKeyboardDirectionFrame = (timestamp = nowMs()): void => {
    keyboardDirectionFrame = 0;
    if (!isGridFocusedForKeyboardBoardInput()) {
      resetKeyboardDirectionFrameState();
      return;
    }

    const direction = resolvePressedKeyboardDirection();
    const directionComponents = resolvePressedKeyboardDirectionComponents();
    if (!direction) {
      resetKeyboardDirectionFrameState();
      return;
    }

    const directionKey = `${direction.r},${direction.c}`;
    const previousDirectionKey = keyboardDirectionState.directionKey;
    const previousDirectionHadDispatched = keyboardDirectionState.hasDispatched;
    syncHeldKeyboardDirectionState(directionKey, previousDirectionKey, timestamp);
    dispatchHeldKeyboardDirection(
      timestamp,
      direction,
      directionComponents,
      directionKey,
      previousDirectionKey,
      previousDirectionHadDispatched,
    );

    refreshBoardNavVisibility();
    scheduleKeyboardDirectionPolling();
  };

  const activeElementBlocksGamepadBoardInput = (): boolean => {
    if (refs?.themeSwitchDialog?.open) return true;
    if (typeof document === 'undefined') return false;
    const activeElement = document.activeElement as (Element & Partial<ElementLike>) | null;
    if (
      !activeElement
      || activeElement === (refs?.gridEl as unknown as Element | null | undefined)
      || activeElement === (document.body as Element | null)
      || activeElement === (document.documentElement as Element | null)
      || eventTargetWithin(activeElement, refs?.gridEl)
    ) {
      return false;
    }
    if (typeof activeElement.closest === 'function' && activeElement.closest('dialog')) return true;
    const tagName = String(activeElement.tagName || '').toUpperCase();
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON' || tagName === 'A') {
      return true;
    }
    if (activeElement.isContentEditable) return true;
    return false;
  };

  const isGamepadButtonPressed = (
    button: StandardGamepadButtonLike | boolean | null | undefined,
  ): boolean => {
    if (!button) return false;
    if (typeof button === 'object') return button.pressed === true || Number(button.value ?? 0) > 0.5;
    return Boolean(button);
  };

  const resolveGamepadDirection = (gamepad: StandardGamepadLike | null): DirectionKey | null => {
    if (!gamepad) return null;

    const dpadDirections: DirectionKey[] = [];
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadUp])) dpadDirections.push('up');
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadDown])) dpadDirections.push('down');
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadLeft])) dpadDirections.push('left');
    if (isGamepadButtonPressed(gamepad.buttons?.[GAMEPAD_BUTTON_INDEX.dpadRight])) dpadDirections.push('right');
    if (dpadDirections.length === 1) return dpadDirections[0];
    if (dpadDirections.length > 1) return null;

    const axisX = Number(gamepad.axes?.[0]) || 0;
    const axisY = Number(gamepad.axes?.[1]) || 0;
    const absX = Math.abs(axisX);
    const absY = Math.abs(axisY);
    if (absX < GAMEPAD_STICK_DEADZONE && absY < GAMEPAD_STICK_DEADZONE) return null;
    if (absX >= GAMEPAD_STICK_DEADZONE && absY >= GAMEPAD_STICK_DEADZONE) return null;
    if (absX >= GAMEPAD_STICK_DEADZONE) return axisX < 0 ? 'left' : 'right';
    return axisY < 0 ? 'up' : 'down';
  };

  const resetGamepadState = (): void => {
    gamepadButtonsPressed.confirm = false;
    gamepadButtonsPressed.reverse = false;
    gamepadButtonsPressed.reset = false;
    gamepadButtonsPressed.prevLevel = false;
    gamepadButtonsPressed.nextLevel = false;
    gamepadDirectionState.direction = null;
    gamepadDirectionState.nextRepeatAtMs = 0;
  };

  const stopGamepadPolling = (): void => {
    if (gamepadPollFrame) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(gamepadPollFrame);
      }
      gamepadPollFrame = 0;
    }
    resetGamepadState();
  };

  const handleGamepadButtonEdge = (
    gamepad: StandardGamepadLike | null,
    key: GamepadButtonKey,
    index: number,
    handler: () => void,
  ): void => {
    const pressed = isGamepadButtonPressed(gamepad?.buttons?.[index]);
    if (pressed && !gamepadButtonsPressed[key]) {
      handler();
    }
    gamepadButtonsPressed[key] = pressed;
  };

  const pollGamepadFrame = (timestamp = nowMs()): void => {
    gamepadPollFrame = 0;
    if (!keyboardGamepadControlsEnabled || boardControlSuppressed) {
      refreshBoardNavVisibility();
      return;
    }

    const gamepad = getConnectedStandardGamepad();
    if (!gamepad || activeElementBlocksGamepadBoardInput()) {
      resetGamepadState();
      refreshBoardNavVisibility();
      scheduleGamepadPolling();
      return;
    }

    const direction = resolveGamepadDirection(gamepad);
    if (direction !== gamepadDirectionState.direction) {
      gamepadDirectionState.direction = direction;
      gamepadDirectionState.nextRepeatAtMs = 0;
      if (direction) {
        handleBoardDirectionalAction(direction);
        gamepadDirectionState.nextRepeatAtMs = timestamp + GAMEPAD_DIRECTION_INITIAL_DELAY_MS;
      }
    } else if (direction && timestamp >= gamepadDirectionState.nextRepeatAtMs) {
      handleBoardDirectionalAction(direction);
      gamepadDirectionState.nextRepeatAtMs = timestamp + GAMEPAD_DIRECTION_REPEAT_MS;
    }

    handleGamepadButtonEdge(gamepad, 'confirm', GAMEPAD_BUTTON_INDEX.confirm, () => {
      handleBoardShortcutAction('confirm');
    });
    handleGamepadButtonEdge(gamepad, 'reverse', GAMEPAD_BUTTON_INDEX.reverse, () => {
      handleBoardShortcutAction('reverse');
    });
    handleGamepadButtonEdge(gamepad, 'reset', GAMEPAD_BUTTON_INDEX.reset, () => {
      handleBoardShortcutAction('reset');
    });
    handleGamepadButtonEdge(gamepad, 'prevLevel', GAMEPAD_BUTTON_INDEX.prevLevel, () => {
      handleBoardShortcutAction('prevLevel');
    });
    handleGamepadButtonEdge(gamepad, 'nextLevel', GAMEPAD_BUTTON_INDEX.nextLevel, () => {
      handleBoardShortcutAction('nextLevel');
    });
    refreshBoardNavVisibility();
    scheduleGamepadPolling();
  };

  const scheduleGamepadPolling = (): void => {
    if (
      !keyboardGamepadControlsEnabled
      || boardControlSuppressed
      || gamepadPollFrame
      || typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    gamepadPollFrame = requestAnimationFrame((timestamp) => {
      pollGamepadFrame(timestamp);
    });
  };

  const pressKeyboardDirectionKey = (directionKey: DirectionKey): void => {
    if (!keyboardDirectionsPressed[directionKey]) {
      keyboardDirectionPressOrder[directionKey] = nextKeyboardDirectionPressOrder++;
    }
    keyboardDirectionsPressed[directionKey] = true;
    scheduleKeyboardDirectionPolling();
    refreshBoardNavVisibility();
  };

  const handleGridConfirmKeyDown = (event: KeyEventLike, confirmKeyId: ConfirmKeyId): void => {
    keyboardConfirmKeysPressed[confirmKeyId] = true;
    if (event.repeat) return;
    const handled = handleBoardShortcutAction('confirm');
    if (handled) return;
    const snapshot = readSnapshot();
    const cursor = boardCursorOrDefault(snapshot);
    setTransientBoardSelectionVisible(Boolean(cursor) && !isBoardCursorInteractive(snapshot, cursor));
  };

  const handleGridShortcutKeyDown = (key: string, repeat = false): void => {
    if (repeat) return;
    const shortcut = KEYBOARD_SHORTCUT_ACTIONS[key as keyof typeof KEYBOARD_SHORTCUT_ACTIONS] ?? null;
    if (!shortcut) return;
    handleBoardShortcutAction(shortcut);
  };

  const onGridKeyDown = (event: KeyEventLike): void => {
    if (!keyboardGamepadControlsEnabled) return;
    if (!refs?.gridEl || event?.altKey || event?.ctrlKey || event?.metaKey) return;
    if (
      typeof document !== 'undefined'
      && document.activeElement !== (refs.gridEl as unknown as Element | null)
    ) {
      return;
    }

    const key = event.key;
    if (!GAMEPLAY_KEYBOARD_KEYS.has(key)) return;
    event.preventDefault?.();
    const directionKey = KEYBOARD_DIRECTION_KEYS[key as keyof typeof KEYBOARD_DIRECTION_KEYS] ?? null;
    if (directionKey) {
      pressKeyboardDirectionKey(directionKey);
      return;
    }
    const confirmKeyId = resolveConfirmKeyId(key);
    if (confirmKeyId) {
      handleGridConfirmKeyDown(event, confirmKeyId);
      return;
    }
    handleGridShortcutKeyDown(key, event.repeat);
  };

  const onGridKeyUp = (event: KeyEventLike): void => {
    if (!refs?.gridEl) return;
    const confirmKeyId = resolveConfirmKeyId(event.key);
    if (confirmKeyId) {
      keyboardConfirmKeysPressed[confirmKeyId] = false;
      if (!keyboardConfirmKeysPressed.enter && !keyboardConfirmKeysPressed.space) {
        setTransientBoardSelectionVisible(false);
      }
      refreshBoardNavVisibility();
      return;
    }

    if (event.key === 'ArrowUp') {
      keyboardDirectionsPressed.up = false;
      keyboardDirectionPressOrder.up = 0;
    } else if (event.key === 'ArrowDown') {
      keyboardDirectionsPressed.down = false;
      keyboardDirectionPressOrder.down = 0;
    } else if (event.key === 'ArrowLeft') {
      keyboardDirectionsPressed.left = false;
      keyboardDirectionPressOrder.left = 0;
    } else if (event.key === 'ArrowRight') {
      keyboardDirectionsPressed.right = false;
      keyboardDirectionPressOrder.right = 0;
    }
    else return;

    clearBoardNavInvalidMovePreview();
    const remainingDirection = resolvePressedKeyboardDirection();
    if (remainingDirection) {
      armHeldKeyboardDirectionForRepeat(remainingDirection);
      scheduleKeyboardDirectionPolling();
    } else {
      pendingKeyboardDiagonalReplacement = null;
      stopKeyboardDirectionPolling();
    }
    refreshBoardNavVisibility();
  };

  const onGridFocus = (): void => {
    refreshBoardNavVisibility();
  };

  const onGridBlur = (): void => {
    clearKeyboardDirectionPressed();
    clearKeyboardConfirmPressed();
    clearKeyboardWallPreviewState();
    refreshBoardNavVisibility();
    scheduleGamepadPolling();
  };

  const beginPathDrag = ({
    side,
    applyPathCommands,
    metrics,
    pointerId,
    originCell,
  }: BeginPathDragOptions): void => {
    const gridEl = refs?.gridEl;
    if (!gridEl?.setPointerCapture) return;
    pathDrag = {
      side,
      applyPathCommands,
      moved: false,
      origin: { r: originCell.r, c: originCell.c },
      lastCursorKey: `${originCell.r},${originCell.c}`,
      lastHoverKey: `${originCell.r},${originCell.c}`,
    };
    dragGridMetrics = metrics;
    dragMode = 'path';
    activePointerId = pointerId;
    gridEl.setPointerCapture(pointerId);
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: true,
      pathDragSide: side,
      pathDragCursor: { r: originCell.r, c: originCell.c },
    });
  };

  const onPointerDown = (e: PointerLike): void => {
    const snapshot = readSnapshot();
    const gridEl = refs?.gridEl;
    if (!snapshot || !gridEl) return;
    const metrics = refreshDragGridMetrics(snapshot, true);
    const cell = pathCellFromPoint(e.clientX, e.clientY, snapshot, metrics);
    if (!cell) return;
    gridEl.focus?.();
    suspendBoardNavForPointerInteraction();

    const ch = snapshot.gridData?.[cell.r]?.[cell.c];

    if (ch === CELL_TYPES.MOVABLE_WALL) {
      dragMode = 'wall';
      activePointerId = e.pointerId;
      wallDrag = {
        from: { r: cell.r, c: cell.c },
        hover: null,
      };
      dragGridMetrics = metrics;
      gridEl.setPointerCapture?.(e.pointerId);
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
        visible: true,
        x: e.clientX,
        y: e.clientY,
        isWallDragging: true,
      });
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
      e.preventDefault?.();
      return;
    }

    if (!isUsableCell(snapshot, cell.r, cell.c)) return;

    if (snapshot.path.length === 0) {
      sendGameCommand(GAME_COMMANDS.START_OR_STEP, { r: cell.r, c: cell.c });
      const nextSnapshot = readSnapshot();
      if (!nextSnapshot) return;
      if (nextSnapshot.path.length === 0) return;

      beginPathDrag({
        side: 'end',
        applyPathCommands: true,
        metrics: refreshDragGridMetrics(nextSnapshot, true),
        pointerId: e.pointerId,
        originCell: cell,
      });
      e.preventDefault?.();
      return;
    }

    const tail = snapshot.path[snapshot.path.length - 1];
    const head = snapshot.path[0];
    if (!tail || !head) return;
    const isTail = tail.r === cell.r && tail.c === cell.c;
    const isHead = head.r === cell.r && head.c === cell.c;
    if (!isTail && !isHead) {
      beginPathDrag({
        side: null,
        applyPathCommands: false,
        metrics,
        pointerId: e.pointerId,
        originCell: cell,
      });
      e.preventDefault?.();
      return;
    }

    beginPathDrag({
      side: isHead ? 'start' : 'end',
      applyPathCommands: true,
      metrics,
      pointerId: e.pointerId,
      originCell: cell,
    });
    e.preventDefault?.();
  };

  const updatePathDragHover = (
    snapshot: GameSnapshot | null,
    pointerClientX: number,
    pointerClientY: number,
  ): void => {
    if (!pathDrag) return;
    const hoverMetrics = refreshDragGridMetrics(snapshot, true);
    const hoverCell = snapPathCellFromPoint(pointerClientX, pointerClientY, snapshot, hoverMetrics);
    const hoverKey = hoverCell ? `${hoverCell.r},${hoverCell.c}` : '';
    if (pathDrag.lastHoverKey === hoverKey) return;
    pathDrag.lastHoverKey = hoverKey;
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: true,
      pathDragSide: pathDrag.side,
      pathDragCursor: cloneCursor(hoverCell),
    });
  };

  const readPathDragPointerContext = (
    snapshot: GameSnapshot | null,
    pointerClientX: number,
    pointerClientY: number,
  ): PathPointerContext => {
    const metrics = refreshDragGridMetrics(snapshot, true);
    return buildPathDragPointerContext({
      snapshot,
      pointerClientX,
      pointerClientY,
      metrics,
      gridEl: refs?.gridEl,
      snapPathCellFromPoint,
      getCellSize: (scope?: unknown): number => getCellSize(scope as Element | null | undefined),
      cellCenter: (r: number, c: number, scope?: unknown): { x: number; y: number } => (
        cellCenter(r, c, scope as Element)
      ),
    });
  };

  const queuePathDragSteps = (
    snapshot: GameSnapshot | null,
    pointerContext: PathPointerContext,
  ): GridPoint[] => {
    const queued = buildQueuedPathDragSteps({
      snapshot,
      side: pathDrag?.side === 'start' ? 'start' : 'end',
      pointerContext,
      chooseStep: chooseSlipperyPathDragStepTyped,
      isUsableCell,
      isAdjacentMove: (nextSnapshot, a, b) => isAdjacentMove(nextSnapshot, a, b),
      pointsMatch,
    });

    if (pathDrag && queued.moved) {
      pathDrag.moved = true;
      pathDrag.lastCursorKey = queued.lastCursorKey ?? pathDrag.lastCursorKey;
    }
    return queued.steps;
  };

  const handleSlipperyPathPointerMove = (
    snapshot: GameSnapshot,
    pointerClientX: number,
    pointerClientY: number,
  ): void => {
    const currentPathDrag = pathDrag;
    if (!currentPathDrag) return;
    const queuedSteps = queuePathDragSteps(
      snapshot,
      readPathDragPointerContext(snapshot, pointerClientX, pointerClientY),
    );
    if (queuedSteps.length === 0) return;
    sendGameCommand(GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE, {
      side: currentPathDrag.side === 'start' ? 'start' : 'end',
      steps: queuedSteps,
    });
  };

  const handleSimplePathPointerMove = (
    pointerClientX: number,
    pointerClientY: number,
  ): void => {
    const cell = cellFromPoint(pointerClientX, pointerClientY);
    if (!cell) return;

    if (pathDrag && !pathDrag.moved) {
      if (pointsMatch(pathDrag.origin, cell)) return;
      pathDrag.moved = true;
    }

    const cursorKey = `${cell.r},${cell.c}`;
    const cursorChanged = pathDrag ? pathDrag.lastCursorKey !== cursorKey : true;
    if (!cursorChanged) return;

    if (pathDrag?.side === 'start') {
      sendGameCommand(GAME_COMMANDS.START_OR_STEP_FROM_START, { r: cell.r, c: cell.c });
    } else {
      sendGameCommand(GAME_COMMANDS.START_OR_STEP, { r: cell.r, c: cell.c });
    }

    if (pathDrag) pathDrag.lastCursorKey = cursorKey;
  };

  const handlePathPointerMove = (e: PointerLike): void => {
    if (e.cancelable) e.preventDefault?.();
    const pointerClientX = e.clientX;
    const pointerClientY = e.clientY;
    const snapshotForInput = pathDrag ? readSnapshot() : null;

    updatePathDragHover(snapshotForInput, pointerClientX, pointerClientY);
    if (pathDrag && !pathDrag.applyPathCommands) return;
    if (pathDrag && snapshotForInput) {
      handleSlipperyPathPointerMove(snapshotForInput, pointerClientX, pointerClientY);
      return;
    }
    handleSimplePathPointerMove(pointerClientX, pointerClientY);
  };

  const updateWallDragHover = (
    snapshot: GameSnapshot | null,
    cell: GridPoint | null,
  ): void => {
    if (!wallDrag) return;
    const previousHover = wallDrag.hover;
    if (!cell) {
      if (!previousHover) return;
      wallDrag.hover = null;
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
      return;
    }

    if (canDropWall(snapshot, wallDrag.from, cell)) {
      if (pointsMatch(previousHover, cell)) return;
      wallDrag.hover = { r: cell.r, c: cell.c };
      sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: wallDrag.hover });
      return;
    }

    if (!previousHover) return;
    wallDrag.hover = null;
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
  };

  const handleWallPointerMove = (e: PointerLike): void => {
    if (e.cancelable) e.preventDefault?.();
    queueWallDragGhostUpdate(e.clientX, e.clientY);
    const snapshot = readSnapshot();
    const metrics = refreshDragGridMetrics(snapshot, true);
    const cell = wallCellFromPoint(e.clientX, e.clientY, snapshot, metrics);
    updateWallDragHover(snapshot, cell);
  };

  const onPointerMove = (e: PointerLike): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;

    if (dragMode === 'path') {
      handlePathPointerMove(e);
      return;
    }

    if (dragMode === 'wall') {
      handleWallPointerMove(e);
    }
  };

  const onPointerUp = (e: PointerLike): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const finalMode = dragMode;
    const shouldFinalizePath = finalMode === 'path' && Boolean(pathDrag?.applyPathCommands);
    const wallMoveFrom = wallDrag?.from || null;
    const wallMoveTo = wallDrag?.hover || null;

    clearQueuedWallDragGhostUpdate();
    dragMode = null;
    activePointerId = null;
    wallDrag = null;
    pathDrag = null;
    dragGridMetrics = null;

    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DROP_TARGET, { dropTarget: null });
    sendInteractionUpdate(INTERACTION_UPDATES.WALL_DRAG, {
      visible: false,
      isWallDragging: false,
    });
    sendInteractionUpdate(INTERACTION_UPDATES.PATH_DRAG, {
      isPathDragging: false,
      pathDragSide: null,
      pathDragCursor: null,
    });

    if (finalMode === 'wall' && wallMoveFrom && wallMoveTo) {
      sendGameCommand(GAME_COMMANDS.WALL_MOVE_ATTEMPT, {
        from: wallMoveFrom,
        to: wallMoveTo,
      });
    }

    if (shouldFinalizePath) {
      sendGameCommand(GAME_COMMANDS.FINALIZE_PATH, {});
    }

    if (keyboardGamepadControlsEnabled) {
      syncBoardNavSnapshot(readSnapshot());
    }

    e.preventDefault?.();
  };

  return {
    bind({
      refs: nextRefs,
      readSnapshot: nextReadSnapshot,
      readLayoutMetrics: nextReadLayoutMetrics = () => null,
      emitIntent: nextEmitIntent,
    }): void {
      refs = nextRefs;
      readSnapshot = nextReadSnapshot;
      readLayoutMetrics = nextReadLayoutMetrics;
      emitIntent = nextEmitIntent;
      syncViewportScroll();

      const boundRefs = refs;
      if (!boundRefs?.gridEl) {
        throw new Error('createDomInputAdapter.bind requires refs.gridEl');
      }
      const boundWindow = typeof window !== 'undefined' ? window : null;
      const boundDocument = typeof document !== 'undefined' ? document : null;
      const boundVisualViewport = boundWindow?.visualViewport ?? null;

      addListener(boundRefs.boardFocusProxy, 'click', (e: { preventDefault?: () => void }) => {
        e.preventDefault?.();
        boundRefs.gridEl?.focus?.();
      });

      addListener(boundRefs.gridEl, 'pointerdown', onPointerDown);
      addListener(boundRefs.gridEl, 'pointermove', onPointerMove, { passive: false });
      addListener(boundRefs.gridEl, 'pointerup', onPointerUp, { passive: false });
      addListener(boundRefs.gridEl, 'pointercancel', onPointerUp, { passive: false });
      if (boundWindow) {
        addListener(boundWindow, 'scroll', syncViewportScroll, { passive: true });
      }
      if (boundVisualViewport) {
        addListener(boundVisualViewport, 'scroll', syncViewportScroll, { passive: true });
        addListener(boundVisualViewport, 'resize', syncViewportScroll, { passive: true });
      }

      addListener(boundRefs.levelSel, 'change', (e: ChangeEventLike) => {
        const value = Number.parseInt(e.target?.value ?? '', 10);
        if (!Number.isInteger(value)) return;
        sendUiAction(UI_ACTIONS.LEVEL_SELECT, { value });
      });

      addListener(boundRefs.infiniteSel, 'change', (e: ChangeEventLike) => {
        sendUiAction(UI_ACTIONS.INFINITE_SELECT, { value: String(e.target?.value || '') });
      });

      addListener(boundRefs.langSel, 'change', (e: ChangeEventLike) => {
        sendUiAction(UI_ACTIONS.LOCALE_CHANGE, { value: e.target?.value ?? '' });
      });

      addListener(boundRefs.themeToggle, 'click', () => {
        sendUiAction(UI_ACTIONS.THEME_TOGGLE);
      });

      addListener(boundRefs.lowPowerToggle, 'change', (e: ChangeEventLike) => {
        sendUiAction(UI_ACTIONS.LOW_POWER_TOGGLE, { enabled: Boolean(e.target?.checked) });
      });

      addListener(boundRefs.keyboardGamepadToggle, 'change', (e: ChangeEventLike) => {
        sendUiAction(UI_ACTIONS.KEYBOARD_GAMEPAD_CONTROLS_TOGGLE, { enabled: Boolean(e.target?.checked) });
      });

      addListener(boundRefs.settingsToggle, 'click', (e: { stopPropagation?: () => void }) => {
        e.stopPropagation?.();
        sendUiAction(UI_ACTIONS.SETTINGS_TOGGLE);
      });

      addListener(boundRefs.settingsPanel, 'click', (e: { stopPropagation?: () => void }) => {
        e.stopPropagation?.();
      });

      if (boundDocument) {
        addListener(boundDocument, 'pointerdown', (e: { target?: unknown }) => {
          const target = e.target;
          if (
            eventTargetWithin(target, boundRefs.settingsToggle)
            || eventTargetWithin(target, boundRefs.settingsPanel)
          ) {
            return;
          }
          sendUiAction(UI_ACTIONS.SETTINGS_CLOSE);
        });

        addListener(boundDocument, 'click', () => {
          sendUiAction(UI_ACTIONS.SETTINGS_CLOSE);
        });

        addListener(boundDocument, 'keydown', (e: KeyEventLike) => {
          if (e.key === 'Escape') {
            sendUiAction(UI_ACTIONS.DOCUMENT_ESCAPE);
          }
        });
        addListener(boundDocument, 'focusin', () => {
          refreshBoardNavVisibility();
          scheduleGamepadPolling();
        });
      }

      addListener(boundRefs.gridEl, 'keydown', onGridKeyDown);
      addListener(boundRefs.gridEl, 'keyup', onGridKeyUp);
      addListener(boundRefs.gridEl, 'focus', onGridFocus);
      addListener(boundRefs.gridEl, 'blur', onGridBlur);

      addListener(boundRefs.resetBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.RESET_CLICK);
      });

      addListener(boundRefs.reverseBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.REVERSE_CLICK);
      });

      addListener(boundRefs.nextLevelBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.NEXT_LEVEL_CLICK);
      });

      addListener(boundRefs.prevInfiniteBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.PREV_INFINITE_CLICK);
      });

      addListener(boundRefs.guideToggleBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.PANEL_TOGGLE, { panel: 'guide' });
      });

      addListener(boundRefs.legendToggleBtn, 'click', () => {
        sendUiAction(UI_ACTIONS.PANEL_TOGGLE, { panel: 'legend' });
      });

      addListener(boundRefs.themeSwitchDialog, 'close', () => {
        sendUiAction(UI_ACTIONS.THEME_DIALOG_CLOSE, {
          pendingTheme: boundRefs.themeSwitchDialog?.dataset?.pendingTheme,
          returnValue: boundRefs.themeSwitchDialog?.returnValue,
        });
      });
    },

    setKeyboardGamepadControlsEnabled(enabled) {
      const nextEnabled = Boolean(enabled);
      if (nextEnabled === keyboardGamepadControlsEnabled) return;
      keyboardGamepadControlsEnabled = nextEnabled;
      if (!keyboardGamepadControlsEnabled) {
        clearKeyboardDirectionPressed();
        clearKeyboardConfirmPressed();
        stopGamepadPolling();
        clearBoardNavState();
        return;
      }
      syncBoardNavSnapshot(readSnapshot());
      refreshBoardNavVisibility();
      scheduleGamepadPolling();
    },

    setBoardControlSuppressed(suppressed) {
      const nextSuppressed = Boolean(suppressed);
      if (nextSuppressed === boardControlSuppressed) return;
      boardControlSuppressed = nextSuppressed;
      clearKeyboardDirectionPressed();
      clearKeyboardConfirmPressed();
      clearKeyboardWallPreviewState();
      if (boardControlSuppressed) {
        stopGamepadPolling();
      } else if (keyboardGamepadControlsEnabled) {
        scheduleGamepadPolling();
      }
      refreshBoardNavVisibility();
    },

    syncSnapshot(snapshot = null) {
      if (!keyboardGamepadControlsEnabled) return;
      syncBoardNavSnapshot(snapshot || readSnapshot());
      refreshBoardNavVisibility();
      scheduleGamepadPolling();
    },

    unbind() {
      clearListeners();
      emitIntent = () => { };
      clearQueuedWallDragGhostUpdate();
      clearKeyboardDirectionPressed();
      clearKeyboardConfirmPressed();
      stopGamepadPolling();
      clearBoardNavState();
      dragMode = null;
      activePointerId = null;
      wallDrag = null;
      pathDrag = null;
      dragGridMetrics = null;
      keyboardGamepadControlsEnabled = false;
      boardControlSuppressed = false;
      refs = null;
      readSnapshot = () => null;
      readLayoutMetrics = () => null;
      lastBoardNavPayload = null;
      lastBoardNavLevelIndex = null;
    },
  };
}
