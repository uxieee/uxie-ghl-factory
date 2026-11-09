// w6c-3 (bl-786's edit neighbour; plan row w6c-3): edit ops inside Router lanes and Loop bodies, and GHL's refusal of an empty
// Loop body (ruling 2026-11-07, DECISIONS.md "Empty Loop body: refuse offline on authoring"): build_workflow and edit_workflow
// refuse a result with an empty Loop body, code `loop-body-empty` with the Loop's path; a stored workflow that already holds one
// passes with a warning. RED first: these fail on the current engine, for the reasons named in each test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { liftWorkflow } from './lift.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { IRError } from './ir.mjs';
import { insertAfter, appendToBranch, deleteStep, editCommitBody } from './edit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = (f) => join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures', f);
const catalog = loadCatalog();
const ctx = (seed = 'a') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const tag = (ref, tags = ['x']) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${ref}`, attributes: { tags } });
const listLoop = (ref, body) => ({ ref, kind: 'loop', name: 'Loop', loopOver: 'list', items: '{{inboundWebhookRequest.items}}', mode: 'sequential', body });
const build = (graph) => compile({ name: 'L', triggers: trig, graph }, ctx()).autoSaveBody.workflowData.templates;
const byName = (ts, name) => ts.find((t) => t.name === name);
const fresh = (templates) => ({ _id: 'W', name: 'W', status: 'draft', workflowData: { templates } });
const newTag = (id) => ({ id, type: 'add_contact_tag', name: 'New', attributes: { tags: ['n'] }, order: 0 });

// 1. RED: insertAfter on a body step must keep the new step in the body. Today insertAfter sets only parent, not parentContainerId.
test('a step inserted after a body step carries parentContainerId = its loop', () => {
  const t = build([listLoop('l', [tag('b1'), tag('b2')])]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const { templates } = insertAfter(t, newTag('n1'), b1.id);
  const added = templates.find((s) => s.id === 'n1');
  assert.equal(added.parentContainerId, loop.id, 'the new step is inside the loop body, not after it');
});

// 2. RED: inserted after the last body step, the new step stays in the body and continues to exitNext; exitNext is unchanged.
test('a step inserted after the last body step stays in the body and continues to exitNext', () => {
  const t = build([listLoop('l', [tag('b1')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const after = byName(t, 'Tag after');
  const b1 = byName(t, 'Tag b1');
  const { templates } = insertAfter(t, newTag('n1'), b1.id);
  const added = templates.find((s) => s.id === 'n1');
  assert.equal(added.parentContainerId, loop.id);
  assert.equal(added.next, after.id, 'the new step continues to the continuation');
  assert.equal(templates.find((s) => s.id === loop.id).attributes.exitNext, after.id, 'exitNext is the continuation, unchanged');
});

// 3. RED: insertAfter on the loop step itself puts the step AFTER the loop (the continuation), not at the top of the body.
test('insertAfter on the loop step places the new step after the loop, not at the top of the body', () => {
  const t = build([listLoop('l', [tag('b1')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const after = byName(t, 'Tag after');
  const { templates } = insertAfter(t, newTag('n1'), loop.id);
  const L = templates.find((s) => s.id === loop.id);
  assert.equal(L.next, b1.id, 'the body entry is unchanged');
  assert.equal(L.attributes.exitNext, 'n1', 'the new step is the loop continuation');
  assert.equal(templates.find((s) => s.id === 'n1').next, after.id, 'and it continues to the old continuation');
  assert.equal(templates.find((s) => s.id === 'n1').parentContainerId, undefined, 'it is outside the body');
});

// 4. RED: deleting the only body step leaves an empty loop: the edit is refused with loop-body-empty and the Loop's path.
test('an edit that empties a loop body is refused loop-body-empty, naming the loop', () => {
  const t = build([listLoop('l', [tag('b1')])]);
  const b1 = byName(t, 'Tag b1');
  const { templates, diff } = deleteStep(t, b1.id);
  assert.throws(() => editCommitBody(fresh(t), templates, diff, 'U', {}), (e) => e instanceof IRError && e.code === 'loop-body-empty'
    && /Loop/.test(e.message) && e.path === 'Loop');
});

// 5. RED: a stored workflow that already holds an empty loop passes an unrelated edit, with a warning (not a refusal).
test('a stored empty loop passes an unrelated edit with a loop-body-empty warning', () => {
  const stored = JSON.parse(readFileSync(FIX('loop-list.json'), 'utf8')).templates;
  const warnings = [];
  assert.doesNotThrow(() => editCommitBody(fresh(stored), stored, { createdSteps: [], modifiedSteps: [], deletedSteps: [] }, 'U',
    { warn: (m) => warnings.push(m) }));
  assert.ok(warnings.some((m) => /loop-body-empty/.test(m)), 'the stored empty loop is reported');
});

// 6. CONTROL: a step appended to Branch 1 of the stored router-lane fixture (router-lane-steps.json, read back from GROM Sandbox)
// runs after the lane's existing Add Tag. Router-lane children carry parent and parentKey and no parentContainerId (as stored).
test('lane edit: a step appended to Branch 1 of the stored router lane runs after its existing step', () => {
  const stored = JSON.parse(readFileSync(FIX('router-lane-steps.json'), 'utf8')).templates;
  const b1 = stored.find((t) => t.name === 'Branch 1');
  const old = stored.find((t) => t.id === b1.next);
  const { templates } = appendToBranch(stored, b1.id, newTag('n1'));
  const added = templates.find((s) => s.id === 'n1');
  assert.equal(added.parentKey, old.id, 'the new step hangs off the lane\'s last step');
  assert.equal(templates.find((s) => s.id === old.id).next, 'n1', 'the lane runs on to the new step');
  assert.equal(added.parentContainerId, undefined, 'no parentContainerId on a router-lane child, as stored');
});

// 6b. CONTROL: insertAfter and deleteStep inside the stored router lane keep the lane's chain and its scope.
test('lane edit: insertAfter then deleteStep inside Branch 1 keep the lane chain (router-lane fixture)', () => {
  const stored = JSON.parse(readFileSync(FIX('router-lane-steps.json'), 'utf8')).templates;
  const b1 = stored.find((t) => t.name === 'Branch 1');
  const old = stored.find((t) => t.id === b1.next);
  const b = insertAfter(stored, newTag('n2'), old.id).templates;
  assert.equal(b.find((s) => s.id === 'n2').parentKey, old.id, 'the second step hangs off the first');
  assert.equal(b.find((s) => s.id === 'n2').parent, old.parent, 'and keeps the lane scope');
  const d = deleteStep(b, 'n2').templates;
  assert.equal(d.find((s) => s.id === old.id).next ?? null, null, 'deleting it returns the lane to its stored end');
});

// 6c. The router-lane fixture round-trips through lift and compile: the lane children compile back exactly as stored.
test('router-lane fixture: lift then compile reproduces the lane children as stored (no parentContainerId)', () => {
  const stored = JSON.parse(readFileSync(FIX('router-lane-steps.json'), 'utf8')).templates;
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  const again = compile(structuredClone(lifted.ir), { ...ctx('r'), pinIds: true, pins: lifted.ir.stored.pins }).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored.filter((t) => t.parentKey)) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
});

// 7. RED (build path): checkEmptyLoopBodies refuses an authored empty loop, naming the router lane it sits in.
test('build: an authored empty loop inside a router lane is refused, with its path', async () => {
  const mod = await import('./loop-authoring.mjs');
  assert.equal(typeof mod.checkEmptyLoopBodies, 'function', 'the build-side check is exported');
  const router = { ref: 'r', kind: 'router', name: 'Router', branches: [{ ref: 'a', name: 'Branch 1', branchType: 'always_run', then: [listLoop('l', [])] }] };
  assert.throws(() => mod.checkEmptyLoopBodies([router]), (e) => e.code === 'loop-body-empty' && e.path === 'Router > Branch 1 > Loop');
});

// 8. (build path, QA #3 and the 2026-11-07 clarification) build_workflow refuses an empty loop whatever the spec's origin: a spec
// exported from a stored workflow (its loop's ref is a stored id) is a NEW build and is refused, not warned.
test('build: an empty loop from an exported (stored) spec is still refused, with its path', async () => {
  const mod = await import('./loop-authoring.mjs');
  const exported = { graph: [listLoop('l', [])], stored: { order: ['l'] } };
  assert.throws(() => mod.checkEmptyLoopBodies(exported.graph), (e) => e.code === 'loop-body-empty' && e.path === 'Loop');
});
