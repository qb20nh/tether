import { baseGoalText } from '../config.js';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../rules.js';

export function createDefaultCore(levelProvider) {
  if (!levelProvider || typeof levelProvider.getLevel !== 'function') {
    throw new Error('createDefaultCore requires a levelProvider');
  }

  const evaluate = (snapshot, evaluateOptions = {}) => ({
    hintStatus: evaluateHints(snapshot, evaluateOptions),
    stitchStatus: evaluateStitches(snapshot),
    rpsStatus: evaluateRPS(snapshot),
    blockedStatus: evaluateBlockedCells(snapshot),
  });

  const check = (snapshot, evaluateResult, translate) =>
    checkCompletion(snapshot, evaluateResult, translate);

  const goalText = (levelIndex, translate) =>
    baseGoalText(levelProvider.getLevel(levelIndex), translate);

  return {
    getLevel: levelProvider.getLevel,
    evaluate,
    checkCompletion: check,
    goalText,
    getCampaignLevelCount: levelProvider.getCampaignLevelCount,
    getInfiniteMaxIndex: levelProvider.getInfiniteMaxIndex,
    isInfiniteAbsIndex: levelProvider.isInfiniteAbsIndex,
    toInfiniteIndex: levelProvider.toInfiniteIndex,
    toAbsInfiniteIndex: levelProvider.toAbsInfiniteIndex,
    clampInfiniteIndex: levelProvider.clampInfiniteIndex,
    ensureInfiniteAbsIndex: levelProvider.ensureInfiniteAbsIndex,
  };
}
