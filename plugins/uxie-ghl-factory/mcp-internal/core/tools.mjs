// Transport-blind tool definitions. Descriptions are pulled from the docs
// repo's generated catalog so proof status and risk reach the agent verbatim.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ok, fail, fromHttp, CODES, containsSecrets } from './errors.mjs';
import { authStatus, DEFAULT_TOKEN_FILE, readCredentials } from './auth.mjs';
import { fetchEntities } from '../../skills/create-ghl-workflow/engine/orchestrate.mjs';

const DOCS_CATALOG = '/Volumes/Xander SSD/Vibe Code/Misc/ghl-workflow-api-docs/catalog/tool-descriptions.json';
let CATALOG = {};
try { CATALOG = JSON.parse(readFileSync(DOCS_CATALOG, 'utf8')); } catch { CATALOG = {}; }
const describe = (tool, fallback) => CATALOG[tool]?.description ?? fallback;

const SCHEMA_KEYS = new WeakMap();
const schema = (shape) => {
  // Passthrough is deliberate: strict Zod validation includes an unknown property
  // name in the SDK's protocol error, which leaks a credential used as that key.
  // Known fields remain SDK-validated; unknowns are rejected below with a fixed,
  // non-echoing tool contract before any handler or state mutation runs.
  const inputSchema = z.object(shape).passthrough();
  SCHEMA_KEYS.set(inputSchema, new Set(Object.keys(shape)));
  return inputSchema;
};

const credentialFailure = (code = CODES.VALIDATION_FAILED) => fail(
  code,
  'a tool argument contains a credential-looking value (value withheld)',
  'Remove credentials from tool arguments. Authentication comes only from the configured token file.',
);

function validateRegisteredArgs(tool, args) {
  // Secret detection MUST precede unknown-key validation so neither keys nor
  // values can be reflected by an SDK/Zod error or our own response.
  if (containsSecrets(args)) {
    return credentialFailure(tool.name === 'set_token_file' ? CODES.TOKEN_MISSING : CODES.VALIDATION_FAILED);
  }
  const allowed = SCHEMA_KEYS.get(tool.inputSchema) ?? new Set();
  if (Object.keys(args).some((key) => !allowed.has(key))) {
    return fail(
      CODES.VALIDATION_FAILED,
      'tool arguments contain unsupported fields (names withheld)',
      'Remove fields not declared by this tool schema and retry.',
    );
  }
  return null;
}

// Run a handler body, mapping AuthError/engine throws onto the error contract.
export async function guard(fn, args, { credentialCode = CODES.VALIDATION_FAILED } = {}) {
  try {
    if (containsSecrets(args)) {
      return credentialFailure(credentialCode);
    }
    return await fn();
  }
  catch (e) {
    if (e?.code && e?.remediation) return fail(e.code, e.detail ?? e.message, e.remediation);
    return fail(CODES.ENGINE_ABORT, e?.message ?? String(e), 'Engine threw — inspect detail; this is usually a spec or dependency problem.');
  }
}

export const TOOLS = [
  {
    name: 'set_token_file',
    description: `Point the server at the capture file holding the GHL JWT (and optional token-id). Path only — never paste a token. Default: ${DEFAULT_TOKEN_FILE}`,
    inputSchema: schema({ path: z.string().describe('Absolute path to the capture file — a PATH, never a token') }),
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      const path = args?.path;
      const state = deps?.state ?? {};
      if (typeof path !== 'string' || path.length === 0) {
        return fail(CODES.TOKEN_MISSING, 'set_token_file requires a "path" string',
          `Pass the capture file's path (default ${DEFAULT_TOKEN_FILE}).`);
      }
      // Validate by actually reading before committing it to state, so a bad path
      // fails loudly here rather than at the first tool call. readCredentials throws
      // AuthError, which guard maps to a top-level failure (not ok:true).
      readCredentials({ tokenFile: path });
      state.tokenFile = path;
      return ok(authStatus(state));
    }, args, { credentialCode: CODES.TOKEN_MISSING }),
  },
  {
    name: 'auth_status',
    description: 'Report credential state: JWT presence/expiry (claims only, never the token), token-id availability, and the engine build this server was made from.',
    inputSchema: schema({}),
    capabilities: [],
    handler: async (args, deps) => guard(async () => ok(authStatus(deps?.state ?? {})), args),
  },
  {
    name: 'list_workflows',
    description: describe('list_workflows', 'List workflows in a location.'),
    inputSchema: schema({
      locationId: z.string(),
      status: z.enum(['published', 'draft']).optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }),
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const q = new URLSearchParams({
        type: 'workflow', limit: String(args.limit ?? 100), offset: String(args.offset ?? 0),
        sortBy: 'name', sortOrder: 'asc', includeCustomObjects: 'true', includeObjectiveBuilder: 'true',
      });
      if (args.status) q.set('status', args.status);
      if (args.search) q.set('search', args.search);
      const r = await gw.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/list?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = (r.json.rows ?? []).map((w) => ({ id: w._id ?? w.id, name: w.name, status: w.status, version: w.version, updatedAt: w.updatedAt }));
      return ok({ count: r.json.count ?? rows.length, workflows: rows });
    }, args),
  },
  {
    name: 'get_workflow',
    description: describe('get_workflow', 'Get one workflow summary.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
    }),
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/{wid}' }],
    handler: async (args, deps) => guard(async () => {
      const locationId = encodeURIComponent(args.locationId);
      const workflowId = encodeURIComponent(args.workflowId);
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const response = await gw.call(
        'GET',
        `/workflow/${locationId}/${workflowId}?includeScheduledPauseInfo=true`,
      );
      if (!response.ok) return fromHttp(response.status, response.json);
      const workflow = response.json;
      return ok({
        id: workflow._id ?? workflow.id,
        name: workflow.name,
        status: workflow.status,
        version: workflow.version,
        stepCount: (workflow.workflowData?.templates ?? []).length,
        updatedAt: workflow.updatedAt,
        note: 'Summary only — use export_workflow for the full graph.',
      });
    }, args),
  },
  {
    name: 'export_workflow',
    description: describe('export_workflow', 'Export the full workflow body, triggers and sticky notes.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflows/sticky-notes-all' },
    ],
    handler: async (args, deps) => guard(async () => {
      const locationId = encodeURIComponent(args.locationId);
      const workflowId = encodeURIComponent(args.workflowId);
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const body = await gw.call(
        'GET',
        `/workflow/${locationId}/${workflowId}?includeScheduledPauseInfo=true`,
      );
      if (!body.ok) return fromHttp(body.status, body.json);

      const query = new URLSearchParams({ workflowId: args.workflowId });
      const notesQuery = new URLSearchParams({
        workflowId: args.workflowId,
        locationId: args.locationId,
      });
      const [triggers, notes] = await Promise.all([
        gw.call('GET', `/workflow/${locationId}/trigger?${query}`),
        gw.call('GET', `/workflows/sticky-notes-all?${notesQuery}`),
      ]);
      if (!triggers.ok) return fromHttp(triggers.status, triggers.json);
      if (!notes.ok) return fromHttp(notes.status, notes.json);

      return ok({
        workflow: body.json,
        triggers: triggers.json?.triggers ?? triggers.json ?? [],
        stickyNotes: notes.json?.notes ?? notes.json ?? [],
      });
    }, args),
  },
  {
    name: 'get_workflow_logs',
    description: describe('get_workflow_logs', 'Read executions, enrollment and per-step contact counts.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      limit: z.number().int().positive().default(20),
    }),
    capabilities: [
      { method: 'GET', path: '/workflows/logs/v2' },
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
      { method: 'GET', path: '/workflows/status/search/workflow-with-filter' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const limit = args.limit ?? 20;
      const baseQuery = new URLSearchParams({
        workflowId: args.workflowId,
        locationId: args.locationId,
      });
      const logsQuery = new URLSearchParams(baseQuery);
      logsQuery.set('limit', String(limit));
      const enrollmentQuery = new URLSearchParams(baseQuery);
      enrollmentQuery.set('action', 'first');
      enrollmentQuery.set('limit', String(limit));

      const [logs, counts, enrolled] = await Promise.all([
        gw.call('GET', `/workflows/logs/v2?${logsQuery}`),
        gw.call('GET', `/workflows/status/search/count-per-step?${baseQuery}`),
        gw.call('GET', `/workflows/status/search/workflow-with-filter?${enrollmentQuery}`),
      ]);
      if (!logs.ok) return fromHttp(logs.status, logs.json);
      if (!counts.ok) return fromHttp(counts.status, counts.json);
      if (!enrolled.ok) return fromHttp(enrolled.status, enrolled.json);

      return ok({
        logs: logs.json?.logs ?? logs.json ?? [],
        perStepCounts: counts.json?.counts ?? counts.json ?? [],
        enrollments: enrolled.json?.rows ?? enrolled.json?.statuses ?? enrolled.json ?? [],
        note: 'added_to_workflow in logs is the ONLY proof a trigger fired.',
      });
    }, args),
  },
  {
    name: 'list_account_entities',
    description: describe(
      'list_account_entities',
      'Sweep pipelines, calendars, users, forms, custom fields and AI agents before authoring a workflow spec.',
    ),
    inputSchema: schema({ locationId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/opportunities/pipelines' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/users/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/voice-ai/agents' },
      { method: 'GET', path: '/ai-employees/agents' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      return ok(await fetchEntities(gw));
    }, args),
  },
  {
    name: 'raw_request',
    description: 'Escape hatch for internal endpoints the typed tools do not cover. GET only in this version — writes ship with the confirmation-gated write tools.',
    inputSchema: schema({
      locationId: z.string(),
      method: z.literal('GET'),
      path: z.string().startsWith('/').describe('Internal path beginning with / — the gateway adds the base URL'),
    }),
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      if (args.method !== 'GET') {
        return fail(
          CODES.CONFIRM_REQUIRED,
          `raw_request is GET-only in this build (asked for ${args.method})`,
          'Write support ships with the workflow write tools; use a typed tool or wait for that release.',
        );
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const response = await gw.call('GET', args.path);
      return response.ok
        ? ok({ status: response.status, json: response.json })
        : fromHttp(response.status, response.json);
    }, args),
  },
];

export function registerTools(server, deps, tools = TOOLS) {
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema },
      async (args) => {
        const safeArgs = args ?? {};
        const result = validateRegisteredArgs(t, safeArgs) ?? await t.handler(safeArgs, deps);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      });
  }
}
