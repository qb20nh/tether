import { normalizeDailyPayload } from '../shared/daily_payload_schema.ts';
import { utcDateIdFromMs } from '../shared/utc_date.ts';
import type {
  DocumentLike,
  LevelDefinition,
} from '../contracts/ports.ts';

interface DailyPayload {
  dailyId: string;
  hardInvalidateAtUtcMs: number;
  level: LevelDefinition;
}

interface BootDailyPayload {
  dailyLevel: LevelDefinition | null;
  dailyId: string | null;
  hardInvalidateAtUtcMs: number | null;
  stalePayload: DailyPayload | null;
}

interface DailyPayloadServiceOptions {
  dailyPayloadUrl: string;
  dailyHardInvalidateGraceMs?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<{
    ok: boolean;
    json: () => Promise<unknown>;
  }> | null;
  now?: () => number;
  windowObj?: {
    location?: { reload?: () => void };
    setTimeout: (handler: () => void, timeout?: number) => unknown;
  } | undefined;
  documentObj?: (DocumentLike & { visibilityState?: string }) | undefined;
  reloadApp?: () => void;
}

const normalizeDailyPayloadTyped = normalizeDailyPayload as (raw: unknown) => DailyPayload | null;

export function createDailyPayloadService(options: DailyPayloadServiceOptions) {
  const {
    dailyPayloadUrl,
    dailyHardInvalidateGraceMs = 60 * 1000,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    now = () => Date.now(),
    windowObj = typeof window === 'undefined' ? undefined : window,
    documentObj = typeof document === 'undefined' ? undefined : document,
    reloadApp = () => {
      if (windowObj?.location && typeof windowObj.location.reload === 'function') {
        windowObj.location.reload();
      }
    },
  } = options;

  if (typeof dailyPayloadUrl !== 'string' || dailyPayloadUrl.length === 0) {
    throw new Error('createDailyPayloadService requires dailyPayloadUrl');
  }

  const resolveDailyPayloadRequestUrl = ({ bypassCache = false }: { bypassCache?: boolean } = {}): string => {
    const url = new URL(dailyPayloadUrl);
    url.searchParams.set('_daily', new Date().toISOString().slice(0, 10));
    if (bypassCache) {
      url.searchParams.set('_dailycb', String(now()));
    }
    return url.toString();
  };

  const fetchDailyPayload = async ({ bypassCache = false }: { bypassCache?: boolean } = {}): Promise<DailyPayload | null> => {
    if (typeof fetchImpl !== 'function') return null;

    try {
      const response = await fetchImpl(resolveDailyPayloadRequestUrl({ bypassCache }), {
        cache: 'no-store',
        headers: {
          'x-bypass-cache': 'true',
        },
      });

      if (!response) return null;
      if (!response.ok) return null;
      const parsed = normalizeDailyPayloadTyped(await response.json());
      return parsed;
    } catch {
      return null;
    }
  };

  const resolveDailyBootPayload = async (): Promise<BootDailyPayload> => {
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

  const setupDailyHardInvalidationWatcher = (
    bootDaily: Pick<BootDailyPayload, 'dailyId' | 'hardInvalidateAtUtcMs'> | null | undefined,
  ): void => {
    const hardInvalidateAtUtcMs = (
      bootDaily && Number.isInteger(bootDaily.hardInvalidateAtUtcMs)
        ? bootDaily.hardInvalidateAtUtcMs
        : null
    );
    if (!bootDaily || hardInvalidateAtUtcMs === null) return;
    if (!windowObj || !documentObj) return;

    const thresholdMs = hardInvalidateAtUtcMs + dailyHardInvalidateGraceMs;
    const shouldBypassNow = () => now() > thresholdMs;

    const maybeRefetch = async () => {
      if (!shouldBypassNow()) return;

      const nowMs = now();
      const todayId = utcDateIdFromMs(nowMs);
      const bypassPayload = await fetchDailyPayload({ bypassCache: true });
      if (bypassPayload?.dailyId !== todayId) return;

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
      if ((documentObj.visibilityState || '') !== 'visible') return;
      void maybeRefetch();
    });
  };

  return {
    fetchDailyPayload,
    resolveDailyBootPayload,
    setupDailyHardInvalidationWatcher,
  };
}

export { normalizeDailyPayload } from '../shared/daily_payload_schema.ts';
export { utcDateIdFromMs } from '../shared/utc_date.ts';
