// @ts-nocheck
export function createNotificationDialogController(options = {}) {
  const {
    elementIds,
    translateNow = (key) => key,
    windowObj = typeof window === 'undefined' ? undefined : window,
    documentObj = typeof document === 'undefined' ? undefined : document,
  } = options;

  if (!elementIds || typeof elementIds !== 'object') {
    throw new Error('createNotificationDialogController requires elementIds');
  }

  let updateApplyDialogEl = null;
  let updateApplyMessageEl = null;
  let updateApplyDialogBound = false;
  let moveDailyDialogEl = null;
  let moveDailyMessageEl = null;
  let moveDailyDialogBound = false;
  let moveDailyDialogResolver = null;
  let updateApplyDialogResolver = null;

  const resolveUpdateApplyDialogPromptText = (buildNumber = null) => {
    const prompt = translateNow('ui.updateApplyDialogPrompt');
    if (prompt !== 'ui.updateApplyDialogPrompt') return prompt;
    if (Number.isInteger(buildNumber) && buildNumber > 0) {
      return `Install build ${buildNumber}?`;
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

    updateApplyDialogEl = documentObj.getElementById(elementIds.UPDATE_APPLY_DIALOG);
    updateApplyMessageEl = documentObj.getElementById(elementIds.UPDATE_APPLY_MESSAGE);

    if (!updateApplyDialogEl || updateApplyDialogBound) return;

    updateApplyDialogEl.addEventListener('close', () => {
      const shouldApply = updateApplyDialogEl?.returnValue === 'confirm';
      delete updateApplyDialogEl.dataset.pendingBuildNumber;
      updateApplyDialogEl.returnValue = '';
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

    moveDailyDialogEl = documentObj.getElementById(elementIds.MOVE_DAILY_DIALOG);
    moveDailyMessageEl = documentObj.getElementById(elementIds.MOVE_DAILY_MESSAGE);

    if (!moveDailyDialogEl || moveDailyDialogBound) return;

    moveDailyDialogEl.addEventListener('close', () => {
      const confirmed = moveDailyDialogEl?.returnValue === 'confirm';
      moveDailyDialogEl.returnValue = '';
      const resolve = moveDailyDialogResolver;
      moveDailyDialogResolver = null;
      if (typeof resolve === 'function') {
        resolve(confirmed);
      }
    });

    moveDailyDialogBound = true;
  };

  const requestUpdateApplyConfirmation = async (buildNumber) => {
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) return false;
    if (!updateApplyDialogEl || typeof updateApplyDialogEl.showModal !== 'function') {
      return windowObj.confirm(resolveUpdateApplyDialogPromptText(buildNumber));
    }
    if (updateApplyDialogEl.open || updateApplyDialogResolver) return false;

    updateApplyDialogEl.dataset.pendingBuildNumber = String(buildNumber);
    if (updateApplyMessageEl) {
      updateApplyMessageEl.textContent = resolveUpdateApplyDialogPromptText(buildNumber);
    }

    return new Promise((resolve) => {
      updateApplyDialogResolver = resolve;
      try {
        updateApplyDialogEl.showModal();
      } catch {
        updateApplyDialogResolver = null;
        delete updateApplyDialogEl.dataset.pendingBuildNumber;
        resolve(windowObj.confirm(resolveUpdateApplyDialogPromptText(buildNumber)));
      }
    });
  };

  const requestMoveDailyConfirmation = async () => {
    const promptText = resolveMoveDailyDialogPromptText();
    if (!moveDailyDialogEl || typeof moveDailyDialogEl.showModal !== 'function') {
      return windowObj.confirm(promptText);
    }
    if (moveDailyDialogEl.open || moveDailyDialogResolver) return false;

    if (moveDailyMessageEl) {
      moveDailyMessageEl.textContent = promptText;
    }

    return new Promise((resolve) => {
      moveDailyDialogResolver = resolve;
      try {
        moveDailyDialogEl.showModal();
      } catch {
        moveDailyDialogResolver = null;
        resolve(windowObj.confirm(promptText));
      }
    });
  };

  const containsOpenDialogTarget = (target) => {
    if (!target) return false;
    if (updateApplyDialogEl?.open && updateApplyDialogEl.contains(target)) return true;
    if (moveDailyDialogEl?.open && moveDailyDialogEl.contains(target)) return true;
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
