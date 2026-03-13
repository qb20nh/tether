type CodecMessage = string | ((...args: number[]) => string);
type CodecMessages = Record<string, CodecMessage | undefined>;
type OverrideInput = Map<number, number> | Record<string, number> | null | undefined;

interface CursorRef {
  index: number;
}

interface EncodePackedOverridePayloadOptions {
  formatMagic: number;
  formatVersion: number;
  overrides: OverrideInput;
  maxVariantUsed?: number;
  messages?: CodecMessages;
}

interface DecodePackedOverridePayloadOptions {
  formatMagic: number;
  formatVersion: number;
  messages?: CodecMessages;
}

interface EncodedOverridePayload {
  payload: Uint8Array;
  variantBits: number;
  entryCount: number;
}

type DecodedOverridePayload = Readonly<Record<number, number>>;

const resolveMessage = (
  message: CodecMessage | undefined,
  fallback: string,
  ...args: number[]
): string => {
  if (typeof message === 'function') return message(...args);
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const bitsRequired = (maxValueInclusive: number): number => {
  if (maxValueInclusive <= 0) return 1;
  return Math.max(1, Math.ceil(Math.log2(maxValueInclusive + 1)));
};

const pushVarUint = (bytes: number[], value: number): void => {
  let next = value >>> 0;
  while (next >= 0x80) {
    bytes.push((next & 0x7f) | 0x80);
    next >>>= 7;
  }
  bytes.push(next & 0x7f);
};

const readVarUint = (
  bytes: Uint8Array,
  cursorRef: CursorRef,
  messages: CodecMessages = {},
): number => {
  let value = 0;
  let shift = 0;

  while (cursorRef.index < bytes.length) {
    const byte = bytes[cursorRef.index++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 28) {
      throw new Error(resolveMessage(messages.invalidVarint, 'Invalid varint in override payload'));
    }
  }

  throw new Error(resolveMessage(messages.truncatedVarint, 'Truncated varint in override payload'));
};

export const toSortedOverrideEntries = (overrides: OverrideInput): Array<[number, number]> => {
  if (!overrides) return [];

  if (overrides instanceof Map) {
    return [...overrides.entries()].sort((a, b) => a[0] - b[0]);
  }

  return Object.entries(overrides)
    .map(([index, variantId]): [number, number] => [Number.parseInt(index, 10), variantId])
    .filter((entry): entry is [number, number] => (
      Number.isInteger(entry[0]) && Number.isInteger(entry[1])
    ))
    .sort((a, b) => a[0] - b[0]);
};

export const encodePackedOverridePayload = ({
  formatMagic,
  formatVersion,
  overrides,
  maxVariantUsed = 0,
  messages = {},
}: EncodePackedOverridePayloadOptions): EncodedOverridePayload => {
  const entries = toSortedOverrideEntries(overrides);
  const variantBits = bitsRequired(maxVariantUsed);
  if (variantBits > 8) {
    throw new Error(
      resolveMessage(
        messages.maxBitsExceeded,
        `Override variant width ${variantBits} bits exceeds format limit (8 bits)`,
        variantBits,
      ),
    );
  }

  const variantMask = (1 << variantBits) - 1;
  const bytes = [formatMagic, formatVersion, variantBits];
  let previousIndex = -1;

  for (const [index, variantId] of entries) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(resolveMessage(messages.invalidIndex, `Invalid override index: ${index}`, index));
    }
    if (!Number.isInteger(variantId) || variantId < 0 || variantId > variantMask) {
      throw new Error(
        resolveMessage(
          messages.invalidValue,
          `Invalid override variant ${variantId} for variantBits=${variantBits}`,
          variantId,
          variantBits,
        ),
      );
    }

    const delta = index - previousIndex;
    if (delta <= 0) {
      throw new Error(
        resolveMessage(
          messages.nonIncreasing,
          `Override indices must be strictly increasing near ${index}`,
          index,
        ),
      );
    }

    previousIndex = index;
    pushVarUint(bytes, (delta << variantBits) | variantId);
  }

  return {
    payload: Uint8Array.from(bytes),
    variantBits,
    entryCount: entries.length,
  };
};

export const decodePackedOverridePayload = (
  bytes: Uint8Array,
  options: DecodePackedOverridePayloadOptions,
): DecodedOverridePayload => {
  const {
    formatMagic,
    formatVersion,
    messages = {},
  } = options;
  if (!bytes || bytes.length === 0) return Object.freeze(Object.create(null));
  if (bytes.length < 3) {
    throw new Error(resolveMessage(messages.invalidHeader, 'Invalid override payload header'));
  }
  if (bytes[0] !== formatMagic || bytes[1] !== formatVersion) {
    throw new Error(resolveMessage(messages.unsupportedFormat, 'Unsupported override payload format'));
  }

  const variantBits = bytes[2];
  if (!Number.isInteger(variantBits) || variantBits < 1 || variantBits > 8) {
    throw new Error(
      resolveMessage(
        messages.invalidVariantBits,
        `Invalid override variant-bit width: ${variantBits}`,
        variantBits,
      ),
    );
  }

  const variantMask = (1 << variantBits) - 1;
  const overrides = Object.create(null);
  let absoluteIndex = -1;
  const cursorRef = { index: 3 };

  while (cursorRef.index < bytes.length) {
    const token = readVarUint(bytes, cursorRef, messages);
    const delta = token >>> variantBits;
    const variantId = token & variantMask;
    if (delta <= 0) {
      throw new Error(resolveMessage(messages.invalidDelta, 'Invalid override delta encoding'));
    }

    absoluteIndex += delta;
    overrides[absoluteIndex] = variantId;
  }

  return Object.freeze(overrides);
};
