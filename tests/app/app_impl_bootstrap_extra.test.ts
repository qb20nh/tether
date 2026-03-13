import assert from 'node:assert/strict';
import test from '../test.ts';
import { vi } from 'vitest';

class FakeClassList {
  private readonly tokens = new Set<string>();

  add(...next: string[]) {
    for (const token of next) this.tokens.add(token);
  }

  remove(...next: string[]) {
    for (const token of next) this.tokens.delete(token);
  }

  toggle(token: string, force?: boolean): boolean {
    if (force === true) {
      this.tokens.add(token);
      return true;
    }
    if (force === false) {
      this.tokens.delete(token);
      return false;
    }
    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return false;
    }
    this.tokens.add(token);
    return true;
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }
}

class FakeElement {
  id = '';
  className = '';
  hidden = false;
  textContent = '';
  isConnected = true;
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  remove(): void {
    this.isConnected = false;
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

interface CapturedNotificationOptions {
  onApplyUpdateRequested: (options: {
    buildNumber: number;
    requestUpdateApplyConfirmation: () => Promise<boolean>;
    closeHistoryPanel: () => void;
  }) => Promise<void>;
  onOpenDailyRequested: (options: {
    dailyId: string;
    kind: string;
    requestMoveDailyConfirmation: () => Promise<boolean>;
    closeHistoryPanel: () => void;
  }) => Promise<void>;
}

const installAppGlobals = (includeAppRoot = true) => {
  let reloadCalls = 0;
  const listeners = new Map<string, Array<(event?: Record<string, unknown>) => void>>();
  const appEl = new FakeElement();
  appEl.id = 'app';
  const settingsVersionEl = new FakeElement();
  settingsVersionEl.id = 'settingsVersion';
  const body = new FakeElement();
  const metaByName = new Map<string, string>([
    ['tether-build-number', '7'],
    ['tether-build-label', '2026-03-08T00:00:00.000Z'],
    ['tether-build-datetime', '2026-03-08T00:00:00.000Z'],
  ]);

  const elementById = new Map<string, FakeElement>([
    ['settingsVersion', settingsVersionEl],
  ]);
  if (includeAppRoot) {
    elementById.set('app', appEl);
  }

  const localStorageData = new Map<string, string>([
    ['tetherLastSeenBuildNumber', '6'],
  ]);
  const sessionStorageData = new Map<string, string>();

  const documentMock = {
    body,
    createElement: () => new FakeElement(),
    querySelector: (selector: string) => {
      const match = /^meta\[name="([^"]+)"\]$/.exec(selector);
      if (!match) return null;
      const content = metaByName.get(match[1]);
      return typeof content === 'string' ? { content } : null;
    },
    getElementById: (id: string) => elementById.get(id) ?? null,
  };

  const windowMock: {
    location: {
      href: string;
      reload: () => void;
    };
    localStorage: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
    };
    sessionStorage: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
    };
    addEventListener: (type: string, handler: (event?: Record<string, unknown>) => void) => void;
    requestAnimationFrame: (callback: (timestamp: number) => void) => number;
    setTimeout: (_callback: () => void) => number;
  } = {
    location: {
      href: 'http://example.test/app/',
      reload() {
        reloadCalls += 1;
      },
    },
    localStorage: {
      getItem: (key: string) => localStorageData.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStorageData.set(key, value);
      },
    },
    sessionStorage: {
      getItem: (key: string) => sessionStorageData.get(key) ?? null,
      setItem: (key: string, value: string) => {
        sessionStorageData.set(key, value);
      },
    },
    addEventListener(type: string, handler: (event?: Record<string, unknown>) => void) {
      const next = listeners.get(type) || [];
      next.push(handler);
      listeners.set(type, next);
    },
    requestAnimationFrame(callback: (timestamp: number) => void) {
      callback(0);
      return 1;
    },
    setTimeout(_callback: () => void) {
      return 1;
    },
  };
  const originalDocument = (globalThis as Record<string, unknown>).document;
  const originalWindow = (globalThis as Record<string, unknown>).window;
  const originalNotification = (globalThis as Record<string, unknown>).Notification;
  (globalThis as Record<string, unknown>).document = documentMock;
  (globalThis as Record<string, unknown>).window = windowMock;
  (globalThis as Record<string, unknown>).Notification = {
    permission: 'granted',
    requestPermission: async () => 'granted',
  };

  return {
    appEl,
    body,
    settingsVersionEl,
    get reloadCalls() {
      return reloadCalls;
    },
    emitWindowEvent(type: string, event: Record<string, unknown> = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({
          type,
          ...event,
        });
      }
    },
    restore() {
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).Notification = originalNotification;
    },
  };
};

test('app_impl bootstraps the shell, runtime, notifications, and update flow with mocked dependencies', async (t) => {
  vi.resetModules();
  const globals = installAppGlobals(true);
  let renderTarget: unknown = null;
  let runtimeStartCalls = 0;
  let runtimeDestroyCalls = 0;
  let runtimeRefreshLocalizationCalls = 0;
  let mountedPlugins = 0;
  const emittedIntents: unknown[] = [];
  const swMessages: unknown[] = [];
  const handledStorageKeys: Array<string | null | undefined> = [];
  let preloadLocaleCalls = 0;
  let notificationOptions: CapturedNotificationOptions | null = null;

  vi.doMock('preact', () => ({
    h: (type: unknown, props: unknown) => ({ type, props }),
    render: (node: unknown, target: unknown) => {
      renderTarget = { node, target };
    },
  }));
  vi.doMock('../../src/app/daily_payload_service.ts', () => ({
    createDailyPayloadService: () => ({
      resolveDailyBootPayload: async () => ({
        dailyId: '2026-03-13',
        hardInvalidateAtUtcMs: 1234,
        dailyLevel: { grid: ['..'] },
      }),
      setupDailyHardInvalidationWatcher() {},
      fetchDailyPayload: async () => ({
        dailyId: '2026-03-14',
      }),
    }),
  }));
  vi.doMock('../../src/app/locale_controller.ts', () => ({
    createLocaleController: () => ({
      initialize: async () => 'en',
      createTranslator: () => (key: string) => `translated:${key}`,
      getLocaleOptions: () => [{ value: 'en', label: 'English' }],
      translateNow: (key: string) => `translated:${key}`,
      getLocale: () => 'en',
      setLocale: async (locale: string) => locale,
      preloadAllLocales: async () => {
        preloadLocaleCalls += 1;
      },
    }),
  }));
  vi.doMock('../../src/app/notification_preferences.ts', () => ({
    AUTO_UPDATE_ENABLED_KEY: 'autoUpdate',
    NOTIFICATION_AUTO_PROMPT_DECISIONS: {
      UNSET: 'unset',
    },
    NOTIFICATION_ENABLED_KEY: 'notifications',
    createNotificationPreferences: () => ({
      readAutoPromptDecision: () => 'unset',
      writeAutoPromptDecision() {},
      readNotificationEnabledPreference: () => true,
      writeNotificationEnabledPreference() {},
      readAutoUpdateEnabledPreference: () => true,
      writeAutoUpdateEnabledPreference() {},
      readLastNotifiedRemoteBuildNumber: () => null,
      writeLastNotifiedRemoteBuildNumber() {},
      hasStoredNotificationEnabledPreference: () => true,
      notificationPermissionState: () => 'granted',
    }),
  }));
  vi.doMock('../../src/app/notification_center.ts', () => ({
    createNotificationCenter: (options: CapturedNotificationOptions) => {
      notificationOptions = options;
      return {
      bind() {},
      refreshToggleUi() {},
      refreshHistoryUi() {},
      refreshLocalizedUi() {},
      applyHistoryPayload() {},
      getHistoryEntries: () => [],
      handleStorageEvent(key: string | null | undefined) {
        handledStorageKeys.push(key);
      },
      maybeAutoPromptForNotifications: async () => {},
      };
    },
  }));
  vi.doMock('../../src/app/update_build_resolver.ts', () => ({
    resolveLatestUpdateBuildNumber: async (options?: { hintBuildNumber?: number | null }) => options?.hintBuildNumber ?? null,
  }));
  vi.doMock('../../src/app/update_flow.ts', () => ({
    createUpdateFlow: () => ({
      canUseServiceWorker: () => true,
      supportsNotifications: () => true,
      postMessageToServiceWorker: async (message: unknown) => {
        swMessages.push(message);
        return true;
      },
      syncDailyStateToServiceWorker: async () => {},
      syncUpdatePolicyToServiceWorker: async () => {},
      ensureServiceWorkerUpdatePolicyConsistency: async () => {},
      requestServiceWorkerDailyCheck: async () => {},
      registerBackgroundDailyCheck: async () => {},
      clearAppliedUpdateHistoryActions: async () => {},
      fetchRemoteBuildNumber: async () => null,
      resolveUpdatableRemoteBuildNumber: async () => null,
      applyUpdateForBuild: async () => ({ applied: false }),
      checkForNewBuild: async () => null,
      registerServiceWorker: async () => {},
      bindServiceWorkerRuntimeEvents() {},
      bindServiceWorkerHistoryMessages: ({ onPayload }: { onPayload: (payload: unknown) => void }) => {
        onPayload({ entries: [] });
      },
      getRegistration: () => ({ scope: '/app/' }),
    }),
  }));
  vi.doMock('../../src/config.ts', () => ({
    ELEMENT_IDS: {
      APP: 'app',
      SETTINGS_VERSION: 'settingsVersion',
    },
  }));
  vi.doMock('../../src/icons.ts', () => ({
    BADGE_DEFINITIONS: {},
    ICONS: {},
    ICON_X: '<svg />',
  }));
  vi.doMock('../../src/plugins/runtime_plugins.ts', () => ({
    mountRuntimePlugins: async () => {
      mountedPlugins += 1;
    },
    resolveServiceWorkerRegistrationUrl: () => '/sw.js',
  }));
  vi.doMock('../../src/runtime/create_runtime.ts', () => ({
    createRuntime: (options: {
      effects: {
        onDailySolvedDateChanged: (dailyId: string) => void;
        onLowPowerModeSuggestion: () => void;
      };
    }) => ({
      start() {
        runtimeStartCalls += 1;
        options.effects.onDailySolvedDateChanged('2026-03-13');
        options.effects.onLowPowerModeSuggestion();
      },
      destroy() {
        runtimeDestroyCalls += 1;
      },
      emitIntent(intent: unknown) {
        emittedIntents.push(intent);
      },
      refreshLocalizationUi() {
        runtimeRefreshLocalizationCalls += 1;
      },
      readDebugDailyFreezeState: () => ({ frozen: false }),
      toggleDebugForceDailyFrozen: () => ({ frozen: true }),
    }),
  }));
  vi.doMock('../../src/runtime/default_adapters.ts', () => ({
    createDefaultAdapters: () => ({
      core: {
        isDailyAbsIndex: () => false,
        isInfiniteAbsIndex: () => false,
        getDailyAbsIndex: () => 5,
      },
      state: {
        getSnapshot: () => ({
          levelIndex: 0,
          path: [{ r: 0, c: 0 }],
          totalUsable: 3,
        }),
      },
      persistence: {
        readBootState: () => ({
          theme: 'dark',
          lowPowerModeEnabled: false,
          hiddenPanels: {
            guide: false,
            legend: false,
          },
          campaignProgress: 0,
          infiniteProgress: 0,
          dailySolvedDate: null,
          sessionBoard: null,
        }),
      },
      renderer: {},
      input: {},
    }),
  }));
  vi.doMock('../../src/runtime/intents.ts', () => ({
    UI_ACTIONS: {
      LEVEL_SELECT: 'level/select',
    },
    uiActionIntent: (actionType: string, payload: Record<string, unknown>) => ({
      type: 'ui.action',
      payload: {
        actionType,
        ...payload,
      },
    }),
  }));
  vi.doMock('../../src/runtime/update_flow_policy.ts', () => ({
    UPDATE_APPLY_STATUS: {},
    UPDATE_CHECK_DECISION: {},
    resolveUpdateCheckDecision: () => 'none',
    shouldResyncManualUpdatePolicy: () => false,
  }));
  vi.doMock('../../src/shared/paths.ts', () => ({
    DAILY_PAYLOAD_FILE: 'daily.json',
  }));
  vi.doMock('../../src/app_shell_markup.tsx', () => ({
    AppShell: () => null,
  }));
  vi.doMock('../../src/styles.ts', () => ({
    mountStyles() {},
  }));
  vi.doMock('../../src/templates.ts', () => ({
    buildLegendTemplate: () => '<div />',
  }));

  t.after(() => {
    globals.restore();
    vi.resetModules();
    vi.doUnmock('preact');
    vi.doUnmock('../../src/app/daily_payload_service.ts');
    vi.doUnmock('../../src/app/locale_controller.ts');
    vi.doUnmock('../../src/app/notification_preferences.ts');
    vi.doUnmock('../../src/app/notification_center.ts');
    vi.doUnmock('../../src/app/update_build_resolver.ts');
    vi.doUnmock('../../src/app/update_flow.ts');
    vi.doUnmock('../../src/config.ts');
    vi.doUnmock('../../src/icons.ts');
    vi.doUnmock('../../src/plugins/runtime_plugins.ts');
    vi.doUnmock('../../src/runtime/create_runtime.ts');
    vi.doUnmock('../../src/runtime/default_adapters.ts');
    vi.doUnmock('../../src/runtime/intents.ts');
    vi.doUnmock('../../src/runtime/update_flow_policy.ts');
    vi.doUnmock('../../src/shared/paths.ts');
    vi.doUnmock('../../src/app_shell_markup.tsx');
    vi.doUnmock('../../src/styles.ts');
    vi.doUnmock('../../src/templates.ts');
  });

  const bootstrapModulePath = '../../src/app_impl.ts?case=bootstrap';
  await import(bootstrapModulePath);
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.ok(notificationOptions);
  const notification = notificationOptions as CapturedNotificationOptions;
  let applyClosed = false;
  let openClosed = false;
  await notification.onApplyUpdateRequested({
    buildNumber: 9,
    requestUpdateApplyConfirmation: async () => true,
    closeHistoryPanel: () => {
      applyClosed = true;
    },
  });
  await notification.onOpenDailyRequested({
    dailyId: '2026-03-13',
    kind: 'new-level',
    requestMoveDailyConfirmation: async () => true,
    closeHistoryPanel: () => {
      openClosed = true;
    },
  });
  await notification.onApplyUpdateRequested({
    buildNumber: 7,
    requestUpdateApplyConfirmation: async () => true,
    closeHistoryPanel: () => {},
  });
  await notification.onOpenDailyRequested({
    dailyId: '2026-03-13',
    kind: 'unsolved-warning',
    requestMoveDailyConfirmation: async () => false,
    closeHistoryPanel: () => {},
  });
  globals.emitWindowEvent('storage', { key: 'notifications' });
  globals.emitWindowEvent('online');
  globals.emitWindowEvent('offline');
  globals.emitWindowEvent('appinstalled');
  globals.emitWindowEvent('pagehide', { persisted: false });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(runtimeStartCalls, 1);
  assert.equal(runtimeDestroyCalls, 1);
  assert.equal(runtimeRefreshLocalizationCalls >= 1, true);
  assert.equal(mountedPlugins, 1);
  assert.equal(preloadLocaleCalls, 1);
  assert.equal(globals.settingsVersionEl.hidden, false);
  assert.match(globals.settingsVersionEl.textContent, /2026-03-08 00:00/);
  assert.ok(renderTarget);
  assert.equal(globals.body.classList.contains('isUpdateApplying'), false);
  assert.equal(swMessages.length > 0, true);
  assert.equal(globals.body.children.some((child) => child.className === 'appToast'), true);
  assert.deepEqual(handledStorageKeys, ['notifications']);
  assert.deepEqual(emittedIntents, []);
  assert.equal(applyClosed, true);
  assert.equal(openClosed, true);
  assert.equal(globals.reloadCalls >= 1, true);
});

test('app_impl returns early when the app root is missing', async (t) => {
  vi.resetModules();
  const globals = installAppGlobals(false);
  let runtimeCreated = false;

  vi.doMock('preact', () => ({
    h: () => null,
    render() {},
  }));
  vi.doMock('../../src/app/daily_payload_service.ts', () => ({
    createDailyPayloadService: () => ({
      resolveDailyBootPayload: async () => ({
        dailyId: null,
        hardInvalidateAtUtcMs: null,
        dailyLevel: null,
      }),
      setupDailyHardInvalidationWatcher() {},
      fetchDailyPayload: async () => null,
    }),
  }));
  vi.doMock('../../src/app/locale_controller.ts', () => ({
    createLocaleController: () => ({
      initialize: async () => 'en',
      createTranslator: () => (key: string) => key,
      getLocaleOptions: () => [],
      translateNow: (key: string) => key,
      getLocale: () => 'en',
      setLocale: async (locale: string) => locale,
      preloadAllLocales: async () => {},
    }),
  }));
  vi.doMock('../../src/app/notification_preferences.ts', () => ({
    AUTO_UPDATE_ENABLED_KEY: 'autoUpdate',
    NOTIFICATION_AUTO_PROMPT_DECISIONS: { UNSET: 'unset' },
    NOTIFICATION_ENABLED_KEY: 'notifications',
    createNotificationPreferences: () => ({
      readAutoPromptDecision: () => 'unset',
      writeAutoPromptDecision() {},
      readNotificationEnabledPreference: () => false,
      writeNotificationEnabledPreference() {},
      readAutoUpdateEnabledPreference: () => false,
      writeAutoUpdateEnabledPreference() {},
      readLastNotifiedRemoteBuildNumber: () => null,
      writeLastNotifiedRemoteBuildNumber() {},
      hasStoredNotificationEnabledPreference: () => false,
      notificationPermissionState: () => 'default',
    }),
  }));
  vi.doMock('../../src/app/notification_center.ts', () => ({
    createNotificationCenter: () => ({
      bind() {},
      refreshToggleUi() {},
      refreshHistoryUi() {},
      refreshLocalizedUi() {},
      applyHistoryPayload() {},
      getHistoryEntries: () => [],
      handleStorageEvent() {},
      maybeAutoPromptForNotifications: async () => {},
    }),
  }));
  vi.doMock('../../src/app/update_build_resolver.ts', () => ({
    resolveLatestUpdateBuildNumber: async () => null,
  }));
  vi.doMock('../../src/app/update_flow.ts', () => ({
    createUpdateFlow: () => ({
      canUseServiceWorker: () => false,
      supportsNotifications: () => false,
      postMessageToServiceWorker: async () => false,
      syncDailyStateToServiceWorker: async () => {},
      syncUpdatePolicyToServiceWorker: async () => {},
      ensureServiceWorkerUpdatePolicyConsistency: async () => {},
      requestServiceWorkerDailyCheck: async () => {},
      registerBackgroundDailyCheck: async () => {},
      clearAppliedUpdateHistoryActions: async () => {},
      fetchRemoteBuildNumber: async () => null,
      resolveUpdatableRemoteBuildNumber: async () => null,
      applyUpdateForBuild: async () => ({ applied: false }),
      checkForNewBuild: async () => null,
      registerServiceWorker: async () => {},
      bindServiceWorkerRuntimeEvents() {},
      bindServiceWorkerHistoryMessages() {},
      getRegistration: () => null,
    }),
  }));
  vi.doMock('../../src/config.ts', () => ({
    ELEMENT_IDS: {
      APP: 'app',
      SETTINGS_VERSION: 'settingsVersion',
    },
  }));
  vi.doMock('../../src/icons.ts', () => ({
    BADGE_DEFINITIONS: {},
    ICONS: {},
    ICON_X: '<svg />',
  }));
  vi.doMock('../../src/plugins/runtime_plugins.ts', () => ({
    mountRuntimePlugins: async () => {},
    resolveServiceWorkerRegistrationUrl: () => '/sw.js',
  }));
  vi.doMock('../../src/runtime/create_runtime.ts', () => ({
    createRuntime: () => {
      runtimeCreated = true;
      return {
        start() {},
        destroy() {},
        emitIntent() {},
      };
    },
  }));
  vi.doMock('../../src/runtime/default_adapters.ts', () => ({
    createDefaultAdapters: () => ({
      core: {},
      state: {},
      persistence: {
        readBootState: () => ({
          theme: 'dark',
          lowPowerModeEnabled: false,
          hiddenPanels: { guide: false, legend: false },
          campaignProgress: 0,
          infiniteProgress: 0,
          dailySolvedDate: null,
          sessionBoard: null,
        }),
      },
      renderer: {},
      input: {},
    }),
  }));
  vi.doMock('../../src/runtime/intents.ts', () => ({
    UI_ACTIONS: { LEVEL_SELECT: 'level/select' },
    uiActionIntent: () => ({ type: 'ui.action', payload: {} }),
  }));
  vi.doMock('../../src/runtime/update_flow_policy.ts', () => ({
    UPDATE_APPLY_STATUS: {},
    UPDATE_CHECK_DECISION: {},
    resolveUpdateCheckDecision: () => 'none',
    shouldResyncManualUpdatePolicy: () => false,
  }));
  vi.doMock('../../src/shared/paths.ts', () => ({
    DAILY_PAYLOAD_FILE: 'daily.json',
  }));
  vi.doMock('../../src/app_shell_markup.tsx', () => ({
    AppShell: () => null,
  }));
  vi.doMock('../../src/styles.ts', () => ({
    mountStyles() {},
  }));
  vi.doMock('../../src/templates.ts', () => ({
    buildLegendTemplate: () => '<div />',
  }));

  t.after(() => {
    globals.restore();
    vi.resetModules();
    vi.doUnmock('preact');
    vi.doUnmock('../../src/app/daily_payload_service.ts');
    vi.doUnmock('../../src/app/locale_controller.ts');
    vi.doUnmock('../../src/app/notification_preferences.ts');
    vi.doUnmock('../../src/app/notification_center.ts');
    vi.doUnmock('../../src/app/update_build_resolver.ts');
    vi.doUnmock('../../src/app/update_flow.ts');
    vi.doUnmock('../../src/config.ts');
    vi.doUnmock('../../src/icons.ts');
    vi.doUnmock('../../src/plugins/runtime_plugins.ts');
    vi.doUnmock('../../src/runtime/create_runtime.ts');
    vi.doUnmock('../../src/runtime/default_adapters.ts');
    vi.doUnmock('../../src/runtime/intents.ts');
    vi.doUnmock('../../src/runtime/update_flow_policy.ts');
    vi.doUnmock('../../src/shared/paths.ts');
    vi.doUnmock('../../src/app_shell_markup.tsx');
    vi.doUnmock('../../src/styles.ts');
    vi.doUnmock('../../src/templates.ts');
  });

  const noAppRootModulePath = '../../src/app_impl.ts?case=no-app-root';
  await import(noAppRootModulePath);
  await Promise.resolve();

  assert.equal(runtimeCreated, false);
});
