// bl-369: an If/Else "Pipeline stage is not X" row was stored as "is X", which inverts the branch. GHL's builder
// offers exactly two operators on opportunities pipelineStageId — is (==) and is not (!=) — in
// Condition.ts opportinityOperatorOptions (recovered bundle 2026-09-29-2). The compiler forced '=='.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCondition } from './compiler.mjs';

const STAGE = 'stage-1';

test('a != stage row keeps != (it used to be rewritten to ==)', () => {
  const c = normalizeCondition({ conditionType: 'opportunities', stage: STAGE, conditionOperator: '!=' }, {});
  assert.equal(c.conditionOperator, '!=');
  assert.equal(c.conditionValue, STAGE);
});

test('not:true on a stage row is "is not" (!=), the same intent key tag rows take', () => {
  const c = normalizeCondition({ conditionType: 'opportunities', stage: STAGE, not: true }, {});
  assert.equal(c.conditionOperator, '!=');
  assert.equal('not' in c, false);
});

test('CONTROL: a plain stage row and an explicit == stay ==', () => {
  assert.equal(normalizeCondition({ conditionType: 'opportunities', stage: STAGE }, {}).conditionOperator, '==');
  assert.equal(normalizeCondition({ conditionType: 'opportunities', conditionSubType: 'pipelineStageId', conditionOperator: '==', conditionValue: STAGE }, {}).conditionOperator, '==');
});

test('an operator the builder does not offer on pipeline stage is refused, never stored as ==', () => {
  assert.throws(() => normalizeCondition({ conditionType: 'opportunities', stage: STAGE, conditionOperator: 'contains' }, {}),
    (e) => e.code === 'OPP_STAGE_OPERATOR' && /is \(==\) or is not \(!=\)/.test(e.message));
});

test('not:true together with == is contradictory and refused', () => {
  assert.throws(() => normalizeCondition({ conditionType: 'opportunities', stage: STAGE, not: true, conditionOperator: '==' }, {}),
    (e) => e.code === 'OPP_STAGE_OPERATOR');
});
