// The API stores a trigger filter row with no value; the builder blocks SAVING a trigger that has one (TriggerMain.hasErrors →
// checkForEmptyFilter). The compiler warns, with the builder's own exemptions. Drawer walk 2026-09-30 (live-W29-f-*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const run = (type, filters) => {
  const warnings = [];
  const ctx = { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: (m) => warnings.push(m) };
  compile({ name: 'W', triggers: [{ ref: 't', type, name: 'T', filters }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] }, ctx);
  return warnings.filter((w) => w.startsWith('TRIGGER_FILTER_EMPTY_VALUE'));
};

test('a row with an operator and no value warns (empty string, missing, empty list)', () => {
  for (const value of ['', undefined, null, []]) {
    const w = run('opportunity_created', [{ field: 'opportunity.monetaryValue', operator: '>', ...(value === undefined ? {} : { value }) }]);
    assert.equal(w.length, 1, JSON.stringify(value));
    assert.match(w[0], /refuses to save the trigger/);
  }
});

test('CONTROLS: a value, 0 and false do not warn', () => {
  for (const value of [100, 0, false, 'x', ['a']]) assert.equal(run('opportunity_created', [{ field: 'opportunity.monetaryValue', operator: '>', value }]).length, 0, JSON.stringify(value));
});

test('CONTROLS: the builder\'s exempt operators do not warn (has-changed, has_value, has_no_value)', () => {
  assert.equal(run('contact_changed', [{ field: 'contact.email', operator: 'has-changed' }]).length, 0);
  for (const operator of ['has_value', 'has_no_value']) assert.equal(run('opportunity_created', [{ field: 'opportunity.monetaryValue', operator }]).length, 0, operator);
});

test('a trigger with no filters does not warn', () => {
  assert.equal(run('contact_created', []).length, 0);
  assert.equal(run('contact_changed', []).length, 0);
});
