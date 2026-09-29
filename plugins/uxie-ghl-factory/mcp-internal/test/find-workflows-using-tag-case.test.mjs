// find_workflows_using problems:"mixed-case-tag-rows" — trigger rows AND if/else tag conditions naming a tag with a capital letter never
// match (measured live 2026-09-30: sniffs live-W29-tagcase-*.json for a trigger row, live-W31-ifelse-tag-result.json for an if/else
// condition). The sweep reads each index slice in ONE call (searchAfter is ignored, offset is unstable — measured) and one GET per HIT workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'find_workflows_using');
const trig = (wf, id, name, type, conditions) => ({ docType: 'trigger', docKey: type, meta: { id, name, type, workflowId: wf, conditions }, workflowJoinField: { parent: wf } });
const cond = (value) => ({ conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: value });
const ife = (wf, id, name, branches) => ({ docType: 'action', docKey: 'if_else', meta: { id, name, type: 'if_else', attributes: { branches: branches.map(([bn, v]) => ({ name: bn, segments: [{ conditions: [cond(v)] }] })) } }, workflowJoinField: { parent: wf } });
const TRIGGERS = [
  trig('W1', 't1', 'Tagged VIP', 'contact_tag', [{ field: 'tagsAdded', operator: 'index-of-true', value: 'VIP Lead' }]),
  trig('W2', 't2', 'Lower', 'contact_tag', [{ field: 'tagsAdded', operator: 'index-of-true', value: 'vip lead' }]),
  trig('W3', 't3', 'Both', 'contact_changed', [{ field: 'contact.tags', operator: 'add-index-of-true', value: 'New' }, { field: 'contact.tags', operator: 'add-index-of-true', value: 'new' }]),
  trig('W4', 't4', 'Merge', 'contact_tag', [{ field: 'tagsAdded', operator: 'index-of-true', value: '{{Custom.Tag}}' }]),
  trig('W5', 't5', 'Other field', 'contact_changed', [{ field: 'contact.email', operator: '==', value: 'Some Value' }]),
];
const IFELSE = [ife('W6', 's1', 'Check VIP', [['Yes', ['VIP Lead']], ['Also', ['ok']]]), ife('W7', 's2', 'Lower', [['Yes', ['vip lead']]])];
const gw = (capture, { triggers = TRIGGERS, ifelse = IFELSE, trigCount = triggers.length, secondTriggers } = {}) => ({
  state: { tokenFile: '/fixture/token.txt' },
  makeGw: () => ({ loc: 'LOC', call: async (method, path, body) => {
    capture.push({ method, path, body });
    if (method === 'GET') return { status: 200, ok: true, json: { name: `name-${path.split('/').pop()}`, status: path.endsWith('W1') ? 'published' : 'draft' } };
    const isTrig = body.filters.some((f) => f.field === 'docType' && f.value === 'trigger');
    if (!isTrig) return { status: 201, ok: true, json: { count: ifelse.length, workflows: ifelse } };
    const second = secondTriggers && capture.filter((c) => c.method === 'POST' && c.body.filters.some((f) => f.value === 'trigger')).length > 1;
    return { status: 201, ok: true, json: { count: trigCount, workflows: second ? secondTriggers : triggers } };
  } }),
});

test('lists trigger rows and if/else tag conditions with workflow name, status, twin flag and the replaceTag fix; clean cases stay clean', async () => {
  const calls = [];
  const r = await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw(calls));
  assert.equal(r.ok, true);
  assert.equal(r.data.complete, true); assert.equal(r.data.triggerDocsScanned, 5); assert.equal(r.data.ifElseDocsScanned, 2);
  assert.deepEqual(r.data.hits.map((h) => [h.kind, h.workflowId, h.value]), [['trigger-row', 'W1', 'VIP Lead'], ['trigger-row', 'W3', 'New'], ['if_else-condition', 'W6', 'VIP Lead']]);
  assert.equal(r.data.hits[0].lowercaseTwinInSameTrigger, false); assert.equal(r.data.hits[1].lowercaseTwinInSameTrigger, true);
  assert.equal(r.data.hits[2].branch, 'Yes'); assert.equal(r.data.hits[2].stepName, 'Check VIP');
  assert.equal(r.data.hits[0].workflowName, 'name-W1'); assert.equal(r.data.hits[0].workflowStatus, 'published'); assert.equal(r.data.publishedWithHits, 1);
  assert.match(r.data.hits[0].fix, /replaceTag.*oldTag: 'VIP Lead'.*newTag: 'vip lead'/);
  assert.match(r.data.note, /Checked and NOT affected: add\/remove-tag STEPS/); assert.match(r.data.note, /NOT fired: the tag rows of other trigger types/);
});

test('one call per index slice (trigger docs; if_else step docs), offset 0, no searchAfter, plus one GET per hit workflow', async () => {
  const calls = [];
  await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw(calls));
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body.filters, [{ field: 'docType', operator: 'eq', value: 'trigger' }]);
  assert.deepEqual(posts[1].body.filters, [{ field: 'docType', operator: 'eq', value: 'action' }, { field: 'docKey', operator: 'eq', value: 'if_else' }]);
  for (const p of posts) { assert.equal(p.body.offset, 0); assert.ok(!('searchAfter' in p.body)); assert.ok(p.body.pageLimit >= 1000); }
  assert.deepEqual(calls.filter((c) => c.method === 'GET').map((c) => c.path.split('/').pop()).sort(), ['W1', 'W3', 'W6']);
});

test('a short trigger read retries ONCE above count; a still-short read is complete:false with no hits list', async () => {
  const calls = [];
  const ok1 = await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw(calls, { triggers: TRIGGERS.slice(0, 2), trigCount: 5, secondTriggers: TRIGGERS }));
  const trigPosts = calls.filter((c) => c.method === 'POST' && c.body.filters.some((f) => f.value === 'trigger'));
  assert.equal(trigPosts.length, 2); assert.equal(trigPosts[1].body.pageLimit, 105);
  assert.equal(ok1.data.complete, true); assert.equal(ok1.data.hits.length, 3);
  const short = await tool().handler({ locationId: 'LOC', problems: 'mixed-case-tag-rows' }, gw([], { triggers: TRIGGERS.slice(0, 2), trigCount: 5, secondTriggers: TRIGGERS.slice(0, 2) }));
  assert.equal(short.data.complete, false); assert.equal(short.data.hits, null); assert.ok(Array.isArray(short.data.partialHits)); assert.equal(short.data.warnings.length, 1);
});

test('the ordinary mode is untouched: types are still required without problems', async () => {
  const r = await tool().handler({ locationId: 'LOC', types: [] }, gw([]));
  assert.equal(r.ok, false); assert.equal(r.code, 'VALIDATION_FAILED');
});
