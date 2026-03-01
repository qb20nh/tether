import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { __TEST__ } from '../../src/infinite_overrides.js';

const PACKED_PAYLOAD = Uint8Array.from([
  0x49, // format magic
  0x01, // format version
  0x02, // variant bit width
  0x15, // delta=5, variant=1
  0x1a, // delta=6, variant=2
]);

test('decodeOverridePayloadBytes decodes already-uncompressed payload bytes', async () => {
  const decoded = await __TEST__.decodeOverridePayloadBytes(PACKED_PAYLOAD);
  assert.deepEqual(decoded, Object.freeze(Object.assign(Object.create(null), {
    4: 1,
    10: 2,
  })));
});

test('decodeOverridePayloadBytes decodes gzip-compressed payload bytes', async () => {
  const gzipped = new Uint8Array(gzipSync(PACKED_PAYLOAD));
  const decoded = await __TEST__.decodeOverridePayloadBytes(gzipped);
  assert.deepEqual(decoded, Object.freeze(Object.assign(Object.create(null), {
    4: 1,
    10: 2,
  })));
});
