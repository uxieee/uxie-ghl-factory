// Unknown op keys are REFUSED BY NAME, never dropped.
//
// Four live findings, one mechanism. `modifyTrigger` with `conditions` at the op's top level
// (R-67, R-96: 8 dead rails on one account), `modifyTrigger` with a top-level `name` meant as
// the NEW name (R-101 — the top-level `name` is the MATCHER, so the rename never happened),
// `modifyTrigger` with `status` (R-80), and `modifyStep` with `attributes` instead of `attrPatch`
// (R-115). In every case the engine consumed nothing, re-sent the stored record, and its verifier
// compared that record against itself and passed. A wrong key must read like a caller bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOpShape, partitionOps, planTriggerOps, applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: undefined, uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: () => {} });
const WID = 'wid-1';
const existing = () => [
  { id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: true, date_updated: '2026-09-01T00:00:00.000Z',
    conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'vip', title: 'Tag Added', type: 'tags' }] },
];
const plan = (op, ex = existing()) => planTriggerOps([op], { ctx: ctx(), wid: WID, uid: 'UID', existing: ex, workflowStatus: 'published' });

// ── modifyTrigger: the R-67 / R-96 shape ─────────────────────────────────────────────────────
test('modifyTrigger with `conditions` at the TOP LEVEL is refused, naming trigger.conditions / trigger.filters', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', conditions: [{ field: 'tagsAdded', value: 'gold' }] }),
    (e) => /modifyTrigger/.test(e.message) && /'conditions'/.test(e.message) && /trigger\.conditions/.test(e.message)
      && /trigger\.filters/.test(e.message) && /nothing would change/i.test(e.message));
});

// ── modifyTrigger: the R-101 shape ───────────────────────────────────────────────────────────
test('modifyTrigger with triggerId AND a top-level `name` is refused as ambiguous — the top-level name is the MATCHER', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', name: 'Renamed' }),
    (e) => /top-level 'name'/.test(e.message) && /MATCHER/.test(e.message) && /trigger\.name/.test(e.message));
});

// ── modifyTrigger: the R-80 shape ────────────────────────────────────────────────────────────
test('modifyTrigger with a top-level `status` is refused, pointing at trigger.active', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', status: 'draft' }),
    (e) => /'status'/.test(e.message) && /trigger\.active/.test(e.message));
});

test('modifyTrigger with `status` INSIDE trigger is refused too — status is not an authored field', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { status: 'draft' } }),
    (e) => /trigger\.status/.test(e.message) && /trigger\.active/.test(e.message));
});

test('modifyTrigger with no `trigger` patch (or an empty one) is refused as "nothing to change"', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1' }), /nothing to change/);
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: {} }), /nothing to change/);
});

test('modifyTrigger with an unknown key inside trigger is refused, listing the accepted keys', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { customTriggerType: 'custom_scenario' } }),
    (e) => /trigger\.customTriggerType/.test(e.message) && /accepts:/.test(e.message) && /filters/.test(e.message) && /conditions/.test(e.message));
});

test('modifyTrigger with BOTH filters and conditions is refused — they are two spellings of the same rows', () => {
  assert.throws(() => plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { filters: [], conditions: [] } }), /either .*filters.* or .*conditions/);
});

// ── the stored-shape door: R-67's hand recipe, typed ─────────────────────────────────────────
test('modifyTrigger accepts trigger.conditions in the STORED shape and PUTs them VERBATIM (title/type kept, no expansion)', () => {
  const rows = [{ field: 'tagsAdded', operator: 'index-of-true', value: 'gold', title: 'Tag Added', type: 'tags' }];
  const [r] = plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { conditions: rows } });
  assert.equal(r.method, 'PUT');
  assert.deepEqual(r.body.conditions, rows);
  assert.deepEqual(r.requested, { conditions: rows }, 'the plan records exactly what the CALLER asked for, so the verifier can hold the store to it');
});

test('addTrigger accepts trigger.conditions verbatim too — cloning a stored trigger onto another workflow must not silently drop its rows', () => {
  const rows = [{ field: 'tagsAdded', operator: 'index-of-true', value: 'gold', title: 'Tag Added', type: 'tags' }];
  const [r] = plan({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'Gold', conditions: rows } });
  assert.equal(r.method, 'POST');
  assert.deepEqual(r.body.conditions, rows);
  assert.equal(r.body.workflowId, WID);
});

test('modifyTrigger records `requested` for every caller-named field (the verifier compares THESE, not the engine intent)', () => {
  const [r] = plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { name: 'Renamed', targetActionId: 'step-9' } });
  assert.deepEqual(r.requested, { name: 'Renamed', targetActionId: 'step-9' });
  assert.equal(r.body.name, 'Renamed');
  assert.equal(r.before?.date_updated, '2026-09-01T00:00:00.000Z', 'the pre-write row rides on the plan so date_updated can be asserted MOVED');
});

// ── no-op detection: D-67's "two reported successes, zero writes" ───────────────────────────
test('modifyTrigger whose every requested value already matches the store plans a NOOP (no PUT), with the reason', () => {
  const [r] = plan({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { name: 'VIP added' } });
  assert.equal(r.noop, true);
  assert.equal(r.method, undefined);
  assert.equal(r.triggerId, 'tr1');
  assert.match(r.reason, /already matches/);
});

// ── step ops: the R-115 shape and its cousins ────────────────────────────────────────────────
test('modifyStep with `attributes` is refused naming attrPatch (R-115)', () => {
  assert.throws(() => checkOpShape({ op: 'modifyStep', stepId: 's1', attributes: { body: 'x' } }),
    (e) => /you passed 'attributes'/.test(e.message) && /attrPatch/.test(e.message));
});

test('modifyStep with a top-level `name` is refused naming renameStep and stepPatch', () => {
  assert.throws(() => checkOpShape({ op: 'modifyStep', stepId: 's1', name: 'New', attrPatch: {} }),
    (e) => /'name'/.test(e.message) && /renameStep/.test(e.message) && /stepPatch/.test(e.message));
});

test('insertBefore with `stepId` is refused naming beforeId; insertAfter with `stepId` names afterId', () => {
  assert.throws(() => checkOpShape({ op: 'insertBefore', stepId: 's1', step: { type: 'sms' } }),
    (e) => /you passed 'stepId'/.test(e.message) && /beforeId/.test(e.message));
  assert.throws(() => checkOpShape({ op: 'insertAfter', stepId: 's1', step: { type: 'sms' } }),
    (e) => /you passed 'stepId'/.test(e.message) && /afterId/.test(e.message));
});

test('any unknown top-level key on a step op is refused with the accepted list', () => {
  assert.throws(() => checkOpShape({ op: 'deleteStep', stepId: 's1', cascade: true }),
    (e) => /unknown key\(s\) \[cascade\]/.test(e.message) && /takes: stepId/.test(e.message));
});

test('deleteTrigger / duplicateTrigger with `id` are refused naming triggerId', () => {
  assert.throws(() => checkOpShape({ op: 'deleteTrigger', id: 'tr1' }), /you passed 'id' — this op takes 'triggerId'/);
  assert.throws(() => checkOpShape({ op: 'duplicateTrigger', id: 'tr1' }), /triggerId/);
});

test('partitionOps runs the shape check over EVERY op, so a bad trigger op fails before any step op is applied', () => {
  assert.throws(() => partitionOps([{ op: 'renameStep', stepId: 's1', name: 'ok' }, { op: 'modifyTrigger', triggerId: 'tr1', conditions: [] }]),
    /trigger\.conditions/);
  assert.throws(() => partitionOps([{ op: 'updateSettings', settings: {}, name: 'x' }]), /unknown key\(s\) \[name\]/);
});

test('the accepted shapes still pass untouched', () => {
  const stored = [{ id: 's1', type: 'sms', name: 'Hi', next: null, parentKey: null, order: 0, attributes: { body: 'a' } }];
  const { templates } = applyOps(stored, [
    { op: 'modifyStep', stepId: 's1', attrPatch: { body: 'b' }, stepPatch: { name: 'Hello' } },
    { op: 'renameStep', stepId: 's1', name: 'Hello again' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('k') });
  assert.equal(templates[0].name, 'Hello again');
  assert.equal(templates[0].attributes.body, 'b');
  const [r] = plan({ op: 'modifyTrigger', name: 'VIP added', trigger: { filters: [{ field: 'tagsAdded', value: 'gold' }] } });
  assert.equal(r.method, 'PUT');
  assert.equal(r.body.conditions[0].value, 'gold');
});
