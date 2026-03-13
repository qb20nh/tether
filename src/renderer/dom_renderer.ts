import { isReducedMotionPreferred as readReducedMotionPreference } from '../reduced_motion.ts';
import type {
  BoardLayoutMetrics,
  CompletionResult,
  EvaluateResult,
  GameSnapshot,
  InteractionModel,
  RendererPort,
  RendererRefs,
  RuntimeData,
  UiRenderModel,
} from '../contracts/ports.ts';
import {
  createBoardRendererCore,
} from './board_renderer_core.ts';

interface DomRendererOptions {
  icons?: Record<string, string>;
  iconX?: string;
}

interface CompletionTiming {
  totalMs: number;
  stepMs: number;
  cellMs: number;
  pulseMs: number;
  pulseStepMs: number;
}

interface CompletionModel {
  isSolved: true;
  isCompleting: boolean;
  startTimeMs: number;
  durationMs: number;
}

interface BoardRendererCoreAdapter {
  mount: (shellRefs?: RendererRefs | null) => void;
  getRefs: () => RendererRefs;
  rebuildGrid: (snapshot: GameSnapshot) => void;
  renderFrame: (payload: {
    snapshot: GameSnapshot;
    evaluation: EvaluateResult;
    completion?: CompletionModel | null;
    uiModel?: UiRenderModel;
    interactionModel?: InteractionModel;
  }) => void;
  resize: () => void;
  getLayoutMetrics: () => BoardLayoutMetrics | null;
  notifyResizeInteraction: () => void;
  setLowPowerMode: (enabled: boolean) => void;
  setPathFlowFreezeImmediate: (isFrozen: boolean) => void;
  recordPathTransition: (
    previousSnapshot: GameSnapshot,
    nextSnapshot: GameSnapshot,
    interactionModel?: InteractionModel | null,
  ) => void;
  clearPathTransitionCompensation: () => void;
  updateInteraction: (interactionModel?: InteractionModel) => void;
  destroy: (options?: RuntimeData) => void;
}

interface DebugWindow extends Window {
  TETHER_DEBUG_ANIM_SPEED?: number;
}

export function createDomRenderer(options: DomRendererOptions = {}): RendererPort {
  const icons = options.icons || {};
  const iconX = options.iconX || '';
  const COMPLETE_TOTAL_VAR = '--complete-cascade-total-ms';
  const COMPLETE_BASE_CELL_VAR = '--complete-cascade-cell-ms';
  const COMPLETE_STEP_VAR = '--complete-step-ms';
  const COMPLETE_CELL_VAR = '--complete-cell-duration-ms';
  const COMPLETE_PULSE_VAR = '--complete-done-pulse-ms';
  const COMPLETE_PULSE_STEP_VAR = '--complete-done-pulse-step-ms';
  const LATE_SOLVE_TRIGGER_GRACE_MS = 160;
  const boardRendererCore = createBoardRendererCore({ icons, iconX }) as unknown as BoardRendererCoreAdapter;

  let refs: RendererRefs | null = null;
  let lastBodyClassState = {
    isWallDragging: false,
    isPathDragging: false,
  };
  let hasRenderedFrame = false;
  let completionCascadeState = {
    isSolved: false,
    isCompleting: false,
    startTimeMs: 0,
    durationMs: 0,
  };
  let completeFinishTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let completePulseFrame = 0;
  let completePulseTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let lateSolveTriggerUntilMs = 0;
  let lowPowerModeEnabled = false;
  let pendingCompletePulseClassClear = false;

  const setDraggingBodyClasses = (state: InteractionModel = {}) => {
    if (typeof document === 'undefined' || !document.body) return;
    const nextWall = Boolean(state.isWallDragging);
    const nextPath = Boolean(state.isPathDragging);

    if (nextWall !== lastBodyClassState.isWallDragging) {
      document.body.classList.toggle('isWallDragging', nextWall);
      lastBodyClassState.isWallDragging = nextWall;
    }

    if (nextPath !== lastBodyClassState.isPathDragging) {
      document.body.classList.toggle('isPathDragging', nextPath);
      lastBodyClassState.isPathDragging = nextPath;
    }
  };

  const nowMs = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  const parseDurationMs = (value: unknown): number => {
    if (typeof value !== 'string') return 0;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return 0;
    if (trimmed.endsWith('ms')) {
      const parsed = Number.parseFloat(trimmed.slice(0, -2));
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
    if (trimmed.endsWith('s')) {
      const parsed = Number.parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(parsed) ? Math.max(0, parsed * 1000) : 0;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };

  const getCompleteTimingMs = (): CompletionTiming => {
    if (!refs?.boardWrap || typeof getComputedStyle !== 'function') {
      return {
        totalMs: 0,
        stepMs: 0,
        cellMs: 0,
        pulseMs: 0,
        pulseStepMs: 0,
      };
    }
    const styles = getComputedStyle(refs.boardWrap as unknown as Element);
    const debugWindow = (typeof window === 'undefined' ? undefined : window) as DebugWindow | undefined;

    const speedMultiplier = import.meta?.env?.DEV && typeof debugWindow?.TETHER_DEBUG_ANIM_SPEED === 'number'
      ? Math.max(0.1, debugWindow.TETHER_DEBUG_ANIM_SPEED)
      : 1;

    const totalMs = parseDurationMs(styles.getPropertyValue(COMPLETE_TOTAL_VAR)) * speedMultiplier;
    const stepMs = parseDurationMs(styles.getPropertyValue(COMPLETE_STEP_VAR)) * speedMultiplier;
    const baseCellMs = parseDurationMs(styles.getPropertyValue(COMPLETE_BASE_CELL_VAR)) * speedMultiplier;
    const fallbackCellMs = parseDurationMs(styles.getPropertyValue(COMPLETE_CELL_VAR)) * speedMultiplier;
    const cellMs = baseCellMs > 0 ? baseCellMs : fallbackCellMs;
    const pulseMs = parseDurationMs(styles.getPropertyValue(COMPLETE_PULSE_VAR)) * speedMultiplier;
    const pulseStepMs = parseDurationMs(styles.getPropertyValue(COMPLETE_PULSE_STEP_VAR)) * speedMultiplier;
    return {
      totalMs,
      stepMs,
      cellMs,
      pulseMs,
      pulseStepMs,
    };
  };

  const clearCompleteFinishTimer = () => {
    if (!completeFinishTimer) return;
    clearTimeout(completeFinishTimer);
    completeFinishTimer = 0;
  };

  const clearCompletePulse = (options: { preserveClass?: boolean } = {}) => {
    const preserveClass = Boolean(options.preserveClass);
    if (completePulseFrame) {
      cancelAnimationFrame(completePulseFrame);
      completePulseFrame = 0;
    }
    if (completePulseTimer) {
      clearTimeout(completePulseTimer);
      completePulseTimer = 0;
    }
    if (preserveClass) {
      pendingCompletePulseClassClear = true;
      return;
    }
    pendingCompletePulseClassClear = false;
    if (refs?.boardWrap) refs.boardWrap.classList.remove('isCompletePulse');
  };

  const triggerCompletePulse = (pulseTotalMs: number) => {
    clearCompletePulse();
    if (!refs?.boardWrap || pulseTotalMs <= 0) return;
    pendingCompletePulseClassClear = false;
    completePulseFrame = requestAnimationFrame(() => {
      completePulseFrame = 0;
      if (!refs?.boardWrap || !completionCascadeState.isSolved) return;
      refs.boardWrap.classList.add('isCompletePulse');
      completePulseTimer = setTimeout(() => {
        completePulseTimer = 0;
        if (refs?.boardWrap) refs.boardWrap.classList.remove('isCompletePulse');
      }, pulseTotalMs + 24);
    });
  };

  const scheduleCompleteFinish = (durationMs: number, pulseTotalMs: number) => {
    clearCompleteFinishTimer();
    if (durationMs <= 0) return;
    completeFinishTimer = setTimeout(() => {
      completeFinishTimer = 0;
      completionCascadeState.isCompleting = false;
      if (refs?.boardWrap) {
        refs.boardWrap.classList.remove('isCompleting');
      }
      triggerCompletePulse(pulseTotalMs);
    }, durationMs + 16);
  };

  const syncBoardWrapClasses = (solved = completionCascadeState.isSolved) => {
    if (!refs?.boardWrap) return;
    refs.boardWrap.classList.toggle('isLowPowerMode', lowPowerModeEnabled);
    refs.boardWrap.classList.toggle('isComplete', solved);
    refs.boardWrap.classList.toggle('isCompleting', solved && completionCascadeState.isCompleting);
    if (!solved || pendingCompletePulseClassClear) {
      refs.boardWrap.classList.remove('isCompletePulse');
      pendingCompletePulseClassClear = false;
    }
    refs.boardWrap.classList.remove('tutorialBracketNormalBlend');
  };

  const prefersReducedMotion = () => (
    lowPowerModeEnabled
    || readReducedMotionPreference()
  );

  const isSolvedSnapshot = (
    snapshot: GameSnapshot | null | undefined,
    evaluation: EvaluateResult | null | undefined,
  ) => {
    if (!snapshot || !evaluation) return false;
    const hintStatus = evaluation.hintStatus;
    const stitchStatus = evaluation.stitchStatus;
    const rpsStatus = evaluation.rpsStatus;

    const allVisited = snapshot.path.length === snapshot.totalUsable;
    const hintsOk = hintStatus?.total === 0
      ? true
      : (hintStatus?.bad === 0 && hintStatus?.good === hintStatus?.total);
    const stitchesOk = stitchStatus?.total === 0
      ? true
      : (stitchStatus?.bad === 0 && stitchStatus?.good === stitchStatus?.total);
    const rpsOk = rpsStatus?.total === 0 ? true : rpsStatus?.bad === 0;

    return allVisited && hintsOk && stitchesOk && rpsOk;
  };

  const hasPendingPathFinalizeInteraction = (interactionModel: InteractionModel = {}) => (
    interactionModel?.isPathDragging === true
    || (
      interactionModel?.isBoardNavActive === true
      && (
        interactionModel?.boardSelection?.kind === 'path-start'
        || interactionModel?.boardSelection?.kind === 'path-end'
      )
    )
  );

  const isSolvedRenderFrame = ({
    snapshot,
    evaluation,
    completion,
    interactionModel,
  }: {
    snapshot: GameSnapshot;
    evaluation: EvaluateResult;
    completion?: CompletionResult | null;
    interactionModel?: InteractionModel;
  }) => {
    if (completion?.kind === 'good') return true;
    if (!isSolvedSnapshot(snapshot, evaluation)) return false;
    return Boolean(
      completionCascadeState.isSolved
      || !hasPendingPathFinalizeInteraction(interactionModel),
    );
  };

  const getConfiguredCompleteTotalMs = ({
    reducedMotion,
    timing,
    fallbackTotalMs,
  }: {
    reducedMotion: boolean;
    timing: CompletionTiming;
    fallbackTotalMs: number;
  }) => {
    if (reducedMotion) return 0;
    if (timing.totalMs > 0) return timing.totalMs;
    return fallbackTotalMs;
  };

  const getCompletionTiming = (snapshot: GameSnapshot) => {
    const timing = getCompleteTimingMs();
    const pathLength = Math.max(1, snapshot.path.length);
    const reducedMotion = prefersReducedMotion();
    let stepMs = 0;
    let cellMs = 0;
    let pulseMs = 0;
    let pulseStepMs = 0;

    if (!reducedMotion) {
      stepMs = timing.stepMs;
      cellMs = timing.cellMs;
      pulseMs = timing.pulseMs;
      pulseStepMs = timing.pulseStepMs;
    }

    const fallbackTotalMs = (Math.max(0, pathLength - 1) * stepMs) + cellMs;
    const configuredTotalMs = getConfiguredCompleteTotalMs({
      reducedMotion,
      timing,
      fallbackTotalMs,
    });
    let totalMs = configuredTotalMs;

    if (!reducedMotion && configuredTotalMs > 0) {
      if (pathLength <= 1) {
        stepMs = 0;
        cellMs = configuredTotalMs;
      } else {
        const clampedCellMs = Math.min(Math.max(0, cellMs), configuredTotalMs);
        cellMs = clampedCellMs;
        stepMs = Math.max(0, (configuredTotalMs - clampedCellMs) / (pathLength - 1));
      }
      totalMs = configuredTotalMs;
    }

    const maxDiagOrder = Math.max(0, (snapshot.rows - 1) + (snapshot.cols - 1));
    return {
      stepMs,
      cellMs,
      totalMs,
      pulseTotalMs: pulseMs + (maxDiagOrder * pulseStepMs),
    };
  };

  const syncCompletionTimingStyles = ({ stepMs, cellMs }: { stepMs: number; cellMs: number }) => {
    if (!refs?.boardWrap) return;
    refs.boardWrap.style.setProperty(COMPLETE_STEP_VAR, `${stepMs}ms`);
    refs.boardWrap.style.setProperty(COMPLETE_CELL_VAR, `${cellMs}ms`);
  };

  const startCompletionCascade = ({
    timeNow,
    shouldAnimateSolve,
    totalMs,
    pulseTotalMs,
  }: {
    timeNow: number;
    shouldAnimateSolve: boolean;
    totalMs: number;
    pulseTotalMs: number;
  }) => {
    clearCompletePulse();
    completionCascadeState = {
      isSolved: true,
      isCompleting: shouldAnimateSolve,
      startTimeMs: timeNow,
      durationMs: shouldAnimateSolve ? totalMs : 0,
    };
    lateSolveTriggerUntilMs = shouldAnimateSolve ? 0 : (timeNow + LATE_SOLVE_TRIGGER_GRACE_MS);
    if (shouldAnimateSolve) scheduleCompleteFinish(totalMs, pulseTotalMs);
    else clearCompleteFinishTimer();
  };

  const triggerDeferredCompletionCascade = ({
    timeNow,
    totalMs,
    pulseTotalMs,
  }: {
    timeNow: number;
    totalMs: number;
    pulseTotalMs: number;
  }) => {
    clearCompletePulse();
    completionCascadeState = {
      isSolved: true,
      isCompleting: true,
      startTimeMs: timeNow,
      durationMs: totalMs,
    };
    lateSolveTriggerUntilMs = 0;
    scheduleCompleteFinish(totalMs, pulseTotalMs);
  };

  const resetCompletionCascade = () => {
    completionCascadeState = {
      isSolved: false,
      isCompleting: false,
      startTimeMs: 0,
      durationMs: 0,
    };
    lateSolveTriggerUntilMs = 0;
    clearCompleteFinishTimer();
    clearCompletePulse();
  };

  const finishCompletionCascadeIfElapsed = ({
    timeNow,
    pulseTotalMs,
  }: {
    timeNow: number;
    pulseTotalMs: number;
  }) => {
    const elapsedMs = timeNow - completionCascadeState.startTimeMs;
    if (elapsedMs < completionCascadeState.durationMs) return;
    clearCompleteFinishTimer();
    completionCascadeState.isCompleting = false;
    triggerCompletePulse(pulseTotalMs);
  };

  const updateCompletionCascade = ({
    solved,
    shouldAnimateSolve,
    timeNow,
    totalMs,
    pulseTotalMs,
  }: {
    solved: boolean;
    shouldAnimateSolve: boolean;
    timeNow: number;
    totalMs: number;
    pulseTotalMs: number;
  }) => {
    if (lateSolveTriggerUntilMs > 0 && timeNow > lateSolveTriggerUntilMs) {
      lateSolveTriggerUntilMs = 0;
    }

    if (solved && !completionCascadeState.isSolved) {
      startCompletionCascade({
        timeNow,
        shouldAnimateSolve,
        totalMs,
        pulseTotalMs,
      });
      return;
    }

    if (
      solved
      && shouldAnimateSolve
      && !completionCascadeState.isCompleting
      && lateSolveTriggerUntilMs > 0
      && timeNow <= lateSolveTriggerUntilMs
    ) {
      triggerDeferredCompletionCascade({
        timeNow,
        totalMs,
        pulseTotalMs,
      });
      return;
    }

    if (!solved && completionCascadeState.isSolved) {
      resetCompletionCascade();
      return;
    }

    if (solved && completionCascadeState.isCompleting) {
      finishCompletionCascadeIfElapsed({
        timeNow,
        pulseTotalMs,
      });
    }
  };

  const getCompletionModel = (solved: boolean): CompletionModel | null => {
    if (!solved) return null;
    return {
      isSolved: true,
      isCompleting: completionCascadeState.isCompleting,
      startTimeMs: completionCascadeState.startTimeMs,
      durationMs: completionCascadeState.durationMs,
    };
  };

  return {
    mount(shellRefs: RendererRefs | null = null) {
      boardRendererCore.mount(shellRefs);
      refs = boardRendererCore.getRefs();
      syncBoardWrapClasses();
    },

    getRefs() {
      return boardRendererCore.getRefs();
    },

    rebuildGrid(snapshot: GameSnapshot) {
      boardRendererCore.rebuildGrid(snapshot);
    },

    renderFrame({
      snapshot,
      evaluation,
      completion = null,
      uiModel = {},
      interactionModel = {},
    }: {
      snapshot: GameSnapshot;
      evaluation: EvaluateResult;
      completion?: CompletionResult | null;
      uiModel?: UiRenderModel;
      interactionModel?: InteractionModel;
    }) {
      if (!refs) return;
      const timeNow = nowMs();
      const solved = isSolvedRenderFrame({
        snapshot,
        evaluation,
        completion,
        interactionModel,
      });
      const {
        stepMs,
        cellMs,
        totalMs,
        pulseTotalMs,
      } = getCompletionTiming(snapshot);
      const shouldAnimateSolve = Boolean(
        uiModel.completionAnimationTrigger
        && hasRenderedFrame
        && totalMs > 0,
      );
      syncCompletionTimingStyles({ stepMs, cellMs });
      updateCompletionCascade({
        solved,
        shouldAnimateSolve,
        timeNow,
        totalMs,
        pulseTotalMs,
      });
      const completionModel = getCompletionModel(solved);

      boardRendererCore.renderFrame({
        snapshot,
        evaluation,
        completion: completionModel,
        uiModel,
        interactionModel,
      });
      setDraggingBodyClasses(interactionModel);
      syncBoardWrapClasses(solved);

      hasRenderedFrame = true;
    },

    resize() {
      boardRendererCore.resize();
    },

    getLayoutMetrics() {
      return boardRendererCore.getLayoutMetrics();
    },

    notifyResizeInteraction() {
      boardRendererCore.notifyResizeInteraction();
    },

    setLowPowerMode(enabled = false) {
      const nextEnabled = Boolean(enabled);
      if (nextEnabled === lowPowerModeEnabled) return;
      lowPowerModeEnabled = nextEnabled;
      syncBoardWrapClasses();
      if (lowPowerModeEnabled) {
        clearCompleteFinishTimer();
        clearCompletePulse({ preserveClass: true });
        lateSolveTriggerUntilMs = 0;
        completionCascadeState = {
          ...completionCascadeState,
          isCompleting: false,
          durationMs: 0,
        };
      }
      boardRendererCore.setLowPowerMode(lowPowerModeEnabled);
    },

    setPathFlowFreezeImmediate(isFrozen = false) {
      boardRendererCore.setPathFlowFreezeImmediate(isFrozen);
    },

    recordPathTransition(
      previousSnapshot: GameSnapshot,
      nextSnapshot: GameSnapshot,
      interactionModel: InteractionModel | null = null,
    ) {
      boardRendererCore.recordPathTransition(previousSnapshot, nextSnapshot, interactionModel);
    },

    clearPathTransitionCompensation() {
      boardRendererCore.clearPathTransitionCompensation();
    },

    updateInteraction(interactionModel: InteractionModel = {}) {
      boardRendererCore.updateInteraction(interactionModel);
      setDraggingBodyClasses(interactionModel);
    },

    unmount(options: RuntimeData = {}) {
      setDraggingBodyClasses({ isWallDragging: false, isPathDragging: false });
      boardRendererCore.destroy(options);
      if (refs?.boardWrap) {
        refs.boardWrap.classList.remove(
          'isComplete',
          'isCompleting',
          'isCompletePulse',
          'tutorialBracketNormalBlend',
          'isLowPowerMode',
        );
      }
      clearCompleteFinishTimer();
      clearCompletePulse();
      hasRenderedFrame = false;
      lateSolveTriggerUntilMs = 0;
      lowPowerModeEnabled = false;
      pendingCompletePulseClassClear = false;
      completionCascadeState = {
        isSolved: false,
        isCompleting: false,
        startTimeMs: 0,
        durationMs: 0,
      };
      refs = null;
    },
  };
}
