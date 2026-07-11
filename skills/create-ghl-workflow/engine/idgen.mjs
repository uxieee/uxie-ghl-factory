// Deterministic (test) + real (prod) UUID generators.
import { randomUUID } from 'node:crypto';

export function makeSeededIdGen(prefix = '0') {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

export function makeUuidV4() {
  return randomUUID();
}
