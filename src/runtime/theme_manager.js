export const normalizeTheme = (theme) => (theme === 'light' || theme === 'dark' ? theme : 'dark');

export const applyTheme = (theme, persistence) => {
    const activeTheme = normalizeTheme(theme);
    if (typeof document !== 'undefined') {
        const root = document.documentElement;
        root.dataset.theme = activeTheme;
        root.classList.toggle('theme-light', activeTheme === 'light');
    }
    persistence.writeTheme(activeTheme);
    return activeTheme;
};

export const refreshThemeButton = (activeTheme, refs, translate) => {
    if (!refs?.themeToggle) return;
    const isDark = activeTheme === 'dark';
    const nextLabel = isDark ? translate('ui.themeLight') : translate('ui.themeDark');
    refs.themeToggle.textContent = nextLabel;
    refs.themeToggle.setAttribute('aria-label', nextLabel);
    refs.themeToggle.setAttribute('title', nextLabel);
};

export const setThemeSwitchPrompt = (nextTheme, refs, translate) => {
    if (!refs?.themeSwitchMessage) return;
    const targetLabel = nextTheme === 'light' ? translate('ui.themeLight') : translate('ui.themeDark');
    const fallback = targetLabel ? `Switch to ${targetLabel}?` : translate('ui.themeLight');
    refs.themeSwitchMessage.textContent =
        translate('ui.themeSwitchPrompt', { theme: targetLabel || '' }) || fallback;
};

export const requestLightThemeConfirmation = (targetTheme, refs, translate) => {
    if (!refs?.themeSwitchDialog || typeof refs.themeSwitchDialog.showModal !== 'function') {
        return false;
    }
    if (refs.themeSwitchDialog.open) return true;

    refs.themeSwitchDialog.dataset.pendingTheme = targetTheme;
    setThemeSwitchPrompt(targetTheme, refs, translate);

    try {
        refs.themeSwitchDialog.showModal();
        return true;
    } catch {
        delete refs.themeSwitchDialog.dataset.pendingTheme;
        return false;
    }
};

export const refreshSettingsToggle = (refs, translate) => {
    if (!refs?.settingsToggle) return;
    const label = `${translate('ui.language')} / ${translate('ui.theme')}`;
    refs.settingsToggle.setAttribute('aria-label', label);
    refs.settingsToggle.setAttribute('title', label);
};
