// edit_redirects planners: every refusal here stands for a write GHL would accept and then not serve,
// or a write aimed at the wrong row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCreate, planUpdate, planDelete, resolveTarget, reservedPrefix, normPath, listRedirects, statsBody } from '../core/redirects.mjs';

test('create refuses every reserved storefront/blog prefix, in any case — GHL stores them and serves 404', () => {
  for (const p of ['b/x', '/c/x', '/Product/x', '/collections/x', 'post/x', '/CATEGORY/x', '/author/x', '/tag/x']) {
    assert.match(planCreate({ domain: 'd.example', path: p, target: 'https://example.com/', locationId: 'L' }).error, /reserved prefix/, p);
  }
  assert.equal(reservedPrefix('/blog-post'), null, '"/blog-post" is not under /b/');
});

test('create normalises the path, pre-checks exists, and sends the screen\'s exact body', () => {
  const plan = planCreate({ domain: 'd.example', path: 'test-conf-fun-x', target: 'https://example.com/t', locationId: 'L' });
  assert.equal(plan.normalizedPath, '/test-conf-fun-x');
  assert.deepEqual(plan.exists.body, { domain: 'd.example', path: '/test-conf-fun-x', locationId: 'L' });
  assert.deepEqual(plan.request.body, { domain: 'd.example', path: '/test-conf-fun-x', action: 'url', locationId: 'L', type: 'redirect', target: 'https://example.com/t' });
});

test('create refuses the domain root, a relative target and missing fields', () => {
  assert.match(planCreate({ domain: 'd', path: '/', target: 'https://e.com', locationId: 'L' }).error, /root/);
  assert.match(planCreate({ domain: 'd', path: '/x', target: 'example.com/t', locationId: 'L' }).error, /absolute/);
  assert.match(planCreate({ domain: 'd', path: '/x', locationId: 'L' }).error, /needs/);
});

test('update and delete resolve exactly one row by id AND path', () => {
  const rows = [{ _id: 'A', path: '/test-conf-fun-a', path_lowercase: '/test-conf-fun-a' }, { _id: 'B', path: '/other' }];
  assert.equal(resolveTarget(rows, { redirectId: 'A', path: 'test-conf-fun-a' }).row._id, 'A');
  assert.match(resolveTarget(rows, { redirectId: 'A', path: '/other' }).error, /refusing/);
  assert.match(resolveTarget(rows, { redirectId: 'Z', path: '/x' }).error, /no single redirect/);
  assert.deepEqual(planUpdate({ redirectId: 'A', target: 'https://example.com/2', locationId: 'L' }).request.body, { action: 'url', target: 'https://example.com/2', locationId: 'L' });
  assert.equal(planDelete({ redirectId: 'A', locationId: 'L' }).request.path, '/funnels/lookup/redirect/A?locationId=L');
});

test('the list walk follows count across pages and reports a failed page instead of an empty list', async () => {
  const pages = [{ ok: true, json: { data: Array.from({ length: 10 }, (_, i) => ({ _id: `r${i}` })), count: 12 } }, { ok: true, json: { data: [{ _id: 'r10' }, { _id: 'r11' }], count: 12 } }];
  let n = 0;
  const out = await listRedirects({ call: async () => pages[n++] }, 'L');
  assert.equal(out.rows.length, 12);
  const bad = await listRedirects({ call: async () => ({ ok: false, status: 401 }) }, 'L');
  assert.equal(bad.rows, null);
  assert.equal(normPath('//x'), '/x');
  assert.deepEqual(statsBody('L', [{ domain: 'd', path: '/p', target: 'https://t' }], '2026-09-01', '2026-09-28').rows[0].key, { domainName: 'd', pageUrl: '/p', fullUrl: 'https://t' });
});
