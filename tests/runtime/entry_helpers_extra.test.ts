import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test from '../test.ts';
import { vi } from 'vitest';
import * as stateExports from '../../src/state.ts';
import * as gameStateStore from '../../src/state/game_state_store.ts';
import { resolveLatestUpdateBuildNumber } from '../../src/app/update_build_resolver.ts';

type BoundInputConfig = {
  emitIntent: (intent: unknown) => void;
};

test('state barrel re-exports game state store helpers', () => {
  assert.equal(stateExports.createGameState, gameStateStore.createGameState);
  assert.equal(stateExports.createGameStateStore, gameStateStore.createGameStateStore);
});

test('input compatibility wrapper translates legacy commands and interaction updates', async (t) => {
  vi.resetModules();
  let boundConfig: BoundInputConfig | null = null;
  const unbindCalls: string[] = [];
  vi.doMock('../../src/input/dom_input_adapter.ts', () => ({
    createDomInputAdapter: () => ({
      bind(config: BoundInputConfig) {
        boundConfig = config;
      },
      unbind() {
        unbindCalls.push('unbind');
      },
    }),
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/input/dom_input_adapter.ts');
  });

  const { bindInputHandlers } = await import('../../src/input.ts');
  const legacyCalls: string[] = [];
  const state = {
    getSnapshot: () => ({ rows: 2, cols: 2 }),
    startOrTryStep: (r: number, c: number) => {
      legacyCalls.push(`step:${r},${c}`);
      return true;
    },
    startOrTryStepFromStart: (r: number, c: number) => {
      legacyCalls.push(`start:${r},${c}`);
      return true;
    },
    moveWall: () => true,
  };
  const stateChanges: unknown[] = [];
  const binding = bindInputHandlers({ readLayoutMetrics: () => null } as any, state as any, (validate, payload) => {
    stateChanges.push({ validate, payload });
  });

  assert.ok(boundConfig);
  const config = boundConfig as BoundInputConfig;
  config.emitIntent({
    type: 'game.command',
    payload: { commandType: 'path/start-or-step', r: 1, c: 0 },
  });
  config.emitIntent({
    type: 'interaction.update',
    payload: {
      updateType: 'path-drag',
      isPathDragging: true,
      pathDragSide: 'end',
      pathDragCursor: { r: 1, c: 1 },
    },
  });
  config.emitIntent({
    type: 'game.command',
    payload: { commandType: 'path/start-or-step-from-start', r: 0, c: 1 },
  });
  config.emitIntent({
    type: 'interaction.update',
    payload: {
      updateType: 'other',
    },
  });
  binding.unbind();

  assert.deepEqual(legacyCalls, ['step:1,0', 'start:0,1']);
  assert.deepEqual(stateChanges, [
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: true,
        pathDragSide: 'end',
        pathDragCursor: { r: 1, c: 1 },
      },
    },
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
  ]);
  assert.deepEqual(unbindCalls, ['unbind']);
});

test('input compatibility wrapper prefers dispatch and covers path-drag, finalize, wall move, and ignored intents', async (t) => {
  vi.resetModules();
  let boundConfig: BoundInputConfig | null = null;
  vi.doMock('../../src/input/dom_input_adapter.ts', () => ({
    createDomInputAdapter: () => ({
      bind(config: BoundInputConfig) {
        boundConfig = config;
      },
      unbind() {},
    }),
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/input/dom_input_adapter.ts');
  });

  const { bindInputHandlers } = await import('../../src/input.ts');
  const dispatched: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const stateChanges: unknown[] = [];
  bindInputHandlers({} as any, {
    getSnapshot: () => ({ rows: 3, cols: 3 }),
    dispatch: (command: { type: string; payload?: Record<string, unknown> }) => {
      dispatched.push(command);
      return {
        changed: command.type !== 'unknown',
        validate: command.type === 'path/finalize-after-pointer',
        rebuildGrid: command.type === 'wall/move-attempt',
      };
    },
    startOrTryStep: () => false,
    startOrTryStepFromStart: () => false,
    moveWall: () => false,
  } as any, (validate, payload) => {
    stateChanges.push({ validate, payload });
  });

  assert.ok(boundConfig);
  const config = boundConfig as BoundInputConfig;
  config.emitIntent({
    type: 'game.command',
    payload: {
      commandType: 'path/apply-drag-sequence',
      pathDragSide: 'start',
      steps: [{ r: 0, c: 0 }],
    },
  });
  config.emitIntent({
    type: 'game.command',
    payload: { commandType: 'path/finalize-after-pointer' },
  });
  config.emitIntent({
    type: 'game.command',
    payload: {
      commandType: 'wall/move-attempt',
      from: { r: 0, c: 0 },
      to: { r: 0, c: 1 },
    },
  });
  config.emitIntent({
    type: 'interaction.update',
    payload: {
      updateType: 'path-drag',
      isPathDragging: true,
      pathDragSide: 'start',
      pathDragCursor: { r: 'bad', c: 1 },
    },
  });
  config.emitIntent({
    type: 'game.command',
    payload: { commandType: 'unknown' },
  });
  config.emitIntent({
    type: 'ui.action',
    payload: { actionType: 'noop' },
  });

  assert.deepEqual(dispatched, [
    {
      type: 'path/apply-drag-sequence',
      payload: {
        commandType: 'path/apply-drag-sequence',
        pathDragSide: 'start',
        steps: [{ r: 0, c: 0 }],
      },
    },
    {
      type: 'path/finalize-after-pointer',
      payload: { commandType: 'path/finalize-after-pointer' },
    },
    {
      type: 'wall/move-attempt',
      payload: {
        commandType: 'wall/move-attempt',
        from: { r: 0, c: 0 },
        to: { r: 0, c: 1 },
      },
    },
    {
      type: 'unknown',
      payload: { commandType: 'unknown' },
    },
  ]);
  assert.deepEqual(stateChanges, [
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
    {
      validate: true,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
    {
      validate: false,
      payload: {
        rebuildGrid: true,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: true,
        pathDragSide: 'start',
        pathDragCursor: null,
      },
    },
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
  ]);
});

test('input compatibility wrapper uses legacy path-drag and finalize helpers when dispatch is absent', async (t) => {
  vi.resetModules();
  let boundConfig: BoundInputConfig | null = null;
  vi.doMock('../../src/input/dom_input_adapter.ts', () => ({
    createDomInputAdapter: () => ({
      bind(config: BoundInputConfig) {
        boundConfig = config;
      },
      unbind() {},
    }),
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/input/dom_input_adapter.ts');
  });

  const { bindInputHandlers } = await import('../../src/input.ts');
  const calls: string[] = [];
  const stateChanges: unknown[] = [];
  bindInputHandlers({} as any, {
    getSnapshot: () => ({ rows: 2, cols: 2 }),
    startOrTryStep: () => false,
    startOrTryStepFromStart: () => false,
    applyPathDragSequence: (side: unknown, steps: unknown) => {
      calls.push(`drag:${String(side)}:${Array.isArray(steps) ? steps.length : 0}`);
      return true;
    },
    finalizePathAfterPointerUp: () => {
      calls.push('finalize');
      return true;
    },
    moveWall: () => false,
  } as any, (validate, payload) => {
    stateChanges.push({ validate, payload });
  });

  assert.ok(boundConfig);
  const config = boundConfig as BoundInputConfig;
  config.emitIntent({
    type: 'game.command',
    payload: {
      commandType: 'path/apply-drag-sequence',
      side: 'end',
      steps: [{ r: 0, c: 0 }, { r: 0, c: 1 }],
    },
  });
  config.emitIntent({
    type: 'game.command',
    payload: { commandType: 'path/finalize-after-pointer' },
  });

  assert.deepEqual(calls, ['drag:end:2', 'finalize']);
  assert.deepEqual(stateChanges, [
    {
      validate: false,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
    {
      validate: true,
      payload: {
        rebuildGrid: false,
        isPathDragging: false,
        pathDragSide: null,
        pathDragCursor: null,
      },
    },
  ]);
});

test('update build resolver ignores invalid values and null updatable versions', async () => {
  const result = await resolveLatestUpdateBuildNumber({
    hintBuildNumber: 'bad' as unknown as number,
    readLastNotifiedRemoteBuildNumber: () => ('bad' as unknown as number),
    notificationHistoryEntries: [
      { kind: 'new-version-available', action: { type: 'apply-update', buildNumber: 'oops' } },
      { kind: 'toast', action: { type: 'apply-update', buildNumber: 999 } },
    ] as any,
    fetchRemoteBuildNumber: async () => ('oops' as unknown as number),
    resolveUpdatableRemoteBuildNumber: async () => null,
    localBuildNumber: 10,
  });

  assert.equal(result, null);
});

test('update build resolver uses default callbacks when options are omitted', async () => {
  assert.equal(await resolveLatestUpdateBuildNumber(), null);
});

test('infinite overrides helpers detect gzip headers and decode empty payloads', async () => {
  const mod = await import('../../src/infinite_overrides.ts');
  assert.equal(mod.__TEST__.hasGzipHeader(Uint8Array.from([0x1f, 0x8b, 0x00])), true);
  assert.equal(mod.__TEST__.hasGzipHeader(Uint8Array.from([0x00, 0x8b, 0x00])), false);
  assert.deepEqual({ ...(await mod.__TEST__.decodeOverridePayloadBytes(null)) }, {});
  assert.equal(typeof mod.INFINITE_OVERRIDE_BY_INDEX, 'object');
});

test('daily pool tools helpers cover score, digest, date math, and gzip round-trips', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-tools-extra-'));
  const payloadFile = path.join(tmpDir, 'daily_overrides.bin.gz');
  const {
    addUtcDaysToDateId,
    buildInfiniteCanonicalKeySet,
    computePoolDigest,
    estimateDailyDifficultyScore,
    replayWitnessAndValidate,
    readDailyOverridesGzipFile,
    utcStartMsFromDateId,
    writeDailyOverridesGzipFile,
  } = await import('../../scripts/daily_pool_tools.ts');

  assert.equal(estimateDailyDifficultyScore(null), -1);
  assert.throws(() => buildInfiniteCanonicalKeySet(0), /maxLevels/);
  assert.equal(computePoolDigest(['a', 'b']).length, 64);
  assert.equal(utcStartMsFromDateId('2026-01-01'), Date.UTC(2026, 0, 1));
  assert.equal(addUtcDaysToDateId('2026-01-01', 2), '2026-01-03');
  assert.equal(replayWitnessAndValidate({ grid: ['..'], infiniteMeta: { witnessPath: [] } } as any), false);

  const encoded = writeDailyOverridesGzipFile(payloadFile, new Map([[2, 3], [5, 7]]), 7);
  assert.equal(encoded.variantBits > 0, true);
  assert.deepEqual({ ...readDailyOverridesGzipFile(payloadFile) }, { 2: 3, 5: 7 });
});
