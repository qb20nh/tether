#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  INFINITE_CANDIDATE_VARIANTS,
  INFINITE_MAX_LEVELS,
  generateInfiniteLevelFromVariant,
  selectDefaultInfiniteCandidate,
} from '../src/infinite.js';
import { canonicalConstraintSignature } from '../src/infinite_canonical.js';
import { encodePackedOverridePayload } from '../src/shared/packed_override_codec.js';
import { INFINITE_OVERRIDES_REPO_FILE } from '../src/shared/paths.js';
import { parsePositiveInt, readRequiredArgValue } from './lib/cli_utils.js';

const FORMAT_MAGIC = 0x49; // 'I'
const FORMAT_VERSION = 1;

const DEFAULTS = {
  maxLevels: INFINITE_MAX_LEVELS,
  maxVariantProbe: 255,
  outBinFile: path.resolve(process.cwd(), INFINITE_OVERRIDES_REPO_FILE),
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

    if (arg === '--max-levels') opts.maxLevels = parsePositiveInt('--max-levels', nextValue());
    else if (arg === '--max-variant-probe') opts.maxVariantProbe = parsePositiveInt('--max-variant-probe', nextValue());
    else if (arg === '--out' || arg === '--out-bin') opts.outBinFile = path.resolve(process.cwd(), nextValue());
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/build_infinite_overrides.js [options]',
          '',
          'Options:',
          `  --max-levels <n>        Scan level count (default: ${DEFAULTS.maxLevels})`,
          `  --max-variant-probe <n> Maximum variant id probe on collision (default: ${DEFAULTS.maxVariantProbe})`,
          `  --out-bin <path>        Output .bin.gz payload path (default: ${DEFAULTS.outBinFile})`,
          '  --json                  Emit JSON summary',
          '  --help                  Show this help',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    index = nextArgIndex;
  }

  if (opts.maxLevels > INFINITE_MAX_LEVELS) {
    throw new Error(`--max-levels cannot exceed ${INFINITE_MAX_LEVELS}`);
  }
  if (opts.maxVariantProbe < INFINITE_CANDIDATE_VARIANTS) {
    throw new Error(`--max-variant-probe must be >= ${INFINITE_CANDIDATE_VARIANTS}`);
  }

  return opts;
};

const INFINITE_OVERRIDE_CODEC_MESSAGES = Object.freeze({
  maxBitsExceeded: (variantBits) => `Variant id width ${variantBits} bits exceeds format limit (8 bits).`,
  invalidIndex: (index) => `Invalid override index: ${index}`,
  invalidValue: (variantId, variantBits) => `Variant ${variantId} cannot be encoded with ${variantBits} bits`,
  nonIncreasing: (index) => `Non-increasing override index sequence near ${index}`,
});

const encodeOverridesPayload = (overrides, maxVariantUsed) => {
  return encodePackedOverridePayload({
    formatMagic: FORMAT_MAGIC,
    formatVersion: FORMAT_VERSION,
    overrides,
    maxVariantUsed,
    messages: INFINITE_OVERRIDE_CODEC_MESSAGES,
  });
};

function resolveCollision(levelIndex, maxVariantProbe, acceptedBySignature) {
  for (let probeVariantId = INFINITE_CANDIDATE_VARIANTS; probeVariantId <= maxVariantProbe; probeVariantId++) {
    let probeLevel = null;
    try {
      probeLevel = generateInfiniteLevelFromVariant(levelIndex, probeVariantId);
    } catch {
      continue;
    }
    const probeSignature = canonicalConstraintSignature(probeLevel);
    if (!acceptedBySignature.has(probeSignature)) {
      return { variantId: probeVariantId, signature: probeSignature };
    }
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const acceptedBySignature = new Map();
  const overrides = new Map();
  let collisionsResolved = 0;
  let maxVariantUsed = INFINITE_CANDIDATE_VARIANTS - 1;

  for (let i = 0; i < opts.maxLevels; i++) {
    const selected = selectDefaultInfiniteCandidate(i);

    let acceptedSignature = selected.canonicalSignature;

    if (acceptedBySignature.has(acceptedSignature)) {
      const resolved = resolveCollision(i, opts.maxVariantProbe, acceptedBySignature);

      if (!resolved) {
        const firstIndex = acceptedBySignature.get(selected.canonicalSignature);
        throw new Error(
          `Unable to resolve canonical collision at index ${i}. First seen at ${firstIndex}. Increase --max-variant-probe.`,
        );
      }

      acceptedSignature = resolved.signature;
      overrides.set(i, resolved.variantId);
      collisionsResolved += 1;
      if (resolved.variantId > maxVariantUsed) maxVariantUsed = resolved.variantId;
    }

    acceptedBySignature.set(acceptedSignature, i);
  }

  const encoded = encodeOverridesPayload(overrides, maxVariantUsed);
  const compressed = gzipSync(encoded.payload, { level: 9 });
  fs.writeFileSync(opts.outBinFile, compressed);

  const summary = {
    ok: true,
    maxLevels: opts.maxLevels,
    uniqueCanonicalSignatures: acceptedBySignature.size,
    collisionsResolved,
    overrideCount: overrides.size,
    maxVariantUsed,
    variantBits: encoded.variantBits,
    packedBytes: encoded.payload.length,
    gzipBytes: compressed.length,
    maxVariantProbe: opts.maxVariantProbe,
    outBinFile: opts.outBinFile,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Generated ${opts.outBinFile}`);
    console.log(
      `Canonical unique: ${summary.uniqueCanonicalSignatures}/${summary.maxLevels}, overrides: ${summary.overrideCount}, variantBits: ${summary.variantBits}, packed: ${summary.packedBytes} bytes, gzip: ${summary.gzipBytes} bytes`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
