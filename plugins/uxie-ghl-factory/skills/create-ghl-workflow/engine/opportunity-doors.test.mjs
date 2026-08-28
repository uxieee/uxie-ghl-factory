// The same opportunity intent through EVERY door must produce identical id-bearing rows, or an
// identical loud refusal. July's fix (267d971) covered the lean type on the build path only; the
// WIRE type name walked around it, and on 2026-08-28 a stage NAME reached the wire as a dead
// top-level key in eight client workflows while the build reported clean (F5-09 / T1-1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { applyOps } from './edit-driver.mjs';
import { editCommitBody } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('o'), catalog: loadCatalog() });
const oppTrigger = { ref: 't', type: 'opportunity_created', name: 'Opp created', filters: [] };
const build = (node) => compile(
  { name: 'X', triggers: [oppTrigger], graph: [{ ref: 'n', kind: 'action', name: 'Move', ...node }] },
  ctx(),
).autoSaveBody.workflowData.templates.find((s) => s.type === 'internal_update_opportunity');
const rowsOf = (tpl) => tpl.attributes.__customInputFields__.map((r) => [r.filterField, r.value]).sort();
const PIPE = 'x2f9dK1mQ84hL0pTzVbn';
const STAGE = 'y3g0eL2nR95iM1qUaWco';
const ids = { pipelineId: PIPE, stageId: STAGE, status: 'won', allowBackward: true };

test('door 1 + 2: the lean type and the WIRE type compile to the same id-bearing rows', () => {
  const lean = build({ type: 'update_opportunity', attributes: ids });
  const wire = build({ type: 'internal_update_opportunity', attributes: ids });
  assert.deepEqual(rowsOf(wire), rowsOf(lean));
  assert.ok(rowsOf(lean).some(([f, v]) => f === 'pipelineStageId' && v === STAGE));
  assert.ok(rowsOf(lean).some(([f, v]) => f === 'status' && v === 'won'));
  assert.equal(wire.attributes.stage, undefined, 'no name key may survive on the wire');
});

test('door 3: names without ids are refused loudly on BOTH spellings, never written verbatim', () => {
  for (const type of ['update_opportunity', 'internal_update_opportunity']) {
    assert.throws(
      () => build({ type, attributes: { pipeline: 'Main', stage: 'Engaged', status: 'open' } }),
      (e) => e.code === 'UNRESOLVED_NAME' && /stage 'Engaged'|pipeline 'Main'/.test(e.message),
      type,
    );
  }
});

const chain = () => [
  { id: 's1', type: 'add_contact_tag', name: 'A', next: null, order: 0, attributes: { tags: ['a'] } },
];

test('door 4: an edit-op insert of the WIRE type compiles the same rows; names are refused', () => {
  const { templates } = applyOps(chain(), [{
    op: 'insertAfter',
    afterId: 's1',
    step: { type: 'internal_update_opportunity', name: 'Move', attributes: ids, assocGuaranteed: true },
  }], { ctx: ctx(), idGen: makeSeededIdGen('e') });
  const tpl = templates.find((t) => t.type === 'internal_update_opportunity');
  assert.ok(rowsOf(tpl).some(([f, v]) => f === 'pipelineStageId' && v === STAGE));

  assert.throws(() => applyOps(chain(), [{
    op: 'insertAfter',
    afterId: 's1',
    step: { type: 'update_opportunity', name: 'Move', attributes: { pipeline: 'Main', stage: 'Engaged' }, assocGuaranteed: true },
  }], { ctx: ctx(), idGen: makeSeededIdGen('e') }), (e) => e.code === 'UNRESOLVED_NAME');
});

test('door 5: a modifyStep that patches a NAME onto an opportunity step is refused at commit', () => {
  const stored = [{
    id: 's1', type: 'internal_update_opportunity', name: 'Move', next: null, order: 0,
    attributes: { allowBackward: false, type: 'internal_update_opportunity', __customInputs__: {}, __customInputFields__: [] },
  }];
  const { templates, diff } = applyOps(stored, [{ op: 'modifyStep', stepId: 's1', attrPatch: { stage: 'Engaged', status: 'won' } }],
    { ctx: ctx(), idGen: makeSeededIdGen('m') });
  const fresh = { status: 'draft', version: 1, workflowData: { templates: stored } };
  assert.throws(() => editCommitBody(fresh, templates, diff, 'uid', { assumeAssociated: true }),
    (e) => e.code === 'UNRESOLVED_NAME' && /stage/.test(e.message));
});
