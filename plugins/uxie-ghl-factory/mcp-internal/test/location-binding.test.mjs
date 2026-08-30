// The guard exists because one GHL login serves many client sub-accounts: the JWT carries no
// location claim, so the credential cannot tell clients apart. 39 tools take locationId as a
// free string and 17 of them mutate live accounts. Nothing else separates one client from another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedLocations, classifyCall, checkLocationBinding, locationPositions } from '../core/location-binding.mjs';
import { TOOLS, registerTools } from '../core/tools.mjs';
import { CODES } from '../core/errors.mjs';

const PERMITTED = 'LOCPERMITTED0000001';
const FOREIGN = 'LOCFOREIGN000000001';
const tool = (name) => TOOLS.find((t) => t.name === name);

test('parseAllowedLocations: unset in every shape it can arrive', () => {
  for (const raw of [undefined, null, '', '   ', ',', ' , ']) {
    assert.equal(parseAllowedLocations(raw), null, `${JSON.stringify(raw)} must mean unset`);
  }
});

test('parseAllowedLocations: a set, trimmed, order-independent', () => {
  const s = parseAllowedLocations(` ${PERMITTED} , ${FOREIGN} `);
  assert.equal(s.size, 2);
  assert.ok(s.has(PERMITTED) && s.has(FOREIGN));
});

test('tools that cannot name an account are unguarded', () => {
  for (const name of ['auth_status', 'set_token_file', 'search_step_types',
                      'describe_step_type', 'search_endpoints', 'describe_endpoint']) {
    assert.equal(classifyCall(tool(name), {}), 'unguarded', `${name} must never be guarded`);
  }
});

test('raw_request is classified per call, not by its empty capability list', () => {
  assert.equal(classifyCall(tool('raw_request'), { method: 'GET' }), 'read');
  assert.equal(classifyCall(tool('raw_request'), { method: 'DELETE' }), 'write');
});

test('typed tools are classified by declared capability', () => {
  assert.equal(classifyCall(tool('get_workflow'), {}), 'read');
  assert.equal(classifyCall(tool('build_workflow'), {}), 'write');
});

test('unbound: reads pass, writes refuse with the binding command', () => {
  assert.equal(checkLocationBinding({ tool: tool('get_workflow'), args: { locationId: PERMITTED }, allowed: null }), null);
  const r = checkLocationBinding({ tool: tool('build_workflow'), args: { locationId: PERMITTED }, allowed: null });
  assert.equal(r.code, CODES.LOCATION_UNBOUND);
  assert.match(r.remediation, /GHL_LOCATIONS/);
  assert.match(r.remediation, new RegExp(PERMITTED), 'the refusal must name the attempted location so it is one copy-paste to fix');
});

test('unbound: a raw GET is still usable, a raw DELETE is not', () => {
  assert.equal(checkLocationBinding({ tool: tool('raw_request'), args: { locationId: PERMITTED, method: 'GET', path: '/x' }, allowed: null }), null);
  const r = checkLocationBinding({ tool: tool('raw_request'), args: { locationId: PERMITTED, method: 'DELETE', path: '/x' }, allowed: null });
  assert.equal(r.code, CODES.LOCATION_UNBOUND);
});

test('bound: permitted passes, foreign refuses — on reads as well as writes', () => {
  const allowed = new Set([PERMITTED]);
  assert.equal(checkLocationBinding({ tool: tool('get_workflow'), args: { locationId: PERMITTED }, allowed }), null);
  for (const name of ['get_workflow', 'build_workflow']) {
    const r = checkLocationBinding({ tool: tool(name), args: { locationId: FOREIGN }, allowed });
    assert.equal(r.code, CODES.LOCATION_FORBIDDEN, `${name} must refuse a foreign location`);
  }
});

test('an absent locationId is skipped, not refused', () => {
  // search_merge_tags declares it optional and makes no gateway call without it.
  assert.equal(checkLocationBinding({ tool: tool('search_merge_tags'), args: {}, allowed: new Set([PERMITTED]) }), null);
});

test('INVARIANT: every tool with a capability declares locationId', () => {
  // This is what makes "guard only tools declaring locationId" safe rather than merely convenient.
  // It would fail silently the day a gateway-calling tool is added without the field.
  const offenders = TOOLS
    .filter((t) => (t.capabilities?.length ?? 0) > 0)
    .filter((t) => !Object.keys(t.inputSchema?.shape ?? {}).includes('locationId'))
    .map((t) => t.name);
  assert.deepEqual(offenders, [], 'a tool can reach an account without declaring locationId');
});

import { readFileSync } from 'node:fs';
const ENDPOINTS = JSON.parse(readFileSync(new URL('../catalog/internal-endpoints.json', import.meta.url), 'utf8')).endpoints;
const bound = { allowed: new Set([PERMITTED]), endpoints: ENDPOINTS };
const raw = (over) => ({ tool: tool('raw_request'), args: { locationId: PERMITTED, method: 'GET', path: '/x', ...over }, ...bound });

test('rule 2: a foreign location in the path is refused even when the argument is permitted', () => {
  const r = checkLocationBinding(raw({ path: `/workflow/${FOREIGN}/list` }));
  assert.equal(r.code, CODES.LOCATION_FORBIDDEN);
});

test('rule 2: the permitted location in the same position passes', () => {
  assert.equal(checkLocationBinding(raw({ path: `/workflow/${PERMITTED}/list` })), null);
});

test('rule 2: dot segments are refused AS A REWRITE, on the raw path', () => {
  // new URL() resolves these away, so a checker reading u.pathname sees nothing wrong. The test
  // must run on args.path or this is the exact bypass rule 2 exists to close.
  for (const path of [`/workflow/${PERMITTED}/../${FOREIGN}/list`,
                      `/workflow/${PERMITTED}/%2e%2e/${FOREIGN}/list`,
                      `/workflow/./${FOREIGN}/list`]) {
    assert.equal(checkLocationBinding(raw({ path })).code, CODES.LOCATION_PATH_REWRITE, path);
  }
});

test('rule 2: ordinary paths with spaces, non-ASCII or braces are NOT rewrites', () => {
  for (const path of ['/media/files/My File.png', '/emails/builder/Café', '/a/b^c', '/a/{tpl}/c']) {
    const r = checkLocationBinding(raw({ path }));
    assert.notEqual(r?.code, CODES.LOCATION_PATH_REWRITE, `${path} must not be reported as a rewrite`);
  }
});

test('rule 2: an off-origin path is refused', () => {
  assert.equal(checkLocationBinding(raw({ path: '//evil.example.com/x' })).code, CODES.LOCATION_PATH_REWRITE);
});

test('rule 2: query locationId is checked, including duplicates', () => {
  assert.equal(checkLocationBinding(raw({ path: `/calendars/?locationId=${FOREIGN}` })).code, CODES.LOCATION_FORBIDDEN);
  assert.equal(checkLocationBinding(raw({ path: `/calendars/?location_id=${FOREIGN}` })).code, CODES.LOCATION_FORBIDDEN);
  // .get() would return only the first and pass this.
  assert.equal(checkLocationBinding(raw({ path: `/calendars/?locationId=${PERMITTED}&locationId=${FOREIGN}` })).code,
    CODES.LOCATION_FORBIDDEN, 'every value of a repeated key must be checked');
});

test('rule 2: literal beats parameter — fully literal paths are not treated as locations', () => {
  // Without a specificity rule these unify with a location-bearing template and demand that a
  // literal segment be a permitted location.
  for (const path of ['/locations/search', '/workflows/statistics', '/workflow/oauth2/update-token']) {
    assert.equal(checkLocationBinding(raw({ path })), null, path);
  }
});

test('rule 2: an unrecognised path is allowed when bound', () => {
  // raw_request exists for endpoints the catalogue does not cover, so an unmatched path cannot be
  // refused outright without gutting the tool. Spec §5.4 row 3 additionally wants such a call
  // flagged `locationVerified: false`; that is DEFERRED — see the plan's self-review — because the
  // guard's only return channel is null-or-refusal and a flag needs a handler-side annotation.
  assert.equal(checkLocationBinding(raw({ path: '/no/such/endpoint/anywhere' })), null);
});

test('rule 2: an ambiguous template pair fails closed, per spec §5.3', () => {
  // /lists/dynamic/{smartListId} ties on literal count with /lists/dynamic/{locationId}, so the
  // union rule demands the segment be permitted. The spec sanctions this explicitly: refusing a
  // legitimate smartListId call is the right direction for an escape hatch. Pinned so an
  // implementer does not read it as a broken matcher.
  const r = checkLocationBinding(raw({ path: `/lists/dynamic/${FOREIGN}` }));
  assert.equal(r.code, CODES.LOCATION_FORBIDDEN);
});

test('the agency-wide writes are denylisted, and their sibling reads are not', () => {
  const p = `/workflow/${PERMITTED}/workflow-company-setting/settings`;
  assert.equal(checkLocationBinding(raw({ method: 'PUT', path: p })).code, CODES.LOCATION_DENYLISTED);
  assert.equal(checkLocationBinding(raw({ method: 'GET', path: p })), null, 'reads are unaffected');
});

test('locationPositions: both forms, and neither for a location-free template', () => {
  assert.deepEqual(locationPositions('/workflow/{locationId}/list'), [1]);
  assert.deepEqual(locationPositions('/locations/{id}'), [1]);          // {param} after a literal "locations"
  assert.deepEqual(locationPositions('/funnels/funnel/{id}'), []);
});

test('rule 3: a foreign location nested in the body is refused', () => {
  const r = checkLocationBinding(raw({ method: 'POST', body: { attributes: { locationId: FOREIGN } } }));
  assert.equal(r.code, CODES.LOCATION_FORBIDDEN);
});

test('rule 3: a STRING body is parsed before scanning', () => {
  // raw_request's handler does `if (typeof body === 'string') body = JSON.parse(body)`. Scanning
  // the unparsed string is a one-line escape from this rule.
  const r = checkLocationBinding(raw({ method: 'POST', body: JSON.stringify({ location_id: FOREIGN }) }));
  assert.equal(r.code, CODES.LOCATION_FORBIDDEN);
});

test('rule 3: an unparseable string body is passed through, not refused', () => {
  assert.equal(checkLocationBinding(raw({ method: 'POST', body: 'not json at all' })), null);
});

test('rule 3: a permitted location in the body passes', () => {
  assert.equal(checkLocationBinding(raw({ method: 'POST', body: { locationId: PERMITTED } })), null);
});

test('rule 3: non-string values at a matched key are refused, not ignored', () => {
  // [FOREIGN] is a valid string-ARRAY shape, so it is refused as a FOREIGN ID (the
  // `bad.push({id})` branch). `{ $ne: null }` and `42` are neither a string nor an all-string
  // array, so they are refused as an UNUSABLE SHAPE (the `bad.push({unusable:true})` branch).
  // Both branches return the same CODES.LOCATION_FORBIDDEN -- the code alone does not distinguish
  // "wrong account" from "wrong shape", only `detail` does, so both are asserted here.
  const foreignArray = checkLocationBinding(raw({ method: 'POST', body: { locationId: [FOREIGN] } }));
  assert.equal(foreignArray.code, CODES.LOCATION_FORBIDDEN);
  assert.match(foreignArray.detail, new RegExp(FOREIGN), 'must name the foreign id, not just refuse');

  for (const value of [{ $ne: null }, 42]) {
    const r = checkLocationBinding(raw({ method: 'POST', body: { locationId: value } }));
    assert.equal(r.code, CODES.LOCATION_FORBIDDEN, `locationId: ${JSON.stringify(value)} must not pass silently`);
    assert.match(r.detail, /not a string or list of strings/,
      `locationId: ${JSON.stringify(value)} must be refused as an unusable shape, not a foreign id`);
  }
});

test('rule 3: an array of permitted strings is allowed', () => {
  assert.equal(checkLocationBinding(raw({ method: 'POST', body: { locationId: [PERMITTED] } })), null);
});

test('rule 3: the membership product-clone bypass — a foreign target under `locations` is refused', () => {
  // POST /membership/locations/{locationId}/products/clone/{productId}, body: { locations: string[] }.
  // `locations` names the accounts the product is cloned INTO. Rule 1 sees only the (permitted)
  // source locationId argument, rule 2 sees only {locationId} in the path template (also
  // permitted), and rule 3 previously matched only `locationId`/`location_id` -- so this endpoint,
  // rawCallable with coveredBy:[], let a foreign target through silently. This pins the real
  // catalogue path, not an abstraction of it.
  const r = checkLocationBinding(raw({
    method: 'POST',
    path: `/membership/locations/${PERMITTED}/products/clone/PRODUCT0000000000001`,
    body: { locations: [FOREIGN] },
  }));
  assert.equal(r.code, CODES.LOCATION_FORBIDDEN);
});

test('rule 3: a permitted id under `locations` still passes', () => {
  const r = checkLocationBinding(raw({
    method: 'POST',
    path: `/membership/locations/${PERMITTED}/products/clone/PRODUCT0000000000001`,
    body: { locations: [PERMITTED] },
  }));
  assert.equal(r, null);
});

test('rule 3: `locationIds` is matched the same way as `locationId`', () => {
  // Not observed in any catalogued body today, but the same shape (a bulk list of accounts) could
  // land uncatalogued -- belt-and-braces, same direction as the clone-endpoint fix.
  const foreign = checkLocationBinding(raw({ method: 'POST', body: { locationIds: [FOREIGN] } }));
  assert.equal(foreign.code, CODES.LOCATION_FORBIDDEN);
  assert.equal(checkLocationBinding(raw({ method: 'POST', body: { locationIds: [PERMITTED] } })), null);
});

test('rule 3: an over-deep body reports a cap hit, never a location violation', () => {
  let deep = { locationId: PERMITTED };
  for (let i = 0; i < 40; i++) deep = { nested: deep };
  const r = checkLocationBinding(raw({ method: 'POST', body: deep }));
  assert.equal(r?.code, CODES.VALIDATION_FAILED, 'a cap hit is a cap hit, not a forbidden location');
});

test('rule 3: an over-long array at a matched key reports a cap hit, never a location violation', () => {
  // The array branch inspects x's elements without recursing through walk(), so those elements
  // must be counted against the same MAX_NODES budget separately -- otherwise
  // { locationId: Array(5_000_000).fill(PERMITTED) } scans uncapped. 10,001 permitted strings
  // trips the 10,000-node budget without slowing the suite down.
  const r = checkLocationBinding(raw({ method: 'POST', body: { locationId: Array(10_001).fill(PERMITTED) } }));
  assert.equal(r?.code, CODES.VALIDATION_FAILED, 'a cap hit is a cap hit, not a forbidden location');
});

import { readFileSync as rfs } from 'node:fs';

test('the full entry point parses GHL_LOCATIONS into state', () => {
  // stdio-audit.mjs is deliberately excluded — see Step 3.
  for (const entry of ['../stdio.mjs']) {
    const src = rfs(new URL(entry, import.meta.url), 'utf8');
    assert.match(src, /allowedLocations/, `${entry} must put allowedLocations on state`);
    assert.match(src, /GHL_LOCATIONS/, `${entry} must read GHL_LOCATIONS`);
  }
});

test('registerTools calls the guard before the handler', () => {
  const src = rfs(new URL('../core/tools.mjs', import.meta.url), 'utf8');
  assert.match(src, /checkLocationBinding/, 'the guard must be wired into the choke point');
});

test('auth_status reports the binding as a COUNT, never the ids', async () => {
  const { authStatus } = await import('../core/auth.mjs');
  const s = authStatus({ tokenFile: '/nonexistent', allowedLocations: new Set([PERMITTED]) });
  assert.equal(s.allowedLocations, 1);
  assert.ok(!JSON.stringify(s).includes(PERMITTED), 'ids must not be echoed');
  assert.equal(authStatus({ tokenFile: '/nonexistent', allowedLocations: null }).allowedLocations, null);
});

// The two source-grep tests above catch outright deletion of the wiring, but they say nothing
// about ORDER or actual effect: `assert.match(src, /checkLocationBinding/)` is satisfied even if
// the guard sits AFTER the handler in the `??` chain, or in a branch that never runs. These two
// drive registerTools end-to-end over a real McpServer/Client pair (the style already used in
// test/raw-request-storage-url.test.mjs) and prove the handler itself never executes on a refusal.
import { McpServer as LB_McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client as LB_Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport as LB_InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

async function withLbClient(deps, fn) {
  const server = new LB_McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new LB_Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = LB_InMemoryTransport.createLinkedPair();
  registerTools(server, deps, TOOLS.filter((t) => t.name === 'raw_request'));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await fn(client); } finally { await client.close(); await server.close(); }
}

test('registerTools refuses an unbound write BEFORE the handler runs, not after', async () => {
  const gwCalls = [];
  const deps = {
    state: { allowedLocations: null },
    // If the handler ran, it would call this to get a gateway and then call() through it.
    // Throwing here turns "the handler ran anyway" into a loud, unambiguous test failure
    // instead of a silently-swallowed side effect.
    makeGw: () => { gwCalls.push('makeGw'); throw new Error('the handler ran — the guard did not block it first'); },
  };
  await withLbClient(deps, async (client) => {
    const result = await client.callTool({
      name: 'raw_request',
      arguments: { locationId: PERMITTED, method: 'PUT', path: '/workflow/whatever/does-not-matter', confirm: true },
    });
    // If checkLocationBinding ran AFTER the handler (or not at all and the handler's own
    // makeGw() throw propagated), the SDK catches that exception and reports isError:true —
    // so isError being unset is itself part of the proof the handler never ran.
    assert.equal(result.isError, undefined, 'the handler must never execute on an unbound write — no exception should surface');
    const contract = JSON.parse(result.content[0].text);
    assert.equal(contract.ok, false);
    assert.equal(contract.code, CODES.LOCATION_UNBOUND);
    assert.equal(gwCalls.length, 0, 'makeGw (and therefore the handler body) must never be invoked when the guard refuses');
  });
});

test('registerTools lets a bound write reach the handler', async () => {
  const gwCalls = [];
  const deps = {
    state: { allowedLocations: new Set([PERMITTED]) },
    makeGw: () => ({
      call: async (method, path, body) => {
        gwCalls.push({ method, path, body });
        return { status: 200, ok: true, json: { done: true } };
      },
    }),
  };
  await withLbClient(deps, async (client) => {
    const result = await client.callTool({
      name: 'raw_request',
      arguments: { locationId: PERMITTED, method: 'PUT', path: '/workflow/oauth2/update-token', confirm: true, body: { x: 1 } },
    });
    assert.equal(result.isError, undefined);
    const contract = JSON.parse(result.content[0].text);
    assert.equal(contract.ok, true, JSON.stringify(contract));
    assert.equal(gwCalls.length, 1, 'a bound registration must actually reach the handler and call through the gateway');
  });
});
