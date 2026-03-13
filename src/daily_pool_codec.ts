import { decodePackedOverridePayload, encodePackedOverridePayload } from './shared/packed_override_codec.ts';

export const DAILY_OVERRIDE_FORMAT_MAGIC = 0x44; // 'D'
export const DAILY_OVERRIDE_FORMAT_VERSION = 1;

type OverrideMessages = {
  invalidVarint?: string | ((...args: number[]) => string);
  truncatedVarint?: string | ((...args: number[]) => string);
  maxBitsExceeded?: string | ((variantBits: number) => string);
  invalidIndex?: string | ((slot: number) => string);
  invalidValue?: string | ((variantId: number, variantBits: number) => string);
  nonIncreasing?: string | ((slot: number) => string);
  invalidHeader?: string | ((...args: number[]) => string);
  unsupportedFormat?: string | ((...args: number[]) => string);
  invalidVariantBits?: string | ((variantBits: number) => string);
  invalidDelta?: string | ((...args: number[]) => string);
};

type OverrideInput = Map<number, number> | Record<string, number> | null | undefined;

interface EncodedOverridePayload {
  payload: Uint8Array;
  variantBits: number;
  entryCount: number;
}

type DecodedOverridePayload = Readonly<Record<number, number>>;

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
}) as Readonly<OverrideMessages>;

const encodePackedOverridePayloadTyped = encodePackedOverridePayload as (options: {
  formatMagic: number;
  formatVersion: number;
  overrides: OverrideInput;
  maxVariantUsed?: number;
  messages?: OverrideMessages;
}) => EncodedOverridePayload;
const decodePackedOverridePayloadTyped = decodePackedOverridePayload as (
  bytes: Uint8Array,
  options: {
    formatMagic: number;
    formatVersion: number;
    messages?: OverrideMessages;
  },
) => DecodedOverridePayload;

export const encodeDailyOverridesPayload = (
  overrides: OverrideInput,
  maxVariantUsed = 0,
): EncodedOverridePayload =>
  encodePackedOverridePayloadTyped({
    formatMagic: DAILY_OVERRIDE_FORMAT_MAGIC,
    formatVersion: DAILY_OVERRIDE_FORMAT_VERSION,
    overrides,
    maxVariantUsed,
    messages: DAILY_OVERRIDE_CODEC_MESSAGES,
  });

export const decodeDailyOverridesPayload = (bytes: Uint8Array): DecodedOverridePayload =>
  decodePackedOverridePayloadTyped(bytes, {
    formatMagic: DAILY_OVERRIDE_FORMAT_MAGIC,
    formatVersion: DAILY_OVERRIDE_FORMAT_VERSION,
    messages: DAILY_OVERRIDE_CODEC_MESSAGES,
  });
