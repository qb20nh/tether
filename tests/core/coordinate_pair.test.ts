import assert from 'node:assert/strict';
import test from '../test.ts';
import { parseCoordinatePair } from '../../src/shared/coordinate_pair.ts';

test('parseCoordinatePair accepts array and object coordinates', () => {
  assert.deepEqual(parseCoordinatePair([2, 3]), { r: 2, c: 3 });
  assert.deepEqual(parseCoordinatePair({ r: 4, c: 5 }), { r: 4, c: 5 });
});

test('parseCoordinatePair rejects malformed coordinates', () => {
  assert.equal(parseCoordinatePair((([1] as unknown) as [number, number])), null);
  assert.equal(parseCoordinatePair({ r: 1, c: 'x' }), null);
  assert.equal(parseCoordinatePair(null), null);
});
