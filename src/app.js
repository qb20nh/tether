import { mountStyles } from './styles.js';
import { APP_SHELL_TEMPLATE, buildLegendTemplate } from './templates.js';
import { BADGE_DEFINITIONS, ICONS, ICON_X } from './icons.js';
import { ELEMENT_IDS } from './config.js';
import {
  getLocaleOptions,
  getLocale,
  resolveLocale,
  setLocale,
  t as createTranslator,
} from './i18n.js';
import { createDefaultAdapters } from './runtime/default_adapters.js';
import { createRuntime } from './runtime/create_runtime.js';

const DAILY_PAYLOAD_URL = './daily/today.json';
const DAILY_HARD_INVALIDATE_GRACE_MS = 60 * 1000;

let runtimeInstance = null;

const utcDateIdFromMs = (ms) => {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeGrid = (grid) => {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const out = [];
  let cols = null;
  for (const row of grid) {
    if (typeof row !== 'string' || row.length === 0) return null;
    if (cols === null) cols = row.length;
    if (row.length !== cols) return null;
    out.push(row);
  }
  return out;
};

const normalizePairs = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    out.push([a, b]);
  }
  return out;
};

const normalizeCornerCounts = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 3) return null;
    const a = Number.parseInt(entry[0], 10);
    const b = Number.parseInt(entry[1], 10);
    const c = Number.parseInt(entry[2], 10);
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return null;
    out.push([a, b, c]);
  }
  return out;
};

const normalizeDailyPayload = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const dailyId = typeof raw.dailyId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyId)
    ? raw.dailyId
    : null;
  if (!dailyId) return null;

  const hardInvalidateAtUtcMs = Number.parseInt(raw.hardInvalidateAtUtcMs, 10);
  if (!Number.isInteger(hardInvalidateAtUtcMs) || hardInvalidateAtUtcMs <= 0) return null;

  const levelRaw = raw.level;
  if (!levelRaw || typeof levelRaw !== 'object') return null;
  const grid = normalizeGrid(levelRaw.grid);
  const stitches = normalizePairs(levelRaw.stitches);
  const cornerCounts = normalizeCornerCounts(levelRaw.cornerCounts);
  if (!grid || !stitches || !cornerCounts) return null;

  const dailySlot = Number.parseInt(raw.dailySlot, 10);
  const generatedAtUtcMs = Number.parseInt(raw.generatedAtUtcMs, 10);

  return {
    schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0,
    poolVersion: typeof raw.poolVersion === 'string' ? raw.poolVersion : '',
    dailyId,
    dailySlot: Number.isInteger(dailySlot) ? dailySlot : null,
    canonicalKey: typeof raw.canonicalKey === 'string' ? raw.canonicalKey : '',
    generatedAtUtcMs: Number.isInteger(generatedAtUtcMs) ? generatedAtUtcMs : null,
    hardInvalidateAtUtcMs,
    level: {
      name: typeof levelRaw.name === 'string' ? levelRaw.name : `Daily ${dailyId}`,
      grid,
      stitches,
      cornerCounts,
    },
  };
};

const fetchDailyPayload = async ({ bypassCache = false } = {}) => {
  try {
    const headers = bypassCache
      ? { 'x-bypass-cache': 'true' }
      : undefined;
    const response = await fetch(DAILY_PAYLOAD_URL, {
      cache: bypassCache ? 'no-store' : 'default',
      headers,
    });

    if (!response.ok) return null;
    const parsed = normalizeDailyPayload(await response.json());
    return parsed;
  } catch {
    return null;
  }
};

const resolveDailyBootPayload = async () => {
  const nowMs = Date.now();
  const todayId = utcDateIdFromMs(nowMs);

  let payload = await fetchDailyPayload();
  if (!payload) {
    return {
      dailyLevel: null,
      dailyId: null,
      hardInvalidateAtUtcMs: null,
      stalePayload: null,
    };
  }

  if (payload.dailyId > todayId) {
    return {
      dailyLevel: null,
      dailyId: null,
      hardInvalidateAtUtcMs: payload.hardInvalidateAtUtcMs,
      stalePayload: payload,
    };
  }

  if (payload.dailyId !== todayId && nowMs > (payload.hardInvalidateAtUtcMs + DAILY_HARD_INVALIDATE_GRACE_MS)) {
    const bypassPayload = await fetchDailyPayload({ bypassCache: true });
    if (bypassPayload) payload = bypassPayload;
  }

  if (payload.dailyId !== todayId) {
    return {
      dailyLevel: null,
      dailyId: null,
      hardInvalidateAtUtcMs: payload.hardInvalidateAtUtcMs,
      stalePayload: payload,
    };
  }

  return {
    dailyLevel: payload.level,
    dailyId: payload.dailyId,
    hardInvalidateAtUtcMs: payload.hardInvalidateAtUtcMs,
    stalePayload: null,
  };
};

const setupDailyHardInvalidationWatcher = (bootDaily) => {
  if (!bootDaily || !Number.isInteger(bootDaily.hardInvalidateAtUtcMs)) return;

  const thresholdMs = bootDaily.hardInvalidateAtUtcMs + DAILY_HARD_INVALIDATE_GRACE_MS;
  const shouldBypassNow = () => Date.now() > thresholdMs;

  const maybeRefetch = async () => {
    if (!shouldBypassNow()) return;

    const nowMs = Date.now();
    const todayId = utcDateIdFromMs(nowMs);
    const bypassPayload = await fetchDailyPayload({ bypassCache: true });
    if (!bypassPayload || bypassPayload.dailyId !== todayId) return;

    if (bootDaily.dailyId !== bypassPayload.dailyId) {
      window.location.reload();
    }
  };

  const delay = thresholdMs - Date.now();
  if (delay > 0) {
    window.setTimeout(() => {
      void maybeRefetch();
    }, delay + 25);
  } else {
    void maybeRefetch();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void maybeRefetch();
  });
};

export async function initTetherApp() {
  mountStyles();

  const appEl = document.getElementById(ELEMENT_IDS.APP);
  if (!appEl) return;

  const bootDaily = await resolveDailyBootPayload();
  setupDailyHardInvalidationWatcher(bootDaily);

  const initialLocale = resolveLocale();
  const translate = createTranslator(initialLocale);

  appEl.innerHTML = APP_SHELL_TEMPLATE(
    translate,
    getLocaleOptions(initialLocale),
    initialLocale,
  );

  const adapters = createDefaultAdapters({
    icons: ICONS,
    iconX: ICON_X,
    dailyLevel: bootDaily.dailyLevel,
    dailyId: bootDaily.dailyId,
  });

  runtimeInstance = createRuntime({
    appEl,
    core: adapters.core,
    state: adapters.state,
    persistence: adapters.persistence,
    renderer: adapters.renderer,
    input: adapters.input,
    i18n: {
      getLocaleOptions,
      getLocale,
      resolveLocale,
      setLocale,
      createTranslator,
    },
    ui: {
      buildLegendTemplate,
      badgeDefinitions: BADGE_DEFINITIONS,
      icons: ICONS,
      iconX: ICON_X,
    },
    dailyHardInvalidateAtUtcMs: bootDaily.hardInvalidateAtUtcMs,
  });

  runtimeInstance.start();
}

void initTetherApp();
