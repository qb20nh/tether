import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from '../test.ts';
import { fileURLToPath } from 'node:url';

import { buildRuntimeRegressionCorpus } from './refactor_regression_corpus.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'refactor_regression.fixture.json');

test('runtime regression corpus stays stable', async () => {
  const raw = await fs.readFile(FIXTURE_PATH, 'utf8');
  const expected = JSON.parse(raw);
  const actual = buildRuntimeRegressionCorpus();
  assert.deepEqual(actual, expected);
});
