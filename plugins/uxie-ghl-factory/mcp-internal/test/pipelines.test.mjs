import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPipelineEdit, verifyPipeline } from '../core/pipelines.mjs';

// The GET row shape, trimmed to what matters (sandbox capture 2026-09-28).
const row = () => ({
  id: 'P', name: 'Sales', locationId: 'LOC', position: 'a4C0TZl', dateAdded: 'x', dateUpdated: 'y',
  showInFunnel: false, showInPieChart: false, useOpportunityProbability: false, colorRenderMode: 'dot',
  stages: [
    { id: 's1', name: 'New', position: 0, showInFunnel: true, showInPieChart: false, stageWinProbability: 10, color: '#155EEF' },
    { id: 's2', name: 'Qualified', position: 1, showInFunnel: true, showInPieChart: true, stageWinProbability: 40, color: '#039855' },
    { id: 's3', name: 'Closing', position: 3, showInFunnel: false, showInPieChart: false, stageWinProbability: 90 },
  ],
});

test('the body strips the five refused top-level keys and keeps every stage id and a 0-based position', () => {
  const plan = planPipelineEdit(row(), { name: 'Sales 2' });
  assert.equal(plan.errors, undefined);
  for (const k of ['id', 'position', 'dateAdded', 'dateUpdated', 'locationId']) assert.equal(k in plan.body, false, k);
  assert.deepEqual(plan.body.stages.map((s) => [s.id, s.position]), [['s1', 0], ['s2', 1], ['s3', 2]]);
  assert.equal(plan.body.colorRenderMode, 'dot');
  assert.deepEqual(plan.diff.pipeline, [{ field: 'name', before: 'Sales', after: 'Sales 2' }]);
});

test('CONTROL: an empty edit sends the pipeline back unchanged and reports no change', () => {
  const plan = planPipelineEdit(row(), {});
  assert.deepEqual(plan.diff, { pipeline: [], stagesChanged: [], stagesAdded: [], stagesRemoved: [] });
  assert.equal(plan.body.stages.length, 3);
});

test('a new stage without a probability is refused — one missing probability rewrites them all', () => {
  const plan = planPipelineEdit(row(), { addStages: [{ name: 'Won-ish' }] });
  assert.match(plan.errors.join(' '), /stageWinProbability/);
  const okPlan = planPipelineEdit(row(), { addStages: [{ name: 'Won-ish', stageWinProbability: 95, afterStageId: 's2' }] });
  assert.deepEqual(okPlan.body.stages.map((s) => s.name), ['New', 'Qualified', 'Won-ish', 'Closing']);
  assert.equal(okPlan.body.stages[2].id, undefined);
});

test('an existing stage with no stored probability is refused unless the edit supplies one', () => {
  const r = row(); delete r.stages[2].stageWinProbability;
  assert.match(planPipelineEdit(r, {}).errors.join(' '), /Closing.*stageWinProbability/);
  assert.equal(planPipelineEdit(r, { updateStages: [{ id: 's3', stageWinProbability: 80 }] }).errors, undefined);
});

test('removing a stage lists it; moveCardsTo must name a KEPT stage', () => {
  const plan = planPipelineEdit(row(), { removeStages: [{ id: 's3', moveCardsTo: 's1' }] });
  assert.deepEqual(plan.removed, [{ id: 's3', name: 'Closing', moveCardsTo: 's1' }]);
  assert.deepEqual(plan.diff.stagesRemoved, [{ id: 's3', name: 'Closing' }]);
  assert.match(planPipelineEdit(row(), { removeStages: [{ id: 's3', moveCardsTo: 's3' }] }).errors.join(' '), /moveCardsTo/);
  assert.match(planPipelineEdit(row(), { removeStages: [{ id: 'nope' }] }).errors.join(' '), /no stage nope/);
});

test('the last stage cannot be removed, and duplicate names are refused case-insensitively', () => {
  assert.match(planPipelineEdit(row(), { removeStages: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }).errors.join(' '), /at least one stage/);
  assert.match(planPipelineEdit(row(), { updateStages: [{ id: 's2', name: 'new' }] }).errors.join(' '), /named "new"/);
});

test('stageOrder must list every kept stage exactly once', () => {
  const plan = planPipelineEdit(row(), { stageOrder: ['s3', 's1', 's2'] });
  assert.deepEqual(plan.body.stages.map((s) => [s.id, s.position]), [['s3', 0], ['s1', 1], ['s2', 2]]);
  assert.match(planPipelineEdit(row(), { stageOrder: ['s3', 's1'] }).errors.join(' '), /stageOrder/);
});

test('colorRenderMode and stage colour are validated', () => {
  assert.match(planPipelineEdit(row(), { colorRenderMode: 'rainbow' }).errors.join(' '), /colorRenderMode/);
  assert.match(planPipelineEdit(row(), { updateStages: [{ id: 's1', color: 'blue' }] }).errors.join(' '), /#RRGGBB/);
  assert.equal(planPipelineEdit(row(), { colorRenderMode: 'bg-tint', updateStages: [{ id: 's1', color: '#000000' }] }).errors, undefined);
});

test('verifyPipeline passes an exact read-back and names every mismatch', () => {
  const plan = planPipelineEdit(row(), { name: 'Sales 2', addStages: [{ name: 'Extra', stageWinProbability: 50 }] });
  const back = { ...row(), name: 'Sales 2', stages: [...plan.body.stages.slice(0, 3), { ...plan.body.stages[3], id: 'new1' }] };
  assert.deepEqual(verifyPipeline(plan.body, back), []);
  const wrong = { ...back, stages: back.stages.map((s) => ({ ...s, stageWinProbability: 25 })) };
  assert.ok(verifyPipeline(plan.body, wrong).some((m) => /stageWinProbability/.test(m)));
  assert.deepEqual(verifyPipeline(plan.body, null), ['the pipeline is missing from the list after the write']);
});
