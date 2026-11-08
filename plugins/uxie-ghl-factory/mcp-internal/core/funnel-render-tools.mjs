// p2 seam, filled by the funnels lane (W7-3), scopes applied fn-4 (2026-11-08): compare_page_renders judges the probes the skill measured in
// the browser (references/render-check.md). It applies the ruled scopes through judgeRenders, the function the render section also calls:
// preview against live at 1440 and 390; the canvas against live at 1440 on structure and layout only; the canvas at 390 not judged
// (NOT MEASURABLE when its window is 1440, the builder mobile toggle). No account call, no capability.
import { z } from 'zod';
import { ok, CODES, fail } from './errors.mjs';
import { judgeRenders } from './funnel-render-check.mjs';

// The tool's lead text. describe() ships the longer of this and the catalogue lead (tool-descriptions.json), so the two MUST be the same
// text: a test pins it (test/render-tool-scope.test.mjs).
export const COMPARE_PAGE_RENDERS_LEAD = 'Judge a funnel page\'s renders: preview against live at 1440 and 390 px (must match); the builder canvas against the public page at 1440 px on structure and layout only (builder chrome and editor styles listed, not failing); the canvas at 390 px is not judged, because the builder mobile toggle keeps the window at 1440. Returns a verdict (match, differs or incomplete) and each scope\'s result';

const SURFACE = z.record(z.any()).describe('one surface: {"1440": probe, "390": probe}; a probe is {width, origin, nodes} as PROBE_SOURCE returns. The canvas may omit "390" (the builder mobile toggle cannot be measured at 390)');

export function makeFunnelRenderTools({ describe, schema, guard }) {
  return [
    {
      name: 'compare_page_renders',
      description: describe('compare_page_renders', COMPARE_PAGE_RENDERS_LEAD),
      inputSchema: schema({
        probes: z.object({ canvas: SURFACE, preview: SURFACE, live: SURFACE })
          .describe('the probe sets, measured in the browser with PROBE_SOURCE (references/render-check.md): canvas at 1440 (and 390 only as a probe it can make), preview and live at 1440 and 390'),
        tolerancePx: z.number().min(0).max(20).optional().describe('position and size tolerance in px (default 2)'),
      }),
      capabilities: [],
      handler: async (args, deps) => guard(async () => {
        void deps;
        if (!args?.probes || typeof args.probes !== 'object') return fail(CODES.VALIDATION_FAILED, 'probes is required', 'Pass {canvas, preview, live}, each keyed by width.');
        const tolerancePx = args.tolerancePx ?? 2;
        const j = judgeRenders(args.probes, { tolerancePx });
        return ok({ verdict: j.verdict, scopes: j.scopes, notMeasurable: j.notMeasurable, unjudged: j.unjudged, problems: j.problems,
          diffs: j.diffs, missing: j.missing, structure: j.structure,
          scopeNote: 'preview is judged against live at 1440 and 390; the canvas is judged against live at 1440 on structure and layout only; the canvas at 390 is not judged',
          proof: 'engine source', widths: [1440, 390], tolerancePx });
      }, args),
    },
  ];
}
