import fs from 'node:fs';
import path from 'node:path';

const distDir = path.join(process.cwd(), 'dist');
const TEXT_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.webmanifest',
  '.txt',
  '.map',
]);

const BLOCKED_PATTERNS = [
  { label: 'local debug panel id', regex: /tetherLocalDebugPanel/ },
  { label: 'runtime debug plugin module', regex: /runtime_debug_plugin/ },
  { label: 'local debug panel module', regex: /local_debug_panel/ },
  { label: 'service worker debug plugin module', regex: /sw_debug_plugin/ },
  { label: 'debug source path reference', regex: /\/src\/debug\// },
  { label: 'debug service worker message type', regex: /SW_DEBUG_/ },
  { label: 'local debug title text', regex: /Local Debug/ },
];

const listFilesRecursively = (dirPath) => {
  const out = [];
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

if (!fs.existsSync(distDir)) {
  throw new Error(`Missing dist directory: ${distDir}`);
}

const files = listFilesRecursively(distDir)
  .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
if (files.length === 0) {
  throw new Error('No text build artifacts found in dist/');
}

const violations = [];
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

console.log('Release debug artifact verification passed.');
