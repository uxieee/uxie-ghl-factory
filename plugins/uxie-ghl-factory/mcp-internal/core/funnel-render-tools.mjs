// p2 seam, filled by the funnels lane (W7-3): compare_page_renders — the three-way render check, pure. It takes the probes
// the skill measured in the browser (references/render-check.md) and returns the verdict. No account call, no capability.
import { z } from 'zod';
import { ok, CODES, fail } from './errors.mjs';
import { compareRenders } from './funnel-render-check.mjs';

const SURFACE = z.record(z.any()).describe('one surface: {"1440": probe, "390": probe}; a probe is {origin, nodes} as PROBE_SOURCE returns');

export function makeFunnelRenderTools({ describe, schema, guard }) {
  return [
    {
      name: 'compare_page_renders',
      description: describe('compare_page_renders', 'Compare a funnel page\'s three renders (builder canvas, preview, live) at 1440 and 390 px. Returns a verdict: match, differs or incomplete; incomplete when a width or a node is missing'),
      inputSchema: schema({
        probes: z.object({ canvas: SURFACE, preview: SURFACE, live: SURFACE })
          .describe('the three probe sets, measured in the browser with PROBE_SOURCE (references/render-check.md)'),
        tolerancePx: z.number().min(0).max(20).optional().describe('position and size tolerance in px (default 2)'),
      }),
      capabilities: [],
      handler: async (args, deps) => guard(async () => {
        void deps;
        if (!args?.probes || typeof args.probes !== 'object') return fail(CODES.VALIDATION_FAILED, 'probes is required', 'Pass {canvas, preview, live}, each keyed by width.');
        const r = compareRenders(args.probes, { tolerancePx: args.tolerancePx ?? 2, widths: [1440, 390] });
        return ok({ ...r, proof: 'engine source', widths: [1440, 390], tolerancePx: args.tolerancePx ?? 2 });
      }, args),
    },
  ];
}
