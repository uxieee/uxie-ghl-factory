// The round-trip verifier compares sent-vs-stored key sets, so a stage NAME stored verbatim, an
// empty row list, or a ghost id "verifies clean" — eight client workflows shipped with a live
// status row and a dead stage move. This lint is the missing question: does the STORED body
// express a real opportunity write?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintOpportunityWrites } from './opportunity.mjs';

// Flat live shape: GHL stores every node in one list; `parentKey` is the previous node in
// execution order (a prior step, or the transition id for the first step under a branch), a
// transition's `parentKey`/`parent` is its container, a container's `parentKey` is the step before
// it. `__branchKey__` lives on the container's attributes.transitions[] — the transition node
// itself carries only its name, so fixtures put it in both places the way a read-back does.
const finder = (id, parentKey = null) => ({
  id, type: 'find_opportunity', name: 'Find card', parentKey, next: [`${id}-found`, `${id}-notfound`],
  attributes: { type: 'find_opportunity', __customInputFields__: [], transitions: [
    { id: `${id}-found`, name: 'Opportunity Found', meta: { __branchKey__: 'predefined_Opportunity Found' }, conditionType: 'pre-defined' },
    { id: `${id}-notfound`, name: 'Opportunity Not Found', meta: { __branchKey__: 'predefined_Opportunity Not Found' }, conditionType: 'pre-defined' } ] },
});
const found = (id) => ({ id: `${id}-found`, type: 'transition', name: 'Opportunity Found', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: null });
const notFound = (id) => ({ id: `${id}-notfound`, type: 'transition', name: 'Opportunity Not Found', cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: null });
const GOOD_ROWS = [
  { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
  { filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ];
const create = (id, parentKey = null) => ({ id, type: 'internal_create_opportunity', name: 'New card', parentKey, attributes: {
  pipelineId: 'x2f9dK1mQ84hL0pTzVbn', __customInputFields__: [GOOD_ROWS[1]] }, next: null });
const update = (id, parentKey = null, attrs = { __customInputFields__: GOOD_ROWS }) => ({ id, type: 'internal_update_opportunity', name: 'Move', parentKey, attributes: attrs, next: null });

// The body-shape rules below are about the ROWS, so their fixture sits on a bound path (under a
// finder's Found branch) — otherwise every one of them would also report the unbound-path rule.
const step = (attrs) => [finder('f'), found('f'), notFound('f'), update('s1', 'f-found', attrs)];
const codes = (f) => f.map((x) => x.code).sort();

test('no rows, name keys, non-id rows, stage without pipeline — each is named', () => {
  assert.deepEqual(codes(lintOpportunityWrites(step({ allowBackward: false, __customInputFields__: [], __customInputs__: {} }))), ['OPP_NO_ROWS']);
  assert.deepEqual(codes(lintOpportunityWrites(step({ stage: 'Engaged', __customInputFields__: [{ filterField: 'status', value: 'won', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' }] }))), ['OPP_NAME_KEY']);
  assert.deepEqual(codes(lintOpportunityWrites(step({ __customInputFields__: [
    { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'pipelineStageId', value: 'Engaged', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ] }))), ['OPP_ROW_NOT_ID']);
  assert.deepEqual(codes(lintOpportunityWrites(step({ __customInputFields__: [
    { filterField: 'pipelineStageId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ] }))), ['OPP_STAGE_NO_PIPELINE_ROW']);
});

test('a correct write is clean; a merge-tag value is exempt; supplied lists catch ghosts', () => {
  const good = step({ allowBackward: true, __customInputFields__: [
    { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'name', value: '{{contact.name}}', dataType: 'TEXT', valueFieldType: 'string' } ] });
  assert.deepEqual(lintOpportunityWrites(good), []);
  const withLists = lintOpportunityWrites(good, { pipelines: [{ id: 'OTHER', name: 'Main', stages: [{ id: 'OTHER2', name: 'New' }] }] });
  assert.deepEqual(codes(withLists), ['OPP_UNKNOWN_ID', 'OPP_UNKNOWN_ID']);
  assert.equal(withLists[0].severity, 'warning');
});

// Live evidence, GROM sandbox workflow "03 - Booking Started + Chase" (creationSource: builder,
// read back 2026-08-31). Both rules below fired on a workflow whose opportunity writes are
// correct and live-proven, which is what made the whole advisory pack easy to dismiss.
test('a NULL name key is not a leaked name — the builder writes pipeline/stage null itself', () => {
  // Step 2d9ff043 stores {pipeline: null, stage: null} verbatim from the builder. Null is not
  // "the word": nothing is stored and nothing is moved, so there is nothing to report.
  assert.deepEqual(lintOpportunityWrites(step({ pipeline: null, stage: null, allowBackward: true, __customInputFields__: [
    { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ] })), []);
  // An actual name still fires — the rule keeps its teeth.
  assert.deepEqual(codes(lintOpportunityWrites(step({ stage: 'Engaged', __customInputFields__: [
    { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ] }))), ['OPP_NAME_KEY']);
});

test('a TOP-LEVEL pipelineId satisfies the stage-needs-a-pipeline rule', () => {
  // Step 737accb4 (internal_create_opportunity) carries pipelineId as a top-level attribute and
  // pipelineStageId as a row. The pipeline IS specified; reading only the rows misses it.
  assert.deepEqual(lintOpportunityWrites([{ id: 'c', type: 'internal_create_opportunity', name: 'New', attributes: {
    pipelineId: 'x2f9dK1mQ84hL0pTzVbn',
    __customInputFields__: [{ filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' }] } }]), []);
  // With neither a row nor a top-level id, it still fires.
  assert.deepEqual(codes(lintOpportunityWrites(step({ __customInputFields__: [
    { filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ] }))), ['OPP_STAGE_NO_PIPELINE_ROW']);
  // The exemption is create-only. On UPDATE the pipeline belongs in a row, so a top-level id
  // there is the very mistake the rule exists to catch — it must still fire.
  assert.deepEqual(codes(lintOpportunityWrites(step({ pipelineId: 'x2f9dK1mQ84hL0pTzVbn', __customInputFields__: [
    { filterField: 'pipelineStageId', value: 'y3g0eL2nR95iM1qUaWco', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' } ] }))), ['OPP_STAGE_NO_PIPELINE_ROW']);
});

// C-05: the opportunities DTO whitelists top-level properties, so a bare custom-field id becomes
// `property <id> should not exist` — a 400 buried inside a `skipped` row. Only the
// `custom_fields.<id>` spelling makes the action build a customFields entry.
test('a bare custom-field id in filterField is refused; the custom_fields. spelling is clean', () => {
  const bare = lintOpportunityWrites(step({ __customInputFields__: [
    { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'wcuc5AkMTW8iL5FtABWG', value: 'skin peel', dataType: 'TEXT', valueFieldType: 'string' } ] }));
  assert.deepEqual(codes(bare), ['OPP_CUSTOM_FIELD_BARE_ID']);
  assert.match(bare[0].msg, /custom_fields\.wcuc5AkMTW8iL5FtABWG/);
  assert.equal(bare[0].severity, 'error');

  assert.deepEqual(lintOpportunityWrites(step({ __customInputFields__: [
    { filterField: 'pipelineId', value: 'x2f9dK1mQ84hL0pTzVbn', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' },
    { filterField: 'custom_fields.wcuc5AkMTW8iL5FtABWG', value: 'skin peel', dataType: 'TEXT', valueFieldType: 'string' } ] })), []);

  // A standard property keeps its bare name — that is the whole distinction.
  assert.deepEqual(lintOpportunityWrites(step({ __customInputFields__: [
    { filterField: 'monetaryValue', value: 59, dataType: 'NUMERICAL', valueFieldType: 'numerical' } ] })), []);
});

test('non-opportunity steps and create steps are covered too; nothing throws on garbage', () => {
  assert.deepEqual(lintOpportunityWrites([{ id: 'x', type: 'sms', attributes: { body: 'hi' } }]), []);
  assert.deepEqual(codes(lintOpportunityWrites([{ id: 'c', type: 'internal_create_opportunity', name: 'New', attributes: { pipelineId: 'p', __customInputFields__: [] } }])), ['OPP_NO_ROWS']);
  // A bare update at root binds nothing either, so the path rule reports alongside the rows rule.
  assert.deepEqual(lintOpportunityWrites([null, {}, { id: 'y', type: 'internal_update_opportunity' }]).map((f) => f.code).sort(), ['OPP_NO_ROWS', 'OPP_WRITE_UNBOUND_PATH']);
});

// Live evidence, GROM sandbox 2026-08-30: "Mark the card LOST" (internal_update_opportunity) on a
// workflow whose ONLY entry was an opportunity trigger. Entered via the trigger → moved. Entered by
// direct API enrolment → `skipped` with "Internal Action Error - Please use Opportunity
// trigger/find opportunity action to get the opportunity"; on another run `success` with an empty
// meta.actionFrom and the card never moved. Silent both ways. The IR-level OPP_UNASSOCIATED only
// fails when there is NO association at all — a trigger-only association is exactly this shape.
const UNBOUND = 'OPP_WRITE_UNBOUND_PATH';
const unbound = (f) => f.filter((x) => x.code === UNBOUND);

test('an update under the Found branch of a find_opportunity is bound', () => {
  assert.deepEqual(unbound(lintOpportunityWrites([finder('f'), found('f'), notFound('f'), update('u', 'f-found')])), []);
  // Deeper on the same branch — a step between the transition and the write — still bound.
  assert.deepEqual(unbound(lintOpportunityWrites([finder('f'), found('f'), notFound('f'),
    { id: 'w', type: 'wait', name: 'Wait', parentKey: 'f-found', attributes: {}, next: 'u' }, update('u', 'w')])), []);
});

test('an update under Not Found is bound only when a create_opportunity sits between', () => {
  assert.deepEqual(unbound(lintOpportunityWrites([finder('f'), found('f'), notFound('f'), create('c', 'f-notfound'), update('u', 'c')])), []);
  const bare = lintOpportunityWrites([finder('f'), found('f'), notFound('f'), update('u', 'f-notfound')]);
  assert.equal(unbound(bare).length, 1);
  assert.equal(unbound(bare)[0].severity, 'warning');
  assert.equal(unbound(bare)[0].stepId, 'u');
});

test('the Found branch is recognised by name alone when the read-back drops the branch key', () => {
  // Some read-backs carry the name only; both spellings exist live.
  const f = finder('f');
  f.attributes.transitions = [];
  assert.deepEqual(unbound(lintOpportunityWrites([f, found('f'), notFound('f'), update('u', 'f-found')])), []);
  assert.equal(unbound(lintOpportunityWrites([f, found('f'), notFound('f'), update('u', 'f-notfound')])).length, 1);
  // A transition carrying only the branch key on its own meta is enough too.
  const keyed = { ...found('f'), name: 'Found', meta: { __branchKey__: 'predefined_Opportunity Found' } };
  assert.deepEqual(unbound(lintOpportunityWrites([f, keyed, notFound('f'), update('u', 'f-found')])), []);
});

test('an update at root with no find/create anywhere (the "05" shape) fires and names the pattern', () => {
  const f = lintOpportunityWrites([{ id: 'w', type: 'wait', name: 'Wait', parentKey: null, attributes: {}, next: 'u' }, update('u', 'w')]);
  assert.deepEqual(codes(f), [UNBOUND]);
  assert.equal(f[0].severity, 'warning');
  assert.equal(f[0].msg,
    "'Move' writes to a card but nothing on its path binds one — it works only when the run entered "
    + 'through an opportunity trigger; an add_to_workflow from another workflow or a manual/API enrolment '
    + 'SKIPS it silently (or logs success with an empty actionFrom and moves nothing). Use the pattern: '
    + 'find_opportunity → Not Found: create_opportunity → Found: update_opportunity.');
  // A single-step workflow: the write is the root itself.
  assert.deepEqual(codes(lintOpportunityWrites([update('u', null)])), [UNBOUND]);
});

test('an update after a root-level create_opportunity is bound (linear, no find)', () => {
  assert.deepEqual(lintOpportunityWrites([create('c'), update('u', 'c')]), []);
  assert.deepEqual(lintOpportunityWrites([create('c'), { id: 'w', type: 'wait', name: 'Wait', parentKey: 'c', attributes: {}, next: 'u' }, update('u', 'w')]), []);
  // A create AFTER the write does not bind it — order is what the walk recovers.
  assert.equal(unbound(lintOpportunityWrites([update('u'), create('c', 'u')])).length, 1);
  // A create on a SIBLING branch does not bind either.
  const ifElse = { id: 'b', type: 'condition', name: 'Branch', parentKey: null, attributes: { transitions: [] }, next: ['b-yes', 'b-no'] };
  const yes = { id: 'b-yes', type: 'transition', name: 'Yes', parentKey: 'b', parent: 'b', attributes: {}, next: 'c' };
  const no = { id: 'b-no', type: 'transition', name: 'No', parentKey: 'b', parent: 'b', attributes: {}, next: 'u' };
  assert.equal(unbound(lintOpportunityWrites([ifElse, yes, no, create('c', 'b-yes'), update('u', 'b-no')])).length, 1);
});

test('a create_opportunity alone never fires the path rule', () => {
  assert.deepEqual(lintOpportunityWrites([create('c')]), []);
  assert.deepEqual(lintOpportunityWrites([{ id: 'w', type: 'wait', name: 'Wait', parentKey: null, attributes: {}, next: 'c' }, create('c', 'w')]), []);
});

test('a self-pointing or dangling parentKey neither throws nor loops', () => {
  assert.deepEqual(codes(lintOpportunityWrites([update('u', 'u')])), [UNBOUND]);
  assert.deepEqual(codes(lintOpportunityWrites([update('u', 'ghost')])), [UNBOUND]);
  // A two-node cycle above the write.
  const a = { id: 'a', type: 'wait', name: 'A', parentKey: 'b', attributes: {}, next: 'b' };
  const b = { id: 'b', type: 'wait', name: 'B', parentKey: 'a', attributes: {}, next: 'u' };
  assert.deepEqual(codes(lintOpportunityWrites([a, b, update('u', 'b')])), [UNBOUND]);
  // A bound path that is ALSO cyclic further up still counts as bound.
  assert.deepEqual(unbound(lintOpportunityWrites([a, b, create('c', 'b'), update('u', 'c')])), []);
  // Duplicate ids and a non-string parentKey.
  assert.doesNotThrow(() => lintOpportunityWrites([update('u', 42), update('u', { id: 'x' }), create('c', ['a'])]));
});
