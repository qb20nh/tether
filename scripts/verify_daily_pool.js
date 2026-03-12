#!/usr/bin/env node
import path from 'node:path';
import { INFINITE_MAX_LEVELS } from '../src/infinite.ts';
import {
  DAILY_OVERRIDES_REPO_FILE,
  DAILY_POOL_MANIFEST_REPO_FILE,
} from '../src/shared/paths.ts';
import {
  DAILY_POOL_BASE_VARIANT_ID,
  DAILY_POOL_MAX_SLOTS,
  buildInfiniteCanonicalKeySet,
  computePoolDigest,
  materializeDailyLevelForSlot,
  readDailyOverridesGzipFile,
  replayWitnessAndValidate,
} from './daily_pool_tools.js';
import {
  parsePositiveInt,
  readJsonFile,
  readRequiredArgValue,
} from './lib/cli_utils.js';

const DEFAULTS = {
  manifestFile: path.resolve(process.cwd(), DAILY_POOL_MANIFEST_REPO_FILE),
  overridesFile: path.resolve(process.cwd(), DAILY_OVERRIDES_REPO_FILE),
  maxSlots: null,
  json: false,
};

const parseArgs = (argv) => {
  const opts = { ...DEFAULTS };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    let nextArgIndex = index + 1;
    const nextValue = () => {
      const result = readRequiredArgValue(argv, index, arg);
      nextArgIndex = result.nextIndex + 1;
      return result.value;
    };

    if (arg === '--manifest') opts.manifestFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--overrides') opts.overridesFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--max-slots') opts.maxSlots = parsePositiveInt('--max-slots', nextValue());
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

    index = nextArgIndex;
  }

  return opts;
};

function processSlot(slot, overrides, baseVariantId, infiniteCanonicalSet, dailyCanonicalSet, digestRecords, failures) {
  let materialized;
  try {
    materialized = materializeDailyLevelForSlot(slot, overrides, baseVariantId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failures.push(`slot ${slot}: materialization failed (${errorMsg})`);
    return;
  }

  const { canonicalKey, level, variantId } = materialized;

  if (infiniteCanonicalSet.has(canonicalKey)) {
    failures.push(`slot ${slot}: canonical key collides with infinite pool`);
    return;
  }

  if (dailyCanonicalSet.has(canonicalKey)) {
    failures.push(`slot ${slot}: canonical key duplicates a prior daily slot`);
    return;
  }

  if (!replayWitnessAndValidate(level)) {
    failures.push(`slot ${slot}: witness replay failed solvability validation`);
    return;
  }

  dailyCanonicalSet.add(canonicalKey);
  digestRecords.push(`${slot}:${variantId}:${canonicalKey}`);
}

function verifyPoolDigest(maxSlots, manifest, digestRecords, failures) {
  if (maxSlots === manifest.maxSlots && typeof manifest.poolDigest === 'string') {
    const digest = computePoolDigest(digestRecords);
    if (digest !== manifest.poolDigest) {
      failures.push(`Pool digest mismatch: expected ${manifest.poolDigest}, got ${digest}`);
    }
  }
}

function printSummary(opts, summary, failures) {
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
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const manifest = readJsonFile(opts.manifestFile);
  const defaultMaxSlots = manifest.maxSlots || DAILY_POOL_MAX_SLOTS;
  const maxSlots = opts.maxSlots || defaultMaxSlots;
  
  if (maxSlots > defaultMaxSlots) {
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
    processSlot(
      slot,
      overrides,
      baseVariantId,
      infiniteCanonicalSet,
      dailyCanonicalSet,
      digestRecords,
      failures,
    );
    if ((slot + 1) % 500 === 0 || (slot + 1) === maxSlots) {
      process.stdout.write(`Verified ${slot + 1}/${maxSlots}\n`);
    }
  }

  verifyPoolDigest(maxSlots, manifest, digestRecords, failures);

  const summary = {
    ok: failures.length === 0,
    checkedSlots: maxSlots,
    verifiedUniqueSlots: dailyCanonicalSet.size,
    failures,
  };

  printSummary(opts, summary, failures);

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
