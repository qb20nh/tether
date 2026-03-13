import assert from 'node:assert/strict';
import test from '../test.ts';
import { buildBoardCellViewModel } from '../../src/renderer/board_view_model.ts';

test('board view model maps path and statuses to classes', () => {
  const snapshot = ({
    rows: 2,
    cols: 2,
    gridData: [
      ['.', '#'],
      ['m', '.'],
    ],
    path: [{ r: 0, c: 0 }, { r: 1, c: 1 }],
  } as any);

  const desired = buildBoardCellViewModel(
    snapshot,
    ({
      hintStatus: { badKeys: ['0,0'], goodKeys: [] },
      rpsStatus: { badKeys: [], goodKeys: ['1,1'] },
      blockedStatus: { badKeys: ['1,0'] },
    } as any),
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

test('board view model reuses output matrix when provided', () => {
  const snapshotA = ({
    rows: 2,
    cols: 2,
    gridData: [
      ['.', '.'],
      ['.', '.'],
    ],
    path: [{ r: 0, c: 0 }],
  } as any);
  const snapshotB = ({
    rows: 2,
    cols: 2,
    gridData: [
      ['.', '.'],
      ['.', '.'],
    ],
    path: [{ r: 1, c: 1 }],
  } as any);

  const reused = buildBoardCellViewModel(snapshotA, ({} as any), (code) => code, null);
  const cellRef = reused[0][0];
  const classRef = reused[0][0].classes;

  const next = buildBoardCellViewModel(snapshotB, ({} as any), (code) => code, reused);
  assert.equal(next, reused);
  assert.equal(next[0][0], cellRef);
  assert.equal(next[0][0].classes, classRef);
  assert.equal(next[0][0].classes.includes('pathStart'), false);
  assert.equal(next[1][1].classes.includes('pathStart'), true);
});
