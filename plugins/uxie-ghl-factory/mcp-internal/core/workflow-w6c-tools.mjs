// w6c-6 (plan Task 6, bl-788): the A/B Test tools. Replaces the p2 seam stub. Handlers read `deps.makeGw` at call time (the registry
// passes it to each handler as the second argument). Pure rollup and query helpers live in ab-test.mjs.
//
// Gates (plan Task 6): get_ab_test_stats reads contacts in a PUBLISHED A/B workflow (gate G1). declare_ab_test_winner routes live
// contacts (gate G2, Xander's). Neither is run by the tests; both are prepared in the lane's gates folder.
import { z } from 'zod';
import { ok, fail, fromHttp, CODES } from './errors.mjs';
import { pathIdsQuery, rollupAbStats, declareWinnerRequest, DECLARE_PREVIEW } from './ab-test.mjs';
import { checkHeatMapWindow, rollupEnrollmentCounts, windowGuard } from './workflow-heat-map.mjs';
import { makeLinkedAssetsTools } from './workflow-linked-assets.mjs';   // wf-5 (bl-839): spread here so the seam wiring of tools.mjs is unchanged

// The pathIds serialisation is proven live (G1, 2026-11-07): GHL reads the repeated form (200); the csv form returns 500. The bracket form
// also returns 200 with the same numbers; ab-test.mjs pins all three in tests.
const AB_PATHIDS_FORM = 'repeated';

const STATS_DESCRIPTION = 'Read an A/B Test step: contacts entered, converted and rate for each path (an unknown count stays unknown, not zero), '
  + 'the path names, the paths the stats did not report (absent), the winning path if one stands, and the step status. Reads only; '
  + 'it changes nothing. (proof: capture-only until gate G1 reads a published A/B workflow with contacts in it.) A draft has no stats.';

const DECLARE_DESCRIPTION = 'Declare the leading path of an A/B Test the winner: every NEW contact is routed to it from then on. '
  + 'Without confirm: true it returns CONFIRM_REQUIRED with a preview and makes no request. A winner already declared returns '
  + 'WINNER_ALREADY_DECLARED. (proof: capture-only until gate G2.) Risk: destructive; it routes live contacts and cannot be undone in the UI.';

export function makeW6cTools(deps) {
  const { describe, schema, guard } = deps;
  const stepPathOf = (wf, stepId) => (wf?.workflowData?.templates ?? []).find((t) => t.id === stepId && t.type === 'workflow_ab_test');

  return [
    {
      name: 'get_ab_test_stats',
      description: describe('get_ab_test_stats', STATS_DESCRIPTION),
      inputSchema: schema({ locationId: z.string(), workflowId: z.string(), stepId: z.string() }),
      capabilities: [
        { method: 'GET', path: '/workflow/{loc}/{wid}' },
        { method: 'GET', path: '/workflow/{loc}/split/stats' },
        { method: 'GET', path: '/workflow/{loc}/split/isExecuted' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        const loc = encodeURIComponent(args.locationId);
        const wid = encodeURIComponent(args.workflowId);
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const wf = await gw.call('GET', `/workflow/${loc}/${wid}`);
        if (!wf.ok) return fromHttp(wf.status, wf.json);
        const step = stepPathOf(wf.json, args.stepId);
        if (!step) return fail(CODES.VALIDATION_FAILED, `no A/B Test step '${args.stepId}' in this workflow`, 'Use the step id of a workflow_ab_test step.');
        const pathIds = (step.attributes?.paths ?? []).map((p) => p.id);
        const query = `workflowId=${wid}&stepId=${encodeURIComponent(args.stepId)}`;
        const stats = await gw.call('GET', `/workflow/${loc}/split/stats?${query}&${pathIdsQuery(pathIds, AB_PATHIDS_FORM)}`);
        if (!stats.ok) return fromHttp(stats.status, stats.json);
        const exec = await gw.call('GET', `/workflow/${loc}/split/isExecuted?${query}`);
        if (!exec.ok) return fromHttp(exec.status, exec.json);
        return ok({ stepId: args.stepId, ...rollupAbStats(stats.json, step.attributes?.paths ?? [], exec.json) });
      }),
    },
    {
      name: 'declare_ab_test_winner',
      description: describe('declare_ab_test_winner', DECLARE_DESCRIPTION),
      inputSchema: schema({ locationId: z.string(), workflowId: z.string(), stepId: z.string(), confirm: z.boolean().optional() }),
      capabilities: [{ method: 'POST', path: '/workflow/{loc}/split/ab-test/declare-winner' }],
      handler: async (args, handlerDeps) => guard(async () => {
        // Without confirm the house CONFIRM_REQUIRED preview: no gateway is made, so no request can leave.
        if (args.confirm !== true) return {
          ...fail(CODES.CONFIRM_REQUIRED, 'declare_ab_test_winner preview is ready; no write was sent.',
            'Repeat with confirm:true to declare the winner. Every new contact then goes to the leading path, and the UI cannot undo it.'),
          data: { preview: DECLARE_PREVIEW },
        };
        const req = declareWinnerRequest(args.locationId, args.workflowId, args.stepId);
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const res = await gw.call(req.method, `${req.path}?${req.query}`, req.body);
        if (res.status === 409) return fail(CODES.WINNER_ALREADY_DECLARED, 'a winner is already declared for this A/B Test',
          'Read the stats with get_ab_test_stats; the winner stands until the test is reset by a build or edit with resetTestRun.');
        if (!res.ok) return fromHttp(res.status, res.json);
        return ok({ declared: true, workflowId: args.workflowId, stepId: args.stepId });
      }),
    },
    {
      name: 'list_ai_agent_skills',
      description: describe('list_ai_agent_skills', 'List the location\'s AI Agent skill library: a complete walk of every page (at most 100 a page), '
        + 'or, with ids, a resolve of up to ten skill ids. Reads only. complete:false means the walk stopped short, never a partial '
        + 'count of the whole library. (proof: capture-only until a live read on a sandbox after the 2026-10-27 gate.)'),
      inputSchema: schema({ locationId: z.string(), ids: z.array(z.string()).optional() }),
      capabilities: [
        { method: 'GET', path: '/workflow/agent/{loc}/skills' },
        { method: 'GET', path: '/workflow/agent/{loc}/skills/resolve' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        const loc = encodeURIComponent(args.locationId);
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        // Every response is wrapped {success, data}; success:false can arrive with a 2xx (corpus agent-skills.md).
        const unwrap = (r) => (r.json && typeof r.json === 'object' && 'success' in r.json ? (r.json.success === true ? r.json.data : undefined) : r.json);
        if (Array.isArray(args.ids)) {
          if (args.ids.length > 10) return fail(CODES.VALIDATION_FAILED, `resolve takes at most ten skill ids; got ${args.ids.length}`,
            'Resolve in batches of ten.');
          if (args.ids.length === 0) return ok({ resolved: [], unresolved: [], libraryTotal: 0 });
          const r = await gw.call('GET', `/workflow/agent/${loc}/skills/resolve?ids=${args.ids.map((i) => encodeURIComponent(i)).join(',')}`);
          if (!r.ok) return fromHttp(r.status, r.json);
          const data = unwrap(r);
          if (!data) return fail(CODES.VERIFY_FAILED, 'the skills resolve answered success:false', 'Re-read the library; the skills service may not be live on this account.');
          const found = new Set((data.skills ?? []).map((s) => s.id));
          return ok({ resolved: (data.skills ?? []), unresolved: args.ids.filter((i) => !found.has(i)), libraryTotal: data.libraryTotal ?? null });
        }
        const skills = [];
        let total = null;
        for (let page = 1; page <= 50; page += 1) {
          const r = await gw.call('GET', `/workflow/agent/${loc}/skills?page=${page}&limit=100`);
          if (!r.ok) return fromHttp(r.status, r.json);
          const data = unwrap(r);
          if (!data) return fail(CODES.VERIFY_FAILED, 'the skills list answered success:false', 'Re-read the library; the skills service may not be live on this account.');
          const items = data.items ?? [];
          total = data.total ?? total;
          skills.push(...items);
          if (items.length === 0 || (total !== null && skills.length >= total)) break;
        }
        return ok({ skills, total, complete: total !== null && skills.length >= total });
      }),
    },
    // w6c-9 (bl-789): the read tools. Every one is a GET. Proof labels follow the live reads recorded in knowledge gates/w6c-9-live-reads.json.
    {
      name: 'get_workflow_heat_map',
      description: describe('get_workflow_heat_map', 'Enrollment counts per workflow over a window of at most 60 days (GET /workflows/logs/enrollment-counts). '
        + 'A requested workflow the response does not name is absent, never zero. Reads only. (proof: live-read 2026-11-07 on GROM Sandbox, 200, '
        + '27 rows of {workflowId, count}; gates/w6c-9-live-reads.json.)'),
      inputSchema: schema({ locationId: z.string(), fromDate: z.number(), toDate: z.number(), workflowIds: z.array(z.string()).optional() }),
      capabilities: [{ method: 'GET', path: '/workflows/logs/enrollment-counts' }],
      handler: async (args, handlerDeps) => guard(async () => {
        try { windowGuard(args.fromDate, args.toDate); } catch (e) { return fail(e.code, e.message, 'Choose a window of at most 60 days ending after it starts.'); }
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const q = `locationId=${encodeURIComponent(args.locationId)}&fromDate=${encodeURIComponent(new Date(args.fromDate).toISOString())}&toDate=${encodeURIComponent(new Date(args.toDate).toISOString())}`;
        const r = await gw.call('GET', `/workflows/logs/enrollment-counts?${q}`);
        if (!r.ok) return fromHttp(r.status, r.json);
        return ok(rollupEnrollmentCounts(r.json, { workflowIds: args.workflowIds ?? null, fromDate: args.fromDate, toDate: args.toDate }));
      }),
    },
    {
      name: 'get_contact_workflow_journey',
      description: describe('get_contact_workflow_journey', 'The workflows one contact has been in and each one\'s status (GET statuses_v2). Use this for the journey; '
        + 'get_contact_workflow_history is the other read. Reads only. (proof: live-read 2026-11-07 on GROM Sandbox, 200, workflowStatuses carried.)'),
      inputSchema: schema({ locationId: z.string(), contactId: z.string() }),
      capabilities: [{ method: 'GET', path: '/workflow/{loc}/contact/{contactId}/statuses_v2' }],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const r = await gw.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/contact/${encodeURIComponent(args.contactId)}/statuses_v2`);
        if (!r.ok) return fromHttp(r.status, r.json);
        const rows = r.json?.workflowStatuses ?? [];
        const count = r.json?.count ?? null;
        // A count that differs from the rows is an incomplete read, never a silent partial list.
        return ok({ count, workflowStatuses: rows, complete: count === null ? false : count === rows.length });
      }),
    },
    {
      name: 'list_workflow_test_runs',
      description: describe('list_workflow_test_runs', 'The test runs of one workflow, newest first, one page of ten (GET event-runs). Reads only; it starts nothing. '
        + '(proof: live-read 2026-11-07 on GROM Sandbox, 200, an empty list for a workflow with no test runs.)'),
      inputSchema: schema({ locationId: z.string(), workflowId: z.string(), lastDocumentId: z.string().optional() }),
      capabilities: [{ method: 'GET', path: '/workflow/{loc}/test-workflow/{wf}/event-runs' }],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const more = args.lastDocumentId ? `&lastDocumentID=${encodeURIComponent(args.lastDocumentId)}` : '';
        const r = await gw.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/test-workflow/${encodeURIComponent(args.workflowId)}/event-runs?limit=10${more}`);
        if (!r.ok) return fromHttp(r.status, r.json);
        return ok({ runs: r.json?.runs ?? [], hasMore: r.json?.hasMore ?? null, lastDocumentId: r.json?.lastDocumentId ?? null });
      }),
    },
    {
      name: 'get_step_latest_test_result',
      description: describe('get_step_latest_test_result', 'The latest pinned test result of one step (GET latest-result). A workflow with no test result answers present:false with the '
        + 'reason, which is a proven absence, not an error. Reads only. (proof: live-read 2026-11-07 on GROM Sandbox, 404 "no test result for this step".)'),
      inputSchema: schema({ locationId: z.string(), workflowId: z.string(), stepId: z.string() }),
      capabilities: [{ method: 'GET', path: '/workflow/{loc}/test-workflow/{wf}/steps/{stepId}/latest-result' }],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const r = await gw.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/test-workflow/${encodeURIComponent(args.workflowId)}/steps/${encodeURIComponent(args.stepId)}/latest-result?testType=pinned`);
        if (r.status === 404 && typeof r.json?.msg === 'string' && /no test result/i.test(r.json.msg)) return ok({ present: false, reason: r.json.msg });
        if (!r.ok) return fromHttp(r.status, r.json);
        return ok({ present: true, result: r.json });
      }),
    },
    {
      name: 'get_workflow_test_run',
      description: describe('get_workflow_test_run', 'One test run: its progress (GET runs/{requestId}) and, when a stepId is given, that step\'s events (GET step-events). '
        + 'Reads only. A run exists only after a test run is started (send-class, not started here). Not live-proven yet: the live proof waits for a run (w6c-11). '
        + '(proof: source-only until a live run is read.)'),
      inputSchema: schema({ locationId: z.string(), requestId: z.string(), stepId: z.string().optional() }),
      capabilities: [
        { method: 'GET', path: '/workflow/{loc}/test-workflow/runs/{requestId}' },
        { method: 'GET', path: '/workflow/{loc}/test-workflow/runs/{requestId}/step-events' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const base = `/workflow/${encodeURIComponent(args.locationId)}/test-workflow/runs/${encodeURIComponent(args.requestId)}`;
        const run = await gw.call('GET', base);
        if (!run.ok) return fromHttp(run.status, run.json);
        let stepEvents = null;
        if (args.stepId) {
          const ev = await gw.call('GET', `${base}/step-events?stepId=${encodeURIComponent(args.stepId)}`);
          if (!ev.ok) return fromHttp(ev.status, ev.json);
          stepEvents = ev.json ?? null;
        }
        return ok({ progress: run.json ?? null, stepEvents });
      }),
    },
    {
      name: 'list_workflow_error_notifications',
      description: describe('list_workflow_error_notifications', 'The workflow error notifications for the location (GET error-notification/list?skip&limit). The route answers 500 WITHOUT skip and limit '
        + '(live 2026-11-08, 3 of 3) and 200 with {list, totalCount} with them, so this pages by skip until totalCount (page size 100 by default). '
        + 'complete:true only when the rows reach totalCount. A failing page is an error, never retried. Reads only. (proof: live 2026-11-08, bl-838.)'),
      inputSchema: schema({ locationId: z.string(), limit: z.number().int().positive().optional() }),
      capabilities: [{ method: 'GET', path: '/workflow/{loc}/error-notification/list' }],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 100;
        const rows = [];
        const seen = new Set();
        let total = null;
        for (let page = 0; page < 100; page++) {
          const skip = page * limit;
          const q = new URLSearchParams({ skip: String(skip), limit: String(limit) });
          const r = await gw.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/error-notification/list?${q}`);
          if (!r.ok) return fromHttp(r.status, r.json);
          if (Array.isArray(r.json)) { rows.push(...r.json); break; }   // the older bare-array shape: no total, one read
          const list = Array.isArray(r.json?.list) ? r.json.list : [];
          if (typeof r.json?.totalCount === 'number') total = r.json.totalCount;
          let added = 0;
          for (const n of list) { const k = n?.id ?? JSON.stringify(n); if (!seen.has(k)) { seen.add(k); rows.push(n); added += 1; } }
          if (total !== null && rows.length >= total) break;
          if (list.length < limit || added === 0) break;   // a short page ends the walk; a page that adds nothing (skip ignored) stops it
        }
        return ok({ notifications: rows, totalCount: total, complete: total !== null && rows.length >= total });
      }),
    },
    ...makeLinkedAssetsTools(deps),
  ];
}
