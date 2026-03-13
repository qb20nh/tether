import { createHash } from 'node:crypto';

import type {
  GameSnapshot,
  GridPoint,
  GridTuple,
  StateCommand,
  StateTransition,
} from '../../src/contracts/ports.ts';
import { normalizeDailyPayload } from '../../src/app/daily_payload_service.ts';
import { decodeDailyOverridesPayload, encodeDailyOverridesPayload } from '../../src/daily_pool_codec.ts';
import { generateInfiniteLevel, selectDefaultInfiniteVariant } from '../../src/infinite.ts';
import {
  getPathTipFromPath,
  isEndAdvanceTransition,
  isEndRetractTransition,
  isPathReversed,
  isRetractUnturnTransition,
  isStartAdvanceTransition,
  isStartRetractTransition,
  normalizeFlowOffset,
  pathsMatch,
  resolvePathSignature,
} from '../../src/renderer/path_transition_utils.ts';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../../src/rules.ts';
import { buildCanonicalSolutionSignature } from '../../src/runtime/score_manager.ts';
import { utcStartMsFromDateId } from '../../src/runtime/daily_timer.ts';
import { createGameStateStore } from '../../src/state/game_state_store.ts';

type InfiniteLevel = ReturnType<typeof generateInfiniteLevel>;
type NormalizedScalar = string | number | boolean | null | undefined;
type NormalizedValue = NormalizedScalar | NormalizedValue[] | { [key: string]: NormalizedValue };

interface PathTransitionCase {
  name: string;
  prevPath: GridPoint[];
  nextPath: GridPoint[];
}

interface DailyPayloadCase {
  dailyId?: unknown;
  hardInvalidateAtUtcMs?: unknown;
  dailySlot?: unknown;
  generatedAtUtcMs?: unknown;
  canonicalKey?: unknown;
  schemaVersion?: unknown;
  poolVersion?: unknown;
  level?: unknown;
}

interface MovableWallMove {
  from: GridPoint;
  to: GridPoint;
}

const INFINITE_LEVEL_INDICES = Object.freeze([0, 1, 2, 3, 4, 5, 17, 63, 127, 255]);
const SCENARIO_INDICES = Object.freeze([0, 5, 17, 63]);
const SCENARIO_COMMAND_COUNT = 18;
const PATH_TRANSITION_CASES: readonly PathTransitionCase[] = Object.freeze([
  {
    name: 'end-retract',
    prevPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }],
    nextPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }],
  },
  {
    name: 'start-retract',
    prevPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }],
    nextPath: [{ r: 0, c: 1 }, { r: 0, c: 2 }],
  },
  {
    name: 'end-advance',
    prevPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }],
    nextPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }],
  },
  {
    name: 'start-advance',
    prevPath: [{ r: 0, c: 1 }, { r: 1, c: 1 }],
    nextPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }],
  },
  {
    name: 'reversed',
    prevPath: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }],
    nextPath: [{ r: 1, c: 1 }, { r: 0, c: 1 }, { r: 0, c: 0 }],
  },
]);
const DAILY_OVERRIDE_CASES: ReadonlyArray<Record<string, number>> = Object.freeze([
  Object.freeze({}),
  Object.freeze({ 0: 0 }),
  Object.freeze({ 1: 1, 3: 2, 8: 0 }),
  Object.freeze({ 2: 3, 9: 1, 15: 2, 31: 3 }),
  Object.freeze({ 5: 7, 18: 6, 33: 5, 65: 4 }),
]);
const DAILY_PAYLOAD_CASES: readonly (DailyPayloadCase | null)[] = Object.freeze([
  null,
  Object.freeze({}),
  Object.freeze({ dailyId: 'bad' }),
  Object.freeze({
    dailyId: '2026-03-12',
    hardInvalidateAtUtcMs: '1741737600000',
    dailySlot: '12',
    generatedAtUtcMs: '1741734000000',
    canonicalKey: 'abc',
    schemaVersion: 1,
    poolVersion: 'p1',
    level: {
      name: 'Daily',
      grid: ['...', '.#.', '...'],
      stitches: [[1, 1]],
      cornerCounts: [[1, 1, 2]],
    },
  }),
  Object.freeze({
    dailyId: '2026-03-12',
    hardInvalidateAtUtcMs: 1741737600000,
    dailySlot: 12,
    generatedAtUtcMs: 1741734000000,
    canonicalKey: 'abc',
    schemaVersion: 1,
    poolVersion: 'p1',
    level: {
      grid: ['..', '..'],
      stitches: [],
      cornerCounts: [],
    },
  }),
]);
const UTC_DATE_CASES = Object.freeze([
  '2026-03-12',
  '2024-02-29',
  'bad',
  '',
  '2026-13-01',
]);
const DIRS_4: readonly GridTuple[] = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);
const DIRS_8: readonly GridTuple[] = Object.freeze([
  ...DIRS_4,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]);

const keyOf = (r: number, c: number): string => `${r},${c}`;

const createRng = (seed = 0x51f15e): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const normalizeValue = (value: unknown): NormalizedValue => {
  if (value instanceof Set) {
    return [...value].map((entry) => normalizeValue(entry)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [key, normalizeValue(entryValue)] as const)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([key, entryValue]) => [key, entryValue] as unknown as NormalizedValue);
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalizeValue(record[key])]),
    );
  }
  return value as NormalizedScalar;
};

const stableDigest = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(normalizeValue(value)))
  .digest('hex');

const normalizeSnapshot = (snapshot: GameSnapshot): Record<string, NormalizedValue> => ({
  rows: snapshot.rows,
  cols: snapshot.cols,
  totalUsable: snapshot.totalUsable,
  levelIndex: snapshot.levelIndex,
  pathKey: snapshot.pathKey,
  gridData: normalizeValue(snapshot.gridData),
  path: normalizeValue(snapshot.path),
  stitches: normalizeValue(snapshot.stitches),
  cornerCounts: normalizeValue(snapshot.cornerCounts),
  visited: normalizeValue([...snapshot.visited].sort()),
  idxByKey: normalizeValue([...snapshot.idxByKey.entries()].sort(([a], [b]) => a.localeCompare(b))),
  stitchSet: normalizeValue([...snapshot.stitchSet].sort()),
  stitchReq: normalizeValue([...snapshot.stitchReq.entries()].sort(([a], [b]) => a.localeCompare(b))),
});

const normalizeTransition = (transition: StateTransition): Record<string, NormalizedValue> => ({
  changed: Boolean(transition.changed),
  rebuildGrid: Boolean(transition.rebuildGrid),
  validate: Boolean(transition.validate),
  meta: normalizeValue(transition.meta),
});

const normalizeEvaluation = (snapshot: GameSnapshot): Record<string, NormalizedValue> => {
  const hintStatus = evaluateHints(snapshot);
  const stitchStatus = evaluateStitches(snapshot);
  const rpsStatus = evaluateRPS(snapshot);
  const blockedStatus = evaluateBlockedCells(snapshot);

  return {
    hintStatus: normalizeValue(hintStatus),
    stitchStatus: normalizeValue(stitchStatus),
    rpsStatus: normalizeValue(rpsStatus),
    blockedStatus: normalizeValue(blockedStatus),
    completion: normalizeValue(checkCompletion(snapshot, {
      hintStatus,
      stitchStatus,
      rpsStatus,
      blockedStatus,
    })),
    canonicalSignature: normalizeValue(buildCanonicalSolutionSignature(snapshot)),
  };
};

const summarizeLevel = (level: InfiniteLevel): Record<string, NormalizedValue> => ({
  name: level.name,
  rows: level.grid.length,
  cols: level.grid[0]?.length || 0,
  stitchCount: level.stitches.length,
  cornerCount: level.cornerCounts.length,
  requiredFeature: level.infiniteMeta.requiredFeature,
  witnessPathLength: level.infiniteMeta.witnessPath.length,
  witnessMovableWallCount: level.infiniteMeta.witnessMovableWalls.length,
});

const summarizeSnapshot = (snapshot: GameSnapshot): Record<string, NormalizedValue> => ({
  levelIndex: snapshot.levelIndex,
  rows: snapshot.rows,
  cols: snapshot.cols,
  totalUsable: snapshot.totalUsable,
  pathLength: snapshot.path.length,
  pathKey: snapshot.pathKey,
  visitedCount: snapshot.visited.size,
  movableWalls: normalizeValue(snapshot.gridData.flatMap((row, r) => (
    row.flatMap((cell, c) => (cell === 'm' ? [[r, c] as GridTuple] : []))
  ))),
});

const isUsableCell = (snapshot: GameSnapshot, r: number, c: number): boolean => (
  r >= 0
  && c >= 0
  && r < snapshot.rows
  && c < snapshot.cols
  && snapshot.gridData[r][c] !== '#'
  && snapshot.gridData[r][c] !== 'm'
);

const findPlayableStart = (snapshot: GameSnapshot): GridPoint | null => {
  for (let r = 0; r < snapshot.rows; r += 1) {
    for (let c = 0; c < snapshot.cols; c += 1) {
      if (!isUsableCell(snapshot, r, c)) continue;
      for (const [dr, dc] of DIRS_4) {
        if (isUsableCell(snapshot, r + dr, c + dc)) return { r, c };
      }
    }
  }
  return null;
};

const listMovableWallMoves = (snapshot: GameSnapshot): MovableWallMove[] => {
  const moves: MovableWallMove[] = [];
  for (let r = 0; r < snapshot.rows; r += 1) {
    for (let c = 0; c < snapshot.cols; c += 1) {
      if (snapshot.gridData[r][c] !== 'm') continue;
      for (const [dr, dc] of DIRS_4) {
        const to = { r: r + dr, c: c + dc };
        if (!isUsableCell(snapshot, to.r, to.c)) continue;
        if (snapshot.visited.has(keyOf(to.r, to.c))) continue;
        moves.push({ from: { r, c }, to });
      }
    }
  }
  return moves;
};

const listScenarioCommands = (snapshot: GameSnapshot): StateCommand[] => {
  const commands: StateCommand[] = [];
  if (snapshot.path.length === 0) {
    const start = findPlayableStart(snapshot);
    if (start) commands.push({ type: 'path/start-or-step', payload: start as unknown as Record<string, unknown> });
    return commands;
  }

  const head = snapshot.path[0];
  const tail = snapshot.path[snapshot.path.length - 1];
  for (const [dr, dc] of DIRS_8) {
    commands.push({
      type: 'path/start-or-step',
      payload: { r: tail.r + dr, c: tail.c + dc } as unknown as Record<string, unknown>,
    });
    commands.push({
      type: 'path/start-or-step-from-start',
      payload: { r: head.r + dr, c: head.c + dc } as unknown as Record<string, unknown>,
    });
  }

  commands.push({ type: 'path/reverse', payload: {} });
  commands.push({ type: 'path/reset', payload: {} });
  commands.push({ type: 'path/finalize-after-pointer', payload: {} });

  for (const move of listMovableWallMoves(snapshot).slice(0, 4)) {
    commands.push({ type: 'wall/move-attempt', payload: move as unknown as Record<string, unknown> });
  }

  return commands;
};

const normalizeCommand = (command: StateCommand): StateCommand =>
  normalizeValue(command) as unknown as StateCommand;

const buildScenarioCommands = (infiniteIndex: number, rng: () => number): StateCommand[] => {
  const level = generateInfiniteLevel(infiniteIndex);
  const store = createGameStateStore(() => level);
  store.loadLevel(0);

  const commands: StateCommand[] = [];
  for (let step = 0; step < SCENARIO_COMMAND_COUNT; step += 1) {
    const candidates = listScenarioCommands(store.getSnapshot());
    if (candidates.length === 0) break;
    const command = candidates[Math.floor(rng() * candidates.length)];
    commands.push(normalizeCommand(command));
    store.dispatch(command);
  }

  return commands;
};

const buildScenario = (infiniteIndex: number, commands: readonly StateCommand[]): Record<string, NormalizedValue> => {
  const level = generateInfiniteLevel(infiniteIndex);
  const store = createGameStateStore(() => level);
  store.loadLevel(0);

  const frames = commands.map((command) => {
    const transition = store.dispatch(command);
    const snapshot = store.getSnapshot();
    const evaluation = normalizeEvaluation(snapshot);
    return {
      command: normalizeValue(command),
      transition: normalizeTransition(transition),
      snapshot: summarizeSnapshot(snapshot),
      evaluation: {
        completion: evaluation.completion,
        canonicalSignature: evaluation.canonicalSignature,
        digest: stableDigest({
          snapshot: normalizeSnapshot(snapshot),
          evaluation,
        }),
      },
    };
  });

  return {
    infiniteIndex,
    commands: normalizeValue(commands),
    frames: normalizeValue(frames),
  };
};

const buildPathTransitionCases = (): NormalizedValue => PATH_TRANSITION_CASES.map((testCase) => ({
  name: testCase.name,
  prevPath: normalizeValue(testCase.prevPath),
  nextPath: normalizeValue(testCase.nextPath),
  result: {
    endTip: normalizeValue(getPathTipFromPath(testCase.nextPath, 'end')),
    startTip: normalizeValue(getPathTipFromPath(testCase.nextPath, 'start')),
    pathsMatch: pathsMatch(testCase.prevPath, testCase.nextPath),
    isPathReversed: isPathReversed(testCase.nextPath, testCase.prevPath),
    normalizeFlowOffset: normalizeFlowOffset(-17.5, 128),
    resolvePathSignaturePrev: resolvePathSignature(testCase.prevPath),
    resolvePathSignatureNext: resolvePathSignature(testCase.nextPath),
    isEndRetractTransition: isEndRetractTransition(testCase.prevPath, testCase.nextPath),
    isStartRetractTransition: isStartRetractTransition(testCase.prevPath, testCase.nextPath),
    isEndAdvanceTransition: isEndAdvanceTransition(testCase.prevPath, testCase.nextPath),
    isStartAdvanceTransition: isStartAdvanceTransition(testCase.prevPath, testCase.nextPath),
    isRetractUnturnStart: isRetractUnturnTransition(
      'start',
      testCase.prevPath[0] || null,
      testCase.nextPath[0] || null,
      testCase.nextPath,
    ),
    isRetractUnturnEnd: isRetractUnturnTransition(
      'end',
      testCase.prevPath[testCase.prevPath.length - 1] || null,
      testCase.nextPath[testCase.nextPath.length - 1] || null,
      testCase.nextPath,
    ),
  },
}));

const buildDailyOverrideCases = (): NormalizedValue => DAILY_OVERRIDE_CASES.map((overrides) => {
  const encoded = encodeDailyOverridesPayload(overrides, 7);
  return {
    overrides: normalizeValue(overrides),
    encoded: {
      variantBits: encoded.variantBits,
      entryCount: encoded.entryCount,
      payload: normalizeValue([...encoded.payload]),
    },
    decoded: normalizeValue(decodeDailyOverridesPayload(encoded.payload)),
  };
});

const buildDailyPayloadCases = (): NormalizedValue => DAILY_PAYLOAD_CASES.map((input) => ({
  input: normalizeValue(input),
  output: normalizeValue(normalizeDailyPayload(input)),
}));

const buildUtcDateCases = (): NormalizedValue => UTC_DATE_CASES.map((dateId) => ({
  dateId,
  utcStartMs: utcStartMsFromDateId(dateId),
}));

export const buildRuntimeRegressionCorpus = (): NormalizedValue => {
  const rng = createRng();

  const scenarios = SCENARIO_INDICES.map((infiniteIndex) => (
    buildScenario(infiniteIndex, buildScenarioCommands(infiniteIndex, rng))
  ));

  return normalizeValue({
    version: 1,
    infiniteLevels: INFINITE_LEVEL_INDICES.map((infiniteIndex) => ({
      infiniteIndex,
      defaultVariant: selectDefaultInfiniteVariant(infiniteIndex),
      summary: summarizeLevel(generateInfiniteLevel(infiniteIndex)),
      digest: stableDigest(generateInfiniteLevel(infiniteIndex)),
    })),
    scenarios,
    pathTransitions: buildPathTransitionCases(),
    dailyOverrides: buildDailyOverrideCases(),
    dailyPayloads: buildDailyPayloadCases(),
    utcDates: buildUtcDateCases(),
  });
};
