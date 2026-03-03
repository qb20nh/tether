import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_DOT_COLORS,
  formatHistoryRelativeTime,
  getHistoryDeathFadeRank,
  hasUnreadSystemHistory,
  historyEntryDotColor,
} from '../../src/runtime/notification_history.js';

test('hasUnreadSystemHistory only reflects unread system entries', () => {
  assert.equal(hasUnreadSystemHistory([]), false);
  assert.equal(hasUnreadSystemHistory([
    { source: 'toast', marker: 'unread' },
    { source: 'system', marker: 'just-read' },
  ]), false);
  assert.equal(hasUnreadSystemHistory([
    { source: 'toast', marker: 'unread' },
    { source: 'system', marker: 'unread' },
  ]), true);
});

test('historyEntryDotColor applies source rules for all marker states', () => {
  assert.equal(historyEntryDotColor({ source: 'system', marker: 'unread' }), HISTORY_DOT_COLORS.RED);
  assert.equal(historyEntryDotColor({ source: 'system', marker: 'just-read' }), HISTORY_DOT_COLORS.RED);
  assert.equal(historyEntryDotColor({ source: 'system', marker: 'older' }), HISTORY_DOT_COLORS.RED);
  assert.equal(historyEntryDotColor({ source: 'toast', marker: 'unread' }), HISTORY_DOT_COLORS.BLUE);
  assert.equal(historyEntryDotColor({ source: 'toast', marker: 'just-read' }), HISTORY_DOT_COLORS.BLUE);
  assert.equal(historyEntryDotColor({ source: 'toast', marker: 'older' }), HISTORY_DOT_COLORS.BLUE);
  assert.equal(historyEntryDotColor({ source: 'unknown', marker: 'older' }), HISTORY_DOT_COLORS.NONE);
});

test('getHistoryDeathFadeRank only marks oldest 10 when list is longer than 10', () => {
  assert.equal(getHistoryDeathFadeRank(0, 10), -1);
  assert.equal(getHistoryDeathFadeRank(0, 11), -1);
  assert.equal(getHistoryDeathFadeRank(1, 11), 0);
  assert.equal(getHistoryDeathFadeRank(10, 11), 9);
});

test('formatHistoryRelativeTime uses locale-aware relative phrases', () => {
  const now = Date.UTC(2026, 2, 3, 12, 0, 0, 0);
  const twoHoursAgo = now - (2 * 60 * 60 * 1000);
  const result = formatHistoryRelativeTime(twoHoursAgo, 'en', now);
  assert.equal(typeof result, 'string');
  assert.equal(result.length > 0, true);
});

test('formatHistoryRelativeTime returns locale "just now" for under one minute', () => {
  const now = Date.UTC(2026, 2, 3, 12, 0, 0, 0);
  const fortyFiveSecondsAgo = now - (45 * 1000);
  const fortyFiveSecondsAhead = now + (45 * 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const expected = formatter.format(0, 'second');

  assert.equal(formatHistoryRelativeTime(fortyFiveSecondsAgo, 'en', now), expected);
  assert.equal(formatHistoryRelativeTime(fortyFiveSecondsAhead, 'en', now), expected);
});
