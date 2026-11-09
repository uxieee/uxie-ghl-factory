// w6c-2 (bl-785): the engine authors a Loop. RED first (2026-11-07).
// Contract (stored shape, from the w6c-0 Loop read-backs): the loop is one step (type loop) whose next is its first body step
// (or exitNext when the body is empty), and whose attributes hold loopOver, items, startNumber, endNumber, mode and exitNext.
// Body steps carry parentContainerId = the loop; the last body step's next = exitNext, the continuation.
// The IR key for the body is `body` (interface: loop { body: Node[] }). Refusals name GHL's validator keys (see
// console/.superpowers/sdd/release-2026-11-06/router-loop.md section 3): loop_items_single_expression, LOOP_RANGE_TOO_LARGE,
// loop_disconnected_step_error, loop_unsupported_action_error, loop_unsupported_wait_error, loop_empty_body_error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { liftWorkflow } from './lift.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = (f) => join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures', f);
const catalog = loadCatalog();
const ctx = (seed = 'a', extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog, ...extra });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const tag = (ref, tags = ['x']) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${ref}`, attributes: { tags } });
const listLoop = (ref, body, over = {}) => ({ ref, kind: 'loop', name: 'Loop', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential', body, ...over });
const rangeLoop = (ref, body, over = {}) => ({ ref, kind: 'loop', name: 'Loop', loopOver: 'range', startNumber: '1', endNumber: '10', mode: 'sequential', body, ...over });
const irOf = (graph) => ({ name: 'L', triggers: trig, graph });
const templatesOf = (ir, c = ctx()) => compile(ir, c).autoSaveBody.workflowData.templates;
const loopOf = (t) => t.find((s) => s.type === 'loop');

test('list loop: body steps carry parentContainerId = the loop id', () => {
  const t = templatesOf(irOf([listLoop('l', [tag('b1'), tag('b2')])]));
  const loop = loopOf(t);
  const body = t.filter((s) => s.id !== loop.id && s.type !== 'transition');
  assert.equal(body.length, 2);
  for (const s of body) assert.equal(s.parentContainerId, loop.id, `${s.name} is tagged with its loop`);
});

test('loop.next = the first body step', () => {
  const t = templatesOf(irOf([listLoop('l', [tag('b1'), tag('b2')])]));
  const loop = loopOf(t);
  const first = t.find((s) => s.name === 'Tag b1');
  assert.equal(loop.next, first.id, 'the loop enters its body at the first step');
});

test('last body step next = exitNext = the continuation; the continuation is parented to the last body step (w6c-11b)', () => {
  const t = templatesOf(irOf([listLoop('l', [tag('b1'), tag('b2')]), tag('after')]));
  const loop = loopOf(t);
  const last = t.find((s) => s.name === 'Tag b2');
  const after = t.find((s) => s.name === 'Tag after');
  assert.equal(last.next, after.id, 'the last body step continues to exitNext');
  assert.equal(loop.attributes.exitNext, after.id, 'exitNext is the continuation');
  assert.equal(after.parentKey, last.id, 'the continuation is parented to the last body step: GHL checks parentKey = the step whose next points at it (w6c-11b)');
});

test('empty loop: next === exitNext (the continuation)', () => {
  const t = templatesOf(irOf([listLoop('l', []), tag('after')]));
  const loop = loopOf(t);
  const after = t.find((s) => s.name === 'Tag after');
  assert.equal(loop.next, after.id);
  assert.equal(loop.attributes.exitNext, after.id);
});

test('a new range loop defaults to 1..10', () => {
  const t = templatesOf(irOf([{ ref: 'l', kind: 'loop', name: 'Loop', loopOver: 'range', mode: 'sequential', body: [] }]));
  const a = loopOf(t).attributes;
  assert.equal(a.loopOver, 'range');
  assert.equal(a.startNumber, '1');
  assert.equal(a.endNumber, '10');
});

test('items must be one {{...}} expression (loop_items_single_expression)', () => {
  assert.throws(() => compile(irOf([listLoop('l', [], { items: 'a,b' })]), ctx()), (e) => /loop_items_single_expression/.test(e.message));
});

// bl-917 amendment (2026-11-09, orchestrator DECISION): a loop's items may come from a LIST source (a webhook payload, a step
// output, a marketplace output). A loop over a contact field is refused with its reason, because contact fields are not lists
// and GHL runs such a loop 0 times. A stored loop replayed by the round trip (pinIds) is not refused: see the round-trip tests.
test('bl-917: a list loop over a webhook payload list is accepted', () => {
  assert.doesNotThrow(() => compile(irOf([listLoop('l', [tag('b1')], { items: '{{inboundWebhookRequest.items}}' })]), ctx()));
});
test('bl-917: a list loop over a step output list is accepted', () => {
  assert.doesNotThrow(() => compile(irOf([listLoop('l', [tag('b1')], { items: '{{custom_webhook.1.response.items}}' })]), ctx()));
});
test('bl-917: a list loop over a contact field is refused LOOP_ITEMS_CONTACT_FIELD with the reason', () => {
  for (const items of ['{{contact.tags}}', '{{ contact.customFields.budget }}']) {
    assert.throws(() => compile(irOf([listLoop('l', [tag('b1')], { items })]), ctx()),
      (e) => e.code === 'LOOP_ITEMS_CONTACT_FIELD' && /contact fields are not lists; GHL runs this loop 0 times/.test(e.message), items);
  }
});

test('a range whose end is below its start is refused', () => {
  assert.throws(() => compile(irOf([rangeLoop('l', [], { startNumber: '5', endNumber: '2' })]), ctx()), (e) => /end/.test(e.message) && /start/.test(e.message));
});

test('range 0..500 is refused LOOP_RANGE_TOO_LARGE (501 passes), and 1..500 is accepted', () => {
  assert.throws(() => compile(irOf([rangeLoop('l', [], { startNumber: '0', endNumber: '500' })]), ctx()), (e) => e.code === 'LOOP_RANGE_TOO_LARGE');
  assert.doesNotThrow(() => compile(irOf([rangeLoop('l', [], { startNumber: '1', endNumber: '500' })]), ctx()));
});

test('a body step not reachable from loop.next is refused loop_disconnected_step_error', () => {
  const loop = listLoop('l', [tag('b1')]);
  loop.body[0].next = 'nowhere';
  assert.throws(() => compile(irOf([loop]), ctx()), (e) => /loop_disconnected_step_error/.test(e.message));
});

test('loop, workflow_goal, goto, remove_from_workflow and remove_from_all_workflows in the body are refused', () => {
  const banned = [
    { ref: 'x', kind: 'loop', name: 'Inner', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', body: [] },
    { ref: 'x', kind: 'action', type: 'workflow_goal', name: 'Goal', attributes: {} },
    { ref: 'x', kind: 'goto', name: 'Goto', target: 'l' },
    { ref: 'x', kind: 'action', type: 'remove_from_workflow', name: 'Remove', attributes: {} },
    { ref: 'x', kind: 'action', type: 'remove_from_all_workflows', name: 'RemoveAll', attributes: {} },
  ];
  for (const step of banned)
    assert.throws(() => compile(irOf([listLoop('l', [step])]), ctx()), (e) => /loop_unsupported_action_error/.test(e.message), step.type ?? step.kind);
});

test('waits appointment, service_booking, rental_booking, overdue, reply, user_replied, link_clicked, email_event, condition in the body are refused; a time wait is accepted', () => {
  for (const waitType of ['appointment', 'service_booking', 'rental_booking', 'overdue', 'reply', 'user_replied', 'link_clicked', 'email_event', 'condition']) {
    const w = { ref: 'w', kind: 'wait', name: 'Wait', waitType, config: {} };
    assert.throws(() => compile(irOf([listLoop('l', [w])]), ctx()), (e) => /loop_unsupported_wait_error/.test(e.message), waitType);
  }
  const time = { ref: 'w', kind: 'wait', name: 'Wait', config: { unit: 'days', value: 1, when: 'after' } };
  assert.doesNotThrow(() => compile(irOf([listLoop('l', [time])]), ctx()));
});

test('a router and an if_else in the body are accepted', () => {
  const router = { ref: 'r', kind: 'router', name: 'R', branches: [{ ref: 'a', name: 'All', branchType: 'always_run', then: [tag('ra')] }] };
  const ifelse = { ref: 'i', kind: 'if_else', name: 'If', branches: [{ ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail', tag: 'hv' }], then: [tag('iy')] }, { ref: 'n', name: 'No', else: true, then: [] }] };
  // A branching step must be the last step of its list (CONTAINER_NOT_LAST), so each one gets its own loop body.
  assert.doesNotThrow(() => compile(irOf([listLoop('l', [router])]), ctx()));
  assert.doesNotThrow(() => compile(irOf([listLoop('m', [ifelse])]), ctx()));
});

test('a loop inside a router branch is accepted', () => {
  const router = { ref: 'r', kind: 'router', name: 'R', branches: [{ ref: 'a', name: 'All', branchType: 'always_run', then: [listLoop('l', [tag('b1')])] }] };
  assert.doesNotThrow(() => compile(irOf([router]), ctx()));
});

test('{{loopCounter}} is accepted only in range mode', () => {
  const counter = (lo) => ({ ref: 'c', kind: 'action', type: 'add_contact_tag', name: 'C', attributes: { tags: ['{{loopCounter}}'] } });
  assert.doesNotThrow(() => compile(irOf([rangeLoop('l', [counter()])]), ctx()));
  assert.throws(() => compile(irOf([listLoop('l', [counter()])]), ctx()), (e) => /loopCounter/.test(e.message));
});

test('{{loopItem}} and {{loopItem.<path>}} pass the merge-tag check inside a list loop', () => {
  const step = { ref: 'c', kind: 'action', type: 'add_contact_tag', name: 'C', attributes: { tags: ['{{loopItem}}', '{{loopItem.name}}'] } };
  assert.doesNotThrow(() => compile(irOf([listLoop('l', [step])]), ctx()));
});

test('round trip: the list loop fixture lifts to the loop kind and compiles back with the same ids and exitNext', () => {
  const stored = JSON.parse(readFileSync(FIX('loop-list.json'), 'utf8')).templates;
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  assert.ok(lifted.ir.graph.find((n) => n.kind === 'loop'), 'the lift yields a loop kind node');
  assert.equal(lifted.ir.graph.filter((n) => n.kind === 'raw').length, 0, 'no loop carried raw');
  const again = compile(structuredClone(lifted.ir), ctx('r', { pinIds: true, pins: lifted.ir.stored.pins })).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
  assert.equal(again.length, stored.length);
});

test('round trip: the range loop fixture lifts to the loop kind and compiles back with the same ids', () => {
  const stored = JSON.parse(readFileSync(FIX('loop-range.json'), 'utf8')).templates;
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  assert.ok(lifted.ir.graph.find((n) => n.kind === 'loop'), 'the lift yields a loop kind node');
  const again = compile(structuredClone(lifted.ir), ctx('r', { pinIds: true, pins: lifted.ir.stored.pins })).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
});
