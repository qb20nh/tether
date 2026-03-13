import assert from 'node:assert/strict';
import test from '../test.ts';
import {
  DEBUG_REDUCED_MOTION_CLASS,
  readDebugReducedMotionSimulation,
  setDebugReducedMotionSimulation,
} from '../../src/debug/reduced_motion_debug.ts';
import { isReducedMotionPreferred } from '../../src/reduced_motion.ts';

const globalObject = (globalThis as any);

const createClassList = () => {
  const tokens = new Set<string>();
  return ({
    add(value: string) {
      if (value) tokens.add(String(value));
    },
    remove(value: string) {
      tokens.delete(String(value));
    },
    contains(value: string) {
      return tokens.has(String(value));
    },
    toggle(value: string, force?: boolean) {
      const key = String(value);
      const next = force === undefined ? !tokens.has(key) : Boolean(force);
      if (next) tokens.add(key);
      else tokens.delete(key);
      return next;
    },
  } as any);
};

const installReducedMotionEnv = (t: { after: (cleanup: () => void) => void }, matches = false) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalObject.document = ({
    documentElement: { classList: createClassList() },
    body: { classList: createClassList() },
  } as any);
  globalObject.window = ({
    matchMedia(query: string) {
      return {
        media: String(query),
        matches: Boolean(matches),
      };
    },
  } as any);

  t.after(() => {
    globalObject.window = originalWindow;
    globalObject.document = originalDocument;
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
