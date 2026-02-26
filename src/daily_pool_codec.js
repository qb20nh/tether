export const DAILY_OVERRIDE_FORMAT_MAGIC = 0x44; // 'D'
export const DAILY_OVERRIDE_FORMAT_VERSION = 1;

const toSortedOverrideEntries = (overrides) => {
  if (!overrides) return [];

  if (overrides instanceof Map) {
    return [...overrides.entries()].sort((a, b) => a[0] - b[0]);
  }

  return Object.entries(overrides)
    .map(([slot, variantId]) => [Number.parseInt(slot, 10), variantId])
    .filter(([slot, variantId]) => Number.isInteger(slot) && Number.isInteger(variantId))
    .sort((a, b) => a[0] - b[0]);
};

const bitsRequired = (maxValueInclusive) => {
  if (!(maxValueInclusive > 0)) return 1;
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

const readVarUint = (bytes, cursorRef) => {
  let value = 0;
  let shift = 0;

  while (cursorRef.index < bytes.length) {
    const byte = bytes[cursorRef.index++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 28) {
      throw new Error('Invalid varint in daily overrides payload');
    }
  }

  throw new Error('Truncated varint in daily overrides payload');
};

export const encodeDailyOverridesPayload = (overrides, maxVariantUsed = 0) => {
  const entries = toSortedOverrideEntries(overrides);
  const variantBits = bitsRequired(maxVariantUsed);

  if (variantBits > 8) {
    throw new Error(`Daily override variant width ${variantBits} bits exceeds format limit (8 bits)`);
  }

  const variantMask = (1 << variantBits) - 1;
  const bytes = [DAILY_OVERRIDE_FORMAT_MAGIC, DAILY_OVERRIDE_FORMAT_VERSION, variantBits];
  let prevSlot = -1;

  for (const [slot, variantId] of entries) {
    if (!Number.isInteger(slot) || slot < 0) {
      throw new Error(`Invalid daily override slot: ${slot}`);
    }
    if (!Number.isInteger(variantId) || variantId < 0 || variantId > variantMask) {
      throw new Error(`Invalid daily override variant ${variantId} for variantBits=${variantBits}`);
    }

    const delta = slot - prevSlot;
    if (delta <= 0) {
      throw new Error(`Daily override slots must be strictly increasing near slot ${slot}`);
    }

    prevSlot = slot;
    const token = (delta << variantBits) | variantId;
    pushVarUint(bytes, token);
  }

  return {
    payload: Uint8Array.from(bytes),
    variantBits,
    entryCount: entries.length,
  };
};

export const decodeDailyOverridesPayload = (bytes) => {
  if (!bytes || bytes.length === 0) return Object.freeze(Object.create(null));
  if (bytes.length < 3) {
    throw new Error('Invalid daily overrides payload header');
  }

  if (bytes[0] !== DAILY_OVERRIDE_FORMAT_MAGIC || bytes[1] !== DAILY_OVERRIDE_FORMAT_VERSION) {
    throw new Error('Unsupported daily overrides payload format');
  }

  const variantBits = bytes[2];
  if (!Number.isInteger(variantBits) || variantBits < 1 || variantBits > 8) {
    throw new Error(`Invalid daily overrides variant-bit width: ${variantBits}`);
  }

  const variantMask = (1 << variantBits) - 1;
  const overrides = Object.create(null);
  let absoluteSlot = -1;
  const cursorRef = { index: 3 };

  while (cursorRef.index < bytes.length) {
    const token = readVarUint(bytes, cursorRef);
    const delta = token >>> variantBits;
    const variantId = token & variantMask;
    if (delta <= 0) {
      throw new Error('Invalid daily overrides delta encoding');
    }

    absoluteSlot += delta;
    overrides[absoluteSlot] = variantId;
  }

  return Object.freeze(overrides);
};
