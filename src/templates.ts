import {
  renderAppShellMarkup,
  type ShellLocaleOption,
  type ShellTranslator,
} from './app_shell_markup.tsx';

type LegendIconLookup = Record<string, string>;

interface LegendControlDefinition {
  type: 'controls';
  badgeText?: string;
}

interface LegendGroupDefinition {
  type: 'group';
  badgeIds: readonly string[];
  iconCodes: readonly string[];
  htmlKey?: string;
}

interface LegendBadgeDefinition {
  type?: undefined;
  badgeId?: string;
  badgeText?: string;
  iconCode?: string;
  htmlKey: string;
}

type LegendDefinition =
  | LegendControlDefinition
  | LegendGroupDefinition
  | LegendBadgeDefinition;

const defaultTemplateTranslator: ShellTranslator = (key) => key;

export const APP_SHELL_TEMPLATE = (
  t: ShellTranslator = defaultTemplateTranslator,
  localeOptions: readonly ShellLocaleOption[] = [],
  currentLocale = 'ko',
): string =>
  renderAppShellMarkup({
    t,
    localeOptions,
    currentLocale,
  });

export const buildLegendTemplate = (
  definitions: readonly LegendDefinition[],
  icons: LegendIconLookup,
  iconX: string,
  t: ShellTranslator = defaultTemplateTranslator,
): string =>
  definitions
    .map((item) => {
      if (item.type === 'controls') {
        return `<div class="row"><div class="badge">${item.badgeText || ''}</div><div>${t('legend.controls')}</div></div>`;
      }

      if (item.type === 'group') {
        const badges = item.badgeIds
          .map((id: string, idx: number) => `<div class="badge" id="${id}">${icons[item.iconCodes[idx]] || ''}</div>`)
          .join('');
        return `<div class="row"><div class="badgeGroup">${badges}</div><div>${t(item.htmlKey || '')}</div></div>`;
      }

      const iconCode = item.iconCode;
      const iconMarkup = iconCode === 'x'
        ? iconX
        : icons[iconCode || ''] || item.badgeText || '';
      return `<div class="row"><div class="badge" id="${item.badgeId}">${iconMarkup}</div><div>${t(item.htmlKey)}</div></div>`;
    })
    .join('');
