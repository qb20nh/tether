// @ts-nocheck
import { decodePackedOverridePayload, encodePackedOverridePayload } from './shared/packed_override_codec.ts';

export const DAILY_OVERRIDE_FORMAT_MAGIC = 0x44; // 'D'
export const DAILY_OVERRIDE_FORMAT_VERSION = 1;

const DAILY_OVERRIDE_CODEC_MESSAGES = Object.freeze({
  invalidVarint: 'Invalid varint in daily overrides payload',
  truncatedVarint: 'Truncated varint in daily overrides payload',
  maxBitsExceeded: (variantBits) => `Daily override variant width ${variantBits} bits exceeds format limit (8 bits)`,
  invalidIndex: (slot) => `Invalid daily override slot: ${slot}`,
  invalidValue: (variantId, variantBits) => `Invalid daily override variant ${variantId} for variantBits=${variantBits}`,
  nonIncreasing: (slot) => `Daily override slots must be strictly increasing near slot ${slot}`,
  invalidHeader: 'Invalid daily overrides payload header',
  unsupportedFormat: 'Unsupported daily overrides payload format',
  invalidVariantBits: (variantBits) => `Invalid daily overrides variant-bit width: ${variantBits}`,
  invalidDelta: 'Invalid daily overrides delta encoding',
});

export const encodeDailyOverridesPayload = (overrides, maxVariantUsed = 0) => {
  return encodePackedOverridePayload({
    formatMagic: DAILY_OVERRIDE_FORMAT_MAGIC,
    formatVersion: DAILY_OVERRIDE_FORMAT_VERSION,
    overrides,
    maxVariantUsed,
    messages: DAILY_OVERRIDE_CODEC_MESSAGES,
  });
};

export const decodeDailyOverridesPayload = (bytes) => {
  return decodePackedOverridePayload(bytes, {
    formatMagic: DAILY_OVERRIDE_FORMAT_MAGIC,
    formatVersion: DAILY_OVERRIDE_FORMAT_VERSION,
    messages: DAILY_OVERRIDE_CODEC_MESSAGES,
  });
};
