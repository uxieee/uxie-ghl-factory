// GHL's router (`type: 'router'`, new in the 2026-09-11 builder) and the save rules it carries.
// The ancestry helpers are VERBATIM ports of utils/router.ts — branch ownership, lane stamps and
// nesting depth decide which steps count as "inside a branch", and a hand-rolled approximation
// would quietly disagree with the builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRouterRoot, isRouterLane, collectRouterBranchOwners, isInsideRouterBranch, getRouterNestingDepth } from './router-graph.mjs';
import { evaluateWorkflowRules } from './graph-rules.mjs';

const VOCAB = { vocab: { router: { maxBranches: 10, maxNesting: 10, disallowedBranchSteps: ['workflow_goal', 'goto'], laneNodeTypes: ['branch-yes', 'branch-no'], branchTypes: ['custom', 'always_run', 'fallback'] } } };
const router = (id, branches, over = {}) => ({ id, name: id, type: 'router', attributes: { branches }, ...over });
// A custom branch carries one COMPLETE condition, distinct per branch: GHL refuses an unfinished
// branch and two branches on the same conditions, so a fixture without them tests those rules instead.
const branch = (id, branchType = 'custom', segments = branchType === 'custom'
  ? [{ operator: 'and', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'first_name', conditionOperator: 'is', conditionValue: id }] }] : []) =>
  ({ id, name: `b-${id}`, branchType, operator: 'and', segments });
const step = (id, type, over = {}) => ({ id, name: id, type, attributes: {}, ...over });

test('a router root is told from its lanes by the lane stamp', () => {
  assert.equal(isRouterRoot({ type: 'router' }), true, 'an UNSTAMPED router is still a root');
  assert.equal(isRouterRoot({ type: 'router', nodeType: 'branch-yes' }), false);
  assert.equal(isRouterLane({ type: 'router', nodeType: 'branch-no' }), true);
  assert.equal(isRouterLane({ type: 'sms' }), false);
});

test('branch ids map to the router that owns them, read from attributes.branches', () => {
  const t = [router('r1', [branch('b1'), branch('b2')]), step('s1', 'sms')];
  const owners = collectRouterBranchOwners(t);
  assert.equal(owners.get('b1'), 'r1');
  assert.equal(owners.get('b2'), 'r1');
  assert.equal(owners.has('s1'), false);
});

test('a step is inside a branch through parentKey, at any depth', () => {
  const t = [router('r1', [branch('b1')]), step('s1', 'sms', { parentKey: 'b1' }), step('s2', 'sms', { parentKey: 's1' }), step('out', 'sms')];
  assert.equal(isInsideRouterBranch('b1', t), true, 'the branch itself is an insertion point inside it');
  assert.equal(isInsideRouterBranch('s1', t), true);
  assert.equal(isInsideRouterBranch('s2', t), true, 'nested deeper still counts');
  assert.equal(isInsideRouterBranch('out', t), false);
});

test('nesting depth counts the routers above an insertion point', () => {
  const t = [router('r1', [branch('b1')]), router('r2', [branch('b2')], { parentKey: 'b1' }), step('s1', 'sms', { parentKey: 'b2' })];
  assert.equal(getRouterNestingDepth('b1', t), 1);
  assert.equal(getRouterNestingDepth('b2', t), 2);
});

test('validateRouterConditions: more branches than GHL allows', () => {
  const many = Array.from({ length: 11 }, (_, i) => branch(`b${i}`));
  const { findings } = evaluateWorkflowRules({ templates: [router('r1', many)] }, VOCAB);
  assert.equal(findings.filter((f) => f.rule === 'validateRouterConditions').length, 1);
  assert.match(findings[0].message, /11 branches|more than 10/);
});

test('validateRouterConditions: two fallbacks, and always-run beside a fallback', () => {
  const two = evaluateWorkflowRules({ templates: [router('r1', [branch('b1', 'fallback'), branch('b2', 'fallback')])] }, VOCAB).findings;
  assert.equal(two.filter((f) => f.rule === 'validateRouterConditions').length, 1);
  const mixed = evaluateWorkflowRules({ templates: [router('r2', [branch('b1', 'always_run'), branch('b2', 'fallback')])] }, VOCAB).findings;
  assert.equal(mixed.filter((f) => f.rule === 'validateRouterConditions').length, 1);
});

test('validateRouterConditions: a Go To or a Goal inside a branch', () => {
  const t = [router('r1', [branch('b1')]), step('g', 'goto', { parentKey: 'b1' }), step('goal', 'workflow_goal', { parentKey: 'b1' })];
  const findings = evaluateWorkflowRules({ templates: t }, VOCAB).findings.filter((f) => f.rule === 'validateRouterConditions');
  assert.equal(findings.length, 2, JSON.stringify(findings));
  assert.match(findings.map((f) => f.message).join(' '), /goto/);
});

test('validateRouterConditions: nesting deeper than GHL allows', () => {
  // eleven routers, each in the branch of the one above
  const t = [];
  for (let i = 0; i < 11; i++) t.push(router(`r${i}`, [branch(`b${i}`)], i ? { parentKey: `b${i - 1}` } : {}));
  const findings = evaluateWorkflowRules({ templates: t }, VOCAB).findings.filter((f) => f.rule === 'validateRouterConditions');
  assert.ok(findings.some((f) => /nest/i.test(f.message)), JSON.stringify(findings.map((f) => f.message)));
});

test('a legal router fires nothing', () => {
  const t = [router('r1', [branch('b1'), branch('b2', 'fallback')]), step('s1', 'sms', { parentKey: 'b1' })];
  assert.deepEqual(evaluateWorkflowRules({ templates: t }, VOCAB).findings.filter((f) => f.rule === 'validateRouterConditions'), []);
});

const routerFindings = (templates) => evaluateWorkflowRules({ templates }, VOCAB).findings.filter((f) => f.rule === 'validateRouterConditions');

test('validateRouterConditions: an unfinished branch is refused, named by its branch', () => {
  const half = { id: 'bh', name: 'Half', branchType: 'custom', operator: 'and', segments: [] };
  const findings = routerFindings([router('r1', [branch('b1'), half])]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /Half: Add at least one complete condition to every branch/);
});

test('validateRouterConditions: two branches on the same conditions are refused', () => {
  const twin = { ...branch('b1'), id: 'b2', name: 'b-twin' };
  const findings = routerFindings([router('r1', [branch('b1'), twin])]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /b-twin has the same conditions as b-b1/);
});

test('validateRouterConditions reports ONE violation per router, in GHL\'s order', () => {
  // eleven branches, one of them unfinished: capacity is what GHL reports, not the branch
  const many = [...Array.from({ length: 10 }, (_, i) => branch(`b${i}`)), { id: 'bh', name: 'Half', branchType: 'custom', segments: [] }];
  const findings = routerFindings([router('r1', many)]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /11 branches/);
});

test('no router check is left unjudged', () => {
  const { notEvaluable } = evaluateWorkflowRules({ templates: [router('r1', [branch('b1')])] }, VOCAB);
  assert.ok(!notEvaluable.some((n) => /validateRouterConditions/.test(n)), notEvaluable.join(' | '));
});
