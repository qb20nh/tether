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

const getRandomInt = (max: number): number => Math.floor(Math.random() * max);

function generateCandidate(): GeneratedLevel {
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
      r = getRandomInt(size);
      c = getRandomInt(size);
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
      r = getRandomInt(size);
      c = getRandomInt(size);
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
      r = getRandomInt(size);
      c = getRandomInt(size);
    } while (grid[r][c] !== '.');
    grid[r][c] = hints[getRandomInt(hints.length)];
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

console.log('Searching for a valid, highly difficult 7x7 level... This might take a few minutes.');
let attempts = 0;
let bestLevel: BestLevel | null = null;
let bestDifficulty = 0;

const targetCandidates = 10;
let validCandidatesFound = 0;

while (validCandidatesFound < targetCandidates) {
  attempts += 1;
  if (attempts % 100 === 0) process.stdout.write('.');
  const level = generateCandidate();
  try {
    const res = solveLevel(level, opts);
    if (!res.timedOut && res.canonicalSolutions >= 2 && res.canonicalSolutions <= 10) {
      console.log(`\nFound candidate ${validCandidatesFound + 1}/${targetCandidates} (Canonical: ${res.canonicalSolutions}, Raw: ${res.rawSolutions}) after ${attempts} attempts! Evaluating difficulty...`);

      const levelCtx = buildLevelContext(level);
      const profile = DIFFICULTY_PROFILES.lite96;
      const difficultyData = runRandomSolveBatch(levelCtx, profile, 'trinity_weave_test');

      console.log(`  -> Mean backtracks: ${difficultyData.meanBacktracksSolved.toFixed(1)}, Mean deadends: ${difficultyData.meanDeadEnds.toFixed(1)}`);

      if (difficultyData.meanBacktracksSolved > bestDifficulty) {
        bestDifficulty = difficultyData.meanBacktracksSolved;
        bestLevel = { ...level, rawSol: res.rawSolutions, canSol: res.canonicalSolutions, difficultyData };
        console.log(`  -> NEW BEST DIFFICULTY: ${bestDifficulty.toFixed(1)}`);
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

console.log('\n\n=============== SEARCH COMPLETE ===============');
console.log(`Best level found had mean backtracks: ${bestDifficulty.toFixed(1)} (Canonical: ${bestLevel.canSol}, Raw: ${bestLevel.rawSol})`);

const payload = {
  name: '파일럿 12) Trinity Weave (7x7)',
  nameKey: 'level.pilot_12.name',
  desc: '가위바위보 제약과 스티치가 교차하는 최고 난이도 퍼즐입니다.',
  descKey: 'level.pilot_12.desc',
  grid: bestLevel.grid,
  stitches: bestLevel.stitches,
};

console.log(JSON.stringify(payload, null, 2));
console.log('=============================================');
