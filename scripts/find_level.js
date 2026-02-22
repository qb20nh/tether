import fs from 'node:fs';
import { solveLevel, buildLevelContext, runRandomSolveBatch, DIFFICULTY_PROFILES } from './verify_level_properties.js';

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function generateCandidate() {
  const size = 7;
  const grid = [];
  for (let i = 0; i < size; i++) {
    grid.push(Array(size).fill('.'));
  }

  const rps = ['g', 'b', 'p'];
  for (let sym of rps) {
    let r, c;
    do {
      r = getRandomInt(size);
      c = getRandomInt(size);
    } while (grid[r][c] !== '.');
    grid[r][c] = sym;
  }

  const stitches = [[3, 3]];

  const numWalls = 14 + getRandomInt(6); // 14-19 walls
  for (let i = 0; i < numWalls; i++) {
    let r, c, avoid;
    do {
      r = getRandomInt(size);
      c = getRandomInt(size);
      avoid = false;
      for (let st of stitches) {
        if (Math.abs(r - (st[0] - 0.5)) < 1 && Math.abs(c - (st[1] - 0.5)) < 1) avoid = true;
      }
    } while (grid[r][c] !== '.' || avoid);
    grid[r][c] = '#';
  }

  const hints = ['l', 'r', 's', 't', 'h', 'v'];
  const numHints = 3 + getRandomInt(5);
  for (let i = 0; i < numHints; i++) {
    let r, c;
    do {
      r = getRandomInt(size);
      c = getRandomInt(size);
    } while (grid[r][c] !== '.');
    grid[r][c] = hints[getRandomInt(hints.length)];
  }

  return {
    grid: grid.map(row => row.join('')),
    stitches: stitches,
    cornerCounts: []
  };
}

const opts = {
  timeMs: 250,
  minRaw: 1,
  minCanonical: 2,
  minHintOrders: 0,
  minCornerOrders: 0,
  maxSolutions: 20
};

console.log("Searching for a valid, highly difficult 7x7 level... This might take a few minutes.");
let attempts = 0;
let bestLevel = null;
let bestDifficulty = 0;

// Run for a set number of valid candidate findings, then return the best one.
const targetCandidates = 10;
let validCandidatesFound = 0;

while (validCandidatesFound < targetCandidates) {
  attempts++;
  if (attempts % 100 === 0) process.stdout.write('.');
  const level = generateCandidate();
  try {
    const res = solveLevel(level, opts);
    if (!res.timedOut && res.canonicalSolutions >= 2 && res.canonicalSolutions <= 10) {
      console.log(`\nFound candidate ${validCandidatesFound + 1}/${targetCandidates} (Canonical: ${res.canonicalSolutions}, Raw: ${res.rawSolutions}) after ${attempts} attempts! Evaluating difficulty...`);

      const levelCtx = buildLevelContext(level);
      const profile = DIFFICULTY_PROFILES['lite96'];
      const difficultyData = runRandomSolveBatch(levelCtx, profile, "trinity_weave_test");

      console.log(`  -> Mean backtracks: ${difficultyData.meanBacktracksSolved.toFixed(1)}, Mean deadends: ${difficultyData.meanDeadEnds.toFixed(1)}`);

      if (difficultyData.meanBacktracksSolved > bestDifficulty) {
        bestDifficulty = difficultyData.meanBacktracksSolved;
        bestLevel = { ...level, rawSol: res.rawSolutions, canSol: res.canonicalSolutions, difficultyData };
        console.log(`  -> NEW BEST DIFFICULTY: ${bestDifficulty.toFixed(1)}`);
      }
      validCandidatesFound++;
    }
  } catch (e) { }
}

console.log("\n\n=============== SEARCH COMPLETE ===============");
console.log(`Best level found had mean backtracks: ${bestDifficulty.toFixed(1)} (Canonical: ${bestLevel.canSol}, Raw: ${bestLevel.rawSol})`);

const payload = {
  name: "파일럿 12) Trinity Weave (7x7)",
  nameKey: "level.pilot_12.name",
  desc: "가위바위보 제약과 스티치가 교차하는 최고 난이도 퍼즐입니다.",
  descKey: "level.pilot_12.desc",
  grid: bestLevel.grid,
  stitches: bestLevel.stitches
};

console.log(JSON.stringify(payload, null, 2));
console.log("=============================================");
