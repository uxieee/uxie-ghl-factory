import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookTriggerUrl, findWebhookRefs, checkWebhookRefs, planWebhookPin, webhookUrlsFor, WEBHOOK_HOOKS_BASE } from './webhook-rail.mjs';

const SAMPLE = { lead: { email: 'sample@example.com', firstName: 'Sam' }, dealRefId: 'CANARY-1', items: [{ sku: 'A' }, { sku: 'B' }] };

test('the receiving URL is the live-proven shape (hooks host, loc, trigger id)', () => {
  assert.equal(webhookTriggerUrl('LOC1', 'trg1'), `${WEBHOOK_HOOKS_BASE}/LOC1/webhook-trigger/trg1`);
  assert.equal(WEBHOOK_HOOKS_BASE, 'https://services.leadconnectorhq.com/hooks');
});

test('findWebhookRefs walks every string attribute, nested, and reports the step', () => {
  const T = [
    { id: 'a', name: 'Note', attributes: { html: '<p>{{inboundWebhookRequest.dealRefId}} {{ inboundWebhookRequest.lead.email }}</p>', nested: { arr: ['{{inboundWebhookRequest}}'] } } },
    { id: 'b', name: 'Tag', attributes: { tags: ['x'] } },
  ];
  assert.deepEqual(findWebhookRefs(T), [
    { step: 'Note', path: 'dealRefId' }, { step: 'Note', path: 'lead.email' }, { step: 'Note', path: '' },
  ]);
});

test('checkWebhookRefs: known leaves and object/array prefixes pass; unknown paths warn with the literal consequence and a near-miss hint; hatch skips', () => {
  const warns = [];
  const T = [{ id: 'a', name: 'Note', attributes: { html: '{{inboundWebhookRequest.lead.email}} {{inboundWebhookRequest.items}} {{inboundWebhookRequest.items.0.sku}} {{inboundWebhookRequest.lead.emial}} {{inboundWebhookRequest.ghost}}' } }];
  const f = checkWebhookRefs(T, SAMPLE, { warn: (m) => warns.push(m) });
  assert.deepEqual(f.map((x) => x.path), ['lead.emial', 'ghost']);
  assert.match(warns[0], /renders EMPTY/);
  assert.match(warns[0], /did you mean lead.email/);
  assert.deepEqual(checkWebhookRefs(T, SAMPLE, { skipWebhookCheck: true }), []);
  assert.deepEqual(checkWebhookRefs(T, undefined, {}), [], 'no sample → nothing to lint');
});

test('planWebhookPin reproduces the four live-proven calls, unauth POST included', () => {
  const p = planWebhookPin({ loc: 'LOC1', triggerId: 'trg1', samplePayload: SAMPLE });
  assert.deepEqual(p.post, { method: 'POST', url: `${WEBHOOK_HOOKS_BASE}/LOC1/webhook-trigger/trg1`, body: SAMPLE, auth: 'none' });
  assert.equal(p.list.path, '/hooks/inbound-webhook-request/trigger/trg1?limit=10&locationId=LOC1');
  assert.deepEqual(p.pin('req9'), { method: 'PUT', path: '/hooks/inbound-webhook-request/set-as-reference/req9?locationId=LOC1', body: { locationId: 'LOC1' } });
  assert.equal(p.reference.path, '/hooks/inbound-webhook-request/reference/trg1?locationId=LOC1');
});

test('webhookUrlsFor only reports inbound_webhook triggers that have a (server-assigned) id', () => {
  assert.deepEqual(webhookUrlsFor('L', [
    { type: 'inbound_webhook', name: 'Hook', id: 'srv1' }, { type: 'contact_tag', name: 'T', id: 'srv2' }, { type: 'inbound_webhook', name: 'NoId' },
  ]), [{ name: 'Hook', triggerId: 'srv1', url: `${WEBHOOK_HOOKS_BASE}/L/webhook-trigger/srv1` }]);
});
