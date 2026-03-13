import { createSwMessenger } from './sw_messenger.ts';
import { normalizeSwUpdateOptions } from './sw_update_options.ts';
import { createSwUpdateOrchestrator } from './sw_update_orchestrator.ts';
import type {
  RuntimeData,
  ServiceWorkerMessage,
  ServiceWorkerMessageOptions,
} from '../contracts/ports.ts';
import type {
  NormalizedSwUpdateOptions,
} from './sw_update_options.ts';
import type {
  SwMessenger,
} from './sw_messenger.ts';

interface UpdateFlow {
  canUseServiceWorker: () => boolean;
  supportsNotifications: () => boolean;
  postMessageToServiceWorker: (
    message: ServiceWorkerMessage,
    postOptions?: ServiceWorkerMessageOptions,
  ) => Promise<boolean>;
  syncDailyStateToServiceWorker: () => Promise<void>;
  syncUpdatePolicyToServiceWorker: () => Promise<void>;
  ensureServiceWorkerUpdatePolicyConsistency: () => Promise<void>;
  requestServiceWorkerDailyCheck: () => Promise<void>;
  registerBackgroundDailyCheck: () => Promise<void>;
  clearAppliedUpdateHistoryActions: (appliedBuildNumber?: number) => Promise<void>;
  fetchRemoteBuildNumber: () => Promise<number | null>;
  resolveUpdatableRemoteBuildNumber: (remoteBuildNumber: number) => Promise<number | null>;
  applyUpdateForBuild: (remoteBuildNumber: number, applyOptions?: RuntimeData) => Promise<unknown>;
  checkForNewBuild: (checkOptions?: RuntimeData) => Promise<unknown>;
  registerServiceWorker: () => Promise<unknown>;
  bindServiceWorkerRuntimeEvents: () => void;
  bindServiceWorkerHistoryMessages: (payload: { onPayload: (payload: unknown) => void }) => boolean;
  getRegistration: () => unknown;
}

interface SwUpdateOrchestratorLike {
  syncDailyStateToServiceWorker: () => Promise<void>;
  syncUpdatePolicyToServiceWorker: () => Promise<void>;
  ensureServiceWorkerUpdatePolicyConsistency: () => Promise<void>;
  requestServiceWorkerDailyCheck: () => Promise<void>;
  registerBackgroundDailyCheck: () => Promise<void>;
  clearAppliedUpdateHistoryActions: (appliedBuildNumber?: number) => Promise<void>;
  fetchRemoteBuildNumber: () => Promise<number | null>;
  resolveUpdatableRemoteBuildNumber: (remoteBuildNumber: number) => Promise<number | null>;
  applyUpdateForBuild: (remoteBuildNumber: number, applyOptions?: RuntimeData) => Promise<unknown>;
  checkForNewBuild: (checkOptions?: RuntimeData) => Promise<unknown>;
  registerServiceWorker: () => Promise<unknown>;
  bindRuntimeEvents: () => void;
  bindHistoryUpdates: (payload: { onPayload: (payload: unknown) => void }) => boolean;
  getRegistration: () => unknown;
}

const createSwMessengerTyped = createSwMessenger as (options: RuntimeData) => SwMessenger;
const createSwUpdateOrchestratorTyped = createSwUpdateOrchestrator as (
  options: NormalizedSwUpdateOptions & { swMessenger: SwMessenger },
) => SwUpdateOrchestratorLike;

export function createUpdateFlow(options: Record<string, unknown> = {}): UpdateFlow {
  const { messageChannelFactory } = options;
  const swUpdateOptions = normalizeSwUpdateOptions(options);

  const swMessenger = createSwMessengerTyped({
    windowObj: swUpdateOptions.windowObj,
    navigatorObj: swUpdateOptions.navigatorObj,
    messageChannelFactory,
  });

  const swUpdateOrchestrator = createSwUpdateOrchestratorTyped({
    ...swUpdateOptions,
    swMessenger,
  });

  return {
    canUseServiceWorker: () => swMessenger.canUseServiceWorker(),
    supportsNotifications: () => swMessenger.supportsNotifications(),
    postMessageToServiceWorker: (message, postOptions = {}) => swMessenger.postMessage(message, postOptions),
    syncDailyStateToServiceWorker: () => swUpdateOrchestrator.syncDailyStateToServiceWorker(),
    syncUpdatePolicyToServiceWorker: () => swUpdateOrchestrator.syncUpdatePolicyToServiceWorker(),
    ensureServiceWorkerUpdatePolicyConsistency: () => swUpdateOrchestrator.ensureServiceWorkerUpdatePolicyConsistency(),
    requestServiceWorkerDailyCheck: () => swUpdateOrchestrator.requestServiceWorkerDailyCheck(),
    registerBackgroundDailyCheck: () => swUpdateOrchestrator.registerBackgroundDailyCheck(),
    clearAppliedUpdateHistoryActions: (appliedBuildNumber) => swUpdateOrchestrator.clearAppliedUpdateHistoryActions(appliedBuildNumber),
    fetchRemoteBuildNumber: () => swUpdateOrchestrator.fetchRemoteBuildNumber(),
    resolveUpdatableRemoteBuildNumber: (remoteBuildNumber) => swUpdateOrchestrator.resolveUpdatableRemoteBuildNumber(remoteBuildNumber),
    applyUpdateForBuild: (remoteBuildNumber, applyOptions = {}) => swUpdateOrchestrator.applyUpdateForBuild(remoteBuildNumber, applyOptions),
    checkForNewBuild: (checkOptions = {}) => swUpdateOrchestrator.checkForNewBuild(checkOptions),
    registerServiceWorker: () => swUpdateOrchestrator.registerServiceWorker(),
    bindServiceWorkerRuntimeEvents: () => swUpdateOrchestrator.bindRuntimeEvents(),
    bindServiceWorkerHistoryMessages: ({ onPayload }) => swUpdateOrchestrator.bindHistoryUpdates({ onPayload }),
    getRegistration: () => swUpdateOrchestrator.getRegistration(),
  };
}
