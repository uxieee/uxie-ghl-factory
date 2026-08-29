// RC-A: the account resolver ran on the BUILD path only. An edit op naming a pipeline, stage,
// user or calendar had no resolver behind it, so the name either reached the wire verbatim
// (F5-09) or was refused with no way to satisfy it. The same resolver now runs over the ops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opsNeedResolution, resolveOps } from './edit-driver.mjs';
import { buildResolvers } from './resolve.mjs';

const resolvers = buildResolvers({
  pipelines: [{ id: 'P1', name: 'Main', stages: [{ id: 'S1', name: 'New' }, { id: 'S2', name: 'Engaged' }] }],
  users: [{ id: 'U1', name: 'Sam Setter', email: 'sam@example.com' }],
  calendars: [], forms: [], customFields: [], agents: [],
});

test('opsNeedResolution is true only when an op carries an intent name', () => {
  assert.equal(opsNeedResolution([{ op: 'renameStep', stepId: 's1', name: 'x' }]), false);
  assert.equal(opsNeedResolution([{ op: 'insertAfter', afterId: 's1', step: { type: 'update_opportunity', attributes: { pipeline: 'Main', stage: 'Engaged' } } }]), true);
  assert.equal(opsNeedResolution([{ op: 'modifyStep', stepId: 's1', attrPatch: { stage: 'Engaged' } }]), true);
  assert.equal(opsNeedResolution([{ op: 'addTrigger', trigger: { type: 'pipeline_stage_updated', filters: [{ field: 'opportunity.pipelineStageId', value: 'Engaged' }] } }]), true);
});

test('resolveOps rewrites names to ids across step ops, modifyStep patches and trigger filters; unresolved names are reported', () => {
  const ops = [
    { op: 'insertAfter', afterId: 's1', step: { type: 'update_opportunity', name: 'Move', attributes: { pipeline: 'Main', stage: 'Engaged', status: 'open' } } },
    { op: 'modifyStep', stepId: 's2', attrPatch: { pipeline: 'Main', stage: 'New' } },
    { op: 'addTrigger', trigger: { type: 'pipeline_stage_updated', name: 'T', filters: [{ field: 'opportunity.pipelineStageId', value: 'Engaged' }] } },
    { op: 'appendStep', step: { type: 'assign_user', name: 'Assign', attributes: { user: 'sam@example.com' } } },
    { op: 'appendStep', step: { type: 'update_opportunity', name: 'Bad', attributes: { pipeline: 'Nope', stage: 'Engaged' } } },
  ];
  const stored = [{ id: 's2', type: 'internal_update_opportunity' }];
  const { ops: out, unresolved } = resolveOps(ops, resolvers, stored);
  assert.deepEqual({ pipelineId: out[0].step.attributes.pipelineId, stageId: out[0].step.attributes.stageId }, { pipelineId: 'P1', stageId: 'S2' });
  assert.deepEqual({ pipelineId: out[1].attrPatch.pipelineId, stageId: out[1].attrPatch.stageId }, { pipelineId: 'P1', stageId: 'S1' });
  assert.equal(out[2].trigger.filters[0].value, 'S2');
  assert.deepEqual(out[3].step.attributes.user_list, ['U1']);
  // A bad PIPELINE cascades to its stage: the stage lookup is scoped to the pipeline, so with no
  // pipeline there is nowhere to look. That is the build path's own behaviour (resolveIR), and
  // reporting both is honest — the root cause is named first.
  assert.deepEqual(unresolved.map((u) => u.name), ['Nope', 'Engaged']);
  assert.deepEqual(unresolved.map((u) => u.where), ['update_opportunity.pipeline', 'update_opportunity.stage']);
});

test('a resolvable pipeline with a ghost stage reports the STAGE alone', () => {
  const { unresolved } = resolveOps(
    [{ op: 'appendStep', step: { type: 'update_opportunity', name: 'S', attributes: { pipeline: 'Main', stage: 'Ghost' } } }],
    resolvers, []);
  assert.deepEqual(unresolved.map((u) => u.name), ['Ghost']);
});

// The plan's own version walked the graph array with one running index while pushing BOTH step
// nodes and modifyStep patch nodes into it, so a patch sitting between two steps shifted every
// later step onto the wrong node. Ordering is asserted directly.
test('a modifyStep patch between two step ops does not shift the later step onto the wrong node', () => {
  const ops = [
    { op: 'appendStep', step: { type: 'update_opportunity', name: 'First', attributes: { stage: 'New' } } },
    { op: 'modifyStep', stepId: 's2', attrPatch: { stage: 'Engaged' } },
    { op: 'appendStep', step: { type: 'update_opportunity', name: 'Third', attributes: { stage: 'New' } } },
  ];
  const { ops: out } = resolveOps(ops, resolvers, [{ id: 's2', type: 'internal_update_opportunity' }]);
  assert.equal(out[0].step.name, 'First');
  assert.equal(out[0].step.attributes.stageId, 'S1');
  assert.equal(out[1].attrPatch.stageId, 'S2');
  assert.equal(out[2].step.name, 'Third');
  assert.equal(out[2].step.attributes.stageId, 'S1');
});

test('synthetic refs never leak onto the ops', () => {
  const { ops: out } = resolveOps([{ op: 'appendStep', step: { type: 'update_opportunity', name: 'X', attributes: { stage: 'New' } } },
    { op: 'addTrigger', trigger: { type: 'pipeline_stage_updated', name: 'T', filters: [] } }], resolvers, []);
  assert.equal(out[0].step.ref, undefined);
  assert.equal(out[1].trigger.ref, undefined);
});
