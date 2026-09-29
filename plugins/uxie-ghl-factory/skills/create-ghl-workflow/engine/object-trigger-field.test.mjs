// custom_object_created / custom_object_changed rows: a bare field label went out as-is and the drawer showed "Select" with no field; the
// full key renders (own object-mode drafts, live-W31-g-custom_object-render-*.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const OBJ = 'custom_objects.pets';
const run = (type, filters, customObjectType = OBJ) => {
  const warnings = [];
  const ctx = { loc: 'L', cid: 'C', uid: 'U', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: (m) => warnings.push(m) };
  const r = compile({ name: 'W', customObjectType, triggers: [{ ref: 't', type, name: 'T', filters }], graph: [{ ref: 'a', kind: 'wait', name: 'W', waitType: 'time', attributes: { type: 'time', startAfter: { type: 'minutes', value: 1, when: 'after' } } }] }, ctx);
  return { conditions: r.triggerBodies[0].conditions, warnings };
};

test('a bare field label is written as the full key and the assumption is said', () => {
  const { conditions, warnings } = run('custom_object_created', [{ field: 'Pet Name', operator: 'string-contains-any-of', value: ['rex'] }]);
  assert.equal(conditions[0].field, 'custom_objects.pets.pet_name');
  assert.ok(warnings.some((w) => /TRIGGER_FILTER_OBJECT_FIELD/.test(w) && /assumed from the label/.test(w)));
});

test('CONTROLS: a full key, and a workflow that is not object-based, are left alone', () => {
  const full = run('custom_object_changed', [{ field: 'custom_objects.pets.name', operator: 'string-contains-any-of', value: ['rex'] }]);
  assert.equal(full.conditions[0].field, 'custom_objects.pets.name');
  assert.deepEqual(full.warnings.filter((w) => /OBJECT_FIELD/.test(w)), []);
  const ordinary = run('contact_changed', [{ field: 'contact.email', operator: 'has-changed' }], undefined);
  assert.equal(ordinary.conditions[0].field, 'contact.email');
});
