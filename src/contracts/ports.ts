export type RuntimeData = Record<string, unknown>;

export interface GridPoint {
  r: number;
  c: number;
}

export type GridTuple = [number, number];

export interface BoardSelection extends GridPoint {
  kind: string;
}

export interface StitchRequirement {
  nw: GridPoint;
  ne: GridPoint;
  sw: GridPoint;
  se: GridPoint;
}

export interface RuleStatus {
  total?: number;
  good?: number;
  bad?: number;
  [key: string]: unknown;
}

export interface GameSnapshot {
  version: number;
  levelIndex: number;
  rows: number;
  cols: number;
  totalUsable: number;
  pathKey: string;
  path: GridPoint[];
  visited: Set<string>;
  gridData: string[][];
  stitches: GridTuple[];
  cornerCounts: Array<[number, number, number]>;
  stitchSet: Set<string>;
  stitchReq: Map<string, StitchRequirement>;
  idxByKey: Map<string, number>;
  [key: string]: unknown;
}

export interface BoardLayoutMetrics {
  version: number;
  rows: number;
  cols: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  size: number;
  gap: number;
  pad: number;
  step: number;
  scrollX?: number;
  scrollY?: number;
}

export interface EvaluateResult {
  hintStatus: RuleStatus | null;
  stitchStatus: RuleStatus | null;
  rpsStatus: RuleStatus | null;
  blockedStatus: RuleStatus | null;
  [key: string]: unknown;
}

export type CompletionKind = 'good' | 'bad' | null;

export interface CompletionResult {
  allVisited: boolean;
  hintsOk: boolean;
  stitchesOk: boolean;
  rpsOk: boolean;
  kind: CompletionKind;
  message: string;
  hintStatus: RuleStatus | null;
  stitchStatus: RuleStatus | null;
  rpsStatus: RuleStatus | null;
  [key: string]: unknown;
}

export interface StateTransitionMeta {
  resetMode?: string | null;
  storedResetCandidate?: boolean;
  [key: string]: unknown;
}

export interface StateTransition {
  changed: boolean;
  rebuildGrid: boolean;
  validate: boolean;
  command?: string;
  snapshot: GameSnapshot;
  meta?: StateTransitionMeta | null;
  [key: string]: unknown;
}

export interface LevelDefinition {
  name?: string;
  nameKey?: string;
  desc?: string;
  descKey?: string;
  grid: string[] | string[][];
  stitches?: GridTuple[];
  cornerCounts?: Array<[number, number, number]>;
  [key: string]: unknown;
}

export type TranslateVars = Record<string, string | number | boolean | null | undefined>;
export type Translator = (key: string, vars?: TranslateVars) => string;

export interface LocaleOption {
  value: string;
  label: string;
  available?: boolean;
  disabled?: boolean;
}

export interface CorePort {
  getLevel: (index: number) => LevelDefinition | null;
  evaluate: (
    snapshot: GameSnapshot,
    evaluateOptions?: RuntimeData,
  ) => EvaluateResult;
  checkCompletion: (
    snapshot: GameSnapshot,
    evaluateResult: EvaluateResult,
    translate: Translator,
  ) => CompletionResult;
  goalText: (levelIndex: number, translate: Translator) => string;
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

export interface StateCommand {
  type: string;
  payload?: RuntimeData;
}

export interface StatePort {
  loadLevel?: (levelIndex: number) => void;
  restoreMutableState: (savedBoard: SessionBoardState) => boolean;
  dispatch: (command: StateCommand) => StateTransition;
  getSnapshot: () => GameSnapshot;
}

export interface SessionBoardState {
  levelIndex: number;
  path: GridTuple[];
  movableWalls: GridTuple[] | null;
  dailyId?: string | null;
}

export interface HiddenPanelState {
  guide: boolean;
  legend: boolean;
}

export interface BootState {
  theme: string;
  lowPowerModeEnabled: boolean;
  keyboardGamepadControlsEnabled?: boolean;
  hiddenPanels: HiddenPanelState;
  campaignProgress: number;
  infiniteProgress: number;
  dailySolvedDate: string | null;
  sessionBoard: SessionBoardState | null;
  scoreState?: RuntimeData | null;
}

export interface PersistencePort {
  readBootState: () => BootState;
  writeTheme: (theme: string) => void;
  writeLowPowerModeEnabled: (enabled: boolean) => void;
  writeKeyboardGamepadControlsEnabled: (enabled: boolean) => void;
  writeHiddenPanel: (panel: 'guide' | 'legend', hidden: boolean) => void;
  writeCampaignProgress: (value: number) => void;
  writeInfiniteProgress: (value: number) => void;
  writeDailySolvedDate: (dailyId: string) => void;
  writeSessionBoard: (board: SessionBoardState) => void;
  writeScoreState: (state: RuntimeData) => void;
  clearSessionBoard: () => void;
}

export interface ClassListLike {
  add: (...tokens: string[]) => void;
  remove: (...tokens: string[]) => void;
  toggle: (token: string, force?: boolean) => boolean;
  contains: (token: string) => boolean;
}

export interface StyleLike {
  setProperty: (name: string, value: string) => void;
  removeProperty: (name: string) => void;
  getPropertyValue: (name: string) => string;
  display?: string;
  width?: string;
  height?: string;
  left?: string;
  top?: string;
  transform?: string;
  position?: string;
}

export interface CssStyleDeclarationLike {
  display?: string;
  visibility?: string;
  opacity?: string;
}

export interface DomRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
}

export interface EventTargetLike {
  addEventListener: (
    type: string,
    handler: EventListenerOrEventListenerObject | ((event?: any) => void),
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: string,
    handler: EventListenerOrEventListenerObject | ((event?: any) => void),
    options?: boolean | AddEventListenerOptions,
  ) => void;
}

export interface ElementLike extends EventTargetLike {
  id?: string;
  className?: string;
  tagName?: string;
  hidden?: boolean;
  disabled?: boolean;
  checked?: boolean;
  open?: boolean;
  returnValue?: string;
  isContentEditable?: boolean;
  textContent?: string | null;
  innerHTML?: string;
  value?: string;
  dataset: Record<string, string | undefined>;
  style: StyleLike | CSSStyleDeclaration;
  classList: ClassListLike;
  parentElement?: ElementLike | Element | null;
  isConnected?: boolean;
  appendChild: <T extends Node>(child: T) => T;
  contains: (target: Node | null) => boolean;
  closest: (selector: string) => ElementLike | Element | null;
  matches?: (selector: string) => boolean;
  querySelector: (selector: string) => ElementLike | Element | null;
  querySelectorAll: (
    selector: string,
  ) => Iterable<ElementLike | Element> & ArrayLike<ElementLike | Element>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  getAttribute: (name: string) => string | null;
  focus: () => void;
  setPointerCapture?: (pointerId: number) => void;
  showModal?: () => void;
  replaceWith?: (...nodes: Array<Node | string>) => void;
  remove?: () => void;
  firstElementChild?: ElementLike | Element | null;
  nextElementSibling?: ElementLike | Element | null;
  clientLeft?: number;
  clientTop?: number;
  clientWidth?: number;
  clientHeight?: number;
  offsetWidth?: number;
  offsetHeight?: number;
  getBoundingClientRect: () => DomRectLike | DOMRect;
  getContext?: (contextId: string) => unknown;
}

export interface InputElementLike extends ElementLike {
  checked?: boolean;
  disabled?: boolean;
  value?: string;
}

export interface DialogElementLike extends ElementLike {
  open?: boolean;
  returnValue?: string;
  showModal?: () => void;
}

export interface CanvasElementLike extends ElementLike {
  width?: number;
  height?: number;
}

export interface PathRendererLike {
  antialiasEnabled?: boolean;
  clear?(): void;
  resize?(width: number, height: number, dpr: number): void;
  drawPathFrame?(payload?: unknown): number;
  destroy?(options?: RuntimeData): void;
  isContextLost?(): boolean;
}

export interface RendererRefs {
  app: ElementLike | null;
  boardFocusProxy: ElementLike | null;
  levelLabel: ElementLike | null;
  levelSelectGroup: ElementLike | null;
  levelSel: InputElementLike | null;
  infiniteSel: InputElementLike | null;
  dailyMeta: ElementLike | null;
  dailyDateValue: ElementLike | null;
  dailyCountdownValue: ElementLike | null;
  scoreMeta: ElementLike | null;
  infiniteScoreLabel: ElementLike | null;
  infiniteScoreValue: ElementLike | null;
  dailyScoreLabel: ElementLike | null;
  dailyScoreValue: ElementLike | null;
  langLabel: ElementLike | null;
  langSel: InputElementLike | null;
  themeLabel: ElementLike | null;
  themeToggle: ElementLike | null;
  lowPowerLabel: ElementLike | null;
  lowPowerToggle: InputElementLike | null;
  keyboardGamepadLabel: ElementLike | null;
  keyboardGamepadToggle: InputElementLike | null;
  settingsToggle: ElementLike | null;
  settingsPanel: ElementLike | null;
  themeSwitchDialog: DialogElementLike | null;
  themeSwitchMessage: ElementLike | null;
  themeSwitchCancelBtn: ElementLike | null;
  themeSwitchConfirmBtn: ElementLike | null;
  resetBtn: ElementLike | null;
  reverseBtn: ElementLike | null;
  guidePanel: ElementLike | null;
  guideToggleBtn: ElementLike | null;
  legendPanel: ElementLike | null;
  legendToggleBtn: ElementLike | null;
  msgEl: ElementLike | null;
  prevInfiniteBtn: ElementLike | null;
  nextLevelBtn: ElementLike | null;
  gridEl: ElementLike | null;
  boardWrap: ElementLike | null;
  canvas: CanvasElementLike | null;
  symbolCanvas: CanvasElementLike | null;
  legend: ElementLike | null;
  bTurn: ElementLike | null;
  bCW: ElementLike | null;
  bCCW: ElementLike | null;
  bStraight: ElementLike | null;
  bH: ElementLike | null;
  bV: ElementLike | null;
  bX: ElementLike | null;
  bSc: ElementLike | null;
  bRo: ElementLike | null;
  bPa: ElementLike | null;
  bMoveWall: ElementLike | null;
  pathRenderer?: PathRendererLike | null;
  symbolCtx?: CanvasRenderingContext2D | null;
}

export type PathDragSide = 'start' | 'end' | null;

export interface PathTipArrivalHint {
  side: Exclude<PathDragSide, null>;
  from: GridPoint;
  to: GridPoint;
}

export interface WallGhostState {
  visible: boolean;
  x: number;
  y: number;
}

export interface InteractionModel {
  isDailyLocked?: boolean;
  isPathDragging?: boolean;
  pathDragSide?: PathDragSide;
  pathDragCursor?: GridPoint | null;
  pathTipArrivalHint?: PathTipArrivalHint | null;
  isWallDragging?: boolean;
  wallGhost?: WallGhostState;
  dropTarget?: GridPoint | null;
  isBoardNavActive?: boolean;
  isBoardNavPressing?: boolean;
  boardCursor?: GridPoint | null;
  boardSelection?: BoardSelection | null;
  boardSelectionInteractive?: boolean | null;
  boardNavPreviewDelta?: GridPoint | null;
}

export interface TutorialFlags {
  path?: boolean;
  movable?: boolean;
}

export interface UiRenderModel {
  messageKind?: string | null;
  messageHtml?: string;
  isBoardSolved?: boolean;
  completionAnimationTrigger?: boolean;
  tutorialFlags?: TutorialFlags | null;
}

export interface RendererRenderPayload {
  snapshot: GameSnapshot;
  evaluation: EvaluateResult;
  completion?: CompletionResult | null;
  uiModel?: UiRenderModel;
  interactionModel?: InteractionModel;
}

export interface RendererPort {
  mount: (shellRefs?: RendererRefs | null) => void;
  getRefs: () => RendererRefs;
  rebuildGrid: (snapshot: GameSnapshot) => void;
  renderFrame: (payload: RendererRenderPayload) => void;
  recordPathTransition?: (
    previousSnapshot: GameSnapshot,
    nextSnapshot: GameSnapshot,
    interactionModel?: InteractionModel | null,
  ) => void;
  clearPathTransitionCompensation?: () => void;
  resize: () => void;
  getLayoutMetrics?: () => BoardLayoutMetrics | null;
  notifyResizeInteraction?: () => void;
  setLowPowerMode?: (enabled: boolean) => void;
  setPathFlowFreezeImmediate?: (isFrozen: boolean) => void;
  updateInteraction?: (interactionModel?: InteractionModel) => void;
  unmount: (options?: RuntimeData) => void;
}

export interface RuntimeGameCommandPayload extends RuntimeData {
  commandType: string;
}

export interface RuntimeUiActionPayload extends RuntimeData {
  actionType: string;
}

export interface RuntimeInteractionPayload extends RuntimeData {
  updateType: string;
}

export interface RuntimeGameCommandIntent {
  type: string;
  payload?: RuntimeGameCommandPayload;
}

export interface RuntimeUiActionIntent {
  type: string;
  payload?: RuntimeUiActionPayload;
}

export interface RuntimeInteractionIntent {
  type: string;
  payload?: RuntimeInteractionPayload;
}

export type RuntimeIntent =
  | RuntimeGameCommandIntent
  | RuntimeUiActionIntent
  | RuntimeInteractionIntent;

export interface InputBindPayload {
  refs: RendererRefs;
  readSnapshot: () => GameSnapshot;
  readLayoutMetrics?: () => BoardLayoutMetrics | null;
  emitIntent: (intent: RuntimeIntent) => void;
}

export interface InputPort {
  bind: (payload: InputBindPayload) => void;
  setKeyboardGamepadControlsEnabled: (enabled: boolean) => void;
  setBoardControlSuppressed: (suppressed: boolean) => void;
  syncSnapshot: (snapshot?: GameSnapshot | null) => void;
  unbind: () => void;
}

export interface StorageLike {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface NavigatorLike {
  onLine?: boolean;
  language?: string;
  userLanguage?: string;
}

export interface DocumentLike extends EventTargetLike {
  body?: ElementLike | null;
  documentElement?: ElementLike | null;
  activeElement?: unknown;
  getElementById: (id: string) => ElementLike | null;
  createElement: (tagName: string) => ElementLike;
}

export interface WindowLike extends EventTargetLike {
  confirm: (message?: string) => boolean;
  clearInterval: (id: number) => void;
  setInterval: (handler: () => void, timeout?: number) => number;
  requestAnimationFrame: (callback: (ts: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  getComputedStyle: (element: ElementLike | Element) => CssStyleDeclarationLike | CSSStyleDeclaration;
  localStorage?: StorageLike | null;
  sessionStorage?: StorageLike | null;
  scrollX?: number;
  scrollY?: number;
  pageXOffset?: number;
  pageYOffset?: number;
}

export interface LocaleControllerPort {
  initialize: (locale?: string) => Promise<string>;
  getLocale: () => string;
  resolveLocale: (locale?: string | null) => string;
  getLocaleOptions: (locale?: string) => LocaleOption[];
  setLocale: (locale: string) => Promise<string>;
  createTranslator: (locale?: string) => Translator;
  translateNow: Translator;
  preloadAllLocales: () => Promise<LocaleOption[]>;
  isOnline: () => boolean;
}

export type NotificationPermissionState = NotificationPermission | 'unsupported';

export interface NotificationAutoPromptDecisions {
  UNSET: string;
  ACCEPTED: string;
  DECLINED: string;
}

export interface NotificationToggleOptionFields {
  elementIds: Record<string, string>;
  notificationEnabledKey?: string;
  autoUpdateEnabledKey?: string;
  notificationAutoPromptDecisions: NotificationAutoPromptDecisions;
  readAutoPromptDecision: () => string;
  writeAutoPromptDecision: (value: string) => void;
  readNotificationEnabledPreference: () => boolean;
  writeNotificationEnabledPreference: (enabled: boolean) => void;
  readAutoUpdateEnabledPreference: () => boolean;
  writeAutoUpdateEnabledPreference: (enabled: boolean) => void;
  hasStoredNotificationEnabledPreference: () => boolean;
  notificationPermissionState: () => NotificationPermissionState;
  supportsNotifications: () => boolean;
  canUseServiceWorker: () => boolean;
  requestNotificationPermission: () => Promise<NotificationPermissionState>;
  syncDailyStateToServiceWorker: () => Promise<void>;
  syncUpdatePolicyToServiceWorker: () => Promise<void>;
  registerBackgroundDailyCheck: () => Promise<void>;
  requestServiceWorkerDailyCheck: () => Promise<void>;
  translateNow: Translator;
  showInAppToast: (text: string, options?: RuntimeData) => void;
  windowObj?: WindowLike;
  documentObj?: DocumentLike;
}

export interface NotificationDialogController {
  bind: () => void;
  requestUpdateApplyConfirmation: (buildNumber: number) => Promise<boolean>;
  requestMoveDailyConfirmation: () => Promise<boolean>;
  refreshLocalizedUi: () => void;
  containsOpenDialogTarget: (target: unknown) => boolean;
}

export interface NotificationDialogControllerOptions {
  elementIds: Record<string, string>;
  translateNow?: Translator;
  windowObj?: WindowLike;
  documentObj?: DocumentLike;
}

export interface ApplyUpdateAction {
  type: 'apply-update';
  buildNumber: number;
}

export interface OpenDailyAction {
  type: 'open-daily';
  dailyId: string;
}

export type NotificationHistoryAction = ApplyUpdateAction | OpenDailyAction;

export type NotificationHistoryEntrySource = 'system' | 'toast';
export type NotificationHistoryMarker = 'unread' | 'just-read' | 'older';

export interface NotificationHistoryEntry {
  id: string;
  source: NotificationHistoryEntrySource;
  kind: string;
  title: string;
  body: string;
  createdAtUtcMs: number;
  marker: NotificationHistoryMarker;
  action?: NotificationHistoryAction | null;
}

export interface NotificationHistoryPayload {
  historyVersion?: number;
  entries?: NotificationHistoryEntry[];
}

export interface ServiceWorkerMessage {
  type: string;
  payload?: RuntimeData;
}

export interface ServiceWorkerMessageOptions {
  queueWhenUnavailable?: boolean;
}

export type PostServiceWorkerMessage = (
  message: ServiceWorkerMessage,
  options?: ServiceWorkerMessageOptions,
) => Promise<boolean>;

export interface NotificationServiceWorkerMessageTypes {
  GET_HISTORY: string;
  MARK_HISTORY_READ: string;
  [key: string]: string;
}

export interface ApplyUpdateRequest {
  buildNumber: number;
  requestUpdateApplyConfirmation: (buildNumber: number) => Promise<boolean>;
  closeHistoryPanel: () => void;
}

export interface OpenDailyRequest {
  dailyId: string;
  kind: string;
  requestMoveDailyConfirmation: () => Promise<boolean>;
  closeHistoryPanel: () => void;
}

export interface NotificationHistoryControllerOptions {
  elementIds: Record<string, string>;
  swMessageTypes: NotificationServiceWorkerMessageTypes;
  postMessageToServiceWorker?: PostServiceWorkerMessage;
  translateNow?: Translator;
  getLocale?: () => string;
  onApplyUpdateRequested?: (payload: ApplyUpdateRequest) => Promise<void>;
  onOpenDailyRequested?: (payload: OpenDailyRequest) => Promise<void>;
  isOpenDailyHistoryActionable?: (
    entry: Pick<NotificationHistoryEntry, 'kind' | 'action'>,
  ) => boolean;
  requestUpdateApplyConfirmation?: (buildNumber: number) => Promise<boolean>;
  requestMoveDailyConfirmation?: () => Promise<boolean>;
  containsOpenDialogTarget?: (target: unknown) => boolean;
  windowObj?: WindowLike;
  documentObj?: DocumentLike;
}

export interface NotificationHistoryController {
  bind: () => void;
  applyHistoryPayload: (payload: NotificationHistoryPayload | null | undefined) => void;
  refreshUi: () => void;
  closePanel: () => void;
  getEntries: () => NotificationHistoryEntry[];
}

export interface NotificationToggleController {
  bind: () => void;
  refreshUi: () => void;
  maybeAutoPromptForNotifications: () => Promise<void>;
  handleStorageEvent: (storageKey?: string | null) => void;
}

export interface NotificationCenterOptions extends NotificationToggleOptionFields {
  swMessageTypes: NotificationServiceWorkerMessageTypes;
  localBuildNumber?: number;
  postMessageToServiceWorker?: PostServiceWorkerMessage;
  clearAppliedUpdateHistoryActions?: (appliedBuildNumber?: number) => Promise<void>;
  getLocale?: () => string;
  onApplyUpdateRequested?: (payload: ApplyUpdateRequest) => Promise<void>;
  onOpenDailyRequested?: (payload: OpenDailyRequest) => Promise<void>;
  isOpenDailyHistoryActionable?: (
    entry: Pick<NotificationHistoryEntry, 'kind' | 'action'>,
  ) => boolean;
}

export interface NotificationCenter {
  bind: () => void;
  refreshLocalizedUi: () => void;
  refreshToggleUi: () => void;
  refreshHistoryUi: () => void;
  maybeAutoPromptForNotifications: () => Promise<void>;
  handleStorageEvent: (storageKey?: string | null) => void;
  applyHistoryPayload: (payload: NotificationHistoryPayload | null | undefined) => void;
  getHistoryEntries: () => NotificationHistoryEntry[];
  closeHistoryPanel: () => void;
  requestNotificationPermission: () => Promise<NotificationPermissionState>;
  clearAppliedUpdateHistoryActions: (appliedBuildNumber?: number) => Promise<void>;
}

export type RuntimeTheme = 'light' | 'dark';

export interface RuntimeUiAdapters {
  buildLegendTemplate: (
    badgeDefinitions: Record<string, unknown>,
    icons: Record<string, string>,
    iconX: string,
    translate?: Translator,
  ) => string;
  badgeDefinitions: Record<string, unknown>;
  icons: Record<string, string>;
  iconX: string;
}

export interface RuntimeEffects {
  shouldSuggestLowPowerMode?: () => boolean;
  onLowPowerModeSuggestion?: (payload: RuntimeData) => void;
  onDailySolvedDateChanged?: (dailyId: string | null) => void;
}

export interface RuntimeOptions {
  appEl: Element;
  core: CorePort;
  state: StatePort;
  persistence: PersistencePort;
  renderer: RendererPort;
  input: InputPort;
  i18n: LocaleControllerPort;
  ui: RuntimeUiAdapters;
  dailyHardInvalidateAtUtcMs?: number | null;
  effects?: RuntimeEffects;
}

export interface RuntimeController {
  start: () => void;
  destroy: (options?: RuntimeData) => void;
  emitIntent: (intent: RuntimeIntent | null | undefined) => void;
  refreshLocalizationUi: () => void;
  readDebugDailyFreezeState?: () => RuntimeData;
  setDebugForceDailyFrozen?: (forced: boolean) => RuntimeData;
  toggleDebugForceDailyFrozen?: () => RuntimeData;
}

export interface HeadlessRuntimeResult {
  snapshot: GameSnapshot;
  result: EvaluateResult;
  completion: CompletionResult | null;
}

export interface HeadlessRuntime {
  start: (initialLevelIndex?: number) => HeadlessRuntimeResult;
  dispatch: (
    commandType: string,
    payload?: RuntimeData,
  ) => StateTransition & HeadlessRuntimeResult;
  getProgress: () => {
    campaignProgress: number;
    infiniteProgress: number;
    dailySolvedDate: string | null;
  };
  getSnapshot: () => GameSnapshot;
}

export interface HeadlessRuntimeOptions {
  core: CorePort;
  state: StatePort;
  persistence: PersistencePort;
}

export interface CreateDefaultAdaptersOptions {
  dailyLevel?: LevelDefinition | null;
  dailyId?: string | null;
  infiniteCacheLimit?: number;
  windowObj?: WindowLike | null;
  icons?: Record<string, string>;
  iconX?: string;
}

export interface DefaultAdapters {
  core: CorePort;
  state: StatePort;
  persistence: PersistencePort;
  renderer: RendererPort;
  input: InputPort;
}
