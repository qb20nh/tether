import assert from 'node:assert/strict';
import path from 'node:path';
import test from '../test.ts';
import { vi } from 'vitest';

interface MockHarness {
  writtenFiles: Map<string, string>;
  browserCloseCalls: number;
  spawnCalls: Array<{ command: string; args: string[] }>;
}

const installRenderDragCompareMocks = ({
  mismatchRelativePath = null,
  failRunCommand = false,
}: {
  mismatchRelativePath?: string | null;
  failRunCommand?: boolean;
} = {}): MockHarness => {
  const writtenFiles = new Map<string, string>();
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  let browserCloseCalls = 0;

  const resolveBaselineFileText = (relativePath: string): string => {
    if (relativePath === 'src/config.ts') {
      return 'const bootstrap = true;\nexport const ELEMENT_IDS = {};\nignored-tail';
    }
    return `shared:${relativePath}`;
  };

  const resolveWorktreeFileText = (relativePath: string): string => {
    if (relativePath === 'src/config.ts') {
      return `const bootstrap = true;\nexport const ELEMENT_IDS = {};\n${mismatchRelativePath === relativePath ? 'mismatch-tail' : 'ignored-tail'}`;
    }
    return mismatchRelativePath === relativePath
      ? `mismatch:${relativePath}`
      : `shared:${relativePath}`;
  };

  const makeArchiveChild = () => ({
    stdout: {
      pipe() {},
    },
    stdin: {},
    on(event: string, handler: (value?: number) => void) {
      if (event === 'exit') queueMicrotask(() => handler(0));
      return this;
    },
  });

  const makePreviewChild = () => {
    let exitHandler: (() => void) | null = null;
    return {
      killed: false,
      stdout: { pipe() {} },
      stdin: {},
      on() {
        return this;
      },
      once(event: string, handler: () => void) {
        if (event === 'exit') {
          exitHandler = handler;
          if (this.killed) {
            queueMicrotask(() => exitHandler?.());
          }
        }
        return this;
      },
      kill() {
        this.killed = true;
        if (exitHandler) queueMicrotask(() => exitHandler?.());
      },
    };
  };

  vi.doMock('node:child_process', () => ({
    execFileSync: (command: string, args: string[]) => {
      assert.equal(command, 'git');
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        if (args[2] === 'HEAD^commit' || args[2] === 'HEAD^{commit}') return 'headfull\n';
        throw new Error(`Unexpected rev-parse target: ${args[2]}`);
      }
      if (args[0] === 'rev-parse' && args[1] === '--short=8') {
        if (args[2] === 'headfull') return 'head12345\n';
        throw new Error(`Unexpected short target: ${args[2]}`);
      }
      if (args[0] === 'status') return ' M src/app.ts\n';
      if (args[0] === 'show') {
        const ref = String(args[1]);
        const separator = ref.indexOf(':');
        const relativePath = ref.slice(separator + 1);
        return `${resolveBaselineFileText(relativePath)}\n`;
      }
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    },
    spawn: (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      if (command === 'git' && args[0] === 'archive') return makeArchiveChild();
      if (command === 'tar' && args[0] === '-xf') return makeArchiveChild();
      return makePreviewChild();
    },
  }));
  vi.doMock('node:fs/promises', () => ({
    cp: async () => {},
    mkdir: async () => {},
    readFile: async (filePath: string) => {
      const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
      return `${resolveWorktreeFileText(relativePath)}\n`;
    },
    rm: async () => {},
    symlink: async () => {},
    writeFile: async (filePath: string, contents: string) => {
      writtenFiles.set(filePath, contents);
    },
  }));
  vi.doMock('../../scripts/lib/process_utils.ts', () => ({
    runCommand: async () => {
      if (failRunCommand) {
        throw new Error('mock build failed');
      }
    },
    waitForServer: async (_baseUrl: string) => {},
  }));
  vi.doMock('../../scripts/lib/render_drag_workload.ts', () => ({
    createRenderDragWorkload: ({ seed, boards }: { seed: string; boards: number }) => ({
      seed,
      boards,
      pointerMovesPerSegment: 2,
      cases: [{
        caseId: 'case-1',
        infiniteIndex: 4,
        pathCells: [[0, 0], [0, 1]],
      }],
    }),
  }));
  vi.doMock('../../scripts/lib/render_drag_browser_runner.ts', () => ({
    runRenderDragBenchmarkSuite: async ({
      baseUrl,
      revisionLabel,
      mode,
      repeatIndex,
    }: {
      baseUrl: string;
      revisionLabel: string;
      mode: 'normal' | 'low-power';
      repeatIndex?: number;
    }) => ({
      revision: revisionLabel,
      mode,
      repeatIndex: repeatIndex ?? 0,
      viewport: { width: 1200, height: 860 },
      pageErrors: [],
      caseResults: [{
        caseId: `${revisionLabel}-${mode}-${baseUrl.includes(':4273') ? 'baseline' : 'candidate'}`,
        infiniteIndex: 4,
        revision: revisionLabel,
        mode,
        pathCells: [[0, 0], [0, 1]],
        actualPathCells: [[0, 0], [0, 1]],
        pointerMoveCount: 4,
        pathStepCount: 1,
        totalSyncDispatchMs: baseUrl.includes(':4273') ? 8 : 10,
        totalToNextRafMs: baseUrl.includes(':4273') ? 12 : 15,
        syncMsPerPointerMove: baseUrl.includes(':4273') ? 2 : 2.5,
        rafMsPerPointerMove: baseUrl.includes(':4273') ? 3 : 3.75,
        totalMsPerPathStep: baseUrl.includes(':4273') ? 12 : 15,
        dragWallClockMs: baseUrl.includes(':4273') ? 14 : 17,
        moveMetrics: [],
        hasPathStartClass: true,
        hasPathEndClass: true,
        hasWebgl2: true,
        isContextLost: false,
      }],
      aggregate: {
        caseCount: 1,
        totalPointerMoves: 4,
        totalPathSteps: 1,
        syncMsPerPointerMove: { min: 2, max: 2, mean: 2, median: 2, p95: 2 },
        rafMsPerPointerMove: { min: 3, max: 3, mean: 3, median: 3, p95: 3 },
        dragWallClockMs: { min: 14, max: 14, mean: 14, median: 14, p95: 14 },
        totalMsPerPathStep: { min: 12, max: 12, mean: 12, median: 12, p95: 12 },
      },
    }),
  }));
  vi.doMock('playwright', () => ({
    chromium: {
      launch: async () => ({
        close: async () => {
          browserCloseCalls += 1;
        },
      }),
    },
  }));

  return {
    writtenFiles,
    get browserCloseCalls() {
      return browserCloseCalls;
    },
    spawnCalls,
  };
};

test('runRenderDragBenchmarkCompare writes a comparison report with mocked git and preview processes', async (t) => {
  vi.resetModules();
  const harness = installRenderDragCompareMocks();
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs/promises');
    vi.doUnmock('../../scripts/lib/process_utils.ts');
    vi.doUnmock('../../scripts/lib/render_drag_workload.ts');
    vi.doUnmock('../../scripts/lib/render_drag_browser_runner.ts');
    vi.doUnmock('playwright');
  });

  const outFile = path.join(process.cwd(), 'tmp-render-drag-report.json');
  const { runRenderDragBenchmarkCompare } = await import('../../scripts/render_drag_benchmark_compare.ts');
  const { report, outputPath } = await runRenderDragBenchmarkCompare([
    'HEAD',
    '--boards', '1',
    '--repeats', '1',
    '--modes', 'normal',
    '--out', outFile,
  ]);

  assert.equal(outputPath, outFile);
  assert.equal(report.results.length, 2);
  assert.equal(report.comparison.normal?.baseline.shortRevision, 'head12345');
  assert.equal(report.comparison.normal?.candidate.shortRevision, 'worktree');
  assert.equal(harness.browserCloseCalls, 1);
  assert.equal(harness.writtenFiles.has(outFile), true);
  assert.equal(harness.spawnCalls.some((call) => call.command === process.execPath && call.args.includes('preview')), true);
});

test('runRenderDragBenchmarkCompare persists a failure report when workload guard files mismatch', async (t) => {
  vi.resetModules();
  const harness = installRenderDragCompareMocks({
    failRunCommand: true,
  });
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs/promises');
    vi.doUnmock('../../scripts/lib/process_utils.ts');
    vi.doUnmock('../../scripts/lib/render_drag_workload.ts');
    vi.doUnmock('../../scripts/lib/render_drag_browser_runner.ts');
    vi.doUnmock('playwright');
  });

  const outFile = path.join(process.cwd(), 'tmp-render-drag-report-fail.json');
  const { runRenderDragBenchmarkCompare } = await import('../../scripts/render_drag_benchmark_compare.ts');

  await assert.rejects(
    runRenderDragBenchmarkCompare(['HEAD', '--out', outFile]),
    /mock build failed/,
  );
  assert.equal(harness.writtenFiles.has(outFile), true);
  assert.match(harness.writtenFiles.get(outFile) || '', /mock build failed/);
});
