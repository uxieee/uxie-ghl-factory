// w6d-1 (plan Task 1): the render comparison, pure. A UI-built control and an engine-built step are compared on the stored document
// and on the rendered drawer's values. Volatile keys (ids, positions, order, timestamps) are not differences. Graph pointers (next,
// parentKey, parent, parentContainerId) compare by SHAPE: null vs present, list length, and what the pointer names (a successor, the
// predecessor in the same chain, or the container). The drawer wins: a drawer that renders differently is a failure even when the stored
// documents match (Review Focus 1). A missing value, null and '' are all empty (Review Focus 2). RED first; QA FAIL items 3 and 4 added here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRender } from './render-compare.mjs';

const step = (over = {}) => ({ id: 'a', type: 'update_contact_field', name: 'Set', nodeType: 'Action', position: { x: 10, y: 20 }, order: 0,
  attributes: { field: 'cf_1', value: 'x' }, ...over });
const drawer = (over = {}) => ({ 'Field': 'Favourite colour', 'Value': 'x', ...over });

test('identical stored + identical drawer → same', () => {
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'same');
  assert.deepEqual(r.storedDiff, []);
  assert.deepEqual(r.drawerDiff, []);
});

test('identical stored, drawer value box missing → drawer-differs (the render check catches it, not the eye)', () => {
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: drawer(), uiDrawer: drawer({ 'Value': '' }) });
  assert.equal(r.verdict, 'drawer-differs');
  assert.equal(r.drawerDiff.length, 1);
  assert.equal(r.drawerDiff[0].key, 'Value');
});

test('a drawer key present on one side only is a drawer difference', () => {
  const ui = drawer(); delete ui.Value;
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: drawer(), uiDrawer: ui });
  assert.equal(r.verdict, 'drawer-differs');
});

test('id, position and order differences are not differences', () => {
  const r = compareRender({ engineStep: step(), uiStep: step({ id: 'zzz', position: { x: 500, y: 9 }, order: 7, createdAt: '2026-11-07' }),
    engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'same', JSON.stringify(r));
  assert.deepEqual(r.storedDiff, []);
});

test('a real stored difference with the same drawer → stored-only', () => {
  const r = compareRender({ engineStep: step(), uiStep: step({ attributes: { field: 'cf_2', value: 'x' } }), engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'stored-only');
  assert.equal(r.storedDiff[0].path, 'attributes.field');
});

test('drawer-differs outranks stored-only (a drawer that renders differently is a failure)', () => {
  const r = compareRender({ engineStep: step(), uiStep: step({ attributes: { field: 'cf_2', value: 'x' } }), engineDrawer: drawer(), uiDrawer: drawer({ 'Value': '' }) });
  assert.equal(r.verdict, 'drawer-differs');
  assert.equal(r.storedDiff.length, 1);
});

// ---- QA FAIL item 4: missing, null and '' are the same empty value (both directions, and both-empty) ----
test('a drawer key missing on one side and empty ("") on the other → same', () => {
  const e = drawer(); delete e.Value;
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: e, uiDrawer: drawer({ 'Value': '' }) });
  assert.equal(r.verdict, 'same', JSON.stringify(r.drawerDiff));
});

test('a drawer key missing on one side and null on the other → same', () => {
  const e = drawer(); delete e.Value;
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: e, uiDrawer: drawer({ 'Value': null }) });
  assert.equal(r.verdict, 'same', JSON.stringify(r.drawerDiff));
});

test('both sides empty ("" and null) → same', () => {
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: drawer({ 'Value': '' }), uiDrawer: drawer({ 'Value': null }) });
  assert.equal(r.verdict, 'same', JSON.stringify(r.drawerDiff));
});

test('empty against a value is still a difference (the empty rule does not swallow real values)', () => {
  const r = compareRender({ engineStep: step(), uiStep: step(), engineDrawer: drawer({ 'Value': '' }), uiDrawer: drawer({ 'Value': 'x' }) });
  assert.equal(r.verdict, 'drawer-differs');
});

// ---- QA FAIL item 3 / orchestrator ruling: wiring is in scope. Pointers compare by shape, not by raw id. ----
// Two stored documents: the engine's and the UI's. Same chain, different ids. A loop with a two-step body and a continuation.
const chain = (p, containerParentKey = null) => [
  { id: `${p}-loop`, type: 'loop', attributes: { loopOver: 'list', items: '{{contact.tags}}' }, next: `${p}-b1`, parentKey: null },
  { id: `${p}-b1`, type: 'add_contact_tag', parentContainerId: `${p}-loop`, next: `${p}-b2`, attributes: { tags: ['a'] } },
  { id: `${p}-b2`, type: 'add_contact_tag', parentContainerId: `${p}-loop`, next: `${p}-c`, attributes: { tags: ['b'] } },
  { id: `${p}-c`, type: 'add_contact_tag', parentKey: containerParentKey ?? `${p}-b2`, next: null, attributes: { tags: ['c'] } },
];

test('same loop chain with different ids → same (ids are volatile, the wiring shape agrees)', () => {
  const e = chain('e'), u = chain('u');
  const r = compareRender({ engineStep: e[3], uiStep: u[3], engineTemplates: e, uiTemplates: u, engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'same', JSON.stringify(r.storedDiff));
});

test('w6c-11b-style wrong continuation: the UI parents the step to the loop, the engine to the last body step → stored-only on parentKey', () => {
  const e = chain('e');
  const u = chain('u', 'u-loop'); // the continuation's parentKey points at the container (the refused shape)
  const r = compareRender({ engineStep: e[3], uiStep: u[3], engineTemplates: e, uiTemplates: u, engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'stored-only', JSON.stringify(r));
  assert.equal(r.storedDiff.length, 1);
  assert.equal(r.storedDiff[0].path, 'parentKey');
  assert.equal(r.storedDiff[0].engine, 'predecessor');
  assert.equal(r.storedDiff[0].ui, 'container');
});

test('a continuation with no parentKey at all (null) against a predecessor → stored-only on parentKey', () => {
  const e = chain('e');
  const u = chain('u'); delete u[3].parentKey;
  const r = compareRender({ engineStep: e[3], uiStep: u[3], engineTemplates: e, uiTemplates: u, engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'stored-only');
  assert.equal(r.storedDiff[0].path, 'parentKey');
});

test('next: null on the engine side against a successor on the UI side → stored-only on next', () => {
  const e = chain('e'), u = chain('u');
  u[3].next = 'u-loop'; // the UI step points somewhere; a null-vs-present difference
  const r = compareRender({ engineStep: e[3], uiStep: u[3], engineTemplates: e, uiTemplates: u, engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'stored-only');
  assert.equal(r.storedDiff[0].path, 'next');
});

test('a router root with 2 lanes against 3 lanes → stored-only on next (the branch count)', () => {
  const eng = { id: 'e-root', type: 'router', nodeType: 'condition-node', next: ['e-l1', 'e-l2'], attributes: { routerName: 'R' } };
  const ui = { id: 'u-root', type: 'router', nodeType: 'condition-node', next: ['u-l1', 'u-l2', 'u-l3'], attributes: { routerName: 'R' } };
  const r = compareRender({ engineStep: eng, uiStep: ui, engineTemplates: [eng], uiTemplates: [ui], engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'stored-only');
  assert.equal(r.storedDiff[0].path, 'next');
  assert.equal(r.storedDiff[0].engine, 'list:2');
  assert.equal(r.storedDiff[0].ui, 'list:3');
});

test('pointer shape without templates still sees null vs present (no silent pass)', () => {
  const r = compareRender({ engineStep: step({ next: null }), uiStep: step({ next: 'u-x' }), engineDrawer: drawer(), uiDrawer: drawer() });
  assert.equal(r.verdict, 'stored-only');
  assert.equal(r.storedDiff[0].path, 'next');
});
