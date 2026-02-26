import {
  cacheElements,
  buildGrid,
  updateCells,
  setLegendIcons,
  resizeCanvas,
  setMessage,
  clearDropTarget,
  setDropTarget,
  showWallDragGhost,
  moveWallDragGhost,
  hideWallDragGhost,
} from '../renderer.js';

export function createDomRenderer(options = {}) {
  const icons = options.icons || {};
  const iconX = options.iconX || '';
  const COMPLETE_TOTAL_VAR = '--complete-cascade-total-ms';
  const COMPLETE_BASE_CELL_VAR = '--complete-cascade-cell-ms';
  const COMPLETE_STEP_VAR = '--complete-step-ms';
  const COMPLETE_CELL_VAR = '--complete-cell-duration-ms';
  const COMPLETE_PULSE_VAR = '--complete-done-pulse-ms';
  const COMPLETE_PULSE_STEP_VAR = '--complete-done-pulse-step-ms';
  const LATE_SOLVE_TRIGGER_GRACE_MS = 160;

  let refs = null;
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
  let completeFinishTimer = 0;
  let completePulseFrame = 0;
  let completePulseTimer = 0;
  let lateSolveTriggerUntilMs = 0;

  const setDraggingBodyClasses = (state = {}) => {
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

  const parseDurationMs = (value) => {
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

  const getCompleteTimingMs = () => {
    if (!refs?.boardWrap || typeof getComputedStyle !== 'function') {
      return {
        totalMs: 0,
        stepMs: 0,
        cellMs: 0,
        pulseMs: 0,
        pulseStepMs: 0,
      };
    }
    const styles = getComputedStyle(refs.boardWrap);
    const totalMs = parseDurationMs(styles.getPropertyValue(COMPLETE_TOTAL_VAR));
    const stepMs = parseDurationMs(styles.getPropertyValue(COMPLETE_STEP_VAR));
    const baseCellMs = parseDurationMs(styles.getPropertyValue(COMPLETE_BASE_CELL_VAR));
    const cellMs = baseCellMs > 0
      ? baseCellMs
      : parseDurationMs(styles.getPropertyValue(COMPLETE_CELL_VAR));
    const pulseMs = parseDurationMs(styles.getPropertyValue(COMPLETE_PULSE_VAR));
    const pulseStepMs = parseDurationMs(styles.getPropertyValue(COMPLETE_PULSE_STEP_VAR));
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

  const clearCompletePulse = () => {
    if (completePulseFrame) {
      cancelAnimationFrame(completePulseFrame);
      completePulseFrame = 0;
    }
    if (completePulseTimer) {
      clearTimeout(completePulseTimer);
      completePulseTimer = 0;
    }
    if (refs?.boardWrap) refs.boardWrap.classList.remove('isCompletePulse');
  };

  const triggerCompletePulse = (pulseTotalMs) => {
    clearCompletePulse();
    if (!refs?.boardWrap || !(pulseTotalMs > 0)) return;
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

  const scheduleCompleteFinish = (durationMs, pulseTotalMs) => {
    clearCompleteFinishTimer();
    if (!(durationMs > 0)) return;
    completeFinishTimer = setTimeout(() => {
      completeFinishTimer = 0;
      completionCascadeState.isCompleting = false;
      if (refs?.boardWrap) {
        refs.boardWrap.classList.remove('isCompleting');
      }
      triggerCompletePulse(pulseTotalMs);
    }, durationMs + 16);
  };

  const prefersReducedMotion = () => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const isSolvedSnapshot = (snapshot, evaluation) => {
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

  return {
    mount(shellRefs = null) {
      refs = shellRefs || cacheElements();
      setLegendIcons(icons, refs, iconX);
    },

    getRefs() {
      return refs;
    },

    rebuildGrid(snapshot) {
      if (!refs) return;
      buildGrid(snapshot, refs, icons, iconX);
    },

    renderFrame({
      snapshot,
      evaluation,
      completion = null,
      uiModel = {},
      interactionModel = {},
    }) {
      if (!refs) return;
      const timeNow = nowMs();
      const solvedByValidation = completion?.kind === 'good';
      const solvedBySnapshot = isSolvedSnapshot(snapshot, evaluation);
      const solvedBySnapshotAllowed = Boolean(
        solvedBySnapshot
        && (!interactionModel.isPathDragging || completionCascadeState.isSolved),
      );
      const solved = Boolean(solvedByValidation || solvedBySnapshotAllowed);
      if (lateSolveTriggerUntilMs > 0 && timeNow > lateSolveTriggerUntilMs) {
        lateSolveTriggerUntilMs = 0;
      }
      const timing = getCompleteTimingMs();
      const pathLength = Math.max(1, snapshot.path.length);
      const reducedMotion = prefersReducedMotion();
      let stepMs = reducedMotion ? 0 : timing.stepMs;
      let cellMs = reducedMotion ? 0 : timing.cellMs;
      const pulseMs = reducedMotion ? 0 : timing.pulseMs;
      const pulseStepMs = reducedMotion ? 0 : timing.pulseStepMs;
      const fallbackTotalMs = (Math.max(0, pathLength - 1) * stepMs) + cellMs;
      const configuredTotalMs = reducedMotion
        ? 0
        : (timing.totalMs > 0 ? timing.totalMs : fallbackTotalMs);
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
      const pulseTotalMs = pulseMs + (maxDiagOrder * pulseStepMs);
      const shouldAnimateSolve = Boolean(
        uiModel.completionAnimationTrigger
        && hasRenderedFrame
        && totalMs > 0,
      );

      if (refs.boardWrap) {
        refs.boardWrap.style.setProperty(COMPLETE_STEP_VAR, `${stepMs}ms`);
        refs.boardWrap.style.setProperty(COMPLETE_CELL_VAR, `${cellMs}ms`);
      }

      if (solved && !completionCascadeState.isSolved) {
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
      } else if (
        solved
        && shouldAnimateSolve
        && !completionCascadeState.isCompleting
        && lateSolveTriggerUntilMs > 0
        && timeNow <= lateSolveTriggerUntilMs
      ) {
        clearCompletePulse();
        completionCascadeState = {
          isSolved: true,
          isCompleting: true,
          startTimeMs: timeNow,
          durationMs: totalMs,
        };
        lateSolveTriggerUntilMs = 0;
        scheduleCompleteFinish(totalMs, pulseTotalMs);
      } else if (!solved && completionCascadeState.isSolved) {
        completionCascadeState = {
          isSolved: false,
          isCompleting: false,
          startTimeMs: 0,
          durationMs: 0,
        };
        lateSolveTriggerUntilMs = 0;
        clearCompleteFinishTimer();
        clearCompletePulse();
      } else if (solved && completionCascadeState.isCompleting) {
        const elapsedMs = timeNow - completionCascadeState.startTimeMs;
        if (elapsedMs >= completionCascadeState.durationMs) {
          clearCompleteFinishTimer();
          completionCascadeState.isCompleting = false;
          triggerCompletePulse(pulseTotalMs);
        }
      }

      const completionModel = solved
        ? {
          isSolved: true,
          isCompleting: completionCascadeState.isCompleting,
          startTimeMs: completionCascadeState.startTimeMs,
          durationMs: completionCascadeState.durationMs,
        }
        : null;

      updateCells(snapshot, evaluation, refs, completionModel);

      if (Object.prototype.hasOwnProperty.call(uiModel, 'messageHtml')) {
        setMessage(refs.msgEl, uiModel.messageKind || null, uiModel.messageHtml || '');
      }

      if (interactionModel.dropTarget && Number.isInteger(interactionModel.dropTarget.r) && Number.isInteger(interactionModel.dropTarget.c)) {
        setDropTarget(interactionModel.dropTarget.r, interactionModel.dropTarget.c);
      } else {
        clearDropTarget();
      }

      const ghost = interactionModel.wallGhost;
      if (ghost?.visible) {
        showWallDragGhost(ghost.x || 0, ghost.y || 0);
        moveWallDragGhost(ghost.x || 0, ghost.y || 0);
      } else {
        hideWallDragGhost();
      }

      setDraggingBodyClasses(interactionModel);

      if (refs.boardWrap) {
        refs.boardWrap.classList.toggle('isComplete', solved);
        refs.boardWrap.classList.toggle('isCompleting', solved && completionCascadeState.isCompleting);
        if (!solved) refs.boardWrap.classList.remove('isCompletePulse');
      }

      if (refs.boardWrap && uiModel.tutorialFlags) {
        refs.boardWrap.classList.toggle('tutorialPathBrackets', Boolean(uiModel.tutorialFlags.path));
        refs.boardWrap.classList.toggle('tutorialMovableBrackets', Boolean(uiModel.tutorialFlags.movable));
      }

      hasRenderedFrame = true;
    },

    resize() {
      if (!refs) return;
      resizeCanvas(refs);
    },

    unmount() {
      clearDropTarget();
      hideWallDragGhost();
      setDraggingBodyClasses({ isWallDragging: false, isPathDragging: false });
      if (refs?.boardWrap) {
        refs.boardWrap.classList.remove('isComplete', 'isCompleting', 'isCompletePulse');
      }
      clearCompleteFinishTimer();
      clearCompletePulse();
      hasRenderedFrame = false;
      lateSolveTriggerUntilMs = 0;
      completionCascadeState = {
        isSolved: false,
        isCompleting: false,
        startTimeMs: 0,
        durationMs: 0,
      };
    },
  };
}
