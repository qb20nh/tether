import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEBUG_REDUCED_MOTION_CLASS,
  readDebugReducedMotionSimulation,
  setDebugReducedMotionSimulation,
} from '../../src/debug/reduced_motion_debug.js';
import { isReducedMotionPreferred } from '../../src/reduced_motion.js';

const createClassList = () => {
  const tokens = new Set();
  return {
    add(value) {
      if (value) tokens.add(String(value));
    },
    remove(value) {
      tokens.delete(String(value));
    },
    contains(value) {
      return tokens.has(String(value));
    },
    toggle(value, force) {
      const key = String(value);
      const next = force === undefined ? !tokens.has(key) : Boolean(force);
      if (next) tokens.add(key);
      else tokens.delete(key);
      return next;
    },
  };
};

const installReducedMotionEnv = (t, matches = false) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.document = {
    documentElement: { classList: createClassList() },
    body: { classList: createClassList() },
  };
  globalThis.window = {
    matchMedia(query) {
      return {
        media: String(query),
        matches: Boolean(matches),
      };
    },
  };

  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });
};

test('setDebugReducedMotionSimulation drives helper state and document class', (t) => {
  installReducedMotionEnv(t, false);

  assert.equal(readDebugReducedMotionSimulation(), false);
  assert.equal(isReducedMotionPreferred(), false);

  assert.equal(setDebugReducedMotionSimulation(true), true);
  assert.equal(readDebugReducedMotionSimulation(), true);
  assert.equal(isReducedMotionPreferred(), true);
  assert.equal(document.documentElement.classList.contains(DEBUG_REDUCED_MOTION_CLASS), true);
  assert.equal(document.body.classList.contains(DEBUG_REDUCED_MOTION_CLASS), true);

  assert.equal(setDebugReducedMotionSimulation(false), false);
  assert.equal(readDebugReducedMotionSimulation(), false);
  assert.equal(isReducedMotionPreferred(), false);
  assert.equal(document.documentElement.classList.contains(DEBUG_REDUCED_MOTION_CLASS), false);
  assert.equal(document.body.classList.contains(DEBUG_REDUCED_MOTION_CLASS), false);
});

test('isReducedMotionPreferred falls back to matchMedia when simulation is disabled', (t) => {
  installReducedMotionEnv(t, true);

  assert.equal(readDebugReducedMotionSimulation(), false);
  assert.equal(isReducedMotionPreferred(), true);
  assert.equal(document.documentElement.classList.contains(DEBUG_REDUCED_MOTION_CLASS), false);
});
