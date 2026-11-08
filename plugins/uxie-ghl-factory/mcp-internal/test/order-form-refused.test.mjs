// w7-6 (orchestrator DECISION): order-form is REFUSED in the composer. Its GHL-built props are not captured, and alone it breaks the
// public render (origin 500, bisect step 2, knowledge sniffs/funnels-w7-2026-11-06/bisect-log.md). The refusal carries a code and a
// remediation. The two order kinds that render are not refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusedKindProblems, makeLeaf } from '../core/funnel-pages.mjs';

// fn-3 (2026-11-08): the refusal now covers the OLD composer shape only (empty steps, productOrder, bumps, orderFormTheme and
// showOrderBump). A GHL-shaped order-form is composed and not refused; these fixtures are the old shape, so they test the refusal.
const oldOrderForm = () => {
  const n = makeLeaf({ meta: 'order-form' });
  n.extra.steps = { value: '' }; n.extra.productOrder = { value: '' }; n.extra.bumps = { value: '' };
  n.extra.orderFormTheme = { value: '' }; n.extra.showOrderBump = { value: '' };
  return n;
};
const page = (metas) => ({ sections: [{ elements: metas.map((m) => (m === 'order-form' ? oldOrderForm() : { type: 'element', meta: m })) }] });

test('an OLD-shape order-form is refused, with the reason and the remediation', () => {
  const p = refusedKindProblems(page(['heading', 'order-form']));
  assert.equal(p.length, 1);
  assert.match(p[0].message, /order-form/);
  assert.match(p[0].message, /old composer shape/);
  assert.match(p[0].remediation, /build_funnel_page/);
});

test('the two order kinds that render, and the other new kinds, are not refused', () => {
  assert.deepEqual(refusedKindProblems(page(['one-step-order', 'two-setp-order', 'quiz', 'rentals', 'services', 'heading'])), []);
});

test('a page with no order-form is not refused, and nothing is refused for an empty page', () => {
  assert.deepEqual(refusedKindProblems(page([])), []);
  assert.deepEqual(refusedKindProblems({}), []);
});

test('a GHL-shaped order-form (what makeLeaf composes now) is NOT refused on the composer path', () => {
  assert.deepEqual(refusedKindProblems({ sections: [{ elements: [makeLeaf({ meta: 'order-form' })] }] }), []);
});

test('makeLeaf still builds an order-form node: only the old shape is refused, never the composed one', () => {
  assert.equal(makeLeaf({ meta: 'order-form' }).meta, 'order-form');
});

// w7-6 (orchestrator DECISION, 2026-11-07): order-form is refused on EVERY path that can ADD an order-form node: the composer (above),
// and the page-edit ops insert, append-section and clone. A stored order-form node that an unrelated edit leaves alone gets a WARN,
// not a refusal (the same pattern as the empty Loop).
import { applyPageEdits } from '../core/page-edit.mjs';
import { makeColumn, makeSection, buildPageData, resetIds, val } from '../core/funnel-pages.mjs';

const PAGE_ORDER = 'order-form';
const fixtureWithOrderForm = () => {
  resetIds();
  const p = makeLeaf({ meta: 'paragraph', extra: { text: val('<p>Hi</p>') } });
  const of = oldOrderForm();
  const col = makeColumn({ children: [p, of], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [p, of], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  return { p, of, col, section, data: buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section] }) };
};

test('insert of an order-form node is refused: the report carries the refusal and the page gets no new node', () => {
  const { col, data } = fixtureWithOrderForm();
  const before = JSON.stringify(data);
  const leaf = oldOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'insert', parentId: col.id, leaf }]);
  const err = report.find((r) => r.error);
  assert.ok(err, 'an insert of order-form must be refused');
  assert.match(err.error, /order-form/);
  assert.match(err.error, /old composer shape/);
  assert.equal(JSON.stringify(data), before, 'the refused insert writes nothing');
});

test('insert of a quiz is not refused (the other new kinds stay composable)', () => {
  const { col, data } = fixtureWithOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'insert', parentId: col.id, leaf: makeLeaf({ meta: 'quiz', extra: { quizId: val('x') } }) }]);
  assert.equal(report.filter((r) => r.error).length, 0);
});

test('append-section carrying an order-form node is refused', () => {
  const { section, data } = fixtureWithOrderForm();
  resetIds();
  const p2 = makeLeaf({ meta: 'paragraph', extra: { text: val('<p>x</p>') } });
  const of2 = oldOrderForm();
  const col2 = makeColumn({ children: [p2, of2], widthPct: 100 });
  const newSection = makeSection({ columns: [{ col: col2, leaves: [p2, of2], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  const { report } = applyPageEdits(data, [{ op: 'append-section', section: newSection }]);
  assert.ok(report.some((r) => r.error && /order-form/.test(r.error)), 'append-section with an order-form must be refused');
  void section;
});

test('clone of a stored order-form node is refused (it would add an order-form)', () => {
  const { of, data } = fixtureWithOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'clone', nodeId: of.id }]);
  assert.ok(report.some((r) => r.error && /order-form/.test(r.error)), 'clone of an order-form must be refused');
});

test('an unrelated edit to a stored order-form node is NOT refused: it gets a warning', () => {
  const { of, data } = fixtureWithOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'set', nodeId: of.id, extra: { customClass: 'probe-class' } }]);
  assert.equal(report.filter((r) => r.error).length, 0, 'the edit must not be refused');
  assert.ok(report.some((r) => r.warn && /order-form/.test(r.warn)), 'a warning names the stored order-form');
});

// w7-6 (orchestrator DECISION 2026-11-07): the server-side copies in edit_funnel (clone-step, import-page) read their source pages
// first and refuse when a page holds an order-form (the copy would bring the node in). Driven through the tool with a fake gateway.
import { TOOLS } from '../core/tools.mjs';
const editFunnel = TOOLS.find((t) => t.name === 'edit_funnel');
const pageWithOrderForm = () => { resetIds(); const of = oldOrderForm(); const col = makeColumn({ children: [of], widthPct: 100 }); const sec = makeSection({ columns: [{ col, leaves: [of], widthPct: 100 }], pageId: 'PSRC', funnelId: 'F1', locationId: 'LOC' }); return buildPageData({ pageId: 'PSRC', stepId: 'S1', funnelId: 'F1', locationId: 'LOC', sections: [sec] }); };
const pageWithQuiz = () => { resetIds(); const q = makeLeaf({ meta: 'quiz', extra: { quizId: val('x') } }); const col = makeColumn({ children: [q], widthPct: 100 }); const sec = makeSection({ columns: [{ col, leaves: [q], widthPct: 100 }], pageId: 'PQ', funnelId: 'F1', locationId: 'LOC' }); return buildPageData({ pageId: 'PQ', stepId: 'S1', funnelId: 'F1', locationId: 'LOC', sections: [sec] }); };
const funnelWith = (pageId) => ({ _id: 'F1', id: 'F1', name: 'F', steps: [{ id: 'S1', name: 'S', url: 'compose-probe', type: 'misc_funnel_page', pages: [pageId], split: false }], domainId: 'D', funnelPath: '/f' });
const fakeDeps = (pages, srcPageId = 'PSRC') => ({ state: {}, makeGw: () => ({ uid: 'U1', call: async (method, path) => {
  if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: funnelWith(srcPageId) };
  if (path.startsWith('/funnels/page/list')) return { ok: true, status: 200, json: [] };
  if (path.startsWith('/funnels/builder/page/data')) { const id = new URL('http://x' + path).searchParams.get('pageId'); return pages[id] ? { ok: true, status: 200, json: pages[id] } : { ok: false, status: 404, json: {} }; }
  throw new Error('unexpected ' + path);
} }) });

test('edit_funnel clone-step is refused when the source step holds an order-form page (the copy would add it)', async () => {
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-step', stepId: 'S1', confirm: true }, fakeDeps({ PSRC: pageWithOrderForm() }));
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /order-form/);
  assert.match(JSON.stringify(res), /old composer shape/);
});

test('edit_funnel clone-step is NOT refused when the source step holds only a quiz (quiz stays copyable)', async () => {
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-step', stepId: 'S1', confirm: false }, fakeDeps({ PQ: pageWithQuiz() }));
  assert.doesNotMatch(JSON.stringify(res), /would copy an order-form/);
});

test('edit_funnel clone-step fails closed when a source page cannot be read', async () => {
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-step', stepId: 'S1', confirm: true }, fakeDeps({}, 'PMISSING'));
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /could not be read/);
});

// ── QA w7-6 issues 1–4 (RED first) ──────────────────────────────────────────────────────────────────────────────────────────────
// (1) a clone of a COLUMN, ROW or SECTION that holds an order-form is refused (the whole subtree is walked, not just the node).
const rowIdOf = (section) => section.elements.find((e) => e.meta === 'row').id;
test('clone of a COLUMN holding an order-form is refused', () => {
  const { col, data } = fixtureWithOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'clone', nodeId: col.id }]);
  assert.ok(report.some((r) => r.error && /order-form/.test(r.error)), 'a column clone copies the order-form and must be refused');
});
test('clone of a ROW holding an order-form is refused', () => {
  const { section, data } = fixtureWithOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'clone', nodeId: rowIdOf(section) }]);
  assert.ok(report.some((r) => r.error && /order-form/.test(r.error)), 'a row clone copies the order-form and must be refused');
});
test('clone of a SECTION holding an order-form is refused', () => {
  const { section, data } = fixtureWithOrderForm();
  const { report } = applyPageEdits(data, [{ op: 'clone', nodeId: section.id }]);
  assert.ok(report.some((r) => r.error && /order-form/.test(r.error)), 'a section clone copies the order-form and must be refused');
});
test('clone of a column with only a quiz is NOT refused', () => {
  const { data } = pageWithQuiz2();
  const colId = data.sections[0].elements.find((e) => e.meta === 'col').id;
  const { report } = applyPageEdits(data, [{ op: 'clone', nodeId: colId }]);
  assert.equal(report.filter((r) => r.error).length, 0);
});
function pageWithQuiz2() { resetIds(); const q = makeLeaf({ meta: 'quiz', extra: { quizId: val('x') } }); const col = makeColumn({ children: [q], widthPct: 100 }); const sec = makeSection({ columns: [{ col, leaves: [q], widthPct: 100 }], pageId: 'PQ', funnelId: 'F1', locationId: 'LOC' }); return { data: buildPageData({ pageId: 'PQ', stepId: 'S1', funnelId: 'F1', locationId: 'LOC', sections: [sec] }) }; }

// (2) POPUPS: an order-form inside a popup is refused in the shared check (compose popups[]) and in append-popup.
test('refusedKindProblems walks popupsList: an order-form in a popup is refused', () => {
  const of = oldOrderForm();
  const p = refusedKindProblems({ sections: [], popupsList: [{ id: 'pp', elements: [of] }] });
  assert.equal(p.length, 1);
  assert.match(p[0].message, /order-form/);
});
test('append-popup carrying an order-form is refused (nothing is added)', () => {
  const { data } = fixtureWithOrderForm();
  const of = oldOrderForm();
  const { report, pageData } = applyPageEdits(data, [{ op: 'append-popup', popup: { name: 'pp', css: '', entry: { id: 'pp', name: 'pp', elements: [of] } } }]);
  assert.ok(report.some((r) => r.error && /order-form/.test(r.error)), 'append-popup with an order-form must be refused');
  assert.equal((pageData.popupsList ?? []).length, 0, 'the refused popup is not added');
});
test('append-popup with a quiz is NOT refused', () => {
  const { data } = fixtureWithOrderForm();
  const q = makeLeaf({ meta: 'quiz', extra: { quizId: val('x') } });
  const { report } = applyPageEdits(data, [{ op: 'append-popup', popup: { name: 'pp', css: '', entry: { id: 'pp', name: 'pp', elements: [q] } } }]);
  assert.equal(report.filter((r) => r.error).length, 0);
});

// (3) the quiz clone-step control must SERVE its page, so it proves quiz is allowed (a preview), not that the read failed.
test('edit_funnel clone-step with a served QUIZ page is allowed: the preview is returned, not a refusal', async () => {
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-step', stepId: 'S1', confirm: false }, fakeDeps({ PQ: pageWithQuiz() }, 'PQ'));
  assert.equal(res.code, 'CONFIRM_REQUIRED', JSON.stringify(res).slice(0, 200));
  assert.doesNotMatch(JSON.stringify(res), /could not be read|would copy/);
});

// (4) clone-funnel and import-page: the refusals, through the handler, with a fake gateway that answers every call they make.
const gwFor = ({ funnels = {}, pages = {}, lists = {}, listFail = false }) => ({ uid: 'U1', call: async (method, path) => {
  if (path.startsWith('/funnels/funnel/fetch/')) { const id = decodeURIComponent(path.split('/').pop().split('?')[0]); return funnels[id] ? { ok: true, status: 200, json: funnels[id] } : { ok: false, status: 404, json: {} }; }
  if (path.startsWith('/funnels/funnel/list')) return { ok: true, status: 200, json: { funnels: [] } };
  if (path.startsWith('/funnels/page/list')) { if (listFail) return { ok: false, status: 500, json: {} }; const id = new URL('http://x' + path).searchParams.get('funnelId'); return { ok: true, status: 200, json: lists[id] ?? [] }; }
  if (path.startsWith('/funnels/builder/page/data')) { const id = new URL('http://x' + path).searchParams.get('pageId'); return pages[id] ? { ok: true, status: 200, json: pages[id] } : { ok: false, status: 404, json: {} }; }
  throw new Error('unexpected ' + path);
} });
const SRC_FUNNEL = { _id: 'F1', id: 'F1', name: 'F1', domainId: 'D', steps: [{ id: 'S1', name: 'S1', url: 'a', type: 'misc_funnel_page', pages: ['PSRC'], split: false }] };
test('edit_funnel clone-funnel is refused when the source funnel holds an order-form page', async () => {
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: SRC_FUNNEL }, lists: { F1: [{ _id: 'PSRC' }] }, pages: { PSRC: pageWithOrderForm() } }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-funnel', name: 'Copy of F1', confirm: true }, deps);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /would copy an order-form/);
  assert.match(JSON.stringify(res), /old composer shape/);
});
test('edit_funnel clone-funnel is allowed when the source funnel holds only a quiz (preview returned)', async () => {
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: SRC_FUNNEL }, lists: { F1: [{ _id: 'PQ' }] }, pages: { PQ: pageWithQuiz() } }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-funnel', name: 'Copy of F1', confirm: false }, deps);
  assert.equal(res.code, 'CONFIRM_REQUIRED', JSON.stringify(res).slice(0, 200));
});
test('edit_funnel import-page is refused when the source page holds an order-form', async () => {
  const TARGET = { _id: 'F1', id: 'F1', name: 'F1', domainId: 'D', steps: [{ id: 'S1', name: 'S1', url: 'a', type: 'misc_funnel_page', pages: ['PT'], split: false }] };
  const SRC = { _id: 'F2', id: 'F2', name: 'F2', domainId: 'D', steps: [{ id: 'SRC', name: 'SRC', url: 'b', type: 'misc_funnel_page', pages: ['PSRC'], split: false }] };
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: TARGET, F2: SRC }, pages: { PSRC: pageWithOrderForm() } }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'import-page', stepId: 'S1', sourceFunnelId: 'F2', sourceStepId: 'SRC', sourcePageIndex: 0, confirm: true }, deps);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /would copy an order-form|importing this page/);
});

// Orchestrator DECISION (round 3): a refused COPY names the page that blocks it: its id, its title, and "(archived)" when it is.
test('clone-funnel refusal names an ARCHIVED blocking page: its id, its title and (archived)', async () => {
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: SRC_FUNNEL }, lists: { F1: [{ _id: 'PSRC', name: 'Checkout v1', deleted: true }] }, pages: { PSRC: pageWithOrderForm() } }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-funnel', name: 'Copy of F1', confirm: true }, deps);
  const text = JSON.stringify(res);
  assert.equal(res.ok, false);
  assert.match(text, /PSRC/);
  assert.match(text, /Checkout v1/);
  assert.match(text, /\(archived\)/);
});
test('clone-funnel refusal names a LIVE blocking page by id and title, without (archived)', async () => {
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: SRC_FUNNEL }, lists: { F1: [{ _id: 'PSRC', name: 'Checkout v2', deleted: false }] }, pages: { PSRC: pageWithOrderForm() } }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-funnel', name: 'Copy of F1', confirm: true }, deps);
  const text = JSON.stringify(res);
  assert.equal(res.ok, false);
  assert.match(text, /PSRC/);
  assert.match(text, /Checkout v2/);
  assert.doesNotMatch(text, /\(archived\)/);
});

// FAIL-CLOSED branches (QA round 4): a copy whose source cannot be read or listed is refused, never allowed. These pass on arrival (the
// branches already exist); each one is shown to bite by disabling its branch in turn (the test then fails).
test('edit_funnel clone-funnel is refused when the source page list cannot be read (fail closed)', async () => {
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: SRC_FUNNEL }, listFail: true }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-funnel', name: 'Copy of F1', confirm: true }, deps);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /could not be listed/);
});
test('edit_funnel clone-funnel is refused when a listed page cannot be read (fail closed)', async () => {
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: SRC_FUNNEL }, lists: { F1: [{ _id: 'PMISSING', name: 'Gone', deleted: false }] }, pages: {} }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'clone-funnel', name: 'Copy of F1', confirm: true }, deps);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /PMISSING/);
  assert.match(JSON.stringify(res), /could not be read/);
});
test('edit_funnel import-page is refused when the source page cannot be read (fail closed)', async () => {
  const TARGET = { _id: 'F1', id: 'F1', name: 'F1', domainId: 'D', steps: [{ id: 'S1', name: 'S1', url: 'a', type: 'misc_funnel_page', pages: ['PT'], split: false }] };
  const SRC = { _id: 'F2', id: 'F2', name: 'F2', domainId: 'D', steps: [{ id: 'SRC', name: 'SRC', url: 'b', type: 'misc_funnel_page', pages: ['PMISSING'], split: false }] };
  const deps = { state: {}, makeGw: () => gwFor({ funnels: { F1: TARGET, F2: SRC }, pages: {} }) };
  const res = await editFunnel.handler({ locationId: 'LOC', funnelId: 'F1', op: 'import-page', stepId: 'S1', sourceFunnelId: 'F2', sourceStepId: 'SRC', sourcePageIndex: 0, confirm: true }, deps);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /could not be read/);
});
