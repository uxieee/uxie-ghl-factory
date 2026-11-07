// set_convai_outbound (W5a Task 6; Decisions 2, 4, 5; review REV-I1, REV-I9, REV-M11; Review Focus 4 and 5).
//
// "Make this agent start conversations on these CRM events / stop it." The preview reads the agent's outbound configs,
// its triggers and the agent (for the mode) — plus the location's numbers when it would switch a config on — and
// writes nothing. Any planned call that ENABLES (send-class by core/send-class.mjs, the same rule raw_request applies)
// needs confirm:true AND acknowledge:<ackToken>, a token over the canonical list of those calls. A plan that only
// switches things off needs confirm alone. After the writes, configs and triggers are read back on separate GETs.
//
// The fake service serves the verbatim 2026-10-30 envelope shapes (knowledge sniffs/convai-wave-2026-10-29/
// live-outbound-envelopes.json) and the 2026-09-30 numbers read (ai-agents-reopen2 runs.jsonl number-readback-v2),
// every identifier replaced, with the measured semantics: PATCH config enabled:true without sendingNumber → 422,
// trigger PUT carrying agentId/type → 422, PATCH on a trigger → 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'set_convai_outbound');
const L = 'loc_1';
const A = 'agent_1';
const NUM = '+15551234567';
const OTHER_NUM = '+61400000000';
const TAG = { tagFilter: { action: 'added', tagNames: ['tag_1'] } };

const configRow = (o = {}) => ({ id: 'config_1', locationId: L, agentId: A, channel: 'SMS', sendingNumber: NUM, enabled: false,
  complianceSettingsAccepted: true, complianceConfigurationsAccepted: true, acceptedBy: 'user_1', acceptedAt: '2026-10-29T16:43:46.477Z', ...o });
const triggerRow = (o = {}) => ({ id: 'trigger_1', locationId: L, agentId: A, type: 'contact_tag', config: structuredClone(TAG),
  deleted: false, createdBy: 'user_1', createdAt: '2026-10-29T16:16:54.548Z', enabled: false, updatedAt: '2026-10-29T16:45:24.741Z', ...o });
const numbersEnvelope = (numbers = [NUM]) => ({
  numbers: numbers.map((phoneNumber, i) => ({ phoneNumber, friendlyName: `number_${i + 1}`, sid: `sid_${i + 1}`, countryCode: 'US',
    capabilities: { fax: false, mms: true, sms: true, voice: true }, type: 'local', isDefaultNumber: i === 0, linkedRingAllUsers: [],
    forwardingNumber: '', isGroupConversationEnabled: true })),
  isUnderGhl: true, total: numbers.length, page: 0, pageSize: 10,
});

// configsRead / triggersRead / employeeRead / numbersRead: a number = that HTTP status for the GET; a function = a
// custom envelope. tamper: a write path whose 2xx is NOT stored. failAt: the n-th write (1-based) answers 500.
function fixture({ configs = [], triggers = [], mode = 'off', numbers = [NUM], configsRead, triggersRead, employeeRead, numbersRead,
  tamper = null, failAt = null } = {}) {
  const db = { configs: structuredClone(configs), triggers: structuredClone(triggers), mode };
  const calls = [];
  let writes = 0; let seq = 0;
  const status = (s) => ({ ok: false, status: s, json: { message: 'error', statusCode: s } });
  const gw = (rail) => ({
    loc: L,
    call: async (method, path, body) => {
      calls.push({ rail, method, path, body });
      if (method === 'GET') {
        if (path.startsWith('/agent-deployment/outbound-configs?')) {
          if (typeof configsRead === 'number') return status(configsRead);
          return { ok: true, status: 200, json: configsRead ? configsRead(db) : { configs: structuredClone(db.configs), traceId: 'trace_1' } };
        }
        if (path.startsWith('/agent-deployment/outbound-triggers?')) {
          if (typeof triggersRead === 'number') return status(triggersRead);
          return { ok: true, status: 200, json: triggersRead ? triggersRead(db) : { triggers: structuredClone(db.triggers), traceId: 'trace_2' } };
        }
        if (path === `/ai-employees/employees/${A}`) {
          if (typeof employeeRead === 'number') return status(employeeRead);
          return { ok: true, status: 200, json: { id: A, locationId: L, name: 'Bot', mode: db.mode, botType: 'PROMPT_BASED_BOT' } };
        }
        if (path.startsWith(`/phone-system/numbers/v2/location/${L}?`)) {
          if (typeof numbersRead === 'number') return status(numbersRead);
          return { ok: true, status: 200, json: numbersEnvelope(numbers) };
        }
        return status(404);
      }
      writes += 1;
      if (failAt === writes) return status(500);
      const stored = tamper !== path;
      if (method === 'POST' && path === '/agent-deployment/outbound-configs') {
        const row = configRow({ id: `config_new_${++seq}`, ...body });
        if (stored) db.configs.push(row);
        return { ok: true, status: 201, json: { id: row.id, enabled: row.enabled, complianceSettingsAccepted: true } };
      }
      const cfg = /^\/agent-deployment\/outbound-configs\/([^/]+)$/.exec(path);
      if (cfg && method === 'PATCH') {
        if (body.enabled === true && !body.sendingNumber) return { ok: false, status: 422, json: { message: ['sendingNumber should not be empty'] } };
        const row = db.configs.find((c) => c.id === cfg[1]);
        if (!row) return status(404);
        if (stored) Object.assign(row, { ...body, locationId: row.locationId });
        return { ok: true, status: 200, json: { ...row, ...body } };
      }
      if (method === 'POST' && path === '/agent-deployment/outbound-triggers') {
        const row = triggerRow({ id: `trigger_new_${++seq}`, ...body });
        if (stored) db.triggers.push(row);
        return { ok: true, status: 201, json: { id: row.id, deleted: false, createdBy: 'user_1' } };
      }
      const trg = /^\/agent-deployment\/outbound-triggers\/([^/]+)$/.exec(path);
      if (trg && method === 'PATCH') return { ok: false, status: 404, json: { message: `Cannot PATCH ${path}` } };
      if (trg && method === 'PUT') {
        const extra = Object.keys(body).filter((k) => !['locationId', 'config', 'enabled'].includes(k));
        if (extra.length) return { ok: false, status: 422, json: { message: extra.map((k) => `property ${k} should not exist`) } };
        const row = db.triggers.find((t) => t.id === trg[1]);
        if (!row) return status(404);
        if (stored) Object.assign(row, { config: body.config, enabled: body.enabled, updatedAt: '2026-10-30T00:00:00.000Z' });
        return { ok: true, status: 200, json: row };
      }
      return status(404);
    },
  });
  return {
    db, calls,
    writes: () => calls.filter((c) => c.method !== 'GET'),
    deps: { state: { tokenFile: '/fixture/token.txt', allowedLocations: new Set([L]) }, makeGw: ({ rail }) => gw(rail ?? 'workflow') },
  };
}
const run = (f, extra) => tool.handler({ locationId: L, agentId: A, ...extra }, f.deps);
const ARM = { activate: { sendingNumber: NUM }, triggers: [{ type: 'contact_tag', config: TAG, enabled: true }] };

test('the tool exists, takes acknowledge, and declares exactly the routes it calls', () => {
  assert.ok(tool, 'set_convai_outbound is registered');
  const caps = tool.capabilities.map((c) => `${c.method} ${c.path}`).sort();
  assert.deepEqual(caps, [
    'GET /agent-deployment/outbound-configs',
    'GET /agent-deployment/outbound-triggers',
    'GET /ai-employees/employees/{agentId}',
    'GET /phone-system/numbers/v2/location/{locationId}',
    'PATCH /agent-deployment/outbound-configs/{configId}',
    'POST /agent-deployment/outbound-configs',
    'POST /agent-deployment/outbound-triggers',
    'PUT /agent-deployment/outbound-triggers/{triggerId}',
  ]);
  assert.ok(tool.inputSchema.shape.acknowledge, 'acknowledge is in the schema');
  assert.match(tool.description, /compliance/i);
  assert.match(tool.description, /mode/i);
});

test('preview makes only GETs (configs, triggers, the agent, the numbers) and returns plan + armedAfter + sendClass', async () => {
  const f = fixture({ triggers: [triggerRow()], mode: 'auto-pilot' });
  const out = await run(f, ARM);
  assert.equal(out.code, 'CONFIRM_REQUIRED', JSON.stringify(out));
  assert.deepEqual(f.writes(), []);
  assert.ok(f.calls.every((c) => c.method === 'GET'));
  const p = out.data.preview;
  assert.deepEqual(p.calls.map((c) => `${c.method} ${c.path}`), [
    'PUT /agent-deployment/outbound-triggers/trigger_1', 'POST /agent-deployment/outbound-configs']);
  assert.equal(p.armedAfter, true);
  assert.deepEqual(p.arms.triggers, ['contact_tag']);
  assert.equal(p.sendClass.class, 'send');
  assert.match(p.sendClass.ackToken, /^[0-9a-f]{16}$/);
  assert.match(p.sendClass.consequence, /compliance/i);
  assert.match(p.consequence, /start conversations|text/i);
  assert.equal(p.numberCheck.found, true);
  // the outbound and agent reads go to the AI rail; the numbers read is the proven backend one
  assert.ok(f.calls.filter((c) => c.path.startsWith('/agent-deployment/') || c.path.startsWith('/ai-employees/')).every((c) => c.rail === 'ai'));
  assert.equal(f.calls.find((c) => c.path.startsWith('/phone-system/')).rail, 'workflow');
});

test('without activation the numbers are not read: three GETs, no more', async () => {
  const f = fixture({ triggers: [triggerRow()] });
  await run(f, { triggers: [{ type: 'contact_tag', enabled: true }] });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => c.method === 'GET'));
});

test('an enabling plan: confirm:true without the token → SEND_CLASS_ACK_REQUIRED, 0 writes; a wrong token too', async () => {
  const f = fixture({ triggers: [triggerRow()], mode: 'auto-pilot' });
  const none = await run(f, { ...ARM, confirm: true });
  assert.equal(none.code, 'SEND_CLASS_ACK_REQUIRED', JSON.stringify(none));
  assert.match(none.data.sendClass.ackToken, /^[0-9a-f]{16}$/);
  const other = await run(f, { activate: { sendingNumber: NUM } });
  for (const acknowledge of [other.data.preview.sendClass.ackToken, 'yes', '0000000000000000']) {
    const out = await run(f, { ...ARM, confirm: true, acknowledge });
    assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED', acknowledge);
  }
  assert.deepEqual(f.writes(), []);
});

test('the right token writes the plan in order, then reads back configs and triggers on separate GETs', async () => {
  const f = fixture({ triggers: [triggerRow()], mode: 'auto-pilot' });
  const preview = await run(f, ARM);
  const before = f.calls.length;
  const out = await run(f, { ...ARM, confirm: true, acknowledge: preview.data.preview.sendClass.ackToken });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(f.writes().map((c) => `${c.method} ${c.path}`), [
    'PUT /agent-deployment/outbound-triggers/trigger_1', 'POST /agent-deployment/outbound-configs']);
  const after = f.calls.slice(before);
  const lastWrite = after.findLastIndex((c) => c.method !== 'GET');
  const readBack = after.slice(lastWrite + 1).map((c) => c.path.split('?')[0]);
  assert.deepEqual(readBack, ['/agent-deployment/outbound-configs', '/agent-deployment/outbound-triggers']);
  assert.equal(out.data.armedAfter, true);
  assert.equal(out.data.readBack.configs[0].enabled, true);
  assert.equal(out.data.readBack.triggers[0].enabled, true);
  assert.equal(out.data.readBack.mode, 'auto-pilot');
  assert.deepEqual(out.data.plan.map((c) => c.effect), ['trigger-update', 'config-create']);
});

test('a plan that only switches things off needs confirm alone (no sendClass, no token)', async () => {
  const f = fixture({ configs: [configRow({ enabled: true })], triggers: [triggerRow({ enabled: true })], mode: 'auto-pilot' });
  const args = { activate: false, triggers: [{ type: 'contact_tag', enabled: false }] };
  const preview = await run(f, args);
  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.equal(preview.data.preview.sendClass, undefined);
  assert.equal(preview.data.preview.armedAfter, false);
  assert.doesNotMatch(preview.remediation, /acknowledge/);
  const out = await run(f, { ...args, confirm: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(f.writes().map((c) => [c.method, c.body]), [
    ['PATCH', { locationId: L, enabled: false }],
    ['PUT', { locationId: L, config: TAG, enabled: false }],
  ]);
  assert.equal(out.data.armedAfter, false);
});

test('creating a DISABLED trigger is still send-class (the rule raw_request applies to the same POST)', async () => {
  const f = fixture();
  const args = { triggers: [{ type: 'contact_created', config: {}, enabled: false }] };
  const preview = await run(f, args);
  assert.ok(preview.data.preview.sendClass?.ackToken);
  assert.equal(preview.data.preview.armedAfter, false);
  const out = await run(f, { ...args, confirm: true, acknowledge: preview.data.preview.sendClass.ackToken });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(f.writes().length, 1);
});

test('accepted but not stored → OUTBOUND_NOT_APPLIED naming the mismatch', async () => {
  const f = fixture({ triggers: [triggerRow()], tamper: '/agent-deployment/outbound-triggers/trigger_1' });
  const args = { triggers: [{ type: 'contact_tag', config: { tagFilter: { action: 'added', tagNames: ['tag_2'] } }, enabled: false }] };
  const out = await run(f, { ...args, confirm: true });
  assert.equal(out.code, 'OUTBOUND_NOT_APPLIED', JSON.stringify(out));
  assert.equal(f.writes().length, 1);
  assert.ok(out.data.mismatches.some((m) => m.type === 'contact_tag' && /config/.test(m.field)), JSON.stringify(out.data.mismatches));
});

test('a read-back that cannot be read is OUTBOUND_NOT_APPLIED too, never success', async () => {
  let reads = 0;
  const f = fixture({ configs: [configRow({ enabled: true })],
    configsRead: (db) => (++reads > 1 ? [] : { configs: structuredClone(db.configs), traceId: 't' }) });
  const out = await run(f, { activate: false, confirm: true });
  assert.equal(out.code, 'OUTBOUND_NOT_APPLIED', JSON.stringify(out));
});

test('an unknown or lead-form type is refused with the executable list, and nothing is written', async () => {
  for (const type of ['facebook_lead_form', 'google_lead_form', 'tiktok_lead_form', 'contact_deleted']) {
    const f = fixture();
    const out = await run(f, { activate: { sendingNumber: NUM }, triggers: [{ type, config: {}, enabled: true }], confirm: true, acknowledge: 'x' });
    assert.equal(out.code, 'UNSUPPORTED_TRIGGER_TYPE', type);
    assert.ok(out.data.executable.includes('contact_tag'), type);
    assert.ok(!out.data.executable.includes(type), type);
    assert.deepEqual(f.writes(), [], type);
  }
});

test('a sendingNumber that is not one of the location\'s numbers is refused in the preview (REV-M11)', async () => {
  const f = fixture({ numbers: [OTHER_NUM] });
  const out = await run(f, { activate: { sendingNumber: NUM } });
  assert.equal(out.code, 'SENDING_NUMBER_NOT_ON_LOCATION', JSON.stringify(out));
  assert.deepEqual(out.data.locationNumbers, [OTHER_NUM]);
  assert.equal(out.data.preview, undefined, 'no plan is offered for it');
  assert.deepEqual(f.writes(), []);
});

test('the numbers could not be read → refused, not waved through', async () => {
  const f = fixture({ numbersRead: 403 });
  const out = await run(f, { activate: { sendingNumber: NUM }, confirm: true, acknowledge: 'x' });
  assert.equal(out.code, 'SENDING_NUMBER_UNVERIFIED', JSON.stringify(out));
  assert.deepEqual(f.writes(), []);
});

test('a malformed sendingNumber is refused before any read of the numbers', async () => {
  const f = fixture();
  const out = await run(f, { activate: { sendingNumber: '555 123 4567' } });
  assert.equal(out.code, 'BAD_SENDING_NUMBER');
  assert.ok(!f.calls.some((c) => c.path.startsWith('/phone-system/')));
});

test('outbound state unreadable (404, or a 200 with no list) → OUTBOUND_UNREADABLE, nothing planned or written', async () => {
  for (const opt of [{ configsRead: 404 }, { triggersRead: 500 }, { triggersRead: () => [] }]) {
    const f = fixture(opt);
    const out = await run(f, { activate: false, confirm: true });
    assert.equal(out.code, 'OUTBOUND_UNREADABLE', JSON.stringify(opt));
    assert.deepEqual(f.writes(), []);
  }
});

test('a row for another agent in the read → refused (never PATCH a config that is not this agent\'s)', async () => {
  const f = fixture({ configs: [configRow({ agentId: 'agent_2', enabled: true })] });
  const out = await run(f, { activate: false, confirm: true });
  assert.equal(out.code, 'OUTBOUND_UNREADABLE', JSON.stringify(out));
  assert.deepEqual(f.writes(), []);
});

test('the agent cannot be read → mode unknown, armedAfter null, and enabling still needs the token', async () => {
  const f = fixture({ employeeRead: 500 });
  const out = await run(f, { triggers: [{ type: 'contact_created', config: {}, enabled: true }] });
  assert.equal(out.code, 'CONFIRM_REQUIRED');
  assert.equal(out.data.preview.armedAfter, null);
  assert.ok(out.data.preview.sendClass?.ackToken);
});

test('a mid-sequence failure reports which calls landed and which were never sent', async () => {
  const f = fixture({ triggers: [triggerRow()], failAt: 2 });
  const args = { triggers: [{ type: 'contact_tag', enabled: true }, { type: 'missed_call', config: {}, enabled: true }], activate: { sendingNumber: NUM } };
  const preview = await run(f, args);
  const out = await run(f, { ...args, confirm: true, acknowledge: preview.data.preview.sendClass.ackToken });
  assert.equal(out.ok, false);
  const pp = out.data.partialProgress;
  assert.deepEqual(pp.landed.map((c) => c.effect), ['trigger-update']);
  assert.equal(pp.failed.effect, 'trigger-create');
  assert.equal(pp.failed.status, 500);
  assert.deepEqual(pp.notAttempted.map((c) => c.effect), ['config-create']);
  assert.equal(f.writes().length, 2);
});

test('already in the asked state → ok, nothing written', async () => {
  const f = fixture({ configs: [configRow({ enabled: true })], triggers: [triggerRow({ enabled: true })] });
  const out = await run(f, { activate: { sendingNumber: NUM }, triggers: [{ type: 'contact_tag', config: TAG, enabled: true }], confirm: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(f.writes(), []);
});

test('nothing asked → VALIDATION_FAILED before any read', async () => {
  const f = fixture();
  const out = await run(f, {});
  assert.equal(out.code, 'VALIDATION_FAILED');
  assert.equal(f.calls.length, 0);
});

// The REGISTERED path (registerTools → validateRegisteredArgs refuses undeclared keys → handler), REV-I5.
async function withClient(deps, fn) {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, deps, TOOLS.filter((t) => t.name === 'set_convai_outbound'));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await fn(client); } finally { await client.close(); await server.close(); }
}
const contractOf = (result) => JSON.parse(result.content[0].text);

test('REGISTERED dispatch: acknowledge passes the schema, a wrong token is refused, the right one writes', async () => {
  const f = fixture({ triggers: [triggerRow()], mode: 'auto-pilot' });
  const base = { locationId: L, agentId: A, ...ARM };
  await withClient(f.deps, async (client) => {
    const preview = contractOf(await client.callTool({ name: 'set_convai_outbound', arguments: base }));
    assert.equal(preview.code, 'CONFIRM_REQUIRED', JSON.stringify(preview));
    const acknowledge = preview.data.preview.sendClass.ackToken;
    assert.match(acknowledge, /^[0-9a-f]{16}$/, 'the token must survive the output scrubber');
    const wrong = contractOf(await client.callTool({ name: 'set_convai_outbound', arguments: { ...base, confirm: true, acknowledge: '0000000000000000' } }));
    assert.equal(wrong.code, 'SEND_CLASS_ACK_REQUIRED', JSON.stringify(wrong));
    assert.deepEqual(f.writes(), []);
    const sent = contractOf(await client.callTool({ name: 'set_convai_outbound', arguments: { ...base, confirm: true, acknowledge } }));
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal(f.writes().length, 2);
  });
});

// W5a final review I1: the same safe-id rule on set_convai_outbound — an agentId that is not one safe path segment is
// refused before any read.
test('I1: set_convai_outbound refuses a traversing or unsafe agentId before any read', async () => {
  for (const agentId of ['x/../agent_1', '..', 'agent_1/', 'a%2Fb', 'agent 1']) {
    const f = fixture();
    const out = await tool.handler({ locationId: L, agentId, ...ARM, confirm: true }, f.deps);
    assert.equal(out.code, 'VALIDATION_FAILED', `${JSON.stringify(agentId)} ${JSON.stringify(out)}`);
    assert.equal(f.calls.length, 0, JSON.stringify(agentId));
  }
});

test('I1: a config or trigger row whose id is not one safe segment makes the state unreadable (never interpolated)', async () => {
  const f = fixture({ configs: [configRow({ id: '../outbound-triggers/trigger_1' })] });
  const out = await run(f, { activate: false });
  assert.equal(out.code, 'OUTBOUND_UNREADABLE', JSON.stringify(out));
  assert.deepEqual(f.writes(), []);
});

test('I1: an agent GET answering with ANOTHER agent\'s record is not this agent\'s mode — armedAfter null, not false', async () => {
  const f = fixture({ mode: 'off' });
  const makeGw = f.deps.makeGw;
  const deps = { ...f.deps, makeGw: (o) => {
    const g = makeGw(o);
    return { ...g, call: async (method, path, body) => {
      const r = await g.call(method, path, body);
      if (method === 'GET' && path === `/ai-employees/employees/${A}`) return { ...r, json: { ...r.json, id: 'agent_2' } };
      return r;
    } };
  } };
  const out = await tool.handler({ locationId: L, agentId: A, ...ARM }, deps);
  assert.equal(out.code, 'CONFIRM_REQUIRED', JSON.stringify(out));
  assert.equal(out.data.preview.current.mode, null);
  assert.equal(out.data.preview.armedAfter, null);
});

// W5a final review M4: trigger calls run before config enables, so a failure after an enabled trigger landed on an
// agent whose config was already on (mode auto-pilot) leaves it ARMED. The failure report must say so: a best-effort
// read-back of configs, triggers and mode, with armedAfter/arms in partialProgress.
test('M4: a mid-sequence failure re-reads and reports armedAfter/arms in partialProgress (left armed → true)', async () => {
  const f = fixture({ configs: [configRow({ enabled: true })], triggers: [triggerRow()], mode: 'auto-pilot', failAt: 2 });
  const args = { triggers: [{ type: 'contact_tag', enabled: true }, { type: 'missed_call', config: {}, enabled: true }] };
  const preview = await run(f, args);
  const out = await run(f, { ...args, confirm: true, acknowledge: preview.data.preview.sendClass.ackToken });
  assert.equal(out.ok, false);
  const pp = out.data.partialProgress;
  assert.deepEqual(pp.landed.map((c) => c.effect), ['trigger-update']);
  assert.equal(pp.armedAfter, true, JSON.stringify(pp));
  assert.deepEqual(pp.arms.triggers, ['contact_tag']);
  assert.equal(pp.arms.campaignEligible, true);
  assert.match(out.detail + out.remediation, /armed/i);
});

test('M4: when the failure read-back itself cannot be read, armedAfter is null (unknown), never omitted', async () => {
  const f = fixture({ triggers: [triggerRow()], mode: 'auto-pilot', failAt: 1 });
  const args = { triggers: [{ type: 'contact_tag', enabled: true }] };
  const preview = await run(f, args);
  let reads = 0;
  const makeGw = f.deps.makeGw;
  const deps = { ...f.deps, makeGw: (o) => {
    const g = makeGw(o);
    return { ...g, call: async (method, path, body) => {
      if (method === 'GET' && path.startsWith('/agent-deployment/outbound-triggers?') && ++reads > 1) return { ok: false, status: 500, json: {} };
      return g.call(method, path, body);
    } };
  } };
  const out = await tool.handler({ locationId: L, agentId: A, ...args, confirm: true, acknowledge: preview.data.preview.sendClass.ackToken }, deps);
  assert.equal(out.ok, false);
  assert.ok(Object.hasOwn(out.data.partialProgress, 'armedAfter'));
  assert.equal(out.data.partialProgress.armedAfter, null);
  assert.ok(out.data.partialProgress.readBackError);
});

// W5a final review M5: the Task 6 Ruling says the number "must appear SMS-capable"; the code refused only sms:false and
// waved through a number with no capabilities at all. Require capabilities.sms === true.
test('M5: a sendingNumber whose capabilities do not read sms:true is SENDING_NUMBER_UNVERIFIED, nothing written', async () => {
  for (const [label, caps] of [['no capabilities', undefined], ['empty', {}], ['sms "true" string', { sms: 'true' }], ['sms null', { sms: null }]]) {
    const f = fixture();
    const makeGw = f.deps.makeGw;
    const deps = { ...f.deps, makeGw: (o) => {
      const g = makeGw(o);
      return { ...g, call: async (method, path, body) => {
        const r = await g.call(method, path, body);
        if (method === 'GET' && path.startsWith('/phone-system/numbers/')) {
          const json = structuredClone(r.json);
          for (const n of json.numbers) { if (caps === undefined) delete n.capabilities; else n.capabilities = caps; }
          return { ...r, json };
        }
        return r;
      } };
    } };
    const out = await tool.handler({ locationId: L, agentId: A, activate: { sendingNumber: NUM } }, deps);
    assert.equal(out.code, 'SENDING_NUMBER_UNVERIFIED', `${label}: ${JSON.stringify(out)}`);
    assert.deepEqual(f.writes(), [], label);
  }
});
