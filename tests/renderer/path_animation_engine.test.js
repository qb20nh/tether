import test from 'node:test';
import assert from 'node:assert/strict';
import { createPathAnimationEngine } from '../../src/renderer/path_animation_engine.js';

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
