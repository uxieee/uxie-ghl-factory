// One UI-written trigger per dialect, diffed against buildTrigger on every run. This is the regen
// guard the Phase-5 review asked for: a generator change that breaks a drawer shape now fails a
// NAMED fixture instead of shipping a workflow whose conditions never match.
//
// The fixtures live in catalog/drawer-parity/, deliberately NOT in catalog/trigger-examples/ —
// gen-catalog derives a trigger TYPE from each filename there and stamps it verified-live, so
// fixtures in that directory would mint bogus catalog triggers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTrigger } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../catalog/drawer-parity');
const parity = readdirSync(dir).filter((f) => f.endsWith('.json'));
const key = (c) => `${c.field}|${c.id ?? ''}`;

test('there are drawer-parity fixtures to check', () => {
  assert.ok(parity.length >= 5, `expected the parity corpus, found ${parity.length}`);
});

for (const f of parity) {
  test(`drawer parity: ${f}`, () => {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const ctx = {
      loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('p'),
      catalog: loadCatalog(), customFields: fx.resolver?.customFields ?? [], warn: () => {},
    };
    const body = buildTrigger({ ref: 't', ...fx.lean }, ctx, 'WID', new Map());
    const want = new Map(fx.trigger.conditions.map((c) => [key(c), c]));
    for (const [k, c] of want) {
      const got = body.conditions.find((x) => key(x) === k);
      assert.ok(got, `emitted no condition for ${k} — emitted: ${body.conditions.map(key).join(', ')}`);
      assert.deepEqual(
        { operator: got.operator, value: got.value, type: got.type, title: got.title },
        { operator: c.operator, value: c.value, type: c.type, title: c.title },
        `${f} :: ${k}`);
    }
  });
}
