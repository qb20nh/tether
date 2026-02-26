#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { INFINITE_MAX_LEVELS } from '../src/infinite.js';
import {
  DAILY_POOL_BASE_VARIANT_ID,
  DAILY_POOL_EPOCH_UTC_DATE,
  DAILY_POOL_MAX_SLOTS,
  DAILY_POOL_MAX_VARIANT_PROBE,
  DAILY_POOL_SCHEMA_VERSION,
  DAILY_POOL_VERSION,
  computePoolDigest,
  selectDailyCandidateForSlot,
  writeDailyOverridesGzipFile,
  buildInfiniteCanonicalKeySet,
} from './daily_pool_tools.js';

const DEFAULTS = {
  maxSlots: DAILY_POOL_MAX_SLOTS,
  maxVariantProbe: DAILY_POOL_MAX_VARIANT_PROBE,
  outBinFile: path.resolve(process.cwd(), 'src/daily_overrides.bin.gz'),
  outManifestFile: path.resolve(process.cwd(), 'src/daily_pool_manifest.json'),
  generatedAtUtcMs: 0,
  poolVersion: DAILY_POOL_VERSION,
  epochUtcDate: DAILY_POOL_EPOCH_UTC_DATE,
  json: false,
};

const toInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return parsed;
};

const toNonNegativeInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
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

    if (arg === '--max-slots') opts.maxSlots = toInt('--max-slots', nextValue());
    else if (arg === '--max-variant-probe') opts.maxVariantProbe = toInt('--max-variant-probe', nextValue());
    else if (arg === '--out' || arg === '--out-bin') opts.outBinFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--out-manifest') opts.outManifestFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--generated-at-utc-ms') opts.generatedAtUtcMs = toNonNegativeInt('--generated-at-utc-ms', nextValue());
    else if (arg === '--pool-version') opts.poolVersion = String(nextValue()).trim();
    else if (arg === '--epoch-utc-date') opts.epochUtcDate = String(nextValue()).trim();
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/build_daily_overrides.js [options]',
          '',
          'Options:',
          `  --max-slots <n>           Daily pool slots to build (default: ${DEFAULTS.maxSlots})`,
          `  --max-variant-probe <n>   Variant probe cap per slot (default: ${DEFAULTS.maxVariantProbe})`,
          `  --out-bin <path>          Daily override payload path (default: ${DEFAULTS.outBinFile})`,
          `  --out-manifest <path>     Manifest output path (default: ${DEFAULTS.outManifestFile})`,
          `  --generated-at-utc-ms <ms> Metadata timestamp (default: ${DEFAULTS.generatedAtUtcMs}, deterministic)`,
          `  --pool-version <id>       Pool version label (default: ${DEFAULTS.poolVersion})`,
          `  --epoch-utc-date <date>   Epoch date YYYY-MM-DD (default: ${DEFAULTS.epochUtcDate})`,
          '  --json                    Emit JSON summary',
          '  --help                    Show this help',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (opts.maxSlots > INFINITE_MAX_LEVELS) {
    throw new Error(`--max-slots cannot exceed ${INFINITE_MAX_LEVELS}`);
  }
  if (opts.maxVariantProbe < DAILY_POOL_BASE_VARIANT_ID) {
    throw new Error(`--max-variant-probe must be >= ${DAILY_POOL_BASE_VARIANT_ID}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.epochUtcDate)) {
    throw new Error(`--epoch-utc-date must be YYYY-MM-DD, got ${opts.epochUtcDate}`);
  }

  return opts;
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const infiniteCanonicalSet = buildInfiniteCanonicalKeySet(INFINITE_MAX_LEVELS);
  if (infiniteCanonicalSet.size !== INFINITE_MAX_LEVELS) {
    throw new Error(
      `Infinite canonical set is not unique: ${infiniteCanonicalSet.size}/${INFINITE_MAX_LEVELS}`,
    );
  }

  const dailyCanonicalKeys = new Set();
  const overrides = new Map();
  const digestRecords = [];
  let maxVariantUsed = DAILY_POOL_BASE_VARIANT_ID;

  for (let slot = 0; slot < opts.maxSlots; slot++) {
    const candidate = selectDailyCandidateForSlot(slot, {
      infiniteCanonicalKeys: infiniteCanonicalSet,
      dailyCanonicalKeys,
      maxVariantProbe: opts.maxVariantProbe,
      baseVariantId: DAILY_POOL_BASE_VARIANT_ID,
    });

    dailyCanonicalKeys.add(candidate.canonicalKey);
    if (candidate.variantId !== DAILY_POOL_BASE_VARIANT_ID) {
      overrides.set(slot, candidate.variantId);
    }
    if (candidate.variantId > maxVariantUsed) maxVariantUsed = candidate.variantId;

    digestRecords.push(`${slot}:${candidate.variantId}:${candidate.canonicalKey}`);

    if ((slot + 1) % 500 === 0 || (slot + 1) === opts.maxSlots) {
      process.stdout.write(`Built ${slot + 1}/${opts.maxSlots}\n`);
    }
  }

  const encoded = writeDailyOverridesGzipFile(opts.outBinFile, overrides, maxVariantUsed);

  const poolDigest = computePoolDigest(digestRecords);
  const manifest = {
    schemaVersion: DAILY_POOL_SCHEMA_VERSION,
    poolVersion: opts.poolVersion,
    epochUtcDate: opts.epochUtcDate,
    maxSlots: opts.maxSlots,
    baseVariantId: DAILY_POOL_BASE_VARIANT_ID,
    slotMapping: 'identity',
    maxVariantProbe: opts.maxVariantProbe,
    maxVariantUsed,
    poolDigest,
    generatedAtUtcMs: opts.generatedAtUtcMs,
    checks: {
      infiniteDisjointCount: opts.maxSlots,
      dailyUniqueCount: dailyCanonicalKeys.size,
      witnessValidatedCount: opts.maxSlots,
    },
    artifacts: {
      dailyOverridesFile: path.relative(process.cwd(), opts.outBinFile),
      overrideCount: overrides.size,
      variantBits: encoded.variantBits,
      packedBytes: encoded.packedBytes,
      gzipBytes: encoded.compressedBytes,
    },
  };

  writeJson(opts.outManifestFile, manifest);

  const summary = {
    ok: true,
    maxSlots: opts.maxSlots,
    dailyUniqueCount: dailyCanonicalKeys.size,
    overrideCount: overrides.size,
    maxVariantUsed,
    variantBits: encoded.variantBits,
    packedBytes: encoded.packedBytes,
    gzipBytes: encoded.compressedBytes,
    poolDigest,
    outBinFile: opts.outBinFile,
    outManifestFile: opts.outManifestFile,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Generated daily pool artifacts:`);
    console.log(`  overrides: ${opts.outBinFile}`);
    console.log(`  manifest: ${opts.outManifestFile}`);
    console.log(
      `  unique: ${summary.dailyUniqueCount}/${opts.maxSlots}, overrides: ${summary.overrideCount}, variantBits: ${summary.variantBits}`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
