import { mountStyles } from './styles.js';
import { APP_SHELL_TEMPLATE } from './templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './icons.js';
import { ELEMENT_IDS } from './config.js';
import {
  getLocaleOptions,
  getLocale,
  resolveLocale,
  setLocale,
  t as createTranslator,
} from './i18n.js';
import { buildLegendTemplate } from './templates.js';
import { createDefaultAdapters } from './runtime/default_adapters.js';
import { createRuntime } from './runtime/create_runtime.js';

let runtimeInstance = null;

export function initTetherApp() {
  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;

  const initialLocale = resolveLocale();
  const translate = createTranslator(initialLocale);

  appEl.innerHTML = APP_SHELL_TEMPLATE(
    translate,
    getLocaleOptions(initialLocale),
    initialLocale,
  );

  const adapters = createDefaultAdapters({
    icons: ICONS,
    iconX: ICON_X,
  });

  runtimeInstance = createRuntime({
    appEl,
    core: adapters.core,
    state: adapters.state,
    persistence: adapters.persistence,
    renderer: adapters.renderer,
    input: adapters.input,
    i18n: {
      getLocaleOptions,
      getLocale,
      resolveLocale,
      setLocale,
      createTranslator,
    },
    ui: {
      buildLegendTemplate,
      badgeDefinitions: BADGE_DEFINITIONS,
      icons: ICONS,
      iconX: ICON_X,
    },
  });

  runtimeInstance.start();
}

initTetherApp();
