import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runCommand, waitForServer } from './lib/process_utils.js';
import { runRenderDragBenchmarkSuite } from './lib/render_drag_browser_runner.js';
import { createRenderDragWorkload } from './lib/render_drag_workload.js';
import { buildMetricSummary, formatMetric, median } from './lib/stats.js';


const DEFAULT_NEXT_REV = 'HEAD';
const DEFAULT_PREV_REV = 'HEAD~2';
const DEFAULT_SEED = 'render-drag-bench-v1';
const DEFAULT_BOARD_COUNT = 10;
const DEFAULT_REPEAT_COUNT = 3;
const DEFAULT_OUTPUT_DIR = os.tmpdir();
const BUILD_DATETIME = '2026-03-09T00:00:00.000Z';
const DEFAULT_PORTS = Object.freeze({
  baseline: 4273,
  candidate: 4274,
});
const DEFAULT_MODES = Object.freeze(['normal', 'low-power']);
const WORKLOAD_GUARD_FILES = Object.freeze([
  'src/infinite.js',
  'src/core/level_provider.js',
  'src/state/game_state_store.js',
  'src/state/snapshot_rules.js',
  'src/utils.js',
  'src/config.js',
]);
const WORKTREE_LABEL = 'WORKTREE';
const WORKTREE_EXCLUDED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
]);

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const resolvedRepoRoot = path.resolve(repoRoot);
const viteBinPath = path.resolve(resolvedRepoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const applyArg = (args, key, value, token) => {
  switch (key) {
    case '--next':
    case '--candidate-rev':
      args.nextRev = value;
      break;
    case '--prev':
    case '--baseline-rev':
      args.prevRev = value;
      break;
    case '--seed':
      args.seed = value;
      break;
    case '--boards':
      args.boards = Number.parseInt(value, 10);
      break;
    case '--repeats':
      args.repeats = Number.parseInt(value, 10);
      break;
    case '--out':
      args.out = value;
      break;
    case '--modes':
      args.modes = value.split(',').map((v) => v.trim()).filter(Boolean);
      break;
    default:
      throw new Error(`Unknown argument: ${token}`);
  }
};

const validateArgs = (args, positionals) => {
  if (positionals.length > 2) {
    throw new Error(`Expected at most two positional inputs: prev [next], got ${positionals.length}`);
  }
  if (positionals.length >= 1) {
    args.prevRev = positionals[0];
    args.nextRev = positionals.length === 2 ? positionals[1] : '';
  }

  if (!Number.isInteger(args.boards) || args.boards <= 0) {
    throw new Error(`--boards must be a positive integer, got ${args.boards}`);
  }
  if (!Number.isInteger(args.repeats) || args.repeats <= 0) {
    throw new Error(`--repeats must be a positive integer, got ${args.repeats}`);
  }
  if (!Array.isArray(args.modes) || args.modes.length === 0) {
    throw new Error('--modes must specify at least one benchmark mode');
  }
  for (const mode of args.modes) {
    if (!DEFAULT_MODES.includes(mode)) {
      throw new Error(`Unsupported benchmark mode: ${mode}`);
    }
  }
};

const parseArgs = (argv) => {
  const args = {
    nextRev: DEFAULT_NEXT_REV,
    prevRev: DEFAULT_PREV_REV,
    seed: DEFAULT_SEED,
    boards: DEFAULT_BOARD_COUNT,
    repeats: DEFAULT_REPEAT_COUNT,
    out: '',
    keepTemp: false,
    modes: DEFAULT_MODES.slice(),
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--keep-temp') {
      args.keepTemp = true;
      continue;
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const eqIdx = token.indexOf('=');
    if (eqIdx >= 0) {
      applyArg(args, token.slice(0, eqIdx), token.slice(eqIdx + 1), token);
    } else {
      if ((i + 1) >= argv.length) throw new Error(`Missing value for ${token}`);
      applyArg(args, token, argv[i + 1], token);
      i += 1;
    }
  }

  validateArgs(args, positionals);

  return args;
};

const resolveRevision = (revSpec) => {
  if (typeof revSpec !== 'string' || revSpec.length === 0) {
    return {
      type: 'worktree',
      spec: '',
      full: WORKTREE_LABEL,
      short: 'worktree',
    };
  }
  const full = execFileSync('git', ['rev-parse', '--verify', `${revSpec}^{commit}`], {
    cwd: resolvedRepoRoot,
    encoding: 'utf8',
  }).trim();
  const short = execFileSync('git', ['rev-parse', '--short=8', full], {
    cwd: resolvedRepoRoot,
    encoding: 'utf8',
  }).trim();
  return {
    type: 'commit',
    spec: revSpec,
    full,
    short,
  };
};

const isWorktreeDirty = () => {
  const output = execFileSync('git', ['status', '--porcelain'], {
    cwd: resolvedRepoRoot,
    encoding: 'utf8',
  });
  return output.trim().length > 0;
};

const isStrictAncestorCommit = (prevRevision, nextRevision) => {
  if (prevRevision.type !== 'commit' || nextRevision.type !== 'commit') return false;
  if (prevRevision.full === nextRevision.full) return false;
  const mergeBase = execFileSync('git', ['merge-base', prevRevision.full, nextRevision.full], {
    cwd: resolvedRepoRoot,
    encoding: 'utf8',
  }).trim();
  return mergeBase === prevRevision.full;
};

const assertRevisionOrder = (prevRevision, nextRevision) => {
  if (prevRevision.type !== 'commit') {
    throw new Error('prev must be a commit hash');
  }

  if (nextRevision.type === 'commit') {
    if (!isStrictAncestorCommit(prevRevision, nextRevision)) {
      throw new Error(
        `prev must be strictly older than next: ${prevRevision.short} !< ${nextRevision.short}`,
      );
    }
    return;
  }

  const headRevision = resolveRevision('HEAD');
  const dirty = isWorktreeDirty();
  if (dirty) {
    if (prevRevision.full === headRevision.full) return;
    if (isStrictAncestorCommit(prevRevision, headRevision)) return;
    throw new Error(
      `prev must be older than the current working tree base HEAD: ${prevRevision.short} !< ${headRevision.short}+worktree`,
    );
  }

  if (!isStrictAncestorCommit(prevRevision, headRevision)) {
    throw new Error(
      `prev must be strictly older than next: ${prevRevision.short} !< ${headRevision.short}`,
    );
  }
};

const resolveFileText = (revision, relativePath) => execFileSync(
  'git',
  ['show', `${revision.full}:${relativePath}`],
  {
    cwd: resolvedRepoRoot,
    encoding: 'utf8',
  },
);

const hashText = (value) => createHash('sha1').update(value).digest('hex');

const resolveWorkloadGuardValue = (revision, relativePath) => {
  const source = revision.type === 'worktree'
    ? readFile(path.resolve(resolvedRepoRoot, relativePath), 'utf8')
    : Promise.resolve(resolveFileText(revision, relativePath));

  return source.then((text) => {
    if (relativePath !== 'src/config.js') {
      return hashText(text);
    }
    const sentinel = '\nexport const ELEMENT_IDS';
    const sentinelIndex = text.indexOf(sentinel);
    const relevant = sentinelIndex >= 0
      ? text.slice(0, sentinelIndex)
      : text;
    return hashText(relevant);
  });
};

const assertSharedWorkloadInputs = async (candidateRevision, baselineRevision) => {
  const mismatches = [];
  for (const element of WORKLOAD_GUARD_FILES) {
    const relativePath = element;
    const candidateBlob = await resolveWorkloadGuardValue(candidateRevision, relativePath);
    const baselineBlob = await resolveWorkloadGuardValue(baselineRevision, relativePath);
    if (candidateBlob === baselineBlob) continue;
    mismatches.push(relativePath);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Shared workload input files differ between ${candidateRevision.short} and ${baselineRevision.short}: ${mismatches.join(', ')}`,
    );
  }
};

const pipeArchiveToDirectory = (revision, outputDir) => new Promise((resolve, reject) => {
  const archive = spawn('git', ['archive', '--format=tar', revision.full], {
    cwd: resolvedRepoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const extract = spawn('tar', ['-xf', '-', '-C', outputDir], {
    cwd: resolvedRepoRoot,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  let settled = false;
  let archiveExited = false;
  let extractExited = false;
  let archiveCode = 0;
  let extractCode = 0;

  const finish = (error = null) => {
    if (settled) return;
    if (error) {
      settled = true;
      reject(error);
      return;
    }
    if (!archiveExited || !extractExited) return;
    settled = true;
    if (archiveCode === 0 && extractCode === 0) {
      resolve();
      return;
    }
    reject(new Error(`git archive/tar extraction failed for ${revision.full}`));
  };

  archive.stdout.pipe(extract.stdin);
  archive.on('error', finish);
  extract.on('error', finish);
  archive.on('exit', (code) => {
    archiveExited = true;
    archiveCode = code ?? 1;
    finish();
  });
  extract.on('exit', (code) => {
    extractExited = true;
    extractCode = code ?? 1;
    finish();
  });
});

const ensureNodeModulesSymlink = async (snapshotDir) => {
  const target = path.resolve(snapshotDir, 'node_modules');
  await rm(target, { recursive: true, force: true });
  await symlink(path.resolve(resolvedRepoRoot, 'node_modules'), target);
};

const copyWorktreeToDirectory = async (outputDir) => {
  await cp(resolvedRepoRoot, outputDir, {
    recursive: true,
    filter: (source) => {
      const baseName = path.basename(source);
      return !WORKTREE_EXCLUDED_NAMES.has(baseName);
    },
  });
};

const prepareRevisionSnapshot = async (revision, tempRoot) => {
  const snapshotDir = path.join(tempRoot, revision.short);
  await rm(snapshotDir, { recursive: true, force: true });
  if (revision.type === 'worktree') {
    await copyWorktreeToDirectory(snapshotDir);
  } else {
    await mkdir(snapshotDir, { recursive: true });
    await pipeArchiveToDirectory(revision, snapshotDir);
  }
  await ensureNodeModulesSymlink(snapshotDir);
  return snapshotDir;
};

const buildSnapshot = async (snapshotDir, revision) => {
  await runCommand(process.execPath, [viteBinPath, 'build'], {
    cwd: snapshotDir,
    env: {
      ...process.env,
      VITE_BUILD_NUMBER: '1',
      VITE_BUILD_LABEL: revision.short,
      VITE_BUILD_DATETIME: BUILD_DATETIME,
    },
  });
};

const startPreviewServer = async (snapshotDir, port) => {
  const child = spawn(process.execPath, [
    viteBinPath,
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: snapshotDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_BUILD_NUMBER: '1',
      VITE_BUILD_LABEL: path.basename(snapshotDir),
      VITE_BUILD_DATETIME: BUILD_DATETIME,
    },
  });

  const baseUrl = `http://127.0.0.1:${port}/`;
  try {
    await waitForServer(baseUrl);
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }

  return {
    baseUrl,
    async stop() {
      if (child.killed) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 2000);
      });
    },
  };
};

const aggregateModeRevisionResults = (suiteResults) => {
  const allCaseResults = suiteResults.flatMap((suite) => suite.caseResults);
  const syncValues = allCaseResults.map((item) => item.syncMsPerPointerMove);
  const rafValues = allCaseResults.map((item) => item.rafMsPerPointerMove);
  const stepValues = allCaseResults.map((item) => item.totalMsPerPathStep);
  const dragValues = allCaseResults.map((item) => item.dragWallClockMs);

  return {
    suiteCount: suiteResults.length,
    caseCount: allCaseResults.length,
    pointerMoveCount: allCaseResults.reduce((sum, item) => sum + item.pointerMoveCount, 0),
    pathStepCount: allCaseResults.reduce((sum, item) => sum + item.pathStepCount, 0),
    syncMsPerPointerMove: buildMetricSummary(syncValues, median),
    rafMsPerPointerMove: buildMetricSummary(rafValues, median),
    dragWallClockMs: buildMetricSummary(dragValues, median),
    totalMsPerPathStep: buildMetricSummary(stepValues, median),
  };
};

const percentDelta = (baseline, candidate) => {
  if (!Number.isFinite(baseline) || baseline === 0) return 0;
  return ((candidate - baseline) / baseline) * 100;
};

const buildComparison = ({
  results,
  modes,
  baselineRevision,
  candidateRevision,
}) => {
  const output = {};
  for (const element of modes) {
    const mode = element;
    const baselineSuites = results.filter(
      (suite) => suite.mode === mode && suite.role === 'baseline',
    );
    const candidateSuites = results.filter(
      (suite) => suite.mode === mode && suite.role === 'candidate',
    );
    const baselineAggregate = aggregateModeRevisionResults(baselineSuites);
    const candidateAggregate = aggregateModeRevisionResults(candidateSuites);
    output[mode] = {
      baseline: {
        revision: baselineRevision.full,
        shortRevision: baselineRevision.short,
        ...baselineAggregate,
      },
      candidate: {
        revision: candidateRevision.full,
        shortRevision: candidateRevision.short,
        ...candidateAggregate,
      },
      deltaPercent: {
        rafMsPerPointerMoveMedian: percentDelta(
          baselineAggregate.rafMsPerPointerMove.median,
          candidateAggregate.rafMsPerPointerMove.median,
        ),
        syncMsPerPointerMoveMedian: percentDelta(
          baselineAggregate.syncMsPerPointerMove.median,
          candidateAggregate.syncMsPerPointerMove.median,
        ),
        totalMsPerPathStepMedian: percentDelta(
          baselineAggregate.totalMsPerPathStep.median,
          candidateAggregate.totalMsPerPathStep.median,
        ),
      },
    };
  }
  return output;
};

const printModeSummary = (mode, summary) => {
  process.stdout.write(`\nMode: ${mode}\n`);
  process.stdout.write('revision    raf(ms/move)  sync(ms/move)  total(ms/step)  delta\n');
  const baseline = summary.baseline;
  const candidate = summary.candidate;
  process.stdout.write(
    `${baseline.shortRevision.padEnd(11)}${formatMetric(baseline.rafMsPerPointerMove.median).padStart(14)}${formatMetric(baseline.syncMsPerPointerMove.median).padStart(16)}${formatMetric(baseline.totalMsPerPathStep.median).padStart(16)}  baseline\n`,
  );
  process.stdout.write(
    `${candidate.shortRevision.padEnd(11)}${formatMetric(candidate.rafMsPerPointerMove.median).padStart(14)}${formatMetric(candidate.syncMsPerPointerMove.median).padStart(16)}${formatMetric(candidate.totalMsPerPathStep.median).padStart(16)}  ${summary.deltaPercent.rafMsPerPointerMoveMedian.toFixed(2)}%\n`,
  );
};

const defaultOutPath = () => path.join(
  DEFAULT_OUTPUT_DIR,
  `tether-render-drag-benchmark-${Date.now()}.json`,
);

const maybeReadPlaywright = async () => {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(`Playwright is required for render drag benchmark compare: ${error?.message || error}`);
  }
};

const runComparisonSuites = async ({
  args,
  browser,
  baselineRevision,
  candidateRevision,
  baselineSnapshotDir,
  candidateSnapshotDir,
  workload,
}) => {
  const results = [];
  for (let repeatIndex = 0; repeatIndex < args.repeats; repeatIndex += 1) {
    for (const element of args.modes) {
      const mode = element;
      const suiteOrder = [
        {
          role: 'baseline',
          revision: baselineRevision,
          snapshotDir: baselineSnapshotDir,
          port: DEFAULT_PORTS.baseline,
        },
        {
          role: 'candidate',
          revision: candidateRevision,
          snapshotDir: candidateSnapshotDir,
          port: DEFAULT_PORTS.candidate,
        },
      ];

      for (const element of suiteOrder) {
        const suite = element;
        const preview = await startPreviewServer(suite.snapshotDir, suite.port);
        try {
          const result = await runRenderDragBenchmarkSuite({
            browser,
            baseUrl: preview.baseUrl,
            workload,
            revisionLabel: suite.revision.short,
            mode,
            repeatIndex,
          });
          results.push({
            ...result,
            role: suite.role,
            revisionFull: suite.revision.full,
          });
        } finally {
          await preview.stop();
        }
      }
    }
  }
  return results;
};

export const runRenderDragBenchmarkCompare = async (rawArgs = process.argv.slice(2)) => {
  const args = parseArgs(rawArgs);
  const candidateRevision = resolveRevision(args.nextRev);
  const baselineRevision = resolveRevision(args.prevRev);
  assertRevisionOrder(baselineRevision, candidateRevision);
  await assertSharedWorkloadInputs(candidateRevision, baselineRevision);

  const workload = createRenderDragWorkload({
    seed: args.seed,
    boards: args.boards,
  });
  const tempRoot = path.join(os.tmpdir(), 'tether-render-drag-bench');
  const outputPath = args.out ? path.resolve(args.out) : defaultOutPath();

  const report = {
    nextRev: candidateRevision.full,
    prevRev: baselineRevision.full,
    candidateRev: candidateRevision.full,
    baselineRev: baselineRevision.full,
    nextInput: args.nextRev,
    prevInput: args.prevRev,
    seed: args.seed,
    modes: args.modes.slice(),
    repeats: args.repeats,
    boardCount: args.boards,
    workload,
    results: [],
    comparison: {},
    failures: [],
    buildMode: 'vite build + vite preview',
    ports: {
      baseline: DEFAULT_PORTS.baseline,
      candidate: DEFAULT_PORTS.candidate,
    },
  };

  let browser = null;
  try {
    await mkdir(tempRoot, { recursive: true });
    const baselineSnapshotDir = await prepareRevisionSnapshot(baselineRevision, tempRoot);
    const candidateSnapshotDir = candidateRevision.type === baselineRevision.type
      && candidateRevision.full === baselineRevision.full
      ? baselineSnapshotDir
      : await prepareRevisionSnapshot(candidateRevision, tempRoot);
    await buildSnapshot(baselineSnapshotDir, baselineRevision);
    if (candidateSnapshotDir !== baselineSnapshotDir) {
      await buildSnapshot(candidateSnapshotDir, candidateRevision);
    }

    const { chromium } = await maybeReadPlaywright();
    browser = await chromium.launch({ headless: true });

    report.results = await runComparisonSuites({
      args,
      browser,
      baselineRevision,
      candidateRevision,
      baselineSnapshotDir,
      candidateSnapshotDir,
      workload,
    });

    report.comparison = buildComparison({
      results: report.results,
      modes: args.modes,
      baselineRevision,
      candidateRevision,
    });

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    for (const element of args.modes) {
      const mode = element;
      printModeSummary(mode, report.comparison[mode]);
    }
    process.stdout.write(`\nReport written to ${outputPath}\n`);
    return {
      report,
      outputPath,
    };
  } catch (error) {
    report.failures.push(String(error?.stack || error?.message || error));
    try {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch {
      // Best effort only.
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (!args.keepTemp) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await runRenderDragBenchmarkCompare();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
