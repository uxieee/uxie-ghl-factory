// w7-9 (2026-11-07), reworked fn-4 (2026-11-08): the OFFLINE render section of the funnels conformance suite. It reads saved PROBE_SOURCE
// outputs (one file per surface and width: canvas-1440.json, canvas-390.json, preview-1440.json, preview-390.json, live-1440.json,
// live-390.json) and judges them with judgeRenders (mcp-internal/core/funnel-render-check.mjs), the SAME function the compare_page_renders
// tool calls. No browser, no GHL call: the probes come from a live run of the procedure in references/render-check.md.
// A missing file or a file that is not JSON is a FAIL. A probe that is not PROBE_SOURCE output is a FAIL, except the canvas at 390 whose
// window is 1440 (the builder mobile toggle): that one is NOT MEASURABLE, named with its reason. A missing probe is never a pass.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { judgeRenders, probeShape, MOBILE_TOGGLE_REASON } from '../../../mcp-internal/core/funnel-render-check.mjs';

export const SURFACES = ['canvas', 'preview', 'live'];
export const WIDTHS = [1440, 390];
export { probeShape, MOBILE_TOGGLE_REASON };

// Reads every probe file in dir. Returns {files, problems}: files[surface-width] is the parsed JSON; problems names each missing or unreadable file.
export function loadProbes(dir) {
  const problems = [];
  const files = {};
  for (const s of SURFACES) {
    for (const w of WIDTHS) {
      const f = join(dir, `${s}-${w}.json`);
      if (!existsSync(f)) { problems.push(`${s}-${w}.json is missing`); continue; }
      try { files[`${s}-${w}`] = JSON.parse(readFileSync(f, 'utf8')); } catch { problems.push(`${s}-${w}.json is not JSON`); }
    }
  }
  return { files, problems };
}

// The section: {ok, verdict, problems, diffs, missing, notMeasurable, structure}. ok only when every file is readable, preview and live match at
// 1440 and 390, and the canvas structure holds at 1440. The judgement is judgeRenders, shared with the tool.
export function renderSection(dir) {
  const { files, problems: fileProblems } = loadProbes(dir);
  if (fileProblems.length) return { ok: false, verdict: 'incomplete', problems: fileProblems, diffs: [], missing: [], notMeasurable: [], structure: null };
  const probes = {};
  for (const s of SURFACES) { probes[s] = {}; for (const w of WIDTHS) if (files[`${s}-${w}`] !== undefined) probes[s][w] = files[`${s}-${w}`]; }
  const j = judgeRenders(probes, { label: (s, w) => `${s}-${w}.json` });
  return { ok: j.verdict === 'match', verdict: j.verdict, problems: j.problems, diffs: j.diffs, missing: j.missing,
    notMeasurable: j.notMeasurable, structure: j.structure };
}

// CLI entry (conformance.mjs --render <dir>): prints the result and returns the exit code.
export function runRenderSection(dir) {
  if (!dir) { console.error('render section: give the probe directory, e.g. conformance.mjs --render <dir>'); return 2; }
  const r = renderSection(dir);
  console.log(`render section (${dir}): verdict ${r.verdict}`);
  for (const p of r.problems) console.log(`  FAIL  ${p}`);
  for (const m of r.missing) console.log(`  FAIL  node ${m.nodeId} missing in ${m.in} at ${m.width}px`);
  for (const d of r.diffs.slice(0, 20)) console.log(`  FAIL  ${d.width}px ${d.nodeId} ${d.field}: canvas=${JSON.stringify(d.canvas)} preview=${JSON.stringify(d.preview)} live=${JSON.stringify(d.live)}`);
  for (const n of r.notMeasurable ?? []) console.log(`  NOT MEASURABLE  ${n.surface} at ${n.width}px: ${n.reason}`);
  if (r.structure) {
    for (const f of r.structure.failures) console.log(`  FAIL  canvas vs public at 1440, structure: ${JSON.stringify(f)}`);
    const e = r.structure.expected;
    console.log(`  EXPECTED  canvas vs public at 1440, not failing: builder chrome ${JSON.stringify(e.builderChrome)}; `
      + `horizontal position or width differs on ${e.horizontal} node(s) (editor section narrower than the page); `
      + `editor styles differ on ${e.editorStyles} node(s)`);
  }
  console.log(r.ok ? '  PASS  preview matches live at 1440 and 390, and the canvas structure holds at 1440' : '  FAIL  the render section does not pass');
  return r.ok ? 0 : 1;
}
