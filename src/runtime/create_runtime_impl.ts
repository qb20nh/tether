import type {
  BoardLayoutMetrics,
  BoardSelection,
  BootState,
  CompletionResult,
  CorePort,
  ElementLike,
  EvaluateResult,
  GameSnapshot,
  GridPoint,
  GridTuple,
  HeadlessRuntime,
  HeadlessRuntimeOptions,
  HeadlessRuntimeResult,
  InteractionModel,
  LocaleOption,
  PathDragSide,
  PathTipArrivalHint,
  PersistencePort,
  RendererPort,
  RendererRefs,
  RuntimeController,
  RuntimeData,
  RuntimeIntent,
  RuntimeOptions,
  RuntimeTheme,
  SessionBoardState,
  StatePort,
  StateTransition,
  Translator,
  UiRenderModel,
  WallGhostState,
} from '../contracts/ports.ts';
import { pointsMatch } from '../math.ts';
import { formatCountdownHms, formatDailyDateLabel, formatDailyMonthDayLabel, utcStartMsFromDateId } from './daily_timer.ts';
import { GAME_COMMANDS, INTENT_TYPES, INTERACTION_UPDATES, UI_ACTIONS } from './intents.ts';
import { createProgressManager } from './progress_manager.ts';
import { SCORE_MODES, createScoreManager } from './score_manager.ts';
import {
  buildSessionBoardFromSnapshot,
  markClearedLevel,
  registerSolvedSnapshot,
} from './solve_progress_helpers.ts';
import { applyTheme as applyThemeCore, normalizeTheme, refreshSettingsToggle as refreshSettingsToggleCore, refreshThemeButton as refreshThemeButtonCore, requestLightThemeConfirmation as requestLightThemeConfirmationCore, setThemeSwitchPrompt as setThemeSwitchPromptCore } from './theme_manager.ts';

type DailyId = string | null;
type ValidationSource = string | null;
type PanelName = 'guide' | 'legend';
type MutableBoardState = SessionBoardState | null;
type NullableGridPoint = GridPoint | null;
type NullableBoardSelection = BoardSelection | null;
type PathDragEdge = Exclude<PathDragSide, null>;

interface DailyRuntimeConfig {
  dailyAbsIndex: number;
  hasDailyLevel: boolean;
  activeDailyId: DailyId;
  dailyResetUtcMs: number | null;
}

interface DebugDailyFreezeState {
  forced: boolean;
  locked: boolean;
}

interface LayoutOptions {
  isPathDragging?: boolean;
  pathDragSide?: PathDragSide;
  pathDragCursor?: NullableGridPoint;
  validationSource?: ValidationSource;
  needsResize?: boolean;
}

interface ResetUiState {
  currentLevelCleared: boolean;
  currentBoardSolved: boolean;
  currentMessageKind: string | null;
  currentMessageHtml: string;
}

interface LowPowerFpsStats {
  avgFrameTimeMs: number;
  p99FrameTimeMs: number;
  avgFps: number;
  p99Fps: number;
}

interface LowPowerHintDetectorState {
  active: boolean;
  lastFrameTimestamp: number;
  idleFrameDurationsMs: number[];
  dragFrameDurationsMs: number[];
  dragActivityFramesRemaining: number;
}

interface InteractionState {
  isPathDragging: boolean;
  pathDragSide: PathDragSide;
  pathDragCursor: NullableGridPoint;
  pathTipArrivalHint: PathTipArrivalHint | null;
  isWallDragging: boolean;
  wallGhost: WallGhostState;
  dropTarget: NullableGridPoint;
  isBoardNavActive: boolean;
  isBoardNavPressing: boolean;
  boardCursor: NullableGridPoint;
  boardSelection: NullableBoardSelection;
  boardSelectionInteractive: boolean | null;
  boardNavPreviewDelta: NullableGridPoint;
}

interface DebugDailyFreezeOptions {
  getLocked: () => boolean;
  renderDailyMeta: () => void;
  applyDailyBoardLockState: (snapshot?: GameSnapshot | null) => boolean;
  readSnapshot: () => GameSnapshot;
  queueBoardLayout: (validate?: boolean, optionsForInteraction?: LayoutOptions) => void;
  interactionState: InteractionState;
}

interface DebugDailyFreezeController {
  isForced: () => boolean;
  readState: () => DebugDailyFreezeState;
  setForced: (nextForced: boolean) => DebugDailyFreezeState;
  toggle: () => DebugDailyFreezeState;
}

interface SelectOptionOptions {
  selected?: boolean;
  disabled?: boolean;
}

interface RawPoint {
  r?: unknown;
  c?: unknown;
}

interface RawBoardSelection extends RawPoint {
  kind?: unknown;
}

interface PathStepPayload extends RuntimeData {
  side?: unknown;
  steps?: unknown;
}

interface ScoreTotals {
  infiniteTotal: number;
  dailyTotal: number;
}

interface ScoreRegistrationResult {
  mode: string;
  levelKey: string;
  awarded: number;
  isNew: boolean;
  levelDistinctCount: number;
  modeTotal: number;
  totals: ScoreTotals;
}

interface ScoreManager {
  readTotals: () => ScoreTotals;
  readDistinctCount: (payload: { mode: string; levelKey: string | null | undefined }) => number;
  registerSolved: (payload: {
    mode: string;
    levelKey: string;
    signature: string;
  }) => ScoreRegistrationResult;
}

interface ProgressManager {
  readCampaignProgress: () => number;
  readInfiniteProgress: () => number;
  isCampaignCompleted: () => boolean;
  markCampaignLevelCleared: (index: number) => boolean;
  markInfiniteLevelCleared: (index: number) => boolean;
  isCampaignLevelUnlocked: (index: number) => boolean;
}

interface MarkClearedLevelResult {
  nextDailySolvedDate: DailyId;
  changedDailySolvedDate: boolean;
}

interface LevelBuckets {
  tutorialIndices: number[];
  practiceIndices: number[];
}

interface EvaluateOptions extends RuntimeData {
  suppressEndpointRequirement?: boolean;
  suppressEndpointKey?: string;
}

interface ToggleOptions {
  force?: boolean;
}

interface UiTextRefreshOptions {
  locale?: string;
  languageSelectorDisabled?: boolean;
}

interface LoadLevelOptions {
  suppressFrozenTransition?: boolean;
}

interface RenderSnapshotOptions {
  completionAnimationTrigger?: boolean;
}

interface UiActionPayload extends RuntimeData {
  actionType?: string;
  value?: string;
  enabled?: boolean;
  panel?: string;
  pendingTheme?: RuntimeTheme | null;
  returnValue?: string | null;
  suppressFrozenTransition?: boolean;
}

interface InteractionUpdatePayload extends RuntimeData {
  updateType?: string;
}

interface GameCommandPayload extends PathStepPayload {
  commandType?: string;
}

type EvaluateCache = Map<string, EvaluateResult>;
type SetDisabledReasonTitle = (buttonEl: ElementLike | null, reasonKey: string | null) => void;
type CreateProgressManagerFn = (
  bootState: BootState,
  campaignCount: number,
  maxInfiniteIndex: number,
  persistence: PersistencePort,
) => ProgressManager;
type CreateScoreManagerFn = (
  scoreState: RuntimeData | null | undefined,
  persistence: PersistencePort,
) => ScoreManager;
type BuildSessionBoardFromSnapshotFn = (payload: {
  snapshot: GameSnapshot;
  activeDailyId?: DailyId;
  isDailyLevelIndex?: (levelIndex: number) => boolean;
}) => SessionBoardState | null;
type RegisterSolvedSnapshotFn = (payload: {
  snapshot: GameSnapshot;
  core: CorePort;
  scoreManager: ScoreManager;
}) => ScoreRegistrationResult | null;
type MarkClearedLevelFn = (payload: {
  levelIndex: number;
  core: CorePort;
  activeDailyId?: DailyId;
  dailySolvedDate?: DailyId;
  onCampaignCleared?: (campaignLevelIndex: number) => void;
  onInfiniteCleared?: (infiniteLevelIndex: number) => void;
  onDailyCleared?: (dailyId: string, changedDailySolvedDate?: boolean) => void;
}) => MarkClearedLevelResult;

const createProgressManagerTyped = createProgressManager as unknown as CreateProgressManagerFn;
const createScoreManagerTyped = createScoreManager as unknown as CreateScoreManagerFn;
const buildSessionBoardFromSnapshotTyped = buildSessionBoardFromSnapshot as unknown as BuildSessionBoardFromSnapshotFn;
const registerSolvedSnapshotTyped = registerSolvedSnapshot as unknown as RegisterSolvedSnapshotFn;
const markClearedLevelTyped = markClearedLevel as unknown as MarkClearedLevelFn;

const PATH_BRACKET_TUTORIAL_LEVEL_INDEX = 0;
const MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX = 7;

const INFINITE_PAGE_SIZE = 10;
const INFINITE_SELECTOR_ACTIONS = Object.freeze({
  first: '__first__',
  prev: '__prev_page__',
  next: '__next_page__',
  last: '__last__',
});
const isRtlLocale = (locale: string | null | undefined): boolean => /^ar/i.test(locale || '');
const DAY_MS = 24 * 60 * 60 * 1000;
const EVALUATE_CACHE_LIMIT = 24;
const TUTORIAL_PRACTICE_NAME_PREFIX_RE = /^\s*.+?\d+\s*[)）]\s*/u;
const LOW_POWER_HINT_MIN_IDLE_SAMPLES = 60;
const LOW_POWER_HINT_MIN_DRAG_SAMPLES = 30;
const LOW_POWER_HINT_MAX_FRAME_SAMPLES = 180;
const LOW_POWER_HINT_MAX_FRAME_DELTA_MS = 250;
const LOW_POWER_HINT_DRAG_ACTIVITY_FRAME_BUDGET = 3;
const LOW_POWER_HINT_MIN_IDLE_AVG_FPS = 42;
const LOW_POWER_HINT_MIN_IDLE_P99_FPS = 30;
const LOW_POWER_HINT_MAX_DRAG_AVG_FPS = 48;
const LOW_POWER_HINT_MAX_DRAG_P99_FPS = 34;
const LOW_POWER_HINT_AVG_DROP_RATIO = 0.8;
const LOW_POWER_HINT_P99_DROP_RATIO = 0.72;
const LOW_POWER_HINT_MIN_AVG_DROP_FPS = 8;
const LOW_POWER_HINT_MIN_P99_DROP_FPS = 8;
const isTetherDevRuntime = () => (
  typeof __TETHER_DEV__ === 'boolean' ? __TETHER_DEV__ : true
);

const createDebugDailyFreezeDev = ({
  getLocked,
  renderDailyMeta,
  applyDailyBoardLockState,
  readSnapshot,
  queueBoardLayout,
  interactionState,
}: DebugDailyFreezeOptions): DebugDailyFreezeController => {
  let forced = false;

  const readState = (): DebugDailyFreezeState => ({
    forced,
    locked: getLocked(),
  });

  const setForced = (nextForced: boolean): DebugDailyFreezeState => {
    forced = Boolean(nextForced);
    renderDailyMeta();
    applyDailyBoardLockState(readSnapshot());
    queueBoardLayout(false, {
      isPathDragging: interactionState.isPathDragging,
      pathDragSide: interactionState.pathDragSide,
      pathDragCursor: interactionState.pathDragCursor,
    });
    return readState();
  };

  return {
    isForced: () => forced,
    readState,
    setForced,
    toggle: () => setForced(!forced),
  };
};

const applyTextDirection = (locale: string | null | undefined): void => {
  const direction = isRtlLocale(locale) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', direction);
};

const applyDataAttributes = (appEl: Element | null, translate: Translator): void => {
  if (!appEl) return;

  appEl.querySelectorAll('[data-i18n]').forEach((el) => {
    const element = el as HTMLElement;
    const key = element.dataset.i18n;
    if (key) element.textContent = translate(key);
  });

  appEl.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const element = el as HTMLElement;
    const key = element.dataset.i18nTitle;
    if (key) element.setAttribute('title', translate(key));
  });

  appEl.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const element = el as HTMLElement;
    const key = element.dataset.i18nAriaLabel;
    if (key) element.setAttribute('aria-label', translate(key));
  });
};

const buildLocaleOptionList = (localeOptions: LocaleOption[] | null | undefined, activeLocale: string): string =>
  (localeOptions || [])
    .map((item) => {
      const disabled = item.disabled ? 'disabled' : '';
      const selected = item.value === activeLocale ? 'selected' : '';
      return `<option value="${item.value}" ${disabled} ${selected}>${item.label}</option>`;
    })
    .join('');

const resolveDailyResetUtcMs = (
  dailyHardInvalidateAtUtcMs: number | null | undefined,
  activeDailyId: DailyId,
): number | null => {
  if (typeof dailyHardInvalidateAtUtcMs === 'number' && Number.isInteger(dailyHardInvalidateAtUtcMs) && dailyHardInvalidateAtUtcMs > 0) {
    return dailyHardInvalidateAtUtcMs;
  }
  if (!activeDailyId) return null;

  const startMs = utcStartMsFromDateId(activeDailyId);
  if (typeof startMs !== 'number' || !Number.isInteger(startMs)) return null;
  return startMs + DAY_MS;
};

const resolveDailyRuntimeConfig = (
  core: CorePort,
  dailyHardInvalidateAtUtcMs: number | null | undefined,
  campaignCount: number,
  maxInfiniteIndex: number,
): DailyRuntimeConfig => {
  const dailyAbsIndex = typeof core.getDailyAbsIndex === 'function'
    ? core.getDailyAbsIndex()
    : (campaignCount + maxInfiniteIndex + 1);
  const hasDailyLevel = typeof core.hasDailyLevel === 'function'
    ? core.hasDailyLevel()
    : false;
  const activeDailyId = typeof core.getDailyId === 'function'
    ? core.getDailyId()
    : null;

  return {
    dailyAbsIndex,
    hasDailyLevel,
    activeDailyId,
    dailyResetUtcMs: resolveDailyResetUtcMs(dailyHardInvalidateAtUtcMs, activeDailyId),
  };
};

const stripTutorialPracticePrefix = (value: string, nameKey: string | undefined): string => {
  if (typeof nameKey !== 'string') return value;
  if (!nameKey.startsWith('level.tutorial_') && !nameKey.startsWith('level.pilot_')) return value;
  return value.replace(TUTORIAL_PRACTICE_NAME_PREFIX_RE, '').trim();
};

const resolveLevelNameCore = (
  level: { nameKey?: string; name?: string } | null | undefined,
  translate: Translator,
): string => {
  let name = '';
  if (level?.nameKey) {
    const translated = translate(level.nameKey);
    if (translated !== level.nameKey) {
      name = translated;
    }
  }
  if (!name) {
    name = level?.name || '';
  }

  return stripTutorialPracticePrefix(
    String(name || '').trim(),
    level?.nameKey,
  );
};

const buildSelectOption = (
  value: string | number,
  label: string,
  options: SelectOptionOptions = {},
): string => {
  const selected = options.selected ? 'selected' : '';
  const disabled = options.disabled ? 'disabled' : '';
  return `<option value="${value}" ${disabled} ${selected}>${label}</option>`;
};

const buildSelectOptGroup = (label: string, options: string[]): string => {
  if (options.length === 0) return '';
  return `<optgroup label="${label}">${options.join('')}</optgroup>`;
};

const readNullableGridPoint = (rawPoint: RawPoint | null | undefined): NullableGridPoint => {
  const source = rawPoint;
  if (!source || !Number.isInteger(source.r) || !Number.isInteger(source.c)) return null;
  const r = source.r as number;
  const c = source.c as number;
  return { r, c };
};

const readNullableBoardSelection = (
  rawSelection: RawBoardSelection | null | undefined,
): NullableBoardSelection => {
  if (
    !Number.isInteger(rawSelection?.r)
    || !Number.isInteger(rawSelection?.c)
    || typeof rawSelection?.kind !== 'string'
  ) {
    return null;
  }
  return {
    kind: rawSelection.kind,
    r: rawSelection.r as number,
    c: rawSelection.c as number,
  };
};

const gridPointsMatch = (
  left: NullableGridPoint | undefined,
  right: NullableGridPoint | undefined,
): boolean =>
  (left?.r ?? null) === (right?.r ?? null)
  && (left?.c ?? null) === (right?.c ?? null);

const boardSelectionsMatch = (
  left: NullableBoardSelection | undefined,
  right: NullableBoardSelection | undefined,
): boolean =>
  (left?.kind ?? null) === (right?.kind ?? null)
  && gridPointsMatch(left, right);

const cloneBoardState = (stateValue: SessionBoardState | null | undefined): MutableBoardState => {
  if (!stateValue) return null;
  return {
    levelIndex: stateValue.levelIndex,
    path: stateValue.path.map(([r, c]) => [r, c]),
    movableWalls: Array.isArray(stateValue.movableWalls)
      ? stateValue.movableWalls.map(([r, c]) => [r, c])
      : null,
    dailyId: typeof stateValue.dailyId === 'string' ? stateValue.dailyId : null,
  };
};

const clonePathPoint = (point: GridPoint): GridPoint => ({ r: point.r, c: point.c });

const pathsMatchForHint = (
  leftPath: GridPoint[] | null | undefined,
  rightPath: GridPoint[] | null | undefined,
): boolean => {
  if (!Array.isArray(leftPath) || !Array.isArray(rightPath)) return false;
  if (leftPath.length !== rightPath.length) return false;
  for (let i = 0; i < leftPath.length; i += 1) {
    if (!pointsMatch(leftPath[i], rightPath[i])) return false;
  }
  return true;
};

const resolvePathStepPayloadSide = (side: unknown): PathDragEdge | null => {
  if (side === 'start' || side === 'end') return side;
  return null;
};

const resolvePathStepCommandSide = (
  commandType: string,
  payload: PathStepPayload | null = null,
): PathDragEdge | null => {
  if (commandType === GAME_COMMANDS.START_OR_STEP_FROM_START) return 'start';
  if (commandType === GAME_COMMANDS.START_OR_STEP) return 'end';
  if (commandType === GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE) return resolvePathStepPayloadSide(payload?.side);
  return null;
};

const readPathEndpointForSide = (
  path: GridPoint[] | null | undefined,
  side: PathDragSide,
): GridPoint | null => {
  if (!Array.isArray(path) || path.length === 0) return null;
  if (side === 'start') return path[0] || null;
  if (side === 'end') return path.at(-1) || null;
  return null;
};

const buildPathAdvanceHint = (
  side: PathDragEdge,
  currentTip: GridPoint | null,
  step: GridPoint,
): PathTipArrivalHint | null => {
  if (!currentTip) return null;
  return {
    side,
    from: clonePathPoint(currentTip),
    to: { r: step.r, c: step.c },
  };
};

const applyDragSequenceStepAtStart = (
  workingPath: GridPoint[],
  step: GridPoint,
  side: PathDragEdge,
): PathTipArrivalHint | null => {
  const currentTip = workingPath[0] || null;
  const retractNeighbor = workingPath[1] || null;
  if (retractNeighbor && pointsMatch(retractNeighbor, step)) {
    workingPath.shift();
    return null;
  }

  workingPath.unshift({ r: step.r, c: step.c });
  return buildPathAdvanceHint(side, currentTip, step);
};

const applyDragSequenceStepAtEnd = (
  workingPath: GridPoint[],
  step: GridPoint,
  side: PathDragEdge,
): PathTipArrivalHint | null => {
  const currentTip = workingPath[workingPath.length - 1] || null;
  const retractNeighbor = workingPath.length > 1
    ? workingPath[workingPath.length - 2]
    : null;
  if (retractNeighbor && pointsMatch(retractNeighbor, step)) {
    workingPath.pop();
    return null;
  }

  workingPath.push({ r: step.r, c: step.c });
  return buildPathAdvanceHint(side, currentTip, step);
};

const resolveDragSequenceTipArrivalHintCore = (
  side: PathDragSide,
  prevSnapshot: GameSnapshot | null | undefined,
  nextSnapshot: GameSnapshot | null | undefined,
  payload: PathStepPayload | null | undefined,
): PathTipArrivalHint | null => {
  if (side !== 'start' && side !== 'end') return null;
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  if (steps.length === 0) return null;

  const prevPath = Array.isArray(prevSnapshot?.path) ? prevSnapshot.path : [];
  const nextPath = Array.isArray(nextSnapshot?.path) ? nextSnapshot.path : [];
  const workingPath = prevPath.map(clonePathPoint);
  const applyStep = side === 'start' ? applyDragSequenceStepAtStart : applyDragSequenceStepAtEnd;
  let lastAdvanceHint: PathTipArrivalHint | null = null;

  for (const step of steps) {
    if (!Number.isInteger(step?.r) || !Number.isInteger(step?.c)) return null;
    lastAdvanceHint = applyStep(workingPath, step, side);
  }

  if (!pathsMatchForHint(workingPath, nextPath)) return null;
  return lastAdvanceHint;
};

const setScoreMetaActiveState = (scoreMetaEl: ElementLike, active: boolean): void => {
  scoreMetaEl.hidden = false;
  scoreMetaEl.classList.toggle('isInactive', !active);
  scoreMetaEl.setAttribute('aria-hidden', active ? 'false' : 'true');
};

const renderDailyScoreMeta = ({
  refs,
  infiniteItem,
  dailyItem,
  separator,
  translate,
  scoreManager,
  totals,
  activeDailyId,
}: {
  refs: RendererRefs;
  infiniteItem: ElementLike | null;
  dailyItem: ElementLike | null;
  separator: ElementLike | null;
  translate: Translator;
  scoreManager: ScoreManager;
  totals: ScoreTotals;
  activeDailyId: DailyId;
}): void => {
  if (!refs.dailyScoreValue) return;
  if (infiniteItem) infiniteItem.hidden = true;
  if (dailyItem) dailyItem.hidden = false;
  if (separator) separator.hidden = true;
  if (refs.dailyScoreLabel) refs.dailyScoreLabel.textContent = translate('ui.scoreDailyLabel');
  const distinctCount = scoreManager.readDistinctCount({
    mode: SCORE_MODES.DAILY,
    levelKey: activeDailyId,
  });
  refs.dailyScoreValue.textContent = `${totals.dailyTotal} (${distinctCount})`;
};

const renderInfiniteScoreMeta = ({
  refs,
  infiniteItem,
  dailyItem,
  separator,
  translate,
  scoreManager,
  totals,
  core,
  levelIndex,
}: {
  refs: RendererRefs;
  infiniteItem: ElementLike | null;
  dailyItem: ElementLike | null;
  separator: ElementLike | null;
  translate: Translator;
  scoreManager: ScoreManager;
  totals: ScoreTotals;
  core: CorePort;
  levelIndex: number;
}): void => {
  if (!refs.infiniteScoreValue) return;
  if (infiniteItem) infiniteItem.hidden = false;
  if (dailyItem) dailyItem.hidden = true;
  if (separator) separator.hidden = true;
  if (refs.infiniteScoreLabel) refs.infiniteScoreLabel.textContent = translate('ui.scoreInfiniteLabel');
  const infiniteLevelKey = String(core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex)));
  const distinctCount = scoreManager.readDistinctCount({
    mode: SCORE_MODES.INFINITE,
    levelKey: infiniteLevelKey,
  });
  refs.infiniteScoreValue.textContent = `${totals.infiniteTotal} (${distinctCount})`;
};

const renderScoreMetaCore = ({
  refs,
  snapshot,
  isDailyLevelIndex,
  core,
  scoreManager,
  activeDailyId,
  translate,
}: {
  refs: RendererRefs;
  snapshot: GameSnapshot | null | undefined;
  isDailyLevelIndex: (levelIndex: number) => boolean;
  core: CorePort;
  scoreManager: ScoreManager;
  activeDailyId: DailyId;
  translate: Translator;
}): void => {
  if (!refs?.scoreMeta || !refs?.infiniteScoreValue || !refs?.dailyScoreValue) return;

  const levelIndex = snapshot?.levelIndex;
  const resolvedLevelIndex = typeof levelIndex === 'number' && Number.isInteger(levelIndex)
    ? levelIndex
    : null;
  const totals = scoreManager.readTotals();
  const infiniteItem = refs.infiniteScoreLabel?.closest('.scoreMetaItem') as ElementLike | null;
  const dailyItem = refs.dailyScoreLabel?.closest('.scoreMetaItem') as ElementLike | null;
  const separator = refs.scoreMeta.querySelector('.scoreMetaSeparator') as ElementLike | null;
  if (resolvedLevelIndex === null) {
    setScoreMetaActiveState(refs.scoreMeta, false);
    return;
  }

  if (isDailyLevelIndex(resolvedLevelIndex)) {
    setScoreMetaActiveState(refs.scoreMeta, true);
    renderDailyScoreMeta({
      refs,
      infiniteItem,
      dailyItem,
      separator,
      translate,
      scoreManager,
      totals,
      activeDailyId,
    });
    return;
  }

  if (core.isInfiniteAbsIndex(resolvedLevelIndex)) {
    setScoreMetaActiveState(refs.scoreMeta, true);
    renderInfiniteScoreMeta({
      refs,
      infiniteItem,
      dailyItem,
      separator,
      translate,
      scoreManager,
      totals,
      core,
      levelIndex: resolvedLevelIndex,
    });
    return;
  }

  setScoreMetaActiveState(refs.scoreMeta, false);
};

const syncPrevInfiniteButton = (
  buttonEl: ElementLike | null,
  hidden: boolean,
  disabled: boolean,
  setDisabledReasonTitle: SetDisabledReasonTitle,
  reasonKey: string | null = null,
): void => {
  if (!buttonEl) return;
  buttonEl.hidden = hidden;
  buttonEl.disabled = disabled;
  setDisabledReasonTitle(buttonEl, reasonKey);
};

const syncInfiniteNavigationCore = ({
  refs,
  levelIndex,
  isCleared,
  isDailyLevelIndex,
  core,
  maxInfiniteIndex,
  setDisabledReasonTitle,
  isNextLevelAvailable,
  resolveNextButtonLabel,
}: {
  refs: RendererRefs;
  levelIndex: number;
  isCleared: boolean;
  isDailyLevelIndex: (levelIndex: number) => boolean;
  core: CorePort;
  maxInfiniteIndex: number;
  setDisabledReasonTitle: SetDisabledReasonTitle;
  isNextLevelAvailable: (levelIndex: number) => boolean;
  resolveNextButtonLabel: (levelIndex: number) => string;
}): void => {
  if (isDailyLevelIndex(levelIndex) || !core.isInfiniteAbsIndex(levelIndex)) {
    syncPrevInfiniteButton(refs?.prevInfiniteBtn, true, false, setDisabledReasonTitle);
  } else {
    const infiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex));
    syncPrevInfiniteButton(
      refs?.prevInfiniteBtn,
      false,
      infiniteIndex <= 0,
      setDisabledReasonTitle,
      infiniteIndex <= 0 ? 'ui.prevInfiniteDisabledFirst' : null,
    );
  }

  if (!refs?.nextLevelBtn) return;
  if (isDailyLevelIndex(levelIndex)) {
    refs.nextLevelBtn.hidden = true;
    refs.nextLevelBtn.disabled = true;
    setDisabledReasonTitle(refs.nextLevelBtn, null);
    return;
  }

  const nextAvailable = isNextLevelAvailable(levelIndex);
  const atInfiniteEnd = core.isInfiniteAbsIndex(levelIndex)
    && core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex)) >= maxInfiniteIndex;
  let nextDisabledReasonKey: string | null = null;
  if (!isCleared) nextDisabledReasonKey = 'ui.nextDisabledUncleared';
  else if (!nextAvailable && atInfiniteEnd) nextDisabledReasonKey = 'ui.nextDisabledInfiniteEnd';

  refs.nextLevelBtn.hidden = false;
  refs.nextLevelBtn.textContent = resolveNextButtonLabel(levelIndex);
  refs.nextLevelBtn.disabled = !isCleared || !nextAvailable;
  setDisabledReasonTitle(refs.nextLevelBtn, nextDisabledReasonKey);
};

const resolveSelectedPrimaryLevelValue = ({
  currentIndex,
  dailyActive,
  dailyAbsIndex,
  infiniteActive,
  infiniteAbsIndex,
  practiceSet,
  practicePrimaryIndex,
  tutorialSet,
  tutorialPrimaryIndex,
}: {
  currentIndex: number;
  dailyActive: boolean;
  dailyAbsIndex: number;
  infiniteActive: boolean;
  infiniteAbsIndex: number;
  practiceSet: Set<number>;
  practicePrimaryIndex: number | null;
  tutorialSet: Set<number>;
  tutorialPrimaryIndex: number | null;
}): number => {
  if (dailyActive) return dailyAbsIndex;
  if (infiniteActive) return infiniteAbsIndex;
  if (practiceSet.has(currentIndex) && typeof practicePrimaryIndex === 'number' && Number.isInteger(practicePrimaryIndex)) return practicePrimaryIndex;
  if (tutorialSet.has(currentIndex) && typeof tutorialPrimaryIndex === 'number' && Number.isInteger(tutorialPrimaryIndex)) return tutorialPrimaryIndex;
  if (typeof tutorialPrimaryIndex === 'number' && Number.isInteger(tutorialPrimaryIndex)) return tutorialPrimaryIndex;
  if (typeof practicePrimaryIndex === 'number' && Number.isInteger(practicePrimaryIndex)) return practicePrimaryIndex;
  return 0;
};

const resolveDailyLevelOptionLabel = ({
  hasDailyLevel,
  translate,
  activeDailyId,
  activeLocale,
}: {
  hasDailyLevel: boolean;
  translate: Translator;
  activeDailyId: DailyId;
  activeLocale: string;
}): string => {
  if (!hasDailyLevel) return translate('ui.dailyUnavailable');

  const base = translate('ui.dailyLevelOption');
  if (!activeDailyId) return base;

  const date = formatDailyMonthDayLabel(activeDailyId, activeLocale);
  const templated = translate('ui.dailyLevelOptionWithDate', { label: base, date });
  if (templated !== 'ui.dailyLevelOptionWithDate') return templated;
  return `${base}(${date})`;
};

const applyLevelSelectGroupState = (
  levelSelectGroup: ElementLike,
  campaignActive: boolean,
  infiniteActive: boolean,
  dailyActive: boolean,
): void => {
  levelSelectGroup.classList.toggle('isCampaignActive', campaignActive);
  levelSelectGroup.classList.toggle('isInfiniteActive', infiniteActive);
  levelSelectGroup.classList.toggle('isDailyActive', dailyActive);

  if (!levelSelectGroup.parentElement) return;
  levelSelectGroup.parentElement.classList.toggle('isCampaignActive', campaignActive);
  levelSelectGroup.parentElement.classList.toggle('isInfiniteActive', infiniteActive);
  levelSelectGroup.parentElement.classList.toggle('isDailyActive', dailyActive);
};

const resolveActiveCampaignIndices = ({
  currentIndex,
  practiceSet,
  practiceIndices,
  tutorialIndices,
}: {
  currentIndex: number;
  practiceSet: Set<number>;
  practiceIndices: number[];
  tutorialIndices: number[];
}): number[] => {
  if (practiceSet.has(currentIndex) && practiceIndices.length > 0) return practiceIndices;
  if (tutorialIndices.length > 0) return tutorialIndices;
  return practiceIndices;
};

const buildCampaignSecondaryOptionsHtml = ({
  activeCampaignIndices,
  currentIndex,
  isCampaignLevelUnlocked,
  resolveLevelName,
  core,
}: {
  activeCampaignIndices: number[];
  currentIndex: number;
  isCampaignLevelUnlocked: (index: number) => boolean;
  resolveLevelName: (level: { nameKey?: string; name?: string } | null | undefined) => string;
  core: CorePort;
}): { html: string; selectedValue: number } => {
  const selectedValue = activeCampaignIndices.includes(currentIndex)
    ? currentIndex
    : activeCampaignIndices[0];
  let html = '';

  for (let i = 0; i < activeCampaignIndices.length; i += 1) {
    const levelIndex = activeCampaignIndices[i];
    const levelName = resolveLevelName(core.getLevel(levelIndex));
    const levelLabel = levelName ? `${i + 1}) ${levelName}` : String(i + 1);
    html += buildSelectOption(levelIndex, levelLabel, {
      selected: levelIndex === selectedValue,
      disabled: !isCampaignLevelUnlocked(levelIndex),
    });
  }

  return {
    html,
    selectedValue,
  };
};

const buildInfiniteSecondaryOptionsHtml = ({
  currentIndex,
  core,
  maxInfiniteIndex,
  readInfiniteProgress,
}: {
  currentIndex: number;
  core: CorePort;
  maxInfiniteIndex: number;
  readInfiniteProgress: () => number;
}): { html: string; selectedValue: number } => {
  const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(currentIndex));
  const latestUnlockedInfiniteIndex = Math.max(
    core.clampInfiniteIndex(readInfiniteProgress()),
    currentInfiniteIndex,
  );
  const pageStart = Math.floor(currentInfiniteIndex / INFINITE_PAGE_SIZE) * INFINITE_PAGE_SIZE;
  const pageEnd = Math.min(maxInfiniteIndex, pageStart + INFINITE_PAGE_SIZE - 1);
  const prevPageStart = Math.max(0, pageStart - INFINITE_PAGE_SIZE);
  const prevPageEnd = pageStart - 1;
  const nextPageStart = pageStart + INFINITE_PAGE_SIZE;
  const nextPageEnd = Math.min(maxInfiniteIndex, nextPageStart + INFINITE_PAGE_SIZE - 1);
  let html = '';

  if (pageStart > 0) {
    html += buildSelectOption(INFINITE_SELECTOR_ACTIONS.first, '&laquo; #1');
    html += buildSelectOption(
      INFINITE_SELECTOR_ACTIONS.prev,
      `&lsaquo; #${prevPageStart + 1}-#${prevPageEnd + 1}`,
    );
  }

  for (let i = pageStart; i <= pageEnd; i += 1) {
    html += buildSelectOption(i, `${i + 1}`, {
      selected: i === currentInfiniteIndex,
      disabled: i > latestUnlockedInfiniteIndex,
    });
  }

  if (pageEnd < maxInfiniteIndex) {
    html += buildSelectOption(
      INFINITE_SELECTOR_ACTIONS.next,
      `#${nextPageStart + 1}-#${nextPageEnd + 1} &rsaquo;`,
      { disabled: nextPageStart > latestUnlockedInfiniteIndex },
    );
    html += buildSelectOption(
      INFINITE_SELECTOR_ACTIONS.last,
      `#${latestUnlockedInfiniteIndex + 1} &raquo;`,
      { disabled: latestUnlockedInfiniteIndex <= pageEnd },
    );
  }

  return {
    html,
    selectedValue: currentInfiniteIndex,
  };
};

const syncSecondaryLevelSelector = ({
  refs,
  currentIndex,
  campaignActive,
  infiniteActive,
  dailyActive,
  practiceSet,
  practiceIndices,
  tutorialIndices,
  isCampaignLevelUnlocked,
  resolveLevelName,
  core,
  maxInfiniteIndex,
  readInfiniteProgress,
}: {
  refs: RendererRefs;
  currentIndex: number;
  campaignActive: boolean;
  infiniteActive: boolean;
  dailyActive: boolean;
  practiceSet: Set<number>;
  practiceIndices: number[];
  tutorialIndices: number[];
  isCampaignLevelUnlocked: (index: number) => boolean;
  resolveLevelName: (level: { nameKey?: string; name?: string } | null | undefined) => string;
  core: CorePort;
  maxInfiniteIndex: number;
  readInfiniteProgress: () => number;
}): void => {
  if (!refs.levelSelectGroup || !refs.infiniteSel) return;

  const secondaryActive = campaignActive || infiniteActive;
  applyLevelSelectGroupState(refs.levelSelectGroup, campaignActive, infiniteActive, dailyActive);
  refs.infiniteSel.hidden = !secondaryActive;
  refs.infiniteSel.disabled = !secondaryActive;

  if (!secondaryActive) {
    refs.infiniteSel.innerHTML = '';
    return;
  }

  if (campaignActive) {
    const activeCampaignIndices = resolveActiveCampaignIndices({
      currentIndex,
      practiceSet,
      practiceIndices,
      tutorialIndices,
    });
    if (activeCampaignIndices.length === 0) {
      refs.infiniteSel.innerHTML = '';
      refs.infiniteSel.hidden = true;
      refs.infiniteSel.disabled = true;
      return;
    }

    const campaignOptions = buildCampaignSecondaryOptionsHtml({
      activeCampaignIndices,
      currentIndex,
      isCampaignLevelUnlocked,
      resolveLevelName,
      core,
    });
    refs.infiniteSel.innerHTML = campaignOptions.html;
    refs.infiniteSel.value = String(campaignOptions.selectedValue);
    return;
  }

  const infiniteOptions = buildInfiniteSecondaryOptionsHtml({
    currentIndex,
    core,
    maxInfiniteIndex,
    readInfiniteProgress,
  });
  refs.infiniteSel.innerHTML = infiniteOptions.html;
  refs.infiniteSel.value = String(infiniteOptions.selectedValue);
};

const refreshLevelOptionsCore = ({
  refs,
  currentIndex,
  dailyAbsIndex,
  hasDailyLevel,
  activeDailyId,
  activeLocale,
  translate,
  core,
  maxInfiniteIndex,
  readInfiniteProgress,
  isCampaignLevelUnlocked,
  resolveCampaignBuckets,
  resolveLatestUnlockedCampaignBucketIndex,
  resolveInfiniteModeLabel,
  resolveLevelName,
  isDailyLevelIndex,
}: {
  refs: RendererRefs;
  currentIndex: number;
  dailyAbsIndex: number;
  hasDailyLevel: boolean;
  activeDailyId: DailyId;
  activeLocale: string;
  translate: Translator;
  core: CorePort;
  maxInfiniteIndex: number;
  readInfiniteProgress: () => number;
  isCampaignLevelUnlocked: (index: number) => boolean;
  resolveCampaignBuckets: () => LevelBuckets;
  resolveLatestUnlockedCampaignBucketIndex: (indices: number[]) => number | null;
  resolveInfiniteModeLabel: () => string;
  resolveLevelName: (level: { nameKey?: string; name?: string } | null | undefined) => string;
  isDailyLevelIndex: (levelIndex: number) => boolean;
}): void => {
  if (!refs.levelSel) return;
  const campaignOptions: string[] = [];
  const modeOptions: string[] = [];
  const { tutorialIndices, practiceIndices } = resolveCampaignBuckets();
  const tutorialSet = new Set(tutorialIndices);
  const practiceSet = new Set(practiceIndices);
  const infiniteActive = core.isInfiniteAbsIndex(currentIndex);
  const dailyActive = isDailyLevelIndex(currentIndex);
  const campaignActive = !infiniteActive && !dailyActive;
  const tutorialPrimaryIndex = resolveLatestUnlockedCampaignBucketIndex(tutorialIndices);
  const practicePrimaryIndex = resolveLatestUnlockedCampaignBucketIndex(practiceIndices);
  const selectorInfiniteIndex = core.isInfiniteAbsIndex(currentIndex)
    ? core.clampInfiniteIndex(core.toInfiniteIndex(currentIndex))
    : core.clampInfiniteIndex(readInfiniteProgress());
  const infiniteAbsIndex = core.ensureInfiniteAbsIndex(selectorInfiniteIndex);
  const selectedPrimaryValue = resolveSelectedPrimaryLevelValue({
    currentIndex,
    dailyActive,
    dailyAbsIndex,
    infiniteActive,
    infiniteAbsIndex,
    practiceSet,
    practicePrimaryIndex,
    tutorialSet,
    tutorialPrimaryIndex,
  });

  if (typeof tutorialPrimaryIndex === 'number' && Number.isInteger(tutorialPrimaryIndex)) {
    campaignOptions.push(buildSelectOption(tutorialPrimaryIndex, translate('ui.levelGroupTutorial'), {
      disabled: !isCampaignLevelUnlocked(tutorialPrimaryIndex),
      selected: selectedPrimaryValue === tutorialPrimaryIndex,
    }));
  }
  if (typeof practicePrimaryIndex === 'number' && Number.isInteger(practicePrimaryIndex)) {
    campaignOptions.push(buildSelectOption(practicePrimaryIndex, translate('ui.levelGroupPractice'), {
      disabled: !isCampaignLevelUnlocked(practicePrimaryIndex),
      selected: selectedPrimaryValue === practicePrimaryIndex,
    }));
  }

  const translatedInfiniteLabel = resolveInfiniteModeLabel();
  const fallbackInfiniteLabel = resolveLevelName(core.getLevel(infiniteAbsIndex));
  const infiniteLabel = translatedInfiniteLabel === 'ui.infiniteLevelOption'
    ? fallbackInfiniteLabel
    : translatedInfiniteLabel;
  modeOptions.push(buildSelectOption(infiniteAbsIndex, infiniteLabel, {
    selected: selectedPrimaryValue === infiniteAbsIndex,
  }));

  const dailyLabel = resolveDailyLevelOptionLabel({
    hasDailyLevel,
    translate,
    activeDailyId,
    activeLocale,
  });
  modeOptions.push(buildSelectOption(dailyAbsIndex, dailyLabel, {
    disabled: !hasDailyLevel,
    selected: selectedPrimaryValue === dailyAbsIndex,
  }));

  refs.levelSel.innerHTML = [
    buildSelectOptGroup(translate('ui.levelGroupCampaign'), campaignOptions),
    buildSelectOptGroup(translate('ui.levelGroupModes'), modeOptions),
  ].join('');
  refs.levelSel.value = String(selectedPrimaryValue);

  syncSecondaryLevelSelector({
    refs,
    currentIndex,
    campaignActive,
    infiniteActive,
    dailyActive,
    practiceSet,
    practiceIndices,
    tutorialIndices,
    isCampaignLevelUnlocked,
    resolveLevelName,
    core,
    maxInfiniteIndex,
    readInfiniteProgress,
  });
};

const normalizeLoadLevelTargetIndex = (idx: unknown, {
  isDailyLevelIndex,
  hasDailyLevel,
  dailyAbsIndex,
  core,
  campaignCount,
}: {
  isDailyLevelIndex: (levelIndex: number) => boolean;
  hasDailyLevel: boolean;
  dailyAbsIndex: number;
  core: CorePort;
  campaignCount: number;
}): number | null => {
  let targetIndex = typeof idx === 'number' && Number.isInteger(idx) ? idx : 0;
  if (targetIndex < 0) targetIndex = 0;

  if (isDailyLevelIndex(targetIndex)) {
    if (!hasDailyLevel) return null;
    return dailyAbsIndex;
  }
  if (core.isInfiniteAbsIndex(targetIndex)) {
    return core.ensureInfiniteAbsIndex(core.clampInfiniteIndex(core.toInfiniteIndex(targetIndex)));
  }
  return Math.min(targetIndex, campaignCount - 1);
};

const resolveCampaignSecondarySelection = ({
  selectedValue,
  snapshot,
  campaignCount,
  isCampaignLevelUnlocked,
}: {
  selectedValue: string;
  snapshot: GameSnapshot;
  campaignCount: number;
  isCampaignLevelUnlocked: (index: number) => boolean;
}): number | null => {
  const parsedCampaignIndex = Number.parseInt(selectedValue, 10);
  if (
    !Number.isInteger(parsedCampaignIndex)
    || parsedCampaignIndex < 0
    || parsedCampaignIndex >= campaignCount
    || !isCampaignLevelUnlocked(parsedCampaignIndex)
  ) {
    return null;
  }
  if (parsedCampaignIndex === snapshot.levelIndex) return null;
  return parsedCampaignIndex;
};

const resolveInfiniteSecondarySelection = ({
  selectedValue,
  currentInfiniteIndex,
  currentPageStart,
  latestUnlockedInfiniteIndex,
  core,
}: {
  selectedValue: string;
  currentInfiniteIndex: number;
  currentPageStart: number;
  latestUnlockedInfiniteIndex: number;
  core: CorePort;
}): number | null => {
  if (selectedValue === INFINITE_SELECTOR_ACTIONS.first) return 0;
  if (selectedValue === INFINITE_SELECTOR_ACTIONS.prev) {
    return Math.max(0, currentPageStart - INFINITE_PAGE_SIZE);
  }
  if (selectedValue === INFINITE_SELECTOR_ACTIONS.next) {
    return Math.min(latestUnlockedInfiniteIndex, currentPageStart + INFINITE_PAGE_SIZE);
  }
  if (selectedValue === INFINITE_SELECTOR_ACTIONS.last) return latestUnlockedInfiniteIndex;

  const parsed = Number.parseInt(selectedValue, 10);
  if (!Number.isInteger(parsed)) return null;
  return core.clampInfiniteIndex(parsed);
};

const handleThemeToggleAction = ({
  setSettingsMenuOpen,
  readActiveTheme,
  requestLightThemeConfirmation,
  applyThemeState,
}: {
  setSettingsMenuOpen: (isOpen: boolean) => void;
  readActiveTheme: () => RuntimeTheme;
  requestLightThemeConfirmation: (targetTheme: RuntimeTheme) => boolean;
  applyThemeState: (nextTheme: RuntimeTheme) => void;
}): void => {
  setSettingsMenuOpen(false);
  const targetTheme = readActiveTheme() === 'dark' ? 'light' : 'dark';
  if (targetTheme === 'light' && requestLightThemeConfirmation(targetTheme)) return;
  applyThemeState(targetTheme);
};

const handleThemeDialogCloseAction = ({
  refs,
  pendingTheme,
  returnValue,
  applyThemeState,
}: {
  refs: RendererRefs;
  pendingTheme: RuntimeTheme | null;
  returnValue: string | null | undefined;
  applyThemeState: (nextTheme: RuntimeTheme) => void;
}): void => {
  if (pendingTheme === 'light' && returnValue === 'confirm') {
    applyThemeState(pendingTheme);
  }
  if (!refs.themeSwitchDialog) return;
  delete refs.themeSwitchDialog.dataset.pendingTheme;
  refs.themeSwitchDialog.returnValue = '';
};

const handlePanelToggleAction = ({
  refs,
  panel,
  applyPanelVisibility,
  queueBoardLayout,
}: {
  refs: RendererRefs;
  panel: string | null | undefined;
  applyPanelVisibility: (
    panelEl: ElementLike | null,
    buttonEl: ElementLike | null,
    panel: PanelName,
    isHidden: boolean,
  ) => void;
  queueBoardLayout: (validate?: boolean, optionsForInteraction?: LayoutOptions) => void;
}): void => {
  if (panel !== 'guide' && panel !== 'legend') return;
  const isGuidePanel = panel === 'guide';
  const panelEl = isGuidePanel ? refs.guidePanel : refs.legendPanel;
  const buttonEl = isGuidePanel ? refs.guideToggleBtn : refs.legendToggleBtn;
  const hidden = !(panelEl?.classList.contains?.('is-hidden') === true);
  applyPanelVisibility(panelEl, buttonEl, panel, hidden);
  queueBoardLayout(false, { needsResize: true });
};

const handleNextLevelClickAction = ({
  state,
  isDailyLevelIndex,
  core,
  maxInfiniteIndex,
  readInfiniteProgress,
  campaignCount,
  isCampaignCompleted,
  loadLevel,
}: {
  state: StatePort;
  isDailyLevelIndex: (levelIndex: number) => boolean;
  core: CorePort;
  maxInfiniteIndex: number;
  readInfiniteProgress: () => number;
  campaignCount: number;
  isCampaignCompleted: () => boolean;
  loadLevel: (idx: unknown, options?: { suppressFrozenTransition?: boolean }) => void;
}): void => {
  const snapshot = state.getSnapshot();
  if (isDailyLevelIndex(snapshot.levelIndex)) return;

  if (core.isInfiniteAbsIndex(snapshot.levelIndex)) {
    const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(snapshot.levelIndex));
    if (currentInfiniteIndex >= maxInfiniteIndex) return;
    const latestUnlockedInfiniteIndex = core.clampInfiniteIndex(readInfiniteProgress());
    const nextInfiniteIndex = Math.min(currentInfiniteIndex + 1, latestUnlockedInfiniteIndex, maxInfiniteIndex);
    if (nextInfiniteIndex <= currentInfiniteIndex) return;
    loadLevel(core.ensureInfiniteAbsIndex(nextInfiniteIndex));
    return;
  }

  const nextCampaignIndex = snapshot.levelIndex + 1;
  if (nextCampaignIndex < campaignCount) {
    loadLevel(nextCampaignIndex);
    return;
  }

  if (isCampaignCompleted()) {
    loadLevel(core.ensureInfiniteAbsIndex(core.clampInfiniteIndex(readInfiniteProgress())));
  }
};

const handlePrevInfiniteClickAction = ({
  state,
  core,
  loadLevel,
}: {
  state: StatePort;
  core: CorePort;
  loadLevel: (idx: unknown, options?: { suppressFrozenTransition?: boolean }) => void;
}): void => {
  const snapshot = state.getSnapshot();
  if (!core.isInfiniteAbsIndex(snapshot.levelIndex)) return;

  const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(snapshot.levelIndex));
  if (currentInfiniteIndex <= 0) return;
  loadLevel(core.ensureInfiniteAbsIndex(currentInfiniteIndex - 1));
};

const handlePathDragInteractionUpdate = ({
  payload,
  interactionState,
  state,
  renderer,
  queueBoardLayout,
  evaluateCache,
  isPathDragCursorOnActiveEndpoint,
  resetLowPowerHintDetectorWindow,
  markLowPowerHintDragActivity,
}: {
  payload: RuntimeData;
  interactionState: InteractionState;
  state: StatePort;
  renderer: RendererPort;
  queueBoardLayout: (validate?: boolean, optionsForInteraction?: LayoutOptions) => void;
  evaluateCache: EvaluateCache;
  isPathDragCursorOnActiveEndpoint: (
    snapshot: GameSnapshot,
    isPathDragging: boolean,
    pathDragSide: PathDragSide,
    pathDragCursor: NullableGridPoint,
  ) => boolean;
  resetLowPowerHintDetectorWindow: () => void;
  markLowPowerHintDragActivity: () => void;
}): void => {
  const nextIsPathDragging = Boolean(payload.isPathDragging);
  const nextPathDragSide = resolvePathStepPayloadSide(payload.pathDragSide);
  const nextPathDragCursor = readNullableGridPoint(payload.pathDragCursor as RawPoint | null | undefined);
  const cursorChanged = !gridPointsMatch(interactionState.pathDragCursor, nextPathDragCursor);
  const stateChanged = (
    interactionState.isPathDragging !== nextIsPathDragging
    || interactionState.pathDragSide !== nextPathDragSide
    || cursorChanged
  );
  if (!stateChanged) return;

  const snapshot = state.getSnapshot();
  const prevSuppressEndpoint = isPathDragCursorOnActiveEndpoint(
    snapshot,
    interactionState.isPathDragging,
    interactionState.pathDragSide,
    interactionState.pathDragCursor,
  );
  const nextSuppressEndpoint = isPathDragCursorOnActiveEndpoint(
    snapshot,
    nextIsPathDragging,
    nextPathDragSide,
    nextPathDragCursor,
  );
  const shouldQueueLayout = (
    interactionState.isPathDragging !== nextIsPathDragging
    || interactionState.pathDragSide !== nextPathDragSide
    || prevSuppressEndpoint !== nextSuppressEndpoint
  );
  const endedPathDrag = interactionState.isPathDragging && !nextIsPathDragging;

  interactionState.isPathDragging = nextIsPathDragging;
  interactionState.pathDragSide = nextPathDragSide;
  interactionState.pathDragCursor = nextPathDragCursor;
  if (endedPathDrag) evaluateCache.clear();
  if (!interactionState.isPathDragging) {
    resetLowPowerHintDetectorWindow();
  } else if (stateChanged) {
    markLowPowerHintDragActivity();
  }
  renderer.updateInteraction?.(interactionState);
  if (!shouldQueueLayout) return;

  queueBoardLayout(false, {
    isPathDragging: interactionState.isPathDragging,
    pathDragSide: interactionState.pathDragSide,
    pathDragCursor: interactionState.pathDragCursor,
  });
};

const handleWallDragInteractionUpdate = ({
  payload,
  interactionState,
  renderer,
}: {
  payload: RuntimeData;
  interactionState: InteractionState;
  renderer: RendererPort;
}): void => {
  const nextWallDragging = Boolean(payload.isWallDragging);
  const nextVisible = Boolean(payload.visible);
  const nextX = Number.isFinite(payload.x) ? (payload.x as number) : interactionState.wallGhost.x;
  const nextY = Number.isFinite(payload.y) ? (payload.y as number) : interactionState.wallGhost.y;
  const stateChanged = (
    interactionState.isWallDragging !== nextWallDragging
    || interactionState.wallGhost.visible !== nextVisible
    || interactionState.wallGhost.x !== nextX
    || interactionState.wallGhost.y !== nextY
  );
  if (!stateChanged) return;

  interactionState.isWallDragging = nextWallDragging;
  interactionState.wallGhost = {
    visible: nextVisible,
    x: nextX,
    y: nextY,
  };
  renderer.updateInteraction?.(interactionState);
};

const handleWallDropTargetInteractionUpdate = ({
  payload,
  interactionState,
  renderer,
}: {
  payload: RuntimeData;
  interactionState: InteractionState;
  renderer: RendererPort;
}): void => {
  const nextDropTarget = readNullableGridPoint(payload.dropTarget as RawPoint | null | undefined);
  if (gridPointsMatch(interactionState.dropTarget, nextDropTarget)) return;

  interactionState.dropTarget = nextDropTarget;
  renderer.updateInteraction?.(interactionState);
};

const handleBoardNavInteractionUpdate = ({
  payload,
  interactionState,
  renderer,
}: {
  payload: RuntimeData;
  interactionState: InteractionState;
  renderer: RendererPort;
}): void => {
  const nextBoardCursor = readNullableGridPoint(payload.boardCursor as RawPoint | null | undefined);
  const nextBoardSelection = readNullableBoardSelection(payload.boardSelection as RawBoardSelection | null | undefined);
  const nextBoardSelectionInteractive = typeof payload.boardSelectionInteractive === 'boolean'
    ? payload.boardSelectionInteractive
    : null;
  const nextBoardNavPreviewDelta = readNullableGridPoint(payload.boardNavPreviewDelta as RawPoint | null | undefined);
  const nextIsBoardNavPressing = Boolean(payload.isBoardNavPressing);
  const nextIsBoardNavActive = Boolean(payload.isBoardNavActive);
  const stateChanged = (
    interactionState.isBoardNavActive !== nextIsBoardNavActive
    || interactionState.isBoardNavPressing !== nextIsBoardNavPressing
    || !gridPointsMatch(interactionState.boardCursor, nextBoardCursor)
    || !boardSelectionsMatch(interactionState.boardSelection, nextBoardSelection)
    || (interactionState.boardSelectionInteractive ?? null) !== nextBoardSelectionInteractive
    || !gridPointsMatch(interactionState.boardNavPreviewDelta, nextBoardNavPreviewDelta)
  );
  if (!stateChanged) return;

  interactionState.isBoardNavActive = nextIsBoardNavActive;
  interactionState.isBoardNavPressing = nextIsBoardNavPressing;
  interactionState.boardCursor = nextBoardCursor;
  interactionState.boardSelection = nextBoardSelection;
  interactionState.boardSelectionInteractive = nextBoardSelectionInteractive;
  interactionState.boardNavPreviewDelta = nextBoardNavPreviewDelta;
  renderer.updateInteraction?.(interactionState);
};

const shouldClearResetUiStateAfterCommand = (
  commandType: string,
  transition: StateTransition,
  previousSnapshot: GameSnapshot,
): boolean =>
  commandType !== GAME_COMMANDS.RESET_PATH
  && transition.snapshot.version !== previousSnapshot.version
  && (
    transition.rebuildGrid
    || commandType === GAME_COMMANDS.WALL_MOVE_ATTEMPT
    || transition.snapshot.path.length > 1
  );

const shouldClearPathTransitionCompensation = (
  commandType: string,
  isPathStepCommand: boolean,
  transition: StateTransition,
): boolean =>
  commandType === GAME_COMMANDS.RESET_PATH
  || commandType === GAME_COMMANDS.LOAD_LEVEL
  || (!isPathStepCommand && transition.rebuildGrid);

const shouldQueueSessionSaveAfterCommand = (
  commandType: string,
  isPathStepCommand: boolean,
  transition: StateTransition,
  isPathDragging: boolean,
): boolean => {
  const shouldPersistPathStepState = isPathStepCommand && transition.changed && !isPathDragging;
  const shouldPersistInputState = Boolean(transition.validate) && !isPathDragging;
  const shouldPersistResetState = commandType === GAME_COMMANDS.RESET_PATH && transition.changed;
  return shouldPersistPathStepState || shouldPersistInputState || shouldPersistResetState;
};



export function createRuntime(options: RuntimeOptions): RuntimeController {
  const {
    appEl,
    core,
    state,
    persistence,
    renderer,
    input,
    i18n,
    ui,
    dailyHardInvalidateAtUtcMs = null,
    effects = {},
  } = options;

  if (!appEl) throw new Error('createRuntime requires appEl');

  const campaignCount = core.getCampaignLevelCount();
  const maxInfiniteIndex = core.getInfiniteMaxIndex();
  const {
    dailyAbsIndex,
    hasDailyLevel,
    activeDailyId,
    dailyResetUtcMs,
  } = resolveDailyRuntimeConfig(core, dailyHardInvalidateAtUtcMs, campaignCount, maxInfiniteIndex);

  const bootState = persistence.readBootState();

  const progressManager = createProgressManagerTyped(bootState, campaignCount, maxInfiniteIndex, persistence);
  const {
    readCampaignProgress,
    readInfiniteProgress,
    isCampaignCompleted,
    markCampaignLevelCleared,
    markInfiniteLevelCleared,
    isCampaignLevelUnlocked,
  } = progressManager;
  const scoreManager = createScoreManagerTyped(bootState.scoreState, persistence);

  let dailySolvedDate: DailyId = typeof bootState.dailySolvedDate === 'string' ? bootState.dailySolvedDate : null;
  let activeTheme: RuntimeTheme = normalizeTheme(bootState.theme);
  let lowPowerModeEnabled = Boolean(bootState.lowPowerModeEnabled);
  let keyboardGamepadControlsEnabled = Boolean(bootState.keyboardGamepadControlsEnabled);

  const initialLocale = typeof i18n.getLocale === 'function'
    ? i18n.getLocale()
    : i18n.resolveLocale();
  let activeLocale = initialLocale;
  let translate = i18n.createTranslator(activeLocale);
  let localeChangeRequestToken = 0;
  let localeChangeInFlight = false;

  let currentMessageKind: string | null = null;
  let currentMessageHtml = '';
  let lastResetUiState: ResetUiState | null = null;

  let currentLevelCleared = false;
  let currentBoardSolved = false;
  let hasLoadedLevel = false;
  let sessionSaveQueued = false;
  let started = false;
  let destroyed = false;
  let layoutRafId = 0;
  let lowPowerHintRafId = 0;
  let sessionSaveTimerId: ReturnType<typeof globalThis.setTimeout> | 0 = 0;
  let boardResizeObserver: ResizeObserver | null = null;
  let windowResizeHandler: (() => void) | null = null;
  let beforeUnloadPersistHandler: (() => void) | null = null;
  let beforeUnloadObserverCleanupHandler: (() => void) | null = null;

  const interactionState: InteractionState = {
    isPathDragging: false,
    pathDragSide: null,
    pathDragCursor: null,
    pathTipArrivalHint: null,
    isWallDragging: false,
    wallGhost: {
      visible: false,
      x: 0,
      y: 0,
    },
    dropTarget: null,
    isBoardNavActive: false,
    isBoardNavPressing: false,
    boardCursor: null,
    boardSelection: null,
    boardSelectionInteractive: null,
    boardNavPreviewDelta: null,
  };

  let layoutQueued = false;
  let queuedLayoutOptions: LayoutOptions = {};
  let pendingValidate = false;
  let pendingResize = false;
  let pendingValidateSource: ValidationSource = null;
  let settingsMenuOpen = false;
  let dailyCountdownTimer = 0;
  let dailyBoardLocked = false;
  let evaluateCacheBoardVersion = 0;
  const evaluateCache: EvaluateCache = new Map();
  const lowPowerHintDetector: LowPowerHintDetectorState = {
    active: (
      !lowPowerModeEnabled
      && (
        typeof effects.shouldSuggestLowPowerMode === 'function'
        && effects.shouldSuggestLowPowerMode() === true
      )
    ),
    lastFrameTimestamp: 0,
    idleFrameDurationsMs: [],
    dragFrameDurationsMs: [],
    dragActivityFramesRemaining: 0,
  };

  const sessionSaveData: { board: MutableBoardState } = {
    board: cloneBoardState(bootState.sessionBoard),
  };

  let mutableBoardState: MutableBoardState = cloneBoardState(sessionSaveData.board);

  const applyTheme = (theme: RuntimeTheme): void => {
    activeTheme = applyThemeCore(theme, persistence);
  };

  const resetLowPowerHintDetectorWindow = () => {
    lowPowerHintDetector.lastFrameTimestamp = 0;
  };

  const clearLowPowerHintDragSamples = () => {
    lowPowerHintDetector.dragFrameDurationsMs.length = 0;
  };

  const disableLowPowerHintDetector = () => {
    lowPowerHintDetector.active = false;
    if (lowPowerHintRafId) {
      cancelAnimationFrame(lowPowerHintRafId);
      lowPowerHintRafId = 0;
    }
    resetLowPowerHintDetectorWindow();
    lowPowerHintDetector.idleFrameDurationsMs.length = 0;
    clearLowPowerHintDragSamples();
    lowPowerHintDetector.dragActivityFramesRemaining = 0;
  };

  const pushLowPowerHintFrameSample = (samples: number[], frameDurationMs: number): void => {
    samples.push(frameDurationMs);
    if (samples.length > LOW_POWER_HINT_MAX_FRAME_SAMPLES) {
      samples.shift();
    }
  };

  const summarizeFpsWindow = (frameDurationsMs: number[]): LowPowerFpsStats | null => {
    if (!Array.isArray(frameDurationsMs) || frameDurationsMs.length <= 0) return null;
    let totalFrameTimeMs = 0;
    for (const element of frameDurationsMs) {
      totalFrameTimeMs += element;
    }
    const avgFrameTimeMs = totalFrameTimeMs / frameDurationsMs.length;
    if (avgFrameTimeMs <= 0) return null;
    const sortedFrameDurations = [...frameDurationsMs].sort((a, b) => a - b);
    const p99Index = Math.min(
      sortedFrameDurations.length - 1,
      Math.max(0, Math.ceil(sortedFrameDurations.length * 0.99) - 1),
    );
    const p99FrameTimeMs = sortedFrameDurations[p99Index];
    if (p99FrameTimeMs <= 0) return null;
    return {
      avgFrameTimeMs,
      p99FrameTimeMs,
      avgFps: 1000 / avgFrameTimeMs,
      p99Fps: 1000 / p99FrameTimeMs,
    };
  };

  const shouldSuggestLowPowerModeForFps = (
    idleStats: LowPowerFpsStats | null,
    dragStats: LowPowerFpsStats | null,
  ): boolean => {
    if (!idleStats || !dragStats) return false;

    const idleHealthy = (
      idleStats.avgFps >= LOW_POWER_HINT_MIN_IDLE_AVG_FPS
      && idleStats.p99Fps >= LOW_POWER_HINT_MIN_IDLE_P99_FPS
    );
    if (!idleHealthy) return false;

    const dragAvgThreshold = Math.min(
      idleStats.avgFps * LOW_POWER_HINT_AVG_DROP_RATIO,
      LOW_POWER_HINT_MAX_DRAG_AVG_FPS,
    );
    const dragP99Threshold = Math.min(
      idleStats.p99Fps * LOW_POWER_HINT_P99_DROP_RATIO,
      LOW_POWER_HINT_MAX_DRAG_P99_FPS,
    );

    const avgDropFps = idleStats.avgFps - dragStats.avgFps;
    const p99DropFps = idleStats.p99Fps - dragStats.p99Fps;
    const avgDegraded = (
      dragStats.avgFps <= dragAvgThreshold
      && avgDropFps >= LOW_POWER_HINT_MIN_AVG_DROP_FPS
    );
    const p99Degraded = (
      dragStats.p99Fps <= dragP99Threshold
      && p99DropFps >= LOW_POWER_HINT_MIN_P99_DROP_FPS
    );

    return avgDegraded && p99Degraded;
  };

  const markLowPowerHintDragActivity = () => {
    if (!lowPowerHintDetector.active || lowPowerModeEnabled) return;
    lowPowerHintDetector.dragActivityFramesRemaining = Math.max(
      lowPowerHintDetector.dragActivityFramesRemaining,
      LOW_POWER_HINT_DRAG_ACTIVITY_FRAME_BUDGET,
    );
    startLowPowerHintDetector();
  };

  const recordLowPowerHintFrame = (frameTimestamp: number): void => {
    if (!lowPowerHintDetector.active || lowPowerModeEnabled) {
      resetLowPowerHintDetectorWindow();
      return;
    }
    if (!Number.isFinite(frameTimestamp) || frameTimestamp <= 0) return;
    if (lowPowerHintDetector.lastFrameTimestamp <= 0) {
      lowPowerHintDetector.lastFrameTimestamp = frameTimestamp;
      return;
    }

    const frameDurationMs = frameTimestamp - lowPowerHintDetector.lastFrameTimestamp;
    lowPowerHintDetector.lastFrameTimestamp = frameTimestamp;
    if (
      !Number.isFinite(frameDurationMs)
      || frameDurationMs <= 0
      || frameDurationMs > LOW_POWER_HINT_MAX_FRAME_DELTA_MS
    ) {
      return;
    }

    if (lowPowerHintDetector.dragActivityFramesRemaining > 0) {
      lowPowerHintDetector.dragActivityFramesRemaining -= 1;
      pushLowPowerHintFrameSample(lowPowerHintDetector.dragFrameDurationsMs, frameDurationMs);
      if (lowPowerHintDetector.idleFrameDurationsMs.length < LOW_POWER_HINT_MIN_IDLE_SAMPLES) return;
      if (lowPowerHintDetector.dragFrameDurationsMs.length < LOW_POWER_HINT_MIN_DRAG_SAMPLES) return;

      const idleStats = summarizeFpsWindow(lowPowerHintDetector.idleFrameDurationsMs);
      const dragStats = summarizeFpsWindow(lowPowerHintDetector.dragFrameDurationsMs);
      if (!shouldSuggestLowPowerModeForFps(idleStats, dragStats)) return;

      effects.onLowPowerModeSuggestion?.({
        idle: idleStats,
        drag: dragStats,
      });
      disableLowPowerHintDetector();
      return;
    }

    pushLowPowerHintFrameSample(lowPowerHintDetector.idleFrameDurationsMs, frameDurationMs);
  };

  const runLowPowerHintDetector = (frameTimestamp: number): void => {
    lowPowerHintRafId = 0;
    if (!started || destroyed || !lowPowerHintDetector.active || lowPowerModeEnabled) {
      return;
    }
    recordLowPowerHintFrame(frameTimestamp);
    if (!destroyed && lowPowerHintDetector.active && !lowPowerModeEnabled) {
      lowPowerHintRafId = requestAnimationFrame(runLowPowerHintDetector);
    }
  };

  const startLowPowerHintDetector = () => {
    if (!lowPowerHintDetector.active || lowPowerHintRafId || destroyed) return;
    lowPowerHintRafId = requestAnimationFrame(runLowPowerHintDetector);
  };

  const setUiMessage = (kind: string | null, html: string): void => {
    currentMessageKind = kind;
    currentMessageHtml = html;
  };

  const captureResetUiState = (): ResetUiState => ({
    currentLevelCleared,
    currentBoardSolved,
    currentMessageKind,
    currentMessageHtml,
  });

  const clearResetUiState = () => {
    lastResetUiState = null;
  };

  const restoreResetUiState = (savedState: ResetUiState | null): boolean => {
    if (!savedState) return false;

    const nextMessageKind = savedState.currentMessageKind ?? null;
    const nextMessageHtml = typeof savedState.currentMessageHtml === 'string'
      ? savedState.currentMessageHtml
      : '';
    const nextLevelCleared = Boolean(savedState.currentLevelCleared);
    const nextBoardSolved = Boolean(savedState.currentBoardSolved);
    const uiStateChanged = (
      currentLevelCleared !== nextLevelCleared
      || currentBoardSolved !== nextBoardSolved
      || currentMessageKind !== nextMessageKind
      || currentMessageHtml !== nextMessageHtml
    );

    currentLevelCleared = nextLevelCleared;
    currentBoardSolved = nextBoardSolved;
    setUiMessage(nextMessageKind, nextMessageHtml);
    return uiStateChanged;
  };

  const resolveLevelName = (level: { nameKey?: string; name?: string } | null | undefined): string => resolveLevelNameCore(level, translate);

  const applyPanelVisibility = (
    panelEl: ElementLike | null,
    buttonEl: ElementLike | null,
    panel: PanelName,
    isHidden: boolean,
  ): void => {
    if (!panelEl || !buttonEl) return;
    panelEl.classList.toggle('is-hidden', isHidden);
    buttonEl.textContent = isHidden ? translate('ui.show') : translate('ui.hide');
    buttonEl.setAttribute('aria-expanded', String(!isHidden));
    persistence.writeHiddenPanel(panel, isHidden);
  };

  const setSettingsMenuOpen = (isOpen: boolean): void => {
    settingsMenuOpen = Boolean(isOpen);
    const refs = renderer.getRefs();
    if (!refs?.settingsPanel || !refs?.settingsToggle) return;
    refs.settingsPanel.hidden = !settingsMenuOpen;
    refs.settingsToggle.classList.toggle('isOpen', settingsMenuOpen);
    refs.settingsToggle.setAttribute('aria-expanded', String(settingsMenuOpen));
  };

  const refreshThemeButton = () => refreshThemeButtonCore(activeTheme, renderer.getRefs(), translate);
  const setThemeSwitchPrompt = (nextTheme: RuntimeTheme) => setThemeSwitchPromptCore(nextTheme, renderer.getRefs(), translate);
  const requestLightThemeConfirmation = (targetTheme: RuntimeTheme) => requestLightThemeConfirmationCore(targetTheme, renderer.getRefs(), translate);
  const refreshSettingsToggle = () => refreshSettingsToggleCore(renderer.getRefs(), translate);
  const syncLowPowerToggle = () => {
    const refs = renderer.getRefs();
    if (refs?.lowPowerToggle) {
      refs.lowPowerToggle.checked = lowPowerModeEnabled;
    }
  };
  const syncKeyboardGamepadControlsToggle = () => {
    const refs = renderer.getRefs();
    if (refs?.keyboardGamepadToggle) {
      refs.keyboardGamepadToggle.checked = keyboardGamepadControlsEnabled;
    }
  };
  const syncInputSnapshot = (snapshot: GameSnapshot = state.getSnapshot()): void => {
    input.syncSnapshot?.(snapshot);
  };
  const applyLowPowerMode = (enabled: boolean, options: ToggleOptions = {}): void => {
    const nextEnabled = Boolean(enabled);
    const force = Boolean(options.force);
    if (!force && nextEnabled === lowPowerModeEnabled) return;
    lowPowerModeEnabled = nextEnabled;
    if (lowPowerModeEnabled) disableLowPowerHintDetector();
    persistence.writeLowPowerModeEnabled?.(lowPowerModeEnabled);
    syncLowPowerToggle();
    renderer.setLowPowerMode?.(lowPowerModeEnabled);
    if (started && !destroyed && hasLoadedLevel) {
      queueBoardLayout(false, { needsResize: true });
    }
  };
  const applyKeyboardGamepadControlsEnabled = (enabled: boolean, options: ToggleOptions = {}): void => {
    const nextEnabled = Boolean(enabled);
    const force = Boolean(options.force);
    if (!force && nextEnabled === keyboardGamepadControlsEnabled) return;
    keyboardGamepadControlsEnabled = nextEnabled;
    persistence.writeKeyboardGamepadControlsEnabled?.(keyboardGamepadControlsEnabled);
    syncKeyboardGamepadControlsToggle();
    input.setKeyboardGamepadControlsEnabled?.(keyboardGamepadControlsEnabled);
    input.setBoardControlSuppressed?.(dailyBoardLocked);
    if (keyboardGamepadControlsEnabled) {
      syncInputSnapshot();
    }
  };
  const debugDailyFreeze: DebugDailyFreezeController | null = isTetherDevRuntime()
    ? createDebugDailyFreezeDev({
      getLocked: () => dailyBoardLocked,
      renderDailyMeta: () => renderDailyMeta(),
      applyDailyBoardLockState: (snapshot) => applyDailyBoardLockState(snapshot),
      readSnapshot: () => state.getSnapshot(),
      queueBoardLayout: (immediate, payload) => queueBoardLayout(immediate, payload),
      interactionState,
    })
    : null;

  const isDailyExpired = (): boolean =>
    Boolean(debugDailyFreeze?.isForced())
    || (typeof dailyResetUtcMs === 'number' && Number.isInteger(dailyResetUtcMs) && Date.now() >= dailyResetUtcMs);

  const applyDailyBoardLockState = (snapshot: GameSnapshot | null = null): boolean => {
    const refs = renderer.getRefs();
    const activeSnapshot = snapshot || state.getSnapshot();
    const isDailySnapshot = Boolean(
      activeSnapshot
      && Number.isInteger(activeSnapshot.levelIndex)
      && typeof core.isDailyAbsIndex === 'function'
      && core.isDailyAbsIndex(activeSnapshot.levelIndex),
    );
    const nextLocked = Boolean(
      hasDailyLevel
      && activeDailyId
      && isDailySnapshot
      && isDailyExpired()
    );

    const changed = nextLocked !== dailyBoardLocked;
    dailyBoardLocked = nextLocked;
    input.setBoardControlSuppressed?.(dailyBoardLocked);

    if (nextLocked) {
      interactionState.isPathDragging = false;
      interactionState.pathDragSide = null;
      interactionState.pathDragCursor = null;
      interactionState.pathTipArrivalHint = null;
      interactionState.isWallDragging = false;
      interactionState.wallGhost = { visible: false, x: 0, y: 0 };
      interactionState.dropTarget = null;
      renderer.updateInteraction?.(interactionState);
    }

    if (refs?.boardWrap) refs.boardWrap.classList.toggle('isDailyLocked', nextLocked);
    if (refs?.gridEl) refs.gridEl.setAttribute('aria-disabled', String(nextLocked));
    if (refs?.resetBtn) refs.resetBtn.disabled = nextLocked;
    if (refs?.reverseBtn) refs.reverseBtn.disabled = nextLocked;

    return changed;
  };

  const clearDailyCountdownTimer = (): void => {
    if (!dailyCountdownTimer) return;
    clearInterval(dailyCountdownTimer);
    dailyCountdownTimer = 0;
  };

  const renderDailyMeta = (): void => {
    const refs = renderer.getRefs();
    if (!refs?.dailyMeta || !refs?.dailyDateValue || !refs?.dailyCountdownValue) return;
    const activeSnapshot = state.getSnapshot();
    const isDailySnapshot = Boolean(
      activeSnapshot
      && Number.isInteger(activeSnapshot.levelIndex)
      && isDailyLevelIndex(activeSnapshot.levelIndex),
    );

    if (!hasDailyLevel || !activeDailyId || !isDailySnapshot) {
      refs.dailyMeta.hidden = true;
      refs.dailyDateValue.textContent = '-';
      refs.dailyCountdownValue.textContent = formatCountdownHms(0, activeLocale);
      return;
    }

    refs.dailyMeta.hidden = false;
    refs.dailyDateValue.textContent = formatDailyDateLabel(activeDailyId, activeLocale);

    const resetUtcMs = typeof dailyResetUtcMs === 'number' && Number.isInteger(dailyResetUtcMs)
      ? dailyResetUtcMs
      : null;
    if (resetUtcMs === null) {
      refs.dailyCountdownValue.textContent = formatCountdownHms(0, activeLocale);
      return;
    }

    const remainingMs = resetUtcMs - Date.now();
    refs.dailyCountdownValue.textContent = remainingMs <= 0
      ? translate('ui.dailyResetNow')
      : formatCountdownHms(remainingMs, activeLocale);
  };

  const startDailyCountdown = (): void => {
    clearDailyCountdownTimer();
    const syncDailyUi = () => {
      renderDailyMeta();
      const lockChanged = applyDailyBoardLockState(state.getSnapshot());
      if (lockChanged) {
        queueBoardLayout(false, {
          isPathDragging: false,
          pathDragSide: null,
          pathDragCursor: null,
        });
      }
    };
    syncDailyUi();
    if (!hasDailyLevel || !activeDailyId || !Number.isInteger(dailyResetUtcMs)) return;
    dailyCountdownTimer = window.setInterval(() => {
      syncDailyUi();
    }, 1000);
  };

  const isDailyLevelIndex = (levelIndex: number): boolean =>
    typeof core.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex);

  const resolveNextButtonLabel = (levelIndex: number): string => {
    if (isDailyLevelIndex(levelIndex)) {
      return translate('ui.dailyComplete');
    }
    if (core.isInfiniteAbsIndex(levelIndex)) {
      if (core.toInfiniteIndex(levelIndex) >= maxInfiniteIndex) return translate('ui.infiniteComplete');
      return translate('ui.nextInfinite');
    }
    if (levelIndex >= campaignCount - 1 && isCampaignCompleted()) return translate('ui.startInfinite');
    return translate('ui.nextLevel');
  };

  const resolveInfiniteModeLabel = (): string => {
    const raw = translate('ui.infiniteLevelOption', { n: '' });
    return raw.replace(/\s*#\s*$/, '').trim();
  };

  const resolveCampaignBuckets = (): LevelBuckets => {
    const tutorialIndices: number[] = [];
    const practiceIndices: number[] = [];

    for (let i = 0; i < campaignCount; i += 1) {
      const level = core.getLevel(i);
      const nameKey = typeof level?.nameKey === 'string' ? level.nameKey : '';
      if (nameKey.startsWith('level.tutorial_')) {
        tutorialIndices.push(i);
      } else if (nameKey.startsWith('level.pilot_')) {
        practiceIndices.push(i);
      }
    }

    return { tutorialIndices, practiceIndices };
  };

  const resolveLatestUnlockedCampaignBucketIndex = (indices: number[]): number | null => {
    if (!Array.isArray(indices) || indices.length === 0) return null;

    let latestUnlockedIndex = indices[0];
    for (const element of indices) {
      const levelIndex = element;
      if (!isCampaignLevelUnlocked(levelIndex)) break;
      latestUnlockedIndex = levelIndex;
    }

    return latestUnlockedIndex;
  };

  const renderScoreMeta = () => {
    renderScoreMetaCore({
      refs: renderer.getRefs(),
      snapshot: state.getSnapshot(),
      isDailyLevelIndex,
      core,
      scoreManager,
      activeDailyId,
      translate,
    });
  };

  const registerSolvedScore = (snapshot: GameSnapshot): ScoreRegistrationResult | null => {
    const result = registerSolvedSnapshotTyped({
      snapshot,
      core,
      scoreManager,
    });
    renderScoreMeta();
    return result;
  };

  const appendScoreToCompletionMessage = (
    baseMessage: string,
    scoreResult: ScoreRegistrationResult | null,
  ): string => {
    if (!scoreResult) return baseMessage;
    const modeLabel = scoreResult.mode === SCORE_MODES.INFINITE
      ? resolveInfiniteModeLabel()
      : translate('ui.dailyLevelOption');
    return `${baseMessage}<br><b>${modeLabel}: +${scoreResult.awarded}</b> (${scoreResult.modeTotal})`;
  };

  const setDisabledReasonTitle = (buttonEl: ElementLike | null, reasonKey: string | null): void => {
    if (!buttonEl) return;
    if (reasonKey) {
      buttonEl.setAttribute('title', translate(reasonKey));
      return;
    }
    buttonEl.removeAttribute('title');
  };

  const isNextLevelAvailable = (levelIndex: number): boolean => {
    if (isDailyLevelIndex(levelIndex)) return false;

    if (core.isInfiniteAbsIndex(levelIndex)) {
      const infiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex));
      if (infiniteIndex >= maxInfiniteIndex) return false;
      const latestUnlockedInfiniteIndex = core.clampInfiniteIndex(readInfiniteProgress());
      return infiniteIndex + 1 <= latestUnlockedInfiniteIndex;
    }

    const nextCampaignIndex = levelIndex + 1;
    if (nextCampaignIndex < campaignCount) return true;
    return isCampaignCompleted();
  };

  const isLevelPreviouslyCleared = (levelIndex: number): boolean => {
    if (isDailyLevelIndex(levelIndex)) {
      return Boolean(activeDailyId) && activeDailyId === dailySolvedDate;
    }

    if (core.isInfiniteAbsIndex(levelIndex)) {
      const infiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(levelIndex));
      return infiniteIndex < core.clampInfiniteIndex(readInfiniteProgress());
    }
    return levelIndex < readCampaignProgress();
  };

  const collectLevelMovableWalls = (grid: unknown): GridTuple[] => {
    if (!Array.isArray(grid)) return [];
    const movableWalls: GridTuple[] = [];
    for (let r = 0; r < grid.length; r += 1) {
      const row = grid[r];
      if (typeof row !== 'string') continue;
      for (let c = 0; c < row.length; c += 1) {
        if (row[c] === 'm') movableWalls.push([r, c]);
      }
    }
    return movableWalls;
  };

  const coordinateListsMatch = (
    left: GridTuple[] | null | undefined,
    right: GridTuple[] | null | undefined,
  ): boolean => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      const leftPoint = left[i];
      const rightPoint = right[i];
      if (!Array.isArray(leftPoint) || !Array.isArray(rightPoint)) return false;
      if (leftPoint[0] !== rightPoint[0] || leftPoint[1] !== rightPoint[1]) return false;
    }
    return true;
  };

  const hasMeaningfulSessionProgress = (boardState: MutableBoardState): boolean => {
    if (!boardState || !Number.isInteger(boardState.levelIndex)) return false;
    if (Array.isArray(boardState.path) && boardState.path.length > 0) return true;

    const level = core.getLevel(boardState.levelIndex);
    if (!level || !Array.isArray(level.grid)) return false;

    const baseMovableWalls = collectLevelMovableWalls(level.grid);
    const movableWalls = Array.isArray(boardState.movableWalls)
      ? boardState.movableWalls
      : baseMovableWalls;

    return !coordinateListsMatch(movableWalls, baseMovableWalls);
  };

  const shouldPreserveExistingSessionBoard = (nextBoardState: SessionBoardState | null): boolean => {
    if (!nextBoardState || !mutableBoardState) return false;
    if (mutableBoardState.levelIndex === nextBoardState.levelIndex) return false;
    if (!hasMeaningfulSessionProgress(mutableBoardState)) return false;
    return !hasMeaningfulSessionProgress(nextBoardState);
  };

  const syncMutableBoardStateFromSnapshot = (snapshot: GameSnapshot): boolean => {
    if (!snapshot || !Number.isInteger(snapshot.levelIndex)) return false;

    const level = core.getLevel(snapshot.levelIndex);
    if (!level || !Array.isArray(level.grid)) return false;

    const serialized = buildSessionBoardFromSnapshotTyped({
      snapshot,
      activeDailyId,
      isDailyLevelIndex,
    });
    if (!serialized) return false;
    if (shouldPreserveExistingSessionBoard(serialized)) return true;
    mutableBoardState = serialized;
    return true;
  };

  const persistSessionSave = () => {
    const snapshot = state.getSnapshot();
    const didSync = syncMutableBoardStateFromSnapshot(snapshot);
    if (
      !didSync
      && mutableBoardState
      && mutableBoardState.levelIndex === snapshot.levelIndex
    ) {
      mutableBoardState = null;
    }

    if (!mutableBoardState) {
      persistence.clearSessionBoard();
      return;
    }

    const board = cloneBoardState(mutableBoardState);
    if (!board) return;
    persistence.writeSessionBoard(board);
  };

  const queueSessionSave = () => {
    if (destroyed || sessionSaveQueued) return;
    sessionSaveQueued = true;
    sessionSaveTimerId = globalThis.setTimeout(() => {
      sessionSaveTimerId = 0;
      if (destroyed) {
        sessionSaveQueued = false;
        return;
      }
      sessionSaveQueued = false;
      persistSessionSave();
    }, 150);
  };

  const syncInfiniteNavigation = (levelIndex: number, isCleared = false): void => {
    syncInfiniteNavigationCore({
      refs: renderer.getRefs(),
      levelIndex,
      isCleared,
      isDailyLevelIndex,
      core,
      maxInfiniteIndex,
      setDisabledReasonTitle,
      isNextLevelAvailable,
      resolveNextButtonLabel,
    });
  };

  const onLevelCleared = (levelIndex: number): void => {
    const { nextDailySolvedDate, changedDailySolvedDate } = markClearedLevelTyped({
      levelIndex,
      core,
      activeDailyId,
      dailySolvedDate,
      onCampaignCleared: (campaignLevelIndex: number) => {
        markCampaignLevelCleared(campaignLevelIndex);
      },
      onInfiniteCleared: (infiniteLevelIndex: number) => {
        markInfiniteLevelCleared(infiniteLevelIndex);
      },
      onDailyCleared: (dailyId: string) => {
        persistence.writeDailySolvedDate(dailyId);
      },
    });
    dailySolvedDate = nextDailySolvedDate;
    if (changedDailySolvedDate) {
      effects.onDailySolvedDateChanged?.(nextDailySolvedDate);
    }
    currentBoardSolved = true;
    mutableBoardState = null;
    queueSessionSave();
  };

  const refreshLevelOptions = (): void => {
    refreshLevelOptionsCore({
      refs: renderer.getRefs(),
      currentIndex: state.getSnapshot().levelIndex,
      dailyAbsIndex,
      hasDailyLevel,
      activeDailyId,
      activeLocale,
      translate,
      core,
      maxInfiniteIndex,
      readInfiniteProgress,
      isCampaignLevelUnlocked,
      resolveCampaignBuckets,
      resolveLatestUnlockedCampaignBucketIndex,
      resolveInfiniteModeLabel,
      resolveLevelName,
      isDailyLevelIndex,
    });
  };

  const showLevelGoal = (levelIndex: number): boolean => {
    const refs = renderer.getRefs();
    const nextLevelCleared = isLevelPreviouslyCleared(levelIndex);
    const nextMessageHtml = core.goalText(levelIndex, translate);
    const uiStateChanged = (
      currentLevelCleared !== nextLevelCleared
      || currentBoardSolved
      || currentMessageKind !== null
      || currentMessageHtml !== nextMessageHtml
    );

    currentLevelCleared = nextLevelCleared;
    currentBoardSolved = false;
    setUiMessage(null, nextMessageHtml);

    if (refs?.nextLevelBtn) {
      refs.nextLevelBtn.textContent = resolveNextButtonLabel(levelIndex);
      refs.nextLevelBtn.hidden = false;
    }
    if (refs?.prevInfiniteBtn) refs.prevInfiniteBtn.hidden = true;
    syncInfiniteNavigation(levelIndex, currentLevelCleared);
    return uiStateChanged;
  };

  const resolveDraggedHintSuppressionKey = (snapshot: GameSnapshot): string | null => {
    if (!interactionState.isPathDragging) return null;
    const side = interactionState.pathDragSide;
    if (side !== 'start' && side !== 'end') return null;
    if (snapshot.path.length === 0) return null;

    const endpoint = side === 'start'
      ? snapshot.path[0]
      : snapshot.path[snapshot.path.length - 1];
    if (!endpoint) return null;

    return `${endpoint.r},${endpoint.c}`;
  };

  const isPathDragCursorOnActiveEndpoint = (
    snapshot: GameSnapshot,
    isPathDragging: boolean,
    pathDragSide: PathDragSide,
    pathDragCursor: NullableGridPoint,
  ): boolean => {
    if (!isPathDragging) return false;
    const side = pathDragSide;
    if (side !== 'start' && side !== 'end') return false;
    if (!snapshot || snapshot.path.length === 0) return false;

    const endpoint = side === 'start'
      ? snapshot.path[0]
      : snapshot.path[snapshot.path.length - 1];
    return Boolean(endpoint)
      && !!pathDragCursor
      && endpoint.r === pathDragCursor.r
      && endpoint.c === pathDragCursor.c;
  };

  const resolveDragSequenceTipArrivalHint = (
    side: PathDragSide,
    prevSnapshot: GameSnapshot,
    nextSnapshot: GameSnapshot,
    payload: PathStepPayload | null | undefined,
  ): PathTipArrivalHint | null => {
    return resolveDragSequenceTipArrivalHintCore(side, prevSnapshot, nextSnapshot, payload);
  };

  const buildPathTipArrivalHint = (
    commandType: string,
    payload: PathStepPayload | null | undefined,
    prevSnapshot: GameSnapshot | null | undefined,
    nextSnapshot: GameSnapshot | null | undefined,
  ): PathTipArrivalHint | null => {
    const side = resolvePathStepCommandSide(commandType, payload);
    if (!side || !prevSnapshot || !nextSnapshot) return null;

    if (commandType === GAME_COMMANDS.APPLY_PATH_DRAG_SEQUENCE) {
      return resolveDragSequenceTipArrivalHint(side, prevSnapshot, nextSnapshot, payload);
    }

    const prevPath = Array.isArray(prevSnapshot.path) ? prevSnapshot.path : [];
    const nextPath = Array.isArray(nextSnapshot.path) ? nextSnapshot.path : [];
    if (prevPath.length <= 0 || nextPath.length <= 0) return null;

    const prevTip = readPathEndpointForSide(prevPath, side);
    const nextTip = readPathEndpointForSide(nextPath, side);
    if (!prevTip || !nextTip) return null;
    if (prevTip.r === nextTip.r && prevTip.c === nextTip.c) return null;

    return {
      side,
      from: { r: prevTip.r, c: prevTip.c },
      to: { r: nextTip.r, c: nextTip.c },
    };
  };

  const invalidateEvaluateCache = (): void => {
    evaluateCacheBoardVersion += 1;
    evaluateCache.clear();
  };

  const buildEvaluateCacheKey = (snapshot: GameSnapshot, evaluateOptions: EvaluateOptions = {}): string => {
    const suppressEndpointRequirement = evaluateOptions.suppressEndpointRequirement ? '1' : '0';
    const suppressEndpointKey = typeof evaluateOptions.suppressEndpointKey === 'string'
      ? evaluateOptions.suppressEndpointKey
      : '';
    return `${evaluateCacheBoardVersion}|${suppressEndpointRequirement}|${suppressEndpointKey}|${snapshot.pathKey || ''}`;
  };

  const evaluateSnapshot = (
    snapshot: GameSnapshot,
    evaluateOptions: EvaluateOptions = {},
    useCache = false,
  ): EvaluateResult => {
    if (!useCache) return core.evaluate(snapshot, evaluateOptions);
    const cacheKey = buildEvaluateCacheKey(snapshot, evaluateOptions);
    const cached = evaluateCache.get(cacheKey);
    if (cached) {
      evaluateCache.delete(cacheKey);
      evaluateCache.set(cacheKey, cached);
      return cached;
    }

    const result = core.evaluate(snapshot, evaluateOptions);
    evaluateCache.set(cacheKey, result);
    if (evaluateCache.size > EVALUATE_CACHE_LIMIT) {
      const oldestKey = evaluateCache.keys().next().value;
      if (typeof oldestKey === 'string') {
        evaluateCache.delete(oldestKey);
      }
    }
    return result;
  };

  const renderSnapshot = (
    snapshot: GameSnapshot,
    evaluation: EvaluateResult,
    completion: CompletionResult | null = null,
    options: RenderSnapshotOptions = {},
  ): void => {
    const completionAnimationTrigger = Boolean(options.completionAnimationTrigger);
    renderer.renderFrame({
      snapshot,
      evaluation,
      completion,
      uiModel: {
        messageKind: currentMessageKind,
        messageHtml: currentMessageHtml,
        isBoardSolved: currentBoardSolved,
        completionAnimationTrigger,
        tutorialFlags: {
          path: snapshot.levelIndex === PATH_BRACKET_TUTORIAL_LEVEL_INDEX,
          movable: snapshot.levelIndex === MOVABLE_BRACKET_TUTORIAL_LEVEL_INDEX,
        },
      },
      interactionModel: {
        isDailyLocked: dailyBoardLocked,
        isPathDragging: interactionState.isPathDragging,
        pathDragSide: interactionState.pathDragSide,
        pathDragCursor: interactionState.pathDragCursor,
        pathTipArrivalHint: interactionState.pathTipArrivalHint,
        isWallDragging: interactionState.isWallDragging,
        wallGhost: interactionState.wallGhost,
        dropTarget: interactionState.dropTarget,
        isBoardNavActive: interactionState.isBoardNavActive,
        isBoardNavPressing: interactionState.isBoardNavPressing,
        boardCursor: interactionState.boardCursor,
        boardSelection: interactionState.boardSelection,
        boardSelectionInteractive: interactionState.boardSelectionInteractive,
        boardNavPreviewDelta: interactionState.boardNavPreviewDelta,
      },
    });
  };

  const refresh = (snapshot: GameSnapshot, validate = false, options: LayoutOptions = {}): void => {
    const draggedHintSuppressionKey = resolveDraggedHintSuppressionKey(snapshot);
    const evaluateOptions: EvaluateOptions = {
      suppressEndpointRequirement: Boolean(draggedHintSuppressionKey),
      ...(draggedHintSuppressionKey ? { suppressEndpointKey: draggedHintSuppressionKey } : {}),
    };
    const shouldUseEvaluateCache = Boolean(interactionState.isPathDragging);
    const evaluateResult = evaluateSnapshot(snapshot, evaluateOptions, shouldUseEvaluateCache);

    let completion: CompletionResult | null = null;
    if (validate) {
      completion = core.checkCompletion(snapshot, evaluateResult, translate);
      if (completion.kind === 'good') {
        const scoreResult = registerSolvedScore(snapshot);
        onLevelCleared(snapshot.levelIndex);
        setUiMessage(completion.kind, appendScoreToCompletionMessage(completion.message, scoreResult));
      } else {
        setUiMessage(null, core.goalText(snapshot.levelIndex, translate));
      }

      currentBoardSolved = completion.kind === 'good';
      currentLevelCleared = currentBoardSolved || isLevelPreviouslyCleared(snapshot.levelIndex);
      syncInfiniteNavigation(snapshot.levelIndex, currentLevelCleared);
      if (completion.kind === 'good') {
        refreshLevelOptions();
      }
    }

    applyDailyBoardLockState(snapshot);

    const completionAnimationTrigger = Boolean(
      completion?.kind === 'good'
      && options.validationSource === GAME_COMMANDS.FINALIZE_PATH,
    );
    renderSnapshot(snapshot, evaluateResult, completion, {
      completionAnimationTrigger,
    });
  };

  const runBoardLayout = (validate = false, options: LayoutOptions = {}): void => {
    if (destroyed) return;
    const snapshot = state.getSnapshot();
    if (options.needsResize) renderer.resize();
    refresh(snapshot, validate, options);
    interactionState.pathTipArrivalHint = null;
  };

  const queueBoardLayout = (validate = false, optionsForInteraction: LayoutOptions = {}): void => {
    if (destroyed) return;
    queuedLayoutOptions = {
      ...queuedLayoutOptions,
      ...optionsForInteraction,
    };

    if (Object.hasOwn(queuedLayoutOptions, 'isPathDragging')) {
      interactionState.isPathDragging = Boolean(queuedLayoutOptions.isPathDragging);
    }
    if (Object.hasOwn(queuedLayoutOptions, 'pathDragSide')) {
      interactionState.pathDragSide = queuedLayoutOptions.pathDragSide ?? null;
    }
    if (Object.hasOwn(queuedLayoutOptions, 'pathDragCursor')) {
      interactionState.pathDragCursor = queuedLayoutOptions.pathDragCursor ?? null;
    }

    if (validate) {
      pendingValidateSource = optionsForInteraction.validationSource || null;
    }
    pendingValidate = pendingValidate || Boolean(validate);
    pendingResize = pendingResize || Boolean(optionsForInteraction.needsResize);
    if (layoutQueued) return;
    layoutQueued = true;
    layoutRafId = requestAnimationFrame(() => {
      layoutRafId = 0;
      if (destroyed) {
        layoutQueued = false;
        pendingValidate = false;
        pendingResize = false;
        pendingValidateSource = null;
        queuedLayoutOptions = {};
        return;
      }
      layoutQueued = false;
      const shouldValidate = pendingValidate;
      const needsResize = pendingResize;
      const validationSource = pendingValidateSource;
      pendingValidate = false;
      pendingResize = false;
      pendingValidateSource = null;
      queuedLayoutOptions = {};
      runBoardLayout(shouldValidate, { validationSource, needsResize });
    });
  };

  const loadLevel = (idx: unknown, options: LoadLevelOptions = {}): void => {
    const suppressFrozenTransition = Boolean(options.suppressFrozenTransition);
    const targetIndex = normalizeLoadLevelTargetIndex(idx, {
      isDailyLevelIndex,
      hasDailyLevel,
      dailyAbsIndex,
      core,
      campaignCount,
    });
    if (typeof targetIndex !== 'number' || !Number.isInteger(targetIndex)) {
      refreshLevelOptions();
      return;
    }

    if (hasLoadedLevel) {
      syncMutableBoardStateFromSnapshot(state.getSnapshot());
    }

    renderer.clearPathTransitionCompensation?.();

    const transition = state.dispatch({
      type: 'level/load',
      payload: { levelIndex: targetIndex },
    });

    const savedBoardState = mutableBoardState && mutableBoardState.levelIndex === targetIndex
      ? mutableBoardState
      : null;

    if (savedBoardState) {
      const restored = state.restoreMutableState(savedBoardState);
      if (!restored) {
        mutableBoardState = null;
      }
    }

    const snapshot = state.getSnapshot();
    if (transition.rebuildGrid) {
      invalidateEvaluateCache();
      renderer.rebuildGrid(snapshot);
    }

    showLevelGoal(targetIndex);
    applyDailyBoardLockState(snapshot);
    if (suppressFrozenTransition && typeof renderer.setPathFlowFreezeImmediate === 'function') {
      renderer.setPathFlowFreezeImmediate(dailyBoardLocked);
    }
    syncMutableBoardStateFromSnapshot(snapshot);
    syncInputSnapshot(snapshot);
    refreshLevelOptions();
    renderScoreMeta();
    renderDailyMeta();
    queueBoardLayout(false, { needsResize: true });
    queueSessionSave();
    hasLoadedLevel = true;
  };

  const refreshStaticUiText = (opts: UiTextRefreshOptions = {}): void => {
    const refs = renderer.getRefs();
    const locale = opts.locale || activeLocale;
    const languageSelectorDisabled = opts.languageSelectorDisabled ?? localeChangeInFlight;

    document.documentElement.lang = locale;
    applyTextDirection(locale);
    activeLocale = locale;
    translate = i18n.createTranslator(activeLocale);

    if (refs.langSel) {
      refs.langSel.innerHTML = buildLocaleOptionList(
        i18n.getLocaleOptions(activeLocale),
        activeLocale,
      );
      refs.langSel.value = activeLocale;
      refs.langSel.disabled = languageSelectorDisabled;
    }

    refreshLevelOptions();
    renderScoreMeta();

    applyDataAttributes(appEl, translate);
    renderDailyMeta();
    applyDailyBoardLockState(state.getSnapshot());
    applyPanelVisibility(
      refs.guidePanel,
      refs.guideToggleBtn,
      'guide',
      refs.guidePanel?.classList.contains?.('is-hidden') === true,
    );
    applyPanelVisibility(
      refs.legendPanel,
      refs.legendToggleBtn,
      'legend',
      refs.legendPanel?.classList.contains?.('is-hidden') === true,
    );

    const index = state.getSnapshot().levelIndex;
    showLevelGoal(index);

    if (refs.legend) {
      refs.legend.innerHTML = ui.buildLegendTemplate(
        ui.badgeDefinitions,
        ui.icons,
        ui.iconX,
        translate,
      );
    }

    if (refs.themeSwitchMessage && refs.themeSwitchDialog) {
      const pendingTheme = refs.themeSwitchDialog.dataset.pendingTheme;
      if (pendingTheme === 'light' || pendingTheme === 'dark') {
        setThemeSwitchPrompt(pendingTheme);
      } else {
        setThemeSwitchPrompt(activeTheme === 'dark' ? 'light' : 'dark');
      }
    }

    refreshThemeButton();
    refreshSettingsToggle();
    syncLowPowerToggle();
    syncKeyboardGamepadControlsToggle();
  };

  const applyLocaleChange = async (locale: string): Promise<void> => {
    const nextLocale = i18n.resolveLocale(locale);
    if (!nextLocale || nextLocale === activeLocale) {
      refreshStaticUiText({ locale: activeLocale });
      return;
    }

    const requestToken = ++localeChangeRequestToken;
    localeChangeInFlight = true;
    refreshStaticUiText({ locale: activeLocale, languageSelectorDisabled: true });

    try {
      const resolvedLocale = await i18n.setLocale(nextLocale);
      if (requestToken !== localeChangeRequestToken) return;
      localeChangeInFlight = false;
      refreshStaticUiText({ locale: resolvedLocale, languageSelectorDisabled: false });
      queueBoardLayout(true, {
        isPathDragging: interactionState.isPathDragging,
        pathDragSide: interactionState.pathDragSide,
        pathDragCursor: interactionState.pathDragCursor,
        needsResize: true,
      });
    } catch {
      if (requestToken !== localeChangeRequestToken) return;
      localeChangeInFlight = false;
      refreshStaticUiText({ locale: activeLocale, languageSelectorDisabled: false });
    }
  };

  const applyThemeState = (nextTheme: RuntimeTheme): void => {
    applyTheme(nextTheme);
    refreshThemeButton();
    queueBoardLayout(false, { needsResize: true });
  };

  const handleSecondaryLevelSelect = (selectedValue: string): void => {
    const snapshot = state.getSnapshot();
    if (!core.isInfiniteAbsIndex(snapshot.levelIndex)) {
      if (isDailyLevelIndex(snapshot.levelIndex)) {
        refreshLevelOptions();
        return;
      }
      const targetCampaignIndex = resolveCampaignSecondarySelection({
        selectedValue,
        snapshot,
        campaignCount,
        isCampaignLevelUnlocked,
      });
      if (!Number.isInteger(targetCampaignIndex)) {
        refreshLevelOptions();
        return;
      }
      loadLevel(targetCampaignIndex);
      return;
    }

    const currentInfiniteIndex = core.clampInfiniteIndex(core.toInfiniteIndex(snapshot.levelIndex));
    const latestUnlockedInfiniteIndex = Math.max(
      core.clampInfiniteIndex(readInfiniteProgress()),
      currentInfiniteIndex,
    );
    const currentPageStart = Math.floor(currentInfiniteIndex / INFINITE_PAGE_SIZE) * INFINITE_PAGE_SIZE;

    const targetInfiniteIndex = resolveInfiniteSecondarySelection({
      selectedValue,
      currentInfiniteIndex,
      currentPageStart,
      latestUnlockedInfiniteIndex,
      core,
    });
    if (typeof targetInfiniteIndex !== 'number' || !Number.isInteger(targetInfiniteIndex)) {
      refreshLevelOptions();
      return;
    }

    const clampedTarget = Math.min(Math.max(targetInfiniteIndex, 0), latestUnlockedInfiniteIndex);
    if (clampedTarget === currentInfiniteIndex) {
      refreshLevelOptions();
      return;
    }

    loadLevel(core.ensureInfiniteAbsIndex(clampedTarget));
  };

  const uiActionHandlers: Record<string, (payload: UiActionPayload) => void> = {
    [UI_ACTIONS.LEVEL_SELECT]: (payload: UiActionPayload) => {
      loadLevel(payload.value, {
        suppressFrozenTransition: Boolean(payload?.suppressFrozenTransition),
      });
    },
    [UI_ACTIONS.INFINITE_SELECT]: (payload: UiActionPayload) => {
      handleSecondaryLevelSelect(String(payload.value ?? ''));
    },
    [UI_ACTIONS.LOCALE_CHANGE]: (payload: UiActionPayload) => {
      setSettingsMenuOpen(false);
      void applyLocaleChange(String(payload.value ?? ''));
    },
    [UI_ACTIONS.THEME_TOGGLE]: () => {
      handleThemeToggleAction({
        setSettingsMenuOpen,
        readActiveTheme: () => activeTheme,
        requestLightThemeConfirmation,
        applyThemeState,
      });
    },
    [UI_ACTIONS.LOW_POWER_TOGGLE]: (payload: UiActionPayload) => {
      applyLowPowerMode(Boolean(payload.enabled));
    },
    [UI_ACTIONS.KEYBOARD_GAMEPAD_CONTROLS_TOGGLE]: (payload: UiActionPayload) => {
      applyKeyboardGamepadControlsEnabled(Boolean(payload.enabled));
    },
    [UI_ACTIONS.THEME_DIALOG_CLOSE]: (payload: UiActionPayload) => {
      handleThemeDialogCloseAction({
        refs: renderer.getRefs(),
        pendingTheme: payload.pendingTheme ?? null,
        returnValue: payload.returnValue,
        applyThemeState,
      });
    },
    [UI_ACTIONS.SETTINGS_TOGGLE]: () => {
      setSettingsMenuOpen(!settingsMenuOpen);
    },
    [UI_ACTIONS.SETTINGS_CLOSE]: () => {
      setSettingsMenuOpen(false);
    },
    [UI_ACTIONS.DOCUMENT_ESCAPE]: () => {
      setSettingsMenuOpen(false);
    },
    [UI_ACTIONS.PANEL_TOGGLE]: (payload: UiActionPayload) => {
      handlePanelToggleAction({
        refs: renderer.getRefs(),
        panel: payload.panel,
        applyPanelVisibility,
        queueBoardLayout,
      });
    },
    [UI_ACTIONS.RESET_CLICK]: () => {
      if (dailyBoardLocked) return;
      handleGameCommand({ commandType: GAME_COMMANDS.RESET_PATH });
    },
    [UI_ACTIONS.REVERSE_CLICK]: () => {
      if (dailyBoardLocked) return;
      handleGameCommand({ commandType: GAME_COMMANDS.REVERSE_PATH });
    },
    [UI_ACTIONS.NEXT_LEVEL_CLICK]: () => {
      handleNextLevelClickAction({
        state,
        isDailyLevelIndex,
        core,
        maxInfiniteIndex,
        readInfiniteProgress,
        campaignCount,
        isCampaignCompleted,
        loadLevel,
      });
    },
    [UI_ACTIONS.PREV_INFINITE_CLICK]: () => {
      handlePrevInfiniteClickAction({
        state,
        core,
        loadLevel,
      });
    },
  };

  const handleUiAction = (payload: UiActionPayload): void => {
    const actionType = payload?.actionType;
    if (!actionType) return;
    const actionHandler = uiActionHandlers[actionType] || null;
    if (actionHandler) actionHandler(payload);
  };

  const interactionUpdateHandlers: Record<string, (payload: InteractionUpdatePayload) => void> = {
    [INTERACTION_UPDATES.PATH_DRAG]: (payload: InteractionUpdatePayload) => {
      handlePathDragInteractionUpdate({
        payload,
        interactionState,
        state,
        renderer,
        queueBoardLayout,
        evaluateCache,
        isPathDragCursorOnActiveEndpoint,
        resetLowPowerHintDetectorWindow,
        markLowPowerHintDragActivity,
      });
    },
    [INTERACTION_UPDATES.WALL_DRAG]: (payload: InteractionUpdatePayload) => {
      handleWallDragInteractionUpdate({
        payload,
        interactionState,
        renderer,
      });
    },
    [INTERACTION_UPDATES.WALL_DROP_TARGET]: (payload: InteractionUpdatePayload) => {
      handleWallDropTargetInteractionUpdate({
        payload,
        interactionState,
        renderer,
      });
    },
    [INTERACTION_UPDATES.BOARD_NAV]: (payload: InteractionUpdatePayload) => {
      handleBoardNavInteractionUpdate({
        payload,
        interactionState,
        renderer,
      });
    },
  };

  const handleInteractionUpdate = (payload: InteractionUpdatePayload): void => {
    const updateType = payload?.updateType;
    if (dailyBoardLocked && updateType !== INTERACTION_UPDATES.BOARD_NAV) return;
    if (!updateType) return;

    const updateHandler = interactionUpdateHandlers[updateType] || null;
    if (updateHandler) updateHandler(payload);
  };

  const handleResetGameCommandUiState = (commandType: string, transition: StateTransition): boolean => {
    if (commandType !== GAME_COMMANDS.RESET_PATH) return false;

    const resetMode = transition.meta?.resetMode || null;
    if (resetMode === 'cleared') {
      if (transition.meta?.storedResetCandidate) {
        lastResetUiState = captureResetUiState();
      }
      return showLevelGoal(transition.snapshot.levelIndex);
    }
    if (resetMode === 'restored') {
      const didRestore = restoreResetUiState(lastResetUiState);
      clearResetUiState();
      return didRestore;
    }

    clearResetUiState();
    return false;
  };

  const syncGameCommandPathTransitionState = (
    commandType: string,
    payload: PathStepPayload | null | undefined,
    transition: StateTransition,
    previousSnapshot: GameSnapshot,
    isPathStepCommand: boolean,
  ): void => {
    if (transition.changed && isPathStepCommand) {
      renderer.recordPathTransition?.(
        previousSnapshot,
        transition.snapshot,
        interactionState,
      );
      if (interactionState.isPathDragging) {
        markLowPowerHintDragActivity();
      }
      interactionState.pathTipArrivalHint = buildPathTipArrivalHint(
        commandType,
        payload,
        previousSnapshot,
        transition.snapshot,
      );
      return;
    }
    if (!isPathStepCommand) interactionState.pathTipArrivalHint = null;
  };

  const handleGameCommand = (payload: GameCommandPayload): void => {
    if (dailyBoardLocked || !payload?.commandType) return;

    const commandType = payload.commandType;
    const pathStepSide = resolvePathStepCommandSide(commandType, payload);
    const isPathStepCommand = pathStepSide === 'start' || pathStepSide === 'end';
    const previousSnapshot = state.getSnapshot();
    const transition = state.dispatch({
      type: commandType,
      payload,
    });

    if (shouldClearResetUiStateAfterCommand(commandType, transition, previousSnapshot)) {
      clearResetUiState();
    }

    const didResetUiState = handleResetGameCommandUiState(commandType, transition);
    syncGameCommandPathTransitionState(
      commandType,
      payload,
      transition,
      previousSnapshot,
      isPathStepCommand,
    );

    if (transition.rebuildGrid) {
      invalidateEvaluateCache();
      renderer.rebuildGrid(transition.snapshot);
    }
    if (commandType === GAME_COMMANDS.WALL_MOVE_ATTEMPT && transition.changed) {
      invalidateEvaluateCache();
    }
    if (transition.changed || transition.rebuildGrid) {
      syncInputSnapshot(transition.snapshot);
    }
    if (!transition.changed && !transition.validate && !transition.rebuildGrid && !didResetUiState) {
      return;
    }

    if (shouldClearPathTransitionCompensation(commandType, isPathStepCommand, transition)) {
      renderer.clearPathTransitionCompensation?.();
    }

    queueBoardLayout(transition.validate, {
      isPathDragging: interactionState.isPathDragging,
      pathDragSide: interactionState.pathDragSide,
      pathDragCursor: interactionState.pathDragCursor,
      validationSource: transition.validate ? commandType : null,
      needsResize: transition.rebuildGrid,
    });

    if (shouldQueueSessionSaveAfterCommand(
      commandType,
      isPathStepCommand,
      transition,
      interactionState.isPathDragging,
    )) {
      queueSessionSave();
    }
  };

  const emitIntent = (intent: RuntimeIntent | null | undefined): void => {
    if (!intent?.type) return;

    if (intent.type === INTENT_TYPES.UI_ACTION) {
      handleUiAction((intent.payload ?? {}) as UiActionPayload);
      return;
    }

    if (intent.type === INTENT_TYPES.INTERACTION_UPDATE) {
      handleInteractionUpdate((intent.payload ?? {}) as InteractionUpdatePayload);
      return;
    }

    if (intent.type === INTENT_TYPES.GAME_COMMAND) {
      handleGameCommand((intent.payload ?? {}) as GameCommandPayload);
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    destroyed = false;
    applyTheme(activeTheme);
    document.documentElement.lang = activeLocale;
    applyTextDirection(activeLocale);

    applyLowPowerMode(lowPowerModeEnabled, { force: true });
    renderer.mount();
    const refs = renderer.getRefs();
    syncLowPowerToggle();

    if (refs.legend) {
      refs.legend.innerHTML = ui.buildLegendTemplate(
        ui.badgeDefinitions,
        ui.icons,
        ui.iconX,
        translate,
      );
    }

    if (refs.guidePanel && refs.guideToggleBtn) {
      applyPanelVisibility(refs.guidePanel, refs.guideToggleBtn, 'guide', Boolean(bootState.hiddenPanels?.guide));
    }
    if (refs.legendPanel && refs.legendToggleBtn) {
      applyPanelVisibility(refs.legendPanel, refs.legendToggleBtn, 'legend', Boolean(bootState.hiddenPanels?.legend));
    }

    input.bind({
      refs,
      readSnapshot: () => state.getSnapshot(),
      readLayoutMetrics: () => renderer.getLayoutMetrics?.() || null,
      emitIntent,
    });

    if (typeof ResizeObserver !== 'undefined' && refs.boardWrap) {
      boardResizeObserver = new ResizeObserver(() => {
        renderer.notifyResizeInteraction?.();
        queueBoardLayout(false, { needsResize: true });
      });
      boardResizeObserver.observe(refs.boardWrap as unknown as Element);
    }

    if (!beforeUnloadObserverCleanupHandler) {
      beforeUnloadObserverCleanupHandler = () => {
        boardResizeObserver?.disconnect();
      };
    }
    if (!beforeUnloadPersistHandler) {
      beforeUnloadPersistHandler = () => {
        persistSessionSave();
      };
    }
    if (!windowResizeHandler) {
      windowResizeHandler = () => {
        renderer.notifyResizeInteraction?.();
        queueBoardLayout(false, { needsResize: true });
      };
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', beforeUnloadObserverCleanupHandler, { once: true });
      window.addEventListener('beforeunload', beforeUnloadPersistHandler);
      window.addEventListener('resize', windowResizeHandler);
    }

    refreshStaticUiText({ locale: i18n.getLocale() });
    startDailyCountdown();
    refreshLevelOptions();

    const fallbackInitialLevelIndex = isCampaignCompleted()
      ? core.ensureInfiniteAbsIndex(core.clampInfiniteIndex(readInfiniteProgress()))
      : Math.min(readCampaignProgress(), campaignCount - 1);

    const savedBoard = sessionSaveData.board;
    const savedInitialLevelIndex = savedBoard && Number.isInteger(savedBoard.levelIndex)
      ? savedBoard.levelIndex
      : null;
    const initialLevelIndex = savedInitialLevelIndex ?? fallbackInitialLevelIndex;

    loadLevel(initialLevelIndex);
    applyKeyboardGamepadControlsEnabled(keyboardGamepadControlsEnabled, { force: true });
    startLowPowerHintDetector();
  };

  const destroy = (options: RuntimeData = {}): void => {
    destroyed = true;
    started = false;
    if (layoutRafId) {
      cancelAnimationFrame(layoutRafId);
      layoutRafId = 0;
    }
    if (lowPowerHintRafId) {
      cancelAnimationFrame(lowPowerHintRafId);
      lowPowerHintRafId = 0;
    }
    if (sessionSaveTimerId) {
      clearTimeout(sessionSaveTimerId);
      sessionSaveTimerId = 0;
    }
    sessionSaveQueued = false;
    layoutQueued = false;
    pendingValidate = false;
    pendingResize = false;
    pendingValidateSource = null;
    queuedLayoutOptions = {};
    boardResizeObserver?.disconnect();
    boardResizeObserver = null;
    if (typeof window !== 'undefined') {
      if (beforeUnloadObserverCleanupHandler) {
        window.removeEventListener('beforeunload', beforeUnloadObserverCleanupHandler);
      }
      if (beforeUnloadPersistHandler) {
        window.removeEventListener('beforeunload', beforeUnloadPersistHandler);
      }
      if (windowResizeHandler) {
        window.removeEventListener('resize', windowResizeHandler);
      }
    }
    beforeUnloadObserverCleanupHandler = null;
    beforeUnloadPersistHandler = null;
    windowResizeHandler = null;
    clearDailyCountdownTimer();
    input.unbind();
    renderer.unmount(options);
  };

  return {
    start,
    destroy,
    emitIntent,
    refreshLocalizationUi: () => {
      refreshStaticUiText({ locale: activeLocale });
    },
    ...(debugDailyFreeze ? {
      readDebugDailyFreezeState: () => debugDailyFreeze.readState() as unknown as RuntimeData,
      setDebugForceDailyFrozen: (forced: boolean) => debugDailyFreeze.setForced(forced) as unknown as RuntimeData,
      toggleDebugForceDailyFrozen: () => debugDailyFreeze.toggle() as unknown as RuntimeData,
    } : {}),
  };
}

export function createHeadlessRuntime(options: HeadlessRuntimeOptions): HeadlessRuntime {
  const {
    core,
    state,
    persistence,
  } = options;

  if (!core || !state || !persistence) {
    throw new Error('createHeadlessRuntime requires core, state, and persistence');
  }

  const bootState = persistence.readBootState();
  let campaignProgress = Number.isInteger(bootState.campaignProgress) ? bootState.campaignProgress : 0;
  let infiniteProgress = Number.isInteger(bootState.infiniteProgress) ? bootState.infiniteProgress : 0;
  let dailySolvedDate: DailyId = typeof bootState.dailySolvedDate === 'string' ? bootState.dailySolvedDate : null;
  const scoreManager = createScoreManagerTyped(bootState.scoreState, persistence);

  const evaluate = (validate = false): HeadlessRuntimeResult => {
    const snapshot = state.getSnapshot();
    const result = core.evaluate(snapshot, {});
    const completion = validate ? core.checkCompletion(snapshot, result, (k: string) => k) : null;
    if (completion?.kind === 'good') {
      registerSolvedSnapshotTyped({
        snapshot,
        core,
        scoreManager,
      });
      const { nextDailySolvedDate } = markClearedLevelTyped({
        levelIndex: snapshot.levelIndex,
        core,
        activeDailyId: typeof core.getDailyId === 'function' ? core.getDailyId() : null,
        dailySolvedDate,
        onCampaignCleared: (campaignLevelIndex: number) => {
          const next = Math.max(campaignProgress, campaignLevelIndex + 1);
          campaignProgress = Math.min(core.getCampaignLevelCount(), next);
          persistence.writeCampaignProgress(campaignProgress);
        },
        onInfiniteCleared: (infiniteLevelIndex: number) => {
          const next = Math.max(infiniteProgress, infiniteLevelIndex + 1);
          infiniteProgress = Math.min(core.getInfiniteMaxIndex(), next);
          persistence.writeInfiniteProgress(infiniteProgress);
        },
        onDailyCleared: (dailyId: string) => {
          persistence.writeDailySolvedDate(dailyId);
        },
      });
      dailySolvedDate = nextDailySolvedDate;
      persistence.clearSessionBoard();
    }
    return { snapshot, result, completion };
  };

  return {
    start(initialLevelIndex = 0): HeadlessRuntimeResult {
      state.dispatch({ type: 'level/load', payload: { levelIndex: initialLevelIndex } });
      if (bootState.sessionBoard?.levelIndex === initialLevelIndex) {
        state.restoreMutableState(bootState.sessionBoard);
      }
      return evaluate(false);
    },

    dispatch(commandType: string, payload: RuntimeData = {}) {
      const transition = state.dispatch({ type: commandType, payload });
      const out = evaluate(Boolean(transition.validate));
      if (out.snapshot.path.length > 0) {
        const board = buildSessionBoardFromSnapshotTyped({
          snapshot: out.snapshot,
          activeDailyId: typeof core.getDailyId === 'function' ? core.getDailyId() : null,
          isDailyLevelIndex: (levelIndex: number) => (
            typeof core.isDailyAbsIndex === 'function' && core.isDailyAbsIndex(levelIndex)
          ),
        });
        if (board) {
          persistence.writeSessionBoard(board);
        }
      }
      return { ...transition, ...out };
    },

    getProgress() {
      return { campaignProgress, infiniteProgress, dailySolvedDate };
    },

    getSnapshot() {
      return state.getSnapshot();
    },
  };
}
