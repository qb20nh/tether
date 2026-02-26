import { LEVELS } from '../levels.js';
import { INFINITE_MAX_LEVELS, generateInfiniteLevel } from '../infinite.js';

export function createLevelProvider(options = {}) {
  const campaignLevels = Array.isArray(options.levels) ? options.levels : LEVELS;
  const infiniteMaxLevels = Number.isInteger(options.infiniteMaxLevels)
    ? options.infiniteMaxLevels
    : INFINITE_MAX_LEVELS;
  const generate = typeof options.generateInfiniteLevel === 'function'
    ? options.generateInfiniteLevel
    : generateInfiniteLevel;
  const cacheLimit = Number.isInteger(options.cacheLimit) && options.cacheLimit > 0
    ? options.cacheLimit
    : 48;

  const dailyLevel = options.dailyLevel && Array.isArray(options.dailyLevel.grid)
    ? options.dailyLevel
    : null;
  const dailyId = typeof options.dailyId === 'string' && options.dailyId.trim().length > 0
    ? options.dailyId.trim()
    : null;

  const campaignCount = campaignLevels.length;
  const maxInfiniteIndex = infiniteMaxLevels - 1;
  const dailyAbsIndex = campaignCount + infiniteMaxLevels;
  const infiniteLevelCache = new Map();

  const isDailyAbsIndex = (index) => Number.isInteger(index) && index === dailyAbsIndex;
  const isInfiniteAbsIndex = (index) => Number.isInteger(index) && index >= campaignCount && index < dailyAbsIndex;
  const toInfiniteIndex = (index) => index - campaignCount;
  const toAbsInfiniteIndex = (infiniteIndex) => campaignCount + infiniteIndex;
  const clampInfiniteIndex = (index) => Math.min(Math.max(index, 0), maxInfiniteIndex);

  const getCachedInfiniteLevel = (infiniteIndex) => {
    const cached = infiniteLevelCache.get(infiniteIndex);
    if (!cached) return null;
    infiniteLevelCache.delete(infiniteIndex);
    infiniteLevelCache.set(infiniteIndex, cached);
    return cached;
  };

  const putCachedInfiniteLevel = (infiniteIndex, level) => {
    if (infiniteLevelCache.has(infiniteIndex)) {
      infiniteLevelCache.delete(infiniteIndex);
    }
    infiniteLevelCache.set(infiniteIndex, level);
    while (infiniteLevelCache.size > cacheLimit) {
      const oldest = infiniteLevelCache.keys().next().value;
      infiniteLevelCache.delete(oldest);
    }
  };

  const ensureInfiniteAbsIndex = (infiniteIndex) => {
    const normalizedIndex = clampInfiniteIndex(Number.isInteger(infiniteIndex) ? infiniteIndex : 0);
    const cached = getCachedInfiniteLevel(normalizedIndex);
    if (!cached) {
      putCachedInfiniteLevel(normalizedIndex, generate(normalizedIndex));
    }
    return toAbsInfiniteIndex(normalizedIndex);
  };

  const getLevel = (index) => {
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
