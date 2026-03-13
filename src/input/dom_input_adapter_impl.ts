import type { InputPort } from '../contracts/ports.ts';
import { createDomInputAdapter as createDomInputAdapterLegacy } from './dom_input_adapter_impl_legacy.ts';

export function createDomInputAdapter(): InputPort {
  return createDomInputAdapterLegacy() as unknown as InputPort;
}
