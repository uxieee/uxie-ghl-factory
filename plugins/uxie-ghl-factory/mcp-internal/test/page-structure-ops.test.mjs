// build_funnel_page edit mode, the structure ops: insert at a position, move, clone, popup list. The semantics are the page
// builder's own (knowledge sniffs/funnels-wave34-f4c-recon-2026-09-30): a move permutes child[] only; a clone renames every id and
// carries the node's rules under the new ids; popupDisabled is one flag on the popup root; popupsList order is the priority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLeaf, makeColumn, makeSection, buildPageData, resetIds, val, leafStyleCss } from '../core/funnel-pages.mjs';
import { makePopup } from '../core/page-popup.mjs';
import { applyPageEdits, findNode, verifyEdits } from '../core/page-edit.mjs';
import { copyRulesUnderNewIds, stripRulesNaming, idRenamer, positionIn, movedIndex, randomId } from '../core/page-structure.mjs';

const rnd = () => { let s = 7; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };

const page = (nSections = 2) => {
  resetIds();
  const leaves = [];
  const sections = [];
  for (let k = 0; k < nSections; k++) {
    const h = makeLeaf({ meta: 'heading', extra: { text: val(`<h1>H${k}</h1>`) } });
    const p = makeLeaf({ meta: 'paragraph', extra: { text: val(`<p>P${k}</p>`) } });
    const b = makeLeaf({ meta: 'button', extra: { text: val(`B${k}`) } });
    const col = makeColumn({ children: [h, p, b], widthPct: 100 });
    const css = [h, p, b].map((l) => leafStyleCss(l.id, { color: val('#112233') })).join('');
    sections.push({ section: makeSection({ columns: [{ col, leaves: [h, p, b], widthPct: 100 }], elementCss: css, pageId: 'P', funnelId: 'F', locationId: 'L' }), h, p, b, col });
    leaves.push({ h, p, b, col });
  }
  const data = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: sections.map((x) => x.section) });
  return { data, parts: sections };
};
const children = (data, id) => findNode(data, id).node.child;
const noErr = (r) => assert.deepEqual(r.errors, [], JSON.stringify(r.errors));

test('insert: after a sibling, at an index, before a sibling — child[] and the element bag both change, the sheet gets the leaf\'s rules', () => {
  const { data, parts: [a] } = page(1);
  const mk = (t) => makeLeaf({ meta: 'paragraph', extra: { text: val(`<p>${t}</p>`) } });
  const n1 = mk('one'), n2 = mk('two'), n3 = mk('three');
  const r = applyPageEdits(data, [
    { op: 'insert', leaf: n1, css: `.x-${n1.id}{color:red}`, after: a.h.id },
    { op: 'insert', leaf: n2, parentId: a.col.id, index: 0 },
    { op: 'insert', leaf: n3, before: a.b.id },
  ]);
  noErr(r);
  assert.deepEqual(children(r.pageData, a.col.id), [n2.id, a.h.id, n1.id, a.p.id, n3.id, a.b.id]);
  const sec = r.pageData.sections[0];
  for (const n of [n1, n2, n3]) assert.ok(sec.elements.some((e) => e.id === n.id && e.element), 'wrapped with its canonical copy like a composed node');
  assert.match(sec.general.sectionStyles, new RegExp(`x-${n1.id}`));
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
  assert.deepEqual(children(data, a.col.id), [a.h.id, a.p.id, a.b.id], 'input not mutated');
});

test('insert refuses a target that is not a column, and an unknown sibling', () => {
  const { data, parts: [a] } = page(1);
  const n = makeLeaf({ meta: 'paragraph' });
  const r = applyPageEdits(data, [
    { op: 'insert', leaf: n, parentId: a.h.id }, { op: 'insert', leaf: n, after: 'nope' }, { op: 'insert', leaf: n }, { op: 'insert', leaf: n, parentId: a.col.id, index: 9 },
    { op: 'insert', leaf: n, parentId: a.col.id, index: 1, after: a.h.id },
  ]);
  assert.equal(r.errors.length, 5);
  assert.match(r.errors[0].error, /is a heading/);
});

test('move an element up / down / top / bottom / to an index; the flat element order does not move', () => {
  const { data, parts: [a] } = page(1);
  const flat = data.sections[0].elements.map((e) => e.id);
  const at = (ops) => { const r = applyPageEdits(data, ops); noErr(r); return r; };
  assert.deepEqual(children(at([{ op: 'move', nodeId: a.p.id, direction: 'up' }]).pageData, a.col.id), [a.p.id, a.h.id, a.b.id]);
  assert.deepEqual(children(at([{ op: 'move', nodeId: a.p.id, direction: 'down' }]).pageData, a.col.id), [a.h.id, a.b.id, a.p.id]);
  assert.deepEqual(children(at([{ op: 'move', nodeId: a.b.id, direction: 'top' }]).pageData, a.col.id), [a.b.id, a.h.id, a.p.id]);
  assert.deepEqual(children(at([{ op: 'move', nodeId: a.h.id, direction: 'bottom' }]).pageData, a.col.id), [a.p.id, a.b.id, a.h.id]);
  assert.deepEqual(children(at([{ op: 'move', nodeId: a.h.id, index: 1 }]).pageData, a.col.id), [a.p.id, a.h.id, a.b.id]);
  assert.deepEqual(children(at([{ op: 'move', nodeId: a.h.id, after: a.b.id }]).pageData, a.col.id), [a.p.id, a.b.id, a.h.id]);
  const r = at([{ op: 'move', nodeId: a.b.id, before: a.h.id }]);
  assert.deepEqual(r.pageData.sections[0].elements.map((e) => e.id), flat);
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
  const edge = applyPageEdits(data, [{ op: 'move', nodeId: a.h.id, direction: 'up' }]); noErr(edge);
  assert.deepEqual(children(edge.pageData, a.col.id), [a.h.id, a.p.id, a.b.id], 'up at the top stays');
});

test('move: a direction and a position together, an unknown sibling and a row across sections are refused', () => {
  const { data, parts: [a, b] } = page(2);
  const r = applyPageEdits(data, [
    { op: 'move', nodeId: a.p.id, direction: 'up', index: 0 }, { op: 'move', nodeId: a.p.id, after: 'nope' },
    { op: 'move', nodeId: a.h.id, parentId: b.col.id, index: 0 }, { op: 'move', nodeId: 'nope', direction: 'up' },
  ]);
  assert.equal(r.errors.length, 4);
});

test('move an element into another column of its section', () => {
  resetIds();
  const x = makeLeaf({ meta: 'heading' }), y = makeLeaf({ meta: 'paragraph' });
  const c1 = makeColumn({ children: [x], widthPct: 50 }), c2 = makeColumn({ children: [y], widthPct: 50 });
  const sec = makeSection({ columns: [{ col: c1, leaves: [x], widthPct: 50 }, { col: c2, leaves: [y], widthPct: 50 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  const data = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [sec] });
  const r = applyPageEdits(data, [{ op: 'move', nodeId: x.id, parentId: c2.id, after: y.id }]); noErr(r);
  assert.deepEqual(children(r.pageData, c1.id), []);
  assert.deepEqual(children(r.pageData, c2.id), [y.id, x.id]);
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
  const bad = applyPageEdits(data, [{ op: 'move', nodeId: x.id, parentId: c2.id, direction: 'down' }, { op: 'move', nodeId: c1.id, parentId: c2.id, index: 0 }]);
  assert.equal(bad.errors.length, 2);
});

test('move a section: the sections array and every sequence follow', () => {
  const { data, parts } = page(3);
  const ids = parts.map((x) => x.section.id);
  const r = applyPageEdits(data, [{ op: 'move', nodeId: ids[0], direction: 'down' }]); noErr(r);
  assert.deepEqual(r.pageData.sections.map((s) => s.id), [ids[1], ids[0], ids[2]]);
  assert.deepEqual(r.pageData.sections.map((s) => s.sequence), [0, 1, 2]);
  const r2 = applyPageEdits(data, [{ op: 'move', nodeId: ids[2], index: 0 }]); noErr(r2);
  assert.deepEqual(r2.pageData.sections.map((s) => s.id), [ids[2], ids[0], ids[1]]);
  assert.ok(verifyEdits(r2.pageData, r2.report).every((v) => v.applied));
});

test('append-section at a position renumbers; without one it still appends', () => {
  const { data, parts: [a, b] } = page(2);
  const { data: other } = page(1);
  const s = { ...other.sections[0], id: 'section-NEW' };
  const at = applyPageEdits(data, [{ op: 'append-section', section: s, after: a.section.id }]); noErr(at);
  assert.deepEqual(at.pageData.sections.map((x) => x.id), [a.section.id, 'section-NEW', b.section.id]);
  assert.deepEqual(at.pageData.sections.map((x) => x.sequence), [0, 1, 2]);
  assert.ok(verifyEdits(at.pageData, at.report).every((v) => v.applied !== false));
  const end = applyPageEdits(data, [{ op: 'append-section', section: s }]); noErr(end);
  assert.equal(end.pageData.sections.at(-1).id, 'section-NEW');
  assert.equal(applyPageEdits(data, [{ op: 'append-section', section: s, index: 1, after: a.section.id }]).errors.length, 1);
});

test('clone an element: right after the original, new id, extra.nodeId = c + id, no element copy, rules copied, original untouched', () => {
  const { data, parts: [a] } = page(1);
  const before = JSON.stringify(findNode(data, a.p.id).node);
  const r = applyPageEdits(data, [{ op: 'clone', nodeId: a.p.id, rnd: rnd() }]); noErr(r);
  const cid = r.report[0].cloneId;
  assert.match(cid, /^paragraph-[A-Za-z0-9]{10}$/);
  assert.deepEqual(children(r.pageData, a.col.id), [a.h.id, a.p.id, cid, a.b.id]);
  const copy = findNode(r.pageData, cid).node;
  const want = JSON.parse(JSON.stringify(findNode(data, a.p.id).node).split(a.p.id).join(cid)); delete want.element; delete want.updated;
  assert.deepEqual(copy, want, 'identical but for the id (and the c<id> in extra.nodeId), with no element copy');
  assert.equal(JSON.stringify(findNode(r.pageData, a.p.id).node), before, 'the original is untouched');
  const css = r.pageData.sections[0].general.sectionStyles;
  assert.match(css, new RegExp(`\\.${cid}\\{[^}]*color:#112233`));
  assert.ok(!copyRulesUnderNewIds(css, new Map([[cid, 'x']])).includes(a.p.id), 'the copied rule names only the new id');
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
});

test('clone a section: every id new, its own sheet with no original ids, inserted after, sequence renumbered', () => {
  const { data, parts } = page(3);
  const [s0] = parts;
  const r = applyPageEdits(data, [{ op: 'clone', nodeId: s0.section.id, rnd: rnd() }]); noErr(r);
  const secs = r.pageData.sections;
  assert.equal(secs.length, 4);
  assert.deepEqual(secs.map((s) => s.sequence), [0, 1, 2, 3]);
  const copy = secs[1];
  assert.equal(copy.id, r.report[0].cloneId);
  const oldIds = [s0.section.id, ...s0.section.elements.map((e) => e.id)];
  const ids = new Set([copy.id, ...copy.elements.map((e) => e.id)]);
  assert.equal(ids.size, oldIds.length);
  for (const id of oldIds) { assert.ok(!ids.has(id)); assert.ok(!copy.general.sectionStyles.includes(id), `sheet still names ${id}`); assert.ok(!JSON.stringify(copy).includes(id), `copy still names ${id}`); }
  assert.equal(copy.metaData.id, copy.id);
  assert.equal(copy.metaData._id, undefined);
  assert.deepEqual(copy.metaData.styles.background, { value: 'none' }, 'the builder\'s own section clone carries background none');
  assert.equal(secs[0].metaData.styles.background, undefined, 'the original is untouched');
  assert.deepEqual(copy.elements.map((e) => e.meta), s0.section.elements.map((e) => e.meta), 'same tree');
  assert.match(copy.general.sectionStyles, /color:#112233/);
  assert.equal(secs[0].general.sectionStyles, s0.section.general.sectionStyles, 'the original sheet is untouched');
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
});

test('clone a column clones its leaves; a row too; ids never collide with the page\'s', () => {
  const { data, parts: [a] } = page(1);
  const r = applyPageEdits(data, [{ op: 'clone', nodeId: a.col.id, rnd: rnd() }, { op: 'clone', nodeId: a.h.id, rnd: rnd() }]); noErr(r);
  const all = r.pageData.sections[0].elements.map((e) => e.id);
  assert.equal(new Set(all).size, all.length);
  assert.equal(r.report[0].nodes, 4);
});

// ---- the stylesheet copy ----
test('copyRulesUnderNewIds: merged selector lists, @media, quotes, and longer ids sharing a prefix', () => {
  const css = '.a .row-S0D{margin:0}.row-S0D1,.col-S0D{padding:1px}@media (max-width:600px){.row-S0D{display:none}.x{color:red}}.other{content:"row-S0D"}#heading-S0C08,#paragraph-S0C09{margin:0}.cparagraph-S0C09{font-weight:medium}';
  const m = new Map([['row-S0D', 'row-NEW'], ['paragraph-S0C09', 'paragraph-NEW']]);
  assert.equal(copyRulesUnderNewIds(css, m),
    '.a .row-NEW{margin:0}@media (max-width:600px){.row-NEW{display:none}}#paragraph-NEW{margin:0}.cparagraph-NEW{font-weight:medium}');
  assert.equal(copyRulesUnderNewIds('.x{color:red}', m), '');
});

test('a sheet with the builder\'s own malformed text-kind rule (an unbalanced quote) is still walked to the end', () => {
  const css = ".t h1:first-child:before{content:'\\'; font-family: '';font-weight:700}.a #p-1{color:red}#p-1.popup-body{width:1px}@media (max-width:5px){#p-1.popup-body{width:2px}}.keep{a:b}";
  assert.equal(stripRulesNaming(css, ['p-1']), ".t h1:first-child:before{content:'\\'; font-family: '';font-weight:700}.keep{a:b}");
  assert.equal(copyRulesUnderNewIds(css, new Map([['p-1', 'p-2']])), '.a #p-2{color:red}#p-2.popup-body{width:1px}@media (max-width:5px){#p-2.popup-body{width:2px}}');
});

test('idRenamer renames whole tokens only, with the builder\'s c-prefixed class', () => {
  const rn = idRenamer(new Map([['button-A1', 'button-Z9']]));
  assert.equal(rn('#button-A1 .cbutton-A1 .button-A1 button-A12 xbutton-A1'), '#button-Z9 .cbutton-Z9 .button-Z9 button-A12 xbutton-A1');
});

test('stripRulesNaming: whole rules go, a merged list loses only the named selectors, the rest stays byte for byte', () => {
  const css = ':root{--a:1}#p-1{color:red}#p-1,#q{margin:0}@media (max-width:5px){#p-1{x:y}}.keep{a:b}';
  assert.equal(stripRulesNaming(css, ['p-1']), ':root{--a:1}#q{margin:0}.keep{a:b}');
});

test('positionIn / movedIndex / randomId', () => {
  assert.equal(positionIn(['a', 'b'], {}), 2);
  assert.equal(positionIn(['a', 'b'], { after: 'a' }), 1);
  assert.throws(() => positionIn(['a'], { index: 3 }), /outside 0..1/);
  assert.equal(movedIndex(['a', 'b', 'c'], 0, { direction: 'down' }), 1);
  const taken = new Set(); const id = randomId('heading', taken, rnd()); assert.match(id, /^heading-[A-Za-z0-9]{10}$/); assert.ok(taken.has(id));
});

// ---- popups ----
const withPopups = () => {
  const { data } = page(1);
  const leafFor = (e) => ({ leaf: makeLeaf({ meta: e.meta ?? 'paragraph', extra: e.extra }), css: '' });
  const one = makePopup({ name: 'One', columns: [{ elements: [{ meta: 'paragraph' }] }] }, 0, leafFor, 'PA');
  const two = makePopup({ name: 'Two', showOn: { delay: 3 }, columns: [{ elements: [{ meta: 'paragraph' }] }] }, 1, leafFor, 'PB');
  return { data: { ...data, popupsList: [one.entry, two.entry], pageStyles: `${data.pageStyles ?? ''}${one.css}${two.css}` }, one, two };
};

test('set-popup: disabled and closeOnOutsideClick and showOn land on the popup root, by name or by id', () => {
  const { data, one, two } = withPopups();
  assert.equal(findNode(data, one.entry.id), null, 'popups are not in the section walk');
  const r = applyPageEdits(data, [{ op: 'set-popup', popupId: 'One', disabled: true }, { op: 'set-popup', popupId: two.entry.id, closeOnOutsideClick: false, showOn: 'exit' }]); noErr(r);
  const root = (id) => r.pageData.popupsList.find((p) => p.id === id).elements.find((e) => e.id === id);
  assert.equal(root(one.entry.id).extra.popupDisabled.value, true);
  assert.equal(root(two.entry.id).extra.popupDisabled.value, false);
  assert.equal(root(two.entry.id).extra.popupHide.value, false);
  assert.deepEqual(root(two.entry.id).extra.showPopupOnMouseOut, { value: 'exit', delay: 1 });
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
  assert.equal(applyPageEdits(data, [{ op: 'set-popup', popupId: 'Nope', disabled: true }, { op: 'set-popup', popupId: 'One' }, { op: 'set-popup', popupId: 'One', showOn: 'later' }]).errors.length, 3);
});

test('makePopup honours disabled', () => {
  const leafFor = () => ({ leaf: makeLeaf({ meta: 'paragraph' }), css: '' });
  const p = makePopup({ name: 'D', disabled: true, columns: [{ elements: [{ meta: 'paragraph' }] }] }, 0, leafFor);
  assert.equal(p.entry.elements.find((e) => e.id === p.entry.id).extra.popupDisabled.value, true);
});

test('order-popups sets the priority order; unlisted popups follow; unknown and duplicate names are refused', () => {
  const { data, one, two } = withPopups();
  const r = applyPageEdits(data, [{ op: 'order-popups', order: ['Two'] }]); noErr(r);
  assert.deepEqual(r.pageData.popupsList.map((p) => p.id), [two.entry.id, one.entry.id]);
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
  assert.equal(applyPageEdits(data, [{ op: 'order-popups', order: ['Nope'] }, { op: 'order-popups', order: ['One', 'One'] }, { op: 'order-popups', order: [] }]).errors.length, 3);
});

test('remove-popup drops the popup and its page-level rules, refuses while a button opens it', () => {
  const { data, one, two } = withPopups();
  const r = applyPageEdits(data, [{ op: 'remove-popup', popupId: 'One' }]); noErr(r);
  assert.deepEqual(r.pageData.popupsList.map((p) => p.id), [two.entry.id]);
  for (const e of one.entry.elements) assert.ok(!r.pageData.pageStyles.includes(e.id), `pageStyles still names ${e.id}`);
  assert.ok(r.pageData.pageStyles.includes(two.entry.id), 'the other popup\'s rules stay');
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied));
  const withBtn = structuredClone(data);
  withBtn.sections[0].elements.find((e) => e.meta === 'button').extra.popupId = { value: one.entry.id };
  const bad = applyPageEdits(withBtn, [{ op: 'remove-popup', popupId: one.entry.id }]);
  assert.equal(bad.errors.length, 1); assert.match(bad.errors[0].error, /open this popup/);
});

test('a set on a node inside a popup says where popup content is edited', () => {
  const { data, one } = withPopups();
  const inner = one.entry.elements.find((e) => e.id !== one.entry.id && e.type !== 'row');
  const r = applyPageEdits(data, [{ op: 'set', nodeId: inner.id, extra: {} }]);
  assert.match(r.errors[0].error, /inside a popup/);
});

// ---- through the tool: compose a page, then edit it with the structure ops; the write is verified by value on a separate read ----
import { TOOLS } from '../core/tools.mjs';
const tool = TOOLS.find((t) => t.name === 'build_funnel_page');

test('the tool composes insert / move / clone / popup ops, writes them once, and verifies each on the read-back', async () => {
  const STEPS = [{ id: 'S1', name: 'Landing', type: 'landing', pages: ['P1'] }];
  const calls = [];
  let stored = null;
  const gw = { uid: 'U1', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: STEPS } };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', locationId: 'LOC', funnelId: 'F1', meta: { title: 'T', language: 'en' } } };
    if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: stored };
    if (path.startsWith('/funnels/builder/autosave/')) { stored = structuredClone(body.pageData); return { ok: true, status: 201, json: {} }; }
    if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
    throw new Error(`unexpected call ${method} ${path}`);
  } };
  const deps = { state: {}, makeGw: () => gw };
  const run = (args) => tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', ...args }, deps);
  const compose = await run({
    sections: [{ columns: [{ elements: [{ meta: 'heading', html: 'H' }, { meta: 'paragraph', html: 'P' }] }] }, { columns: [{ elements: [{ meta: 'paragraph', html: 'Z' }] }] }],
    popups: [{ name: 'One', columns: [{ elements: [{ meta: 'paragraph', html: 'a' }] }] }, { name: 'Two', columns: [{ elements: [{ meta: 'paragraph', html: 'b' }] }] }],
    confirm: true,
  });
  assert.equal(compose.ok, true, JSON.stringify(compose).slice(0, 500));
  const [s0, s1] = stored.sections;
  const col = s0.elements.find((e) => e.meta === 'col');
  const [h, p] = col.child;
  const edits = [
    { op: 'insert', after: h, element: { meta: 'paragraph', html: 'inserted', styles: { color: '#ff0000' } } },
    { op: 'move', nodeId: p, direction: 'up' },
    { op: 'clone', nodeId: h },
    { op: 'move', nodeId: s1.id, index: 0 },
    { op: 'set-popup', popupId: 'One', disabled: true },
    { op: 'order-popups', order: ['Two', 'One'] },
  ];
  const pre = await run({ stepName: 'Landing', edits });
  assert.equal(pre.code, 'CONFIRM_REQUIRED', JSON.stringify(pre).slice(0, 400));
  assert.deepEqual(pre.data.preview.ops.map((o) => o.op), edits.map((e) => e.op));
  const res = await run({ stepName: 'Landing', edits, confirm: true });
  assert.equal(res.ok, true, JSON.stringify(res.data?.readBack ?? res).slice(0, 1800));
  assert.ok(JSON.stringify(res.data.verification ?? res.data.checks ?? res.data).length > 0);
  const now = stored;
  assert.deepEqual(now.sections.map((s) => s.sequence), [0, 1]);
  assert.equal(now.sections[0].id, s1.id, 'the second section moved to the front');
  const col2 = now.sections[1].elements.find((e) => e.meta === 'col');
  assert.equal(col2.child.length, 4, 'heading, its clone, the paragraph and the inserted paragraph');
  const ins = now.sections[1].elements.find((e) => e.extra?.text?.value?.includes?.('inserted') || JSON.stringify(e.extra).includes('inserted'));
  assert.ok(ins && col2.child.includes(ins.id));
  assert.match(now.sections[1].general.sectionStyles, new RegExp(`${ins.id}[^}]*color:#ff0000`));
  assert.deepEqual(now.popupsList.map((q) => q.elements.find((e) => e.id === q.id).title), ['Two', 'One']);
  assert.equal(now.popupsList[1].elements.find((e) => e.id === now.popupsList[1].id).extra.popupDisabled.value, true);
  // one write only
  assert.equal(calls.filter((c) => c.path.startsWith('/funnels/builder/autosave/')).length, 2, 'compose + the edit');
});

test('verifyEdits: an earlier section move still verifies after a LATER op that changes the section order', () => {
  const { data, parts } = page(3);
  const ids = parts.map((x) => x.section.id);
  const r = applyPageEdits(data, [{ op: 'move', nodeId: ids[2], index: 0 }, { op: 'clone', nodeId: ids[1], rnd: rnd() }]); noErr(r);
  assert.ok(verifyEdits(r.pageData, r.report).every((v) => v.applied), JSON.stringify(verifyEdits(r.pageData, r.report)));
  const wrong = structuredClone(r.pageData); wrong.sections.reverse();
  assert.ok(!verifyEdits(wrong, r.report).every((v) => v.applied), 'a stored order that differs from the last op is caught');
});
