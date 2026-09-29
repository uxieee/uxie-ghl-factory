// Engine authoring of co_find_company_record (Find company), coordinator ruling 2026-09-29. The emitted shape is the
// builder's own (knowledge sniffs/workflows-wave1-2026-09-25/live-R7-1-builder-find-company-capture.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';

const build = (node, triggers = [{ ref: 'h', type: 'inbound_webhook', name: 'hook', filters: [] }]) => {
  let n = 0;
  return compile({ name: 'wf', workflowType: 'business', triggers, graph: [node] },
    { loc: 'L', cid: 'C', uid: 'U', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(), warn: () => {} });
};
const FIND = { ref: 'f', type: 'co_find_company_record', name: 'Find company',
  find: { filter_on: 'earliest', filters: [{ field: 'business.name__TEXT', value: '{{inboundWebhookRequest.tcwf.company}}' }] },
  onFound: [{ ref: 'u', kind: 'wait', name: 'Wait 1 min', waitType: 'time', attributes: { type: 'time', startAfter: { type: 'minutes', value: 1, when: 'after' } } }],
  onNotFound: [] };

test('Find company compiles to the builder\'s container: two pre-defined branches, rows at __customInputFields__', () => {
  const t = build(FIND).autoSaveBody.workflowData.templates;
  const c = t.find((x) => x.type === 'co_find_company_record');
  assert.equal(c.cat, 'multi-path'); assert.equal(c.workflowsActionType, 'INTERNAL'); assert.equal(c.next.length, 2);
  assert.deepEqual(c.attributes.__customInputFields__, [{ __customInputs__: {}, filterField: 'business.name__TEXT', valueField: '{{inboundWebhookRequest.tcwf.company}}' }]);
  assert.equal(c.attributes.filter_on, 'earliest');
  assert.deepEqual(c.attributes.transitions.map((x) => [x.name, x.conditionType, typeof x.fields]), [['Company Found', 'pre-defined', 'object'], ['Company Not Found', 'pre-defined', 'object']]);
  const tr = t.filter((x) => x.type === 'transition' && x.parentKey === c.id);
  assert.deepEqual(tr.map((x) => x.name), ['Company Found', 'Company Not Found']);
  assert.ok(tr[0].next, 'the Found branch leads to its step'); assert.equal('next' in tr[1], false, 'an empty branch carries no next');
});

test('CONTROL: rows authored at the emitted key, or without the typed suffix, are refused', () => {
  assert.throws(() => build({ ...FIND, attributes: { __customInputFields__: [] } }), (e) => e.code === 'FIND_FILTERS_MISPLACED');
  assert.throws(() => build({ ...FIND, find: { filters: [{ field: 'business.name', value: 'x' }] } }), (e) => e.code === 'FIND_COMPANY_FILTER');
});
