// Engine false warnings on first-party asset steps, found live in workflows wave 3 (2026-09-28).
// workflow_ai_generate_image, live 2026-09-28 (knowledge sniffs/workflows-wave1-2026-09-25/live-3Q-generate-image.json):
// its {{workflow_ai_generate_image.N.image_url / image_file.path / image_file.name}} outputs rendered downstream, and a
// `__dynamicAttachments__.referenceImages` entry fed the next image step. The engine warned on both ("renders
// literally", "an invented key moves nothing"). Neither may warn now; the controls still do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { evaluateMergeTags } from './merge-tags.mjs';
import { gateDocument } from './document-gate.mjs';
import { checkStepOutputRefs } from './step-outputs.mjs';
const catalog = loadCatalog();
const img = (id, stepIndex, extra = {}) => ({ id, type: 'workflow_ai_generate_image', name: id, stepIndex,
  attributes: { type: 'workflow_ai_generate_image', model: 'gpt-image-2', prompt: 'a leaf', additionalSettings: { size: '1:1', quality: 'low', background: 'auto', outputFormat: 'jpeg' }, ...extra } });
const tags = '{{workflow_ai_generate_image.1.image_url}} {{workflow_ai_generate_image.1.image_file.path}} {{workflow_ai_generate_image.1.image_file.name}}';

test('the image step output namespace is not judged as an unknown namespace', () => {
  const f = evaluateMergeTags([{ id: 's', type: 'sms', name: 'S', attributes: { body: tags } }], catalog.mergeTags);
  assert.deepEqual(f.map((x) => x.tag), []);
  const ctl = evaluateMergeTags([{ id: 's', type: 'sms', name: 'S', attributes: { body: '{{workflow_ai_generate_imagex.1.image_url}}' } }], catalog.mergeTags);
  assert.equal(ctl[0]?.kind, 'unknown-namespace');
});

test('image outputs resolve against a producer by stepIndex; a missing producer still warns', () => {
  const warned = [];
  const consumer = { id: 'w', type: 'sms', name: 'W', attributes: { body: tags } };
  assert.deepEqual(checkStepOutputRefs([img('i1', 1), consumer], { warn: (m) => warned.push(m) }), []);
  const miss = checkStepOutputRefs([img('i1', 1), { ...consumer, attributes: { body: '{{workflow_ai_generate_image.2.image_url}}' } }], { warn: (m) => warned.push(m) });
  assert.equal(miss.length, 1);
});

test('__dynamicAttachments__ is a known key on the image step, and only there', () => {
  const dyn = { __dynamicAttachments__: { referenceImages: [{ content: '{{workflow_ai_generate_image.1.image_url}}', filename: 'ref', attachmentMode: 'url' }] } };
  const keyFindings = (t) => { const r = gateDocument([t], { catalog, marketplaceTypes: new Set() }); return [...r.errors, ...r.warnings].filter((f) => f.check === 'ATTRIBUTE_KEY'); };
  assert.deepEqual(keyFindings(img('i2', 2, dyn)), []);
  assert.equal(keyFindings(img('i3', 3, { inventedKey: 1 })).length, 1);
  assert.equal(keyFindings({ id: 'c', type: 'chatgpt', name: 'c', attributes: { type: 'chatgpt', promptText: 'x', temperature: '0.2', event: 'simple-prompt', ...dyn } }).length, 1);
});

test('an asset-labelled step (edit_conversation) is not key-checked against its native card; unlabelled still is', () => {
  const ec = (extra) => ({ id: 'e', type: 'edit_conversation', name: 'e', ...extra, attributes: { type: 'edit_conversation', read: 'false', archive: 'true', __customInputs__: {} } });
  const keys = (t, mt) => { const r = gateDocument([t], { catalog, marketplaceTypes: mt }); return [...r.errors, ...r.warnings].filter((f) => f.check === 'ATTRIBUTE_KEY'); };
  assert.deepEqual(keys(ec({ workflowsActionType: 'INTERNAL' }), new Set(['edit_conversation'])), []);
  assert.equal(keys(ec({}), new Set(['edit_conversation'])).length, 1);
  // publish/repair pass no marketplace set: a CORE_ACTION is still recognised by its flag
  assert.deepEqual(keys(ec({ workflowsActionType: 'INTERNAL' }), null), []);
  assert.deepEqual(keys(ec({ workflowsActionType: 'INTERNAL' }), new Set()), []);
  // ...but an unlabelled copy, or a native non-core type carrying the flag, is still key-checked
  assert.equal(keys(ec({}), null).length, 1);
  const fc = { id: 'f', type: 'chatgpt', name: 'f', workflowsActionType: 'INTERNAL', attributes: { type: 'chatgpt', promptText: 'x', temperature: '0.2', event: 'simple-prompt', invented: 1 } };
  assert.equal(keys(fc, null).length, 1);
});

test("edit_conversation compiles the drawer's select strings to booleans and drops 'none', as the asset's dataTransformer does", async () => {
  const { compile } = await import('./compiler.mjs');
  const { buildMarketplaceIndex } = await import('./marketplace.mjs');
  // The live asset's inputs (2026-09-28), trimmed to what the compiler reads.
  const opt = (...v) => v.map((value) => ({ label: value, value }));
  const assets = { actions: [{ appName: 'contact', actions: [{ key: 'edit_conversation', workflowsActionType: 'INTERNAL', section: 'contact',
    inputs: [{ field: 'read', fieldType: 'select', required: false, value: 'true', options: opt('true', 'false') },
      { field: 'archive', fieldType: 'select', required: false, value: '', options: opt('none', 'true', 'false') }] }] }] };
  const marketplace = buildMarketplaceIndex({ assets, modules: { actions: [], triggers: [] } });
  let n = 0;
  const run = (attributes) => compile({ name: 'wf', triggers: [], graph: [{ ref: 'e', kind: 'action', marketplace: true, type: 'edit_conversation', name: 'E', attributes }] },
    { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: () => `id-${++n}`, catalog, marketplace, warn: () => {} }).autoSaveBody.workflowData.templates[0];
  const pick = (a) => ({ read: a.read, archive: a.archive, hasArchive: 'archive' in a });
  assert.deepEqual(pick(run({ read: 'false', archive: 'true' }).attributes), { read: false, archive: true, hasArchive: true });
  assert.deepEqual(pick(run({ read: true, archive: false }).attributes), { read: true, archive: false, hasArchive: true });
  // omitted read: the asset default "true" is filled and then made a boolean; archive 'none' is dropped
  assert.deepEqual(pick(run({ archive: 'none' }).attributes), { read: true, archive: undefined, hasArchive: false });
  assert.equal(run({ read: false }).workflowsActionType, 'INTERNAL');
});
