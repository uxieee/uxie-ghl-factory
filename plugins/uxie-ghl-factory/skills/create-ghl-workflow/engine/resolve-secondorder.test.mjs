import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResolvers, resolveIR } from './resolve.mjs';

const raw = {
  workflows: [{ id: 'wf-aaaaaaaaaaaaaaaaaaaa', name: 'Nurture 2026', status: 'published' }],
  customValues: [{ id: 'cv-aaaaaaaaaaaaaaaaaa', name: 'From Email', fieldKey: '{{ custom_values.from_email }}' }],
  triggerLinks: [{ id: 'lk-aaaaaaaaaaaaaaaaaa', name: '30 Mins with Tom', redirectTo: 'https://x' }],
  offers: [{ id: 'of-aaaaaaaaaaaaaaaaaa', name: 'T4-good (safe to delete)' }],
  membershipProducts: [{ id: 'mp-aaaaaaaaaaaaaaaaaa', name: 'Onboarding Course' }],
};
const r = buildResolvers(raw);

test('G1: add_to_workflow / remove_from_workflow resolve a workflow NAME to workflow_id', () => {
  const ir = { triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'add_to_workflow', name: 'A', attributes: { workflow: 'nurture 2026' } },
    { ref: 'b', kind: 'action', type: 'remove_from_workflow', name: 'B', attributes: { workflow: 'Nurture 2026' } },
  ] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(ir.graph[0].attributes.workflow_id, 'wf-aaaaaaaaaaaaaaaaaaaa');
  assert.equal(ir.graph[1].attributes.workflow_id, 'wf-aaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(unresolved, []);
  const bad = { triggers: [], graph: [{ ref: 'x', kind: 'action', type: 'add_to_workflow', name: 'X', attributes: { workflow: 'No Such Flow' } }] };
  assert.deepEqual(resolveIR(bad, r).unresolved, [{ where: 'add_to_workflow.workflow', name: 'No Such Flow' }]);
});

test('G3: update_custom_value resolves by name OR fieldKey tail; the intent key is consumed', () => {
  const ir = { triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'update_custom_value', name: 'A', attributes: { customValue: 'From Email', new_value: 'x@y.z' } },
    { ref: 'b', kind: 'action', type: 'update_custom_value', name: 'B', attributes: { custom_value: 'from_email', new_value: 'q' } },
  ] };
  resolveIR(ir, r);
  assert.equal(ir.graph[0].attributes.custom_value_id, 'cv-aaaaaaaaaaaaaaaaaa');
  assert.equal(ir.graph[0].attributes.customValue, undefined);
  assert.equal(ir.graph[0].attributes.name, 'From Email', 'display name backfilled');
  assert.equal(ir.graph[1].attributes.custom_value_id, 'cv-aaaaaaaaaaaaaaaaaa', 'fieldKey tail matches too');
});

test('G2: membership_grant_offer / revoke resolve an offer NAME to offer_id', () => {
  const ir = { triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'membership_grant_offer', name: 'A', attributes: { offer: 't4-good (safe to delete)' } },
    { ref: 'b', kind: 'action', type: 'membership_revoke_offer', name: 'B', attributes: { offer: 'Nope' } },
  ] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(ir.graph[0].attributes.offer_id, 'of-aaaaaaaaaaaaaaaaaa');
  assert.equal(ir.graph[0].attributes.offer, undefined);
  assert.deepEqual(unresolved, [{ where: 'membership_revoke_offer.offer', name: 'Nope' }]);
});

test('trigger filters: link.id / membership.product.id / offer.id resolve names (ids pass through untouched)', () => {
  const ir = { triggers: [
    { ref: 't1', type: 'trigger_link', name: 'T1', filters: [{ field: 'link.id', value: '30 Mins with Tom' }] },
    { ref: 't2', type: 'product_started', name: 'T2', filters: [{ field: 'membership.product.id', value: ['Onboarding Course', 'mp-bbbbbbbbbbbbbbbbbb'] }] },
    { ref: 't3', type: 'offer_access_granted', name: 'T3', filters: [{ field: 'offer.id', value: 'T4-good (safe to delete)' }] },
  ], graph: [] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(ir.triggers[0].filters[0].value, 'lk-aaaaaaaaaaaaaaaaaa');
  assert.deepEqual(ir.triggers[1].filters[0].value, ['mp-aaaaaaaaaaaaaaaaaa', 'mp-bbbbbbbbbbbbbbbbbb']);
  assert.equal(ir.triggers[2].filters[0].value, 'of-aaaaaaaaaaaaaaaaaa');
  assert.deepEqual(unresolved, []);
  const bad = { triggers: [{ ref: 'x', type: 'trigger_link', name: 'X', filters: [{ field: 'link.id', value: 'Ghost Link' }] }], graph: [] };
  assert.equal(resolveIR(bad, r).unresolved.length, 1, 'a name-looking value on an id field that stays unresolved is reported');
});

test('missing entity lists degrade to unresolved reports, never throws', () => {
  const empty = buildResolvers({});
  const ir = { triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_to_workflow', name: 'A', attributes: { workflow: 'Anything' } }] };
  const { unresolved } = resolveIR(ir, empty);
  assert.equal(unresolved.length, 1);
});

test('G4/G6/G9/G5: templates, products, phone titles, funnels, workflow.id filters resolve by name', () => {
  const r2 = buildResolvers({
    ...raw,
    emailTemplates: [{ id: 'eb-aaaaaaaaaaaaaaaaaa', name: '04 Showed Up' }],
    smsTemplates: [{ id: 'st-aaaaaaaaaaaaaaaaaa', name: 'Promo reply', type: 'sms' }],
    products: [{ id: 'pr-aaaaaaaaaaaaaaaaaa', name: 'Patient Growth System' }],
    coupons: [{ id: 'cp-aaaaaaaaaaaaaaaaaa', name: 'Launch', code: 'LAUNCH10' }],
    phoneNumbers: [{ number: '+61400000000', title: 'GROM Digital AU' }],
    funnels: [{ id: 'fn-aaaaaaaaaaaaaaaaaa', name: 'Main Funnel' }],
  });
  const ir = {
    settings: { senderAddress: { from_name: 'C', from_email: 'x@y.z', from_number: 'GROM Digital AU' } },
    triggers: [
      { ref: 't1', type: 'payment_received', name: 'T1', filters: [{ field: 'payment.global_product_ids', value: ['Patient Growth System'] }] },
      { ref: 't2', type: 'customer_reply', name: 'T2', filters: [{ field: 'workflow.id', value: 'Nurture 2026' }] },
      { ref: 't3', type: 'two_step_form_submission', name: 'T3', filters: [{ field: 'twoStepOrderForm.funnelId', value: 'Main Funnel' }] },
    ],
    graph: [
      { ref: 'a', kind: 'action', type: 'email', name: 'A', attributes: { template: '04 showed up', subject: 's' } },
      { ref: 'b', kind: 'action', type: 'sms', name: 'B', attributes: { template: 'Promo reply' } },
    ],
  };
  const { unresolved } = resolveIR(ir, r2);
  assert.deepEqual(unresolved, []);
  assert.equal(ir.settings.senderAddress.from_number, '+61400000000');
  assert.deepEqual(ir.triggers[0].filters[0].value, ['pr-aaaaaaaaaaaaaaaaaa']);
  assert.equal(ir.triggers[1].filters[0].value, 'wf-aaaaaaaaaaaaaaaaaaaa');
  assert.equal(ir.triggers[2].filters[0].value, 'fn-aaaaaaaaaaaaaaaaaa');
  assert.equal(ir.graph[0].attributes.template_id, 'eb-aaaaaaaaaaaaaaaaaa');
  assert.equal(ir.graph[0].attributes.templatesource, 'email-builder');
  assert.equal(ir.graph[0].attributes.template, undefined);
  assert.equal(ir.graph[1].attributes.template_id, 'st-aaaaaaaaaaaaaaaaaa');
  assert.equal(r2.couponId('launch10'), 'cp-aaaaaaaaaaaaaaaaaa');
  const irNum = { settings: { senderAddress: { from_number: '+15551234567' } }, triggers: [], graph: [] };
  resolveIR(irNum, r2);
  assert.equal(irNum.settings.senderAddress.from_number, '+15551234567', 'a real number passes through');
});
