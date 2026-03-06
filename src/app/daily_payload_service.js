export const utcDateIdFromMs = (ms) => {
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

export const normalizeDailyPayload = (raw) => {
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

export function createDailyPayloadService(options = {}) {
  const {
    dailyPayloadUrl,
    dailyHardInvalidateGraceMs = 60 * 1000,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    now = () => Date.now(),
    windowObj = typeof window !== 'undefined' ? window : undefined,
    documentObj = typeof document !== 'undefined' ? document : undefined,
    reloadApp = () => {
      if (windowObj?.location && typeof windowObj.location.reload === 'function') {
        windowObj.location.reload();
      }
    },
  } = options;

  if (typeof dailyPayloadUrl !== 'string' || dailyPayloadUrl.length === 0) {
    throw new Error('createDailyPayloadService requires dailyPayloadUrl');
  }

  const resolveDailyPayloadRequestUrl = ({ bypassCache = false } = {}) => {
    const url = new URL(dailyPayloadUrl);
    url.searchParams.set('_daily', new Date().toISOString().slice(0, 10));
    if (bypassCache) {
      url.searchParams.set('_dailycb', String(now()));
    }
    return url.toString();
  };

  const fetchDailyPayload = async ({ bypassCache = false } = {}) => {
    if (typeof fetchImpl !== 'function') return null;

    try {
      const response = await fetchImpl(resolveDailyPayloadRequestUrl({ bypassCache }), {
        cache: 'no-store',
        headers: {
          'x-bypass-cache': 'true',
        },
      });

      if (!response.ok) return null;
      const parsed = normalizeDailyPayload(await response.json());
      return parsed;
    } catch {
      return null;
    }
  };

  const resolveDailyBootPayload = async () => {
    const nowMs = now();
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

    if (payload.dailyId !== todayId && nowMs > (payload.hardInvalidateAtUtcMs + dailyHardInvalidateGraceMs)) {
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
    if (!windowObj || !documentObj) return;

    const thresholdMs = bootDaily.hardInvalidateAtUtcMs + dailyHardInvalidateGraceMs;
    const shouldBypassNow = () => now() > thresholdMs;

    const maybeRefetch = async () => {
      if (!shouldBypassNow()) return;

      const nowMs = now();
      const todayId = utcDateIdFromMs(nowMs);
      const bypassPayload = await fetchDailyPayload({ bypassCache: true });
      if (!bypassPayload || bypassPayload.dailyId !== todayId) return;

      if (bootDaily.dailyId !== bypassPayload.dailyId) {
        reloadApp();
      }
    };

    const delay = thresholdMs - now();
    if (delay > 0) {
      windowObj.setTimeout(() => {
        void maybeRefetch();
      }, delay + 25);
    } else {
      void maybeRefetch();
    }

    documentObj.addEventListener('visibilitychange', () => {
      if (documentObj.visibilityState !== 'visible') return;
      void maybeRefetch();
    });
  };

  return {
    fetchDailyPayload,
    resolveDailyBootPayload,
    setupDailyHardInvalidationWatcher,
  };
}
