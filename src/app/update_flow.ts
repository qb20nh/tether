// @ts-nocheck
import { createSwMessenger } from './sw_messenger.ts';
import { normalizeSwUpdateOptions } from './sw_update_options.ts';
import { createSwUpdateOrchestrator } from './sw_update_orchestrator.ts';

export function createUpdateFlow(options = {}) {
  const { messageChannelFactory } = options;
  const swUpdateOptions = normalizeSwUpdateOptions(options);

  const swMessenger = createSwMessenger({
    windowObj: swUpdateOptions.windowObj,
    navigatorObj: swUpdateOptions.navigatorObj,
    messageChannelFactory,
  });

  const swUpdateOrchestrator = createSwUpdateOrchestrator({
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
