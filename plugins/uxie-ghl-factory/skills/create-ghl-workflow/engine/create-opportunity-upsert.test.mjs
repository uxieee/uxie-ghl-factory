import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { parseIR } from './ir.mjs';

// `create_opportunity` is the builder's OWN "Create/Update Opportunity" action
// (recovered-source/src/models/actions/CreateOpportunity.ts:26, locale key
// `create_update_opportunity`): it updates the contact's existing card in that pipeline and only
// creates when there is none.
//
// The engine used to compile that intent to `internal_create_opportunity` — a picker-invisible
// helper with no validator that ONLY creates, and answers `400 OPPORTUNITY_NO_DUPLICATE` at
// runtime for any contact that already has a card — recorded as a SKIPPED step, not a failed run,
// which is why the step saved, published and round-tripped clean and nothing caught it; one client
// build had 31 such steps retyped by hand (2026-09-06). Both halves are now runtime-proven by
// differential on the test sub-account (2026-09-07): the upsert updated one card in place, the
// helper refused on the same contact in the same minute. These tests pin the emitted shape against
// the harvested example so it cannot drift back.

const baseCtx = (over = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog(), ...over });
const spec = (attributes, type = 'create_opportunity') => ({
  triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'c', kind: 'action', type, name: 'Create', attributes }],
});
const stepOf = (built) => built.autoSaveBody.workflowData.templates.find((t) => t.type === 'create_opportunity');
const build = (attributes) => stepOf(compile(spec(attributes), baseCtx()));
const throwsWith = (attributes, code) => assert.throws(() => compile(spec(attributes), baseCtx()), (e) => e.code === code, code);

test('the author-facing step emits the builder-native UPSERT type, not the create-only helper', () => {
  const t = build({ pipelineId: 'P', stageId: 'S' });
  assert.ok(t, 'a create_opportunity template was emitted');
  assert.equal(t.type, 'create_opportunity');
  assert.equal(t.attributes.type, 'create_opportunity');
  assert.equal(t.attributes.__customInputFields__, undefined, 'the internal helper shape must not leak into the upsert');
});

test('the emitted attribute keys are exactly the harvested example\'s, snake_case', () => {
  // The captured builder step (catalog/step-examples/create_opportunity.json) is one real save.
  // Every key it carries must be a key we emit, or a round trip rewrites the operator's step.
  const example = JSON.parse(readFileSync(new URL('../catalog/step-examples/create_opportunity.json', import.meta.url), 'utf8'));
  const emitted = new Set(Object.keys(build({ pipelineId: 'P', stageId: 'S' }).attributes));
  for (const k of Object.keys(example.attributes)) {
    assert.ok(emitted.has(k), `the harvested example carries '${k}' and the engine does not emit it`);
  }
});

test('the four always-written keys are present even when unset, as the builder writes them', () => {
  // trimInputs() writes opportunity_name / opportunity_source / monetary_value on every save, and
  // the corpus records them at 100% frequency — usually empty. Omitting them is a shape drift.
  const a = build({ pipelineId: 'P' }).attributes;
  assert.equal(a.pipeline_id, 'P');
  assert.equal(a.pipeline_stage_id, '');
  assert.equal(a.opportunity_name, '');
  assert.equal(a.opportunity_source, '');
  assert.equal(a.monetary_value, '');
  assert.equal(a.opportunity_status, 'open', 'the builder defaults Status to open');
  assert.deepEqual(a.fields, []);
});

test('camelCase author keys map to the snake_case wire keys', () => {
  const a = build({ pipelineId: 'P', stageId: 'S', name: 'Deal', source: 'FB', status: 'won', value: 180 }).attributes;
  assert.equal(a.pipeline_id, 'P');
  assert.equal(a.pipeline_stage_id, 'S');
  assert.equal(a.opportunity_name, 'Deal');
  assert.equal(a.opportunity_source, 'FB');
  assert.equal(a.opportunity_status, 'won');
  assert.equal(a.monetary_value, '180', 'monetary_value is a STRING on this action, parsed at execution');
});

test('the two upsert switches are emitted only when authored, and never both', () => {
  assert.equal(build({ pipelineId: 'P' }).attributes.allow_backward, undefined);
  assert.equal(build({ pipelineId: 'P' }).attributes.allow_multiple, undefined);
  assert.equal(build({ pipelineId: 'P', allowBackward: true }).attributes.allow_backward, true);
  assert.equal(build({ pipelineId: 'P', allowMultiple: true }).attributes.allow_multiple, true);
  // The drawer's own handlers clear one when the other is switched on — they are contradictory
  // intents, not a preference: one acts on the existing card, the other refuses to.
  throwsWith({ pipelineId: 'P', allowBackward: true, allowMultiple: true }, 'OPP_BACKWARD_AND_MULTIPLE');
});

test('a step with no pipeline is refused by the rule GHL\'s own validator states', () => {
  throwsWith({ stageId: 'S', name: 'x' }, 'OPP_NO_PIPELINE');
});

test('a stage-less step is allowed but warned — it can only update, never create', () => {
  const warnings = [];
  const built = compile(spec({ pipelineId: 'P', status: 'won' }), baseCtx({ warn: (w) => warnings.push(w) }));
  assert.ok(stepOf(built), 'the step still compiles');
  assert.ok(warnings.some((w) => /OPP_NO_STAGE/.test(w)), `expected an OPP_NO_STAGE warning, got ${JSON.stringify(warnings)}`);
});

test('the GHL-side spellings are refused by name, with the author key offered', () => {
  assert.throws(() => compile(spec({ pipeline_id: 'P', pipeline_stage_id: 'S' }), baseCtx()),
    (e) => e.code === 'UNKNOWN_ATTR' && /'pipelineId' \(not 'pipeline_id'\)/.test(e.message));
  assert.throws(() => compile(spec({ pipelineId: 'P', monetaryValue: 5 }), baseCtx()),
    (e) => e.code === 'UNKNOWN_ATTR' && /'value' \(not 'monetaryValue'\)/.test(e.message));
});

test('status is checked against GHL\'s Status enum', () => {
  throwsWith({ pipelineId: 'P', status: 'closed' }, 'OPP_BAD_STATUS');
  for (const status of ['open', 'won', 'lost', 'abandoned']) {
    const attrs = { pipelineId: 'P', status, ...(status === 'lost' ? { lostReasonId: 'LR' } : {}) };
    assert.equal(build(attrs).attributes.opportunity_status, status);
  }
  // A merge field cannot be checked at compile time and must not be refused.
  assert.equal(build({ pipelineId: 'P', status: '{{contact.status}}' }).attributes.opportunity_status, '{{contact.status}}');
});

test('lostReasonId without a lost status fails closed, as it does on every other opportunity rail', () => {
  throwsWith({ pipelineId: 'P', lostReasonId: 'LR' }, 'OPP_LOST_REASON_NO_LOST_STATUS');
  throwsWith({ pipelineId: 'P', status: 'won', lostReasonId: 'LR' }, 'OPP_LOST_REASON_NO_LOST_STATUS');
  assert.equal(build({ pipelineId: 'P', status: 'lost', lostReasonId: 'LR' }).attributes.lostReasonId, 'LR');
});

test('the strict-only forecast keys are refused here and name the type that takes them', () => {
  assert.throws(() => compile(spec({ pipelineId: 'P', forecastProbability: 50 }), baseCtx()),
    (e) => e.code === 'OPP_STRICT_ONLY_ATTR' && /create_opportunity_strict/.test(e.message));
});

test('the create-only helper is still reachable, by asking for it by name', () => {
  const built = compile(spec({ pipelineId: 'P', stageId: 'S' }, 'create_opportunity_strict'), baseCtx());
  const t = built.autoSaveBody.workflowData.templates.find((x) => x.type === 'internal_create_opportunity');
  assert.ok(t, 'create_opportunity_strict emits internal_create_opportunity');
  assert.ok(Array.isArray(t.attributes.__customInputFields__));
  assert.equal(built.autoSaveBody.workflowData.templates.some((x) => x.type === 'create_opportunity'), false);
});

test('the wire name normalizes to the STRICT lean name, never to the upsert', () => {
  // Collapsing internal_create_opportunity onto create_opportunity is what made the upsert
  // unreachable in the first place. Two GHL actions, two lean names.
  const norm = parseIR({
    triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'c', kind: 'action', type: 'internal_create_opportunity', name: 'C', attributes: { pipelineId: 'P' } }],
  });
  const nodes = norm.graph ?? norm.nodes ?? norm;
  assert.equal(nodes[0].type, 'create_opportunity_strict');
});

test('an unpublished pipeline NAME is still refused before it can reach the wire', () => {
  // Names resolve only on the build path; a name written verbatim moves nothing (F5-09).
  throwsWith({ pipeline: 'Sales' }, 'UNRESOLVED_NAME');
});
