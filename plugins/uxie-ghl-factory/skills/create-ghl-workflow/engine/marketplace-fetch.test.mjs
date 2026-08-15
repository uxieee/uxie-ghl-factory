import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMarketplace, orchestrate } from './orchestrate.mjs';

const okCall = (json) => async () => ({ ok: true, status: 200, json });

test('fetchMarketplace gathers assets and both module pages', async () => {
  const seen = [];
  const call = async (method, path) => {
    seen.push(path);
    if (path.includes('/workflows-marketplace/')) return { ok: true, status: 200, json: { actions: [], triggers: [] } };
    return { ok: true, status: 200, json: [] };
  };
  const out = await fetchMarketplace(call, 'LOC');
  assert.ok(seen.some((p) => p.includes('/workflows-marketplace/location/LOC/assets')));
  assert.ok(seen.some((p) => p.includes('type=triggers') && p.includes('isInstalled=true')));
  assert.ok(seen.some((p) => p.includes('type=actions') && p.includes('isInstalled=true')));
  assert.ok(out.assets);
});

test('a failing source degrades instead of throwing', async () => {
  const call = async () => { throw new Error('network down'); };
  const out = await fetchMarketplace(call, 'LOC');
  assert.equal(out.assets, null);
  assert.deepEqual(out.modules, { actions: [], triggers: [] });
});

test('a non-ok response degrades the same way', async () => {
  const call = async () => ({ ok: false, status: 500, json: null });
  const out = await fetchMarketplace(call, 'LOC');
  assert.equal(out.assets, null);
});

// The whole reason for departing from the brief's string-scan detection
// (`JSON.stringify(ir.graph).includes('"marketplace":true')`): that scan would
// false-positive on any attribute STRING VALUE that happens to contain the literal
// text `"marketplace":true` — a pasted JSON body in a custom_webhook step, or (as
// here) a tag name authored with that exact substring — even though no node in the
// graph is actually flagged `marketplace: true`. A native build must never pay for
// a live marketplace fetch it doesn't need. `orchestrate` uses `walkNodes` instead,
// which inspects each node's real `marketplace` property rather than its serialized
// text, so this must NOT be detected as a marketplace build.
test('a native build whose attributes merely CONTAIN the text "marketplace":true is not detected as using marketplace', async () => {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: [] } };
    if (method === 'GET' && path.includes('/calendars/')) return { ok: true, json: { calendars: [] } };
    if (method === 'GET' && path.includes('/users/')) return { ok: true, json: { users: [] } };
    if (method === 'GET' && path.includes('/forms/')) return { ok: true, json: { forms: [] } };
    if (method === 'GET' && path.includes('/customFields')) return { ok: true, json: { customFields: [] } };
    if (method === 'GET' && (path.includes('/voice-ai/') || path.includes('/ai-employees/'))) return { ok: false, json: {} };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, json: { tags: [] } };
    if (method === 'POST' && path.match(/\/tags$/)) return { ok: true, json: { id: 'TAG_' + body.name } };
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'PUT' && path.includes('/auto-save')) return { ok: true, json: {} };
    if (method === 'POST' && path.includes('/trigger')) return { ok: true, json: { id: 'TRIG_1' } };
    if (method === 'GET' && path.includes('/workflow/')) return { ok: true, json: { workflowData: { templates: [
      { id: 'WID_1', type: 'add_contact_tag', attributes: { tags: ['new-tag', '{"marketplace":true}'] } },
    ] } } };
    return { ok: true, json: {} };
  };
  const gw = { call, loc: 'LOC', uid: 'UID' };
  // No node here sets `marketplace: true` — the suspicious text lives only inside an
  // ordinary string-typed attribute value.
  const ir = {
    name: 'W',
    triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: 'new-tag' }] }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag',
      attributes: { tags: ['new-tag', '{"marketplace":true}'] } }],
  };
  const report = await orchestrate(ir, gw);
  assert.equal(report.aborted, null);
  // `/marketplace/core/search/module` is unique to fetchMarketplace's install-truth reads —
  // it must never fire on this build.
  assert.ok(!calls.some(({ path }) => path.includes('/marketplace/core/search/module')),
    'a native build must not fetch marketplace install truth');
  // `/workflows-marketplace/…/assets` is ALSO the (pre-existing, unconditional) action-schema
  // fetch at step 5b — so its mere presence isn't proof of a marketplace-index fetch. What
  // proves fetchMarketplace did not ALSO hit it is the call count: exactly one, from
  // fetchActionSchema alone.
  assert.equal(calls.filter(({ path }) => path.includes('/workflows-marketplace/')).length, 1,
    'only the pre-existing action-schema fetch should hit this endpoint, not a second marketplace-index fetch');
});
