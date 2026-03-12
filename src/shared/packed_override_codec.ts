// @ts-nocheck
const resolveMessage = (message, fallback, ...args) => {
  if (typeof message === 'function') return message(...args);
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
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

const readVarUint = (bytes, cursorRef, messages = {}) => {
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

export const toSortedOverrideEntries = (overrides) => {
  if (!overrides) return [];

  if (overrides instanceof Map) {
    return [...overrides.entries()].sort((a, b) => a[0] - b[0]);
  }

  return Object.entries(overrides)
    .map(([index, variantId]) => [Number.parseInt(index, 10), variantId])
    .filter(([index, variantId]) => Number.isInteger(index) && Number.isInteger(variantId))
    .sort((a, b) => a[0] - b[0]);
};

export const encodePackedOverridePayload = ({
  formatMagic,
  formatVersion,
  overrides,
  maxVariantUsed = 0,
  messages = {},
}) => {
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
  bytes,
  {
    formatMagic,
    formatVersion,
    messages = {},
  },
) => {
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
