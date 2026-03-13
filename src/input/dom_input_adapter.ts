import type { InputPort } from '../contracts/ports.ts';
import { createDomInputAdapter as createDomInputAdapterImpl } from './dom_input_adapter_impl.ts';

export function createDomInputAdapter(): InputPort {
  return createDomInputAdapterImpl() as unknown as InputPort;
}
