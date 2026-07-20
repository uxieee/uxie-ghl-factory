import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as idgen from './idgen.mjs';

const { makeSeededIdGen, makeUuidV4 } = idgen;

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

test('deterministic idgen is UUID-shaped, repeatable, sequential, and seed-bound', () => {
  assert.equal(typeof idgen.makeDeterministicIdGen, 'function');
  const a1 = idgen.makeDeterministicIdGen('workflow/version/ops');
  const a2 = idgen.makeDeterministicIdGen('workflow/version/ops');
  const b = idgen.makeDeterministicIdGen('workflow/other-version/ops');
  const first = a1();
  const second = a1();

  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a2(), first);
  assert.notEqual(second, first);
  assert.notEqual(b(), first);
});
