import type {
  HeadlessRuntime,
  HeadlessRuntimeOptions,
  RuntimeController,
  RuntimeOptions,
} from '../contracts/ports.ts';
import {
  createHeadlessRuntime as createHeadlessRuntimeImpl,
  createRuntime as createRuntimeImpl,
} from './create_runtime_impl.ts';

export function createRuntime(options: RuntimeOptions): RuntimeController {
  return createRuntimeImpl(options) as unknown as RuntimeController;
}

export function createHeadlessRuntime(options: HeadlessRuntimeOptions): HeadlessRuntime {
  return createHeadlessRuntimeImpl(options) as unknown as HeadlessRuntime;
}
