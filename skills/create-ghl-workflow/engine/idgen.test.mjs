import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSeededIdGen, makeUuidV4 } from './idgen.mjs';

test('seeded idgen is deterministic and sequential', () => {
  const g = makeSeededIdGen('a');
  assert.equal(g(), 'a0000000-0000-4000-8000-000000000001');
  assert.equal(g(), 'a0000000-0000-4000-8000-000000000002');
});

test('two seeded gens with same prefix produce same sequence', () => {
  const g1 = makeSeededIdGen('a'), g2 = makeSeededIdGen('a');
  assert.equal(g1(), g2());
});

test('makeUuidV4 returns a v4-shaped uuid', () => {
  assert.match(makeUuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
