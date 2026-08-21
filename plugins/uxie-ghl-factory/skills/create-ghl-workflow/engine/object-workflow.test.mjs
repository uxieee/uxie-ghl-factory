import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { buildResolvers, resolveIR } from './resolve.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 1, idGen: makeSeededIdGen('o'), catalog: loadCatalog() });
const r = buildResolvers({ objects: [
  { key: 'custom_objects.claude_pets', singular: 'CLAUDE Pet', plural: 'CLAUDE Pets', standard: false },
  { key: 'business', singular: 'Company', plural: 'Companies', standard: true },
] });

test('ir.object resolves by label or key to customObjectType and is consumed', () => {
  for (const q of ['CLAUDE Pet', 'claude pets', 'custom_objects.claude_pets', 'claude_pets']) {
    const ir = { object: q, triggers: [], graph: [] };
    assert.deepEqual(resolveIR(ir, r).unresolved, [], q);
    assert.equal(ir.customObjectType, 'custom_objects.claude_pets');
    assert.equal(ir.object, undefined);
  }
  const bad = { object: 'Ghosts', triggers: [], graph: [] };
  assert.deepEqual(resolveIR(bad, r).unresolved, [{ where: 'workflow.object', name: 'Ghosts' }]);
});

test('an object-based build carries customObjectType on BOTH create and autosave bodies', () => {
  const ir = { name: 'Pets flow', customObjectType: 'custom_objects.claude_pets', triggers: [],
    graph: [{ ref: 'a', kind: 'action', type: 'add_notes', name: 'Note', attributes: { html: '<p>x</p>', type: 'add_notes' } }] };
  const { createBody, autoSaveBody } = compile(ir, ctx());
  assert.equal(createBody.customObjectType, 'custom_objects.claude_pets');
  assert.equal(autoSaveBody.customObjectType, 'custom_objects.claude_pets');
});

test('a contact workflow emits NO customObjectType key (byte-identical to before)', () => {
  const ir = { name: 'n', triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'T', attributes: { tags: ['x'] } }] };
  const { createBody, autoSaveBody } = compile(ir, ctx());
  assert.equal('customObjectType' in createBody, false);
  assert.equal('customObjectType' in autoSaveBody, false);
});

test('OBJECT_STEP: steps outside the object-workflow picker refuse, with the allow-list named; hatch skips', () => {
  const ir = { name: 'n', customObjectType: 'custom_objects.claude_pets', triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'email', name: 'OK', attributes: { subject: 's', html: '<p>x</p>' } },
    { ref: 'b', kind: 'action', type: 'add_contact_tag', name: 'Nope', attributes: { tags: ['x'] } },
  ] };
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'OBJECT_STEP' && /'Nope' \(add_contact_tag\)/.test(e.message) && /update_custom_value/.test(e.message));
  const ok = compile(ir, { ...ctx(), skipObjectRules: true });
  assert.equal(ok.autoSaveBody.customObjectType, 'custom_objects.claude_pets');
});
