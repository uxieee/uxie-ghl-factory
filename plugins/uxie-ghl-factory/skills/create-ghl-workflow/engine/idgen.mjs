// Deterministic (test/bound preview) + real (prod) UUID generators.
import { createHash, randomUUID } from 'node:crypto';

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

// Collision-resistant deterministic UUID stream for a caller-provided semantic seed.
// SHA-256 binds every emitted id to both the seed and its sequence position; UUID
// version/variant bits are normalized so downstream GHL validation sees ordinary v4 ids.
export function makeDeterministicIdGen(seed) {
  let n = 0;
  return () => {
    n += 1;
    const bytes = createHash('sha256')
      .update(String(seed))
      .update('\0')
      .update(String(n))
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
