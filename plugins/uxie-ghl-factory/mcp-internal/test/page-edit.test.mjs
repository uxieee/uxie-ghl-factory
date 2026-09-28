// build_funnel_page edit mode: changes land on the named node only, in BOTH stylesheets the page has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLeaf, makeColumn, makeSection, buildPageData, resetIds, val, leafStyleCss } from '../core/funnel-pages.mjs';
import { applyPageEdits, findNode, verifyEdits } from '../core/page-edit.mjs';

const fixture = () => {
  resetIds();
  const h = makeLeaf({ meta: 'heading', extra: { text: val('<h1>Old</h1>') } });
  const p = makeLeaf({ meta: 'paragraph', extra: { text: val('<p>Body</p>') } });
  const col = makeColumn({ children: [h, p], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [h, p], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  return { h, p, col, section, data: buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section] }) };
};

test('set merges extra into the node and its canonical element copy, leaving siblings alone', () => {
  const { h, p, data } = fixture();
  const { pageData, errors } = applyPageEdits(data, [{ op: 'set', nodeId: h.id, extra: { text: val('<h1>New</h1>') } }]);
  assert.deepEqual(errors, []);
  const node = findNode(pageData, h.id).node;
  assert.equal(node.extra.text.value, '<h1>New</h1>');
  assert.equal(node.element.extra.text.value, '<h1>New</h1>');
  assert.equal(findNode(pageData, p.id).node.extra.text.value, '<p>Body</p>');
  assert.equal(findNode(data, h.id).node.extra.text.value, '<h1>Old</h1>', 'input is not mutated');
});

test('a styles edit also appends the compiled rule to the section stylesheet the public renderer serves', () => {
  const { h, data } = fixture();
  const { pageData, report } = applyPageEdits(data, [{ op: 'set', nodeId: h.id, styles: { color: val('#ff0000') } }], { compileStyles: (id, _m, s) => leafStyleCss(id, s) });
  const hit = findNode(pageData, h.id);
  assert.equal(hit.node.styles.color.value, '#ff0000');
  assert.match(hit.section.general.sectionStyles, new RegExp(`\\.${h.id}\\{[^}]*color:#ff0000`));
  assert.ok(report[0].changed.includes('section.general.sectionStyles'));
});

test('remove-node drops the node, its descendants and its id from the parent child[]', () => {
  const { col, h, p, data } = fixture();
  const { pageData } = applyPageEdits(data, [{ op: 'remove-node', nodeId: col.id }]);
  for (const id of [col.id, h.id, p.id]) assert.equal(findNode(pageData, id), null, id);
  for (const e of pageData.sections[0].elements) assert.ok(!(e.child ?? []).includes(col.id));
});

test('unknown ids and sections as set targets are refused per op, not thrown', () => {
  const { section, data } = fixture();
  const { errors } = applyPageEdits(data, [{ op: 'set', nodeId: 'nope', extra: {} }, { op: 'set', nodeId: section.id, extra: { a: 1 } }, { op: 'frob' }]);
  assert.equal(errors.length, 3);
});

test('append-section then verifyEdits reads each op back from a stored copy', () => {
  const { data } = fixture();
  resetIds();
  const x = makeLeaf({ meta: 'heading', extra: { text: val('<h2>Added</h2>') }, salt: 'E' });
  const c = makeColumn({ children: [x], widthPct: 100, salt: 'E' });
  const s = makeSection({ columns: [{ col: c, leaves: [x], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L', salt: 'E' });
  const { pageData, report } = applyPageEdits(data, [{ op: 'append-section', section: s }]);
  assert.equal(pageData.sections.length, 2);
  assert.equal(pageData.sections[1].sequence, 1);
  assert.deepEqual(verifyEdits(pageData, report), [{ sectionId: s.id, present: true }]);
  assert.deepEqual(verifyEdits(data, report), [{ sectionId: s.id, present: false }]);
});
