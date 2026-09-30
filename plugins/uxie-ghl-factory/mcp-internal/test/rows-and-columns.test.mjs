// compose: a section holds several rows, a column takes a background and a background image, and a key a column does not take is REFUSED
// (it was dropped silently: sweep #10, funnels.structure.column / structure.row).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1' };
const H = (t) => ({ meta: 'heading', extra: { text: { value: t } } });
const captured = [];
const deps = () => ({ state: {}, rereadOptions: { tries: 2, delays: [0, 0] }, makeGw: () => ({ uid: 'U', call: async (method, path, body) => {
  captured.push({ method, path, body });
  if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: { ok: true } };
  if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', meta: {} } };
  if (path.startsWith('/funnels/builder/page/data')) { const save = [...captured].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/')); return { ok: true, status: 200, json: { sections: (save?.body?.pageData?.sections ?? []).map((s) => ({ id: s.id })) } }; }
  if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
  throw new Error(`unexpected ${method} ${path}`);
} }) });
const compose = async (sections) => { captured.length = 0; const r = await tool.handler({ ...base, sections, confirm: true }, deps()); return { r, page: [...captured].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/'))?.body?.pageData }; };

test('rows: a section with three rows builds three row nodes, each with its own columns, in order', async () => {
  const { r, page } = await compose([{ rows: [{ columns: [{ elements: [H('a')] }] }, { columns: [{ elements: [H('b')] }, { elements: [H('c')] }] }, { columns: [{ elements: [H('d')] }] }] }]);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const sec = page.sections[0];
  const rows = sec.elements.filter((e) => e.type === 'row');
  assert.equal(rows.length, 3);
  assert.deepEqual(sec.metaData.child, rows.map((x) => x.id));
  assert.deepEqual(rows.map((x) => x.child.length), [1, 2, 1]);
  const byId = new Map(sec.elements.map((e) => [e.id, e]));
  assert.deepEqual(rows.map((x) => x.child.map((c) => byId.get(c).type)), [['col'], ['col', 'col'], ['col']]);
  assert.match(sec.general.sectionStyles, new RegExp(rows[2].id), 'the third row is compiled too');
});

test('columns: the one-row shape is unchanged (a single row node)', async () => {
  const { page } = await compose([{ columns: [{ widthPct: 50, elements: [H('a')] }, { widthPct: 50, elements: [H('b')] }] }]);
  assert.equal(page.sections[0].elements.filter((e) => e.type === 'row').length, 1);
});

test('a column takes background and bgImage; both land on the node and in the compiled sheet', async () => {
  const { r, page } = await compose([{ columns: [{ background: '#ff0000', elements: [H('a')] }] }]);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const col = page.sections[0].elements.find((e) => e.type === 'col');
  assert.deepEqual(col.styles.backgroundColor, { value: '#ff0000' });
  assert.match(page.sections[0].general.sectionStyles, /background-color:#ff0000|background-color:red|#f00/i);
  const img = await compose([{ columns: [{ bgImage: { url: 'https://example.com/x.jpg' }, elements: [H('a')] }] }]);
  const col2 = img.page.sections[0].elements.find((e) => e.type === 'col');
  assert.equal(col2.extra.bgImage.value.url, 'https://example.com/x.jpg');
});

test('an unknown column key is refused with the keys it takes; nothing is written', async () => {
  captured.length = 0;
  const r = await tool.handler({ ...base, sections: [{ columns: [{ elements: [H('a')], bg: '#fff', align: 'center' }] }], confirm: true }, deps());
  assert.equal(r.ok, false);
  assert.match(r.detail, /column: unknown key\(s\) `bg`, `align` — a column takes elements, widthPct, padX, background, bgImage/);
  assert.equal(captured.filter((c) => c.method !== 'GET').length, 0);
});

test('rows and columns together, a row with a stray key, and more than six columns in a row are refused', async () => {
  const one = { columns: [{ elements: [H('a')] }] };
  for (const [sections, re] of [
    [[{ columns: one.columns, rows: [one] }], /`columns` \(one row\) OR `rows`/],
    [[{ rows: [{ columns: one.columns, align: 'center' }] }], /row 0: unknown key\(s\) `align`/],
    [[{ columns: Array.from({ length: 7 }, () => ({ elements: [H('x')] })) }], /1 to 6 columns \(7 given\)/],
  ]) {
    captured.length = 0;
    const r = await tool.handler({ ...base, sections, confirm: true }, deps());
    assert.equal(r.ok, false);
    assert.match(r.detail, re);
    assert.equal(captured.filter((c) => c.method !== 'GET').length, 0);
  }
});

test('the width guard runs per row', async () => {
  captured.length = 0;
  const r = await tool.handler({ ...base, sections: [{ rows: [{ columns: [{ widthPct: 50, elements: [H('a')] }, { widthPct: 30, elements: [H('b')] }] }] }], confirm: true }, deps());
  assert.equal(r.ok, false);
  assert.match(r.detail, /sum to 80%/);
});
