import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const indexFile = path.join(process.cwd(), 'index.html');
const indexHtml = fs.readFileSync(indexFile, 'utf8');

const bootstrapScriptMatch = indexHtml.match(/<script id="theme-bootstrap">\s*([\s\S]*?)\s*<\/script>/);

const extractBootstrapScript = () => {
  assert.ok(bootstrapScriptMatch, 'index.html should define a theme bootstrap script');
  return bootstrapScriptMatch[1];
};

const executeBootstrapScript = ({
  storedTheme = null,
  mediaMatches = {},
} = /** @type {{ storedTheme?: string | null, mediaMatches?: Record<string, boolean> }} */ ({})) => {
  const classTokens = new Set();
  const documentElement = {
    dataset: {},
    classList: {
      toggle(token, force) {
        const enabled = Boolean(force);
        if (enabled) classTokens.add(token);
        else classTokens.delete(token);
        return enabled;
      },
    },
  };

  const context = {
    window: {
      localStorage: {
        getItem(key) {
          assert.equal(key, 'tetherTheme');
          return storedTheme;
        },
      },
      matchMedia(query) {
        return { matches: Boolean(mediaMatches[query]) };
      },
    },
    document: {
      documentElement,
    },
  };

  vm.runInNewContext(extractBootstrapScript(), context);

  return {
    theme: typeof documentElement.dataset.theme === 'string' ? documentElement.dataset.theme : null,
    isLightTheme: classTokens.has('theme-light'),
  };
};

test('index theme bootstrap runs before the app stylesheet loads', () => {
  const bootstrapIndex = indexHtml.indexOf('id="theme-bootstrap"');
  const stylesheetIndex = indexHtml.indexOf('href="/src/styles.css"');

  assert.ok(bootstrapIndex >= 0);
  assert.ok(stylesheetIndex >= 0);
  assert.ok(bootstrapIndex < stylesheetIndex);
});

test('index theme bootstrap applies persisted light theme before app boot', () => {
  const result = executeBootstrapScript({
    storedTheme: 'light',
    mediaMatches: {
      '(prefers-color-scheme: dark)': true,
    },
  });

  assert.equal(result.theme, 'light');
  assert.equal(result.isLightTheme, true);
});

test('index theme bootstrap falls back to system theme when no valid persisted theme exists', () => {
  const lightResult = executeBootstrapScript({
    storedTheme: 'invalid',
    mediaMatches: {
      '(prefers-color-scheme: light)': true,
    },
  });
  assert.equal(lightResult.theme, 'light');
  assert.equal(lightResult.isLightTheme, true);

  const darkResult = executeBootstrapScript({
    storedTheme: null,
    mediaMatches: {},
  });
  assert.equal(darkResult.theme, 'dark');
  assert.equal(darkResult.isLightTheme, false);
});
