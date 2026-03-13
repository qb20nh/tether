import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from '../test.ts';

const repoFile = (...parts: string[]) => path.join(process.cwd(), ...parts);

const readJson = (...parts: string[]) => JSON.parse(fs.readFileSync(repoFile(...parts), 'utf8'));
const readText = (...parts: string[]) => fs.readFileSync(repoFile(...parts), 'utf8');

test('package metadata standardizes on pnpm and only-allow', () => {
  const pkg = readJson('package.json');
  const jscpdConfig = readJson('.jscpd.json');
  assert.equal(pkg.packageManager, 'pnpm@10.30.3');
  assert.equal(pkg.scripts.preinstall, 'npx --yes only-allow pnpm');
  assert.equal(pkg.scripts.build, 'vite build');
  assert.equal(
    pkg.scripts.typecheck,
    'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.scripts.json --noEmit && tsc -p tsconfig.sw.json --noEmit && tsc -p tsconfig.tests.json --noEmit',
  );
  assert.equal(pkg.scripts['verify:duplication'], 'jscpd --config .jscpd.json src scripts src-tauri/src vite.config.ts');
  assert.equal(pkg.scripts['verify:release-no-debug'], 'node --import tsx scripts/verify_release_no_debug_artifacts.ts');
  assert.equal(jscpdConfig.threshold, 1);
  assert.equal(jscpdConfig.gitignore, true);
  assert.equal(jscpdConfig.maxLines, 10000);
  assert.equal(jscpdConfig.maxSize, '1mb');
  assert.deepEqual(jscpdConfig.ignore, ['**/generated/**']);
  assert.equal(fs.existsSync(repoFile('package-lock.json')), false);
});

test('tauri and CI workflows use pnpm with cached store settings', () => {
  const tauriConfig = readJson('src-tauri', 'tauri.conf.json');
  assert.equal(tauriConfig.build.beforeBuildCommand, 'pnpm run build');
  assert.equal(tauriConfig.build.beforeDevCommand, 'pnpm run dev');

  const deployWorkflow = readText('.github', 'workflows', 'deploy.yml');
  assert.match(deployWorkflow, /uses:\s+pnpm\/action-setup@v4/);
  assert.match(deployWorkflow, /node-version:\s+22/);
  assert.match(deployWorkflow, /cache:\s+pnpm/);
  assert.match(deployWorkflow, /cache-dependency-path:\s+pnpm-lock\.yaml/);
  assert.match(deployWorkflow, /pnpm install --frozen-lockfile/);
  assert.match(deployWorkflow, /pnpm run verify:duplication/);
  assert.doesNotMatch(deployWorkflow, /^\s*cache:\s+npm\s*$/m);
  assert.doesNotMatch(deployWorkflow, /^\s*run:\s+npm ci\s*$/m);
  assert.doesNotMatch(deployWorkflow, /^\s*run:\s+npm install\s*$/m);

  const releaseWorkflow = readText('.github', 'workflows', 'release.yml');
  assert.match(releaseWorkflow, /uses:\s+pnpm\/action-setup@v4/);
  assert.match(releaseWorkflow, /node-version:\s+22/);
  assert.match(releaseWorkflow, /cache:\s+pnpm/);
  assert.match(releaseWorkflow, /cache-dependency-path:\s+pnpm-lock\.yaml/);
  assert.match(releaseWorkflow, /pnpm install --frozen-lockfile/);
  assert.match(releaseWorkflow, /pnpm run verify:duplication/);
  assert.doesNotMatch(releaseWorkflow, /^\s*cache:\s+npm\s*$/m);
  assert.doesNotMatch(releaseWorkflow, /^\s*run:\s+npm ci\s*$/m);
  assert.doesNotMatch(releaseWorkflow, /^\s*run:\s+npm run build\s*$/m);
});
