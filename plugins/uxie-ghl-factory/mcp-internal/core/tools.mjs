// Transport-blind tool definitions. Descriptions are pulled from the docs
// repo's generated catalog so proof status and risk reach the agent verbatim.
import { readFileSync } from 'node:fs';
import { ok, fail, fromHttp, CODES } from './errors.mjs';
import { authStatus, DEFAULT_TOKEN_FILE } from './auth.mjs';

const DOCS_CATALOG = '/Volumes/Xander SSD/Vibe Code/Misc/ghl-workflow-api-docs/catalog/tool-descriptions.json';
let CATALOG = {};
try { CATALOG = JSON.parse(readFileSync(DOCS_CATALOG, 'utf8')); } catch { CATALOG = {}; }
const describe = (tool, fallback) => CATALOG[tool]?.description ?? fallback;

// Run a handler body, mapping AuthError/engine throws onto the error contract.
export async function guard(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.code && e?.remediation) return fail(e.code, e.detail ?? e.message, e.remediation);
    return fail(CODES.ENGINE_ABORT, e?.message ?? String(e), 'Engine threw — inspect detail; this is usually a spec or dependency problem.');
  }
}

export const TOOLS = [
  {
    name: 'set_token_file',
    description: `Point the server at the capture file holding the GHL JWT (and optional token-id). Path only — never paste a token. Default: ${DEFAULT_TOKEN_FILE}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to the capture file' } }, required: ['path'] },
    capabilities: [],
    handler: async ({ path }, { state }) => guard(async () => { state.tokenFile = path; return ok(authStatus(state)); }),
  },
  {
    name: 'auth_status',
    description: 'Report credential state: JWT presence/expiry (claims only, never the token), token-id availability, and the engine build this server was made from.',
    inputSchema: { type: 'object', properties: {} },
    capabilities: [],
    handler: async (_args, { state }) => guard(async () => ok(authStatus(state))),
  },
  {
    name: 'list_workflows',
    description: describe('list_workflows', 'List workflows in a location.'),
    inputSchema: {
      type: 'object',
      properties: {
        locationId: { type: 'string' },
        status: { type: 'string', enum: ['published', 'draft'] },
        search: { type: 'string' },
        limit: { type: 'number', default: 100 },
        offset: { type: 'number', default: 0 },
      },
      required: ['locationId'],
    },
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const q = new URLSearchParams({
        type: 'workflow', limit: String(args.limit ?? 100), offset: String(args.offset ?? 0),
        sortBy: 'name', sortOrder: 'asc', includeCustomObjects: 'true', includeObjectiveBuilder: 'true',
      });
      if (args.status) q.set('status', args.status);
      if (args.search) q.set('search', args.search);
      const r = await gw.call('GET', `/workflow/${args.locationId}/list?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = (r.json.rows ?? []).map((w) => ({ id: w._id ?? w.id, name: w.name, status: w.status, version: w.version, updatedAt: w.updatedAt }));
      return ok({ count: r.json.count ?? rows.length, workflows: rows });
    }),
  },
];

export function registerTools(server, deps) {
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema },
      async (args) => {
        const result = await t.handler(args ?? {}, deps);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      });
  }
}
