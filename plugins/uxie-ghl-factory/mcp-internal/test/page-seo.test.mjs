// build_funnel_page edit-mode `seo`: the page RECORD is written through POST /funnels/funnel/funnel-page/{pageId}
// {name, url, meta} (measured 2026-09-28, knowledge sniffs/funnels-wave10-e-plan-2026-09-28
// live-route.funnel-page-meta.json). That route rewrites name and url too, so the body carries the values
// just read and the read-back must show them unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { metaPost, checkRecord, recordDrift } from '../core/page-seo.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const fast = { tries: 2, delays: [0, 0] };
const RECORD = () => ({ _id: 'P1', locationId: 'LOC', funnelId: 'F1', name: 'Optin', url: '/optin-page',
  meta: { title: 'Old', description: 'Keep me', keywords: '', author: '', imageUrl: '', language: 'en', customMeta: [], canonicalMeta: [] } });

function deps({ record = RECORD(), renameBetween = false, recordWriteStatus = 201 } = {}) {
  const calls = []; const db = { record };
  return {
    calls, db, state: {}, rereadOptions: fast,
    makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: [{ id: 'S1', name: 'Optin', pages: ['P1'] }] } };
      if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: { sections: [{ id: 'sec1', elements: [] }], settings: {}, general: {} } };
      if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: structuredClone(db.record) };
      if (path.startsWith('/funnels/funnel/funnel-page/')) {
        if (recordWriteStatus >= 400) return { ok: false, status: recordWriteStatus, json: { message: 'no' } };
        db.record = { ...db.record, name: renameBetween ? 'Renamed elsewhere' : body.name, url: body.url, meta: body.meta };
        return { ok: true, status: 201, json: {} };
      }
      if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: { ok: true } };
      if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
      throw new Error(`unexpected ${method} ${path}`);
    } }),
  };
}
const run = (args, d) => tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', stepName: 'Optin', edits: [], confirm: true, ...args }, d);

test('metaPost carries the record\'s own name and url and all 8 meta keys', () => {
  const m = metaPost('P1', RECORD(), { ...RECORD().meta, title: 'New', extra: 'dropped' });
  assert.equal(m.path, '/funnels/funnel/funnel-page/P1');
  assert.deepEqual(Object.keys(m.body), ['name', 'url', 'meta']);
  assert.equal(m.body.name, 'Optin');
  assert.equal(m.body.url, '/optin-page');
  assert.equal(Object.keys(m.body.meta).length, 8);
  assert.equal(m.body.meta.title, 'New');
});

test('checkRecord refuses another location, another funnel, and a record with no name/url', () => {
  assert.equal(checkRecord({ ...RECORD(), locationId: 'X' }, { pageId: 'P1', locationId: 'LOC', funnelId: 'F1' }).ok, false);
  assert.equal(checkRecord({ ...RECORD(), funnelId: 'F2' }, { pageId: 'P1', locationId: 'LOC', funnelId: 'F1' }).ok, false);
  assert.equal(checkRecord({ ...RECORD(), url: undefined }, { pageId: 'P1', locationId: 'LOC', funnelId: 'F1' }).ok, false);
  assert.deepEqual(recordDrift({ name: 'a', url: '/b' }, { name: 'a', url: '/b' }), []);
});

test('seo writes the record through funnel-page BEFORE the autosave, merged, and verifies it', async () => {
  const d = deps();
  const r = await run({ seo: { title: 'New title' } }, d);
  assert.equal(r.ok, true, r.detail);
  const writes = d.calls.filter((c) => c.method !== 'GET').map((c) => c.path.split('/').slice(0, 4).join('/'));
  assert.deepEqual(writes, ['/funnels/funnel/funnel-page', '/funnels/builder/autosave']);
  const post = d.calls.find((c) => c.path.startsWith('/funnels/funnel/funnel-page/'));
  assert.equal(post.body.meta.description, 'Keep me', 'keys the caller did not name are kept');
  assert.equal(post.body.meta.title, 'New title');
  assert.equal(r.data.readBack.seo.applied, true);
  assert.ok(!d.calls.some((c) => /firestore|documents\//.test(c.path)), 'no Firestore call any more');
  const auto = d.calls.find((c) => c.path.startsWith('/funnels/builder/autosave/'));
  assert.equal(auto.body.meta.title, 'New title', 'the autosave carries the same meta for the version');
});

test('a rename between our read and our write is VERIFY_FAILED and says so', async () => {
  const r = await run({ seo: { title: 'New title' } }, deps({ renameBetween: true }));
  assert.equal(r.code, 'VERIFY_FAILED');
  assert.match(r.detail, /name did not read back/);
  assert.match(r.remediation, /renamed or moved/);
  assert.equal(r.data.readBack.seo.recordDrift[0].readBack, 'Renamed elsewhere');
});

test('a refused record write sends no autosave', async () => {
  const d = deps({ recordWriteStatus: 422 });
  const r = await run({ seo: { title: 'New title' } }, d);
  assert.equal(r.ok, false);
  assert.ok(!d.calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')));
});

test('a record of another funnel is refused before any write', async () => {
  const d = deps({ record: { ...RECORD(), funnelId: 'F9' } });
  const r = await run({ seo: { title: 'x' } }, d);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.equal(d.calls.filter((c) => c.method !== 'GET').length, 0);
});
