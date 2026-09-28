// bl-253: a wait's jump target can be authored by REF — the compiler maps it to the minted id.
// Live 2026-09-28: without this, specific_step was unbuildable (REQUIRED_FIELD, no id to give).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('r'), catalog: loadCatalog() });
const tag = (ref, t) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${t}`, attributes: { tags: [t] } });
const ir = (target) => ({ name: 'W', triggers: [], graph: [
  { ref: 'w', kind: 'wait', name: 'Until date', waitType: 'specific_date', attributes: { type: 'specific_date', specificDate: '2026-09-27',
    specificTimeHour: 9, specificTimeMinute: 0, specificTimePeriod: 'AM', specificDatePassed: 'specific_step', specificDateStep: target } },
  tag('y', 'y'), tag('z', 'z')] });

test('specificDateStep authored as a ref compiles to the target step id', () => {
  const T = compile(ir('z'), ctx()).autoSaveBody.workflowData.templates;
  const w = T.find((t) => t.type === 'wait'), z = T.find((t) => t.attributes?.tags?.[0] === 'z');
  assert.equal(w.attributes.specificDateStep, z.id);
});

test('an unknown ref still refuses (checkStepRefs) — the mapping does not invent targets', () => {
  assert.throws(() => compile(ir('nope'), ctx()));
});
