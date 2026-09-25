// W2-5: opportunity_status_changed without a status row saves as a draft, then GHL refuses the PUBLISH
// ("Opportunity Status is required", MISSING_REQUIRED_TRIGGER_FIELDS, live 2026-09-25). Refuse at compile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog() });
const ir = (filters) => ({ name: 'W', triggers: [{ ref: 't', type: 'opportunity_status_changed', name: 'Status', filters }],
  graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] });

test('no status row → TRIGGER_REQUIRED_FILTER (a pipeline row alone is not enough)', () => {
  assert.throws(() => compile(ir([{ field: 'opportunity.pipelineId', value: 'P' }]), ctx()),
    (e) => e.code === 'TRIGGER_REQUIRED_FILTER' && /Opportunity Status is required/.test(e.message));
  assert.throws(() => compile(ir([]), ctx()), (e) => e.code === 'TRIGGER_REQUIRED_FILTER');
});

test('a Moved-to or a Moved-from status row satisfies it (control)', () => {
  for (const f of [{ field: 'opportunity.status', value: 'won' }, { field: 'opportunity.oldStatus', value: 'open' }]) {
    const { triggerBodies } = compile(ir([{ field: 'opportunity.pipelineId', value: 'P' }, f]), ctx());
    assert.ok(JSON.stringify(triggerBodies).includes(f.field));
  }
});

test('other opportunity triggers are not affected', () => {
  const x = ir([]); x.triggers[0].type = 'opportunity_created';
  compile(x, ctx());
});
