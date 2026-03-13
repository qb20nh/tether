import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { resolveBuildIdentity } from '../../scripts/resolve_build_identity.ts';
import {
  BUILD_IDENTITY_IGNORED_REPO_FILES,
  DAILY_OVERRIDES_REPO_FILE,
  DAILY_POOL_MANIFEST_REPO_FILE,
  INFINITE_OVERRIDES_REPO_FILE,
} from '../../src/shared/paths.ts';

const runGit = (args) => execFileSync('git', args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

test('shared generated artifact paths point at src/generated', () => {
  assert.equal(DAILY_POOL_MANIFEST_REPO_FILE, 'src/generated/daily_pool_manifest.json');
  assert.equal(DAILY_OVERRIDES_REPO_FILE, 'src/generated/daily_overrides.bin.gz');
  assert.equal(INFINITE_OVERRIDES_REPO_FILE, 'src/generated/infinite_overrides.bin.gz');
});

test('resolveBuildIdentity ignores committed daily payload files', () => {
  const excludeArgs = BUILD_IDENTITY_IGNORED_REPO_FILES.map((filePath) => `:(exclude)${filePath}`);
  const expectedBuildNumber = Number.parseInt(
    runGit(['rev-list', '--count', 'HEAD', '--', '.', ...excludeArgs]),
    10,
  ) + 1;
  const expectedBuildLabel = runGit(['log', '-1', '--format=%h', '--', '.', ...excludeArgs]) || 'main';

  const identity = resolveBuildIdentity();
  assert.equal(identity.buildNumber, expectedBuildNumber);
  assert.equal(identity.buildLabel, expectedBuildLabel);
});
