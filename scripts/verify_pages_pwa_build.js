import fs from 'node:fs';
import path from 'node:path';

const readRequiredFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required build artifact: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
};

const ensureRelativePath = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: expected non-empty string`);
  }
  if (
    value.startsWith('/')
    || value.startsWith('http://')
    || value.startsWith('https://')
  ) {
    throw new Error(`Invalid ${label}: expected relative path, got "${value}"`);
  }
};

const distDir = path.join(process.cwd(), 'dist');
const sourceCnamePath = path.join(process.cwd(), 'public', 'CNAME');
const indexHtmlPath = path.join(distDir, 'index.html');
const manifestPath = path.join(distDir, 'manifest.webmanifest');
const serviceWorkerPath = path.join(distDir, 'sw.js');

const indexHtml = readRequiredFile(indexHtmlPath);
readRequiredFile(serviceWorkerPath);

if (!/rel="manifest"\s+href="\.\/manifest\.webmanifest"/.test(indexHtml)) {
  throw new Error('dist/index.html must reference ./manifest.webmanifest');
}

const manifest = JSON.parse(readRequiredFile(manifestPath));
if (manifest.id !== './') {
  throw new Error(`manifest.id must be "./" (got "${manifest.id}")`);
}
if (manifest.start_url !== './') {
  throw new Error(`manifest.start_url must be "./" (got "${manifest.start_url}")`);
}
if (manifest.scope !== './') {
  throw new Error(`manifest.scope must be "./" (got "${manifest.scope}")`);
}

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
if (icons.length === 0) {
  throw new Error('manifest.icons must contain at least one icon');
}
for (const icon of icons) {
  ensureRelativePath(icon?.src, 'manifest icon src');
}

const expectedCname = readRequiredFile(sourceCnamePath).trim();
if (expectedCname.length === 0) {
  throw new Error('public/CNAME must contain a domain');
}
const distCnamePath = path.join(distDir, 'CNAME');
const distCname = readRequiredFile(distCnamePath).trim();
if (distCname !== expectedCname) {
  throw new Error(`dist/CNAME mismatch: expected "${expectedCname}", got "${distCname}"`);
}

console.log('PWA build artifact verification passed.');
