// planOutbound — the pure planner behind set_convai_outbound: "make this Conversation AI agent start conversations
// on these CRM events / stop it" (W5a Decision 4). No gateway here: the tool reads the state, this decides the calls.
//
// Wire facts (knowledge corpus ai-agents/20-api/conversation-ai-outbound.md, 30-types/conversation-ai-outbound-trigger.md;
// sniffs/convai-wave-2026-10-29/live-outbound-runtime-L5-L7.json, live-ai-campaign-L8.json, live-outbound-envelopes.json):
//   POST  /agent-deployment/outbound-configs {locationId, agentId, channel:"SMS", sendingNumber, enabled} → 201, and the
//         server stamps the SMS compliance acceptance in the caller's name.
//   PATCH /agent-deployment/outbound-configs/{configId} {locationId, enabled:false} switches off; switching on needs
//         {locationId, sendingNumber, enabled:true} (422 "sendingNumber should not be empty" without), and re-stamps.
//   POST  /agent-deployment/outbound-triggers {locationId, agentId, type, config, enabled} → 201.
//   PUT   /agent-deployment/outbound-triggers/{triggerId} {locationId, config, enabled} → 200; agentId and type are
//         refused (422 "property … should not exist"). There is no PATCH (404) and no removal route was found.
//   The mode gates firing (measured: an enabled trigger on an activated agent sent nothing with mode off and sent the
//   opener with mode auto-pilot).
//
// ASSUMED [source-derived]: one config per agent per channel, one live trigger per type per agent (the UI keys its
// lists that way; whether the server refuses a second was never measured). Two found → refused, never guessed.

import { normalizeMode } from './convai-ir.mjs';

export const OUTBOUND_CONFIGS_PATH = '/agent-deployment/outbound-configs';
export const OUTBOUND_TRIGGERS_PATH = '/agent-deployment/outbound-triggers';
export const OUTBOUND_CHANNEL = 'SMS';
// The six types whose create body exists. All six CREATED live through set_convai_outbound (created disabled, read back
// on separate GETs, 2026-10-29, knowledge sniffs/convai-wave-2026-10-29/live-tools-w5a-summary.json); only contact_tag
// has FIRED — whether the other five fire is unmeasured.
export const EXECUTABLE_TRIGGER_TYPES = Object.freeze(['contact_tag', 'contact_created', 'form_submitted',
  'appointment_status_updated', 'opportunity_status_updated', 'missed_call']);
// No body was ever captured for these (REV-I9): refused until one is executed.
export const LEAD_FORM_TRIGGER_TYPES = Object.freeze(['facebook_lead_form', 'google_lead_form', 'tiktok_lead_form']);
const NEAR_MISS = { form_submission: 'form_submitted', contact_tag_added: 'contact_tag', tag_added: 'contact_tag',
  appointment_booked: 'appointment_status_updated', opportunity_created: 'opportunity_status_updated' };
const ARMING_MODES = ['auto-pilot', 'suggestive'];
export const E164 = /^\+[1-9]\d{6,14}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
class PlanRefusal extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; } }
const refuse = (code, message, extra) => { throw new PlanRefusal(code, message, extra); };

// A list of distinct non-empty strings, optionally from an enum, optionally non-empty.
function list(where, key, value, { required = false, min = 0, oneOf = null } = {}) {
  if (value === undefined) {
    if (required) refuse('BAD_TRIGGER_CONFIG', `${where}: ${key} is required`);
    return [];
  }
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !x.trim())) {
    refuse('BAD_TRIGGER_CONFIG', `${where}: ${key} must be a list of non-empty strings`);
  }
  if (new Set(value).size !== value.length) refuse('BAD_TRIGGER_CONFIG', `${where}: ${key} lists a value twice`);
  if (value.length < min) refuse('BAD_TRIGGER_CONFIG', `${where}: ${key} needs at least ${min} value(s)`);
  if (oneOf) {
    const off = value.filter((x) => !oneOf.includes(x));
    if (off.length) refuse('BAD_TRIGGER_CONFIG', `${where}: ${key} takes ${oneOf.join(' | ')} (got ${off.join(', ')})`);
  }
  return [...value];
}
function onlyKeys(where, obj, allowed) {
  if (!isObj(obj)) refuse('BAD_TRIGGER_CONFIG', `${where} must be an object`);
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) {
    refuse('BAD_TRIGGER_CONFIG', `${where} has key(s) no captured body carries: ${extra.join(', ')} (allowed: ${allowed.join(', ') || 'none'})`);
  }
}

// Per type: the config keys of the captured body, checked, and returned in the shape the UI sends (optional lists as []).
const CONFIG = {
  contact_tag: (c) => {
    onlyKeys('contact_tag config', c, ['tagFilter']);
    if (!isObj(c.tagFilter)) refuse('BAD_TRIGGER_CONFIG', 'contact_tag config needs tagFilter {action:"added", tagNames:[…]}');
    onlyKeys('contact_tag config.tagFilter', c.tagFilter, ['action', 'tagNames']);
    if (c.tagFilter.action !== 'added') {
      refuse('BAD_TRIGGER_CONFIG', 'contact_tag tagFilter.action must be "added" (the only action; removing a tag never starts a conversation)');
    }
    return { tagFilter: { action: 'added', tagNames: list('contact_tag', 'tagFilter.tagNames (tag NAMES)', c.tagFilter.tagNames, { required: true, min: 1 }) } };
  },
  contact_created: (c) => { onlyKeys('contact_created config', c, []); return {}; },
  form_submitted: (c) => {
    onlyKeys('form_submitted config', c, ['formIds']);
    return { formIds: list('form_submitted', 'formIds', c.formIds, { required: true, min: 1 }) };
  },
  appointment_status_updated: (c) => {
    onlyKeys('appointment_status_updated config', c, ['calendarIds', 'events']);
    return {
      calendarIds: list('appointment_status_updated', 'calendarIds', c.calendarIds, { required: true, min: 1 }),
      events: list('appointment_status_updated', 'events', c.events, { required: true, min: 1, oneOf: ['booked', 'confirmed'] }),
    };
  },
  opportunity_status_updated: (c) => {
    onlyKeys('opportunity_status_updated config', c, ['events', 'pipelineIds', 'stageIds', 'statuses']);
    const out = {
      events: list('opportunity_status_updated', 'events', c.events, { required: true, min: 1, oneOf: ['created', 'stage_changed'] }),
      pipelineIds: list('opportunity_status_updated', 'pipelineIds', c.pipelineIds),
      stageIds: list('opportunity_status_updated', 'stageIds', c.stageIds),
      statuses: list('opportunity_status_updated', 'statuses', c.statuses, { oneOf: ['open', 'won', 'lost', 'abandoned'] }),
    };
    if (out.stageIds.length && !out.pipelineIds.length) {
      refuse('BAD_TRIGGER_CONFIG', 'opportunity_status_updated: stageIds need the pipeline they belong to in pipelineIds');
    }
    return out;
  },
  missed_call: (c) => {
    onlyKeys('missed_call config', c, ['callStatuses']);
    return { callStatuses: list('missed_call', 'callStatuses', c.callStatuses, { oneOf: ['noanswer', 'busy'] }) };
  },
};

function checkType(type) {
  if (EXECUTABLE_TRIGGER_TYPES.includes(type)) return;
  const executable = [...EXECUTABLE_TRIGGER_TYPES];
  if (LEAD_FORM_TRIGGER_TYPES.includes(type)) {
    refuse('UNSUPPORTED_TRIGGER_TYPE', `${type} is refused: no create body for a lead-form trigger was ever captured or executed, `
      + 'so its config keys are unknown. Build it in the Conversation AI UI (Deploy → Outbound → Triggers).', { executable });
  }
  const hint = NEAR_MISS[type] ? ` Did you mean ${NEAR_MISS[type]}?` : '';
  refuse('UNSUPPORTED_TRIGGER_TYPE', `unknown outbound trigger type ${JSON.stringify(type)}.${hint} Executable: ${executable.join(', ')}.`, { executable });
}

// Same value regardless of key order (the read-back compares stored config to what was sent).
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const sameValue = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/**
 * @param current {configs: row[], triggers: row[], mode: string|null}  (the GET envelopes' rows and the employee's mode)
 * @param desired {activate?: {sendingNumber} | false, triggers?: [{type, config?, enabled}]}
 * @param ids     {locationId, agentId}
 * @returns {calls: [{method, path, body, effect, type?}], expect, armedAfter: true|false|null, arms, refused?}
 */
export function planOutbound(current, desired, { locationId, agentId }) {
  try {
    return plan(current ?? {}, desired ?? {}, { locationId, agentId });
  } catch (error) {
    if (!(error instanceof PlanRefusal)) throw error;
    return { calls: [], refused: { code: error.code, message: error.message, ...error.extra } };
  }
}

function plan(current, desired, { locationId, agentId }) {
  const configs = (current.configs ?? []).filter((c) => c?.channel === OUTBOUND_CHANNEL);
  if (configs.length > 1) {
    refuse('OUTBOUND_AMBIGUOUS', `the agent has ${configs.length} ${OUTBOUND_CHANNEL} outbound configs; one per channel is assumed `
      + '[source-derived] and nothing here picks between them. Inspect them with get_ai_configuration_bundle.');
  }
  const cfg = configs[0] ?? null;
  const live = (current.triggers ?? []).filter((t) => isObj(t) && t.deleted !== true);

  // Validate everything before planning anything: a refusal means zero calls.
  const { activate } = desired;
  if (activate !== undefined && activate !== false) {
    if (!isObj(activate) || typeof activate.sendingNumber !== 'string' || !E164.test(activate.sendingNumber)) {
      refuse('BAD_SENDING_NUMBER', 'activate.sendingNumber must be an E.164 number (+ then country code and digits, no spaces), '
        + 'one of the location\'s own numbers.');
    }
    const extra = Object.keys(activate).filter((k) => k !== 'sendingNumber');
    if (extra.length) {
      refuse('BAD_SENDING_NUMBER', `activate takes {sendingNumber} only (got also ${extra.join(', ')}): the channel is SMS, `
        + 'the only outbound channel, and activate:false switches it off.');
    }
  }
  const asked = desired.triggers ?? [];
  if (!Array.isArray(asked)) refuse('BAD_TRIGGER_CONFIG', 'triggers must be a list of {type, config, enabled}');
  const seen = new Set();
  const wanted = asked.map((t, i) => {
    if (!isObj(t)) refuse('BAD_TRIGGER_CONFIG', `triggers[${i}] must be {type, config, enabled}`);
    onlyKeys(`triggers[${i}]`, t, ['type', 'config', 'enabled']);
    checkType(t.type);
    if (seen.has(t.type)) refuse('DUPLICATE_TRIGGER_TYPE', `${t.type} is listed twice; an agent keeps one trigger per type [source-derived]`);
    seen.add(t.type);
    if (typeof t.enabled !== 'boolean') refuse('BAD_TRIGGER_CONFIG', `triggers[${i}] (${t.type}): enabled must be true or false`);
    const rows = live.filter((r) => r.type === t.type);
    if (rows.length > 1) {
      refuse('OUTBOUND_AMBIGUOUS', `the agent has ${rows.length} live ${t.type} triggers; one per type is assumed [source-derived] `
        + 'and nothing here picks between them.');
    }
    const existing = rows[0] ?? null;
    // An existing trigger may be switched without retyping its config: the stored config is re-sent whole.
    const config = t.config === undefined && existing ? existing.config : CONFIG[t.type](t.config === undefined ? {} : t.config);
    return { type: t.type, enabled: t.enabled, config, existing };
  });

  const calls = [];
  const disableCalls = [];
  const enableCalls = [];
  let configAfter = cfg ? { enabled: cfg.enabled === true, sendingNumber: cfg.sendingNumber ?? null } : null;
  if (activate === false) {
    if (cfg && cfg.enabled !== false) {
      disableCalls.push({ method: 'PATCH', path: `${OUTBOUND_CONFIGS_PATH}/${encodeURIComponent(cfg.id)}`,
        body: { locationId, enabled: false }, effect: 'config-disable' });
      configAfter = { ...configAfter, enabled: false };
    }
  } else if (activate) {
    const { sendingNumber } = activate;
    if (!cfg) {
      enableCalls.push({ method: 'POST', path: OUTBOUND_CONFIGS_PATH,
        body: { locationId, agentId, channel: OUTBOUND_CHANNEL, sendingNumber, enabled: true }, effect: 'config-create' });
    } else if (cfg.enabled !== true || cfg.sendingNumber !== sendingNumber) {
      enableCalls.push({ method: 'PATCH', path: `${OUTBOUND_CONFIGS_PATH}/${encodeURIComponent(cfg.id)}`,
        body: { locationId, sendingNumber, enabled: true }, effect: 'config-enable' });
    }
    configAfter = { enabled: true, sendingNumber };
  }

  for (const w of wanted) {
    if (w.existing) {
      if (w.existing.enabled === w.enabled && sameValue(w.existing.config, w.config)) continue;
      calls.push({ method: 'PUT', path: `${OUTBOUND_TRIGGERS_PATH}/${encodeURIComponent(w.existing.id)}`,
        body: { locationId, config: w.config, enabled: w.enabled }, effect: 'trigger-update', type: w.type });
    } else {
      calls.push({ method: 'POST', path: OUTBOUND_TRIGGERS_PATH,
        body: { locationId, agentId, type: w.type, config: w.config, enabled: w.enabled }, effect: 'trigger-create', type: w.type });
    }
  }

  // After-state: every row the agent has (deleted ones too — an enabled deleted row still counts, the bundle's
  // ruling: err toward reporting) with the asked changes applied.
  const triggersAfter = (current.triggers ?? []).filter(isObj).map((r) => {
    const w = wanted.find((x) => x.existing === r);
    return { type: r.type ?? null, enabled: w ? w.enabled : r.enabled === true };
  });
  for (const w of wanted) if (!w.existing) triggersAfter.push({ type: w.type, enabled: w.enabled });
  const { armedAfter, arms } = armedFrom({ mode: current.mode, configAfter, triggersAfter });

  const expect = {
    ...(activate !== undefined ? { config: activate === false
      ? (cfg ? { channel: OUTBOUND_CHANNEL, enabled: false } : null)
      : { channel: OUTBOUND_CHANNEL, enabled: true, sendingNumber: activate.sendingNumber } } : {}),
    triggers: wanted.map((w) => ({ type: w.type, config: w.config, enabled: w.enabled })),
  };
  return { calls: [...disableCalls, ...calls, ...enableCalls], expect, armedAfter, arms };
}

/**
 * Decision 5. Legs: enabled triggers (a CRM event makes it text) and an enabled config (campaign-eligible).
 * The mode gate is measured for triggers: mode off → they do not fire. Whether a campaign needs the mode on is
 * unmeasured, so mode off with an enabled config is null, as is any unreadable or unrecognised mode.
 */
export function armedFrom({ mode, configAfter, triggersAfter }) {
  const m = normalizeMode(mode ?? null);
  const arms = {
    triggers: triggersAfter.filter((t) => t.enabled).map((t) => t.type),
    campaignEligible: configAfter?.enabled === true,
    mode: typeof m === 'string' ? m : null,
  };
  if (m === 'suggestive') arms.modeUnmeasured = 'suggestive';
  let armedAfter;
  if (!arms.campaignEligible && arms.triggers.length === 0) armedAfter = false;
  else if (ARMING_MODES.includes(m)) armedAfter = true;
  else if (m === 'off') armedAfter = arms.campaignEligible ? null : false;
  else armedAfter = null;
  return { armedAfter, arms };
}
