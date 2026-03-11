import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5174/';
const ITERATIONS = Number.parseInt(process.env.E2E_RESIZE_ITERATIONS || '360', 10);

const resizePattern = (index) => ({
  width: 640 + ((index * 47) % 1400),
  height: 420 + ((index * 61) % 900),
});

test('e2e: renderer recovers after resize stress and context loss', async (t) => {
  let chromium = null;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    // Allows the e2e test file to live in-repo even when Playwright is not installed locally.
    t.skip('playwright is not installed; run `pnpm add -D playwright` and `pnpm exec playwright install chromium`');
    return;
  }

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`playwright could not launch in this environment: ${error?.message || error}`);
    return;
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#pathCanvas', { timeout: 10000 });
    await page.waitForTimeout(600);

    for (let i = 0; i < ITERATIONS; i += 1) {
      await page.setViewportSize(resizePattern(i));
      await page.waitForTimeout(4);
    }

    // Force a context loss event when supported so recovery behavior is always exercised.
    await page.evaluate(() => {
      const canvas = document.getElementById('pathCanvas');
      const gl = canvas?.getContext('webgl2');
      if (!gl || typeof gl.getExtension !== 'function') return;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext || typeof ext.loseContext !== 'function') return;
      ext.loseContext();
    });

    for (let i = 0; i < 90; i += 1) {
      await page.setViewportSize(resizePattern(i + ITERATIONS));
      await page.waitForTimeout(4);
    }

    await page.waitForTimeout(1700);

    const state = await page.evaluate(() => {
      const canvas = document.getElementById('pathCanvas');
      const gl = canvas?.getContext('webgl2');
      return {
        hasCanvas: Boolean(canvas),
        hasWebgl2: Boolean(gl),
        isContextLost: gl && typeof gl.isContextLost === 'function' ? gl.isContextLost() : null,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
      };
    });

    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('\n')}`);
    assert.equal(state.hasCanvas, true);
    assert.equal(state.hasWebgl2, true);
    assert.equal(state.isContextLost, false);
    assert.equal(state.width > 0, true);
    assert.equal(state.height > 0, true);
  } finally {
    await page.close();
    await browser.close();
  }
});
