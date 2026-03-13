import type {
  PersistencePort,
  RendererRefs,
  RuntimeTheme,
  Translator,
} from '../contracts/ports.ts';

export const normalizeTheme = (theme: unknown): RuntimeTheme =>
  (theme === 'light' || theme === 'dark' ? theme : 'dark');

export const applyTheme = (theme: unknown, persistence: PersistencePort): RuntimeTheme => {
    const activeTheme = normalizeTheme(theme);
    if (typeof document !== 'undefined') {
        const root = document.documentElement;
        root.dataset.theme = activeTheme;
        root.classList.toggle('theme-light', activeTheme === 'light');
    }
    persistence.writeTheme(activeTheme);
    return activeTheme;
};

export const refreshThemeButton = (
    activeTheme: RuntimeTheme,
    refs: RendererRefs,
    translate: Translator,
) => {
    if (!refs?.themeToggle) return;
    const isDark = activeTheme === 'dark';
    const nextLabel = isDark ? translate('ui.themeLight') : translate('ui.themeDark');
    refs.themeToggle.textContent = nextLabel;
    refs.themeToggle.setAttribute('aria-label', nextLabel);
    refs.themeToggle.setAttribute('title', nextLabel);
};

export const setThemeSwitchPrompt = (
    nextTheme: RuntimeTheme,
    refs: RendererRefs,
    translate: Translator,
) => {
    if (!refs?.themeSwitchMessage) return;
    const targetLabel = nextTheme === 'light' ? translate('ui.themeLight') : translate('ui.themeDark');
    const fallback = targetLabel ? `Switch to ${targetLabel}?` : translate('ui.themeLight');
    refs.themeSwitchMessage.textContent =
        translate('ui.themeSwitchPrompt', { theme: targetLabel || '' }) || fallback;
};

export const requestLightThemeConfirmation = (
    targetTheme: RuntimeTheme,
    refs: RendererRefs,
    translate: Translator,
) => {
    const dialog = refs?.themeSwitchDialog;
    if (!dialog || typeof dialog.showModal !== 'function') {
        return false;
    }
    if (dialog.open) return true;

    dialog.dataset.pendingTheme = targetTheme;
    setThemeSwitchPrompt(targetTheme, refs, translate);

    try {
        dialog.showModal();
        return true;
    } catch {
        delete dialog.dataset.pendingTheme;
        return false;
    }
};

export const refreshSettingsToggle = (refs: RendererRefs, translate: Translator) => {
    if (!refs?.settingsToggle) return;
    const label = `${translate('ui.language')} / ${translate('ui.theme')}`;
    refs.settingsToggle.setAttribute('aria-label', label);
    refs.settingsToggle.setAttribute('title', label);
};
