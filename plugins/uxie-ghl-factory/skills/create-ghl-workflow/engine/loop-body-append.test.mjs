// w6c-3 (orchestrator decisions 2026-11-07 on the w6c-3 resubmit, and QA's deleteContainer probe). RED first.
// {loop: idOrName} = into that Loop's body: the new step goes at the body's END, stamped parentContainerId = the loop; the last body
// step's next becomes the new step, and the new step runs on to exitNext. deleteContainer on a Loop removes only the Loop and its
// body; the loop's predecessor takes its exitNext chain (Loop[b1] -> after -> after2 leaves after -> after2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { appendToBranch, deleteContainer, resolveBranchTarget } from './edit.mjs';

const catalog = loadCatalog();
const ctx = (seed = 'a') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const tag = (ref, tags = ['x']) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${ref}`, attributes: { tags } });
const listLoop = (ref, body) => ({ ref, kind: 'loop', name: 'Loop', loopOver: 'list', items: '{{contact.tags}}', mode: 'sequential', body });
const build = (graph) => compile({ name: 'L', triggers: trig, graph }, ctx()).autoSaveBody.workflowData.templates;
const byName = (ts, name) => ts.find((t) => t.name === name);
const newTag = (id) => ({ id, type: 'add_contact_tag', name: 'New', attributes: { tags: ['n'] }, order: 0 });

test('deleteContainer on a loop removes only the loop and its body; the continuation survives and takes the loop\'s place', () => {
  const t = build([listLoop('l', [tag('b1')]), tag('after'), tag('after2')]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const after = byName(t, 'Tag after');
  const after2 = byName(t, 'Tag after2');
  const { templates, diff } = deleteContainer(t, loop.id);
  assert.ok(diff.deletedSteps.includes(loop.id) && diff.deletedSteps.includes(b1.id), 'the loop and its body are deleted');
  assert.equal(diff.deletedSteps.includes(after.id) || diff.deletedSteps.includes(after2.id), false, 'the continuation is not');
  assert.equal(templates.find((s) => s.id === after.id).next, after2.id, 'after still runs to after2');
  assert.equal(templates[0].id, after.id, 'the continuation is now the workflow head');
});

test('appendToBranch into a loop with a body appends at the body\'s end, stamped parentContainerId, and runs on to exitNext', () => {
  const t = build([listLoop('l', [tag('b1')]), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const b1 = byName(t, 'Tag b1');
  const after = byName(t, 'Tag after');
  const { templates } = appendToBranch(t, loop.id, newTag('n1'));
  const added = templates.find((s) => s.id === 'n1');
  assert.equal(templates.find((s) => s.id === b1.id).next, 'n1', 'the old last body step now runs to the new step');
  assert.equal(added.parentKey, b1.id, 'the new step hangs off the previous body step');
  assert.equal(added.parentContainerId, loop.id, 'stamped with its loop');
  assert.equal(added.next, after.id, 'and runs on to exitNext');
  assert.equal(templates.find((s) => s.id === loop.id).attributes.exitNext, after.id, 'exitNext is unchanged');
  assert.equal(templates.find((s) => s.id === loop.id).next, b1.id, 'the body entry is unchanged');
});

test('appendToBranch into an EMPTY loop body makes the new step the body entry, parentKey = the loop', () => {
  const t = build([listLoop('l', []), tag('after')]);
  const loop = t.find((s) => s.type === 'loop');
  const after = byName(t, 'Tag after');
  const { templates } = appendToBranch(t, loop.id, newTag('n1'));
  const added = templates.find((s) => s.id === 'n1');
  assert.equal(templates.find((s) => s.id === loop.id).next, 'n1', 'the loop enters its body at the new step');
  assert.equal(added.parentKey, loop.id);
  assert.equal(added.parentContainerId, loop.id);
  assert.equal(added.next, after.id);
});

test('resolveBranchTarget takes {loop} for a loop entry and returns its body target', () => {
  const t = build([listLoop('l', [tag('b1')])]);
  const loop = t.find((s) => s.type === 'loop');
  const target = resolveBranchTarget(loop, t, { loop: 'Loop' }, 'insertAfter');
  assert.equal(target.id, loop.id, 'the target is the loop body (the loop)');
  assert.equal(target.nodeType, 'loop-body');
  assert.throws(() => resolveBranchTarget(loop, t, { loop: 'Elsewhere' }, 'insertAfter'), /Elsewhere|loop/i);
});
