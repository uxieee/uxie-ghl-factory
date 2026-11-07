// w7-3: the three-way render check (builder canvas = preview = live) at 1440 and 390 px. Pure comparer; the probes are
// measured in the browser by the skill's procedure (references/render-check.md). A node 1 px off is within tolerance; a
// node missing from one surface makes the check incomplete; a width not probed makes it incomplete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRenders, PROBE_SOURCE } from '../core/funnel-render-check.mjs';

const node = (over = {}) => ({ x: 100, y: 200, w: 300, h: 40, visible: true,
  styles: { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px', margin: '0px', borderRadius: '0px', display: 'block' },
  ...over });
// Each probe is {origin, nodes}; the origin is the first section's top-left, so positions compare relative to it.
const probe = (nodes, origin = { x: 0, y: 0 }) => ({ origin, nodes });
const set = (nodes1440, nodes390) => ({ 1440: probe(nodes1440), 390: probe(nodes390) });
const same = { 'heading-1': node(), 'button-2': node({ y: 300, w: 200, h: 50 }) };

test('identical probes on all three surfaces at both widths match', () => {
  const s = set(same, same);
  const r = compareRenders({ canvas: s, preview: s, live: s }, {});
  assert.equal(r.verdict, 'match');
  assert.deepEqual(r.diffs, []);
  assert.deepEqual(r.missing, []);
});

test('a node 1 px off is within the 2 px tolerance', () => {
  const near = { ...same, 'heading-1': node({ x: 101 }) };
  const r = compareRenders({ canvas: set(same, same), preview: set(near, same), live: set(same, same) }, {});
  assert.equal(r.verdict, 'match');
});

test('one-letter vertical text (w < 20, h > 300 on the canvas only) differs', () => {
  const vertical = { ...same, 'heading-1': node({ w: 14, h: 340 }) };
  const r = compareRenders({ canvas: set(vertical, same), preview: set(same, same), live: set(same, same) }, {});
  assert.equal(r.verdict, 'differs');
  assert.ok(r.diffs.some((d) => d.nodeId === 'heading-1' && d.width === 1440 && d.field === 'h'));
});

test('a node missing from the live surface is missing, and the verdict is incomplete', () => {
  const noButton = { 'heading-1': node() };
  const r = compareRenders({ canvas: set(same, same), preview: set(same, same), live: set(noButton, same) }, {});
  assert.equal(r.verdict, 'incomplete');
  assert.deepEqual(r.missing, [{ width: 1440, nodeId: 'button-2', in: 'live' }]);
});

test('a probe set without width 390 is incomplete (Review Focus 2)', () => {
  const only1440 = { 1440: probe(same) };
  const r = compareRenders({ canvas: only1440, preview: only1440, live: only1440 }, {});
  assert.equal(r.verdict, 'incomplete');
});

test('text-only nodes compare size and styles, not x (a text box moves with its container)', () => {
  const textSame = { ...same, 'heading-1': node({ text: true }) };
  const moved = { ...same, 'heading-1': node({ text: true, x: 500 }) };
  const r = compareRenders({ canvas: set(textSame, same), preview: set(moved, same), live: set(textSame, same) }, {});
  assert.equal(r.verdict, 'match', 'x on a text-only node is not compared');
});

test('the probe source is a string the reference page carries verbatim (drift guard)', async () => {
  assert.equal(typeof PROBE_SOURCE, 'string');
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(new URL('../../skills/ghl-funnels-pages/references/render-check.md', import.meta.url), 'utf8');
  assert.ok(doc.includes(PROBE_SOURCE), 'render-check.md must carry PROBE_SOURCE exactly');
});

test('compare_page_renders is in TOOLS, takes no capability, makes no account call, and returns the verdict', async () => {
  const { TOOLS } = await import('../core/tools.mjs');
  const tool = TOOLS.find((t) => t.name === 'compare_page_renders');
  assert.ok(tool, 'the tool is registered through the funnels seam');
  assert.deepEqual(tool.capabilities, []);
  const s = { 1440: { nodes: { 'heading-1': node() } }, 390: { nodes: { 'heading-1': node() } } };
  const calls = [];
  const deps = { state: {}, makeGw: () => ({ call: async (...a) => { calls.push(a); throw new Error('no account call allowed'); } }) };
  const res = await tool.handler({ probes: { canvas: s, preview: s, live: s } }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.data.verdict, 'match');
  assert.equal(calls.length, 0, 'no account call');
  const partial = await tool.handler({ probes: { canvas: { 1440: s[1440] }, preview: s, live: s } }, deps);
  assert.equal(partial.data.verdict, 'incomplete');
});

// The probe runs in a browser; this runs the same string against a small fake DOM. A builder UI element (nav-menu-popup)
// is not a page node and must not be probed; node ids always carry a digit (section-S03, button-S0C01).
test('PROBE_SOURCE probes a builder node with a digit-less random id (button-UzfmOnLiRX) and not the UI element nav-menu-popup', async () => {
  const box = { x: 10, y: 20, width: 100, height: 30, top: 20, left: 10 };
  const el = (id) => ({ id, getBoundingClientRect: () => box });
  const els = [el('section-S03'), el('button-S0C01'), el('button-UzfmOnLiRX'), el('heading-EyqAgbiXlE'), el('nav-menu-popup')];
  const fakeDoc = { querySelector: () => el('section-S03'), querySelectorAll: (sel) => (sel === '[id]' ? els : []) };
  const fakeWin = { innerWidth: 1440 };
  const style = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px', margin: '0px', borderRadius: '0px', display: 'block', visibility: 'visible' };
  const run = new Function('document', 'window', 'getComputedStyle', `return ${PROBE_SOURCE};`);
  const out = run(fakeDoc, fakeWin, () => style);
  assert.deepEqual(Object.keys(out.nodes).sort(), ['button-S0C01', 'button-UzfmOnLiRX', 'heading-EyqAgbiXlE', 'section-S03']);
  assert.equal(out.width, 1440);
});

// QA (2026-11-07, second FAIL): builder ids are not a fixed length or shape. A page node is any <kind>-<suffix> element
// inside a section (a section is inside itself), minus the builder's own UI elements by exact name.
test('PROBE_SOURCE probes every page node inside a section, whatever its id shape, and never the UI element nav-menu-popup', async () => {
  const box = { x: 10, y: 20, width: 100, height: 30, top: 20, left: 10 };
  const section = { id: 'section-rXHjMJysW', getBoundingClientRect: () => box };
  const inSection = (id) => ({ id, getBoundingClientRect: () => box, closest: (sel) => (sel === '[id^="section-"]' ? section : null) });
  const outside = { id: 'nav-menu-popup', getBoundingClientRect: () => box, closest: () => null };
  const insideUi = { id: 'nav-menu-popup', getBoundingClientRect: () => box, closest: (sel) => (sel === '[id^="section-"]' ? section : null) };
  const els = [section, inSection('heading-lPCCpQfBTmb'), inSection('image-omjWDCHUoHC'), inSection('button-UzfmOnLiRX'), inSection('button-S0C01'), outside, insideUi];
  const fakeDoc = { querySelector: () => section, querySelectorAll: (sel) => (sel === '[id]' ? els : []) };
  const fakeWin = { innerWidth: 1440 };
  const style = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px', margin: '0px', borderRadius: '0px', display: 'block', visibility: 'visible' };
  const run = new Function('document', 'window', 'getComputedStyle', `return ${PROBE_SOURCE};`);
  const out = run(fakeDoc, fakeWin, () => style);
  assert.deepEqual(Object.keys(out.nodes).sort(), ['button-S0C01', 'button-UzfmOnLiRX', 'heading-lPCCpQfBTmb', 'image-omjWDCHUoHC', 'section-rXHjMJysW']);
});

// Second-fail decision (2026-11-07): no id-shape rule. A node is compared when its id has a page-node kind prefix, unless it
// is on the named exclusion list of builder UI ids. Unknown means compared.
const runProbe = (ids) => {
  const box = { x: 10, y: 20, width: 100, height: 30, top: 20, left: 10 };
  const els = ids.map((id) => ({ id, getBoundingClientRect: () => box, closest: () => null }));
  const fakeDoc = { querySelector: () => null, querySelectorAll: (sel) => (sel === '[id]' ? els : []) };
  const style = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px', margin: '0px', borderRadius: '0px', display: 'block', visibility: 'visible' };
  const run = new Function('document', 'window', 'getComputedStyle', `return ${PROBE_SOURCE};`);
  return run(fakeDoc, { innerWidth: 1440 }, () => style).nodes;
};

test('a 9-character digit-less section id is compared', () => {
  assert.ok('section-rXHjMJysW' in runProbe(['section-rXHjMJysW']));
});
test('an 11-character digit-less heading id is compared', () => {
  assert.ok('heading-lPCCpQfBTmb' in runProbe(['heading-lPCCpQfBTmb']));
});
test('an excluded builder UI id (nav-menu-popup) is not compared', () => {
  assert.equal('nav-menu-popup' in runProbe(['nav-menu-popup']), false);
});
test('every one of the 2,314 builder nodes sniffed in the knowledge repo is compared (zero uncompared)', async () => {
  const { readFileSync } = await import('node:fs');
  const nodes = JSON.parse(readFileSync(new URL('./fixtures/builder-node-ids.json', import.meta.url), 'utf8'));
  // The fixture is the builder nodes sniffed in knowledge/sniffs (a fake control kind from funnel-element-roundtrip-2026-09-09/probe-flat.mjs line 27 is left out).
  assert.equal(nodes.length, 2314);
  const probed = runProbe(nodes.map((n) => n.id));
  const uncompared = nodes.filter((n) => !(n.id in probed)).map((n) => n.id);
  assert.deepEqual(uncompared, []);
});
