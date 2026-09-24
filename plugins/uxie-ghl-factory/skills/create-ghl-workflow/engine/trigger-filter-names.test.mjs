// Trigger filters whose field NAME does not end in ".id" still carry entity ids. The build path
// never reported one that failed to resolve, and the edit path never ran the resolver for them,
// so a funnel, page, product or document-template NAME reached the wire as a literal word.
// documentCreatedByTemplateId was proven live 2026-09-23: the builder's Template dropdown offers
// exactly the /proposals/templates ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResolvers, resolveIR, isIdBearingFilter } from './resolve.mjs';
import { opsNeedResolution, resolveOps } from './edit-driver.mjs';

const TPL = '6ab4a9c2458c0967fd5ed29f';
const r = buildResolvers({ documentTemplates: [{ id: TPL, name: 'Referral Agreement' }], funnels: [{ id: 'FUNNEL0000000000001', name: 'Webinar' }] });
const trigger = (field, value) => ({ type: 'proposal_estimate_update', name: 'T', filters: [{ field, value }] });

test('a document-template NAME on the Documents & Contracts trigger resolves to the template id', () => {
  const ir = { name: 'W', triggers: [trigger('documentCreatedByTemplateId', 'Referral Agreement')], graph: [] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(ir.triggers[0].filters[0].value, TPL);
  assert.deepEqual(unresolved, []);
});

test('a template name that matches nothing is REPORTED, not stored as the word', () => {
  const ir = { name: 'W', triggers: [trigger('documentCreatedByTemplateId', 'No Such Template')], graph: [] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0].where, /documentCreatedByTemplateId/);
});

test('every named-id field is id-bearing; a plain value field is not', () => {
  for (const f of ['documentCreatedByTemplateId', 'twoStepOrderForm.funnelId', 'video.funnelId', 'facebook.pageId', 'payment.global_product_ids', 'calendar.id'])
    assert.equal(isIdBearingFilter(f), true, f);
  assert.equal(isIdBearingFilter('status'), false);
});

test('an EDIT adding such a trigger now runs the resolver, and the name becomes the id', () => {
  const ops = [{ op: 'addTrigger', trigger: trigger('documentCreatedByTemplateId', 'Referral Agreement') }];
  assert.equal(opsNeedResolution(ops), true, 'before the fix this was false, so the word reached the wire');
  const res = resolveOps(ops, r, []);
  assert.equal((res.ops ?? ops)[0].trigger.filters[0].value, TPL);
  assert.equal(opsNeedResolution([{ op: 'addTrigger', trigger: trigger('video.funnelId', 'Webinar') }]), true);
});

test('a name with NO SPACES is looked up as a name, not taken for an id (the live failure, 2026-09-23)', () => {
  const rr = buildResolvers({ documentTemplates: [{ id: TPL, name: 'TEST-CONF-doc-template-trigger-option' }] });
  const ir = { name: 'W', triggers: [trigger('documentCreatedByTemplateId', 'TEST-CONF-doc-template-trigger-option')], graph: [] };
  resolveIR(ir, rr);
  assert.equal(ir.triggers[0].filters[0].value, TPL);
  const idIr = { name: 'W', triggers: [trigger('documentCreatedByTemplateId', TPL)], graph: [] };
  resolveIR(idIr, rr);
  assert.equal(idIr.triggers[0].filters[0].value, TPL, 'an id passes through unchanged');
  assert.equal(opsNeedResolution([{ op: 'addTrigger', trigger: trigger('documentCreatedByTemplateId', 'TEST-CONF-doc-template-trigger-option') }]), true);
  assert.equal(opsNeedResolution([{ op: 'addTrigger', trigger: trigger('documentCreatedByTemplateId', TPL) }]), false, 'a real id costs no entity fetch');
});
