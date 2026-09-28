// update_voiceai_agent — change an EXISTING Voice AI agent, and prove only that changed.
//
// Measured on the designated test sub-account, 2026-09-28, on a TEST-CONF-AI agent, diffing every key before and after:
//   - `PUT /voice-ai/agents/{id}` with a PARTIAL body MERGES at the top level: only the keys sent change. The
//     flow builder sends exactly such bodies ({locationId, agentName} / {locationId, llmModel} / {locationId, voiceId}).
//     The builder-save rail (?publishAgent=true&mode=update) merges a partial body the same way.
//   - A NESTED object is validated whole: {sendPostCallNotificationTo:{admins:true}} answered 422 naming every missing
//     inner field and wrote nothing. So nested objects are laid over the stored one and sent whole.
//   - Writes are FLAT and reads are NESTED (most settings come back under `agentSettings`; voiceId inside
//     agentSettings.voice, language as agentSettings.language.code, ringDurationSeconds as ringDurationMs / 1000).
//   - 🔴 Some refusals come from the VOICE PROVIDER after GHL has stored the value: `llmModel: "bogus-llm"` and
//     `beginMessageDelayMs: 11000` (and `backchannelFrequency: 1.5`) answered HTTP 400 carrying the provider's error, and GHL kept the value, so
//     the GHL record and the provider agent diverged. This module restores the previous values when that happens.
//   - `knowledgeBaseIds` is stored on the agent AND makes the server mint (or remove) a KNOWLEDGE_BASE action. The
//     `knowledgeBasePrompt` is stored as that action's actionParameters.triggerPrompt — never on the agent — and is
//     IGNORED (200, nothing changes) unless `knowledgeBaseIds` rides in the same PUT (measured 2026-09-28).
//   - `llmModel` decides the provider: a speech-to-speech model flips provider RETELL → "lc", providerAgentId →
//     "lc_{agentId}", adds both entries to providerAgents and writes agentSettings.s2sBehaviour; a text model flips it
//     back (providerAgents and the old s2sBehaviour stay). Reported as the cascade, not as collateral.
import { IRError } from './convai-ir.mjs';

// Nested objects the PUT validates whole. Each is merged over the stored object before sending.
export const NESTED_WHOLE = ['aiDisclaimerConfiguration', 'sendPostCallNotificationTo', 'translation', 'noResponseConfig',
  'endCallConfig', 'userFirstFallback'];

// Inner keys the READ carries but the WRITE refuses. Measured 2026-09-28: the stored aiDisclaimerConfiguration reads
// `isGreetingMessageDynamic: null`, and echoing it answers 422 "property isGreetingMessageDynamic should not exist"
// (nothing written). The other five nested objects round-trip whole.
const READ_ONLY_INNER = { aiDisclaimerConfiguration: ['isGreetingMessageDynamic'] };
const writable = (key, v) => (isObj(v) && READ_ONLY_INNER[key]
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !READ_ONLY_INNER[key].includes(k))) : v);

// Top-level keys the update may send, beyond the nested ones: the flat builder-save field list (the create tool's
// follow-up PUT) plus the partial-save keys. Everything else is refused rather than silently sent.
export const WRITABLE = new Set([
  'advancedSettingsEnabled', 'agentName', 'agentPrompt', 'agentWorkingHours', 'ambientSoundVolume', 'backchannelFrequency',
  'backchannelWords', 'backgroundSound', 'beginMessageDelayMs', 'boostedKeywords', 'businessName', 'callEndWorkflowIds',
  'customSttConfig', 'denoisingMode', 'enableBackchannel', 'enableDynamicResponsiveness', 'enableDynamicVoiceSpeed',
  'endCallAfterSilenceMs', 'interruptionSensitivity', 'isAgentAsBackupDisabled', 'ivrOption', 'knowledgeBaseIds',
  'knowledgeBasePrompt', 'language', 'llmModel', 'maxCallDuration', 'modelTemperature', 'normalizeForSpeech',
  'pronunciationDictionary', 'reminderAfterIdleTimeSeconds', 'reminderFrequency', 'responsiveness', 'ringDurationSeconds',
  'saveCallSummaryAsNote', 'sendUserIdleReminders', 'sttMode', 'timezone', 'vocabSpecialization', 'voiceId', 'voiceModel',
  'voiceSpeed', 'voiceTemperature', 'voiceVolume', 'voicemailOption', 'welcomeMessage', 'welcomeMessageMode',
  ...NESTED_WHOLE, 'sessionVariables',
]);

// Separate resources, or keys whose write lives elsewhere.
const ELSEWHERE = {
  actions: 'actions are their own resource (POST/PUT/DELETE /voice-ai/actions)',
  callTransferActions: 'actions are their own resource', contactFieldActions: 'actions are their own resource',
  workflowActions: 'actions are their own resource', smsActions: 'actions are their own resource',
  customActions: 'actions are their own resource', agentTransferActions: 'actions are their own resource',
  capActions: 'actions are their own resource', appointmentBookingAction: 'actions are their own resource',
  mcpServers: 'MCP servers are their own resource (/voice-ai/mcp/*)',
  inboundNumber: 'numbers are assigned on the deploy screen (location-wide)', inboundNumbers: 'numbers are assigned on the deploy screen (location-wide)',
  inboundPhoneNumber: 'numbers are assigned on the deploy screen (location-wide)', numberPoolId: 'numbers are assigned on the deploy screen (location-wide)',
  provider: 'the provider changes only through the upgrade (switch-provider) path',
};

// Bounds the VOICE PROVIDER enforces after GHL has already stored the value (see the header). Refused here so the
// record never diverges. GHL's own validator refuses the other bounds with nothing written, so they need no copy here.
const PROVIDER_BOUNDS = {
  beginMessageDelayMs: [0, 5000, 'Begin message delay ms must be between 0 and 5 seconds'],
  // Measured 2026-09-28: 1.5 answered 400 "backchannel_frequency must be within [0,1]" and was stored.
  backchannelFrequency: [0, 1, 'backchannel_frequency must be within [0,1]'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Where the READ carries a flat write key. */
export function readFlat(record, key) {
  const s = record?.agentSettings ?? {};
  if (key === 'voiceId') return s.voice?.voiceId ?? record?.voiceId;
  if (key === 'language') return isObj(s.language) ? s.language.code : (s.language ?? record?.language);
  if (key === 'ringDurationSeconds') return typeof s.ringDurationMs === 'number' ? s.ringDurationMs / 1000 : record?.ringDurationSeconds;
  if (key === 'welcomeMessage') return record?.welcomeMessage ?? record?.agentWelcomeMessage;
  if (key in (record ?? {})) return record[key];
  return s[key];
}

// sessionVariables: the PUT replaces the whole array (measured 2026-09-28; the builder uses PATCH, the PUT writes them
// too). So the update sends stored ∪ spec by name: an entry updates the stored variable of that name or is appended,
// `{ name, remove: true }` removes one, and nothing else stored is ever dropped. Server rules, pre-checked (each
// measured as a 422/400 that writes nothing): name `session.` + [A-Za-z0-9_-], ≤ 64 characters, unique; dataType one
// of string · number · boolean · object · array.
const SESSION_VAR_NAME = /^session\.[A-Za-z0-9_-]+$/;
const SESSION_VAR_TYPES = ['string', 'number', 'boolean', 'object', 'array'];
export function mergeSessionVariables(stored, entries) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new IRError('SCHEMA', 'sessionVariables must be a non-empty array of { name, label?, dataType?, defaultValue?, description? } '
      + '(or { name, remove: true }). It is merged into the stored list by name; nothing stored is dropped unless removed by name.');
  }
  const out = (Array.isArray(stored) ? stored : []).map((v) => ({ ...v }));
  const seen = new Set();
  for (const e of entries) {
    if (!isObj(e) || typeof e.name !== 'string') throw new IRError('SCHEMA', 'each sessionVariables entry needs a string name');
    if (seen.has(e.name)) throw new IRError('SCHEMA', `sessionVariables names ${e.name} twice (the server refuses duplicates: 400 "Duplicate session variable name")`);
    seen.add(e.name);
    const i = out.findIndex((v) => v.name === e.name);
    if (e.remove === true) {
      if (i < 0) throw new IRError('SCHEMA', `cannot remove session variable ${e.name}: the agent has none of that name. Nothing was sent.`);
      out.splice(i, 1);
      continue;
    }
    if (!SESSION_VAR_NAME.test(e.name)) throw new IRError('SCHEMA', `session variable name ${JSON.stringify(e.name)} must be "session." followed by letters, numbers, underscores or dashes (server rule)`);
    if (e.name.length > 64) throw new IRError('SCHEMA', `session variable name ${e.name} exceeds 64 characters (server rule)`);
    const { remove, ...fields } = e;
    const next = i < 0 ? { label: e.name.slice('session.'.length), dataType: 'string', defaultValue: '', ...fields } : { ...out[i], ...fields };
    if (!SESSION_VAR_TYPES.includes(next.dataType)) throw new IRError('SCHEMA', `session variable ${e.name} dataType must be one of ${SESSION_VAR_TYPES.join(', ')} (server rule)`);
    if (i < 0) out.push(next); else out[i] = next;
  }
  return out;
}

export function compileVoiceAiPartialUpdate(current, spec, { agentId, locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'update_voiceai_agent requires agentId');
  if (!isObj(current)) throw new IRError('SCHEMA', 'the CURRENT agent record is required — read it first');
  if (!isObj(spec) || !Object.keys(spec).length) throw new IRError('SCHEMA', 'spec must name at least one field to change');
  const elsewhere = Object.keys(spec).filter((k) => k in ELSEWHERE);
  if (elsewhere.length) {
    throw new IRError('SPEC_KEY_UNAPPLIED', `update_voiceai_agent does not write [${elsewhere.join(', ')}]: `
      + elsewhere.map((k) => `${k} — ${ELSEWHERE[k]}`).join('; ') + '. Nothing was sent.');
  }
  const unknown = Object.keys(spec).filter((k) => !WRITABLE.has(k));
  if (unknown.length) {
    throw new IRError('SPEC_KEY_UNAPPLIED', `unknown or read-only key(s) [${unknown.join(', ')}] — refused rather than sent. `
      + `Writable keys: ${[...WRITABLE].sort().join(', ')}.`);
  }
  for (const [k, [lo, hi, msg]] of Object.entries(PROVIDER_BOUNDS)) {
    if (k in spec && (typeof spec[k] !== 'number' || spec[k] < lo || spec[k] > hi)) {
      throw new IRError('SCHEMA', `${k} must be ${lo}–${hi} (${msg}). The provider enforces this AFTER GHL stores the value, `
        + 'so an out-of-range write leaves the agent diverged; it is refused here. Nothing was sent.');
    }
  }
  const body = { locationId: locationId ?? current.locationId };
  // A lone knowledgeBasePrompt is accepted and ignored, so it travels with the stored KB ids, as the builder sends it.
  if ('knowledgeBasePrompt' in spec && !('knowledgeBaseIds' in spec)) {
    const ids = Array.isArray(current.knowledgeBaseIds) ? current.knowledgeBaseIds : [];
    if (!ids.length) {
      throw new IRError('SCHEMA', 'knowledgeBasePrompt needs a knowledge base on the agent: none is attached, and the '
        + 'prompt lives on the knowledge-base action the attach creates. Send knowledgeBaseIds with it. Nothing was sent.');
    }
    body.knowledgeBaseIds = ids;
  }
  const expected = {};
  for (const [k, v] of Object.entries(spec)) {
    if (NESTED_WHOLE.includes(k)) {
      if (!isObj(v)) throw new IRError('SCHEMA', `${k} must be an object (it is sent whole, merged over the stored one)`);
      const refused = Object.keys(v).filter((x) => READ_ONLY_INNER[k]?.includes(x));
      if (refused.length) {
        throw new IRError('SPEC_KEY_UNAPPLIED', `${k}.${refused.join(', ')} is read-only: the agent read carries it but the `
          + 'write refuses it (422 "should not exist"). Drop it from the spec. Nothing was sent.');
      }
      const stored = readFlat(current, k);
      body[k] = writable(k, { ...(isObj(stored) ? stored : {}), ...v });
    } else if (k === 'sessionVariables') {
      body[k] = mergeSessionVariables(current.sessionVariables, v);
    } else {
      body[k] = v;
    }
    expected[k] = body[k];
  }
  return { method: 'PUT', path: `/voice-ai/agents/${agentId}`, body, expected, setKeys: Object.keys(spec) };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const KB_KEYS = ['knowledgeBaseIds', 'knowledgeBasePrompt'];
const MODEL_CASCADE = new Set(['provider', 'providerAgentId', 'providerAgents', 'agentSettings.s2sBehaviour']);
const kbActions = (record) => (record?.actions ?? []).filter((a) => a?.actionType === 'KNOWLEDGE_BASE');

/** The value the READ shows for a set key; knowledgeBasePrompt lives on the KNOWLEDGE_BASE action(s). */
function readSet(record, key) {
  if (key === 'knowledgeBasePrompt') {
    const prompts = [...new Set(kbActions(record).map((a) => a.actionParameters?.triggerPrompt))];
    return prompts.length === 1 ? prompts[0] : prompts;
  }
  return writable(key, readFlat(record, key));
}
const IGNORE = new Set(['updatedAt', 'traceId', '__v']);

/** Every readable field of a record, flattened one level (agentSettings.* and top level) for the collateral diff. */
function fields(record) {
  const out = {};
  for (const [k, v] of Object.entries(record ?? {})) if (!IGNORE.has(k) && k !== 'agentSettings') out[k] = v;
  for (const [k, v] of Object.entries(record?.agentSettings ?? {})) out[`agentSettings.${k}`] = v;
  return out;
}

// The read-side names each set key can surface under, so the collateral diff does not flag the key we set.
function readNames(key) {
  if (key === 'voiceId') return ['agentSettings.voice', 'voiceId'];
  if (key === 'language') return ['agentSettings.language', 'language'];
  if (key === 'ringDurationSeconds') return ['agentSettings.ringDurationMs'];
  if (key === 'welcomeMessage') return ['welcomeMessage', 'agentWelcomeMessage'];
  return [key, `agentSettings.${key}`];
}

export async function executeVoiceAiUpdate({ plan, before, gw, serverMessage }) {
  const read = async () => {
    const r = await gw.call('GET', `${plan.path}?locationId=${encodeURIComponent(plan.body.locationId)}`);
    return r?.ok ? (r.json?.agent ?? r.json) : null;
  };
  const put = await gw.call('PUT', plan.path, plan.body);
  const after = await read();
  if (!after) return { ok: false, code: 'AGENT_VERIFY_UNREACHABLE', detail: 'the write answered but the agent could not be re-read; nothing is proven' };

  if (!put?.ok) {
    // A refusal may still have stored the value (provider-side refusals do). Put back what changed.
    const stored = plan.setKeys.filter((k) => !same(readFlat(after, k), readFlat(before, k)));
    const message = serverMessage(put?.json) ?? `HTTP ${put?.status ?? '?'}`;
    if (!stored.length) return { ok: false, code: 'AGENT_UPDATE_FAILED', status: put?.status ?? null, detail: message, written: [] };
    const undo = { locationId: plan.body.locationId };
    for (const k of stored) undo[k] = writable(k, readFlat(before, k));
    const u = await gw.call('PUT', plan.path, undo);
    const again = await read();
    const diverged = stored.filter((k) => !same(readFlat(again, k), readFlat(before, k)));
    const restored = diverged.length === 0 && Boolean(u?.ok);
    // Both facts, with values: what the refusal left stored, and what the record reads after the write-back.
    const values = Object.fromEntries(stored.map((k) => [k, { sent: plan.body[k], storedAfterRefusal: readFlat(after, k),
      restoredTo: readFlat(before, k), readsNow: again ? readFlat(again, k) : undefined }]));
    if (!restored) {
      return {
        ok: false, code: 'PROVIDER_REFUSED_RESTORE_FAILED', status: put?.status ?? null, detail: message,
        written: stored, restored: false, values, diverged,
        warning: `🔴 The refusal stored [${stored.join(', ')}] and writing the previous values back did NOT verify for `
          + `[${diverged.join(', ') || stored.join(', ')}]. The GHL record and the voice provider now DISAGREE on those fields — `
          + 're-read the agent and write a valid value for each.',
      };
    }
    return {
      ok: false, code: 'PROVIDER_REFUSED_BUT_STORED', status: put?.status ?? null, detail: message,
      written: stored, restored: true, values,
      warning: `The refusal came back AFTER GHL stored [${stored.join(', ')}] — the GHL record and the voice provider disagreed. `
        + 'The previous values were written back and read back (data.values shows sent / stored / restored / now).',
    };
  }

  const confirmed = []; const mismatches = [];
  for (const k of plan.setKeys) (same(readSet(after, k), plan.expected[k]) ? confirmed : mismatches).push(k);
  const setNames = new Set(plan.setKeys.flatMap(readNames));
  const b = fields(before); const a = fields(after);
  const changed = []; const cascade = [];
  const modelChange = plan.setKeys.includes('llmModel');
  const kbChange = plan.setKeys.some((k) => KB_KEYS.includes(k));
  const nonKb = (list) => JSON.stringify((list ?? []).filter((x) => x?.actionType !== 'KNOWLEDGE_BASE'));
  const kbIds = new Set([...kbActions(before), ...kbActions(after)].map((x) => x._id));
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (setNames.has(k)) continue;
    // Attaching or detaching a knowledge base mints or removes its KNOWLEDGE_BASE action: expected, not collateral.
    if (kbChange && k === 'actions' && nonKb(b[k]) === nonKb(a[k])) continue;
    if (kbChange && k === 'actionIds' && same((b[k] ?? []).filter((x) => !kbIds.has(x)), (a[k] ?? []).filter((x) => !kbIds.has(x)))) continue;
    if (same(b[k], a[k])) continue;
    if (b[k] === undefined && isObj(a[k]) && !Object.keys(a[k]).length) continue; // e.g. prompts: undefined -> {}
    if (modelChange && MODEL_CASCADE.has(k)) { cascade.push({ key: k, before: b[k], after: a[k] }); continue; }
    changed.push({ key: k, before: b[k], after: a[k] });
  }
  const verification = { verified: mismatches.length === 0 && confirmed.length > 0, confirmed, mismatches };
  const collateral = { unchanged: changed.length === 0, changed, ...(cascade.length ? { cascade } : {}) };
  if (changed.length) {
    return { ok: false, code: 'AGENT_COLLATERAL_CHANGED', verification, collateral,
      detail: `the update moved ${changed.length} field(s) it was not asked to touch: ${changed.map((c) => c.key).join(', ')}` };
  }
  if (mismatches.length) {
    return { ok: false, code: 'AGENT_VERIFY_MISMATCH', verification, collateral,
      detail: `accepted but not stored as sent: [${mismatches.join(', ')}] — e.g. backchannelWords reads back [] while enableBackchannel is off` };
  }
  return { ok: true, verification, collateral };
}
