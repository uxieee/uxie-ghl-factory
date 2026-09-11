// GHL's router branch model, ported (router-branches.mjs). Each case is a behaviour of GHL's own
// RouterBranch / Segment / router-branch-conditions-equality.ts, including the quirks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasIncompleteConditions, branchViolation, incompleteBranchViolation,
  canonicalRouterBranchConditions, firstDuplicateRouterBranchPair, duplicatePairViolation,
} from './router-branches.mjs';

const cond = (over = {}) => ({ conditionType: 'contact_detail', conditionSubType: 'first_name', conditionOperator: 'is', conditionValue: 'Ann', ...over });
const seg = (conditions, operator = 'and') => ({ operator, conditions });
const branch = (id, segments, over = {}) => ({ id, name: id, branchType: 'custom', operator: 'and', segments, ...over });

test('an unfinished branch: no segment, or a condition missing a part', () => {
  assert.equal(hasIncompleteConditions(branch('a', [])), true);
  assert.equal(hasIncompleteConditions(branch('a', [seg([cond()])])), false);
  assert.equal(hasIncompleteConditions(branch('a', [seg([cond({ conditionOperator: '' })])])), true);
  assert.equal(hasIncompleteConditions(branch('a', [seg([cond({ conditionValue: '' })])])), true);
  assert.equal(hasIncompleteConditions(branch('a', [seg([cond({ conditionOperator: 'has_value', conditionValue: undefined })])])), false);
  assert.equal(hasIncompleteConditions(branch('a', [seg([cond({ conditionValueOperator: 'inTheLast', conditionValue: 3 })])])), true, 'relative date needs a unit');
});

test('GHL quirk kept: a segment holding NO conditions counts as complete (every over [] is true)', () => {
  assert.equal(hasIncompleteConditions(branch('a', [seg([])])), false);
});

test('always-run and fallback branches evaluate nothing, so they are never unfinished', () => {
  assert.equal(hasIncompleteConditions(branch('a', [], { branchType: 'always_run' })), false);
  assert.equal(hasIncompleteConditions(branch('a', [], { branchType: 'fallback' })), false);
});

test('the branch name is judged before its conditions', () => {
  assert.equal(branchViolation(branch('a', [], { name: '  ' })), 'Branch name cannot be empty!');
  assert.equal(branchViolation(branch('a', [seg([cond()])], { name: 'x'.repeat(101) })), 'Branch name should be less than 100 characters');
  assert.equal(branchViolation(branch('a', [seg([cond()])], { name: 'x'.repeat(100) })), undefined);
  assert.equal(branchViolation(branch('a', [])), 'Add at least one complete condition to every branch');
});

test('incompleteBranchViolation reports the first branch that needs work, as "{name}: {message}"', () => {
  assert.equal(incompleteBranchViolation([branch('Done', [seg([cond()])]), branch('Half', [])]),
    'Half: Add at least one complete condition to every branch');
  assert.equal(incompleteBranchViolation([branch('Done', [seg([cond()])])]), undefined);
});

test('two branches on the same condition are a duplicate pair, reported against the later one', () => {
  const pair = firstDuplicateRouterBranchPair([branch('First', [seg([cond()])]), branch('Second', [seg([cond()])])]);
  assert.equal(pair.branch.id, 'Second');
  assert.equal(pair.original.id, 'First');
  assert.equal(duplicatePairViolation([branch('First', [seg([cond()])]), branch('Second', [seg([cond()])])]),
    'Second has the same conditions as First. Change one of them so the router knows which path to take.');
});

test('equality ignores what changes no execution: order, grouping, multi-select order, number vs text', () => {
  const A = cond(), B = cond({ conditionSubType: 'last_name', conditionValue: 'Lee' });
  const same = (x, y) => canonicalRouterBranchConditions(x) === canonicalRouterBranchConditions(y);
  assert.ok(same(branch('x', [seg([A, B])]), branch('y', [seg([B, A])])), 'condition order');
  assert.ok(same(branch('x', [seg([A, B])]), branch('y', [seg([A]), seg([B])])), 'A AND B in one segment vs across two');
  assert.ok(same(branch('x', [seg([cond({ conditionValue: ['a', 'b'] })])]), branch('y', [seg([cond({ conditionValue: ['b', 'a'] })])])), 'multi-select');
  assert.ok(same(branch('x', [seg([cond({ conditionValue: 15 })])]), branch('y', [seg([cond({ conditionValue: '15' })])])), '15 and "15"');
});

test('equality keeps what DOES change an execution: (A AND B) OR C is not A OR B OR C', () => {
  const A = cond(), B = cond({ conditionSubType: 'last_name' }), C = cond({ conditionSubType: 'email' });
  const x = branch('x', [seg([A, B], 'and'), seg([C])], { operator: 'or' });
  const y = branch('y', [seg([A, B, C], 'or')], { operator: 'or' });
  assert.notEqual(canonicalRouterBranchConditions(x), canonicalRouterBranchConditions(y));
});

test('a value its operator never reads is dead weight and does not count', () => {
  const a = branch('x', [seg([cond({ conditionOperator: 'has_no_value', conditionValue: 'left over' })])]);
  const b = branch('y', [seg([cond({ conditionOperator: 'has_no_value', conditionValue: undefined })])]);
  assert.equal(canonicalRouterBranchConditions(a), canonicalRouterBranchConditions(b));
  const t1 = branch('x', [seg([cond({ conditionValueOperator: 'today', conditionValue: 5, conditionValueUnit: 'days' })])]);
  const t2 = branch('y', [seg([cond({ conditionValueOperator: 'today' })])]);
  assert.equal(canonicalRouterBranchConditions(t1), canonicalRouterBranchConditions(t2));
});

test('never a duplicate: unfinished branches, conditionless branches, a branch routing on nothing', () => {
  assert.equal(firstDuplicateRouterBranchPair([branch('a', []), branch('b', [])]), undefined);
  assert.equal(firstDuplicateRouterBranchPair([branch('a', [], { branchType: 'always_run' }), branch('b', [], { branchType: 'always_run' })]), undefined);
  assert.equal(firstDuplicateRouterBranchPair([branch('a', [seg([])]), branch('b', [seg([])])]), undefined);
});

test('names are not compared: renaming a path never changes what it equals', () => {
  assert.ok(firstDuplicateRouterBranchPair([branch('a', [seg([cond()])], { name: 'VIP' }), branch('b', [seg([cond()])], { name: 'Other' })]));
});
