import {
  renderBootShellMarkup,
  type ShellRenderOptions,
} from './app_shell_markup.tsx';

export const APP_BOOT_SHELL_PLACEHOLDER = '<!--app-boot-shell-->';

export const injectBootShellIntoIndexHtml = (
  indexHtml: string,
  options: ShellRenderOptions = {},
): string => {
  if (typeof indexHtml !== 'string') {
    throw new TypeError('injectBootShellIntoIndexHtml requires an HTML string');
  }

  if (!indexHtml.includes(APP_BOOT_SHELL_PLACEHOLDER)) {
    throw new Error('index.html is missing the app boot shell placeholder');
  }

  return indexHtml.replace(APP_BOOT_SHELL_PLACEHOLDER, renderBootShellMarkup(options));
};
