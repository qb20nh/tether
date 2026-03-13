import assert from 'node:assert/strict';
import test from '../test.ts';
import { vi } from 'vitest';

type PanelOptions = {
  triggerSystemNotification: (payload?: { kind?: string }) => Promise<boolean>;
  clearNotifications: () => Promise<boolean>;
  runDailyCheck: () => Promise<boolean>;
  fetchDailyPayload: () => Promise<unknown>;
  readDailyDebugSnapshot: () => unknown;
  toggleForceDailyFrozenState: () => unknown;
  reloadApp: () => void;
};

test('runtime plugins resolve localhost service worker urls and mount debug plugin in dev', async (t) => {
  vi.resetModules();
  const mountedHosts: unknown[] = [];
  vi.stubGlobal('window', {
    location: {
      href: 'http://localhost:5173/app/',
      hostname: 'localhost',
    },
  });
  vi.doMock('../../src/debug/runtime_debug_plugin.ts', () => ({
    mountDebugRuntimePlugin: (host: unknown) => {
      mountedHosts.push(host);
    },
  }));
  t.after(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('../../src/debug/runtime_debug_plugin.ts');
  });

  const mod = await import('../../src/plugins/runtime_plugins.ts');
  const url = mod.resolveServiceWorkerRegistrationUrl((hostname) => hostname === 'localhost');
  assert.equal(url.searchParams.get('plugin'), '/src/debug/sw_debug_plugin.ts');

  await mod.mountRuntimePlugins({
    isLocalhostHostname: (hostname: string) => hostname === 'localhost',
  });
  assert.equal(mountedHosts.length, 1);
});

test('runtime debug plugin wires panel actions through the host', async (t) => {
  vi.resetModules();
  let panelOptions: PanelOptions | null = null;
  vi.doMock('../../src/debug/local_debug_panel.ts', () => ({
    mountLocalDebugPanel: (options: PanelOptions) => {
      panelOptions = options;
    },
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/debug/local_debug_panel.ts');
  });

  const toasts: unknown[] = [];
  const calls: unknown[] = [];
  const mod = await import('../../src/debug/runtime_debug_plugin.ts');
  mod.mountDebugRuntimePlugin({
    canUseServiceWorker: () => true,
    requestNotificationPermission: async () => 'granted',
    postMessageToServiceWorker: async (message) => {
      calls.push(message);
      return true;
    },
    showToast: (payload) => toasts.push(payload),
    fetchDailyPayload: async () => ({ ok: true }),
    readDailyDebugSnapshot: () => ({ frozen: false }),
    toggleForceDailyFrozenState: () => ({ frozen: true }),
    reloadApp: () => {
      calls.push('reload');
    },
  });
  assert.ok(panelOptions);
  const panel = panelOptions as PanelOptions;
  assert.equal(await panel.triggerSystemNotification({ kind: 'new-level' }), true);
  assert.equal(await panel.clearNotifications(), true);
  assert.equal(await panel.runDailyCheck(), true);
  assert.deepEqual(await panel.fetchDailyPayload(), { ok: true });
  assert.deepEqual(panel.readDailyDebugSnapshot(), { frozen: false });
  assert.deepEqual(panel.toggleForceDailyFrozenState(), { frozen: true });
  panel.reloadApp();
  assert.equal(calls.length >= 4, true);
  assert.deepEqual(toasts, []);
});

test('runtime debug plugin falls back safely when service worker hooks are unavailable', async (t) => {
  vi.resetModules();
  let panelOptions: PanelOptions | null = null;
  vi.doMock('../../src/debug/local_debug_panel.ts', () => ({
    mountLocalDebugPanel: (options: PanelOptions) => {
      panelOptions = options;
    },
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/debug/local_debug_panel.ts');
  });

  const mod = await import('../../src/debug/runtime_debug_plugin.ts');
  mod.mountDebugRuntimePlugin({
    canUseServiceWorker: () => false,
    requestNotificationPermission: async () => 'denied',
  });
  assert.ok(panelOptions);
  const panel = panelOptions as PanelOptions;
  assert.equal(await panel.triggerSystemNotification({ kind: 'unsolved-warning' }), false);
  assert.equal(await panel.clearNotifications(), false);
  assert.equal(await panel.runDailyCheck(), false);
  assert.equal(await panel.fetchDailyPayload(), null);
  assert.equal(panel.readDailyDebugSnapshot(), null);
});

test('service-worker debug plugin registers handlers and respects guards', async (t) => {
  const registered: Record<string, (payload?: { payload?: Record<string, unknown> }) => Promise<boolean>>[] = [];
  const writes: unknown[] = [];
  vi.stubGlobal('self', {
    __tetherRegisterSwPlugin: (plugins: Record<string, (payload?: { payload?: Record<string, unknown> }) => Promise<boolean>>) => {
      registered.push(plugins);
    },
    __tetherSwPluginApi: {
      isLocalhostHostname: (hostname: string) => hostname === 'localhost',
      normalizeString: (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback,
      normalizeSystemNotificationKind: (kind: string) => kind,
      readDailyState: async () => ({ dailyId: '2026-01-01', newLevelDailyId: null, warnedDailyId: null }),
      emitSystemNotification: async () => true,
      writeDailyState: async (state: unknown) => {
        writes.push(state);
      },
      closeVisibleNotifications: async () => {
        writes.push('closed');
      },
      clearHistoryEntries: async () => {
        writes.push('cleared');
      },
    },
    location: { hostname: 'localhost' },
    registration: {
      showNotification: async () => {},
    },
  });
  vi.stubGlobal('Notification', {
    permission: 'granted',
  });
  t.after(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const modulePath = '../../src/debug/sw_debug_plugin.ts?case=a';
  await import(modulePath);
  assert.equal(registered.length, 1);
  assert.equal(await registered[0].SW_DEBUG_TRIGGER_NOTIFICATION?.({ payload: { kind: 'new-level' } }), true);
  assert.equal(await registered[0].SW_DEBUG_CLEAR_NOTIFICATIONS?.(), true);
  assert.equal(writes.some((entry) => entry === 'closed'), true);
  assert.equal(writes.some((entry) => entry === 'cleared'), true);
});
