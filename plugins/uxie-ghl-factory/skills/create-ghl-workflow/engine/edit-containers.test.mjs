// w6c-3 (plan Task 3, QA fail #1 and #2): the RED tests the plan names, plus the QA probes on the loop and router ops. Controls
// are marked CONTROL and pass today; the rest are RED until the GREEN fixes land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { insertAfter, appendToBranch, deleteStep, deleteBranch, addBranch } from './edit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = (f) => join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures', f);
const catalog = loadCatalog();
const ctx = (seed = 'a') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const tag = (ref, tags = ['x']) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${ref}`, attributes: { tags } });
const listLoop = (ref, body) => ({ ref, kind: 'loop', name: 'Loop', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential', body });
const build = (graph) => compile({ name: 'L', triggers: trig, graph }, ctx()).autoSaveBody.workflowData.templates;
const byName = (ts, name) => ts.find((t) => t.name === name);
const newTag = (id) => ({ id, type: 'add_contact_tag', name: 'New', attributes: { tags: ['n'] }, order: 0 });
const stored = (f) => JSON.parse(readFileSync(FIX(f), 'utf8')).templates;

// ── insert after the last body step (plan: "insert after last body step keeps continuation") ──────────────────────────
test('insert after the last body step: the new step continues to exitNext and the continuation follows the new tail (w6c-11b)', () => {
  const t = build([listLoop('l', [tag('b1'), tag('b2')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const b2 = byName(t, 'Tag b2');
  const after = byName(t, 'Tag after');
  const { templates } = insertAfter(t, newTag('n1'), b2.id);
  assert.equal(templates.find((s) => s.id === 'n1').next, after.id, 'the new step continues to exitNext');
  assert.equal(templates.find((s) => s.id === 'n1').parentContainerId, loop.id, 'and stays in the body');
  assert.equal(templates.find((s) => s.id === after.id).parentKey, 'n1', 'the continuation is parented to the new tail, the step whose next points at it (GHL check; w6c-11b)');
  assert.equal(templates.find((s) => s.id === loop.id).attributes.exitNext, after.id, 'exitNext is unchanged');
});

// ── insert after the LOOP with a body (QA #1): the body tail must follow the new continuation ─────────────────────────
test('insert after a loop with a two-step body re-points the last body step to the new continuation', () => {
  const t = build([listLoop('l', [tag('b1'), tag('b2')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const b2 = byName(t, 'Tag b2');
  const after = byName(t, 'Tag after');
  const { templates } = insertAfter(t, newTag('n1'), loop.id);
  assert.equal(templates.find((s) => s.id === b2.id).next, 'n1', 'the last body step now runs to the new continuation (Review Focus 2)');
  assert.equal(templates.find((s) => s.id === b1.id).next, b2.id, 'the rest of the body is unchanged');
  assert.equal(templates.find((s) => s.id === 'n1').next, after.id, 'the new continuation continues to the old one');
  assert.equal(templates.find((s) => s.id === loop.id).attributes.exitNext, 'n1');
  assert.equal(templates.find((s) => s.id === loop.id).next, b1.id, 'the body entry is unchanged');
});

// ── control: remove the last body step re-points the previous step to exitNext (plan item; the behaviour already works) ──
test('CONTROL remove last body step re-points to exitNext', () => {
  const t = build([listLoop('l', [tag('b1'), tag('b2')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const b2 = byName(t, 'Tag b2');
  const after = byName(t, 'Tag after');
  const { templates } = deleteStep(t, b2.id);
  assert.equal(templates.find((s) => s.id === b1.id).next, after.id, 'the previous body step now exits to the continuation');
  assert.equal(templates.find((s) => s.id === loop.id).attributes.exitNext, after.id);
});

// ── remove a loop removes its body (plan: removeLoopAndBodyFromTemplates); the removed set is what the dry run lists ─────
test('remove loop removes body, dry run lists it', () => {
  const t = build([listLoop('l', [tag('b1'), tag('b2')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const b2 = byName(t, 'Tag b2');
  const after = byName(t, 'Tag after');
  const { templates, diff } = deleteStep(t, loop.id);
  assert.ok(diff.deletedSteps.includes(loop.id), 'the loop is deleted');
  assert.ok(diff.deletedSteps.includes(b1.id) && diff.deletedSteps.includes(b2.id), 'its body is deleted with it');
  assert.equal(templates.some((s) => s.id === b1.id || s.id === b2.id), false, 'no body step is left behind');
  assert.equal(templates.some((s) => s.parentContainerId === loop.id), false, 'nothing still points at the deleted loop');
  assert.ok(templates.some((s) => s.id === after.id), 'the continuation stays');
});

// ── insert into a router branch lands in that lane only (plan item) ──────────────────────────────────────────────────
test('insert into router branch 2 lands in lane 2 only', () => {
  const s = stored('router-with-nested-lane.json');
  const b1 = s.find((t) => t.name === 'Branch 1');
  const b2 = s.find((t) => t.name === 'Branch 2');
  const b3 = s.find((t) => t.name === 'Branch 3');
  const { templates } = appendToBranch(s, b2.id, newTag('n1'));
  assert.equal(templates.find((t) => t.id === b2.id).next, 'n1', 'lane 2 now runs to the new step');
  assert.equal(templates.find((t) => t.id === b1.id).next ?? null, null, 'lane 1 is unchanged');
  assert.equal(templates.find((t) => t.id === b3.id).next ?? null, null, 'lane 3 is unchanged');
  assert.equal(templates.find((t) => t.id === 'n1').parentKey, b2.id);
});

// ── add_branch keeps the fallback last (plan item) ───────────────────────────────────────────────────────────────────
test('add_branch before fallback keeps fallback last, and root.next follows branches[] order', () => {
  const s = stored('router-with-nested-lane.json');
  const router = s.find((t) => t.type === 'router' && t.name === 'Router');
  const fallback = s.find((t) => t.name === 'Fallback');
  const { templates } = addBranch(s, router.id, { name: 'Branch 4', conditions: [] }, makeSeededIdGen('ab'));
  const root = templates.find((t) => t.id === router.id);
  assert.equal(root.next[root.next.length - 1], fallback.id, 'the fallback lane is still last');
  assert.deepEqual(root.next, root.attributes.branches.map((b) => b.id), 'root.next follows branches[] order');
});

// ── remove_branch of the only custom branch is refused (plan item) ───────────────────────────────────────────────────
test('remove_branch of the only custom branch is refused', () => {
  const s = stored('router-with-nested-lane.json');
  const router = s.find((t) => t.type === 'router' && t.name === 'Router');
  const names = ['Branch 1', 'Branch 2'];
  let cur = s;
  for (const name of names) cur = deleteBranch(cur, router.id, name).templates;
  assert.throws(() => deleteBranch(cur, router.id, 'Branch 3'), /custom|only/i);
});

// ── branch targets learn {router, branch} (plan Task 3, branchTargets/resolveBranchTarget) ──────────────────────────────
test('resolveBranchTarget takes {router, branch} and resolves that lane; a wrong router is refused', async () => {
  const { resolveBranchTarget } = await import('./edit.mjs');
  const s = stored('router-with-nested-lane.json');
  const router = s.find((t) => t.type === 'router' && t.name === 'Router');
  const b2 = s.find((t) => t.name === 'Branch 2');
  assert.equal(resolveBranchTarget(router, s, { router: 'Router', branch: 'Branch 2' }, 'insertAfter').id, b2.id);
  assert.equal(resolveBranchTarget(router, s, { router: router.id, branch: 'Branch 2' }, 'insertAfter').id, b2.id, 'by router id too');
  assert.throws(() => resolveBranchTarget(router, s, { router: 'Elsewhere', branch: 'Branch 2' }, 'insertAfter'), /Elsewhere|router/i);
});

// ── insert a loop into a loop body is refused (plan item) ────────────────────────────────────────────────────────────
test('insert loop into loop body refused', () => {
  const t = build([listLoop('l', [tag('b1')])]);
  const b1 = byName(t, 'Tag b1');
  const nested = { id: 'm1', type: 'loop', name: 'Inner', order: 0, attributes: { type: 'loop', items: '{{contact.tags}}', loopOver: 'list', mode: 'sequential', limit: null } };
  assert.throws(() => insertAfter(t, nested, b1.id), /loop/i);
});
