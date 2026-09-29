// edit_funnel object ops (clone-funnel, archive-page, restore-page, import-page, add-store) and get_funnel views
// share / archived-pages. Every body is the UI's captured one and each behaviour was measured live on the sandbox
// (knowledge sniffs/funnels-wave13-objects-2026-09-28); the fake below mirrors those response shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import {
  planCloneFunnel, planArchivePage, planRestorePage, planImportPage, planAddStore, STORE_PATHS, billingCheckouts,
} from '../core/funnel-ops.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const run = (n, args, deps) => tool(n).handler({ locationId: 'LOC', funnelId: 'F1', ...args }, deps);
const FUNNEL = () => ({
  _id: 'F1', name: 'TEST-CONF-FUN-SRC', type: 'funnel', url: '/test-conf-fun-src', domainId: 'D1',
  steps: [
    { id: 'S1', name: 'Optin', url: '/optin', type: 'optin_funnel_page', pages: ['P1', 'P9'], sequence: 1, split: false, controlTraffic: 100 },
    { id: 'S2', name: 'Thanks', url: '/thanks', type: 'thankyou_funnel_page', pages: ['P2'], sequence: 2, split: false, controlTraffic: 100 },
  ],
});

function fakeDeps({ docs = [{ _id: 'F1', name: 'TEST-CONF-FUN-SRC' }], taken = [], shared = null } = {}) {
  const db = { funnel: FUNNEL(), lookups: [{ _id: 'L1', type: 'step', typeId: 'S1', path: '/optin' }, { _id: 'L2', type: 'page', typeId: 'P1', path: '/optin-page' }],
    pages: [{ _id: 'P1', name: 'Optin', stepId: 'S1', deleted: false }, { _id: 'P9', name: 'Optin B', stepId: 'S1', deleted: false }, { _id: 'P2', name: 'Thanks', stepId: 'S2', deleted: false }],
    docs: structuredClone(docs), copies: {} };
  const calls = [];
  return {
    db, calls, state: {}, rereadOptions: { tries: 2, delays: [0, 0] },
    makeGw: () => ({
      uid: 'U1',
      call: async (method, path, body) => {
        calls.push({ method, path, body });
        const j = (json, status = 200) => ({ ok: status < 300, status, json });
        if (method === 'GET' && path.startsWith('/funnels/funnel/list')) return j({ funnels: structuredClone(db.docs), count: db.docs.length });
        if (method === 'GET' && path.startsWith('/funnels/funnel/fetch/')) {
          const id = decodeURIComponent(path.split('/')[4].split('?')[0]);
          return j(structuredClone(id === 'F1' ? db.funnel : db.copies[id]));
        }
        if (method === 'GET' && path.startsWith('/funnels/lookup/list')) return j({ data: path.includes('funnelId=F1') ? structuredClone(db.lookups) : [] });
        if (method === 'GET' && path.startsWith('/funnels/domain/')) return j({ domains: [{ id: 'D1', url: 'sandbox.example.com' }] });
        if (method === 'GET' && path.startsWith('/funnels/page/list')) return j(structuredClone(db.pages));
        if (method === 'GET' && path.startsWith('/funnels/page/')) { const id = path.split('/')[3].split('?')[0]; return j(structuredClone(db.pages.find((p) => p._id === id))); }
        if (method === 'GET' && path.startsWith('/funnels/builder/funnel-share-details/')) return shared ? j({ data: shared }) : j({ status: 400, message: 'Share funnel not found' }, 400);
        if (method === 'POST' && path === '/funnels/lookup/exists') return j({ exists: taken.includes(body.path) });
        if (method === 'POST' && path === '/funnels/funnel/clone-funnel-to-locations') {
          db.docs.push({ _id: 'C1', name: body.funnelName });
          db.copies.C1 = { ...FUNNEL(), _id: 'C1', name: body.funnelName, domainId: '' };
          return j({ ok: true }, 201);
        }
        if (method === 'POST' && path === '/funnels/funnel/update-funnel-and-page') {
          if (body.archivePageId) {
            db.funnel.steps.find((s) => s.id === body.stepId).pages = body.funnelStepDetails.pages;
            db.pages.find((p) => p._id === body.archivePageId).deleted = true;
            db.lookups = db.lookups.filter((r) => r.typeId !== body.archivePageId);
          } else if (body.restoreArchivePageId) {
            const rec = db.pages.find((p) => p._id === body.restoreArchivePageId);
            rec.deleted = false; db.funnel.steps.find((s) => s.id === rec.stepId).pages.push(rec._id);
            db.lookups.push({ _id: 'LN', type: 'page', typeId: rec._id, path: '/optin-b' });
          }
          return j({ ok: true }, 201);
        }
        if (method === 'POST' && path === '/funnels/funnel/clone-funnel-step/') {
          db.funnel.steps.find((s) => s.id === body.stepIdToImportInto).pages.push('PNEW');
          db.lookups.push({ _id: 'LI', type: 'page', typeId: 'PNEW', path: '/thanks-page-1' });
          return j({ status: 'ok', data: { stepIds: [body.stepIdToImportInto] } }, 201);
        }
        if (method === 'POST' && path === '/funnels/store/create-in-funnel') {
          const keys = ['store-product-list', 'store-product-detail', 'store-cart', 'store-checkout', 'store-thank-you'];
          const createdPages = keys.map((k, i) => ({ key: k, name: k, stepId: `ST${i}`, pageId: `SP${i}` }));
          db.funnel.isStoreActive = true;
          for (const c of createdPages) { db.funnel.steps.push({ id: c.stepId, name: c.name, url: `/${c.key}`, type: 'store', pages: [c.pageId] }); db.lookups.push({ _id: `LS${c.stepId}`, type: 'step', typeId: c.stepId, path: `/${c.key}` }); }
          return j({ success: true, totalPages: 5, createdPages }, 201);
        }
        if (method === 'POST' && path.startsWith('/funnels/builder/autosave/')) { db.saved = { ...(db.saved ?? {}), [path.split('/')[4]]: body.pageData }; return j({}, 201); }
        if (method === 'GET' && path.startsWith('/funnels/builder/page/data')) { const id = new URL(`http://x${path}`).searchParams.get('pageId'); return j(structuredClone(db.saved?.[id] ?? { sections: [] })); }
        if (method === 'GET' && path.startsWith('/funnels/builder/get-versions')) return j([]);
        return j({ message: `unexpected ${method} ${path}` }, 500);
      },
    }),
  };
}
const writes = (d) => d.calls.filter((c) => c.method !== 'GET' && c.path !== '/funnels/lookup/exists');

test('clone-funnel: the name must be unused (the route returns no id), and the copy is found by it', async () => {
  const clash = planCloneFunnel({ funnel: FUNNEL(), name: 'test-conf-fun-src', locationId: 'LOC', existing: [{ _id: 'F1', name: 'TEST-CONF-FUN-SRC' }] });
  assert.match(clash.refuse, /already exists/);
  assert.match(planCloneFunnel({ funnel: FUNNEL(), name: ' ', existing: [] }).refuse, /needs name/);
  const d = fakeDeps();
  const pre = await run('edit_funnel', { op: 'clone-funnel', name: 'TEST-CONF-FUN-COPY' }, d);
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(pre.data.preview.request.body, { funnelId: 'F1', funnelName: 'TEST-CONF-FUN-COPY', locationIds: ['LOC'] });
  assert.equal(writes(d).length, 0);
  const r = await run('edit_funnel', { op: 'clone-funnel', name: 'TEST-CONF-FUN-COPY', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.copyId, 'C1');
  assert.equal(r.data.copy.domainId, null);
  assert.equal(r.data.copyLookupRows, 0);
  assert.match(r.data.note, /NO domain/);
});

test('archive-page: target check on id AND name; never the only page, never a running split; reads back archived', async () => {
  const f = FUNNEL();
  assert.match(planArchivePage({ funnel: f, pageId: 'P2', expectName: 'Thanks', pageRecord: { name: 'Thanks' } }).refuse, /only page/);
  assert.match(planArchivePage({ funnel: f, pageId: 'P9', expectName: 'Wrong', pageRecord: { name: 'Optin B' } }).refuse, /target check failed/);
  const split = FUNNEL(); split.steps[0].split = true;
  assert.match(planArchivePage({ funnel: split, pageId: 'P9', expectName: 'Optin B', pageRecord: { name: 'Optin B' } }).refuse, /split/);
  const ok = planArchivePage({ funnel: f, pageId: 'P9', expectName: 'Optin B', pageRecord: { name: 'Optin B' }, locationId: 'LOC' });
  assert.deepEqual(ok.body, { funnelId: 'F1', locationId: 'LOC', funnelStepDetails: { stepId: 'S1', pages: ['P1'] }, archivePageId: 'P9', stepId: 'S1' });
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'archive-page', pageId: 'P9', expectName: 'Optin B', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.step.pages, ['P1']);
  assert.equal(r.data.pageRecord.deleted, true);
});

test('restore-page: only an archived page, only onto a single-page non-split step; reports the NEW path', async () => {
  const d = fakeDeps();
  assert.equal((await run('edit_funnel', { op: 'restore-page', pageId: 'P9', confirm: true }, d)).code, 'VALIDATION_FAILED'); // not archived
  await run('edit_funnel', { op: 'archive-page', pageId: 'P9', expectName: 'Optin B', confirm: true }, d);
  const views = await run('get_funnel', { view: 'archived-pages' }, d);
  assert.deepEqual(views.data.archived.map((p) => p.pageId), ['P9']);
  const r = await run('edit_funnel', { op: 'restore-page', pageId: 'P9', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.step.pages, ['P1', 'P9']);
  assert.equal(r.data.newPath.path, '/optin-b');
  const two = FUNNEL();
  assert.match(planRestorePage({ funnel: two, pageId: 'P9', pages: [{ _id: 'P9', stepId: 'S1', deleted: true }] }).refuse, /already has a variation/);
});

test('import-page: the captured body, page indexes as strings, target must have exactly one page', async () => {
  const f = FUNNEL();
  assert.match(planImportPage({ funnel: f, stepId: 'S1', source: f, sourceStepId: 'S2', locationId: 'LOC', userId: 'U1' }).refuse, /exactly one/);
  assert.match(planImportPage({ funnel: f, stepId: 'S2', source: f, sourceStepId: 'S2', sourcePageIndex: 3, locationId: 'LOC', userId: 'U1' }).refuse, /sourcePageIndex/);
  const p = planImportPage({ funnel: f, stepId: 'S2', source: f, sourceStepId: 'S1', sourcePageIndex: 1, locationId: 'LOC', userId: 'U1' });
  assert.deepEqual(p.body, { stepId: 'S1', funnelId: 'F1', funnels: ['F1'], locationId: 'LOC', userId: 'U1', stepIdToImportInto: 'S2', pageIndexToImportInto: '1', pageIndexToImport: '1', funnelIdToImport: 'F1' });
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'import-page', stepId: 'S2', sourceFunnelId: 'F1', sourceStepId: 'S1', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.importedPageId, 'PNEW');
  assert.match(r.data.note, /NOT imported/);
});

test('add-store: every fixed store path is pre-checked on the domain; the billing-field side effect is disclosed', async () => {
  assert.equal(STORE_PATHS.length, 10);
  assert.match(planAddStore({ funnel: { ...FUNNEL(), isStoreActive: true }, domainName: 'x' }).refuse, /already has a store/);
  assert.match(planAddStore({ funnel: { ...FUNNEL(), type: 'website' }, domainName: 'x' }).refuse, /FUNNEL/);
  assert.match(planAddStore({ funnel: FUNNEL(), domainName: undefined }).refuse, /no domain/);
  const held = fakeDeps({ taken: ['/store-cart'] });
  const refused = await run('edit_funnel', { op: 'add-store', confirm: true }, held);
  assert.equal(refused.code, 'VALIDATION_FAILED');
  assert.match(refused.detail ?? refused.message ?? JSON.stringify(refused), /store-cart/);
  assert.equal(writes(held).length, 0);
  const d = fakeDeps();
  const pre = await run('edit_funnel', { op: 'add-store' }, d);
  assert.deepEqual(pre.data.preview.request.body, { funnelId: 'F1', domainName: 'sandbox.example.com', importTheme: true });
  assert.match(pre.data.preview.notes[0], /Billing Info/);
  const r = await run('edit_funnel', { op: 'add-store', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.steps.length, 5);
  assert.equal(r.data.isStoreActive, true);
  // GHL makes the pages empty; each is filled with its own store element
  assert.deepEqual(r.data.filled.map((f) => f.ok), [true, true, true, true, true]);
  for (let i = 0; i < 5; i++) {
    const metas = d.db.saved[`SP${i}`].sections.flatMap((x) => x.elements.filter((e) => e.type === 'element').map((e) => e.meta));
    assert.deepEqual(metas, [r.data.created[i].key]);
  }
});

test('get_funnel share: none → shared:false (400 "Share funnel not found" is not a failure); present → import URL', async () => {
  const none = await run('get_funnel', { view: 'share' }, fakeDeps());
  assert.deepEqual({ ok: none.ok, shared: none.data.shared }, { ok: true, shared: false });
  const some = await run('get_funnel', { view: 'share' }, fakeDeps({ shared: { funnelName: 'X', shareWith: 'ALL', shareId: 'SH1' } }));
  assert.equal(some.data.share.importUrl, 'https://app.gohighlevel.com/funnels/share/SH1');
});

test('billingCheckouts finds a checkout whose billing address is on (the builder\'s save trigger)', () => {
  const pd = { sections: [{ elements: [{ id: 'a', type: 'element', meta: 'store-checkout', extra: { step1: { value: { enableBillingAddress: true } } } }, { id: 'b', type: 'element', meta: 'heading', extra: {} }] }] };
  assert.deepEqual(billingCheckouts(pd), [{ id: 'a', meta: 'store-checkout' }]);
  assert.deepEqual(billingCheckouts({ sections: [] }), []);
});

test('compose: a step-typed store kind is refused on a plain step and accepted on a store step (the step type is read)', async () => {
  const d = fakeDeps();
  d.db.funnel.steps.push({ id: 'SS', name: 'Cart', url: '/cart', type: 'store', pages: ['PS'] });
  const plain = await run('build_funnel_page', { stepId: 'S2', pageId: 'P2', sections: [{ columns: [{ elements: [{ meta: 'store-cart' }] }] }] }, d);
  assert.equal(plain.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(plain.data.problems), /type 'store'/);
  const store = await run('build_funnel_page', { stepId: 'SS', pageId: 'PS', sections: [{ columns: [{ elements: [{ meta: 'store-cart' }] }] }] }, d);
  assert.equal(store.code, 'CONFIRM_REQUIRED');
});

test('compose: product-page blocks need a pdp section AND a product-detail step key (knowledge wave29)', async () => {
  const d = fakeDeps();
  d.db.funnel.steps.push({ id: 'SP', name: 'Product details', url: '/store-product-detail', type: 'store', key: 'store-product-detail', pages: ['PP'] });
  d.db.funnel.steps.push({ id: 'SC', name: 'Cart', url: '/cart', type: 'store', key: 'store-cart', pages: ['PC'] });
  const pdpSection = (extra = {}) => [{ ...extra, columns: [{ elements: [{ meta: 'store-pdp-v2-images' }] }, { elements: ['title', 'price', 'add-to-cart'].map((k) => ({ meta: `store-pdp-v2-${k}` })) }] }];
  const ok = await run('build_funnel_page', { stepId: 'SP', pageId: 'PP', sections: pdpSection({ pdp: true }) }, d);
  assert.equal(ok.code, 'CONFIRM_REQUIRED', JSON.stringify(ok.data?.problems ?? ok));
  const noFlag = await run('build_funnel_page', { stepId: 'SP', pageId: 'PP', sections: pdpSection() }, d);
  assert.equal(noFlag.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(noFlag.data.problems), /pdpV2Section/);
  const wrongKey = await run('build_funnel_page', { stepId: 'SC', pageId: 'PC', sections: pdpSection({ pdp: true }) }, d);
  assert.equal(wrongKey.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(wrongKey.data.problems), /'store-cart'/);
  const plain = await run('build_funnel_page', { stepId: 'S1', pageId: 'P1', sections: pdpSection({ pdp: { products: ['PR1'] } }) }, d);
  assert.match(JSON.stringify(plain.data.problems), /key is absent/);
  const bad = await run('build_funnel_page', { stepId: 'SP', pageId: 'PP', sections: pdpSection({ pdp: { products: 'PR1' } }) }, d);
  assert.match(bad.message ?? bad.detail ?? '', /section pdp must be/);
});
