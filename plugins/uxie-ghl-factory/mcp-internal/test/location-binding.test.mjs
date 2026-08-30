// The guard exists because one GHL login serves many client sub-accounts: the JWT carries no
// location claim, so the credential cannot tell clients apart. 39 tools take locationId as a
// free string and 17 of them mutate live accounts. Nothing else separates one client from another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedLocations, classifyCall, checkLocationBinding } from '../core/location-binding.mjs';
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
