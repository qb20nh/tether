import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEXT_EXTENSIONS = new Set<string>([
  '.html',
  '.js',
  '.css',
  '.json',
  '.webmanifest',
  '.txt',
  '.map',
]);

interface BlockedPattern {
  label: string;
  regex: RegExp;
}

export const BLOCKED_PATTERNS: readonly BlockedPattern[] = [
  { label: 'local debug panel id', regex: /tetherLocalDebugPanel/ },
  { label: 'runtime debug plugin module', regex: /runtime_debug_plugin/ },
  { label: 'local debug panel module', regex: /local_debug_panel/ },
  { label: 'debug reduced-motion module', regex: /reduced_motion_debug/ },
  { label: 'service worker debug plugin module', regex: /sw_debug_plugin/ },
  { label: 'debug source path reference', regex: /\/src\/debug\// },
  { label: 'debug service worker message type', regex: /SW_DEBUG_/ },
  { label: 'debug animation speed global', regex: /TETHER_DEBUG_ANIM_SPEED/ },
  { label: 'debug reduced-motion global', regex: /TETHER_DEBUG_SIMULATE_REDUCED_MOTION/ },
  { label: 'debug reduced-motion class', regex: /isDebugReducedMotion/ },
  { label: 'debug daily freeze reader', regex: /readDebugDailyFreezeState/ },
  { label: 'debug daily freeze setter', regex: /setDebugForceDailyFrozen/ },
  { label: 'debug daily freeze toggle', regex: /toggleDebugForceDailyFrozen/ },
  { label: 'debug path counter label', regex: /pathDraws/ },
  { label: 'debug rebuild counter label', regex: /fullCellRebuilds/ },
  { label: 'debug heavy-frame counter label', regex: /heavyFrameRenders/ },
  { label: 'debug patch counter label', regex: /incrementalCellPatches/ },
  { label: 'debug symbol counter label', regex: /symbolRedraws/ },
  { label: 'local debug title text', regex: /Local Debug/ },
];

const DEFAULT_DIST_DIR = path.join(process.cwd(), 'dist');

const listFilesRecursively = (dirPath: string): string[] => {
  const out: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(absPath));
      continue;
    }
    out.push(absPath);
  }
  return out;
};

interface VerifyReleaseNoDebugArtifactsOptions {
  distDir?: string;
}

interface VerifyReleaseNoDebugArtifactsResult {
  distDir: string;
  fileCount: number;
}

export const verifyReleaseNoDebugArtifacts = (
  { distDir = DEFAULT_DIST_DIR }: VerifyReleaseNoDebugArtifactsOptions = {},
): VerifyReleaseNoDebugArtifactsResult => {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Missing dist directory: ${distDir}`);
  }

  const files = listFilesRecursively(distDir)
    .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  if (files.length === 0) {
    throw new Error(`No text build artifacts found in ${path.relative(process.cwd(), distDir) || 'dist/'}`);
  }

  const violations: Array<{ filePath: string; label: string }> = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of BLOCKED_PATTERNS) {
      if (!pattern.regex.test(content)) continue;
      violations.push({
        filePath,
        label: pattern.label,
      });
    }
  }

  if (violations.length > 0) {
    const details = violations
      .map((item) => `- ${path.relative(process.cwd(), item.filePath)} (${item.label})`)
      .join('\n');
    throw new Error(`Debug-only artifact leaked into release build:\n${details}`);
  }

  return {
    distDir,
    fileCount: files.length,
  };
};

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  verifyReleaseNoDebugArtifacts();
  console.log('Release debug artifact verification passed.');
}
