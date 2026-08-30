// The guard exists because one GHL login serves many client sub-accounts: the JWT carries no
// location claim, so the credential cannot tell clients apart. 39 tools take locationId as a
// free string and 17 of them mutate live accounts. Nothing else separates one client from another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedLocations, classifyCall, checkLocationBinding, locationPositions } from '../core/location-binding.mjs';
import { TOOLS } from '../core/tools.mjs';
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
  for (const value of [[FOREIGN], { $ne: null }, 42]) {
    const r = checkLocationBinding(raw({ method: 'POST', body: { locationId: value } }));
    assert.ok(r, `locationId: ${JSON.stringify(value)} must not pass silently`);
  }
});

test('rule 3: an array of permitted strings is allowed', () => {
  assert.equal(checkLocationBinding(raw({ method: 'POST', body: { locationId: [PERMITTED] } })), null);
});

test('rule 3: an over-deep body reports a cap hit, never a location violation', () => {
  let deep = { locationId: PERMITTED };
  for (let i = 0; i < 40; i++) deep = { nested: deep };
  const r = checkLocationBinding(raw({ method: 'POST', body: deep }));
  assert.equal(r?.code, CODES.VALIDATION_FAILED, 'a cap hit is a cap hit, not a forbidden location');
});
