// w7-9 (2026-11-07): offline tests for the render section (render-section.mjs). Fixtures only: no browser, no GHL call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderSection, probeShape, runRenderSection } from './render-section.mjs';
import { tempDir } from '../../../mcp-internal/test/_tmp.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const STYLE = { fontSize: '16px', fontFamily: 'Inter', color: 'rgb(0,0,0)', backgroundColor: 'transparent', padding: '0px',
  margin: '0px', borderRadius: '0px', display: 'block' };
const node = (over = {}) => ({ text: false, x: 10, y: 20, w: 300, h: 40, visible: true, styles: { ...STYLE }, ...over });
const probe = (w, nodes) => ({ width: w, origin: { x: 0, y: 0 }, nodes });

// Writes one file per surface and width into a fresh directory; `sets` maps "<surface>-<width>" to the probe (or omits it).
function dirWith(sets) {
  const dir = tempDir('render-section-');
  for (const [name, p] of Object.entries(sets)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(p));
  return dir;
}
function allSets(over = {}) {
  const base = {};
  for (const s of ['canvas', 'preview', 'live']) for (const w of [1440, 390]) {
    base[`${s}-${w}`] = probe(w, { 'heading-S0C00': node({ text: true, y: 60 }), 'button-S0C02': node({ y: 262, h: 23 }) });
  }
  return { ...base, ...over };
}

test('identical probes on all three surfaces at 1440 and 390 match', () => {
  const dir = dirWith(allSets());
  try {
    const r = renderSection(dir);
    assert.equal(r.verdict, 'match', JSON.stringify(r.problems) + JSON.stringify(r.diffs).slice(0, 200));
    assert.equal(r.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a node 40 px off on the preview at 1440 differs and fails the section', () => {
  const dir = dirWith(allSets({ 'preview-1440': probe(1440, { 'heading-S0C00': node({ text: true, y: 100 }), 'button-S0C02': node({ y: 262, h: 23 }) }) }));
  try {
    const r = renderSection(dir);
    assert.equal(r.verdict, 'differs');
    assert.equal(r.ok, false);
    assert.ok(r.diffs.some((d) => d.width === 1440 && d.nodeId === 'heading-S0C00'), JSON.stringify(r.diffs));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing probe is a FAIL, never a pass', () => {
  const sets = allSets();
  delete sets['live-390'];
  const dir = dirWith(sets);
  try {
    const r = renderSection(dir);
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'incomplete');
    assert.ok(r.problems.some((p) => /live-390\.json is missing/.test(p)), JSON.stringify(r.problems));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a probe with no fontFamily or padding is refused as not PROBE_SOURCE output, even when the rest matches', () => {
  const bare = { ...STYLE }; delete bare.fontFamily; delete bare.padding;
  const dir = dirWith(allSets({ 'canvas-1440': probe(1440, { 'heading-S0C00': node({ text: true, y: 60, styles: bare }), 'button-S0C02': node({ y: 262, h: 23 }) }) }));
  try {
    const r = renderSection(dir);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /canvas-1440\.json is not PROBE_SOURCE output: node heading-S0C00 lacks styles: fontFamily, padding/.test(p)), JSON.stringify(r.problems));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a probe whose width does not match its file name is refused', () => {
  const dir = dirWith(allSets({ 'live-390': probe(1440, { 'heading-S0C00': node({ text: true, y: 60 }), 'button-S0C02': node({ y: 262, h: 23 }) }) }));
  try {
    const r = renderSection(dir);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /live-390\.json is not PROBE_SOURCE output: width is 1440, expected 390/.test(p)), JSON.stringify(r.problems));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('probeShape accepts a well-formed PROBE_SOURCE output and names what is wrong otherwise', () => {
  assert.equal(probeShape(probe(390, { 'heading-S0C00': node({ text: true }) }), 390), null);
  assert.match(probeShape(null, 390), /not an object/);
  assert.match(probeShape({ width: 390, origin: { x: 0, y: 0 }, nodes: {} }, 390), /no nodes/);
});

test('the custom captures in the knowledge sniffs are refused by the section (they are not PROBE_SOURCE output)', () => {
  // Ports the test to the real repo layout: this file sits at plugin/.../skills/ghl-funnels-pages/scripts/, the knowledge repo is a sibling lane.
  const knowledgeCaptures = join(here, '../../../../../../../knowledge/sniffs/funnels-w7-2026-11-06/w7-9-reference-set/renders');
  if (!existsSync(join(knowledgeCaptures, 'canvas-1440-landing.json'))) return; // the knowledge lane is not checked out next to this plugin
  // The custom captures are named by page, not by surface and width, so the section finds no canvas-1440.json at all.
  const r = renderSection(knowledgeCaptures);
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'incomplete');
});

test('runRenderSection exits 0 only when the section passes; 1 when it fails; 2 with no directory', () => {
  const pass = dirWith(allSets());
  const fail = dirWith({});
  const quiet = console.log; const quietErr = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    assert.equal(runRenderSection(pass), 0);
    assert.equal(runRenderSection(fail), 1, 'a failing section must exit 1, never 0');
    assert.equal(runRenderSection(undefined), 2);
  } finally {
    console.log = quiet; console.error = quietErr;
    rmSync(pass, { recursive: true, force: true }); rmSync(fail, { recursive: true, force: true });
  }
});

// The CLI itself (conformance.mjs --render <dir>): the exit code a runner sees. Spawns the real script, so a broken hook fails here.
test('conformance.mjs --render exits 0 on a passing directory, 1 on a failing one, 2 with no directory', () => {
  const script = join(here, 'conformance.mjs');
  const pass = dirWith(allSets());
  const fail = dirWith({});
  try {
    const ok = spawnSync(process.execPath, [script, '--render', pass], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const bad = spawnSync(process.execPath, [script, '--render', fail], { encoding: 'utf8' });
    assert.equal(bad.status, 1, 'a failing render section must exit 1 through the CLI, not 0: ' + bad.stdout);
    assert.match(bad.stdout, /the render section does not pass/);
    const none = spawnSync(process.execPath, [script, '--render'], { encoding: 'utf8' });
    assert.equal(none.status, 2, none.stdout + none.stderr);
  } finally {
    rmSync(pass, { recursive: true, force: true }); rmSync(fail, { recursive: true, force: true });
  }
});
