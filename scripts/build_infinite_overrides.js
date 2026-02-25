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

const FORMAT_MAGIC = 0x49; // 'I'
const FORMAT_VERSION = 1;

const DEFAULTS = {
  maxLevels: INFINITE_MAX_LEVELS,
  maxVariantProbe: 255,
  outBinFile: path.resolve(process.cwd(), 'src/infinite_overrides.bin.gz'),
  json: false,
};

const toInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
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

    if (arg === '--max-levels') opts.maxLevels = toInt('--max-levels', nextValue());
    else if (arg === '--max-variant-probe') opts.maxVariantProbe = toInt('--max-variant-probe', nextValue());
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
  }

  if (opts.maxLevels > INFINITE_MAX_LEVELS) {
    throw new Error(`--max-levels cannot exceed ${INFINITE_MAX_LEVELS}`);
  }
  if (opts.maxVariantProbe < INFINITE_CANDIDATE_VARIANTS) {
    throw new Error(`--max-variant-probe must be >= ${INFINITE_CANDIDATE_VARIANTS}`);
  }

  return opts;
};

const bitsRequired = (maxValueInclusive) => {
  if (maxValueInclusive <= 0) return 1;
  return Math.max(1, Math.ceil(Math.log2(maxValueInclusive + 1)));
};

const pushVarUint = (bytes, value) => {
  let next = value >>> 0;
  while (next >= 0x80) {
    bytes.push((next & 0x7f) | 0x80);
    next >>>= 7;
  }
  bytes.push(next & 0x7f);
};

const encodeOverridesPayload = (overrides, maxVariantUsed) => {
  const variantBits = bitsRequired(maxVariantUsed);
  if (variantBits > 8) {
    throw new Error(`Variant id width ${variantBits} bits exceeds format limit (8 bits).`);
  }
  const variantMask = (1 << variantBits) - 1;

  const entries = [...overrides.entries()].sort((a, b) => a[0] - b[0]);
  const bytes = [FORMAT_MAGIC, FORMAT_VERSION, variantBits];
  let prevIndex = -1;

  for (const [index, variantId] of entries) {
    if (variantId < 0 || variantId > variantMask) {
      throw new Error(`Variant ${variantId} cannot be encoded with ${variantBits} bits`);
    }
    const delta = index - prevIndex;
    if (delta <= 0) {
      throw new Error(`Non-increasing override index sequence near ${index}`);
    }
    prevIndex = index;
    const token = (delta << variantBits) | variantId;
    pushVarUint(bytes, token);
  }

  return {
    payload: Uint8Array.from(bytes),
    variantBits,
    entryCount: entries.length,
  };
};

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const acceptedBySignature = new Map();
  const overrides = new Map();
  let collisionsResolved = 0;
  let maxVariantUsed = INFINITE_CANDIDATE_VARIANTS - 1;

  for (let i = 0; i < opts.maxLevels; i++) {
    const selected = selectDefaultInfiniteCandidate(i);

    let acceptedVariantId = selected.variantId;
    let acceptedSignature = selected.canonicalSignature;

    if (acceptedBySignature.has(acceptedSignature)) {
      let found = false;
      for (let probeVariantId = INFINITE_CANDIDATE_VARIANTS; probeVariantId <= opts.maxVariantProbe; probeVariantId++) {
        let probeLevel = null;
        try {
          probeLevel = generateInfiniteLevelFromVariant(i, probeVariantId);
        } catch {
          continue;
        }
        const probeSignature = canonicalConstraintSignature(probeLevel);
        if (acceptedBySignature.has(probeSignature)) continue;

        acceptedVariantId = probeVariantId;
        acceptedSignature = probeSignature;
        overrides.set(i, probeVariantId);
        collisionsResolved += 1;
        if (probeVariantId > maxVariantUsed) maxVariantUsed = probeVariantId;
        found = true;
        break;
      }

      if (!found) {
        const firstIndex = acceptedBySignature.get(selected.canonicalSignature);
        throw new Error(
          `Unable to resolve canonical collision at index ${i}. First seen at ${firstIndex}. Increase --max-variant-probe.`,
        );
      }
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
