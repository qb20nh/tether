const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

export const isReducedMotionPreferred = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return Boolean(window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches);
};
