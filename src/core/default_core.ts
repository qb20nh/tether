import { baseGoalText } from '../config.ts';
import type {
  CompletionResult,
  CorePort,
  EvaluateResult,
  GameSnapshot,
  LevelDefinition,
  RuntimeData,
  Translator,
} from '../contracts/ports.ts';
import {
  checkCompletion,
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../rules.ts';

interface LevelProvider {
  getLevel: (index: number) => LevelDefinition | null;
  getCampaignLevelCount: () => number;
  getInfiniteMaxIndex: () => number;
  isInfiniteAbsIndex: (index: number) => boolean;
  toInfiniteIndex: (absIndex: number) => number;
  toAbsInfiniteIndex?: (infiniteIndex: number) => number;
  clampInfiniteIndex: (infiniteIndex: number) => number;
  ensureInfiniteAbsIndex: (infiniteIndex: number) => number;
  getDailyAbsIndex: () => number;
  isDailyAbsIndex: (index: number) => boolean;
  hasDailyLevel: () => boolean;
  getDailyId: () => string | null;
}

const baseGoalTextTyped = baseGoalText as (
  level: LevelDefinition | null,
  translate?: Translator,
) => string;
const evaluateHintsTyped = evaluateHints as (
  snapshot: GameSnapshot,
  evaluateOptions?: RuntimeData,
) => EvaluateResult['hintStatus'];
const evaluateStitchesTyped = evaluateStitches as (snapshot: GameSnapshot) => EvaluateResult['stitchStatus'];
const evaluateRpsTyped = evaluateRPS as (snapshot: GameSnapshot) => EvaluateResult['rpsStatus'];
const evaluateBlockedCellsTyped = evaluateBlockedCells as (
  snapshot: GameSnapshot,
) => EvaluateResult['blockedStatus'];
const checkCompletionTyped = checkCompletion as (
  snapshot: GameSnapshot,
  evaluateResult: EvaluateResult,
  translate: Translator,
) => CompletionResult;

export function createDefaultCore(levelProvider: LevelProvider): CorePort {
  if (!levelProvider || typeof levelProvider.getLevel !== 'function') {
    throw new Error('createDefaultCore requires a levelProvider');
  }

  const evaluate = (snapshot: GameSnapshot, evaluateOptions: RuntimeData = {}): EvaluateResult => ({
    hintStatus: evaluateHintsTyped(snapshot, evaluateOptions),
    stitchStatus: evaluateStitchesTyped(snapshot),
    rpsStatus: evaluateRpsTyped(snapshot),
    blockedStatus: evaluateBlockedCellsTyped(snapshot),
  });

  const check = (
    snapshot: GameSnapshot,
    evaluateResult: EvaluateResult,
    translate: Translator,
  ): CompletionResult =>
    checkCompletionTyped(snapshot, evaluateResult, translate);

  const goalText = (levelIndex: number, translate: Translator): string =>
    baseGoalTextTyped(levelProvider.getLevel(levelIndex), translate);

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
    getDailyAbsIndex: levelProvider.getDailyAbsIndex,
    isDailyAbsIndex: levelProvider.isDailyAbsIndex,
    hasDailyLevel: levelProvider.hasDailyLevel,
    getDailyId: levelProvider.getDailyId,
  };
}
