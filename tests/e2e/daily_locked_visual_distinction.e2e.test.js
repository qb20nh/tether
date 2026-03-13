import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5174/';
const DAILY_LOCK_SETTLE_MS = 1200;

const installControllableClock = async (page) => {
  await page.addInitScript(() => {
    const runtimeGlobal = /** @type {any} */ (globalThis);
    const RealDate = Date;
    let nowMs = RealDate.now();

    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(nowMs);
          return;
        }
        super(.../** @type {ConstructorParameters<typeof Date>} */ (args));
      }

      static now() {
        return nowMs;
      }
    }

    MockDate.UTC = RealDate.UTC;
    MockDate.parse = RealDate.parse;

    runtimeGlobal.__setTestNow = (value) => {
      nowMs = Number(value) || nowMs;
      return nowMs;
    };

    runtimeGlobal.__getTestNow = () => nowMs;
    runtimeGlobal.Date = /** @type {DateConstructor} */ (MockDate);
  });
};

const getCellLocator = (page, r, c) => page.locator(`[data-r="${r}"][data-c="${c}"]`);

test('e2e: daily locked board keeps walls and path tips visually distinct', async (t) => {
  let chromium = null;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    t.skip('playwright is not installed; run `pnpm add -D playwright` and `pnpm exec playwright install chromium`');
    return;
  }

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`playwright could not launch in this environment: ${/** @type {any} */ (error)?.message || error}`);
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const page = await context.newPage();
  await installControllableClock(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#levelSel', { timeout: 10000 });
    await page.waitForSelector('#grid', { timeout: 10000 });

    const dailyValue = await page.$eval('#levelSel', (select) => {
      const options = Array.from((/** @type {HTMLSelectElement} */ (select)).options);
      const dailyOption = options.at(-1) || null;
      return dailyOption?.value || null;
    });
    assert.equal(typeof dailyValue, 'string');
    assert.notEqual(dailyValue, '');

    await page.locator('#levelSel').selectOption(dailyValue);
    await page.waitForFunction(() => {
      const dailyMeta = document.getElementById('dailyMeta');
      return Boolean(dailyMeta && !dailyMeta.hidden);
    }, { timeout: 10000 });

    await getCellLocator(page, 0, 0).click();
    await getCellLocator(page, 0, 1).click();
    await getCellLocator(page, 0, 2).click();

    const lockAtUtcMs = await page.evaluate(async () => {
      const response = await fetch('/daily/today.json', {
        cache: 'no-store',
        headers: {
          'x-bypass-cache': 'true',
        },
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return Number(payload?.hardInvalidateAtUtcMs) || null;
    });
    assert.equal(Number.isInteger(lockAtUtcMs), true);
    assert.notEqual(lockAtUtcMs, null);

    await page.evaluate((lockAt) => {
      /** @type {any} */ (window).__setTestNow(lockAt + 2000);
    }, /** @type {number} */ (lockAtUtcMs));

    await page.waitForFunction(() => {
      const boardWrap = document.getElementById('grid')?.parentElement || null;
      return Boolean(boardWrap?.classList.contains('isDailyLocked'));
    }, { timeout: 10000 });
    await page.waitForTimeout(DAILY_LOCK_SETTLE_MS);

    const state = await page.evaluate(() => {
      const boardWrap = document.getElementById('grid')?.parentElement || null;
      const readCellStyle = (r, c) => {
        const cell = document.querySelector(`[data-r="${r}"][data-c="${c}"]`);
        if (!cell) return null;
        const styles = getComputedStyle(cell);
        return {
          backgroundImage: styles.backgroundImage,
          borderColor: styles.borderColor,
          boxShadow: styles.boxShadow,
        };
      };

      return {
        locked: Boolean(boardWrap?.classList.contains('isDailyLocked')),
        wall: readCellStyle(1, 1),
        empty: readCellStyle(0, 5),
        tip: readCellStyle(0, 0),
        mid: readCellStyle(0, 1),
      };
    });

    assert.equal(state.locked, true);
    assert.ok(state.wall);
    assert.ok(state.empty);
    assert.ok(state.tip);
    assert.ok(state.mid);

    const wallDiffersFromEmpty = (
      state.wall.backgroundImage !== state.empty.backgroundImage
      || state.wall.borderColor !== state.empty.borderColor
      || state.wall.boxShadow !== state.empty.boxShadow
    );
    const tipDiffersFromMid = (
      state.tip.backgroundImage !== state.mid.backgroundImage
      || state.tip.borderColor !== state.mid.borderColor
      || state.tip.boxShadow !== state.mid.boxShadow
    );

    assert.equal(wallDiffersFromEmpty, true);
    assert.equal(tipDiffersFromMid, true);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
});
