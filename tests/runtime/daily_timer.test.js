import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdownHms,
  formatDailyDateLabel,
  formatDailyMonthDayLabel,
  utcStartMsFromDateId,
} from '../../src/runtime/daily_timer.js';

test('utcStartMsFromDateId parses valid UTC date ids', () => {
  assert.equal(utcStartMsFromDateId('2026-03-01'), Date.UTC(2026, 2, 1, 0, 0, 0, 0));
  assert.equal(utcStartMsFromDateId('invalid'), null);
});

test('daily date labels are localized using UTC date', () => {
  const date = new Date(Date.UTC(2026, 2, 1, 0, 0, 0, 0));
  const locale = 'ko-KR';
  const expectedFull = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
  const expectedMonthDay = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
  }).format(date);

  assert.equal(formatDailyDateLabel('2026-03-01', locale), expectedFull);
  assert.equal(formatDailyMonthDayLabel('2026-03-01', locale), expectedMonthDay);
});

test('countdown hms uses locale-aware digits', () => {
  const locale = 'ar';
  const format = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    useGrouping: false,
  });
  const expected = `${format.format(1)}:${format.format(2)}:${format.format(3)}`;
  assert.equal(formatCountdownHms(3723000, locale), expected);
  assert.equal(formatCountdownHms(0, locale).includes(':'), true);
});
