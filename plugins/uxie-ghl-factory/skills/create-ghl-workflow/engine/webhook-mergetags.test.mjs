import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookMergeTags, mergeTag, contactFieldsFromWebhook } from './webhook-mergetags.mjs';

const sample = {
  dealRefId: 'RRXR-XYHK98', event: 'completed',
  signers: { originatingAgent: { name: 'Craig Flood', email: 'hello@craigflood.com' },
             receivingAgent: { email: 'xander@xanderroque.com' } },
  lead: { email: 'xanderjohnrazonroque+recurlead@gmail.com', firstName: 'Rita', lastName: 'RecurLead' },
  headers: { host: 'services.leadconnectorhq.com', 'x-signature': 'abc' },
};

test('flattens nested payload into inboundWebhookRequest merge tags', () => {
  const tags = webhookMergeTags(sample);
  assert.equal(tags['dealRefId'], '{{inboundWebhookRequest.dealRefId}}');
  assert.equal(tags['signers.originatingAgent.name'], '{{inboundWebhookRequest.signers.originatingAgent.name}}');
  assert.equal(tags['signers.receivingAgent.email'], '{{inboundWebhookRequest.signers.receivingAgent.email}}');
  assert.equal(tags['lead.email'], '{{inboundWebhookRequest.lead.email}}');
});

test('drops headers noise by default, keeps with includeHeaders', () => {
  assert.equal('headers.host' in webhookMergeTags(sample), false);
  assert.equal(webhookMergeTags(sample, { includeHeaders: true })['headers.host'], '{{inboundWebhookRequest.headers.host}}');
});

test('array elements use numeric index paths', () => {
  const tags = webhookMergeTags({ items: [{ sku: 'A' }, { sku: 'B' }] });
  assert.equal(tags['items.0.sku'], '{{inboundWebhookRequest.items.0.sku}}');
  assert.equal(tags['items.1.sku'], '{{inboundWebhookRequest.items.1.sku}}');
});

test('mergeTag builds a single path tag', () => {
  assert.equal(mergeTag('lead.email'), '{{inboundWebhookRequest.lead.email}}');
});

test('contactFieldsFromWebhook maps email/first/last from the payload', () => {
  const { fields } = contactFieldsFromWebhook(sample);
  assert.equal(fields.email, '{{inboundWebhookRequest.lead.email}}');   // first email-ending leaf → lead.email
  assert.equal(fields.firstName, '{{inboundWebhookRequest.lead.firstName}}');
  assert.equal(fields.lastName, '{{inboundWebhookRequest.lead.lastName}}');
});

test('contactFieldsFromWebhook respects overrides', () => {
  const { fields } = contactFieldsFromWebhook(sample, { email: '{{inboundWebhookRequest.signers.receivingAgent.email}}' });
  assert.equal(fields.email, '{{inboundWebhookRequest.signers.receivingAgent.email}}');
});
