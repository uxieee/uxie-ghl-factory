// create_funnel kind blog with {domain, urlSlug}: the Create blog screen's body (knowledge sniffs/funnels-wave46-f8b-2026-09-30,
// live-ui-cap.create-blog-site.BLOCKED.json): POST /blogs/site {locationId, title, urlSlug, domain: <domain id>, description}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planCreateFunnel } from '../core/funnel-create.mjs';

const cf = (args, d) => TOOLS.find((t) => t.name === 'create_funnel').handler({ locationId: 'LOC', ...args }, d);
const DOMS = [{ id: 'DOM1', url: 'sites.example.com' }];

function deps({ taken = false } = {}) {
  const calls = []; let doc = null;
  return { calls, state: {}, rereadOptions: { tries: 3, delays: [0, 0, 0] }, makeGw: () => ({ uid: 'U', call: async (m, p, b) => {
    calls.push({ m, p, b });
    if (p.startsWith('/funnels/funnel/list')) return { ok: true, status: 200, json: { funnels: doc ? [doc] : [], count: doc ? 1 : 0 } };
    if (p.startsWith('/funnels/domain')) return { ok: true, status: 200, json: { domains: DOMS } };
    if (p === '/funnels/lookup/exists') return { ok: true, status: 200, json: { exists: taken } };
    if (p === '/blogs/site') { doc = { _id: 'B1', name: b.title, type: 'blog', domainId: b.domain ?? '', steps: [] }; return { ok: true, status: 201, json: {} }; }
    if (p.startsWith('/funnels/funnel/blog/list/')) return { ok: true, status: 200, json: { data: doc ? [doc] : [] } };
    if (p.startsWith('/funnels/funnel/fetch/')) return doc ? { ok: true, status: 200, json: { data: structuredClone(doc) } } : { ok: false, status: 400, json: {} };
    throw new Error(`unexpected ${m} ${p}`);
  } }) };
}

test('planCreateFunnel: a blog with a domain and slug sends both; without them neither; a half pair or a bad slug is refused', () => {
  const p = planCreateFunnel({ kind: 'blog', name: 'B', locationId: 'L', description: 'd', blog: { urlSlug: 'my-blog', domainId: 'DOM1' } });
  assert.deepEqual(p.body, { locationId: 'L', title: 'B', urlSlug: 'my-blog', domain: 'DOM1', description: 'd' });
  assert.deepEqual(planCreateFunnel({ kind: 'blog', name: 'B', locationId: 'L' }).body, { locationId: 'L', title: 'B', description: '' });
  assert.match(planCreateFunnel({ kind: 'blog', name: 'B', locationId: 'L', blog: { urlSlug: 'My Blog', domainId: 'D' } }).refuse, /lower-case/);
  assert.match(planCreateFunnel({ kind: 'blog', name: 'B', locationId: 'L', blog: { urlSlug: 'ok' } }).refuse, /go together/);
  assert.match(planCreateFunnel({ kind: 'funnel', name: 'B', locationId: 'L', blog: { urlSlug: 'ok', domainId: 'D' } }).refuse, /kind blog only/);
});

test('create_funnel blog: resolves the domain by url, checks the slug is free, sends the UI body, verifies the domain on the read-back', async () => {
  const d = deps();
  const r = await cf({ kind: 'blog', name: 'My Blog', description: 'desc', blog: { domain: 'https://Sites.Example.com/', urlSlug: 'my-blog' }, confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  const w = d.calls.find((c) => c.p === '/blogs/site');
  assert.deepEqual(w.b, { locationId: 'LOC', title: 'My Blog', urlSlug: 'my-blog', domain: 'DOM1', description: 'desc' });
  assert.deepEqual(d.calls.find((c) => c.p === '/funnels/lookup/exists').b, { domain: 'sites.example.com', path: '/my-blog', locationId: 'LOC' });
  assert.deepEqual([r.data.readBack.blogDomain, r.data.readBack.blogSlug], ['sites.example.com', 'my-blog']);
});

test('create_funnel blog: an unknown domain or a taken slug is refused before any write', async () => {
  const d1 = deps(); const a = await cf({ kind: 'blog', name: 'X', blog: { domain: 'nope.example.org', urlSlug: 'x' }, confirm: true }, d1);
  assert.match(a.detail, /not a domain of this location/);
  const d2 = deps({ taken: true }); const b = await cf({ kind: 'blog', name: 'X', blog: { domain: 'sites.example.com', urlSlug: 'x' }, confirm: true }, d2);
  assert.match(b.detail, /already taken/);
  for (const d of [d1, d2]) assert.equal(d.calls.filter((c) => c.m === 'POST' && c.p === '/blogs/site').length, 0);
});
