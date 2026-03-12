import { createHash } from 'node:crypto';

import { encodeDailyOverridesPayload, decodeDailyOverridesPayload } from '../../src/daily_pool_codec.ts';
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
import { createGameStateStore } from '../../src/state/game_state_store.ts';
import { normalizeDailyPayload } from '../../src/app/daily_payload_service.ts';
import { utcStartMsFromDateId } from '../../src/runtime/daily_timer.ts';

const INFINITE_LEVEL_INDICES = Object.freeze([0, 1, 2, 3, 4, 5, 17, 63, 127, 255]);
const SCENARIO_INDICES = Object.freeze([0, 5, 17, 63]);
const SCENARIO_COMMAND_COUNT = 18;
const PATH_TRANSITION_CASES = Object.freeze([
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
const DAILY_OVERRIDE_CASES = Object.freeze([
  Object.freeze({}),
  Object.freeze({ 0: 0 }),
  Object.freeze({ 1: 1, 3: 2, 8: 0 }),
  Object.freeze({ 2: 3, 9: 1, 15: 2, 31: 3 }),
  Object.freeze({ 5: 7, 18: 6, 33: 5, 65: 4 }),
]);
const DAILY_PAYLOAD_CASES = Object.freeze([
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
const DIRS_4 = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);
const DIRS_8 = Object.freeze([
  ...DIRS_4,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]);

const keyOf = (r, c) => `${r},${c}`;

const createRng = (seed = 0x51f15e) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const normalizeValue = (value) => {
  if (value instanceof Set) return [...value].sort();
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [key, normalizeValue(entryValue)])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeValue(value[key])]),
    );
  }
  return value;
};

const stableDigest = (value) => createHash('sha256')
  .update(JSON.stringify(normalizeValue(value)))
  .digest('hex');

const normalizeSnapshot = (snapshot) => ({
  rows: snapshot.rows,
  cols: snapshot.cols,
  totalUsable: snapshot.totalUsable,
  levelIndex: snapshot.levelIndex,
  pathKey: snapshot.pathKey,
  gridData: snapshot.gridData,
  path: snapshot.path,
  stitches: snapshot.stitches,
  cornerCounts: snapshot.cornerCounts,
  visited: [...snapshot.visited].sort(),
  idxByKey: [...snapshot.idxByKey.entries()].sort(([a], [b]) => a.localeCompare(b)),
  stitchSet: [...snapshot.stitchSet].sort(),
  stitchReq: [...snapshot.stitchReq.entries()].sort(([a], [b]) => a.localeCompare(b)),
});

const normalizeTransition = (transition) => ({
  changed: Boolean(transition.changed),
  rebuildGrid: Boolean(transition.rebuildGrid),
  validate: Boolean(transition.validate),
  meta: normalizeValue(transition.meta),
});

const normalizeEvaluation = (snapshot) => {
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
    })),
  canonicalSignature: buildCanonicalSolutionSignature(snapshot),
  };
};

const summarizeLevel = (level) => ({
  name: level.name,
  rows: level.grid.length,
  cols: level.grid[0]?.length || 0,
  stitchCount: level.stitches.length,
  cornerCount: level.cornerCounts.length,
  requiredFeature: level.infiniteMeta.requiredFeature,
  witnessPathLength: level.infiniteMeta.witnessPath.length,
  witnessMovableWallCount: level.infiniteMeta.witnessMovableWalls.length,
});

const summarizeSnapshot = (snapshot) => ({
  levelIndex: snapshot.levelIndex,
  rows: snapshot.rows,
  cols: snapshot.cols,
  totalUsable: snapshot.totalUsable,
  pathLength: snapshot.path.length,
  pathKey: snapshot.pathKey,
  visitedCount: snapshot.visited.size,
  movableWalls: snapshot.gridData.flatMap((row, r) => (
    [...row].flatMap((cell, c) => (cell === 'm' ? [[r, c]] : []))
  )),
});

const isUsableCell = (snapshot, r, c) => (
  r >= 0
  && c >= 0
  && r < snapshot.rows
  && c < snapshot.cols
  && snapshot.gridData[r][c] !== '#'
  && snapshot.gridData[r][c] !== 'm'
);

const findPlayableStart = (snapshot) => {
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

const listMovableWallMoves = (snapshot) => {
  const moves = [];
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

const listScenarioCommands = (snapshot) => {
  const commands = [];
  if (snapshot.path.length === 0) {
    const start = findPlayableStart(snapshot);
    if (start) commands.push({ type: 'path/start-or-step', payload: start });
    return commands;
  }

  const head = snapshot.path[0];
  const tail = snapshot.path[snapshot.path.length - 1];
  for (const [dr, dc] of DIRS_8) {
    commands.push({ type: 'path/start-or-step', payload: { r: tail.r + dr, c: tail.c + dc } });
    commands.push({ type: 'path/start-or-step-from-start', payload: { r: head.r + dr, c: head.c + dc } });
  }

  commands.push({ type: 'path/reverse', payload: {} });
  commands.push({ type: 'path/reset', payload: {} });
  commands.push({ type: 'path/finalize-after-pointer', payload: {} });

  for (const move of listMovableWallMoves(snapshot).slice(0, 4)) {
    commands.push({ type: 'wall/move-attempt', payload: move });
  }

  return commands;
};

const buildScenarioCommands = (infiniteIndex, rng) => {
  const level = generateInfiniteLevel(infiniteIndex);
  const store = createGameStateStore(() => level);
  store.loadLevel(0);

  const commands = [];
  for (let step = 0; step < SCENARIO_COMMAND_COUNT; step += 1) {
    const candidates = listScenarioCommands(store.getSnapshot());
    if (candidates.length === 0) break;
    const command = candidates[Math.floor(rng() * candidates.length)];
    commands.push(normalizeValue(command));
    store.dispatch(command);
  }

  return commands;
};

const buildScenario = (infiniteIndex, commands) => {
  const level = generateInfiniteLevel(infiniteIndex);
  const store = createGameStateStore(() => level);
  store.loadLevel(0);

  const frames = commands.map((command) => {
    const transition = store.dispatch(command);
    const snapshot = store.getSnapshot();
    const evaluation = normalizeEvaluation(snapshot);
    return {
      command,
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
    commands,
    frames,
  };
};

const buildPathTransitionCases = () => PATH_TRANSITION_CASES.map((testCase) => ({
  name: testCase.name,
  prevPath: testCase.prevPath,
  nextPath: testCase.nextPath,
  result: {
    endTip: getPathTipFromPath(testCase.nextPath, 'end'),
    startTip: getPathTipFromPath(testCase.nextPath, 'start'),
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

const buildDailyOverrideCases = () => DAILY_OVERRIDE_CASES.map((overrides) => {
  const encoded = encodeDailyOverridesPayload(overrides, 7);
  return {
    overrides,
    encoded: {
      variantBits: encoded.variantBits,
      entryCount: encoded.entryCount,
      payload: [...encoded.payload],
    },
    decoded: normalizeValue(decodeDailyOverridesPayload(encoded.payload)),
  };
});

const buildDailyPayloadCases = () => DAILY_PAYLOAD_CASES.map((input) => ({
  input,
  output: normalizeValue(normalizeDailyPayload(input)),
}));

const buildUtcDateCases = () => UTC_DATE_CASES.map((dateId) => ({
  dateId,
  utcStartMs: utcStartMsFromDateId(dateId),
}));

export const buildRuntimeRegressionCorpus = () => {
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
