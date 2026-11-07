// The send-class tier (W5a Decision 1-2): which internal-rail writes can make GHL text people on its own,
// sign SMS compliance in the caller's name, or flip a one-way Labs flag — classified by EFFECT (the
// normalised path and the body AS SENT), not by the caller's spelling. Pure: no gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendClassFor, ackTokenFor, requireSendAck } from '../core/send-class.mjs';

const OUT_CFG = '/agent-deployment/outbound-configs';
const OUT_TRG = '/agent-deployment/outbound-triggers';
const EMP = '/ai-employees/employees/agent_1';
const LABS = '/labs/feature-flags/location/loc_1';
const isSend = (r) => r && r.class === 'send' && typeof r.rule === 'string' && typeof r.consequence === 'string' && r.consequence.length > 20;

// (a) outbound configs and triggers ------------------------------------------------------------

test('(a) every POST to outbound-configs is send-class, whatever its body says', () => {
  for (const body of [
    { locationId: 'loc_1', agentId: 'agent_1', channel: 'SMS', enabled: true, sendingNumber: 'sending_number_1' },
    { locationId: 'loc_1', agentId: 'agent_1', channel: 'SMS', enabled: false },
  ]) assert.ok(isSend(sendClassFor('POST', OUT_CFG, body)), JSON.stringify(body));
});

test('(a) PATCH enabling a config, POST/PUT of a trigger, DELETE under outbound- are send-class', () => {
  assert.ok(isSend(sendClassFor('PATCH', `${OUT_CFG}/cfg_1`, { locationId: 'loc_1', enabled: true, sendingNumber: 'sending_number_1' })));
  assert.ok(isSend(sendClassFor('POST', OUT_TRG, { locationId: 'loc_1', agentId: 'agent_1', type: 'contact_tag', config: {}, enabled: true })));
  assert.ok(isSend(sendClassFor('PUT', `${OUT_TRG}/trg_1`, { locationId: 'loc_1', config: {}, enabled: true })));
  assert.ok(isSend(sendClassFor('DELETE', `${OUT_TRG}/trg_1`, undefined)));
  // an unknown future write under the prefix is still send-class
  assert.ok(isSend(sendClassFor('POST', '/agent-deployment/outbound-campaigns/x/resume', { locationId: 'loc_1' })));
});

test('(a) a PATCH/PUT whose body has enabled === false (literal) is NOT send-class: disabling is how you stop it', () => {
  assert.equal(sendClassFor('PATCH', `${OUT_CFG}/cfg_1`, { locationId: 'loc_1', enabled: false }), null);
  assert.equal(sendClassFor('PUT', `${OUT_TRG}/trg_1`, { locationId: 'loc_1', config: {}, enabled: false }), null);
});

test('(a) enabled:"true" (a string), enabled:"false" (a string), and a PATCH with no enabled key are send-class', () => {
  assert.ok(isSend(sendClassFor('PATCH', `${OUT_CFG}/cfg_1`, { locationId: 'loc_1', enabled: 'true' })));
  assert.ok(isSend(sendClassFor('PATCH', `${OUT_CFG}/cfg_1`, { locationId: 'loc_1', enabled: 'false' })));
  assert.ok(isSend(sendClassFor('PUT', `${OUT_TRG}/trg_1`, { locationId: 'loc_1', config: { tags: ['x'] } })));
});

test('(a) GET under outbound- is never send-class', () => {
  assert.equal(sendClassFor('GET', `${OUT_CFG}?locationId=loc_1&agentId=agent_1`, undefined), null);
  assert.equal(sendClassFor('get', `${OUT_TRG}/options`, undefined), null);
});

test('path spelling does not bypass: uppercase, //, percent-encoding, query, trailing /, a full URL', () => {
  const body = { locationId: 'loc_1', agentId: 'agent_1', channel: 'SMS', enabled: true };
  for (const path of [
    '/Agent-Deployment/Outbound-Configs',
    '//agent-deployment//outbound-configs',
    '/agent-deployment%2Foutbound-configs',
    '/agent-deployment/outbound%2Dconfigs',
    '/agent-deployment/outbound-configs/?locationId=loc_1',
    'https://services.leadconnectorhq.com/agent-deployment/outbound-configs',
  ]) assert.ok(isSend(sendClassFor('post', path, body)), path);
});

test('a malformed percent-encoding is tolerated (classified on the raw path, no throw)', () => {
  assert.ok(isSend(sendClassFor('POST', '/agent-deployment/outbound-configs/%E0%A4%A', { enabled: true })));
  assert.equal(sendClassFor('POST', '/widgets/%E0%A4%A', { a: 1 }), null);
});

// (b) bulk actions -----------------------------------------------------------------------------

test('(b) bulk-actions/request is send-class when bulkActionType OR opSpecs.opType names a message send', () => {
  const campaign = { bulkActionType: 'bulk-conversation-ai', title: 'TEST-CONF', locationId: 'loc_1', documentIds: ['c_1'],
    opSpecs: { opType: 'bulk-conversation-ai', agentId: 'agent_1', channel: 'SMS' }, scheduleType: 'NOW' };
  assert.ok(isSend(sendClassFor('POST', '/bulk-actions/request', campaign)));
  assert.ok(isSend(sendClassFor('POST', '/bulk-actions/request', { ...campaign, bulkActionType: 'something-else' })), 'opSpecs.opType alone');
  assert.ok(isSend(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: 'bulk-sms', locationId: 'loc_1' })));
  assert.ok(isSend(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: 'Bulk-Email', locationId: 'loc_1' })));
  assert.ok(isSend(sendClassFor('POST', '/Bulk-Actions/Request/', { opSpecs: { opType: 'send-message' } })));
});

test('(b) bulk types never seen live are send-class, even delete-sounding ones (fail closed; allow-list below)', () => {
  assert.equal(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: 'bulk-delete-contacts', opSpecs: { opType: 'delete' } })?.rule, 'bulk-message-send');
  assert.equal(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: 'bulk-tag-add', opSpecs: { opType: 'add-tag', tags: ['x'] } })?.rule, 'bulk-message-send');
});

// (c) Build with AI -----------------------------------------------------------------------------

test('(c) POST /ai-employees/employees/builder/build is send-class (it saves agents mid-chat)', () => {
  assert.ok(isSend(sendClassFor('POST', '/ai-employees/employees/builder/build', { locationId: 'loc_1', message: 'hi' })));
  assert.equal(sendClassFor('GET', '/ai-employees/employees/builder/history?locationId=loc_1', undefined), null);
});

// (d) the employee PUT that armed an agent live (REV-C1) -------------------------------------------

test('(d) a non-GET to /ai-employees/employees/{id} setting mode to anything but "off" is send-class', () => {
  for (const mode of ['auto-pilot', 'suggestive', 'AUTO-PILOT', null, 'Off']) {
    assert.ok(isSend(sendClassFor('PUT', EMP, { locationId: 'loc_1', mode })), `mode ${JSON.stringify(mode)}`);
  }
  assert.ok(isSend(sendClassFor('PATCH', `${EMP}/`, { mode: 'auto-pilot' })));
  assert.ok(isSend(sendClassFor('PUT', '/AI-Employees/Employees/agent_1', { mode: 'suggestive' })));
});

test('(d) mode "off", no mode key, a sub-route, and a builder route are not rule (d)', () => {
  assert.equal(sendClassFor('PUT', EMP, { locationId: 'loc_1', mode: 'off' }), null);
  assert.equal(sendClassFor('PUT', EMP, { locationId: 'loc_1', name: 'x', cancelEnabled: false }), null);
  assert.equal(sendClassFor('PUT', `${EMP}/working-hours`, { mode: 'auto-pilot', hours: [] }), null);
  assert.equal(sendClassFor('POST', '/ai-employees/employees/builder/history', { mode: 'auto-pilot' }), null);
  assert.equal(sendClassFor('GET', EMP, undefined), null);
});

// (e) Labs: irreversible, not send --------------------------------------------------------------

test('(e) turning ON a one-way Labs key — dotted or nested — is class irreversible', () => {
  for (const body of [
    { featureFlags: { 'conversationsAI.outbound': true } },
    { featureFlags: { conversationsAI: { richElement: true } } },
    { featureFlags: { 'conversationsAI.provider': true, conversationsAI: { outbound: true } } },
    { featureFlags: { 'someFutureLab.unknownKey': true } },
    { featureFlags: { 'conversationsAI.outbound': 'true' } },
  ]) {
    const r = sendClassFor('PUT', LABS, body);
    assert.equal(r?.class, 'irreversible', JSON.stringify(body));
    assert.ok(r.consequence.length > 20);
  }
  assert.equal(sendClassFor('put', '/Labs/Feature-Flags/Location/loc_1/', { featureFlags: { conversationsAI: { outbound: true } } })?.class, 'irreversible');
});

test('(e) a reversible key (the four cards read isIrreversibleFeature:false), and any OFF flip, is null', () => {
  for (const key of ['conversationsAI.chatBuilder', 'conversationsAI.flowBuilderV2', 'aiEmployeeMCPSupport', 'conversationsAI.provider']) {
    assert.equal(sendClassFor('PUT', LABS, { featureFlags: { [key]: true } }), null, key);
  }
  assert.equal(sendClassFor('PUT', LABS, { featureFlags: { conversationsAI: { chatBuilder: true, provider: true } } }), null, 'nested reversible');
  assert.equal(sendClassFor('PUT', LABS, { featureFlags: { 'conversationsAI.outbound': false } }), null);
  assert.equal(sendClassFor('PUT', LABS, { featureFlags: { conversationsAI: { outbound: false, richElement: false } } }), null);
  assert.equal(sendClassFor('GET', LABS, undefined), null);
});

test('an ordinary write elsewhere is null', () => {
  assert.equal(sendClassFor('POST', '/opportunities/', { name: 'x' }), null);
  assert.equal(sendClassFor('PUT', '/workflow/loc_1/wf_1', { name: 'x', mode: 'auto-pilot' }), null);
});

// the ack token ---------------------------------------------------------------------------------

test('ackTokenFor is stable for the same request (key order and path spelling do not matter) and moves with the body', () => {
  const sc = sendClassFor('POST', OUT_CFG, { a: 1, b: { c: 2, d: 3 } });
  const t1 = ackTokenFor('POST', OUT_CFG, { a: 1, b: { c: 2, d: 3 } }, sc.rule);
  assert.match(t1, /^[0-9a-f]{16}$/);
  assert.equal(ackTokenFor('post', '/Agent-Deployment/Outbound-Configs/', { b: { d: 3, c: 2 }, a: 1 }, sc.rule), t1);
  assert.notEqual(ackTokenFor('POST', OUT_CFG, { a: 1, b: { c: 2, d: 4 } }, sc.rule), t1, 'a different body');
  assert.notEqual(ackTokenFor('PATCH', OUT_CFG, { a: 1, b: { c: 2, d: 3 } }, sc.rule), t1, 'a different method');
  assert.notEqual(ackTokenFor('POST', `${OUT_CFG}/x`, { a: 1, b: { c: 2, d: 3 } }, sc.rule), t1, 'a different path');
  assert.notEqual(ackTokenFor('POST', OUT_CFG, { a: 1, b: { c: 2, d: 3 } }, 'other-rule'), t1, 'a different rule');
  // judged AS SENT: a key whose value is undefined is not on the wire
  assert.equal(ackTokenFor('POST', OUT_CFG, { a: 1, b: { c: 2, d: 3 }, z: undefined }, sc.rule), t1);
});

test('requireSendAck: null for no send class or the matching token; the refusal carries the token otherwise', () => {
  const method = 'PUT'; const path = EMP; const wireBody = { locationId: 'loc_1', mode: 'auto-pilot' };
  const sc = sendClassFor(method, path, wireBody);
  const ackToken = ackTokenFor(method, path, wireBody, sc.rule);
  assert.equal(requireSendAck({}, null, { method, path, wireBody }), null);
  assert.equal(requireSendAck({ acknowledge: ackToken }, sc, { method, path, wireBody }), null);
  for (const args of [{}, { acknowledge: 'send' }, { acknowledge: ackTokenFor(method, path, { ...wireBody, mode: 'suggestive' }, sc.rule) }]) {
    const out = requireSendAck(args, sc, { method, path, wireBody });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED');
    assert.ok(out.detail && out.remediation);
    assert.deepEqual(out.data.sendClass, { rule: sc.rule, class: 'send', consequence: sc.consequence, ackToken });
  }
});

// Security-review follow-up (2026-10-30): classify by effect, fail closed. The first bulk rule matched message words and
// let bulk-whatsapp, bulk-review-request(-v2) and bulk-campaign through; Labs and Build with AI matched one method only.
test('bulk: every type not on the non-messaging allow-list is send-class (fail closed)', () => {
  for (const t of ['bulk-whatsapp', 'bulk-review-request', 'bulk-review-request-v2', 'bulk-campaign', 'bulk-ops-v2', 'bulk-something-new']) {
    assert.equal(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: t, opSpecs: { opType: t } })?.rule, 'bulk-message-send', t);
  }
  assert.equal(sendClassFor('POST', '/bulk-actions/request', 'not-json')?.rule, 'bulk-message-send');
  assert.equal(sendClassFor('POST', '/bulk-actions/request', {})?.rule, 'bulk-message-send');
});
test('bulk: known non-messaging types stay a plain confirm', () => {
  for (const t of ['bulk-edit', 'bulk-ops-delete', 'bulk-delete-v2', 'bulk-contact-delete', 'bulk-contacts-to-company', 'bulk-export', 'bulk-import-v2', 'bulk-email-verification']) {
    assert.equal(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: t, opSpecs: { opType: t } }), null, t);
  }
  // a safe top-level type cannot hide a messaging opType
  assert.equal(sendClassFor('POST', '/bulk-actions/request', { bulkActionType: 'bulk-edit', opSpecs: { opType: 'bulk-sms-v2' } })?.rule, 'bulk-message-send');
});
test('Labs and Build with AI: every non-GET method is classified', () => {
  for (const m of ['PUT', 'PATCH', 'POST']) {
    assert.equal(sendClassFor(m, '/labs/feature-flags/location/loc_1', { featureFlags: { 'conversationsAI.outbound': true } })?.class, 'irreversible', m);
    assert.equal(sendClassFor(m, '/ai-employees/employees/builder/build', { locationId: 'loc_1', message: 'x' })?.rule, 'builder-build', m);
  }
});

// W5a final review C1 (2026-10-30): the classifier must judge the path the WIRE will carry. The gateway sends
// fetch(base + path), and the WHATWG URL parser resolves dot-segments (raw or %2e), turns `\` into `/` and drops
// tab/CR/LF. Each spelling below classified NULL while the request hit the gated route.
const BYPASS_SPELLINGS = [
  ['POST', '/x/../agent-deployment/outbound-configs', { locationId: 'loc_1', agentId: 'agent_1', enabled: true }, 'outbound-config'],
  ['POST', '/./agent-deployment/outbound-triggers', { locationId: 'loc_1', agentId: 'agent_1', type: 'contact_tag', enabled: true }, 'outbound-trigger'],
  ['POST', '/agent-deployment\\outbound-configs', { locationId: 'loc_1', enabled: true }, 'outbound-config'],
  ['POST', '/agent-deploy\tment/outbound-configs', { locationId: 'loc_1', enabled: true }, 'outbound-config'],
  ['POST', '/agent-deploy\r\nment/outbound-configs', { locationId: 'loc_1', enabled: true }, 'outbound-config'],
  ['POST', '/%2e%2e/agent-deployment/outbound-configs', { locationId: 'loc_1', enabled: true }, 'outbound-config'],
  ['POST', '/x/%2E%2E/agent-deployment/outbound-triggers', { locationId: 'loc_1', enabled: true }, 'outbound-trigger'],
  ['PUT', '/ai-employees/employees/./agent_1', { mode: 'auto-pilot' }, 'employee-mode-on'],
  ['PUT', '/ai-employees/employees/x/../agent_1', { mode: 'auto-pilot' }, 'employee-mode-on'],
  ['POST', '/bulk-actions/x/../request', { bulkActionType: 'bulk-conversation-ai' }, 'bulk-message-send'],
];

test('C1: dot-segment, backslash, tab/CR/LF and %2e%2e spellings classify as the route the wire hits', () => {
  for (const [method, path, body, rule] of BYPASS_SPELLINGS) {
    assert.equal(sendClassFor(method, path, body)?.rule, rule, JSON.stringify(path));
  }
});

test('C1: a %2e%2e%2f traversal the server might decode still lands in the gated route (judged conservatively)', () => {
  assert.equal(sendClassFor('POST', '/x/%2e%2e%2fagent-deployment/outbound-configs', { enabled: true })?.rule, 'outbound-config');
});

// W5a final review M7: the test panel's builder/test runs on a REAL contact (the location's business-email contact),
// and whether an outbound test sends is unmeasured — the same "unknown = send" reasoning as builder/build.
test('M7: POST /ai-employees/employees/{agentId}/builder/test is send-class until its success path is measured', () => {
  for (const m of ['POST', 'PUT', 'PATCH']) {
    assert.equal(sendClassFor(m, '/ai-employees/employees/agent_1/builder/test', { locationId: 'loc_1', message: 'hi' })?.rule, 'builder-test', m);
  }
  assert.equal(sendClassFor('POST', '/AI-Employees/Employees/agent_1/Builder/Test/', { message: 'hi' })?.rule, 'builder-test');
  assert.ok(isSend(sendClassFor('POST', '/ai-employees/employees/agent_1/builder/test', { message: 'hi' })));
  assert.equal(sendClassFor('GET', '/ai-employees/employees/agent_1/builder/test', undefined), null);
});

// W5a final review M8: with `featureFlags` present the rule judged ONLY that object, so a one-way key at the top level
// beside it passed. Whether GHL honours a top-level key is unmeasured — judge both.
test('M8: a one-way Labs key at the TOP level beside a reversible featureFlags object is irreversible', () => {
  const r = sendClassFor('PUT', LABS, { featureFlags: { 'conversationsAI.chatBuilder': true }, 'conversationsAI.outbound': true });
  assert.equal(r?.class, 'irreversible');
  assert.match(r.consequence, /conversationsAI\.outbound/);
  assert.equal(sendClassFor('PUT', LABS, { featureFlags: { 'conversationsAI.chatBuilder': true }, conversationsAI: { richElement: true } })?.class, 'irreversible');
  // CONTROL: reversible keys in both places, an off flip, and a non-flag scalar stay null
  assert.equal(sendClassFor('PUT', LABS, { featureFlags: { 'conversationsAI.chatBuilder': true }, 'conversationsAI.provider': true }), null);
  assert.equal(sendClassFor('PUT', LABS, { featureFlags: { 'conversationsAI.chatBuilder': true }, 'conversationsAI.outbound': false }), null);
});

test('Labs: request envelope keys beside featureFlags (locationId, companyId) are not flags', () => {
  assert.equal(sendClassFor('PUT', '/labs/feature-flags/location/loc_1', { locationId: 'loc_1', featureFlags: { 'conversationsAI.provider': true } }), null);
  assert.equal(sendClassFor('PUT', '/labs/feature-flags/location/loc_1', { companyId: 'co_1', featureFlags: { 'conversationsAI.outbound': false } }), null);
  assert.equal(sendClassFor('PUT', '/labs/feature-flags/location/loc_1', { locationId: 'loc_1', featureFlags: { 'conversationsAI.outbound': true } })?.class, 'irreversible');
});

test('Labs: an envelope key carrying an OBJECT is still judged as flags (no hiding flags under locationId)', () => {
  assert.equal(sendClassFor('PUT', '/labs/feature-flags/location/loc_1', { locationId: { conversationsAI: { outbound: true } } })?.class, 'irreversible');
  assert.equal(sendClassFor('PUT', '/labs/feature-flags/location/loc_1', { featureFlags: {}, companyId: { 'conversationsAI.richElement': true } })?.class, 'irreversible');
});
