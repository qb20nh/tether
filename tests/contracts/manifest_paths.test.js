import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const manifestFile = path.join(process.cwd(), 'public', 'manifest.webmanifest');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

test('web manifest uses relative paths so it works on subpath deploys', () => {
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  assert.ok(icons.length > 0);
  for (const icon of icons) {
    assert.equal(typeof icon.src, 'string');
    assert.ok(!icon.src.startsWith('/'));
  }
});
