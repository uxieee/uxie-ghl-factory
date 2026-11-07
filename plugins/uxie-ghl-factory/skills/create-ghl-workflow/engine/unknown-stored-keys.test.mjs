// W6a item 13 (bl-370 key half): a key GHL adds to a step later must not freeze every modifyStep on that type. The stored
// step's own keys are GHL's; checkAttrKeys judges only what the PATCH introduces, and a stored key the catalogue does not
// know is kept verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modifyStep } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { digestWorkflow } from './digest.mjs';
import { gateDocument } from './document-gate.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('u'), catalog: loadCatalog(), warn: () => {} });
const stored = () => [{ id: 's1', type: 'sms', name: 'Text', order: 0, next: null,
  attributes: { body: 'hi', attachments: [], ghlAddedLater: { mode: 'x' } } }];

test('modifyStep on a stored step carrying an unknown key succeeds and keeps the key', () => {
  const { templates } = modifyStep(stored(), 's1', { body: 'bye' }, null, ctx());
  assert.equal(templates[0].attributes.body, 'bye');
  assert.deepEqual(templates[0].attributes.ghlAddedLater, { mode: 'x' });
});

test('CONTROL: an unknown key the PATCH introduces is still refused (ATTR_KEY)', () => {
  assert.throws(() => modifyStep(stored(), 's1', { message: 'invented' }, null, ctx()), (e) => e.code === 'ATTR_KEY' && /message/.test(e.message));
});

test('a stored step with an unknown TOP-LEVEL key is a warning on edit/repair (stored), an error on build', () => {
  const t = [{ ...stored()[0], ghlTopLevelLater: true }];
  const asStored = gateDocument(t, { catalog: loadCatalog(), storedTemplates: t });
  assert.equal(asStored.errors.some((f) => f.check === 'TOP_LEVEL_KEY'), false, JSON.stringify(asStored.errors));
  assert.equal(asStored.warnings.some((f) => f.check === 'TOP_LEVEL_KEY'), true);
  const asAuthored = gateDocument(t, { catalog: loadCatalog() });
  assert.equal(asAuthored.errors.some((f) => f.check === 'TOP_LEVEL_KEY'), true);
  // a key a stepPatch ADDS to a stored step is the author's, not GHL's: still an error
  const patched = gateDocument(t, { catalog: loadCatalog(), storedTemplates: stored() });
  assert.equal(patched.errors.some((f) => f.check === 'TOP_LEVEL_KEY'), true);
});

test('validateDocument passes the baseline document to the gate (edit/repair), and storedTemplates (publish)', async () => {
  const { validateDocument } = await import('./write-validation.mjs');
  const t = [{ ...stored()[0], ghlTopLevelLater: true }];
  const viaBaseline = validateDocument({ intent: 'edit', templates: t, baselineDocument: { templates: t, triggers: [], status: 'draft' } });
  assert.equal(viaBaseline.engine.errors.some((f) => f.check === 'TOP_LEVEL_KEY'), false);
  const viaStored = validateDocument({ intent: 'publish', templates: t, storedTemplates: t, status: 'draft' });
  assert.equal(viaStored.engine.errors.some((f) => f.check === 'TOP_LEVEL_KEY'), false);
});

test('digest of a workflow with an unknown step type and an unknown trigger type succeeds', () => {
  const doc = { name: 'W', status: 'draft', workflowData: { templates: [{ id: 'x', type: 'ghl_new_step_2027', name: 'New', order: 0, next: null, attributes: { a: 1 } }] } };
  const d = digestWorkflow({ doc, triggers: [{ id: 'T', type: 'ghl_new_trigger_2027', name: 'NT', conditions: [{ field: 'z', operator: '==', value: 1 }] }] });
  assert.ok(d);
  assert.match(JSON.stringify(d), /ghl_new_step_2027/);
});
