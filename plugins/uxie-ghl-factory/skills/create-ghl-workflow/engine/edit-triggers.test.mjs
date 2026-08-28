import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as editDriver from './edit-driver.mjs';
import { partitionOps, planTriggerOps, resolveTrigger, applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: undefined, uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('t'), catalog: loadCatalog() });
const WID = 'wid-1';

// the live GET /workflow/{loc}/trigger?workflowId= shape
const existing = () => [
  { id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: true, conditions: [] },
  { id: 'tr2', _id: 'tr2', type: 'contact_changed', name: 'Changed', active: true, conditions: [] },
];

const plan1 = (op, ex = existing(), workflowStatus) => planTriggerOps([op], { ctx: ctx(), wid: WID, uid: 'UID', existing: ex, workflowStatus })[0];

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

// Bug fix 2026-08-28 (measured mechanism, same day as the modifyTrigger refusal below): a
// trigger's `active` is a read-only projection of its OWN `status` field
// ("draft"|"published") — `active === (status !== "draft")`. On POST, `status` follows the
// TARGET WORKFLOW's publish state: "published" lands the trigger active immediately (no known
// write ever activated a trigger against an already-published workflow before this — see
// edit-driver.mjs's REMOVED-2026-08-28 note); "draft" keeps draft-first true — a trigger added
// to a still-draft workflow must stay inactive until the workflow itself is published.
// planTriggerOps cannot see the workflow document, so callers (mcp-internal/core/tools.mjs's
// edit_workflow, scripts/edit.mjs) pass it in as `workflowStatus`.
test('addTrigger sends status:"published" when the target workflow is already published — this is what activates it immediately, no publish cycle needed', () => {
  const r = plan1({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'VIP', filters: [] } }, existing(), 'published');
  assert.equal(r.body.status, 'published');
});

test('addTrigger sends status:"draft" when the target workflow is a draft — draft-first: stays inactive until the workflow itself publishes', () => {
  const r = plan1({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'VIP', filters: [] } }, existing(), 'draft');
  assert.equal(r.body.status, 'draft');
});

test('addTrigger defaults to status:"draft" when workflowStatus is not passed at all — the safe default for a caller not yet updated', () => {
  const r = plan1({ op: 'addTrigger', trigger: { type: 'contact_tag', name: 'VIP', filters: [] } });
  assert.equal(r.body.status, 'draft');
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

// BUG (live, client-affecting — fixed 2026-08-28): modifyTrigger rebuilds its PUT body through
// buildTrigger, which hardcodes `status: 'draft'` (correct ONLY on the fresh-workflow BUILD
// path — see compiler.mjs). Left in place, that 'draft' rode every modifyTrigger PUT and
// DEACTIVATED the trigger being edited on a published workflow — the long-standing "modifyTrigger
// flips active to FALSE" observation from 17 Aug, finally explained by the mechanism measured
// 2026-08-28: `active` is a read-only projection of the trigger's own `status` field
// (`active === (status !== 'draft')`), and a bare PUT with no explicit intent must send NO
// `status` key at all — absent is proven to leave it unchanged. This is the regression test.
test('modifyTrigger on a published trigger sends NO status key for a pure content edit — it must never carry buildTrigger\'s hardcoded draft status', () => {
  const ex = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: true, conditions: [] }];
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { filters: [{ field: 'tagsAdded', value: 'gold' }] } }, ex);
  assert.equal('status' in r.body, false,
    'a content-only modifyTrigger must never leak buildTrigger\'s hardcoded draft status onto the PUT — that is what deactivated a live, published trigger on every edit');
});

// Task 9 (workflow save-correctness): modifyTrigger used to hard-code `active: op.trigger?.active
// ?? true` — so editing anything else about a trigger GHL's own API had landed OFF (every
// API-created trigger, per addTrigger's doc comment above) silently switched it back ON. There is
// a standing project rule against enabling anything found off. The fix preserves the STORED
// active flag when the caller doesn't mention it at all. This test and 'defaults to OFF, not
// ON' below also now pin the third/fourth translate cases below: an ABSENT `active` never
// provokes a status write, only a genuine attempted CHANGE does.
test('modifyTrigger preserves a stored INACTIVE trigger — it must never force-activate a trigger the caller did not ask to touch', () => {
  const ex = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: false, conditions: [] }];
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { filters: [{ field: 'tagsAdded', value: 'gold' }] } }, ex);
  assert.equal(r.body.active, false, 'a trigger found OFF must stay OFF unless the caller explicitly asks to activate it');
});

// TRANSLATED, not refused, as of 2026-08-28 (later the same day) — see edit-driver.mjs's
// translateActiveToStatus for the mechanism. The two tests that used to live here (until this
// same day) asserted that ANY attempted `active` change threw, on the belief that no per-trigger
// PUT body could ever move `active` in either direction. That belief was RIGHT about `active`
// itself and INCOMPLETE about `status`: further measurement the same day (throwaway probes on
// the designated test sub-account) found the trigger's own `status` field ("draft"|"published")
// is what `active` projects, and IS controlled by this exact PUT — the disproof experiments only
// ever sent (or omitted) `active`, never `status`, and the roster GET that fed them never surfaces
// `status` at all, so nobody could see it was the missing field. A genuine attempted CHANGE is
// now translated into the corresponding `status` write instead of thrown away.
test('modifyTrigger translates active:false→true (a genuine change) into status:"published"', () => {
  const ex = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: false, conditions: [] }];
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { active: true, filters: [] } }, ex);
  assert.equal(r.body.status, 'published', 'an explicit activation must translate into the field that actually controls it');
});

test('modifyTrigger translates active:true→false (a genuine change) into status:"draft"', () => {
  const ex = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: true, conditions: [] }];
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { active: false, filters: [] } }, ex);
  assert.equal(r.body.status, 'draft', 'an explicit deactivation must translate into the field that actually controls it');
});

test('modifyTrigger allows an explicit active value that MATCHES the stored trigger — a harmless no-op echo, and sends NO status write for it', () => {
  const ex = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', active: true, conditions: [] }];
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { active: true, filters: [] } }, ex);
  assert.equal(r.body.active, true, 'echoing the current value back must not be refused — only a genuine CHANGE is');
  assert.equal('status' in r.body, false, 'matching the stored value is not a change — it must not provoke a status write at all');
});

test('modifyTrigger on a stored trigger with no active flag at all defaults to OFF, not ON, and sends no status write', () => {
  const ex = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'VIP added', conditions: [] }];
  const r = plan1({ op: 'modifyTrigger', triggerId: 'tr1', trigger: { filters: [] } }, ex);
  assert.equal(r.body.active, false);
  assert.equal('status' in r.body, false, 'active being absent everywhere is not a change — it must not provoke a status write');
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

// HISTORY (do not re-propose either of these):
//   RETIRED 2026-08-27 (Task 9, workflow save-correctness): shouldActivateTriggers /
//   triggerActivationBody implemented a draft→published double full-document PUT, forcing
//   every trigger's `active` onto that PUT's oldTriggers/newTriggers roster. Live-proven
//   INERT — GHL accepts the PUT, bumps the version, and the stored trigger's `active` flag
//   never moves.
//   RETIRED 2026-08-28: what replaced it, planTriggerActivation() (formerly exported from
//   this module), built one PUT /workflow/{loc}/trigger/{triggerId} per inactive trigger,
//   carrying the whole record with active:true. This module used to unit-test that planner
//   directly (only-inactive-gets-a-PUT, whole-record-not-a-patch, all-active-plans-nothing).
//   Measurement (throwaway probes on the designated test sub-account, 2026-08-28, three
//   experiments) proved the write itself was inert: a publish with ZERO trigger writes
//   still activates every trigger sub-second after the publish PUT returns, and a
//   per-trigger PUT with active:false against a published workflow returns 200 with the
//   trigger reading active:true regardless. `active` is a SERVER-MANAGED PROJECTION of the
//   workflow's publish state, not a field this endpoint's body controls in either
//   direction. The planner was removed rather than kept unused — see edit-driver.mjs for
//   the full record. The three unit tests above are replaced by the one below, which pins
//   the new contract: this module offers no per-trigger activation planner at all. The
//   integration-level assertions (publish sends no such write; the post-write verification
//   still fires and fails loudly on an inactive trigger) live in
//   mcp-internal/test/publish-workflow.test.mjs and orchestrate.test.mjs, where the actual
//   publish handlers run.
test('edit-driver exports no per-trigger activation planner — activation is not a write this module offers', () => {
  assert.equal('planTriggerActivation' in editDriver, false,
    'planTriggerActivation was removed 2026-08-28 as a proven-inert write; do not reintroduce it here');
});
