import type {
  DialogElementLike,
  ElementLike,
  NotificationDialogController,
  NotificationDialogControllerOptions,
  WindowLike,
} from '../contracts/ports.ts';

const FALLBACK_WINDOW: WindowLike = {
  confirm: () => false,
  clearInterval: () => { },
  setInterval: () => 0,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => { },
  getComputedStyle: () => ({}),
  addEventListener: () => { },
  removeEventListener: () => { },
};

export function createNotificationDialogController(
  options: NotificationDialogControllerOptions,
): NotificationDialogController {
  const {
    elementIds,
    translateNow = (key) => key,
    windowObj = (typeof window === 'undefined' ? undefined : window) as WindowLike | undefined,
    documentObj = (typeof document === 'undefined' ? undefined : document) as NotificationDialogControllerOptions['documentObj'],
  } = options;
  const activeWindow = windowObj || FALLBACK_WINDOW;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationDialogController requires elementIds');
  }

  let updateApplyDialogEl: DialogElementLike | null = null;
  let updateApplyMessageEl: ElementLike | null = null;
  let updateApplyDialogBound = false;
  let moveDailyDialogEl: DialogElementLike | null = null;
  let moveDailyMessageEl: ElementLike | null = null;
  let moveDailyDialogBound = false;
  let moveDailyDialogResolver: ((confirmed: boolean) => void) | null = null;
  let updateApplyDialogResolver: ((confirmed: boolean) => void) | null = null;

  const resolveUpdateApplyDialogPromptText = (buildNumber: number | null = null) => {
    const prompt = translateNow('ui.updateApplyDialogPrompt');
    if (prompt !== 'ui.updateApplyDialogPrompt') return prompt;
    const resolvedBuildNumber = Number.isInteger(buildNumber) ? buildNumber : null;
    if (resolvedBuildNumber !== null && resolvedBuildNumber > 0) {
      return `Install build ${resolvedBuildNumber}?`;
    }
    return 'Install the latest version now?';
  };

  const resolveMoveDailyDialogPromptText = () => {
    const localized = translateNow('ui.moveDailyDialogPrompt');
    if (localized !== 'ui.moveDailyDialogPrompt') return localized;
    return 'You have an unfinished level. Move to Daily level anyway?';
  };

  const bindUpdateApplyDialog = () => {
    if (!documentObj) return;

    updateApplyDialogEl = documentObj.getElementById(elementIds.UPDATE_APPLY_DIALOG) as DialogElementLike | null;
    updateApplyMessageEl = documentObj.getElementById(elementIds.UPDATE_APPLY_MESSAGE);

    if (!updateApplyDialogEl || updateApplyDialogBound) return;

    const dialog = updateApplyDialogEl;
    dialog.addEventListener('close', () => {
      const shouldApply = dialog.returnValue === 'confirm';
      delete dialog.dataset.pendingBuildNumber;
      dialog.returnValue = '';
      const resolve = updateApplyDialogResolver;
      updateApplyDialogResolver = null;
      if (typeof resolve === 'function') {
        resolve(shouldApply);
      }
    });

    updateApplyDialogBound = true;
  };

  const bindMoveDailyDialog = () => {
    if (!documentObj) return;

    moveDailyDialogEl = documentObj.getElementById(elementIds.MOVE_DAILY_DIALOG) as DialogElementLike | null;
    moveDailyMessageEl = documentObj.getElementById(elementIds.MOVE_DAILY_MESSAGE);

    if (!moveDailyDialogEl || moveDailyDialogBound) return;

    const dialog = moveDailyDialogEl;
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.returnValue = '';
      const resolve = moveDailyDialogResolver;
      moveDailyDialogResolver = null;
      if (typeof resolve === 'function') {
        resolve(confirmed);
      }
    });

    moveDailyDialogBound = true;
  };

  const requestUpdateApplyConfirmation = async (buildNumber: number): Promise<boolean> => {
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return false;
    if (!updateApplyDialogEl || typeof updateApplyDialogEl.showModal !== 'function') {
      return activeWindow.confirm(resolveUpdateApplyDialogPromptText(buildNumber));
    }
    const dialog = updateApplyDialogEl;
    const showModal = dialog.showModal!;
    if (dialog.open || updateApplyDialogResolver) return false;

    dialog.dataset.pendingBuildNumber = String(buildNumber);
    if (updateApplyMessageEl) {
      updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(buildNumber);
    }

    return new Promise<boolean>((resolve) => {
      updateApplyDialogResolver = resolve;
      try {
        showModal();
      } catch {
        updateApplyDialogResolver = null;
        delete dialog.dataset.pendingBuildNumber;
        resolve(activeWindow.confirm(resolveUpdateApplyDialogPromptText(buildNumber)));
      }
    });
  };

  const requestMoveDailyConfirmation = async (): Promise<boolean> => {
    const promptText = resolveMoveDailyDialogPromptText();
    if (!moveDailyDialogEl || typeof moveDailyDialogEl.showModal !== 'function') {
      return activeWindow.confirm(promptText);
    }
    const dialog = moveDailyDialogEl;
    const showModal = dialog.showModal!;
    if (dialog.open || moveDailyDialogResolver) return false;

    if (moveDailyMessageEl) {
      moveDailyMessageEl.textContent = promptText;
    }

    return new Promise<boolean>((resolve) => {
      moveDailyDialogResolver = resolve;
      try {
        showModal();
      } catch {
        moveDailyDialogResolver = null;
        resolve(activeWindow.confirm(promptText));
      }
    });
  };

  const containsOpenDialogTarget = (target: unknown) => {
    const targetNode = target as Node | null;
    if (!target) return false;
    if (updateApplyDialogEl?.open && updateApplyDialogEl.contains(targetNode)) return true;
    if (moveDailyDialogEl?.open && moveDailyDialogEl.contains(targetNode)) return true;
    return false;
  };

  const refreshLocalizedUi = () => {
    if (updateApplyMessageEl) {
      updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(
        Number.parseInt(updateApplyDialogEl?.dataset?.pendingBuildNumber || '', 10),
      );
    }
    if (moveDailyMessageEl) {
      moveDailyMessageEl.textContent = resolveMoveDailyDialogPromptText();
    }
  };

  const bind = () => {
    bindUpdateApplyDialog();
    bindMoveDailyDialog();
  };

  return {
    bind,
    requestUpdateApplyConfirmation,
    requestMoveDailyConfirmation,
    refreshLocalizedUi,
    containsOpenDialogTarget,
  };
}
