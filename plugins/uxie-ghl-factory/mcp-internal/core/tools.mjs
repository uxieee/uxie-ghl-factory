// Transport-blind tool definitions. Descriptions are pulled from the docs
// repo's generated catalog so proof status and risk reach the agent verbatim.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ok, fail, fromHttp, CODES } from './errors.mjs';
import { authStatus, DEFAULT_TOKEN_FILE, readCredentials } from './auth.mjs';

const DOCS_CATALOG = '/Volumes/Xander SSD/Vibe Code/Misc/ghl-workflow-api-docs/catalog/tool-descriptions.json';
let CATALOG = {};
try { CATALOG = JSON.parse(readFileSync(DOCS_CATALOG, 'utf8')); } catch { CATALOG = {}; }
const describe = (tool, fallback) => CATALOG[tool]?.description ?? fallback;

// A path that looks like a JWT is a token someone pasted into the wrong field.
// Refuse it WITHOUT echoing the value back — echoing would put the credential in
// the transcript, which is the exact thing the file-based design exists to avoid.
const LOOKS_LIKE_TOKEN = /(^|[^A-Za-z0-9])ey[A-Za-z0-9._-]{20,}/;

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
    inputSchema: { path: z.string().describe('Absolute path to the capture file — a PATH, never a token') },
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      const path = args?.path;
      const state = deps?.state ?? {};
      if (typeof path !== 'string' || path.length === 0) {
        return fail(CODES.TOKEN_MISSING, 'set_token_file requires a "path" string',
          `Pass the capture file's path (default ${DEFAULT_TOKEN_FILE}).`);
      }
      if (LOOKS_LIKE_TOKEN.test(path)) {
        // Never include `path` in this message — it IS the credential.
        return fail(CODES.TOKEN_MISSING, 'the value passed looks like a JWT, not a file path (value withheld)',
          'Save the captured "Authorization: Bearer …" line to a FILE and pass that file\'s path. Tokens must never be passed as arguments.');
      }
      // Validate by actually reading before committing it to state, so a bad path
      // fails loudly here rather than at the first tool call. readCredentials throws
      // AuthError, which guard maps to a top-level failure (not ok:true).
      readCredentials({ tokenFile: path });
      state.tokenFile = path;
      return ok(authStatus(state));
    }),
  },
  {
    name: 'auth_status',
    description: 'Report credential state: JWT presence/expiry (claims only, never the token), token-id availability, and the engine build this server was made from.',
    inputSchema: {},
    capabilities: [],
    handler: async (_args, { state }) => guard(async () => ok(authStatus(state))),
  },
  {
    name: 'list_workflows',
    description: describe('list_workflows', 'List workflows in a location.'),
    inputSchema: {
      locationId: z.string(),
      status: z.enum(['published', 'draft']).optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
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

export function registerTools(server, deps, tools = TOOLS) {
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema },
      async (args) => {
        const result = await t.handler(args ?? {}, deps);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      });
  }
}
