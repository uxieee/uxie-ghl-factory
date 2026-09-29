// find_workflows_using problems:"mixed-case-tag-rows" — trigger rows naming a tag with a capital letter never fire (measured live
// 2026-09-30, knowledge sniffs live-W29-tagcase-*.json). The sweep reads the trigger index in ONE call (searchAfter is ignored, offset is
// unstable — measured) and one GET per HIT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'find_workflows_using');
const trig = (wf, id, name, type, conditions) => ({ docType: 'trigger', docKey: type, meta: { id, name, type, workflowId: wf, conditions }, workflowJoinField: { parent: wf } });
const ROWS = [
  trig('W1', 't1', 'Tagged VIP', 'contact_tag', [{ field: 'tagsAdded', operator: 'index-of-true', value: 'VIP Lead' }]),
  trig('W2', 't2', 'Lower', 'contact_tag', [{ field: 'tagsAdded', operator: 'index-of-true', value: 'vip lead' }]),
  trig('W3', 't3', 'Both', 'contact_changed', [{ field: 'contact.tags', operator: 'add-index-of-true', value: 'New' }, { field: 'contact.tags', operator: 'add-index-of-true', value: 'new' }]),
  trig('W4', 't4', 'Merge', 'contact_tag', [{ field: 'tagsAdded', operator: 'index-of-true', value: '{{Custom.Tag}}' }]),
  trig('W5', 't5', 'Other field', 'contact_changed', [{ field: 'contact.email', operator: '==', value: 'Some Value' }]),
];
const gw = (capture, { rows = ROWS, count = rows.length, secondRows } = {}) => ({
  state: { tokenFile: '/fixture/token.txt' },
  makeGw: () => ({ loc: 'LOC', call: async (method, path, body) => {
    capture.push({ method, path, body });
    if (method === 'GET') return { status: 200, ok: true, json: { name: `name-${path.split('/').pop()}`, status: path.endsWith('W1') ? 'published' : 'draft' } };
    const useSecond = secondRows && capture.filter((c) => c.method === 'POST').length > 1;
    return { status: 201, ok: true, json: { count, workflows: useSecond ? secondRows : rows } };
  } }),
});

test('lists mixed-case tag rows with workflow name, status, twin flag and the replaceTag fix; lower case, merge tags and other fields are clean', async () => {
  const calls = [];
  const r = await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw(calls));
  assert.equal(r.ok, true);
  assert.equal(r.data.complete, true); assert.equal(r.data.triggerDocsScanned, 5);
  assert.deepEqual(r.data.hits.map((h) => [h.workflowId, h.value, h.lowercaseTwinInSameTrigger]), [['W1', 'VIP Lead', false], ['W3', 'New', true]]);
  assert.equal(r.data.hits[0].workflowName, 'name-W1'); assert.equal(r.data.hits[0].workflowStatus, 'published');
  assert.match(r.data.hits[0].fix, /replaceTag.*oldTag: 'VIP Lead'.*newTag: 'vip lead'/);
  assert.equal(r.data.publishedWithHits, 1);
  assert.match(r.data.note, /NOT COVERED: if\/else tag conditions and step tag values/);
});

test('ONE index call (docType trigger, offset 0, no searchAfter) plus one GET per hit workflow', async () => {
  const calls = [];
  await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw(calls));
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.filters, [{ field: 'docType', operator: 'eq', value: 'trigger' }]);
  assert.equal(posts[0].body.offset, 0); assert.ok(!('searchAfter' in posts[0].body)); assert.ok(posts[0].body.pageLimit >= 1000);
  assert.deepEqual(calls.filter((c) => c.method === 'GET').map((c) => c.path.split('/').pop()).sort(), ['W1', 'W3']);
});

test('a short read retries ONCE above count; a still-short read is complete:false with no hits list', async () => {
  const calls = [];
  const ok1 = await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw(calls, { rows: ROWS.slice(0, 2), count: 5, secondRows: ROWS }));
  assert.equal(calls.filter((c) => c.method === 'POST').length, 2); assert.equal(calls.filter((c) => c.method === 'POST')[1].body.pageLimit, 105);
  assert.equal(ok1.data.complete, true); assert.equal(ok1.data.hits.length, 2);
  const short = await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw([], { rows: ROWS.slice(0, 2), count: 5, secondRows: ROWS.slice(0, 2) }));
  assert.equal(short.data.complete, false); assert.equal(short.data.hits, null); assert.ok(Array.isArray(short.data.partialHits)); assert.equal(short.data.warnings.length, 1);
});

test('the ordinary mode is untouched: types are still required without problems', async () => {
  const r = await tool().handler({ locationId: 'LOC', types: [] }, gw([]));
  assert.equal(r.ok, false); assert.equal(r.code, 'VALIDATION_FAILED');
});
