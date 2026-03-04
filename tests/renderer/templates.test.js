import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('templates source uses material icon ligatures for header and dialog icons', () => {
  const source = readFileSync(new URL('../../src/templates.js', import.meta.url), 'utf8');

  assert.match(source, /<span class="uiIconMaterial" aria-hidden="true">notifications<\/span>/);
  assert.match(source, /<span class="uiIconMaterial" aria-hidden="true">settings<\/span>/);
  assert.match(source, /<span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">language<\/span>/);
  assert.match(source, /<span class="uiIconMaterial settingsLabelIcon" aria-hidden="true">palette<\/span>/);
  assert.match(source, /<span class="uiIconMaterial" aria-hidden="true">chevron_left<\/span>/);
  assert.match(source, /<span class="uiIconMaterial" aria-hidden="true">chevron_right<\/span>/);
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

test('index head includes font dns and preload hints', () => {
  const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  assert.match(source, /<link rel="dns-prefetch" href="\/\/fonts\.googleapis\.com" \/>/);
  assert.match(source, /<link rel="dns-prefetch" href="\/\/fonts\.gstatic\.com" \/>/);
  assert.match(
    source,
    /<link\s+rel="preload"\s+href="\/fonts\/material-symbols-rounded-w300-grad200-opsz20\.woff2"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s+\/>/,
  );
  assert.match(
    source,
    /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Rounded:FILL,GRAD,opsz,wght@0,200,20,300&amp;display=swap/,
  );
});
