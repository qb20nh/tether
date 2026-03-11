const DEBUG_REDUCED_MOTION_FLAG = 'TETHER_DEBUG_SIMULATE_REDUCED_MOTION';
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';
const MATCH_MEDIA_PATCH_FLAG = '__tetherDebugReducedMotionPatchApplied';

export const DEBUG_REDUCED_MOTION_CLASS = 'isDebugReducedMotion';

const normalizeMediaQuery = (query) => String(query || '').trim().replaceAll(/\s+/g, ' ');

const isReducedMotionQuery = (query) => normalizeMediaQuery(query) === REDUCED_MOTION_MEDIA_QUERY;

const resolveDebugScope = () => (
  typeof window === 'undefined' ? globalThis : window
);

const toggleReducedMotionClass = (target, enabled) => {
  if (!target?.classList || typeof target.classList.toggle !== 'function') return;
  target.classList.toggle(DEBUG_REDUCED_MOTION_CLASS, enabled);
};

const wrapReducedMotionQuery = (query, mediaQuery) => {
  if (!query || !isReducedMotionQuery(mediaQuery)) return query;
  return Object.defineProperty(Object.create(query), 'matches', {
    configurable: true,
    enumerable: true,
    get() {
      return readDebugReducedMotionSimulation() || Boolean(query.matches);
    },
  });
};

const ensureMatchMediaPatched = () => {
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

export const syncDebugReducedMotionSimulationClass = () => {
  const enabled = readDebugReducedMotionSimulation();
  if (typeof document !== 'undefined') {
    toggleReducedMotionClass(document.documentElement, enabled);
    toggleReducedMotionClass(document.body, enabled);
  }
  return enabled;
};

export const setDebugReducedMotionSimulation = (enabled) => {
  const scope = resolveDebugScope();
  ensureMatchMediaPatched();
  scope[DEBUG_REDUCED_MOTION_FLAG] = Boolean(enabled);
  return syncDebugReducedMotionSimulationClass();
};
