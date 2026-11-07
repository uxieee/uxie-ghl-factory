// w7-6 QA issue 2 (plan Task 6): every insertable kind in catalog/funnel-elements.json composes a leaf that carries EVERY declared
// extraProp. No exception table: a kind the builder declares but the tool leaves out fails here. The five kinds that only the
// 976028e2 builder serves (quiz, order-form, rentals, services, blog-comments) are in the list too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ELEMENTS, makeLeaf } from '../core/funnel-pages.mjs';
import { KIND_OMIT_EXTRA } from '../core/kind-oracle-defaults.mjs';

const CATALOG = JSON.parse(readFileSync(new URL('../catalog/funnel-elements.json', import.meta.url), 'utf8')).elements;
const INSERTABLE = Object.keys(CATALOG).filter((k) => CATALOG[k].insertable);

test('the catalog lists 52 insertable kinds, including the five 976028e2 kinds', () => {
  assert.equal(INSERTABLE.length, 52);
  for (const k of ['quiz', 'order-form', 'rentals', 'services', 'blog-comments']) assert.ok(INSERTABLE.includes(k), k);
});

for (const kind of INSERTABLE) {
  test(`${kind} composes with every declared extraProp present`, () => {
    assert.ok(ELEMENTS[kind], `${kind} is in the closed set`);
    const leaf = makeLeaf({ meta: kind });
    const omit = KIND_OMIT_EXTRA[kind];
    const missing = (CATALOG[kind].extraProps ?? []).filter((p) => !(p in (leaf.extra ?? {})) && !(omit && omit.test(p)));
    assert.deepEqual(missing, [], `${kind}: extraProps missing on the composed leaf`);
  });
}
