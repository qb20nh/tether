import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from '../test.ts';
import {
  parseNonNegativeInt,
  parsePositiveInt,
  readJsonFile,
  readRequiredArgValue,
  writeJsonFile,
} from '../../scripts/lib/cli_utils.ts';

test('readRequiredArgValue reads the next argv token and tracks the next index', () => {
  assert.deepEqual(
    readRequiredArgValue(['--count', '5'], 0, '--count'),
    { nextIndex: 1, value: '5' },
  );
  assert.throws(
    () => readRequiredArgValue(['--count'], 0, '--count'),
    /Missing value for --count/,
  );
});

test('integer parsers preserve positive and non-negative option semantics', () => {
  assert.equal(parsePositiveInt('--count', '4'), 4);
  assert.equal(parseNonNegativeInt('--count', '0'), 0);
  assert.throws(() => parsePositiveInt('--count', '0'), /positive integer/);
  assert.throws(() => parseNonNegativeInt('--count', '-1'), /non-negative integer/);
});

test('JSON file helpers support fallback reads and pretty writes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-utils-test-'));
  const filePath = path.join(tmpDir, 'nested', 'value.json');

  assert.equal(readJsonFile(filePath, null), null);

  writeJsonFile(filePath, { ok: true, count: 2 });

  assert.deepEqual(readJsonFile(filePath), { ok: true, count: 2 });
  assert.equal(fs.readFileSync(filePath, 'utf8').endsWith('\n'), true);
});
