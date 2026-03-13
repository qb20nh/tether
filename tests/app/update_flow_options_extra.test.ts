import assert from 'node:assert/strict';
import test from '../test.ts';
import { vi } from 'vitest';
import { normalizeNotificationToggleOptions } from '../../src/app/notification_options.ts';
import { normalizeSwUpdateOptions } from '../../src/app/sw_update_options.ts';

test('notification toggle options normalize defaults and preserve injected callbacks', async (t) => {
  const defaults = normalizeNotificationToggleOptions();
  assert.equal(defaults.readAutoPromptDecision(), 'unset');
  assert.equal(defaults.readNotificationEnabledPreference(), false);
  assert.equal(defaults.readAutoUpdateEnabledPreference(), false);
  assert.equal(defaults.notificationPermissionState(), 'unsupported');
  assert.equal(defaults.supportsNotifications(), false);
  assert.equal(defaults.canUseServiceWorker(), false);
  assert.equal(await defaults.requestNotificationPermission(), 'unsupported');
  await defaults.syncDailyStateToServiceWorker();
  await defaults.syncUpdatePolicyToServiceWorker();
  await defaults.registerBackgroundDailyCheck();
  await defaults.requestServiceWorkerDailyCheck();
  assert.equal(defaults.translateNow('x'), 'x');

  const calls: string[] = [];
  const custom = normalizeNotificationToggleOptions({
    readAutoPromptDecision: () => 'accepted',
    readNotificationEnabledPreference: () => true,
    readAutoUpdateEnabledPreference: () => true,
    notificationPermissionState: () => 'granted',
    supportsNotifications: () => true,
    canUseServiceWorker: () => true,
    requestNotificationPermission: async () => 'granted',
    syncDailyStateToServiceWorker: async () => { calls.push('daily'); },
    syncUpdatePolicyToServiceWorker: async () => { calls.push('policy'); },
    registerBackgroundDailyCheck: async () => { calls.push('background'); },
    requestServiceWorkerDailyCheck: async () => { calls.push('check'); },
    translateNow: (key) => `custom:${key}`,
  });
  assert.equal(custom.readAutoPromptDecision(), 'accepted');
  assert.equal(custom.readNotificationEnabledPreference(), true);
  assert.equal(custom.readAutoUpdateEnabledPreference(), true);
  assert.equal(custom.notificationPermissionState(), 'granted');
  assert.equal(custom.supportsNotifications(), true);
  assert.equal(custom.canUseServiceWorker(), true);
  assert.equal(await custom.requestNotificationPermission(), 'granted');
  await custom.syncDailyStateToServiceWorker();
  await custom.syncUpdatePolicyToServiceWorker();
  await custom.registerBackgroundDailyCheck();
  await custom.requestServiceWorkerDailyCheck();
  assert.deepEqual(calls, ['daily', 'policy', 'background', 'check']);
  assert.equal(custom.translateNow('x'), 'custom:x');

  t.after(() => {
    vi.unstubAllGlobals();
  });
});

test('sw update options normalize defaults and preserve injected values', () => {
  const defaults = normalizeSwUpdateOptions();
  assert.equal(defaults.localBuildNumber, 0);
  assert.equal(defaults.versionUrl, '');
  assert.equal(defaults.readAutoUpdateEnabledPreference(), false);
  assert.equal(defaults.readNotificationEnabledPreference(), false);
  assert.equal(defaults.readLastNotifiedRemoteBuildNumber(), null);
  assert.deepEqual(defaults.buildNotificationTextPayload(), {});
  assert.equal(defaults.resolveUpdateCheckDecision({}), null);
  assert.equal(defaults.shouldResyncManualUpdatePolicy({}), false);
  assert.equal(defaults.resolveNewVersionToastText(), '');
  assert.equal(defaults.resolveNewVersionTitleText(), '');
  assert.equal(defaults.resolveNewVersionBodyText(), '');
  assert.equal(defaults.resolveUpdateApplyFailureToastText(), '');
  assert.equal(typeof defaults.now(), 'number');

  let overlay = false;
  const custom = normalizeSwUpdateOptions({
    localBuildNumber: 12,
    versionUrl: '/version.json',
    readAutoUpdateEnabledPreference: () => true,
    readNotificationEnabledPreference: () => true,
    readLastNotifiedRemoteBuildNumber: () => 15,
    buildNotificationTextPayload: () => ({ text: 'hello' }),
    getLatestDailyState: () => ({ dailyId: '2026-01-01', hardInvalidateAtUtcMs: 7, dailySolvedDate: '2026-01-01' }),
    resolveUpdateCheckDecision: () => 'apply',
    shouldResyncManualUpdatePolicy: () => true,
    resolveNewVersionToastText: () => 'toast',
    resolveNewVersionTitleText: () => 'title',
    resolveNewVersionBodyText: () => 'body',
    resolveUpdateApplyFailureToastText: () => 'fail',
    setUpdateProgressOverlayActive: (active) => { overlay = active; },
    now: () => 123,
  });
  custom.setUpdateProgressOverlayActive(true);
  assert.equal(custom.localBuildNumber, 12);
  assert.equal(custom.versionUrl, '/version.json');
  assert.equal(custom.readAutoUpdateEnabledPreference(), true);
  assert.equal(custom.readNotificationEnabledPreference(), true);
  assert.equal(custom.readLastNotifiedRemoteBuildNumber(), 15);
  assert.deepEqual(custom.buildNotificationTextPayload(), { text: 'hello' });
  assert.equal(custom.getLatestDailyState().dailyId, '2026-01-01');
  assert.equal(custom.resolveUpdateCheckDecision({}), 'apply');
  assert.equal(custom.shouldResyncManualUpdatePolicy({}), true);
  assert.equal(custom.resolveNewVersionToastText(), 'toast');
  assert.equal(custom.resolveNewVersionTitleText(), 'title');
  assert.equal(custom.resolveNewVersionBodyText(), 'body');
  assert.equal(custom.resolveUpdateApplyFailureToastText(), 'fail');
  assert.equal(custom.now(), 123);
  assert.equal(overlay, true);
});

test('update flow wires messenger and orchestrator together', async (t) => {
  vi.resetModules();
  const calls: string[] = [];
  vi.doMock('../../src/app/sw_messenger.ts', () => ({
    createSwMessenger: (options: Record<string, unknown>) => ({
      canUseServiceWorker: () => options.windowObj === 'window',
      supportsNotifications: () => true,
      postMessage: async (message: unknown, postOptions: unknown) => {
        calls.push(`post:${JSON.stringify(message)}:${JSON.stringify(postOptions)}`);
        return true;
      },
    }),
  }));
  vi.doMock('../../src/app/sw_update_orchestrator.ts', () => ({
    createSwUpdateOrchestrator: (options: Record<string, unknown>) => ({
      syncDailyStateToServiceWorker: async () => { calls.push(`daily:${String(options.swMessenger !== undefined)}`); },
      syncUpdatePolicyToServiceWorker: async () => { calls.push('policy'); },
      ensureServiceWorkerUpdatePolicyConsistency: async () => { calls.push('consistency'); },
      requestServiceWorkerDailyCheck: async () => { calls.push('daily-check'); },
      registerBackgroundDailyCheck: async () => { calls.push('background'); },
      clearAppliedUpdateHistoryActions: async (buildNumber?: number) => { calls.push(`clear:${buildNumber}`); },
      fetchRemoteBuildNumber: async () => 42,
      resolveUpdatableRemoteBuildNumber: async (buildNumber: number) => buildNumber + 1,
      applyUpdateForBuild: async (buildNumber: number) => ({ buildNumber }),
      checkForNewBuild: async () => ({ checked: true }),
      registerServiceWorker: async () => ({ ok: true }),
      bindRuntimeEvents: () => { calls.push('bind-runtime'); },
      bindHistoryUpdates: ({ onPayload }: { onPayload: (payload: unknown) => void }) => {
        onPayload({ ok: true });
        return true;
      },
      getRegistration: () => ({ active: true }),
    }),
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/app/sw_messenger.ts');
    vi.doUnmock('../../src/app/sw_update_orchestrator.ts');
  });

  const { createUpdateFlow } = await import('../../src/app/update_flow.ts');
  const flow = createUpdateFlow({ windowObj: 'window', navigatorObj: 'nav', messageChannelFactory: 'factory' } as any);
  assert.equal(flow.canUseServiceWorker(), true);
  assert.equal(flow.supportsNotifications(), true);
  assert.equal(await flow.postMessageToServiceWorker({ type: 'PING' } as any, { queueWhenUnavailable: true }), true);
  await flow.syncDailyStateToServiceWorker();
  await flow.syncUpdatePolicyToServiceWorker();
  await flow.ensureServiceWorkerUpdatePolicyConsistency();
  await flow.requestServiceWorkerDailyCheck();
  await flow.registerBackgroundDailyCheck();
  await flow.clearAppliedUpdateHistoryActions(9);
  assert.equal(await flow.fetchRemoteBuildNumber(), 42);
  assert.equal(await flow.resolveUpdatableRemoteBuildNumber(42), 43);
  assert.deepEqual(await flow.applyUpdateForBuild(44), { buildNumber: 44 });
  assert.deepEqual(await flow.checkForNewBuild(), { checked: true });
  assert.deepEqual(await flow.registerServiceWorker(), { ok: true });
  flow.bindServiceWorkerRuntimeEvents();
  const payloads: unknown[] = [];
  assert.equal(flow.bindServiceWorkerHistoryMessages({ onPayload: (payload) => payloads.push(payload) }), true);
  assert.deepEqual(flow.getRegistration(), { active: true });
  assert.equal(payloads.length, 1);
  assert.equal(calls.includes('bind-runtime'), true);
});

test('notification center composes its subcontrollers', async (t) => {
  vi.resetModules();
  const dialogCalls: string[] = [];
  const toggleCalls: string[] = [];
  const historyCalls: string[] = [];
  vi.doMock('../../src/app/notification_options.ts', () => ({
    normalizeNotificationToggleOptions: () => ({
      elementIds: { notificationsToggle: 'toggle' },
      notificationEnabledKey: 'enabled',
      autoUpdateEnabledKey: 'auto',
      notificationAutoPromptDecisions: { UNSET: 'unset' },
      readAutoPromptDecision: () => 'unset',
      writeAutoPromptDecision: () => {},
      readNotificationEnabledPreference: () => false,
      writeNotificationEnabledPreference: () => {},
      readAutoUpdateEnabledPreference: () => false,
      writeAutoUpdateEnabledPreference: () => {},
      hasStoredNotificationEnabledPreference: () => false,
      notificationPermissionState: () => 'default',
      supportsNotifications: () => true,
      canUseServiceWorker: () => true,
      requestNotificationPermission: async () => 'granted',
      syncDailyStateToServiceWorker: async () => {},
      syncUpdatePolicyToServiceWorker: async () => {},
      registerBackgroundDailyCheck: async () => {},
      requestServiceWorkerDailyCheck: async () => {},
      translateNow: (key: string) => key,
      showInAppToast: () => {},
      windowObj: {},
      documentObj: {},
    }),
  }));
  vi.doMock('../../src/app/notification_dialog_controller.ts', () => ({
    createNotificationDialogController: () => ({
      bind: () => { dialogCalls.push('bind'); },
      refreshLocalizedUi: () => { dialogCalls.push('refresh'); },
      requestUpdateApplyConfirmation: async () => true,
      requestMoveDailyConfirmation: async () => true,
      containsOpenDialogTarget: () => false,
    }),
  }));
  vi.doMock('../../src/app/notification_toggle_controller.ts', () => ({
    createNotificationToggleController: () => ({
      bind: () => { toggleCalls.push('bind'); },
      refreshUi: () => { toggleCalls.push('refresh'); },
      maybeAutoPromptForNotifications: async () => { toggleCalls.push('auto'); },
      handleStorageEvent: () => { toggleCalls.push('storage'); },
    }),
  }));
  vi.doMock('../../src/app/notification_history_controller.ts', () => ({
    createNotificationHistoryController: () => ({
      bind: () => { historyCalls.push('bind'); },
      refreshUi: () => { historyCalls.push('refresh'); },
      applyHistoryPayload: () => { historyCalls.push('apply'); },
      getEntries: () => [{ id: 1 }],
      closePanel: () => { historyCalls.push('close'); },
    }),
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/app/notification_options.ts');
    vi.doUnmock('../../src/app/notification_dialog_controller.ts');
    vi.doUnmock('../../src/app/notification_toggle_controller.ts');
    vi.doUnmock('../../src/app/notification_history_controller.ts');
  });

  const { createNotificationCenter } = await import('../../src/app/notification_center.ts');
  const center = createNotificationCenter({
    elementIds: { notificationsToggle: 'toggle' },
    swMessageTypes: { HISTORY_UPDATE: 'HISTORY' },
    windowObj: {},
    documentObj: {},
  } as any);

  center.bind();
  center.refreshLocalizedUi();
  center.refreshToggleUi();
  center.refreshHistoryUi();
  await center.maybeAutoPromptForNotifications();
  center.handleStorageEvent({} as any);
  center.applyHistoryPayload({} as any);
  center.closeHistoryPanel();
  assert.deepEqual(center.getHistoryEntries(), [{ id: 1 }]);
  await center.clearAppliedUpdateHistoryActions(8);
  assert.deepEqual(dialogCalls, ['bind', 'refresh']);
  assert.deepEqual(toggleCalls, ['bind', 'refresh', 'auto', 'storage']);
  assert.deepEqual(historyCalls, ['bind', 'refresh', 'refresh', 'apply', 'close']);
});
