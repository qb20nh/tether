// @ts-nocheck
import { renderAppShellMarkup } from './app_shell_markup.tsx';

export const APP_SHELL_TEMPLATE = (t = (k) => k, localeOptions = [], currentLocale = 'ko') =>
  renderAppShellMarkup({
    t,
    localeOptions,
    currentLocale,
  });

export const buildLegendTemplate = (definitions, icons, iconX, t = (k) => k) =>
  definitions
    .map((item) => {
      if (item.type === 'controls') {
        return `<div class="row"><div class="badge">${item.badgeText || ''}</div><div>${t('legend.controls')}</div></div>`;
      }

      if (item.type === 'group') {
        const badges = item.badgeIds
          .map((id, idx) => `<div class="badge" id="${id}">${icons[item.iconCodes[idx]] || ''}</div>`)
          .join('');
        return `<div class="row"><div class="badgeGroup">${badges}</div><div>${t(item.htmlKey || '')}</div></div>`;
      }

      const iconCode = item.iconCode;
      const iconMarkup = iconCode === 'x'
        ? iconX
        : icons[iconCode] || item.badgeText || '';
      return `<div class="row"><div class="badge" id="${item.badgeId}">${iconMarkup}</div><div>${t(item.htmlKey)}</div></div>`;
    })
    .join('');
