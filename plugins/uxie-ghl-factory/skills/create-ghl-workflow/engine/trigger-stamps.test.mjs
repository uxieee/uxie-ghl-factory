// bl-311(a) (2026-09-29): what the builder stamps on a trigger and the engine did not.
//  - A marketplace trigger whose asset GHL labels (workflowsTriggerType) is masterType 'internal' AND carries the
//    label itself (TriggerMain.ts:930-931). Measured: knowledge sniffs/workflows-wave1-2026-09-25/live-R7-1-builder-company-capture.json.
//  - Every trigger of an object-based workflow carries objectKey = the workflow's customObjectType (TriggerMain.ts:935-937).
//    Measured: live-R7-4-pets-trigger-readback.json (builder objectKey set, engine null on the same draft).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrigger } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const assets = { actions: [], triggers: [
  { appName: 'Company', triggers: [{ key: 'business_created', workflowsTriggerType: 'INTERNAL', version: '1.0', filters: [{ field: 'name', fieldType: 'string', title: 'Company Name' }] }] },
  { appName: 'Some App', triggers: [{ key: 'zz_third_party_trigger', version: '1.0', filters: [] }] },
] };
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: () => {},
  marketplace: buildMarketplaceIndex({ assets, modules: { actions: [], triggers: [{ appId: 'app1', name: 'Some App', isInstalled: true, triggers: [{ key: 'zz_third_party_trigger' }] }] } }) });

test('a LABELLED marketplace trigger carries masterType internal AND workflowsTriggerType, as the builder writes it', () => {
  const body = buildTrigger({ ref: 't', type: 'business_created', marketplace: true, name: 'Company created', filters: [] }, ctx(), 'WID', new Map());
  assert.equal(body.masterType, 'internal');
  assert.equal(body.workflowsTriggerType, 'INTERNAL');
});

test('CONTROL: an unlabelled third-party trigger stays masterType marketplace with no workflowsTriggerType', () => {
  const body = buildTrigger({ ref: 't', type: 'zz_third_party_trigger', marketplace: true, name: 'x', filters: [] }, ctx(), 'WID', new Map());
  assert.equal(body.masterType, 'marketplace');
  assert.equal('workflowsTriggerType' in body, false);
});

test('a trigger of an object-based workflow carries objectKey = customObjectType', () => {
  const body = buildTrigger({ ref: 't', type: 'custom_object_created', name: 'Pet created', filters: [] }, ctx(), 'WID', new Map(), { objectKey: 'custom_objects.test_pets' });
  assert.equal(body.objectKey, 'custom_objects.test_pets');
});

test('CONTROL: no objectKey outside an object workflow, and never a non-object key', () => {
  assert.equal('objectKey' in buildTrigger({ ref: 't', type: 'contact_created', name: 'x', filters: [] }, ctx(), 'WID', new Map()), false);
  assert.equal('objectKey' in buildTrigger({ ref: 't', type: 'contact_created', name: 'x', filters: [] }, ctx(), 'WID', new Map(), { objectKey: 'contact' }), false);
});
