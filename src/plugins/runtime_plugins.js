const SW_PLUGIN_QUERY_PARAM = 'plugin';
const DEV_SW_PLUGIN_SCRIPT = '/src/debug/sw_debug_plugin.js';

const hasWindow = () => typeof window !== 'undefined';

export const resolveServiceWorkerRegistrationUrl = (isLocalhostHostname) => {
  const baseUrl = hasWindow() ? window.location.href : 'http://localhost/';
  const swUrl = new URL('sw.js', baseUrl);
  if (
    import.meta.env.DEV
    && hasWindow()
    && typeof isLocalhostHostname === 'function'
    && isLocalhostHostname(window.location.hostname)
  ) {
    swUrl.searchParams.set(SW_PLUGIN_QUERY_PARAM, DEV_SW_PLUGIN_SCRIPT);
  }
  return swUrl;
};

const mountDevRuntimePlugins = async (host = {}) => {
  if (typeof import.meta === 'undefined' || !import.meta.env || !import.meta.env.DEV) return;
  if (!hasWindow()) return;
  if (typeof host.isLocalhostHostname !== 'function') return;
  if (!host.isLocalhostHostname(window.location.hostname)) return;

  try {
    const debugPlugin = await import('../debug/runtime_debug_plugin.js');
    if (!debugPlugin || typeof debugPlugin.mountDebugRuntimePlugin !== 'function') return;
    debugPlugin.mountDebugRuntimePlugin(host);
  } catch {
    // Runtime plugin loading is best effort on localhost.
  }
};

export const mountRuntimePlugins = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
  ? mountDevRuntimePlugins
  : async () => { };
