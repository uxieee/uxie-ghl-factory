// w7-9 (2026-11-07): the OFFLINE render section of the funnels conformance suite. It reads saved PROBE_SOURCE outputs (one file per
// surface and width: canvas-1440.json, preview-1440.json, live-1440.json, and the 390 set) and asserts that compareRenders returns
// 'match' (mcp-internal/core/funnel-render-check.mjs). No browser, no GHL call: the probes come from a live run of the procedure in
// references/render-check.md, which is NOT part of this section and is not run here.
// A missing file, a file that is not PROBE_SOURCE output, or a verdict other than 'match' is a FAIL. A missing probe is never a pass.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareRenders } from '../../../mcp-internal/core/funnel-render-check.mjs';

export const SURFACES = ['canvas', 'preview', 'live'];
export const WIDTHS = [1440, 390];
const STYLE_KEYS = ['fontSize', 'fontFamily', 'color', 'backgroundColor', 'padding', 'margin', 'borderRadius', 'display'];

// Returns null when p is a PROBE_SOURCE output for width w; otherwise the reason it is not.
export function probeShape(p, w) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (p.width !== w) return `width is ${p.width}, expected ${w}`;
  if (!p.origin || typeof p.origin.x !== 'number' || typeof p.origin.y !== 'number') return 'no origin (the first section corner)';
  if (!p.nodes || typeof p.nodes !== 'object' || Object.keys(p.nodes).length === 0) return 'no nodes';
  for (const [id, n] of Object.entries(p.nodes)) {
    if (!n || typeof n.x !== 'number' || typeof n.y !== 'number' || typeof n.visible !== 'boolean') return `node ${id} lacks x/y/visible`;
    if (!n.styles || typeof n.styles !== 'object') return `node ${id} lacks styles`;
    const missing = STYLE_KEYS.filter((k) => !(k in n.styles));
    if (missing.length) return `node ${id} lacks styles: ${missing.join(', ')}`;
  }
  return null;
}

// Reads the probe set from dir. Returns {probes, problems}; probes[surface][width] is set only for a valid file.
export function loadProbes(dir) {
  const problems = [];
  const probes = {};
  for (const s of SURFACES) {
    probes[s] = {};
    for (const w of WIDTHS) {
      const f = join(dir, `${s}-${w}.json`);
      if (!existsSync(f)) { problems.push(`${s}-${w}.json is missing`); continue; }
      let p;
      try { p = JSON.parse(readFileSync(f, 'utf8')); } catch { problems.push(`${s}-${w}.json is not JSON`); continue; }
      const why = probeShape(p, w);
      if (why) { problems.push(`${s}-${w}.json is not PROBE_SOURCE output: ${why}`); continue; }
      probes[s][w] = p;
    }
  }
  return { probes, problems };
}

// The section: {ok, verdict, problems, diffs, missing}. ok only when every probe is valid and compareRenders says 'match'.
export function renderSection(dir) {
  const { probes, problems } = loadProbes(dir);
  if (problems.length) return { ok: false, verdict: 'incomplete', problems, diffs: [], missing: [] };
  const r = compareRenders(probes, { widths: WIDTHS });
  return { ok: r.verdict === 'match', verdict: r.verdict, problems: [], diffs: r.diffs, missing: r.missing };
}

// CLI entry (conformance.mjs --render <dir>): prints the result and returns the exit code.
export function runRenderSection(dir) {
  if (!dir) { console.error('render section: give the probe directory, e.g. conformance.mjs --render <dir>'); return 2; }
  const r = renderSection(dir);
  console.log(`render section (${dir}): verdict ${r.verdict}`);
  for (const p of r.problems) console.log(`  FAIL  ${p}`);
  for (const m of r.missing) console.log(`  FAIL  node ${m.nodeId} missing in ${m.in} at ${m.width}px`);
  for (const d of r.diffs.slice(0, 20)) console.log(`  FAIL  ${d.width}px ${d.nodeId} ${d.field}: canvas=${JSON.stringify(d.canvas)} preview=${JSON.stringify(d.preview)} live=${JSON.stringify(d.live)}`);
  console.log(r.ok ? '  PASS  every surface matches at 1440 and 390' : '  FAIL  the render section does not pass');
  return r.ok ? 0 : 1;
}
