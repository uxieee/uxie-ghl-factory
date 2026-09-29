import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintIfElseTagCase, mixedCaseIfElseTags } from './tag-case.mjs';
import { runLints } from './runner.mjs';

const cond = (conditionValue, extra = {}) => ({ conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue, ...extra });
const step = (branches) => ({ id: 's1', type: 'if_else', name: 'Check', attributes: { branches: branches.map(([name, c]) => ({ name, segments: [{ operator: 'and', conditions: [c] }] })) } });

test('IFELSE_TAG_CASE: a mixed-case tag condition is an error naming the fix, one per value', () => {
  const f = lintIfElseTagCase([step([['Yes', cond(['VIP', 'ok', 'Cold'])]])]);
  assert.deepEqual(f.map((x) => x.code), ['IFELSE_TAG_CASE', 'IFELSE_TAG_CASE']); assert.equal(f[0].severity, 'error'); assert.equal(f[0].stepId, 's1');
  assert.match(f[0].msg, /replaceTag.*oldTag: 'VIP'.*newTag: 'vip'/);
});
test('CONTROLS: lower case, a merge tag, other subTypes and non-if_else steps are clean', () => {
  assert.deepEqual(lintIfElseTagCase([step([['Yes', cond(['vip'])]])]), []);
  assert.deepEqual(lintIfElseTagCase([step([['Yes', cond(['{{Custom.Tag}}'])]])]), []);
  assert.deepEqual(lintIfElseTagCase([step([['Yes', cond(['Mixed'], { conditionSubType: 'someFieldId' })]])]), []);
  assert.deepEqual(lintIfElseTagCase([{ id: 'x', type: 'wait', attributes: { branches: [] } }, null]), []);
  assert.deepEqual(mixedCaseIfElseTags(undefined), []);
});
test('check_workflow (runLints) reports it', () => {
  const out = runLints({ templates: [step([['Yes', cond(['VIP'])]])], triggers: [] }, { packs: ['platform'] });
  assert.ok(out.platform.some((f) => f.rule === 'IFELSE_TAG_CASE' && f.stepId === 's1'));
});
