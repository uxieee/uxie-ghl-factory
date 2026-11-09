// w6c-11b (orchestrator decision 2026-11-07, live refusal on TEST-CONF-W6C-11-loop-list): a Loop followed by a step must store the
// continuation's parentKey as the LAST BODY STEP (the step whose next points at it), not the Loop. GHL's structural check refused
// "next contains X but that node's parentKey is <loop> instead of <last body step>". RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const catalog = loadCatalog();
const ctx = (seed = 'a') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const tag = (ref, tags = ['x']) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${ref}`, attributes: { tags } });
const wait = (ref) => ({ ref, kind: 'wait', name: `Wait ${ref}`, config: { unit: 'days', value: 1, when: 'after' } });
const build = (graph) => compile({ name: 'L', triggers: trig, graph }, ctx()).autoSaveBody.workflowData.templates;
const byName = (ts, name) => ts.find((t) => t.name === name);

test('loop (list) followed by a step: the continuation is parented to the last body step, and that step points at it', () => {
  const ts = build([{ ref: 'l', kind: 'loop', name: 'Loop list', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential',
    body: [tag('a'), tag('b')] }, wait('w')]);
  const loop = byName(ts, 'Loop list'); const a = byName(ts, 'Tag a'); const b = byName(ts, 'Tag b'); const w = byName(ts, 'Wait w');
  assert.equal(b.next, w.id, 'the last body step points at the continuation');
  assert.equal(w.parentKey, b.id, 'the continuation is parented to the last body step (what GHL checks)');
  assert.equal(a.parentKey, loop.id, 'the first body step is parented to the loop');
  assert.equal(loop.attributes.exitNext, w.id, 'the loop exits to the continuation');
});

test('loop (range) followed by a step: the same continuation rule', () => {
  const ts = build([{ ref: 'l', kind: 'loop', name: 'Loop range', loopOver: 'range', startNumber: '1', endNumber: '5', mode: 'sequential',
    body: [tag('c'), tag('d')] }, wait('w')]);
  const d = byName(ts, 'Tag d'); const w = byName(ts, 'Wait w');
  assert.equal(d.next, w.id);
  assert.equal(w.parentKey, d.id);
});

test('a step after a loop with a body of one step: the continuation is parented to that step', () => {
  const ts = build([{ ref: 'l', kind: 'loop', name: 'Loop one', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential',
    body: [tag('a')] }, wait('w')]);
  assert.equal(byName(ts, 'Wait w').parentKey, byName(ts, 'Tag a').id);
});

test('a step BEFORE a loop is unchanged: the loop is parented to the step before it', () => {
  const ts = build([wait('w0'), { ref: 'l', kind: 'loop', name: 'Loop list', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential',
    body: [tag('a')] }]);
  assert.equal(byName(ts, 'Loop list').parentKey, byName(ts, 'Wait w0').id);
});

// The edit path (insertAfter) keeps the same rule.
import { insertAfter } from './edit.mjs';
const newTag = (id) => ({ id, type: 'add_contact_tag', name: 'New', attributes: { tags: ['n'] }, order: 0 });

test('edit: insert after the last body step, the continuation follows the new step (w6c-11b)', () => {
  const t = build([{ ref: 'l', kind: 'loop', name: 'Loop list', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential',
    body: [tag('a'), tag('b')] }, wait('w')]);
  const b = byName(t, 'Tag b'); const w = byName(t, 'Wait w');
  const { templates } = insertAfter(t, newTag('n1'), b.id);
  assert.equal(templates.find((s) => s.id === 'n1').parentKey, b.id, 'the new step is parented to the old last body step');
  assert.equal(templates.find((s) => s.id === w.id).parentKey, 'n1', 'the continuation is parented to the new last body step');
  assert.equal(templates.find((s) => s.id === 'n1').next, w.id, 'the new step runs to the continuation');
});

test('edit: insert after the loop (with a body), the new continuation is parented to the body tail (w6c-11b)', () => {
  const t = build([{ ref: 'l', kind: 'loop', name: 'Loop list', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential',
    body: [tag('a'), tag('b')] }]);
  const loop = byName(t, 'Loop list'); const b = byName(t, 'Tag b');
  const { templates } = insertAfter(t, newTag('n2'), loop.id);
  assert.equal(templates.find((s) => s.id === 'n2').parentKey, b.id, 'the new continuation is parented to the body tail');
  assert.equal(templates.find((s) => s.id === b.id).next, 'n2', 'the body tail runs to the new continuation');
  assert.equal(loop.attributes.exitNext, undefined, 'the source loop object is not mutated');
});
