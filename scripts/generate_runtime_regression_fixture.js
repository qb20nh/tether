import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRuntimeRegressionCorpus } from '../tests/runtime/refactor_regression_corpus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '..', 'tests', 'runtime', 'fixtures', 'refactor_regression.fixture.json');

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(buildRuntimeRegressionCorpus(), null, 2)}\n`, 'utf8');
