import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAppShellMarkup } from '../../src/app_shell_markup.js';

test('templates source uses material icon ligatures for header and dialog icons', () => {
  const source = readFileSync(new URL('../../src/app_shell_markup.js', import.meta.url), 'utf8');

  assert.match(source, /<span class="uiIconMaterial" aria-hidden="true">notifications<\/span>/);
  assert.match(source, /<span class="uiIconMaterial" aria-hidden="true">settings<\/span>/);
  assert.match(source, /<span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">language<\/span>/);
  assert.match(source, /<span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">palette<\/span>/);
  assert.match(source, /<span class="uiIconMaterial controlActionIcon" aria-hidden="true">restart_alt<\/span>/);
  assert.match(source, /<span class="uiIconMaterial controlActionIcon" aria-hidden="true">swap_horiz<\/span>/);
  assert.match(source, /<span class="themeSwitchDialog__icon uiIconMaterial" aria-hidden="true">warning<\/span>/);
  assert.match(source, /<span class="themeSwitchDialog__actionIcon uiIconMaterial" aria-hidden="true">close<\/span>/);
  assert.match(source, /<span class="themeSwitchDialog__actionIcon uiIconMaterial" aria-hidden="true">check<\/span>/);
  assert.equal(source.includes('🔔'), false);
  assert.equal(source.includes('⚙'), false);
  assert.equal(source.includes('⚠'), false);
  assert.equal(source.includes('✕'), false);
  assert.equal(source.includes('✓'), false);
});

test('index head preloads the bundled icon font without remote Google font boot hints', () => {
  const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  assert.match(
    source,
    /<link\s+rel="preload"\s+href="\/fonts\/material-symbols-rounded-w300-grad200-opsz20\.woff2"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s+\/>/,
  );
  assert.doesNotMatch(source, /fonts\.googleapis\.com/);
  assert.doesNotMatch(source, /fonts\.gstatic\.com/);
});

test('icon buttons reserve symmetric icon space so labels stay centered', () => {
  const markup = renderAppShellMarkup();
  const stylesheet = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

  assert.match(markup, /<span class="controlActionText" data-i18n="ui.reset">ui\.reset<\/span>/);
  assert.match(markup, /<span class="controlActionText" data-i18n="ui.reverse">ui\.reverse<\/span>/);
  assert.match(markup, /<span class="themeSwitchDialog__actionText" data-i18n="ui.cancel">ui\.cancel<\/span>/);
  assert.match(markup, /<span class="themeSwitchDialog__actionText" data-i18n="ui\.themeSwitchConfirm">ui\.themeSwitchConfirm<\/span>/);
  assert.ok(
    stylesheet.includes('grid-template-columns: var(--button-icon-slot-size) minmax(0, 1fr) var(--button-icon-slot-size);'),
  );
  assert.ok(stylesheet.includes('.controlActionText,'));
  assert.ok(stylesheet.includes('.themeSwitchDialog__actionText {'));
  assert.ok(stylesheet.includes('grid-column: 2;'));
  assert.ok(stylesheet.includes('text-align: center;'));
});

test('boot shell board keeps the same outer inset as the live board grid', () => {
  const stylesheet = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

  assert.ok(stylesheet.includes('.bootShell .boardWrap {'));
  assert.ok(stylesheet.includes('--boot-shell-grid-units: max(var(--grid-cols), var(--grid-rows));'));
  assert.ok(stylesheet.includes('--board-border: clamp(calc(var(--cell) * 0.024), 0.8px, 2.8px);'));
  assert.ok(stylesheet.includes('calc(var(--boot-shell-grid-units) * var(--cell) + (var(--boot-shell-grid-units) - 1) * var(--gap) + (var(--gap) * 2) + (var(--board-border) * 2))'));
  assert.ok(stylesheet.includes('.bootShellBoard {'));
  assert.ok(stylesheet.includes('inline-size: 100%;'));
  assert.ok(stylesheet.includes('aspect-ratio: 1;'));
  assert.ok(stylesheet.includes('padding: var(--gap);'));
  assert.ok(stylesheet.includes('.bootShellBoard::before {'));
  assert.ok(stylesheet.includes('inset: var(--gap);'));
  assert.ok(stylesheet.includes('calc((100% + var(--gap)) / var(--boot-shell-grid-units))'));
  assert.equal(stylesheet.includes('radial-gradient(circle at 14.285% 14.285%'), false);
  assert.equal(stylesheet.includes('linear-gradient(90deg, transparent 13%'), false);
});

test('boot shell guide message uses text-driven wrapping instead of fixed placeholder lines', () => {
  const source = readFileSync(new URL('../../src/app_shell_markup.js', import.meta.url), 'utf8');
  const stylesheet = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  const guideRuleMatch = stylesheet.match(/\.bootShellGuideLine\s*\{[^}]+\}/);

  assert.match(source, /bootShellMessageText/);
  assert.match(source, /bootShellGuideLine/);
  assert.doesNotMatch(source, /bootShellTextLine--wide/);
  assert.ok(source.includes('Goal visit every open cell once.'));
  assert.ok(source.includes('This level start anywhere.'));
  assert.ok(stylesheet.includes('.bootShellGuideLine {'));
  assert.ok(stylesheet.includes('box-decoration-break: clone;'));
  assert.ok(guideRuleMatch);
  assert.ok(guideRuleMatch[0].includes('background-size: 100% 1em;'));
  assert.ok(guideRuleMatch[0].includes('background-position: 0 calc((1lh - 1em) / 2);'));
});
