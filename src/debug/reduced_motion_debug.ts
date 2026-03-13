const DEBUG_REDUCED_MOTION_FLAG = 'TETHER_DEBUG_SIMULATE_REDUCED_MOTION';
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';
const MATCH_MEDIA_PATCH_FLAG = '__tetherDebugReducedMotionPatchApplied';

export const DEBUG_REDUCED_MOTION_CLASS = 'isDebugReducedMotion';

interface MatchMediaResultLike {
  matches: boolean;
}

interface ReducedMotionDebugScope {
  matchMedia?: (query: string) => MatchMediaResultLike;
  [DEBUG_REDUCED_MOTION_FLAG]?: boolean;
  [MATCH_MEDIA_PATCH_FLAG]?: boolean;
}

const normalizeMediaQuery = (query: unknown): string =>
  String(query || '').trim().replaceAll(/\s+/g, ' ');

const isReducedMotionQuery = (query: unknown): boolean =>
  normalizeMediaQuery(query) === REDUCED_MOTION_MEDIA_QUERY;

const resolveDebugScope = (): ReducedMotionDebugScope => (
  (typeof window === 'undefined' ? globalThis : window) as ReducedMotionDebugScope
);

const toggleReducedMotionClass = (target: { classList?: { toggle?: (token: string, force?: boolean) => void } } | null | undefined, enabled: boolean): void => {
  if (!target?.classList || typeof target.classList.toggle !== 'function') return;
  target.classList.toggle(DEBUG_REDUCED_MOTION_CLASS, enabled);
};

const wrapReducedMotionQuery = (
  query: MatchMediaResultLike,
  mediaQuery: string,
): MatchMediaResultLike => {
  if (!query || !isReducedMotionQuery(mediaQuery)) return query;
  return Object.defineProperty(Object.create(query), 'matches', {
    configurable: true,
    enumerable: true,
    get() {
      return readDebugReducedMotionSimulation() || Boolean(query.matches);
    },
  });
};

const ensureMatchMediaPatched = (): void => {
  const scope = resolveDebugScope();
  if (!scope || typeof scope.matchMedia !== 'function') return;
  if (scope[MATCH_MEDIA_PATCH_FLAG]) return;

  const originalMatchMedia = scope.matchMedia.bind(scope);
  scope.matchMedia = (query) => {
    const mediaQuery = String(query || '');
    return wrapReducedMotionQuery(originalMatchMedia(mediaQuery), mediaQuery);
  };
  scope[MATCH_MEDIA_PATCH_FLAG] = true;
};

export const readDebugReducedMotionSimulation = () => (
  Boolean(resolveDebugScope()?.[DEBUG_REDUCED_MOTION_FLAG])
);

export const syncDebugReducedMotionSimulationClass = (): boolean => {
  const enabled = readDebugReducedMotionSimulation();
  if (typeof document !== 'undefined') {
    toggleReducedMotionClass(document.documentElement, enabled);
    toggleReducedMotionClass(document.body, enabled);
  }
  return enabled;
};

export const setDebugReducedMotionSimulation = (enabled: boolean): boolean => {
  const scope = resolveDebugScope();
  ensureMatchMediaPatched();
  scope[DEBUG_REDUCED_MOTION_FLAG] = Boolean(enabled);
  return syncDebugReducedMotionSimulationClass();
};
