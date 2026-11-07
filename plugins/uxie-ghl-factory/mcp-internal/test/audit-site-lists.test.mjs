// w7-12 (2026-11-07): audit_site reads its reference lists (forms, surveys, funnels, store products) completely or says why it could
// not. Before this fix forms and surveys were read at limit=20 and funnels at limit=100 with no paging, so a real form past the
// first page was reported as a dangling reference while its coverage line said ran:true. These tests pin the paging, the honest
// truncation, and the store-product source. Fixtures only: the fake gateway answers the handful of paths audit_site reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const LOC = 'LOC_TEST';
const audit = TOOLS.find((t) => t.name === 'audit_site');
const ARGS = { locationId: LOC, includeRender: false, maxPages: 60, maxDocuments: 120 };

const pageWith = (elements) => ({ sections: [{ id: 'S1', elements }], settings: {}, general: {} });
const formEl = (formId) => ({ type: 'element', meta: 'form', extra: { formId: { value: formId, text: 'Contact' } } });
const surveyEl = (surveyId) => ({ type: 'element', meta: 'survey', extra: { surveyId: { value: surveyId, text: 'Intake' } } });
const storeEl = (storeProductId) => ({ type: 'element', meta: 'button', extra: { storeProductId: { value: storeProductId, text: 'Buy' } } });
const rows = (prefix, n) => Array.from({ length: n }, (_, i) => ({ _id: `${prefix}${String(i + 1).padStart(3, '0')}`, name: `${prefix} ${i + 1}` }));

// A fake account. serverCap is the most rows one page returns (a server can cap a page below the limit asked).
// sameRowsForever answers every page with the first page (a paging that never advances).
function fakeAccount({ forms = [], surveys = [], funnels = [], products = [], serverCap = 50, failFormsFrom = null,
  sameRowsForever = false, elements = [] } = {}) {
  const calls = [];
  const slice = (list, q, { stuck = false } = {}) => {
    const skip = Number(q.get('skip') ?? q.get('offset') ?? 0);
    const limit = Math.min(Number(q.get('limit') ?? 20), serverCap);
    return stuck ? list.slice(0, limit) : list.slice(skip, skip + limit);
  };
  const route = (path) => {
    const url = new URL(path, 'https://x.invalid');
    const p = url.pathname; const q = url.searchParams;
    if (p === '/forms/') {
      if (failFormsFrom !== null && Number(q.get('skip') ?? 0) >= failFormsFrom) return { status: 500, json: { message: 'boom' } };
      return { status: 200, json: { forms: slice(forms, q, { stuck: sameRowsForever }), total: forms.length } };
    }
    if (p === '/surveys/') return { status: 200, json: { surveys: slice(surveys, q), total: surveys.length } };
    if (p === '/funnels/funnel/list') return { status: 200, json: { funnels: slice(funnels, q) } };
    if (p === '/products/') return { status: 200, json: { products: slice(products, q) } };
    if (p === '/calendars/') return { status: 200, json: { calendars: [] } };
    if (p === '/funnels/custom-fonts') return { status: 200, json: { data: [] } };
    if (p === '/countdown-timer/') return { status: 200, json: { countdownTimers: [] } };
    if (p === `/locations/${LOC}/customValues`) return { status: 200, json: { customValues: [] } };
    if (p === '/funnels/domain/') return { status: 200, json: { domains: [] } };
    if (p === '/funnels/builder/page/data') return { status: 200, json: pageWith(elements) };
    if (p === '/funnels/builder/get-versions') return { status: 200, json: [] };
    if (p.startsWith('/funnels/page/')) return { status: 200, json: { data: { meta: { title: 'T', language: 'en' } } } };
    return { status: 404, json: {} };
  };
  const deps = { state: {}, makeGw: () => ({ uid: 'U', call: async (method, path) => { calls.push(path); return route(path); } }) };
  return { deps, calls };
}

// Only HIGH findings are a dangling reference; a not-checked reference is the same check and prop at severity 'unknown'.
const danglingFor = (res, prop) => (res.data.findings ?? []).filter((f) => f.check === 'dangling-references' && f.prop === prop && f.severity === 'high');
const coverageOf = (res, check) => (res.data.coverage ?? []).find((c) => c.check === check);
const homeFunnel = (extraSteps = []) => ({ _id: 'F1', name: 'Main funnel', steps: [{ id: 'ST1', name: 'Home', pages: ['P1'] }, ...extraSteps] });

test('a form past the first page is known, so it is not reported dangling (forms are read to the end)', async () => {
  const { deps } = fakeAccount({
    forms: rows('FORM', 45), funnels: [homeFunnel()], elements: [formEl('FORM033')] });
  const res = await audit.handler(ARGS, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(danglingFor(res, 'formId'), [], JSON.stringify(danglingFor(res, 'formId')));
  const c = coverageOf(res, 'dangling-references:forms');
  assert.equal(c.ran, true);
  assert.equal(c.knownIds, 45, 'every form on the account is in the reference list, not the first 20');
});

test('a server that caps each page at 20 is still read to the end (paging follows the rows, not the limit asked)', async () => {
  const { deps } = fakeAccount({
    forms: rows('FORM', 45), funnels: [homeFunnel()], serverCap: 20, elements: [formEl('FORM040')] });
  const res = await audit.handler(ARGS, deps);
  assert.deepEqual(danglingFor(res, 'formId'), []);
  assert.equal(coverageOf(res, 'dangling-references:forms').knownIds, 45);
});

test('surveys past the first page are known too', async () => {
  const { deps } = fakeAccount({
    surveys: rows('SURV', 25), funnels: [homeFunnel()], elements: [surveyEl('SURV022')] });
  const res = await audit.handler(ARGS, deps);
  assert.deepEqual(danglingFor(res, 'surveyId'), []);
  assert.equal(coverageOf(res, 'dangling-references:surveys').knownIds, 25);
});

test('a funnel past the first 100 is swept: its step with no id is reported', async () => {
  const funnels = rows('FUN', 120).map((f, i) => ({ ...f, steps: [] }));
  funnels[109] = { _id: 'FUN110', name: 'Funnel 110', steps: [{ name: 'Orphan step', pages: [] }] };
  const { deps } = fakeAccount({ funnels, serverCap: 50 });
  const res = await audit.handler({ ...ARGS, funnelId: undefined }, deps);
  const integ = (res.data.findings ?? []).filter((f) => f.check === 'step-integrity');
  assert.ok(integ.some((f) => /Funnel 110/.test(f.pageName)), JSON.stringify(integ));
});

test('a list whose paging never advances reports the check as NOT RUN, and stops (no endless loop)', async () => {
  const { deps, calls } = fakeAccount({ forms: rows('FORM', 45), funnels: [homeFunnel()], serverCap: 20, sameRowsForever: true, elements: [formEl('FORM001')] });
  const res = await audit.handler(ARGS, deps);
  const c = coverageOf(res, 'dangling-references:forms');
  assert.equal(c.ran, false, JSON.stringify(c));
  assert.match(c.why, /repeated|stopped|did not advance/i);
  assert.ok(calls.filter((p) => p.startsWith('/forms/')).length < 300, 'paging must be bounded');
  assert.deepEqual(danglingFor(res, 'formId'), [], 'a check that did not run cannot report a reference as dangling');
});

test('a page that fails in the middle of the list disables the check with the status, instead of a partial list', async () => {
  const { deps } = fakeAccount({ forms: rows('FORM', 45), funnels: [homeFunnel()], serverCap: 20, failFormsFrom: 40, elements: [formEl('FORM001')] });
  const res = await audit.handler(ARGS, deps);
  const c = coverageOf(res, 'dangling-references:forms');
  assert.equal(c.ran, false);
  assert.match(c.why, /answered 500/);
  assert.deepEqual(danglingFor(res, 'formId'), []);
});

test('a storeProductId that the account does not hold is HIGH dangling (the store-product list is a real source)', async () => {
  const { deps } = fakeAccount({ products: rows('PR', 3), funnels: [homeFunnel()], elements: [storeEl('PRMISSING')] });
  const res = await audit.handler(ARGS, deps);
  const d = danglingFor(res, 'storeProductId');
  assert.equal(d.length, 1, JSON.stringify(res.data.findings));
  assert.equal(d[0].severity, 'high', 'before the source existed this reference was reported unknown and not checked');
  assert.match(d[0].detail, /does not exist in this account/);
});

test('a storeProductId the account holds is not reported, and the store-product list is covered', async () => {
  const { deps } = fakeAccount({ products: rows('PR', 3), funnels: [homeFunnel()], elements: [storeEl('PR002')] });
  const res = await audit.handler(ARGS, deps);
  assert.deepEqual(danglingFor(res, 'storeProductId'), []);
  const c = coverageOf(res, 'dangling-references:storeProducts');
  assert.equal(c.ran, true);
  assert.equal(c.knownIds, 3);
});

test('a storeCollectionId has no measured list on the internal rail, so it is reported NOT CHECKED, never passed', async () => {
  const collectionEl = { type: 'element', meta: 'button', extra: { storeCollectionId: { value: 'COLL1', text: 'Shop' } } };
  const { deps } = fakeAccount({ products: rows('PR', 3), funnels: [homeFunnel()], elements: [collectionEl] });
  const res = await audit.handler(ARGS, deps);
  const hit = (res.data.findings ?? []).find((f) => f.prop === 'storeCollectionId');
  assert.ok(hit, 'the reference must surface, not vanish');
  assert.equal(hit.severity, 'unknown');
  assert.equal(hit.notChecked, true);
});

test('a product list that comes back full at 100 is NOT RUN (no measured paging for it, so a partial list would flag real products)', async () => {
  const { deps } = fakeAccount({ products: rows('PR', 100), funnels: [homeFunnel()], serverCap: 100, elements: [storeEl('PR001')] });
  const res = await audit.handler(ARGS, deps);
  const c = coverageOf(res, 'dangling-references:storeProducts');
  assert.equal(c.ran, false, JSON.stringify(c));
  assert.match(c.why, /100|full/);
  assert.deepEqual(danglingFor(res, 'storeProductId'), []);
});
