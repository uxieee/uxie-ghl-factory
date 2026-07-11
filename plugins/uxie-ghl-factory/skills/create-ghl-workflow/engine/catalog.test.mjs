import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';

test('known step types resolve', () => {
  const c = loadCatalog();
  assert.equal(c.step('add_contact_tag').isMultipathContainer, false);
  assert.equal(c.step('if_else').isMultipathContainer, true);
});

test('trigger master type resolves', () => {
  assert.equal(loadCatalog().trigger('contact_tag').masterType, 'highlevel');
});

test('unknown type returns undefined', () => {
  assert.equal(loadCatalog().step('nope'), undefined);
});
