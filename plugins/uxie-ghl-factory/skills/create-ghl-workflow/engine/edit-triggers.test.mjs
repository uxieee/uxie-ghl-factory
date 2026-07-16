import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionOps, planTriggerOps, resolveTrigger, applyOps } from './edit-driver.mjs';
import { shouldActivateTriggers, triggerActivationBody } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: undefined, uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('t'), catalog: loadCatalog() });
const WID = 'wid-1';

// the live GET /workflow/{loc}/trigger?workflowId= shape
const existing = () => [
  { id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: true, conditions: [] },
  { id: 'tr2', _id: 'tr2', type: 'contact_changed', name: 'Changed', active: true, conditions: [] },
];

const plan1 = (op, ex = existing()) => planTriggerOps([op], { ctx: ctx(), wid: WID, uid: 'UID', existing: ex })[0];

test('partitionOps splits trigger ops from step ops, preserving order within each', () => {
  const { stepOps, triggerOps } = partitionOps([
    { op: 'addTrigger', trigger: { type: 'contact_tag', name: 'A' } },
    { op: 'deleteStep', stepId: 's1' },
    { op: 'deleteTrigger', triggerId: 'tr1' },
    { op: 'modifyStep', stepId: 's2' },
  ]);
  assert.deepEqual(stepOps.map((o) => o.op), ['deleteStep', 'modifyStep']);
  assert.deepEqual(triggerOps.map((o) => o.op), ['addTrigger', 'deleteTrigger']);
});

test('applyOps rejects a trigger op that was not partitioned out (clear message, not "unknown op")', () => {
  assert.throws(() => applyOps([], [{ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'A' } }],
    { ctx: ctx(), idGen: makeSeededIdGen('z') }), /TRIGGER op.*separate document/s);
});

test('addTrigger posts the FULL corpus-traced envelope, not a lean body', () => {
  const r = plan1({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'VIP', filters: [{ field: 'tagsAdded', value: 'vip' }] } });
  assert.equal(r.method, 'POST');
  assert.equal(r.path, '/workflow/LOC/trigger');
  const b = r.body;
  assert.equal(b.workflowId, WID);              // camelCase at root — snake_case silently no-ops
  assert.equal(b.status, 'draft');
  assert.deepEqual(b.schedule_config, {});
  assert.equal(b.masterType, 'highlevel');
  assert.equal(b.type, 'contact_tag');
  assert.equal(b.name, 'VIP');
  assert.deepEqual(b.actions, [{ workflow_id: WID, type: 'add_to_workflow' }]);  // snake_case here
  assert.equal(b.active, true);
  assert.equal(b.triggersChanged, true);
  assert.equal(b.location_id, 'LOC');
  assert.equal(b.company_age, 0);
});

test('addTrigger: a contact_tag value stays a plain STRING (array = dispatcher never subscribes)', () => {
  // the exact inert-trigger bug class: expandFilter must unwrap a single-element array
  const scalar = plan1({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'V', filters: [{ field: 'tagsAdded', value: 'vip' }] } });
  const wrapped = plan1({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'V', filters: [{ field: 'tagsAdded', value: ['vip'] }] } });
  assert.equal(scalar.body.conditions[0].value, 'vip');
  assert.equal(wrapped.body.conditions[0].value, 'vip', 'a single-element array must be unwrapped on the edit path too');
  assert.equal(Array.isArray(wrapped.body.conditions[0].value), false);
});

test('deleteTrigger issues the DELETE with the required userId query param', () => {
  const r = plan1({ op: 'deleteTrigger', triggerId: 'tr1' });
  assert.equal(r.method, 'DELETE');
  assert.equal(r.path, '/workflow/LOC/trigger/tr1?userId=UID');
});

test('deleteTrigger resolves a name matcher instead of a raw id', () => {
  assert.equal(plan1({ op: 'deleteTrigger', name: 'VIP added' }).path, '/workflow/LOC/trigger/tr1?userId=UID');
});

test('modifyTrigger PUTs the full merged object and keeps the server id', () => {
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { filters: [{ field: 'tagsAdded', value: 'gold' }] } });
  assert.equal(r.method, 'PUT');
  assert.equal(r.path, '/workflow/LOC/trigger/tr1');
  assert.equal(r.body.id, 'tr1');
  assert.equal(r.body._id, 'tr1');
  assert.equal(r.body.type, 'contact_tag');     // unspecified fields carry over from the live trigger
  assert.equal(r.body.name, 'VIP added');
  assert.equal(r.body.conditions[0].value, 'gold');
  assert.equal(r.body.workflowId, WID);
});

test('resolveTrigger: ambiguity is an error, never a silent pick', () => {
  const dupes = [{ id: 'a', type: 'contact_tag', name: 'Dup' }, { id: 'b', type: 'contact_tag', name: 'Dup' }];
  assert.throws(() => resolveTrigger({ op: 'deleteTrigger', name: 'Dup' }, dupes), /2 triggers match.*explicit triggerId/s);
});

test('resolveTrigger: a miss names what is actually there', () => {
  assert.throws(() => resolveTrigger({ op: 'deleteTrigger', triggerId: 'nope' }, existing()), /no trigger nope/);
  assert.throws(() => resolveTrigger({ op: 'deleteTrigger', name: 'Ghost' }, existing()), /no trigger matching name 'Ghost'/);
  assert.throws(() => resolveTrigger({ op: 'deleteTrigger' }, existing()), /needs a triggerId, or a name\/type/);
});

test('activation: only a published workflow gets the cycle; a draft is never published as a side effect', () => {
  assert.equal(shouldActivateTriggers({ status: 'published' }), true);
  assert.equal(shouldActivateTriggers({ status: 'draft' }), false);
  assert.equal(shouldActivateTriggers(undefined), false);
});

test('activation body forces every trigger active and preserves the server envelope', () => {
  const fresh = { _id: 'w', id: 'w', status: 'published', version: 7, filePath: 'keep.json', workflowData: { templates: [] } };
  const b = triggerActivationBody(fresh, [{ id: 'tr1', active: false }, { id: 'tr2', active: true }], 'draft');
  assert.equal(b.status, 'draft');
  assert.equal(b.version, 7);                 // current version — version+1 422s
  assert.equal(b.filePath, 'keep.json');      // server envelope preserved
  assert.equal(b.triggersChanged, false);
  assert.deepEqual(b.oldTriggers, b.newTriggers);
  assert.deepEqual(b.oldTriggers.map((t) => t.active), [true, true]);  // API-added lands false; this flips it
  assert.deepEqual(b.createdSteps, []);
});

// THE REGRESSION. Live-caught 2026-07-17: the published leg was planned by re-asking
// "is this published?" AFTER the draft leg had already made it a draft — so it never
// fired, and a live workflow was downgraded to draft with every trigger switched off.
// The status decision is made ONCE, before the cycle; the second leg must still build
// a published body from the (now draft) re-GET object.
test('activation: the published leg builds from the mid-cycle DRAFT object (never re-gated on status)', () => {
  const mid = { _id: 'w', status: 'draft', version: 8, filePath: 'keep.json' };  // what the re-GET returns
  const b = triggerActivationBody(mid, [{ id: 'tr1', active: false }], 'published');
  assert.equal(b.status, 'published', 'must publish from a draft mid-cycle object — this is the leg that re-publishes');
  assert.equal(b.version, 8, 'must send the re-GET version — the draft PUT bumped it');
  assert.deepEqual(b.oldTriggers.map((t) => t.active), [true]);
});
