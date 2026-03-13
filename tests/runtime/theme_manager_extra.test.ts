import assert from 'node:assert/strict';
import test from '../test.ts';
import { vi } from 'vitest';
import type { TranslateVars } from '../../src/contracts/ports.ts';
import {
  applyTheme,
  normalizeTheme,
  refreshSettingsToggle,
  refreshThemeButton,
  requestLightThemeConfirmation,
  setThemeSwitchPrompt,
} from '../../src/runtime/theme_manager.ts';

const createButton = () => {
  const attributes = new Map<string, string>();
  return {
    textContent: '',
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
  };
};

test('normalizeTheme and applyTheme fall back to dark and update persistence', (t) => {
  const toggles: Array<{ name: string; force: boolean }> = [];
  const documentObj = {
    documentElement: {
      dataset: {} as Record<string, string>,
      classList: {
        toggle(name: string, force: boolean) {
          toggles.push({ name, force });
        },
      },
    },
  };
  vi.stubGlobal('document', documentObj);
  t.after(() => {
    vi.unstubAllGlobals();
  });

  const written: string[] = [];
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('nope'), 'dark');
  assert.equal(applyTheme('nope', { writeTheme: (theme: string) => written.push(theme) } as any), 'dark');

  assert.equal(documentObj.documentElement.dataset.theme, 'dark');
  assert.deepEqual(toggles, [{ name: 'theme-light', force: false }]);
  assert.deepEqual(written, ['dark']);
});

test('theme UI helpers update labels prompts and dialog state', () => {
  const themeToggle = createButton();
  const settingsToggle = createButton();
  const themeSwitchMessage = { textContent: '' };
  let showModalCalls = 0;
  const themeSwitchDialog = {
    dataset: {} as Record<string, string>,
    open: false,
    showModal() {
      showModalCalls += 1;
      this.open = true;
    },
  };
  const refs = {
    themeToggle,
    settingsToggle,
    themeSwitchMessage,
    themeSwitchDialog,
  };
  const translate = (key: string, vars?: TranslateVars) => {
    if (key === 'ui.themeLight') return 'Light';
    if (key === 'ui.themeDark') return 'Dark';
    if (key === 'ui.language') return 'Language';
    if (key === 'ui.theme') return 'Theme';
    if (key === 'ui.themeSwitchPrompt') return `Switch to ${vars?.theme}`;
    return key;
  };

  refreshThemeButton('dark', refs as any, translate);
  assert.equal(themeToggle.textContent, 'Light');
  assert.equal(themeToggle.getAttribute('aria-label'), 'Light');

  setThemeSwitchPrompt('light', refs as any, translate);
  assert.equal(themeSwitchMessage.textContent, 'Switch to Light');

  assert.equal(requestLightThemeConfirmation('light', refs as any, translate), true);
  assert.equal(themeSwitchDialog.dataset.pendingTheme, 'light');
  assert.equal(showModalCalls, 1);

  refreshSettingsToggle(refs as any, translate);
  assert.equal(settingsToggle.getAttribute('title'), 'Language / Theme');
});

test('requestLightThemeConfirmation handles missing dialog, open dialog, and showModal failure', () => {
  const translate = (key: string) => key;
  assert.equal(requestLightThemeConfirmation('light', {} as any, translate), false);

  const openDialog = {
    open: true,
    dataset: {} as Record<string, string>,
    showModal() {
      throw new Error('should not run');
    },
  };
  assert.equal(requestLightThemeConfirmation('light', { themeSwitchDialog: openDialog } as any, translate), true);

  const brokenDialog = {
    open: false,
    dataset: {} as Record<string, string>,
    showModal() {
      throw new Error('blocked');
    },
  };
  assert.equal(
    requestLightThemeConfirmation(
      'light',
      { themeSwitchDialog: brokenDialog, themeSwitchMessage: { textContent: '' } } as any,
      translate,
    ),
    false,
  );
  assert.equal('pendingTheme' in brokenDialog.dataset, false);
});
