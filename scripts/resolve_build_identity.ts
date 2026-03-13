#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BUILD_IDENTITY_IGNORED_REPO_FILES,
} from '../src/shared/paths.ts';

const buildExcludeArgs = (): string[] =>
  BUILD_IDENTITY_IGNORED_REPO_FILES.map((filePath) => `:(exclude)${filePath}`);

const runGit = (args: readonly string[]): string => execFileSync('git', [...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

interface BuildIdentity {
  buildNumber: number;
  buildLabel: string;
}

export const resolveBuildIdentity = (): BuildIdentity => {
  const excludeArgs = buildExcludeArgs();
  const nonDailyCountRaw = runGit(['rev-list', '--count', 'HEAD', '--', '.', ...excludeArgs]);
  if (!/^\d+$/.test(nonDailyCountRaw)) {
    throw new Error(`Invalid non-daily commit count: ${nonDailyCountRaw}`);
  }

  const buildNumber = Number.parseInt(nonDailyCountRaw, 10) + 1;
  const buildLabel = runGit(['log', '-1', '--format=%h', '--', '.', ...excludeArgs]) || 'main';

  return {
    buildNumber,
    buildLabel,
  };
};

const main = (): void => {
  const { buildNumber, buildLabel } = resolveBuildIdentity();
  process.stdout.write(`VITE_BUILD_NUMBER=${buildNumber}\n`);
  process.stdout.write(`VITE_BUILD_LABEL=${buildLabel}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
