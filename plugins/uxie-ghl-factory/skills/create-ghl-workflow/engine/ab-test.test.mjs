// w6c-5 (plan Task 5, bl-788, authoring half): the A/B Test step. The IR kind ab_test, compiled to GHL's workflow_ab_test container
// (paths with their transitions, extras.metric, endCondition, afterEnd). The event metric (goal + goal extras) is what the w6c-0
// fixture fixtures/ab-test-event.json stores; a contact-condition metric is refused (its shape has no fixture yet).
// RED first: the ab_test kind is not claimed by any handler until GREEN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { liftWorkflow } from './lift.mjs';
import { evaluateWorkflowRules } from './graph-rules.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = (f) => join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures', f);
const catalog = loadCatalog();
const ctx = (seed = 'ab', extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog, ...extra });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const paths = (n) => Array.from({ length: n }, (_, i) => ({ ref: `p${i}`, then: [] }));
const abIr = (over = {}, n = 2) => ({ name: 'AB', triggers: trig, graph: [{ ref: 'ab', kind: 'ab_test', name: 'A/B Test', paths: paths(n),
  metric: { kind: 'event', goal: 'form_submission', goalExtras: { formIds: ['F1'] } }, endCondition: { type: 'contacts', numberOfContacts: 200 }, ...over }] });
const abOf = (ts) => ts.find((t) => t.type === 'workflow_ab_test');
const compileAb = (ir, c = ctx()) => compile(ir, c).autoSaveBody.workflowData.templates;

test('2 to 10 paths are accepted; 1 and 11 are refused (ab_test_paths_required)', () => {
  assert.doesNotThrow(() => compileAb(abIr({}, 2)));
  assert.doesNotThrow(() => compileAb(abIr({}, 10)));
  assert.throws(() => compileAb(abIr({}, 1)), (e) => /ab_test_paths_required/.test(e.message));
  assert.throws(() => compileAb(abIr({}, 11)), (e) => /ab_test_paths_required/.test(e.message));
});

test('path names default to Path A, Path B, ... and paths[i].id === transitions[i].id', () => {
  const c = abOf(compileAb(abIr({}, 3)));
  assert.deepEqual(c.attributes.transitions.map((t) => t.name), ['Path A', 'Path B', 'Path C']);
  assert.deepEqual(c.attributes.paths.map((p) => p.id), c.attributes.transitions.map((t) => t.id));
  assert.deepEqual(c.next, c.attributes.transitions.map((t) => t.id), 'the container runs to its path ids');
});

test('a missing metric is refused (ab_test_metric_required)', () => {
  const ir = abIr();
  delete ir.graph[0].metric;
  assert.throws(() => compileAb(ir), (e) => /ab_test_metric_required/.test(e.message));
});

test('a missing endCondition is refused (ab_test_end_condition_required)', () => {
  const ir = abIr();
  delete ir.graph[0].endCondition;
  assert.throws(() => compileAb(ir), (e) => /ab_test_end_condition_required/.test(e.message));
});

test('a user_replied goal is refused (ab_test_goal_unsupported)', () => {
  assert.throws(() => compileAb(abIr({ metric: { kind: 'event', goal: 'user_replied', goalExtras: {} } })), (e) => /ab_test_goal_unsupported|user_replied/.test(e.message));
});

test('a date endCondition is a local time with no Z (refused with Z; a local value passes)', () => {
  assert.throws(() => compileAb(abIr({ endCondition: { type: 'date', endDate: '2026-12-31T17:00:00Z' } })), (e) => /ab_test_date_local/.test(e.message));
  // GHL's end-date field is endDate (AbTest.ts:360, schema/ab-test.interface.ts: endDate: string), not value.
  const d = abOf(compileAb(abIr({ endCondition: { type: 'date', endDate: '2026-12-31T17:00:00' } })));
  assert.deepEqual(d.attributes.extras.endCondition, { type: 'date', endDate: '2026-12-31T17:00:00' });
});

test('an A/B step stores no split weights (the paths are an even test, not a weighted split)', () => {
  const c = abOf(compileAb(abIr()));
  assert.equal(c.attributes.extras.weightDistribution, undefined);
});

test('afterEnd defaults to route_to_winner; resetTestRun is emitted only when asked', () => {
  const c = abOf(compileAb(abIr()));
  assert.equal(c.attributes.extras.afterEnd, 'route_to_winner');
  assert.equal(c.attributes.extras.resetTestRun, undefined);
  const r = abOf(compileAb(abIr({ resetTestRun: true })));
  assert.equal(r.attributes.extras.resetTestRun, true);
});

test('round trip on the w6c-0 fixture ab-test-event.json: lift keeps the ab_test kind and compile keeps the ids', () => {
  const stored = JSON.parse(readFileSync(FIX('ab-test-event.json'), 'utf8')).templates;
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  assert.ok(lifted.ir.graph.some((n) => n.kind === 'ab_test'), 'the A/B step lifts to the ab_test kind, not frozen as stored');
  const again = compile(structuredClone(lifted.ir), { ...ctx('r'), pinIds: true, pins: lifted.ir.stored.pins }).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
});

// Port of GHL's workflowAbTestValidator (utils/validators/additional-action-validators.ts; all three findings are WARNINGS in GHL, so
// they are advisories here, not refusals): paths must be 2 to 10; the metric must hold a condition (hasMetricCondition); the end
// condition must be complete (contacts or conversions count, a date needs its endDate; hasCompleteEndCondition).
const abRules = (templates) => evaluateWorkflowRules({ templates, triggers: trig }, catalog.workflowRules).advisories
  .filter((f) => f.rule === 'workflowAbTestValidator').map((f) => f.message);
const compiledAb = () => abOf(compileAb(abIr({}, 2)));

test('graph-rules: a stored A/B step with one path warns ab_test_paths_required (a warning, not a refusal)', () => {
  const c = compiledAb();
  c.attributes.paths = c.attributes.paths.slice(0, 1);
  const r = evaluateWorkflowRules({ templates: [c], triggers: trig }, catalog.workflowRules);
  assert.ok(r.advisories.some((f) => f.rule === 'workflowAbTestValidator' && /ab_test_paths_required/.test(f.message)), 'warned');
  assert.equal(r.findings.some((f) => f.rule === 'workflowAbTestValidator'), false, 'not refused');
});

test('graph-rules: an A/B step with no metric condition warns ab_test_metric_required', () => {
  const c = compiledAb();
  c.attributes.extras.metric.matchCriteria.segments = [{ op: 'or', conditions: [] }];
  assert.ok(abRules([c]).some((m) => /ab_test_metric_required/.test(m)));
});

test('graph-rules: an incomplete end condition warns ab_test_end_condition_required (contacts with no count; a date with no endDate)', () => {
  const contacts = compiledAb();
  contacts.attributes.extras.endCondition = { type: 'contacts', numberOfContacts: 0 };
  assert.ok(abRules([contacts]).some((m) => /ab_test_end_condition_required/.test(m)), 'contacts with no count');
  const date = compiledAb();
  date.attributes.extras.endCondition = { type: 'date', endDate: '' };
  assert.ok(abRules([date]).some((m) => /ab_test_end_condition_required/.test(m)), 'a date with no endDate');
});

test('graph-rules: a complete A/B step raises no workflowAbTestValidator warning', () => {
  assert.deepEqual(abRules([compiledAb()]), []);
});

// QA's w6c-5 heads-up (items 2 and 3): a conversions end condition is authored (AbTest.ts:356-357; plan Interfaces); GHL marks a zero or
// missing count invalid (AbTest.ts:447-448, `!n`), and afterEnd is one of route_to_winner | keep_splitting (ab-test.interface.ts:39-42).
test('a conversions end condition is authored: {type: conversions, numberOfConversions} is stored as given', () => {
  const c = abOf(compileAb(abIr({ endCondition: { type: 'conversions', numberOfConversions: 50 } })));
  assert.deepEqual(c.attributes.extras.endCondition, { type: 'conversions', numberOfConversions: 50 });
});

test('a contacts or conversions end with a zero or missing count is refused (ab_test_end_count_required)', () => {
  assert.throws(() => compileAb(abIr({ endCondition: { type: 'contacts', numberOfContacts: 0 } })), (e) => /ab_test_end_count_required/.test(e.message));
  assert.throws(() => compileAb(abIr({ endCondition: { type: 'conversions' } })), (e) => /ab_test_end_count_required/.test(e.message));
});

test('afterEnd must be route_to_winner or keep_splitting (ab_test_after_end_unknown); keep_splitting is stored as given', () => {
  assert.throws(() => compileAb(abIr({ afterEnd: 'nope' })), (e) => /ab_test_after_end_unknown/.test(e.message));
  assert.equal(abOf(compileAb(abIr({ afterEnd: 'keep_splitting' }))).attributes.extras.afterEnd, 'keep_splitting');
});

// w6c-6 (QA follow-up 2, orchestrator START): a goal must carry the reference its criterion watches, or the saved criterion is empty.
// The keys are the ones GHL reads (goal-action-validator.ts: formIds, stepIds, linkIds, calendarId, globalProductIds, templateId;
// ab-test-linked-steps.ts: invoiceStepIds; InvoicePaidGoalCondition.ts: invoiceStatuses). The tag and review goals have no confirmed
// key in the bundle, so they are not checked here.
test('a form_submission goal with no formIds, or an empty list, is refused (ab_test_goal_extras_missing)', () => {
  assert.throws(() => compileAb(abIr({ metric: { kind: 'event', goal: 'form_submission', goalExtras: {} } })), (e) => /ab_test_goal_extras_missing/.test(e.message));
  assert.throws(() => compileAb(abIr({ metric: { kind: 'event', goal: 'form_submission', goalExtras: { formIds: [] } } })), (e) => /ab_test_goal_extras_missing/.test(e.message));
});

test('an invoice_paid goal needs invoiceStepIds AND invoiceStatuses', () => {
  assert.throws(() => compileAb(abIr({ metric: { kind: 'event', goal: 'invoice_paid', goalExtras: { invoiceStepIds: ['s1'] } } })), (e) => /ab_test_goal_extras_missing/.test(e.message));
  assert.doesNotThrow(() => compileAb(abIr({ metric: { kind: 'event', goal: 'invoice_paid', goalExtras: { invoiceStepIds: ['s1'], invoiceStatuses: ['paid'] } } })));
});

test('a link_click goal with its linkIds compiles; an email_event goal with no stepIds is refused', () => {
  assert.doesNotThrow(() => compileAb(abIr({ metric: { kind: 'event', goal: 'link_click', goalExtras: { linkIds: ['L1'] } } })));
  assert.throws(() => compileAb(abIr({ metric: { kind: 'event', goal: 'email_event', goalExtras: {} } })), (e) => /ab_test_goal_extras_missing/.test(e.message));
});

// wf-3 (bl-788, part 2): the contact-tag goal. The builder keys it as tags[] (ContactTagGoalCondition), and ab-1 proved it live: the draft
// stored goal_condition add_contact_tag with extras.tags, and GHL counted the tag. RED first: GOAL_REFERENCE had no entry for it, so an empty
// tag goal was saved with an empty criterion (the bl-788 failure mode).
const tagGoalIr = (extras, paths2 = [
  { ref: 'pa', then: [{ ref: 'ta', kind: 'action', type: 'add_contact_tag', name: 'Path A tag', attributes: { tags: ['test-conf-ab-path-a'] } }] },
  { ref: 'pb', then: [{ ref: 'tb', kind: 'action', type: 'add_contact_tag', name: 'Path B tag', attributes: { tags: ['test-conf-ab-path-b'] } }] },
]) => ({ name: 'AB-1', triggers: [{ ref: 't', type: 'contact_tag', name: 'Tag added', filters: [{ field: 'tagsAdded', value: 'test-conf-ab-enter' }] }],
  graph: [{ ref: 'ab', kind: 'ab_test', name: 'A/B Test', paths: paths2,
    metric: { kind: 'event', goal: 'add_contact_tag', goalExtras: extras },
    endCondition: { type: 'contacts', numberOfContacts: 200 }, afterEnd: 'route_to_winner' }] });

test('an add_contact_tag goal with no tags is refused (ab_test_goal_extras_missing): an empty tag criterion must not be saved', () => {
  assert.throws(() => compileAb(tagGoalIr({})), (e) => /ab_test_goal_extras_missing/.test(e.message));
  assert.throws(() => compileAb(tagGoalIr({ tags: [] })), (e) => /ab_test_goal_extras_missing/.test(e.message));
});

test('the ab-1 shape compiles to the stored win criterion: goal_condition add_contact_tag, extras.tags as given (proven live 2026-11-08)', () => {
  const ts = compileAb(tagGoalIr({ tags: ['test-conf-ab-won'] }));
  const cond = abOf(ts).attributes.extras.metric.matchCriteria.segments[0].conditions[0];
  assert.equal(cond.goal_condition, 'add_contact_tag');
  assert.deepEqual(cond.extras, { tags: ['test-conf-ab-won'] });
});

test('the change does not widen: a goal type with no key is still accepted as before (review_request_clicked, no extras)', () => {
  assert.doesNotThrow(() => compileAb({ name: 'AB', triggers: trig, graph: [{ ref: 'ab', kind: 'ab_test', name: 'A/B Test', paths: paths(2),
    metric: { kind: 'event', goal: 'review_request_clicked', goalExtras: {} }, endCondition: { type: 'contacts', numberOfContacts: 200 } }] }));
});

// wf-3b (QA follow-up a, ruled by the orchestrator): a blank or whitespace-only tag is not a tag. A tag goal that names one (["", "  "], or a
// real tag beside a blank one) would save a criterion GHL cannot match. RED first: the goal accepted any non-empty list.
test('an add_contact_tag goal whose tags include a blank or whitespace-only name is refused (ab_test_goal_extras_missing)', () => {
  assert.throws(() => compileAb(tagGoalIr({ tags: [''] })), (e) => /ab_test_goal_extras_missing/.test(e.message));
  assert.throws(() => compileAb(tagGoalIr({ tags: ['  '] })), (e) => /ab_test_goal_extras_missing/.test(e.message));
  assert.throws(() => compileAb(tagGoalIr({ tags: ['test-conf-ab-won', ' '] })), (e) => /ab_test_goal_extras_missing/.test(e.message));
});
