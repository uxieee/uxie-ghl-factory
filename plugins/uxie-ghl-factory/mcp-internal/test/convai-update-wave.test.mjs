// update_convai_agent / create_convai_agent and the 2026-10 Conversation AI wave (W5a Task 5; Decisions 5, 7, 8;
// review REV-I3, REV-I5, REV-I6; Review Focus 1 and 5).
//
// A mode change to auto-pilot or suggestive can make an agent start texting contacts on its own when it has an
// enabled outbound trigger, or an enabled outbound config (campaign-eligible). So the preview reads the agent's
// outbound configs and triggers, names the leg that arms it, and the write then needs acknowledge:<ackToken> — a
// token over the actual PUT wire body. Unreadable outbound state counts as armed.
//
// The gateway serves the real GET envelopes captured 2026-10-30 (knowledge sniffs/convai-wave-2026-10-29/
// live-outbound-envelopes.json) with every id, number and name replaced by a placeholder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';
import { ackTokenFor } from '../core/send-class.mjs';

const update = TOOLS.find((t) => t.name === 'update_convai_agent');
const L = 'loc_1';
const A = 'agent_1';
const AGENT_PATH = `/ai-employees/employees/${A}`;

// The verbatim envelope shapes, anonymised.
const configsEnvelope = ({ enabled }) => ({
  configs: [{
    id: 'config_1', locationId: L, agentId: A, channel: 'SMS', sendingNumber: 'sending_number_1', enabled,
    complianceSettingsAccepted: true, complianceConfigurationsAccepted: true, acceptedBy: 'user_1', acceptedAt: '2026-10-29T16:43:46.477Z',
  }],
  traceId: 'trace_1',
});
const triggersEnvelope = ({ enabled }) => ({
  triggers: [{
    id: 'trigger_1', locationId: L, agentId: A, type: 'contact_tag',
    config: { tagFilter: { action: 'added', tagNames: ['tag_1'] } },
    deleted: false, createdBy: 'user_1', createdAt: '2026-10-29T16:16:54.548Z', enabled, updatedAt: '2026-10-29T16:45:24.741Z',
  }],
  traceId: 'trace_2',
});
const RECORD = { id: A, locationId: L, name: 'Bot', mode: 'off', channels: ['SMS'], botType: 'PROMPT_BASED_BOT',
  personality: 'p', goal: 'g', instructions: 'i', autoPilotMaxMessages: 75, respondToImages: false };

// configs/triggers: an envelope, or a number = that HTTP status.
function fixture({ record = RECORD, configs = configsEnvelope({ enabled: false }), triggers = triggersEnvelope({ enabled: false }) } = {}) {
  let stored = structuredClone(record);
  const calls = [];
  const answer = (v) => (typeof v === 'number'
    ? { ok: false, status: v, json: { message: 'Cannot GET', statusCode: v } }
    : { ok: true, status: 200, json: structuredClone(v) });
  const gw = {
    loc: L,
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.startsWith('/agent-deployment/outbound-configs?')) return answer(configs);
      if (method === 'GET' && path.startsWith('/agent-deployment/outbound-triggers?')) return answer(triggers);
      if (method === 'GET' && path === `/ai-employees/employees/${stored.id}`) return { ok: true, status: 200, json: structuredClone(stored) };
      if (method === 'PUT' && path === `/ai-employees/employees/${stored.id}`) {
        stored = { ...stored, ...body, name: body.employeeName ?? stored.name };
        delete stored.employeeName;
        return { ok: true, status: 200, json: structuredClone(stored) };
      }
      return { ok: false, status: 404, json: {} };
    },
  };
  return { calls, puts: () => calls.filter((c) => c.method === 'PUT'),
    deps: { state: { tokenFile: '/fixture/token.txt', allowedLocations: new Set([L]) }, makeGw: () => gw } };
}
const run = (f, spec, extra = {}) => update.handler({ locationId: L, agentId: A, spec, ...extra }, f.deps);

test('auto-pilot on an agent with an ENABLED trigger: preview names arms.triggers and carries sendClass; no ack → SEND_CLASS_ACK_REQUIRED, 0 writes', async () => {
  const f = fixture({ triggers: triggersEnvelope({ enabled: true }) });
  const preview = await run(f, { mode: 'auto-pilot' });
  assert.equal(preview.code, 'CONFIRM_REQUIRED', JSON.stringify(preview));
  assert.deepEqual(preview.data.preview.arms.triggers, ['contact_tag']);
  assert.equal(preview.data.preview.arms.campaignEligible, false);
  const sc = preview.data.preview.sendClass;
  assert.equal(sc.class, 'send');
  assert.match(sc.consequence, /contact_tag/);
  // the token is over the ACTUAL PUT wire body
  assert.equal(sc.ackToken, ackTokenFor('PUT', AGENT_PATH, preview.data.preview.body, sc.rule));
  assert.match(preview.remediation, /acknowledge/);
  const out = await run(f, { mode: 'auto-pilot' }, { confirm: true });
  assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED', JSON.stringify(out));
  assert.equal(out.data.sendClass.ackToken, sc.ackToken);
  assert.deepEqual(out.data.preview.arms.triggers, ['contact_tag']);
  assert.equal(f.puts().length, 0);
});

test('an ENABLED config and no enabled trigger: arms.campaignEligible, ack required', async () => {
  const f = fixture({ configs: configsEnvelope({ enabled: true }) });
  const preview = await run(f, { mode: 'auto-pilot' });
  assert.equal(preview.data.preview.arms.campaignEligible, true);
  assert.deepEqual(preview.data.preview.arms.triggers, []);
  assert.ok(preview.data.preview.sendClass?.ackToken);
  const out = await run(f, { mode: 'auto-pilot' }, { confirm: true });
  assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED');
  assert.equal(f.puts().length, 0);
});

test('outbound unreadable (404): armingUnknown, ack required — never silently "not armed"', async () => {
  for (const which of ['configs', 'triggers']) {
    const f = fixture({ [which]: 404 });
    const preview = await run(f, { mode: 'auto-pilot' });
    assert.equal(preview.data.preview.arms.armingUnknown, true, which);
    assert.ok(preview.data.preview.sendClass?.ackToken, which);
    const out = await run(f, { mode: 'auto-pilot' }, { confirm: true });
    assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED', which);
    assert.equal(f.puts().length, 0, which);
  }
});

test('a 200 with an envelope this rail cannot read (bare array) is armingUnknown too', async () => {
  const f = fixture({ triggers: [] });
  const preview = await run(f, { mode: 'auto-pilot' });
  assert.equal(preview.data.preview.arms.armingUnknown, true);
  assert.ok(preview.data.preview.sendClass);
});

test('nothing enabled: the plain confirm path, unchanged — no sendClass, confirm:true alone writes once', async () => {
  const f = fixture();
  const preview = await run(f, { mode: 'auto-pilot' });
  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.equal(preview.data.preview.sendClass, undefined);
  assert.deepEqual(preview.data.preview.arms, { triggers: [], campaignEligible: false });
  assert.doesNotMatch(preview.remediation, /acknowledge/);
  const out = await run(f, { mode: 'auto-pilot' }, { confirm: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(f.puts().length, 1);
  assert.equal(f.puts()[0].body.mode, 'auto-pilot');
});

test('a wrong token is refused: one from another body, or a bare word', async () => {
  const f = fixture({ triggers: triggersEnvelope({ enabled: true }) });
  const other = await run(f, { mode: 'suggestive' });
  for (const acknowledge of [other.data.preview.sendClass.ackToken, 'yes', '0000000000000000']) {
    const out = await run(f, { mode: 'auto-pilot' }, { confirm: true, acknowledge });
    assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED', acknowledge);
  }
  assert.equal(f.puts().length, 0);
});

test('the right token writes exactly one PUT, and the result verifies', async () => {
  const f = fixture({ configs: configsEnvelope({ enabled: true }), triggers: triggersEnvelope({ enabled: true }) });
  const preview = await run(f, { mode: 'auto-pilot' });
  const acknowledge = preview.data.preview.sendClass.ackToken;
  const out = await run(f, { mode: 'auto-pilot' }, { confirm: true, acknowledge });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(f.puts().length, 1);
  assert.deepEqual(f.puts()[0].body, preview.data.preview.body);
  assert.deepEqual(out.data.preview.arms, { triggers: ['contact_tag'], campaignEligible: true });
});

test('suggestive is treated as arming (its outbound behaviour is unmeasured): modeUnmeasured, ack required', async () => {
  const f = fixture({ triggers: triggersEnvelope({ enabled: true }) });
  const preview = await run(f, { mode: 'suggestive' });
  assert.equal(preview.data.preview.arms.modeUnmeasured, 'suggestive');
  assert.ok(preview.data.preview.sendClass?.ackToken);
  const out = await run(f, { mode: 'suggestive' }, { confirm: true });
  assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED');
  assert.equal(f.puts().length, 0);
});

test('CONTROL: no mode change (mode off, or the same mode, or no mode) reads no outbound and needs no token', async () => {
  const armed = { configs: configsEnvelope({ enabled: true }), triggers: triggersEnvelope({ enabled: true }) };
  for (const [record, spec] of [[RECORD, { mode: 'off' }], [RECORD, { autoPilotMaxMessages: 60 }],
    [{ ...RECORD, mode: 'auto-pilot' }, { mode: 'auto-pilot', autoPilotMaxMessages: 60 }]]) {
    const f = fixture({ record, ...armed });
    const preview = await run(f, spec);
    assert.equal(preview.data.preview.sendClass, undefined, JSON.stringify(spec));
    assert.equal(f.calls.some((c) => c.path.startsWith('/agent-deployment/')), false, JSON.stringify(spec));
    const out = await run(f, spec, { confirm: true });
    assert.equal(out.ok, true, JSON.stringify(out));
  }
});

test('V2 agent: the tool sends the editor\'s partial body exactly, and refuses a rename before any write', async () => {
  const v2 = { id: A, locationId: L, name: 'Flow V2', mode: 'off', botType: 'FLOW_BUILDER_BOT_V2', channels: ['SMS'],
    personality: 'p', goal: 'g', instructions: 'i', cancelEnabled: false, rescheduleEnabled: false };
  const f = fixture({ record: v2 });
  const out = await run(f, { cancelEnabled: true }, { confirm: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(f.puts().map((p) => p.body), [{ locationId: L, cancelEnabled: true, rescheduleEnabled: false }]);
  const g = fixture({ record: v2 });
  const refused = await run(g, { name: 'Renamed' }, { confirm: true });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /V2_KEY_REFUSED/);
  assert.equal(g.puts().length, 0);
});

// The REGISTERED path (registerTools → validateRegisteredArgs refuses undeclared keys → handler). A direct handler()
// call skips that check, so without these a schema missing `acknowledge` would pass every test above and refuse
// every live call (REV-I5).
async function withClient(deps, names, fn) {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, deps, TOOLS.filter((t) => names.includes(t.name)));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await fn(client); } finally { await client.close(); await server.close(); }
}
const contractOf = (result) => JSON.parse(result.content[0].text);

test('REGISTERED dispatch: update_convai_agent accepts `acknowledge`, and the matching token writes once', async () => {
  const f = fixture({ triggers: triggersEnvelope({ enabled: true }) });
  const base = { locationId: L, agentId: A, spec: { mode: 'auto-pilot' } };
  await withClient(f.deps, ['update_convai_agent'], async (client) => {
    const preview = contractOf(await client.callTool({ name: 'update_convai_agent', arguments: base }));
    assert.equal(preview.code, 'CONFIRM_REQUIRED', JSON.stringify(preview));
    const acknowledge = preview.data.preview.sendClass.ackToken;
    assert.match(acknowledge, /^[0-9a-f]{16}$/, 'the token must survive the output scrubber');
    const wrong = contractOf(await client.callTool({ name: 'update_convai_agent', arguments: { ...base, confirm: true, acknowledge: '0000000000000000' } }));
    assert.equal(wrong.code, 'SEND_CLASS_ACK_REQUIRED', JSON.stringify(wrong));
    assert.equal(f.puts().length, 0);
    const sent = contractOf(await client.callTool({ name: 'update_convai_agent', arguments: { ...base, confirm: true, acknowledge } }));
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal(f.puts().length, 1);
  });
});

test('REGISTERED dispatch: create_convai_agent accepts `acknowledge` in its schema (no VALIDATION_FAILED)', async () => {
  const f = fixture();
  await withClient(f.deps, ['create_convai_agent'], async (client) => {
    const out = contractOf(await client.callTool({ name: 'create_convai_agent', arguments: {
      locationId: L, acknowledge: '0000000000000000',
      spec: { name: 'Bot', mode: 'off', channels: ['SMS'], goal: 'g' } } }));
    assert.equal(out.code, 'CONFIRM_REQUIRED', JSON.stringify(out));
    assert.equal(f.calls.length, 0);
  });
});

// W5a final review I1 (2026-10-30): `agentId:"x/../agent_1"` made the GET and the PUT resolve to agent_1 on the wire
// (fetch resolves dot-segments) while the arming reads queried agentId=x%2F..%2Fagent_1 — which GHL may answer with
// empty lists — so agent_1 was flipped to auto-pilot with confirm:true and no acknowledge. The gateway below resolves
// paths the way fetch does, and answers the outbound reads per the literal agentId in the query.
function resolvingFixture() {
  const f = fixture({ configs: configsEnvelope({ enabled: true }), triggers: triggersEnvelope({ enabled: true }) });
  const inner = f.deps.makeGw();
  const gw = {
    loc: L,
    call: async (method, path, body) => {
      const u = new URL(`https://wire.invalid${path}`);
      const wantAgent = u.searchParams.get('agentId');
      if (method === 'GET' && u.pathname.startsWith('/agent-deployment/') && wantAgent !== A) {
        f.calls.push({ method, path: u.pathname + u.search, body });
        return { ok: true, status: 200, json: u.pathname.endsWith('configs') ? { configs: [] } : { triggers: [] } };
      }
      return inner.call(method, u.pathname + u.search, body);
    },
  };
  return { ...f, deps: { ...f.deps, makeGw: () => gw } };
}

test('I1: an agentId that is not one safe path segment is refused before ANY read (traversal, slash, dot, %, space)', async () => {
  for (const agentId of ['x/../agent_1', '../agent_1', 'agent_1/', '.', '..', 'x%2F..%2Fagent_1', 'agent 1', 'agent_1?x=1', 'a.b', '']) {
    const f = resolvingFixture();
    const out = await update.handler({ locationId: L, agentId, spec: { mode: 'auto-pilot' }, confirm: true }, f.deps);
    assert.equal(out.ok, false, `${JSON.stringify(agentId)} ${JSON.stringify(out)}`);
    assert.equal(out.code, 'VALIDATION_FAILED', JSON.stringify(agentId));
    assert.equal(f.calls.length, 0, `${JSON.stringify(agentId)}: nothing read, nothing written`);
  }
});

test('I1: a GET whose record id is not the requested agentId is refused (IDENTITY_CONFLICT), no outbound read, no PUT', async () => {
  const f = fixture({ record: { ...RECORD, id: A }, configs: configsEnvelope({ enabled: true }) });
  const inner = f.deps.makeGw();
  const gw = { loc: L, call: async (method, path, body) => {
    if (method === 'GET' && path === '/ai-employees/employees/agent_2') {
      f.calls.push({ method, path, body });
      return { ok: true, status: 200, json: structuredClone(RECORD) }; // agent_1's record for an agent_2 request
    }
    return inner.call(method, path, body);
  } };
  const deps = { ...f.deps, makeGw: () => gw };
  const out = await update.handler({ locationId: L, agentId: 'agent_2', spec: { mode: 'auto-pilot' }, confirm: true }, deps);
  assert.equal(out.code, 'IDENTITY_CONFLICT', JSON.stringify(out));
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), ['GET /ai-employees/employees/agent_2']);
});

test('I1 control: a safe agentId still previews and asks for the token as before', async () => {
  const f = resolvingFixture();
  const out = await run(f, { mode: 'auto-pilot' }, { confirm: true });
  assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED', JSON.stringify(out));
  assert.equal(f.puts().length, 0);
});

test('I1: outbound rows naming another agent or location are unreadable (armingUnknown), never "nothing enabled"', async () => {
  for (const [label, patch] of [['agent', { agentId: 'agent_2' }], ['location', { locationId: 'loc_2' }]]) {
    const configs = configsEnvelope({ enabled: false }); Object.assign(configs.configs[0], patch);
    const triggers = triggersEnvelope({ enabled: false }); Object.assign(triggers.triggers[0], patch);
    const f = fixture({ configs, triggers });
    const out = await run(f, { mode: 'auto-pilot' });
    assert.equal(out.data.preview.arms.armingUnknown, true, label);
    assert.ok(out.data.preview.sendClass, `${label}: a mixed read still asks for the token`);
  }
});

// W5a final review M9, M1, M7, I2 (text): what each description must say.
test('final-review descriptions: customInstructions deletion (M9), outboundArmed scope (M1), builder test (M7), five types created live (I2)', async () => {
  const { readFileSync } = await import('node:fs');
  const d = (n) => TOOLS.find((t) => t.name === n).description;
  assert.match(d('update_convai_agent'), /emptying customInstructions DELETES the stored rules/i);
  assert.match(d('get_ai_configuration_bundle'), /excludes campaign eligibility[^.]*outboundEnabled/i);
  assert.match(d('raw_request'), /builder test panel/i);
  assert.match(d('set_convai_outbound'), /all six created live, only contact_tag has fired/i);
  assert.match(d('set_convai_outbound'), /sms:true/);
  const outboundSrc = readFileSync(new URL('../../engines/ai/outbound.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(outboundSrc, /write blocked|UI-built/i);
  assert.match(outboundSrc, /CREATED live/);
});
