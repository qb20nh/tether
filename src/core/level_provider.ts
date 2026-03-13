import { INFINITE_MAX_LEVELS, generateInfiniteLevel } from '../infinite.ts';
import type {
  LevelDefinition,
} from '../contracts/ports.ts';
import { LEVELS } from '../levels.ts';

export interface LevelProvider {
  getLevel: (index: number) => LevelDefinition | null;
  getCampaignLevelCount: () => number;
  getInfiniteMaxIndex: () => number;
  isInfiniteAbsIndex: (index: number) => boolean;
  toInfiniteIndex: (index: number) => number;
  toAbsInfiniteIndex: (infiniteIndex: number) => number;
  clampInfiniteIndex: (index: number) => number;
  ensureInfiniteAbsIndex: (infiniteIndex: number) => number;
  getDailyAbsIndex: () => number;
  isDailyAbsIndex: (index: number) => boolean;
  hasDailyLevel: () => boolean;
  getDailyId: () => string | null;
}

interface CreateLevelProviderOptions {
  levels?: readonly LevelDefinition[];
  infiniteMaxLevels?: number;
  generateInfiniteLevel?: (infiniteIndex: number) => LevelDefinition;
  cacheLimit?: number;
  dailyLevel?: LevelDefinition | null;
  dailyId?: string | null;
}

const defaultLevels = LEVELS as unknown as readonly LevelDefinition[];
const defaultGenerateInfiniteLevel = generateInfiniteLevel as (infiniteIndex: number) => LevelDefinition;
const readPositiveInt = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) > 0 ? value as number : null;

export function createLevelProvider(options: CreateLevelProviderOptions = {}): LevelProvider {
  const campaignLevels = Array.isArray(options.levels) ? options.levels : defaultLevels;
  const infiniteMaxLevels = readPositiveInt(options.infiniteMaxLevels) ?? INFINITE_MAX_LEVELS;
  const generate = typeof options.generateInfiniteLevel === 'function'
    ? options.generateInfiniteLevel
    : defaultGenerateInfiniteLevel;
  const cacheLimit = readPositiveInt(options.cacheLimit) ?? 24;

  const dailyLevel = options.dailyLevel && Array.isArray(options.dailyLevel.grid)
    ? options.dailyLevel
    : null;
  const dailyId = typeof options.dailyId === 'string' && options.dailyId.trim().length > 0
    ? options.dailyId.trim()
    : null;

  const campaignCount = campaignLevels.length;
  const maxInfiniteIndex = infiniteMaxLevels - 1;
  const dailyAbsIndex = campaignCount + infiniteMaxLevels;
  const infiniteLevelCache = new Map<number, LevelDefinition>();

  const isDailyAbsIndex = (index: number) => Number.isInteger(index) && index === dailyAbsIndex;
  const isInfiniteAbsIndex = (index: number) => Number.isInteger(index) && index >= campaignCount && index < dailyAbsIndex;
  const toInfiniteIndex = (index: number) => index - campaignCount;
  const toAbsInfiniteIndex = (infiniteIndex: number) => campaignCount + infiniteIndex;
  const clampInfiniteIndex = (index: number) => Math.min(Math.max(index, 0), maxInfiniteIndex);

  const getCachedInfiniteLevel = (infiniteIndex: number): LevelDefinition | null => {
    const cached = infiniteLevelCache.get(infiniteIndex);
    if (!cached) return null;
    infiniteLevelCache.delete(infiniteIndex);
    infiniteLevelCache.set(infiniteIndex, cached);
    return cached;
  };

  const putCachedInfiniteLevel = (infiniteIndex: number, level: LevelDefinition): void => {
    if (infiniteLevelCache.has(infiniteIndex)) {
      infiniteLevelCache.delete(infiniteIndex);
    }
    infiniteLevelCache.set(infiniteIndex, level);
    while (infiniteLevelCache.size > cacheLimit) {
      const oldest = infiniteLevelCache.keys().next().value;
      if (typeof oldest === 'number') {
        infiniteLevelCache.delete(oldest);
      }
    }
  };

  const ensureInfiniteAbsIndex = (infiniteIndex: number): number => {
    const normalizedIndex = clampInfiniteIndex(Number.isInteger(infiniteIndex) ? infiniteIndex : 0);
    const cached = getCachedInfiniteLevel(normalizedIndex);
    if (!cached) {
      putCachedInfiniteLevel(normalizedIndex, generate(normalizedIndex));
    }
    return toAbsInfiniteIndex(normalizedIndex);
  };

  const getLevel = (index: number): LevelDefinition | null => {
    if (isDailyAbsIndex(index)) {
      return dailyLevel;
    }

    if (!isInfiniteAbsIndex(index)) {
      if (!Number.isInteger(index) || index < 0 || index >= campaignCount) return null;
      return campaignLevels[index] || null;
    }

    const infiniteIndex = clampInfiniteIndex(toInfiniteIndex(index));
    const cached = getCachedInfiniteLevel(infiniteIndex);
    if (cached) return cached;
    const generated = generate(infiniteIndex);
    putCachedInfiniteLevel(infiniteIndex, generated);
    return generated;
  };

  return {
    getLevel,
    getCampaignLevelCount: () => campaignCount,
    getInfiniteMaxIndex: () => maxInfiniteIndex,
    isInfiniteAbsIndex,
    toInfiniteIndex,
    toAbsInfiniteIndex,
    clampInfiniteIndex,
    ensureInfiniteAbsIndex,
    getDailyAbsIndex: () => dailyAbsIndex,
    isDailyAbsIndex,
    hasDailyLevel: () => Boolean(dailyLevel),
    getDailyId: () => dailyId,
  };
}
