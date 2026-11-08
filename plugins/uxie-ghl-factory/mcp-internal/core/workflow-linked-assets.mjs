// wf-5 (bl-839): get_workflow_linked_assets, the Workflow Maps "what uses what" read. Handlers read `deps.makeGw` at call time, as in
// workflow-w6c-tools.mjs. One POST route (a search, so it is cleared readOnly below; see location-binding.mjs classifyCall).
//
// The request is the page's own: POST /workflows/es/linked-assets with the 37 asset types the Workflow Maps page sent on 2026-11-08
// (knowledge sniffs/workflows-wf5-2026-11-08/wf5-map-capture.json). The corpus rule (workflow-maps.md, 2026-09-29): unnarrowed, the route
// lists ONLY workflows that use at least one asset, so this is an index of what uses what, never a workflow list.
import { z } from 'zod';
import { ok, fromHttp } from './errors.mjs';

const ROUTE = '/workflows/es/linked-assets';
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;   // the page sent 500 and was answered 201 (2026-11-08); the corpus recorded a cap of 100 on 2026-09-29.
const MAX_PAGES = 100;

// The page's asset-type list (the capture, 2026-11-08).
export const LINKED_ASSET_TYPES = ['tags', 'forms', 'calendars', 'surveys', 'facebookForms', 'tikTokForms', 'triggerLinks', 'users', 'pipelines',
  'pipelineStages', 'funnels', 'funnelPages', 'funnelProducts', 'globalProducts', 'globalProductPrices', 'membershipOffers', 'membershipProducts',
  'membershipCategories', 'videos', 'templates', 'quizzes', 'certificateTemplates', 'customValues', 'contactCustomFields', 'opportunityCustomFields',
  'invoiceTemplates', 'customObjects', 'adAccounts', 'membershipLessons', 'workflowLinks', 'estimateTemplates', 'aiStudioProjects', 'services',
  'listings', 'listingCategories', 'chatWidgets', 'facebookPages'];

const DESCRIPTION = 'Which workflows use which assets (tags, forms, calendars, pipelines, custom values and so on), by step: POST /workflows/es/linked-assets, '
  + 'the route behind the Workflow Maps page. Pages by searchAfter until the rows reach count; complete:false when the walk stopped short. '
  + 'workflowIds narrows the read (a named workflow comes back even when it uses no asset); forAsset {type, value} keeps only the workflows that use '
  + 'that asset (value matches an id or a name, case-insensitive). '
  + 'includeWorkflowsWithoutAssets (default false, sent explicitly): with false, an unnarrowed read lists only workflows that use at least one asset '
  + '(measured 2026-11-08: count 998, no asset-less row in the first 200); with true, the route also lists asset-less workflows (count 1774, '
  + '63 asset-less rows in the same first 200). So the default answers "what uses what", not "how many workflows": count workflows with list_workflows. '
  + 'Reads only (risk: read). (proof: live 2026-11-08 on GROM Sandbox, 201 for pageLimit 500 and 100; the flag measured both ways, '
  + 'knowledge sniffs/workflows-wf5-2026-11-08/live-wf5-flag-2026-11-08.json; corpus workflow-maps.md, proven-live 2026-09-29.)';

// Each linkedAssets row becomes one `uses` entry, keyed by the step. A tag an if/else tests is listed under type 'tags' like the tag step.
function usesOf(wf) {
  const out = [];
  for (const list of Object.values(wf?.linkedAssets ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      out.push({ stepId: row.stepId ?? null, stepName: row.name ?? null, docKey: row.docKey ?? null, type: row.type ?? null, values: row.values ?? [] });
    }
  }
  return out;
}

const matchesAsset = (use, asset) => use.type === asset.type
  && use.values.some((v) => String(v?.id) === asset.value || String(v?.name ?? '').toLowerCase() === asset.value.toLowerCase());

export function makeLinkedAssetsTools(deps) {
  const { describe, schema, guard } = deps;
  return [
    {
      name: 'get_workflow_linked_assets',
      description: describe('get_workflow_linked_assets', DESCRIPTION),
      inputSchema: schema({
        locationId: z.string(),
        workflowIds: z.array(z.string()).optional(),
        forAsset: z.object({ type: z.string(), value: z.string() }).optional(),
        pageLimit: z.number().int().positive().optional(),
        includeWorkflowsWithoutAssets: z.boolean().optional(),
      }),
      capabilities: [{ method: 'POST', path: ROUTE }],
      // Verified read: the one POST is a search (the page's linked-assets read), cleared one tool at a time like find_workflows_using.
      readOnly: true,
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const pageLimit = Number.isInteger(args.pageLimit) && args.pageLimit > 0 ? Math.min(args.pageLimit, MAX_PAGE) : DEFAULT_PAGE;
        const base = {
          locationId: args.locationId,
          assetTypes: LINKED_ASSET_TYPES,
          pageLimit,
          includeWorkflowsWithoutAssets: args.includeWorkflowsWithoutAssets === true,
        };
        if (Array.isArray(args.workflowIds)) base.workflowIds = args.workflowIds;

        const rows = [];
        const seen = new Set();
        let count = null;
        let searchAfter = undefined;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const body = searchAfter === undefined ? base : { ...base, searchAfter };
          const r = await gw.call('POST', ROUTE, body);
          if (!r.ok) return fromHttp(r.status, r.json);
          const list = Array.isArray(r.json?.workflows) ? r.json.workflows : [];
          if (typeof r.json?.count === 'number') count = r.json.count;
          let added = 0;
          for (const wf of list) {
            const k = wf?.id ?? JSON.stringify(wf);
            if (!seen.has(k)) { seen.add(k); rows.push(wf); added += 1; }
          }
          if (count !== null && rows.length >= count) break;                       // the rows reach count: the walk is done
          const next = r.json?.searchAfter;
          if (!Array.isArray(next) || next.length === 0) break;                    // the route ends the walk
          if (list.length === 0 || added === 0) break;                             // a page that adds nothing (cursor ignored) stops it
          searchAfter = next;
        }

        let workflows = rows.map((wf) => ({ id: wf.id, name: wf.name ?? null, status: wf.status ?? null, parentId: wf.parentId ?? null, uses: usesOf(wf) }));
        if (args.forAsset) workflows = workflows.filter((w) => w.uses.some((u) => matchesAsset(u, args.forAsset)));
        const complete = count !== null && rows.length >= count;
        return ok({ count, complete, workflows, ...(args.forAsset ? { forAsset: args.forAsset } : {}) });
      }),
    },
  ];
}
