// bl-311(b) (2026-09-29): keys a step's own dynamic generator defines are declared; anything else still warns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatorDeclaredKeys } from './compiler.mjs';

// Shapes cut from the live generators (knowledge sniffs/workflows-wave1-2026-09-25/live-R7-8-assets-all.json).
const ASSOCIATE = { inputs: [{ field: 'DYNAMIC', dynamicFieldsConfig: { customGenerator:
  'async (staticInputs, attributes, extras) => { const inputs = []; inputs.push({ "field": "associatedObject", "fieldType": "select" });'
  + ' inputs.push({ "field": "associationLabel" }); inputs.push({ "field": "filter_on", "title": "When multiple records match" }); return inputs }' } }] };
const ADD = { inputs: [{ field: 'associatedObject' }, { field: 'DYNAMIC', dynamicFieldsConfig: { customGenerator:
  "async (s) => { s['WorkflowId'] = { field: 'WorkflowId', fieldType: 'select' }; if (x) s['associationLabel'] = { field: 'associationLabel' } }" } }] };

test('associate_records: the generator\'s own keys are declared', () => {
  assert.deepEqual([...generatorDeclaredKeys(ASSOCIATE)].sort(), ['associatedObject', 'associationLabel', 'filter_on']);
});
test('add/remove_associated_records: WorkflowId and associationLabel are declared', () => {
  assert.deepEqual([...generatorDeclaredKeys(ADD)].sort(), ['WorkflowId', 'associationLabel']);
});
test('CONTROL: a step with no generator declares nothing extra, and an invented key is not among any', () => {
  assert.equal(generatorDeclaredKeys({ inputs: [{ field: 'name' }] }).size, 0);
  assert.equal(generatorDeclaredKeys(ASSOCIATE).has('zz_invented'), false);
});

// Through compile(): the undeclared-key warning is gone for the generator's keys and still fires for an invented one.
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';
const assets = { actions: [{ appName: 'Associations', actions: [{ key: 'associate_records', workflowsActionType: 'INTERNAL', version: '1.0', ...ASSOCIATE }] }], triggers: [] };
const compileWith = (attributes) => {
  let n = 0; const warnings = [];
  compile({ name: 'wf', workflowType: 'business', triggers: [], graph: [{ ref: 'a', kind: 'action', marketplace: true, type: 'associate_records', name: 'Associate', attributes }] },
    { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(),
      marketplace: buildMarketplaceIndex({ assets, modules: { actions: [], triggers: [] } }), warn: (w) => warnings.push(w) });
  return warnings.filter((w) => /does not declare/.test(w));
};
const ROW = [{ __customInputs__: {}, filterField: 'id', value: 'eq', valueField: 'C1' }];

test('compile: associate_records with the builder\'s own keys draws no undeclared-key warning', () => {
  assert.deepEqual(compileWith({ associatedObject: 'contact', filter_on: 'latest', __customInputFields__: ROW }), []);
});
test('compile CONTROL: a genuinely unknown key on associate_records still warns', () => {
  const w = compileWith({ associatedObject: 'contact', filter_on: 'latest', __customInputFields__: ROW, zz_invented: 1 });
  assert.equal(w.length, 1);
  assert.match(w[0], /zz_invented/);
});
