import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_BOOT_SHELL_PLACEHOLDER, injectBootShellIntoIndexHtml } from '../../src/index_boot_shell.js';

const indexFile = path.join(process.cwd(), 'index.html');
const indexHtml = fs.readFileSync(indexFile, 'utf8');
const transformedIndexHtml = injectBootShellIntoIndexHtml(indexHtml);

test('index source keeps a single boot shell placeholder for transform-time injection', () => {
  assert.match(indexHtml, /<div id="app" aria-busy="true"><!--app-boot-shell--><\/div>/);
  assert.equal(indexHtml.includes(APP_BOOT_SHELL_PLACEHOLDER), true);
});

test('transformed index ships the static boot shell inside the app root', () => {
  assert.match(transformedIndexHtml, /<div id="app" aria-busy="true">\s*<div class="app bootShell" data-boot-shell>/);
  assert.match(transformedIndexHtml, /<div class="app bootShell" data-boot-shell>[\s\S]*?<span>TETHER<\/span>/);
  assert.match(transformedIndexHtml, /bootShellTextBlock--label/);
  assert.match(transformedIndexHtml, /id="levelSel" class="bootShellSelect"[\s\S]*?<option selected><\/option>/);
  assert.doesNotMatch(transformedIndexHtml, />Loading level\.\.\.</);
});

test('index keeps theme bootstrap ahead of the app stylesheet', () => {
  const bootstrapIndex = indexHtml.indexOf('id="theme-bootstrap"');
  const stylesheetIndex = indexHtml.indexOf('href="/src/styles.css"');

  assert.ok(bootstrapIndex >= 0);
  assert.ok(stylesheetIndex >= 0);
  assert.ok(bootstrapIndex < stylesheetIndex);
});

test('index does not include remote Google font boot dependencies', () => {
  assert.doesNotMatch(indexHtml, /fonts\.googleapis\.com/);
  assert.doesNotMatch(indexHtml, /fonts\.gstatic\.com/);
});
