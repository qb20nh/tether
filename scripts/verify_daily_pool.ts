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
} from './daily_pool_tools.ts';
import {
  parsePositiveInt,
  readJsonFile,
  readRequiredArgValue,
} from './lib/cli_utils.ts';

interface VerifyDailyPoolOptions {
  manifestFile: string;
  overridesFile: string;
  maxSlots: number | null;
  json: boolean;
}

interface DailyPoolManifest {
  maxSlots?: number;
  poolDigest?: string;
  baseVariantId?: number;
}

interface VerifyDailyPoolSummary {
  ok: boolean;
  checkedSlots: number;
  verifiedUniqueSlots: number;
  failures: string[];
}

const DEFAULTS: VerifyDailyPoolOptions = {
  manifestFile: path.resolve(process.cwd(), DAILY_POOL_MANIFEST_REPO_FILE),
  overridesFile: path.resolve(process.cwd(), DAILY_OVERRIDES_REPO_FILE),
  maxSlots: null,
  json: false,
};

const parseArgs = (argv: readonly string[]): VerifyDailyPoolOptions => {
  const opts: VerifyDailyPoolOptions = { ...DEFAULTS };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    let nextArgIndex = index + 1;
    const nextValue = (): string => {
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
          '  node scripts/verify_daily_pool.ts [options]',
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

function processSlot(
  slot: number,
  overrides: Readonly<Record<number, number>>,
  baseVariantId: number,
  infiniteCanonicalSet: ReadonlySet<string>,
  dailyCanonicalSet: Set<string>,
  digestRecords: string[],
  failures: string[],
): void {
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

function verifyPoolDigest(
  maxSlots: number,
  manifest: DailyPoolManifest,
  digestRecords: readonly string[],
  failures: string[],
): void {
  if (maxSlots === manifest.maxSlots && typeof manifest.poolDigest === 'string') {
    const digest = computePoolDigest(digestRecords);
    if (digest !== manifest.poolDigest) {
      failures.push(`Pool digest mismatch: expected ${manifest.poolDigest}, got ${digest}`);
    }
  }
}

function printSummary(
  opts: VerifyDailyPoolOptions,
  summary: VerifyDailyPoolSummary,
  failures: readonly string[],
): void {
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

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  const manifest = readJsonFile<DailyPoolManifest>(opts.manifestFile);
  const defaultMaxSlots = typeof manifest.maxSlots === 'number' ? manifest.maxSlots : DAILY_POOL_MAX_SLOTS;
  const maxSlots = opts.maxSlots ?? defaultMaxSlots;

  if (maxSlots > defaultMaxSlots) {
    throw new Error(`--max-slots ${maxSlots} exceeds manifest.maxSlots ${manifest.maxSlots}`);
  }

  const baseVariantId = typeof manifest.baseVariantId === 'number'
    ? manifest.baseVariantId
    : DAILY_POOL_BASE_VARIANT_ID;

  const overrides = readDailyOverridesGzipFile(opts.overridesFile);
  const infiniteCanonicalSet = buildInfiniteCanonicalKeySet(INFINITE_MAX_LEVELS);

  const dailyCanonicalSet = new Set<string>();
  const digestRecords: string[] = [];
  const failures: string[] = [];

  for (let slot = 0; slot < maxSlots; slot += 1) {
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

  const summary: VerifyDailyPoolSummary = {
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
