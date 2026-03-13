import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIFFICULTY_PROFILES,
  buildLevelContext,
  runRandomSolveBatch,
  solveLevel,
  type ScriptLevel,
} from './verify_level_properties.ts';

interface GeneratedLevel extends ScriptLevel {
  grid: string[];
  stitches: Array<[number, number]>;
  cornerCounts: Array<[number, number, number]>;
}

interface BestLevel extends GeneratedLevel {
  rawSol: number;
  canSol: number;
  difficultyData: {
    meanBacktracksSolved: number;
    meanDeadEnds: number;
  };
}

interface FindLevelDependencies {
  solveLevelFn?: typeof solveLevel;
  buildLevelContextFn?: typeof buildLevelContext;
  runRandomSolveBatchFn?: typeof runRandomSolveBatch;
  generateCandidateFn?: (random?: () => number) => GeneratedLevel;
  random?: () => number;
  log?: (message: string) => void;
  writeProgress?: (message: string) => void;
  targetCandidates?: number;
}

const getRandomInt = (max: number, random: () => number = Math.random): number => Math.floor(random() * max);

export function generateCandidate(random: () => number = Math.random): GeneratedLevel {
  const size = 7;
  const grid: string[][] = [];
  for (let i = 0; i < size; i += 1) {
    grid.push(new Array<string>(size).fill('.'));
  }

  const rps = ['g', 'b', 'p'];
  for (const sym of rps) {
    let r = 0;
    let c = 0;
    do {
      r = getRandomInt(size, random);
      c = getRandomInt(size, random);
    } while (grid[r][c] !== '.');
    grid[r][c] = sym;
  }

  const stitches: Array<[number, number]> = [[3, 3]];

  const numWalls = 14 + getRandomInt(6);
  for (let i = 0; i < numWalls; i += 1) {
    let r = 0;
    let c = 0;
    let avoid = false;
    do {
      r = getRandomInt(size, random);
      c = getRandomInt(size, random);
      avoid = stitches.some((stitch) => Math.abs(r - (stitch[0] - 0.5)) < 1 && Math.abs(c - (stitch[1] - 0.5)) < 1);
    } while (grid[r][c] !== '.' || avoid);
    grid[r][c] = '#';
  }

  const hints = ['l', 'r', 's', 't', 'h', 'v'];
  const numHints = 3 + getRandomInt(5);
  for (let i = 0; i < numHints; i += 1) {
    let r = 0;
    let c = 0;
    do {
      r = getRandomInt(size, random);
      c = getRandomInt(size, random);
    } while (grid[r][c] !== '.');
    grid[r][c] = hints[getRandomInt(hints.length, random)];
  }

  return {
    grid: grid.map((row) => row.join('')),
    stitches,
    cornerCounts: [],
  };
}

const opts = {
  timeMs: 250,
  minRaw: 1,
  minCanonical: 2,
  minHintOrders: 0,
  minCornerOrders: 0,
  maxSolutions: 20,
};

export function runFindLevel(dependencies: FindLevelDependencies = {}): {
  attempts: number;
  bestDifficulty: number;
  bestLevel: BestLevel;
  payload: Record<string, unknown>;
} {
  const {
    solveLevelFn = solveLevel,
    buildLevelContextFn = buildLevelContext,
    runRandomSolveBatchFn = runRandomSolveBatch,
    generateCandidateFn = generateCandidate,
    random = Math.random,
    log = (message: string) => console.log(message),
    writeProgress = (message: string) => process.stdout.write(message),
    targetCandidates = 10,
  } = dependencies;

  log('Searching for a valid, highly difficult 7x7 level... This might take a few minutes.');
  let attempts = 0;
  let bestLevel: BestLevel | null = null;
  let bestDifficulty = 0;
  let validCandidatesFound = 0;

  while (validCandidatesFound < targetCandidates) {
    attempts += 1;
    if (attempts % 100 === 0) writeProgress('.');
    const level = generateCandidateFn(random);
    try {
      const res = solveLevelFn(level, opts);
      if (!res.timedOut && res.canonicalSolutions >= 2 && res.canonicalSolutions <= 10) {
        log(`\nFound candidate ${validCandidatesFound + 1}/${targetCandidates} (Canonical: ${res.canonicalSolutions}, Raw: ${res.rawSolutions}) after ${attempts} attempts! Evaluating difficulty...`);

        const levelCtx = buildLevelContextFn(level);
        const profile = DIFFICULTY_PROFILES.lite96;
        const difficultyData = runRandomSolveBatchFn(levelCtx, profile, 'trinity_weave_test');

        log(`  -> Mean backtracks: ${difficultyData.meanBacktracksSolved.toFixed(1)}, Mean deadends: ${difficultyData.meanDeadEnds.toFixed(1)}`);

        if (difficultyData.meanBacktracksSolved > bestDifficulty) {
          bestDifficulty = difficultyData.meanBacktracksSolved;
          bestLevel = { ...level, rawSol: res.rawSolutions, canSol: res.canonicalSolutions, difficultyData };
          log(`  -> NEW BEST DIFFICULTY: ${bestDifficulty.toFixed(1)}`);
        }
        validCandidatesFound += 1;
      }
    } catch {
      // Ignore unsolved or invalid candidates.
    }
  }

  if (!bestLevel) {
    throw new Error('No valid level candidates found');
  }

  log('\n\n=============== SEARCH COMPLETE ===============');
  log(`Best level found had mean backtracks: ${bestDifficulty.toFixed(1)} (Canonical: ${bestLevel.canSol}, Raw: ${bestLevel.rawSol})`);

  const payload = {
    name: '파일럿 12) Trinity Weave (7x7)',
    nameKey: 'level.pilot_12.name',
    desc: '가위바위보 제약과 스티치가 교차하는 최고 난이도 퍼즐입니다.',
    descKey: 'level.pilot_12.desc',
    grid: bestLevel.grid,
    stitches: bestLevel.stitches,
  };

  log(JSON.stringify(payload, null, 2));
  log('=============================================');

  return {
    attempts,
    bestDifficulty,
    bestLevel,
    payload,
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runFindLevel();
}
