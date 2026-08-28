import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMarketplace, orchestrate } from './orchestrate.mjs';

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
// (`JSON.stringify(ir.graph).includes('"marketplace":true')`): that scan is meant to catch a
// node whose attributes happen to CONTAIN the literal text `"marketplace":true` without the
// node itself being flagged `marketplace: true`.
//
// A STRING-valued decoy does NOT trip it: JSON.stringify escapes inner quotes, so a tag/body
// string literally containing `{"marketplace":true}` serializes as `{\"marketplace\":true}` —
// no unescaped `"marketplace":true` substring ever appears, so the naive scan would already
// (accidentally) ignore it. Do not "simplify" this decoy back to a string — that would silently
// remove the guarantee this test exists to prove.
//
// The REAL false-positive vector is a nested plain OBJECT attribute value, which serializes
// UNESCAPED: `{attributes:{headers:{marketplace:true}}}` stringifies to literal
// `…"headers":{"marketplace":true}…`, which DOES contain the substring — even though no node
// has `marketplace: true`. A `custom_webhook` step forwarding a header/body field named
// "marketplace" is an entirely plausible real authoring shape. `walkNodes` correctly ignores
// this: it visits nodes and their child SCOPES (branches/paths/onEvent/…), never descending
// into `attributes`, so it never sees this nested key at all.
test('a native build whose attributes nest an object CONTAINING "marketplace":true is not detected as using marketplace', async () => {
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
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'PUT' && path.includes('/auto-save')) return { ok: true, json: {} };
    if (method === 'POST' && path.includes('/trigger')) return { ok: true, json: { id: 'TRIG_1' } };
    if (method === 'GET' && path.includes('/workflow/')) return { ok: true, json: { workflowData: { templates: [
      { id: 'WID_1', type: 'custom_webhook',
        attributes: { event: 'CUSTOM', method: 'POST', url: 'https://example.com/h', headers: { marketplace: true } } },
    ] } } };
    return { ok: true, json: {} };
  };
  const gw = { call, loc: 'LOC', uid: 'UID' };
  // No node here sets `marketplace: true` — the suspicious text lives only inside a NESTED
  // OBJECT attribute value (`headers`), which is exactly what serializes unescaped.
  const ir = {
    name: 'W',
    triggers: [],
    graph: [{ ref: 'w', kind: 'action', type: 'custom_webhook', name: 'Hook',
      attributes: { event: 'CUSTOM', method: 'POST', url: 'https://example.com/h', headers: { marketplace: true } } }],
  };
  // Sanity-check the premise this test relies on: the naive scan WOULD have false-positived
  // on this exact IR (proving the decoy is real), while a string decoy would not have.
  assert.ok(JSON.stringify(ir.graph).includes('"marketplace":true'),
    'premise check: the naive JSON.stringify scan must false-positive on this nested-object decoy');
  assert.ok(!JSON.stringify([{ attributes: { tags: ['{"marketplace":true}'] } }]).includes('"marketplace":true'),
    'premise check: a STRING-valued decoy does NOT trip the naive scan (quotes are escaped) — not a valid test case');

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

test('fetchMarketplace reports each leg — a failed leg is named, never folded into "no apps"', async () => {
  const call = async (m, p) => {
    if (p.includes('/assets')) return { ok: true, json: { actions: [], triggers: [] } };
    if (p.includes('type=actions')) return { ok: false, status: 500, json: {} };
    throw new Error('transport');
  };
  const out = await fetchMarketplace(call, 'LOC');
  assert.deepEqual(out.legs, { assets: 'ok', actions: 'failed', triggers: 'failed' });
  assert.deepEqual(out.modules, { actions: [], triggers: [] });
});
