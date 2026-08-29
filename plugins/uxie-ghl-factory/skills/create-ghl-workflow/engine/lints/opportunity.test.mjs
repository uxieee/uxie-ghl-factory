// The round-trip verifier compares sent-vs-stored key sets, so a stage NAME stored verbatim, an
// empty row list, or a ghost id "verifies clean" — eight client workflows shipped with a live
// status row and a dead stage move. This lint is the missing question: does the STORED body
// express a real opportunity write?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintOpportunityWrites } from './opportunity.mjs';

const step = (attrs) => [{ id: 's1', type: 'internal_update_opportunity', name: 'Move', attributes: attrs }];
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

test('non-opportunity steps and create steps are covered too; nothing throws on garbage', () => {
  assert.deepEqual(lintOpportunityWrites([{ id: 'x', type: 'sms', attributes: { body: 'hi' } }]), []);
  assert.deepEqual(codes(lintOpportunityWrites([{ id: 'c', type: 'internal_create_opportunity', name: 'New', attributes: { pipelineId: 'p', __customInputFields__: [] } }])), ['OPP_NO_ROWS']);
  assert.deepEqual(lintOpportunityWrites([null, {}, { id: 'y', type: 'internal_update_opportunity' }]).map((f) => f.code), ['OPP_NO_ROWS']);
});
