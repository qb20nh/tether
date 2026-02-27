// src/math.js
export const pointsMatch = (a, b) => a && b && a.r === b.r && a.c === b.c;

export const cellDistance = (a, b) => {
    if (!a || !b) return 1;
    return Math.hypot(a.r - b.r, a.c - b.c);
};

export const clampUnit = (value) => Math.max(0, Math.min(1, value));

export const normalizeAngle = (angle) => {
    const TAU = Math.PI * 2;
    const normalized = angle % TAU;
    return normalized >= 0 ? normalized : normalized + TAU;
};

export const angleDeltaSigned = (from, to) => {
    const TAU = Math.PI * 2;
    const delta = normalizeAngle(to - from);
    return delta > Math.PI ? delta - TAU : delta;
};

export const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
