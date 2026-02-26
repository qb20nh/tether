import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardCellViewModel } from '../../src/renderer/board_view_model.js';

test('board view model maps path and statuses to classes', () => {
  const snapshot = {
    rows: 2,
    cols: 2,
    gridData: [
      ['.', '#'],
      ['m', '.'],
    ],
    path: [{ r: 0, c: 0 }, { r: 1, c: 1 }],
  };

  const desired = buildBoardCellViewModel(
    snapshot,
    {
      hintStatus: { badKeys: ['0,0'], goodKeys: [] },
      rpsStatus: { badKeys: [], goodKeys: ['1,1'] },
      blockedStatus: { badKeys: ['1,0'] },
    },
    (code) => code,
  );

  assert.ok(desired[0][0].classes.includes('visited'));
  assert.ok(desired[0][0].classes.includes('pathStart'));
  assert.ok(desired[0][0].classes.includes('badHint'));

  assert.ok(desired[1][1].classes.includes('visited'));
  assert.ok(desired[1][1].classes.includes('pathEnd'));
  assert.ok(desired[1][1].classes.includes('goodRps'));

  assert.ok(desired[1][0].classes.includes('wall'));
  assert.ok(desired[1][0].classes.includes('movable'));
  assert.ok(desired[1][0].classes.includes('badBlocked'));
});
