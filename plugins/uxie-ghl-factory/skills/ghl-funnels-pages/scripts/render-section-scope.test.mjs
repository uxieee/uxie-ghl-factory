// fn-4 (2026-11-08): the render section with the two scopes. The builder's mobile toggle keeps the window at 1440, so the canvas probe at
// 390 reports width 1440: that is NOT MEASURABLE (named, not refused). Preview against live must match at 1440 and 390. Canvas against the
// public page at 1440 is judged on structure only. Fixtures only: no browser, no GHL call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSection, runRenderSection } from './render-section.mjs';

const STYLE = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px',
  margin: '0px', borderRadius: '0px', display: 'block' };
const node = (over = {}) => ({ text: false, x: 10, y: 20, w: 300, h: 40, visible: true, styles: { ...STYLE }, ...over });
const probe = (w, nodes) => ({ width: w, origin: { x: 0, y: 0 }, nodes });
const base = () => ({ 'heading-S0C00': node({ text: true, y: 60 }), 'button-S0C02': node({ y: 262, h: 23 }) });

function dirWith(sets) {
  const dir = mkdtempSync(join(tmpdir(), 'render-section-scope-'));
  for (const [name, p] of Object.entries(sets)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(p));
  return dir;
}
function allSets(over = {}) {
  const sets = {};
  for (const s of ['canvas', 'preview', 'live']) for (const w of [1440, 390]) sets[`${s}-${w}`] = probe(w, base());
  return { ...sets, ...over };
}
const withDir = (sets, fn) => { const dir = dirWith(sets); try { return fn(renderSection(dir)); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('the canvas at 390 is NOT MEASURABLE when its probe reports the 1440 window: named, not refused, and the section still passes', () => {
  withDir(allSets({ 'canvas-390': probe(1440, base()) }), (r) => {
    assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
    assert.equal(r.notMeasurable.length, 1);
    assert.equal(r.notMeasurable[0].surface, 'canvas');
    assert.equal(r.notMeasurable[0].width, 390);
    assert.match(r.notMeasurable[0].reason, /mobile toggle/);
    assert.match(r.notMeasurable[0].reason, /1440/);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

test('with the canvas at 390 NOT MEASURABLE, a preview that differs from live at 390 fails the section', () => {
  const moved = { 'heading-S0C00': node({ text: true, y: 120 }), 'button-S0C02': node({ y: 262, h: 23 }) };
  withDir(allSets({ 'canvas-390': probe(1440, base()), 'preview-390': probe(390, moved) }), (r) => {
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'differs');
    assert.ok(r.diffs.some((d) => d.width === 390 && d.nodeId === 'heading-S0C00'), JSON.stringify(r.diffs));
  });
});

test('a live-390 probe at the wrong width is still refused: only the canvas gets the mobile-toggle allowance', () => {
  withDir(allSets({ 'live-390': probe(1440, base()) }), (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /live-390\.json is not PROBE_SOURCE output: width is 1440, expected 390/.test(p)), JSON.stringify(r.problems));
  });
});

test('canvas structure at 1440: a node only on the public page fails the section, and the structure verdict says so', () => {
  const extra = { ...base(), 'form-builder': node({ y: 400 }) };
  withDir(allSets({ 'live-1440': probe(1440, extra), 'preview-1440': probe(1440, extra) }), (r) => {
    assert.equal(r.ok, false);
    assert.equal(r.structure.verdict, 'differs');
    assert.ok(r.structure.failures.some((f) => f.kind === 'live-only' && f.nodeId === 'form-builder'), JSON.stringify(r.structure.failures));
  });
});

test('canvas structure at 1440: builder chrome on the canvas is listed as expected and the section still passes', () => {
  withDir(allSets({ 'canvas-1440': probe(1440, { ...base(), 'image-dropdown-file-input': node({ y: 10, h: 30 }) }) }), (r) => {
    assert.equal(r.ok, true, JSON.stringify(r.structure));
    assert.deepEqual(r.structure.expected.builderChrome, ['image-dropdown-file-input']);
  });
});

test('canvas structure at 1440: editor fonts and styles on the canvas are listed as expected, not failures', () => {
  const editor = { 'heading-S0C00': node({ text: true, y: 60, styles: { ...STYLE, fontFamily: 'Inter', fontSize: '14px', color: 'rgb(96,113,121)' } }),
    'button-S0C02': node({ y: 262, h: 23 }) };
  withDir(allSets({ 'canvas-1440': probe(1440, editor) }), (r) => {
    assert.equal(r.ok, true, JSON.stringify(r.structure));
    assert.ok(r.structure.expected.editorStyles > 0);
  });
});

test('runRenderSection prints the NOT MEASURABLE line and exits 0 when the section passes with it', () => {
  const dir = dirWith(allSets({ 'canvas-390': probe(1440, base()) }));
  const lines = [];
  const log = console.log; console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(runRenderSection(dir), 0);
  } finally {
    console.log = log; rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(lines.some((l) => /NOT MEASURABLE.*canvas.*390/.test(l)), lines.join('\n'));
});
