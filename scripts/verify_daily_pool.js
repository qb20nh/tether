#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { INFINITE_MAX_LEVELS } from '../src/infinite.js';
import {
  DAILY_POOL_BASE_VARIANT_ID,
  DAILY_POOL_MAX_SLOTS,
  buildInfiniteCanonicalKeySet,
  computePoolDigest,
  materializeDailyLevelForSlot,
  readDailyOverridesGzipFile,
  replayWitnessAndValidate,
} from './daily_pool_tools.js';

const DEFAULTS = {
  manifestFile: path.resolve(process.cwd(), 'src/daily_pool_manifest.json'),
  overridesFile: path.resolve(process.cwd(), 'src/daily_overrides.bin.gz'),
  maxSlots: null,
  json: false,
};

const toInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return parsed;
};

const parseArgs = (argv) => {
  const opts = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === '--manifest') opts.manifestFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--overrides') opts.overridesFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--max-slots') opts.maxSlots = toInt('--max-slots', nextValue());
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/verify_daily_pool.js [options]',
          '',
          'Options:',
          `  --manifest <path>        Pool manifest path (default: ${DEFAULTS.manifestFile})`,
          `  --overrides <path>       Daily overrides .bin.gz path (default: ${DEFAULTS.overridesFile})`,
          '  --max-slots <n>          Verify prefix slot count (default: manifest.maxSlots)',
          '  --json                   Emit JSON summary',
          '  --help                   Show this help',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const manifest = readJson(opts.manifestFile);
  const maxSlots = opts.maxSlots || manifest.maxSlots || DAILY_POOL_MAX_SLOTS;
  if (maxSlots > (manifest.maxSlots || DAILY_POOL_MAX_SLOTS)) {
    throw new Error(`--max-slots ${maxSlots} exceeds manifest.maxSlots ${manifest.maxSlots}`);
  }

  const baseVariantId = Number.isInteger(manifest.baseVariantId)
    ? manifest.baseVariantId
    : DAILY_POOL_BASE_VARIANT_ID;

  const overrides = readDailyOverridesGzipFile(opts.overridesFile);
  const infiniteCanonicalSet = buildInfiniteCanonicalKeySet(INFINITE_MAX_LEVELS);

  const dailyCanonicalSet = new Set();
  const digestRecords = [];
  const failures = [];

  for (let slot = 0; slot < maxSlots; slot++) {
    let materialized;
    try {
      materialized = materializeDailyLevelForSlot(slot, overrides, baseVariantId);
    } catch (error) {
      failures.push(`slot ${slot}: materialization failed (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    const { canonicalKey, level, variantId } = materialized;

    if (infiniteCanonicalSet.has(canonicalKey)) {
      failures.push(`slot ${slot}: canonical key collides with infinite pool`);
      continue;
    }

    if (dailyCanonicalSet.has(canonicalKey)) {
      failures.push(`slot ${slot}: canonical key duplicates a prior daily slot`);
      continue;
    }

    if (!replayWitnessAndValidate(level)) {
      failures.push(`slot ${slot}: witness replay failed solvability validation`);
      continue;
    }

    dailyCanonicalSet.add(canonicalKey);
    digestRecords.push(`${slot}:${variantId}:${canonicalKey}`);

    if ((slot + 1) % 500 === 0 || (slot + 1) === maxSlots) {
      process.stdout.write(`Verified ${slot + 1}/${maxSlots}\n`);
    }
  }

  if (maxSlots === manifest.maxSlots && typeof manifest.poolDigest === 'string') {
    const digest = computePoolDigest(digestRecords);
    if (digest !== manifest.poolDigest) {
      failures.push(`Pool digest mismatch: expected ${manifest.poolDigest}, got ${digest}`);
    }
  }

  const summary = {
    ok: failures.length === 0,
    checkedSlots: maxSlots,
    verifiedUniqueSlots: dailyCanonicalSet.size,
    failures,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Daily pool verification: ${summary.ok ? 'PASS' : 'FAIL'}`);
    console.log(`  checkedSlots: ${summary.checkedSlots}`);
    console.log(`  verifiedUniqueSlots: ${summary.verifiedUniqueSlots}`);
    if (failures.length > 0) {
      for (const failure of failures.slice(0, 20)) {
        console.log(`  - ${failure}`);
      }
      if (failures.length > 20) {
        console.log(`  ... ${failures.length - 20} more failures`);
      }
    }
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
