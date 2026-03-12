import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPathAnimationEngine,
  resolveHeadShiftTransitionWindow,
  resolveTipArrivalSyntheticPrevPath,
} from '../../src/renderer/path_animation_engine.ts';

test('resolveHeadShiftTransitionWindow returns pure head-shift window', () => {
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ];
  const nextPath = [
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ];

  assert.deepEqual(resolveHeadShiftTransitionWindow(nextPath, previousPath), {
    shiftCount: 1,
    nextStart: 1,
    prevStart: 0,
    overlap: 3,
    isFullLengthOverlap: true,
    isPureHeadShift: true,
  });
});

test('resolveHeadShiftTransitionWindow returns mixed retract+advance window', () => {
  const previousPath = [
    { r: 0, c: 0 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 0, c: 1 },
  ];
  const nextPath = [
    { r: 1, c: 2 },
    { r: 1, c: 1 },
    { r: 0, c: 1 },
  ];

  assert.deepEqual(resolveHeadShiftTransitionWindow(nextPath, previousPath), {
    shiftCount: -1,
    nextStart: 1,
    prevStart: 2,
    overlap: 2,
    isFullLengthOverlap: false,
    isPureHeadShift: false,
  });
});

test('resolveHeadShiftTransitionWindow falls back to single-overlap head-changed transition', () => {
  const previousPath = [
    { r: 0, c: 0 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 0, c: 1 },
    { r: 0, c: 2 },
  ];
  const nextPath = [
    { r: 2, c: 1 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 0, c: 2 },
  ];

  assert.deepEqual(resolveHeadShiftTransitionWindow(nextPath, previousPath), {
    shiftCount: -1,
    nextStart: 1,
    prevStart: 2,
    overlap: 1,
    isFullLengthOverlap: false,
    isPureHeadShift: false,
  });
});

test('resolveHeadShiftTransitionWindow does not use single-overlap fallback when head is unchanged', () => {
  const previousPath = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
  ];
  const nextPath = [
    { r: 0, c: 0 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 2, c: 1 },
  ];

  assert.equal(resolveHeadShiftTransitionWindow(nextPath, previousPath), null);
});

test('resolveTipArrivalSyntheticPrevPath uses start hint to synthesize the previous tip step', () => {
  const nextPath = [
    { r: 0, c: 1 },
    { r: 0, c: 2 },
    { r: 0, c: 3 },
  ];

  assert.deepEqual(
    resolveTipArrivalSyntheticPrevPath('start', nextPath, nextPath, {
      side: 'start',
      from: { r: 0, c: 0 },
      to: { r: 0, c: 1 },
    }),
    [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 0, c: 3 },
    ],
  );
});

test('resolveTipArrivalSyntheticPrevPath trims the changed end tip on equal-length transitions', () => {
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
  ];
  const nextPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 2, c: 2 },
  ];

  assert.deepEqual(
    resolveTipArrivalSyntheticPrevPath('end', previousPath, nextPath),
    [
      { r: 1, c: 1 },
      { r: 1, c: 2 },
    ],
  );
});

test('resolveTipArrivalSyntheticPrevPath reconstructs a prior start step for multi-cell advance', () => {
  const previousPath = [
    { r: 2, c: 2 },
    { r: 2, c: 3 },
  ];
  const nextPath = [
    { r: 2, c: 0 },
    { r: 2, c: 1 },
    { r: 2, c: 2 },
    { r: 2, c: 3 },
  ];

  assert.deepEqual(
    resolveTipArrivalSyntheticPrevPath('start', previousPath, nextPath),
    [
      { r: 2, c: 1 },
      { r: 2, c: 2 },
      { r: 2, c: 3 },
    ],
  );
});

test('resolveTipArrivalSyntheticPrevPath restores the previous start tip for multi-cell retract', () => {
  const previousPath = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 0, c: 2 },
    { r: 0, c: 3 },
  ];
  const nextPath = [
    { r: 0, c: 2 },
    { r: 0, c: 3 },
  ];

  assert.deepEqual(
    resolveTipArrivalSyntheticPrevPath('start', previousPath, nextPath),
    [
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 0, c: 3 },
    ],
  );
});

test('drawAll schedules animation frame when delegate signals animation', () => {
  const frameQueue = [];
  const engine = createPathAnimationEngine({
    requestFrame: (cb) => {
      frameQueue.push(cb);
      return frameQueue.length;
    },
    cancelFrame: () => { },
  });

  engine.drawAll(
    { path: [{ r: 0, c: 0 }] },
    {},
    {},
    null,
    null,
    () => ({ shouldAnimate: true }),
  );

  assert.equal(frameQueue.length, 1);
});

test('drawAll does not schedule animation frame when delegate signals idle', () => {
  const frameQueue = [];
  const engine = createPathAnimationEngine({
    requestFrame: (cb) => {
      frameQueue.push(cb);
      return frameQueue.length;
    },
    cancelFrame: () => { },
  });

  engine.drawAll(
    { path: [{ r: 0, c: 0 }] },
    {},
    {},
    null,
    null,
    () => ({ shouldAnimate: false }),
  );

  assert.equal(frameQueue.length, 0);
});

test('setPathFlowFreezeImmediate and notifyInteractiveResize forward to hooks', () => {
  let frozenValue = null;
  let notified = 0;
  const engine = createPathAnimationEngine({
    onSetPathFlowFreezeImmediate: (frozen) => {
      frozenValue = frozen;
    },
    onNotifyInteractiveResize: () => {
      notified += 1;
    },
  });

  engine.setPathFlowFreezeImmediate(true);
  engine.notifyInteractiveResize();

  assert.equal(frozenValue, true);
  assert.equal(notified, 1);
});

test('drawAnimatedPath delegates to provided callback payload', () => {
  const calls = [];
  const engine = createPathAnimationEngine();

  engine.drawAnimatedPath(
    { path: [] },
    { gridEl: null },
    {},
    0,
    null,
    null,
    {
      drawAnimatedPathInternal: (...args) => {
        calls.push(args.length);
        return 'ok';
      },
    },
  );

  assert.deepEqual(calls, [6]);
});

test('flow freeze mix interpolates and immediate freeze hard-sets mix', () => {
  const engine = createPathAnimationEngine({
    isReducedMotionPreferred: () => false,
  });
  const out = { mix: 1, active: false };

  engine.syncPathFlowFreezeTarget(true, 0);
  const start = engine.resolvePathFlowFreezeMix(0, out);
  assert.equal(start.active, true);
  assert.equal(start.mix, 1);

  const mid = engine.resolvePathFlowFreezeMix(1250, out);
  assert.equal(mid.active, true);
  assert.equal(mid.mix < 0.2 && mid.mix > 0.1, true);

  const end = engine.resolvePathFlowFreezeMix(2500, out);
  assert.equal(end.active, false);
  assert.equal(end.mix, 0);

  engine.setPathFlowFreezeImmediate(false);
  const unfrozen = engine.resolvePathFlowFreezeMix(2600, out);
  assert.equal(unfrozen.mix, 1);
  assert.equal(unfrozen.active, false);
});

test('tip-arrival hint enables mixed end transition arrival state', () => {
  const engine = createPathAnimationEngine({
    isReducedMotionPreferred: () => false,
  });
  const previousPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 1, c: 4 },
    { r: 1, c: 5 },
  ];
  const nextPath = [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 2, c: 3 },
  ];
  const tip = { r: 2, c: 3 };
  const out = {
    x: 0,
    y: 0,
    active: false,
    mode: 'none',
    remain: 1,
    progress: 0,
    linearRemain: 1,
    linearProgress: 0,
  };

  engine.updatePathTipArrivalStates(previousPath, nextPath, 20, 20, 0, null);
  const withoutHint = engine.resolvePathTipArrivalOffset('end', tip, 0, out);
  assert.equal(withoutHint.active, false);

  engine.resetTransitionState({ preserveFlowFreeze: true });
  engine.updatePathTipArrivalStates(previousPath, nextPath, 20, 20, 0, {
    side: 'end',
    from: { r: 1, c: 3 },
    to: { r: 2, c: 3 },
  });
  const withHint = engine.resolvePathTipArrivalOffset('end', tip, 0, out);
  assert.equal(withHint.active, true);
  assert.equal(withHint.mode, 'arrive');
});

test('flow visibility and start-pin presence transition state resolves as expected', () => {
  const engine = createPathAnimationEngine({
    isReducedMotionPreferred: () => false,
  });
  const flowOut = { mix: 1, active: false };
  const pinOut = {
    scale: 1,
    active: false,
    mode: 'none',
    anchorR: Number.NaN,
    anchorC: Number.NaN,
  };

  const oneNode = [{ r: 0, c: 0 }];
  const twoNodes = [{ r: 0, c: 0 }, { r: 0, c: 1 }];
  engine.updatePathFlowVisibilityState(oneNode, twoNodes, 0);
  const appearMid = engine.resolvePathFlowVisibilityMix(twoNodes, 100, flowOut);
  assert.equal(appearMid.active, true);
  assert.equal(appearMid.mix, 0.5);
  const appearEnd = engine.resolvePathFlowVisibilityMix(twoNodes, 250, flowOut);
  assert.equal(appearEnd.active, false);
  assert.equal(appearEnd.mix, 1);

  engine.updatePathFlowVisibilityState(twoNodes, oneNode, 300);
  const disappearMid = engine.resolvePathFlowVisibilityMix(oneNode, 400, flowOut);
  assert.equal(disappearMid.active, true);
  assert.equal(disappearMid.mix, 0.5);

  engine.updatePathStartPinPresenceState([], oneNode, 0);
  const pinAppear = engine.resolvePathStartPinPresenceScale(oneNode, 100, pinOut);
  assert.equal(pinAppear.active, true);
  assert.equal(pinAppear.mode, 'appear');
  assert.equal(pinAppear.scale > 0, true);

  engine.updatePathStartPinPresenceState(oneNode, [], 300);
  const pinDisappear = engine.resolvePathStartPinPresenceScale([], 350, pinOut);
  assert.equal(pinDisappear.active, true);
  assert.equal(pinDisappear.mode, 'disappear');
});

test('end/start rotate transitions and reverse states follow expected lifecycles', () => {
  const engine = createPathAnimationEngine({
    isReducedMotionPreferred: () => false,
  });

  const endPrev = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }];
  const endNext = [{ r: 0, c: 0 }, { r: 0, c: 1 }];
  engine.updatePathEndArrowRotateState(endPrev, endNext, 0);
  const endDir = engine.resolvePathEndArrowDirection(endNext, 0, { x: Number.NaN, y: Number.NaN, active: false });
  assert.equal(endDir.active, true);
  assert.equal(Number.isFinite(endDir.x), true);
  assert.equal(Number.isFinite(endDir.y), true);
  const endDirGone = engine.resolvePathEndArrowDirection(endNext, 300, { x: Number.NaN, y: Number.NaN, active: false });
  assert.equal(endDirGone.active, false);

  const startPrev = [{ r: 1, c: 0 }, { r: 0, c: 0 }, { r: 0, c: 1 }];
  const startNext = [{ r: 0, c: 0 }, { r: 0, c: 1 }];
  engine.updatePathStartFlowRotateState(startPrev, startNext, 0);
  const startDir = engine.resolvePathStartFlowDirection(startNext, 0, { x: Number.NaN, y: Number.NaN, active: false });
  assert.equal(startDir.active, true);
  const startDirGone = engine.resolvePathStartFlowDirection(startNext, 300, { x: Number.NaN, y: Number.NaN, active: false });
  assert.equal(startDirGone.active, false);

  const revPrev = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }];
  const revNext = [{ r: 0, c: 2 }, { r: 0, c: 1 }, { r: 0, c: 0 }];
  engine.updatePathReverseTipSwapState(revPrev, revNext, 0);
  const swapStart = engine.resolvePathReverseTipSwapScale(
    revNext,
    0,
    { inScale: 1, outScale: 0, active: false },
  );
  assert.equal(swapStart.active, true);
  assert.equal(swapStart.inScale, 0);
  assert.equal(swapStart.outScale, 1);
  const swapEnd = engine.resolvePathReverseTipSwapScale(
    revNext,
    250,
    { inScale: 1, outScale: 0, active: false },
  );
  assert.equal(swapEnd.active, false);

  engine.beginPathReverseGradientBlend(revNext, 10, 44, 30, 128, 0);
  const blendMid = engine.resolvePathReverseGradientBlend(
    revNext,
    128,
    100,
    { blend: 1, fromFlowOffset: 0, toFlowOffset: 0, fromTravelSpan: 0, active: false },
  );
  assert.equal(blendMid.active, true);
  assert.equal(blendMid.blend > 0 && blendMid.blend < 1, true);
  const blendGone = engine.resolvePathReverseGradientBlend(
    [{ r: 9, c: 9 }, { r: 9, c: 8 }],
    128,
    100,
    { blend: 1, fromFlowOffset: 0, toFlowOffset: 0, fromTravelSpan: 0, active: false },
  );
  assert.equal(blendGone.active, false);
});
