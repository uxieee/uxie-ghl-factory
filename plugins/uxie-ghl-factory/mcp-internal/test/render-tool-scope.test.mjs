// fn-4 RESUBMIT (2026-11-08): the compare_page_renders TOOL applies the ruled scopes, the same ones the render section applies. The
// builder's mobile toggle keeps the window at 1440, so the canvas probe at 390 is NOT MEASURABLE (named, not compared). Preview is
// judged against live at 1440 and 390. Canvas is judged against live at 1440 on structure and layout only. These tests call the handler
// itself, on probes shaped like the fn-2 reference set, so the record's runs are produced by the tool that is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = TOOLS.find((t) => t.name === 'compare_page_renders');
const REFERENCE = join(HERE, '../../../../../knowledge/sniffs/funnels-fn-2026-11-08/fn2-probes');

const STYLE = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px',
  margin: '0px', borderRadius: '0px', display: 'block' };
const node = (over = {}) => ({ text: false, x: 10, y: 20, w: 300, h: 40, visible: true, styles: { ...STYLE }, ...over });
const probe = (w, nodes) => ({ width: w, origin: { x: 0, y: 0 }, nodes });
const base = () => ({ 'heading-S0C00': node({ text: true, y: 60 }), 'paragraph-S0C01': node({ text: true, y: 118 }), 'button-S0C02': node({ y: 262, h: 23 }) });
const run = (probes) => TOOL.handler({ probes }, {});

// The reference shape: the builder canvas carries its chrome and editor styles; the public page carries one sub-node the canvas does not
// (form-builder), so the structure fails for a stated reason. Preview is identical to live.
function referenceShaped() {
  const canvasNodes = { ...base(), 'image-dropdown-file-input': node({ y: 10, h: 30 }) };
  for (const k of Object.keys(canvasNodes)) canvasNodes[k] = { ...canvasNodes[k], styles: { ...canvasNodes[k].styles, fontFamily: 'Inter', fontSize: '14px' } };
  const publicNodes = { ...base(), 'form-builder': node({ y: 300, h: 80 }) };
  return {
    canvas: { 1440: probe(1440, canvasNodes), 390: probe(1440, canvasNodes) },
    preview: { 1440: probe(1440, publicNodes), 390: probe(390, publicNodes) },
    live: { 1440: probe(1440, publicNodes), 390: probe(390, publicNodes) },
  };
}

test('the tool, on reference-shaped probes: preview = live at both widths PASS, canvas 390 NOT MEASURABLE, canvas structure at 1440 FAIL with its reason', async () => {
  const r = await run(referenceShaped());
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.scopes.previewVsLive.verdict, 'match', JSON.stringify(r.data.scopes.previewVsLive).slice(0, 300));
  assert.equal(r.data.notMeasurable.length, 1, JSON.stringify(r.data.notMeasurable));
  assert.equal(r.data.notMeasurable[0].surface, 'canvas');
  assert.equal(r.data.notMeasurable[0].width, 390);
  assert.match(r.data.notMeasurable[0].reason, /mobile toggle/);
  assert.equal(r.data.scopes.canvasStructure.verdict, 'differs');
  assert.ok(r.data.scopes.canvasStructure.failures.some((f) => f.kind === 'live-only' && f.nodeId === 'form-builder'), JSON.stringify(r.data.scopes.canvasStructure.failures));
  assert.deepEqual(r.data.scopes.canvasStructure.expected.builderChrome, ['image-dropdown-file-input']);
  assert.equal(r.data.verdict, 'differs', 'the page is not done: the canvas structure fails');
});

test('the tool: a preview that moves at 390 differs against live, and the difference is reported at 390', async () => {
  const p = referenceShaped();
  p.preview[390] = probe(390, { ...base(), 'heading-S0C00': node({ text: true, y: 120 }), 'form-builder': node({ y: 300, h: 80 }) });
  const r = await run(p);
  assert.equal(r.data.scopes.previewVsLive.verdict, 'differs');
  assert.ok(r.data.scopes.previewVsLive.diffs.some((d) => d.width === 390 && d.nodeId === 'heading-S0C00'), JSON.stringify(r.data.scopes.previewVsLive.diffs).slice(0, 300));
  assert.equal(r.data.verdict, 'differs');
});

test('the tool: a canvas probe at 390 that really is 390 wide is measured, not named NOT MEASURABLE', async () => {
  const p = referenceShaped();
  p.canvas[390] = probe(390, base());
  const r = await run(p);
  assert.deepEqual(r.data.notMeasurable, []);
});

test('the tool: no canvas probe at 390 is NOT MEASURABLE with a reason, and does not make the verdict incomplete', async () => {
  const p = referenceShaped();
  delete p.canvas[390];
  const r = await run(p);
  assert.equal(r.data.notMeasurable.length, 1);
  assert.equal(r.data.notMeasurable[0].surface, 'canvas');
  assert.match(r.data.notMeasurable[0].reason, /not supplied/);
  assert.notEqual(r.data.verdict, 'incomplete', JSON.stringify(r.data.problems));
});

test('the tool: a preview or live probe missing at 390 is incomplete, never a pass', async () => {
  const p = referenceShaped();
  delete p.live[390];
  const r = await run(p);
  assert.equal(r.data.verdict, 'incomplete');
  assert.ok(r.data.problems.some((x) => /live-390/.test(x)), JSON.stringify(r.data.problems));
});

test('the tool: a non-chrome node only on the canvas fails the canvas structure, and is named', async () => {
  const p = referenceShaped();
  p.canvas[1440] = probe(1440, { ...p.canvas[1440].nodes, 'form-S0C03-hl-custom-code': node({ y: 400 }) });
  const r = await run(p);
  assert.equal(r.data.scopes.canvasStructure.verdict, 'differs');
  assert.ok(r.data.scopes.canvasStructure.failures.some((f) => f.kind === 'canvas-only' && f.nodeId === 'form-S0C03-hl-custom-code'));
});

test('the tool: a canvas whose editor styles differ from the public page does not fail the structure', async () => {
  const p = referenceShaped();
  const live = { ...base(), 'form-builder': node({ y: 300, h: 80 }) };
  const canvas = {};
  for (const k of Object.keys(live)) canvas[k] = node({ ...live[k], styles: { ...STYLE, fontFamily: 'Times New Roman', color: 'rgb(96,113,121)' } });
  canvas['form-builder'] = node({ y: 300, h: 80, styles: { ...STYLE, fontFamily: 'Inter' } });
  p.canvas[1440] = probe(1440, { ...canvas, 'image-dropdown-file-input': node({ y: 10, h: 30 }) });
  const r = await run(p);
  assert.equal(r.data.scopes.canvasStructure.verdict, 'match', JSON.stringify(r.data.scopes.canvasStructure.failures));
  assert.ok(r.data.scopes.canvasStructure.expected.editorStyles > 0);
});

test('the tool, on the fn-2 reference probes: per page, preview = live PASS at both widths, canvas 390 NOT MEASURABLE, canvas structure FAIL with listed reasons', { skip: !existsSync(REFERENCE) && 'knowledge sniffs funnels-fn-2026-11-08 not checked out next to this plugin' }, async () => {
  const load = (page, surface, w) => JSON.parse(readFileSync(join(REFERENCE, page, `${surface}-${w}.json`), 'utf8'));
  for (const page of ['landing', 'sales', 'booking']) {
    const probes = { canvas: { 1440: load(page, 'canvas', 1440), 390: load(page, 'canvas', 390) },
      preview: { 1440: load(page, 'preview', 1440), 390: load(page, 'preview', 390) },
      live: { 1440: load(page, 'live', 1440), 390: load(page, 'live', 390) } };
    const r = await run(probes);
    assert.equal(r.ok, true, `${page}: ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal(r.data.scopes.previewVsLive.verdict, 'match', `${page} preview vs live: ${JSON.stringify(r.data.scopes.previewVsLive.diffs).slice(0, 200)}`);
    assert.deepEqual(r.data.problems, [], `${page}`);
    assert.ok(r.data.notMeasurable.some((n) => n.surface === 'canvas' && n.width === 390), `${page} canvas 390 is named`);
    assert.equal(r.data.scopes.canvasStructure.verdict, 'differs', `${page} canvas structure must fail on the reference set`);
    assert.ok(r.data.scopes.canvasStructure.failures.length > 0, `${page} lists the reasons`);
    assert.equal(r.data.verdict, 'differs', `${page}`);
  }
});

// fn-4 (QA follow-up, 2026-11-08): describe() ships the LONGER of the source fallback and the catalogue lead, so two texts that drift apart
// let a later edit silently lose one. The lead the tool ships is exported from the source, and must equal the catalogue lead, and the tool's
// description must be the catalogue's whole text.
import { readFileSync as readJson } from 'node:fs';
import { COMPARE_PAGE_RENDERS_LEAD } from '../core/funnel-render-tools.mjs';
test('the description the tool ships equals tool-descriptions.json: the source lead is the catalogue lead, and the tool text is the catalogue text', () => {
  const full = JSON.parse(readJson(join(HERE, '../tool-descriptions.json'), 'utf8')).compare_page_renders.description;
  const lead = full.slice(0, full.search(/\s*—\s*proof:/)).trim();
  assert.equal(COMPARE_PAGE_RENDERS_LEAD, lead, 'the source lead and the catalogue lead must be the same text');
  assert.equal(TOOL.description, full.replace(/\s{2,}/g, ' '), 'the tool ships the catalogue text');
});
