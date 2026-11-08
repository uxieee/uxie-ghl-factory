// fn-4 (2026-11-08): the two scopes of the render check. (1) A surface that cannot be measured at a width is NAMED, not dropped: the builder's
// mobile toggle keeps the window at 1440, so its canvas probe at 390 cannot be compared at 390. The verdict at that width is then preview
// against live. (2) Canvas against the public page at 1440 is a STRUCTURE comparison: which nodes exist, whether they are visible, their
// vertical geometry and their order. Builder chrome and editor styles are listed as expected differences and do not fail the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRenders, compareStructure, BUILDER_CHROME_IDS } from '../core/funnel-render-check.mjs';

const STYLE = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px',
  margin: '0px', borderRadius: '0px', display: 'block' };
const node = (over = {}) => ({ text: false, x: 10, y: 20, w: 300, h: 40, visible: true, styles: { ...STYLE }, ...over });
const probe = (w, nodes) => ({ width: w, origin: { x: 0, y: 0 }, nodes });
const base = () => ({ 'heading-S0C00': node({ text: true, y: 60 }), 'button-S0C02': node({ y: 262, h: 23 }) });

test('canvas at 390 NOT MEASURABLE: the verdict at 390 is preview against live, and identical pair matches', () => {
  const sets = {
    canvas: { 1440: probe(1440, base()) },
    preview: { 1440: probe(1440, base()), 390: probe(390, base()) },
    live: { 1440: probe(1440, base()), 390: probe(390, base()) },
  };
  const r = compareRenders(sets, { widths: [1440, 390], notMeasurable: ['canvas@390'] });
  assert.equal(r.verdict, 'match', JSON.stringify(r.diffs).slice(0, 200) + JSON.stringify(r.missing));
});

test('canvas at 390 NOT MEASURABLE: a preview that moves at 390 differs, and the difference is reported at 390', () => {
  const moved = { 'heading-S0C00': node({ text: true, y: 120 }), 'button-S0C02': node({ y: 262, h: 23 }) };
  const sets = {
    canvas: { 1440: probe(1440, base()) },
    preview: { 1440: probe(1440, base()), 390: probe(390, moved) },
    live: { 1440: probe(1440, base()), 390: probe(390, base()) },
  };
  const r = compareRenders(sets, { widths: [1440, 390], notMeasurable: ['canvas@390'] });
  assert.equal(r.verdict, 'differs');
  assert.ok(r.diffs.some((d) => d.width === 390 && d.nodeId === 'heading-S0C00'), JSON.stringify(r.diffs));
});

test('without the NOT MEASURABLE entry a missing canvas at 390 is still INCOMPLETE, never a match', () => {
  const sets = {
    canvas: { 1440: probe(1440, base()) },
    preview: { 1440: probe(1440, base()), 390: probe(390, base()) },
    live: { 1440: probe(1440, base()), 390: probe(390, base()) },
  };
  assert.equal(compareRenders(sets, { widths: [1440, 390] }).verdict, 'incomplete');
});

test('NOT MEASURABLE does not excuse a missing preview or live at 390', () => {
  const sets = {
    canvas: { 1440: probe(1440, base()) },
    preview: { 1440: probe(1440, base()) },
    live: { 1440: probe(1440, base()), 390: probe(390, base()) },
  };
  assert.equal(compareRenders(sets, { widths: [1440, 390], notMeasurable: ['canvas@390'] }).verdict, 'incomplete');
});

test('the builder chrome list names the image picker seen on the reference canvases', () => {
  assert.ok(BUILDER_CHROME_IDS.includes('image-dropdown-file-input'));
});

test('structure: identical nodes match', () => {
  const r = compareStructure(probe(1440, base()), probe(1440, base()));
  assert.equal(r.verdict, 'match', JSON.stringify(r.failures));
  assert.deepEqual(r.failures, []);
});

test('structure: builder chrome present only on the canvas is listed as expected and does not fail', () => {
  const canvas = probe(1440, { ...base(), 'image-dropdown-file-input': node({ y: 10, h: 30 }) });
  const r = compareStructure(canvas, probe(1440, base()));
  assert.equal(r.verdict, 'match', JSON.stringify(r.failures));
  assert.deepEqual(r.expected.builderChrome, ['image-dropdown-file-input']);
});

test('structure: a non-chrome node only on the canvas fails', () => {
  const canvas = probe(1440, { ...base(), 'form-S0C03-hl-custom-code': node({ y: 400 }) });
  const r = compareStructure(canvas, probe(1440, base()));
  assert.equal(r.verdict, 'differs');
  assert.ok(r.failures.some((f) => f.kind === 'canvas-only' && f.nodeId === 'form-S0C03-hl-custom-code'), JSON.stringify(r.failures));
});

test('structure: a node only on the public page fails', () => {
  const live = probe(1440, { ...base(), 'form-builder': node({ y: 400 }) });
  const r = compareStructure(probe(1440, base()), live);
  assert.equal(r.verdict, 'differs');
  assert.ok(r.failures.some((f) => f.kind === 'live-only' && f.nodeId === 'form-builder'), JSON.stringify(r.failures));
});

test('structure: a visibility difference on a shared node fails', () => {
  const canvas = probe(1440, { ...base(), 'button-S0C02': node({ y: 262, h: 23, visible: false }) });
  const r = compareStructure(canvas, probe(1440, base()));
  assert.equal(r.verdict, 'differs');
  assert.ok(r.failures.some((f) => f.kind === 'visibility' && f.nodeId === 'button-S0C02'));
});

test('structure: a vertical offset beyond the tolerance fails; one inside it does not', () => {
  const far = compareStructure(probe(1440, { ...base(), 'button-S0C02': node({ y: 270, h: 23 }) }), probe(1440, base()));
  assert.equal(far.verdict, 'differs');
  assert.ok(far.failures.some((f) => f.kind === 'vertical' && f.nodeId === 'button-S0C02'), JSON.stringify(far.failures));
  const near = compareStructure(probe(1440, { ...base(), 'button-S0C02': node({ y: 263, h: 23 }) }), probe(1440, base()));
  assert.equal(near.verdict, 'match', JSON.stringify(near.failures));
});

test('structure: a change of top-to-bottom order between shared nodes fails', () => {
  const canvas = probe(1440, { 'heading-S0C00': node({ text: true, y: 300 }), 'button-S0C02': node({ y: 60, h: 23 }) });
  const live = probe(1440, { 'heading-S0C00': node({ text: true, y: 60 }), 'button-S0C02': node({ y: 300, h: 23 }) });
  const r = compareStructure(canvas, live);
  assert.equal(r.verdict, 'differs');
  assert.ok(r.failures.some((f) => f.kind === 'order'), JSON.stringify(r.failures));
});

test('structure: horizontal position, width and editor styles are listed as expected, not failures', () => {
  const canvas = probe(1440, { 'heading-S0C00': node({ text: true, x: 200, w: 800, y: 60, styles: { ...STYLE, fontFamily: 'Inter', fontSize: '14px' } }),
    'button-S0C02': node({ x: 200, w: 800, y: 262, h: 23 }) });
  const live = probe(1440, { 'heading-S0C00': node({ text: true, x: 0, w: 1440, y: 60, styles: { ...STYLE, fontFamily: 'Times New Roman' } }),
    'button-S0C02': node({ x: 0, w: 1440, y: 262, h: 23 }) });
  const r = compareStructure(canvas, live);
  assert.equal(r.verdict, 'match', JSON.stringify(r.failures));
  assert.ok(r.expected.horizontal > 0, 'the horizontal difference is counted');
  assert.ok(r.expected.editorStyles > 0, 'the font difference is counted');
});

test('structure: a probe with no nodes is INCOMPLETE, never a match', () => {
  assert.equal(compareStructure(probe(1440, {}), probe(1440, base())).verdict, 'incomplete');
});
