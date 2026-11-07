// planOutbound — the pure planner behind set_convai_outbound (W5a Task 6; Decision 4, 5; review REV-I9, REV-M11).
// Wire facts: knowledge corpus ai-agents/20-api/conversation-ai-outbound.md and 30-types/conversation-ai-outbound-trigger.md.
// Rows are the verbatim 2026-10-30 envelope shapes (live-outbound-envelopes.json) with every identifier replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOutbound, EXECUTABLE_TRIGGER_TYPES, LEAD_FORM_TRIGGER_TYPES, OUTBOUND_CONFIGS_PATH, OUTBOUND_TRIGGERS_PATH } from './outbound.mjs';

const L = 'loc_1';
const A = 'agent_1';
const IDS = { locationId: L, agentId: A };
const NUM = '+15551234567';
const NUM2 = '+61400000000';

const config = (o = {}) => ({ id: 'config_1', locationId: L, agentId: A, channel: 'SMS', sendingNumber: NUM, enabled: false,
  complianceSettingsAccepted: true, complianceConfigurationsAccepted: true, acceptedBy: 'user_1', acceptedAt: '2026-10-29T16:43:46.477Z', ...o });
const trigger = (o = {}) => ({ id: 'trigger_1', locationId: L, agentId: A, type: 'contact_tag',
  config: { tagFilter: { action: 'added', tagNames: ['tag_1'] } },
  deleted: false, createdBy: 'user_1', createdAt: '2026-10-29T16:16:54.548Z', enabled: false, updatedAt: '2026-10-29T16:45:24.741Z', ...o });
const state = (o = {}) => ({ configs: [], triggers: [], mode: 'off', ...o });
const TAG = { tagFilter: { action: 'added', tagNames: ['tag_1'] } };

test('the executable list is the six types with a captured body; the three lead-form types are not on it', () => {
  assert.deepEqual([...EXECUTABLE_TRIGGER_TYPES].sort(), ['appointment_status_updated', 'contact_created', 'contact_tag',
    'form_submitted', 'missed_call', 'opportunity_status_updated']);
  assert.deepEqual([...LEAD_FORM_TRIGGER_TYPES].sort(), ['facebook_lead_form', 'google_lead_form', 'tiktok_lead_form']);
});

test('activate with no config → one POST, the exact body the UI modal builds', () => {
  const p = planOutbound(state(), { activate: { sendingNumber: NUM } }, IDS);
  assert.equal(p.refused, undefined);
  assert.deepEqual(p.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'POST', path: OUTBOUND_CONFIGS_PATH, body: { locationId: L, agentId: A, channel: 'SMS', sendingNumber: NUM, enabled: true } },
  ]);
});

test('re-enable a disabled config → PATCH carrying sendingNumber (a bare enabled:true answers 422)', () => {
  const p = planOutbound(state({ configs: [config()] }), { activate: { sendingNumber: NUM } }, IDS);
  assert.deepEqual(p.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'PATCH', path: `${OUTBOUND_CONFIGS_PATH}/config_1`, body: { locationId: L, sendingNumber: NUM, enabled: true } },
  ]);
});

test('activate an already-enabled config on the same number → nothing to send; a different number → PATCH', () => {
  const same = planOutbound(state({ configs: [config({ enabled: true })] }), { activate: { sendingNumber: NUM } }, IDS);
  assert.deepEqual(same.calls, []);
  const other = planOutbound(state({ configs: [config({ enabled: true })] }), { activate: { sendingNumber: NUM2 } }, IDS);
  assert.deepEqual(other.calls.map((c) => c.body), [{ locationId: L, sendingNumber: NUM2, enabled: true }]);
});

test('deactivate → PATCH {locationId, enabled:false}; nothing to deactivate → no call', () => {
  const p = planOutbound(state({ configs: [config({ enabled: true })] }), { activate: false }, IDS);
  assert.deepEqual(p.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'PATCH', path: `${OUTBOUND_CONFIGS_PATH}/config_1`, body: { locationId: L, enabled: false } },
  ]);
  assert.deepEqual(planOutbound(state({ configs: [config()] }), { activate: false }, IDS).calls, []);
  assert.deepEqual(planOutbound(state(), { activate: false }, IDS).calls, []);
});

test('a sendingNumber that is not E.164 is refused before any plan', () => {
  for (const sendingNumber of ['5551234567', '+1 555 123 4567', '', '+0123', 42]) {
    const p = planOutbound(state(), { activate: { sendingNumber } }, IDS);
    assert.equal(p.refused?.code, 'BAD_SENDING_NUMBER', String(sendingNumber));
    assert.deepEqual(p.calls, []);
  }
});

test('an existing type → PUT {locationId, config, enabled} only (agentId and type are refused by the DTO)', () => {
  const p = planOutbound(state({ triggers: [trigger()] }), { triggers: [{ type: 'contact_tag', config: { tagFilter: { action: 'added', tagNames: ['tag_2'] } }, enabled: true }] }, IDS);
  assert.deepEqual(p.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'PUT', path: `${OUTBOUND_TRIGGERS_PATH}/trigger_1`, body: { locationId: L, config: { tagFilter: { action: 'added', tagNames: ['tag_2'] } }, enabled: true } },
  ]);
  assert.deepEqual(Object.keys(p.calls[0].body).sort(), ['config', 'enabled', 'locationId']);
});

test('an existing type with config omitted re-sends the stored config (disable without retyping it)', () => {
  const p = planOutbound(state({ triggers: [trigger({ enabled: true })] }), { triggers: [{ type: 'contact_tag', enabled: false }] }, IDS);
  assert.deepEqual(p.calls[0].body, { locationId: L, config: TAG, enabled: false });
});

test('an existing type already in the asked state → no call', () => {
  const p = planOutbound(state({ triggers: [trigger()] }), { triggers: [{ type: 'contact_tag', config: TAG, enabled: false }] }, IDS);
  assert.deepEqual(p.calls, []);
});

test('a new type → POST {locationId, agentId, type, config, enabled}', () => {
  const p = planOutbound(state({ triggers: [trigger()] }), { triggers: [{ type: 'missed_call', config: { callStatuses: ['noanswer'] }, enabled: false }] }, IDS);
  assert.deepEqual(p.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'POST', path: OUTBOUND_TRIGGERS_PATH, body: { locationId: L, agentId: A, type: 'missed_call', config: { callStatuses: ['noanswer'] }, enabled: false } },
  ]);
});

test('a deleted row of the same type is not edited: a new trigger is created', () => {
  const p = planOutbound(state({ triggers: [trigger({ deleted: true })] }), { triggers: [{ type: 'contact_tag', config: TAG, enabled: false }] }, IDS);
  assert.equal(p.calls[0].method, 'POST');
});

test('a lead-form or unknown type → UNSUPPORTED_TRIGGER_TYPE naming the executable list, and no call at all', () => {
  for (const type of [...LEAD_FORM_TRIGGER_TYPES, 'contact_deleted', 'form_submission']) {
    const p = planOutbound(state(), { activate: { sendingNumber: NUM }, triggers: [{ type, config: {}, enabled: false }] }, IDS);
    assert.equal(p.refused?.code, 'UNSUPPORTED_TRIGGER_TYPE', type);
    assert.deepEqual(p.refused.executable, EXECUTABLE_TRIGGER_TYPES, type);
    assert.deepEqual(p.calls, [], type);
  }
  const lead = planOutbound(state(), { triggers: [{ type: 'facebook_lead_form', config: {}, enabled: false }] }, IDS);
  assert.match(lead.refused.message, /no .*body|never/i);
  const nearMiss = planOutbound(state(), { triggers: [{ type: 'form_submission', config: {}, enabled: false }] }, IDS);
  assert.match(nearMiss.refused.message, /form_submitted/);
});

test('config is validated per type: unknown keys, missing required lists, values off the measured enums', () => {
  const bad = [
    ['contact_tag', { tagFilter: { action: 'added', tagNames: [] } }],
    ['contact_tag', { tagFilter: { action: 'removed', tagNames: ['t'] } }],
    ['contact_tag', { tagFilter: { action: 'added', tagNames: ['t'], extra: 1 } }],
    ['contact_tag', { tagNames: ['t'] }],
    ['contact_created', { anything: true }],
    ['form_submitted', { formIds: [] }],
    ['form_submitted', { formId: 'f' }],
    ['appointment_status_updated', { calendarIds: ['c'], events: ['cancelled'] }],
    ['appointment_status_updated', { calendarIds: [], events: ['booked'] }],
    ['appointment_status_updated', { calendarIds: ['c'] }],
    ['opportunity_status_updated', { events: [] }],
    ['opportunity_status_updated', { events: ['created'], statuses: ['pending'] }],
    ['opportunity_status_updated', { events: ['stage_changed'], stageIds: ['s'] }],
    ['missed_call', { callStatuses: ['voicemail'] }],
    ['missed_call', { callStatuses: ['busy'], number: 'x' }],
    ['missed_call', 'not an object'],
  ];
  for (const [type, cfg] of bad) {
    const p = planOutbound(state(), { triggers: [{ type, config: cfg, enabled: false }] }, IDS);
    assert.equal(p.refused?.code, 'BAD_TRIGGER_CONFIG', `${type} ${JSON.stringify(cfg)}`);
    assert.deepEqual(p.calls, []);
  }
});

test('the captured UI bodies pass, and the optional lists are sent as [] the way the UI sends them', () => {
  const good = [
    ['contact_tag', TAG, TAG],
    ['contact_created', {}, {}],
    ['form_submitted', { formIds: ['form_1'] }, { formIds: ['form_1'] }],
    ['appointment_status_updated', { calendarIds: ['cal_1'], events: ['booked'] }, { calendarIds: ['cal_1'], events: ['booked'] }],
    ['opportunity_status_updated', { events: ['stage_changed'], pipelineIds: ['p_1'], stageIds: ['s_1'], statuses: [] },
      { events: ['stage_changed'], pipelineIds: ['p_1'], stageIds: ['s_1'], statuses: [] }],
    ['opportunity_status_updated', { events: ['created'] }, { events: ['created'], pipelineIds: [], stageIds: [], statuses: [] }],
    ['missed_call', { callStatuses: [] }, { callStatuses: [] }],
    ['missed_call', {}, { callStatuses: [] }],
  ];
  for (const [type, cfg, sent] of good) {
    const p = planOutbound(state(), { triggers: [{ type, config: cfg, enabled: false }] }, IDS);
    assert.equal(p.refused, undefined, `${type}: ${JSON.stringify(p.refused)}`);
    assert.deepEqual(p.calls[0].body.config, sent, type);
  }
});

test('enabled must be a boolean, and a type may appear once', () => {
  assert.equal(planOutbound(state(), { triggers: [{ type: 'contact_created', config: {} }] }, IDS).refused?.code, 'BAD_TRIGGER_CONFIG');
  assert.equal(planOutbound(state(), { triggers: [{ type: 'contact_created', config: {}, enabled: 'true' }] }, IDS).refused?.code, 'BAD_TRIGGER_CONFIG');
  const twice = planOutbound(state(), { triggers: [{ type: 'contact_created', config: {}, enabled: false }, { type: 'contact_created', config: {}, enabled: true }] }, IDS);
  assert.equal(twice.refused?.code, 'DUPLICATE_TRIGGER_TYPE');
});

test('one config per channel and one live trigger per type are ASSUMED [source-derived]: two found → refused, not guessed', () => {
  const twoConfigs = planOutbound(state({ configs: [config(), config({ id: 'config_2' })] }), { activate: false }, IDS);
  assert.equal(twoConfigs.refused?.code, 'OUTBOUND_AMBIGUOUS');
  const twoTriggers = planOutbound(state({ triggers: [trigger(), trigger({ id: 'trigger_2' })] }), { triggers: [{ type: 'contact_tag', enabled: false }] }, IDS);
  assert.equal(twoTriggers.refused?.code, 'OUTBOUND_AMBIGUOUS');
});

test('call order: the config switch-off first, triggers next, the config switch-on last', () => {
  const on = planOutbound(state({ triggers: [trigger()] }), {
    activate: { sendingNumber: NUM },
    triggers: [{ type: 'contact_tag', config: TAG, enabled: true }, { type: 'contact_created', config: {}, enabled: true }],
  }, IDS);
  assert.deepEqual(on.calls.map((c) => `${c.method} ${c.path}`), [
    `PUT ${OUTBOUND_TRIGGERS_PATH}/trigger_1`, `POST ${OUTBOUND_TRIGGERS_PATH}`, `POST ${OUTBOUND_CONFIGS_PATH}`]);
  const off = planOutbound(state({ configs: [config({ enabled: true })], triggers: [trigger({ enabled: true })] }), {
    activate: false, triggers: [{ type: 'contact_tag', enabled: false }],
  }, IDS);
  assert.deepEqual(off.calls.map((c) => c.method), ['PATCH', 'PUT']);
  assert.equal(off.calls[0].path, `${OUTBOUND_CONFIGS_PATH}/config_1`);
});

test('every planned call says whether it ENABLES (the send-class ones) or only disables', () => {
  const p = planOutbound(state({ configs: [config({ enabled: true })], triggers: [trigger({ enabled: true })] }), {
    activate: false, triggers: [{ type: 'contact_tag', enabled: false }, { type: 'contact_created', config: {}, enabled: false }],
  }, IDS);
  assert.deepEqual(p.calls.map((c) => c.effect), ['config-disable', 'trigger-update', 'trigger-create']);
});

test('armedAfter (Decision 5): enabled config or enabled trigger counts; the mode gate is measured; unknown is null', () => {
  const on = (mode, o = {}) => planOutbound(state({ mode, ...o }), { triggers: [{ type: 'contact_tag', config: TAG, enabled: true }] }, IDS);
  assert.equal(on('auto-pilot').armedAfter, true);
  assert.deepEqual(on('auto-pilot').arms, { triggers: ['contact_tag'], campaignEligible: false, mode: 'auto-pilot' });
  assert.equal(on('suggestive').armedAfter, true);
  assert.equal(on('suggestive').arms.modeUnmeasured, 'suggestive');
  assert.equal(on('autoPilot').armedAfter, true, 'the camelCase alias reads as auto-pilot');
  // mode off: an enabled trigger did NOT fire (measured differential)
  assert.equal(on('off').armedAfter, false);
  // mode unknown (the employee could not be read)
  assert.equal(on(null).armedAfter, null);
  // mode off with an ENABLED config: campaign-eligible, and whether a campaign needs the mode on is unmeasured
  const campaign = planOutbound(state({ mode: 'off' }), { activate: { sendingNumber: NUM } }, IDS);
  assert.equal(campaign.armedAfter, null);
  assert.equal(campaign.arms.campaignEligible, true);
  assert.equal(planOutbound(state({ mode: 'auto-pilot' }), { activate: { sendingNumber: NUM } }, IDS).armedAfter, true);
  // switching everything off → false whatever the mode
  const allOff = planOutbound(state({ mode: 'auto-pilot', configs: [config({ enabled: true })], triggers: [trigger({ enabled: true })] }),
    { activate: false, triggers: [{ type: 'contact_tag', enabled: false }] }, IDS);
  assert.equal(allOff.armedAfter, false);
  // a trigger left enabled and not named still counts
  const leftOn = planOutbound(state({ mode: 'auto-pilot', configs: [config({ enabled: true })], triggers: [trigger({ enabled: true })] }), { activate: false }, IDS);
  assert.equal(leftOn.armedAfter, true);
  assert.deepEqual(leftOn.arms.triggers, ['contact_tag']);
});

test('the plan names the state it expects to read back', () => {
  const p = planOutbound(state({ triggers: [trigger()] }), {
    activate: { sendingNumber: NUM }, triggers: [{ type: 'contact_tag', enabled: true }],
  }, IDS);
  assert.deepEqual(p.expect, {
    config: { channel: 'SMS', enabled: true, sendingNumber: NUM },
    triggers: [{ type: 'contact_tag', config: TAG, enabled: true }],
  });
});

test('activate takes sendingNumber only: any other key (a channel, enabled) is refused, not ignored', () => {
  for (const activate of [{ sendingNumber: NUM, channel: 'WhatsApp' }, { sendingNumber: NUM, enabled: false }]) {
    const p = planOutbound(state(), { activate }, IDS);
    assert.equal(p.refused?.code, 'BAD_SENDING_NUMBER', JSON.stringify(activate));
    assert.deepEqual(p.calls, []);
  }
});
