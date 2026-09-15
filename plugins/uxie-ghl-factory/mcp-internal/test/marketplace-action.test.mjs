import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const deps = (routes) => ({
  state: { tokenFile: '/fixture/token.txt' },
  makeGw: () => ({ loc: 'LOC', call: async (m, p) => {
    for (const [match, res] of routes) if (match(p)) return structuredClone(res);
    return { status: 404, ok: false, json: { message: `no fixture for ${m} ${p}` } };
  } }),
});
const at = (frag) => (p) => p.includes(frag);
const body = (json, status = 200) => ({ status, ok: status < 400, json });
const TRACE = { traceId: 't-1' };

// 🔴 AN UNKNOWN KEY ANSWERS 200 WITH ONLY A traceId — this rail never 404s. Measured live
// 2026-09-15, and the first cut of the tool returned ok:true for `NOT-A-REAL-KEY`, describing a
// nonexistent action with a schema full of nulls. `ok` means the request was well-formed, never
// that the thing exists.
test('an unknown action key is REFUSED, not described with an empty schema', async () => {
  const r = await tool('describe_marketplace_action').handler({ locationId: 'LOC', actionKey: 'nope' },
    deps([[at('/actions/published/'), body(TRACE)]]));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /no marketplace action published/);
  assert.match(r.detail, /empty body/, 'and it says HOW the rail signalled absence, since a 200 is not obvious');
});

test('a real action returns its schema and resolves the owning app', async () => {
  const r = await tool('describe_marketplace_action').handler({ locationId: 'LOC', actionKey: 'imessage_a' }, deps([
    [at('/actions/published/'), body({ _id: 'x', templateId: 'T1', appId: 'APP1', branchesConfig: {}, customVars: [], customVarsJson: { message: 'm' } })],
    [at('/actions/options/'), body(TRACE)],
    [at('/custom-input-fields'), body({ customInputFieldData: null, traceId: 't' })],
    [at('/integration/APP1/oauth'), body({ isIntegrationInstalled: false, isLocationHasIntegration: false })],
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.data.appId, 'APP1');
  assert.equal(r.data.schema.templateId, 'T1');
  assert.deepEqual(r.data.app, { installed: false, connectedHere: false },
    'the install status is a FACT about this account, and false is a real answer — not an error');
  // A body that is only a traceId said nothing. Reporting that as "declares no options" would be a
  // claim GHL never made; reporting it as an error would be equally wrong.
  assert.equal(r.data.options.present, false);
  assert.match(r.data.options.note, /NOT the same as the read failing/);
  assert.equal(r.data.customInputFields.present, false, 'a null field payload is also "no content"');
});

// The AI-agent rail wraps everything as {success, data}. A 200 carrying success:false is a failure
// the HTTP status did not report — and an empty `data` beside it would read as "no models exist".
test('get_ai_agent_options treats success:false as a failure, not an empty list', async () => {
  const r = await tool('get_ai_agent_options').handler({ locationId: 'LOC' }, deps([
    [at('/models'), body({ success: false, message: 'nope' })],
    [at('/mcp-connections/oauth2-tokens'), body({ success: true, data: [] })],
    [at('/mcp-connections'), body({ success: true, data: [{ id: 'c1' }] })],
  ]));
  assert.equal(r.ok, true, 'one dead section is data, not a tool failure');
  assert.equal(r.data.models.present, null);
  assert.match(r.data.models.error, /success:false/);
  assert.equal(r.data.mcpConnections.count, 1, 'and the sections that answered are still returned');
});

test('get_ai_agent_options surfaces the 10-tool cap, which is shared with built-in tools', async () => {
  const r = await tool('get_ai_agent_options').handler({ locationId: 'LOC' }, deps([
    [at('/models'), body({ success: true, data: { models: [{ id: 'm1', displayName: 'M', contextWindow: 1 }], defaultModelId: 'm1' } })],
    [at('/mcp-connections/oauth2-tokens'), body({ success: true, data: [] })],
    [at('/mcp-connections'), body({ success: true, data: [] })],
  ]));
  assert.equal(r.data.models.count, 1);
  assert.equal(r.data.models.defaultModelId, 'm1');
  assert.match(r.data.toolCapNote, /10 COMBINED/);
});
