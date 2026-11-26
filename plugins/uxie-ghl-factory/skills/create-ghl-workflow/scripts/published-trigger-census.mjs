import { unpublishAndAssertDraft } from './probe-readback.mjs';
// w9-d18 batch 6 (QA FIX, orchestrator ruling 2026-11-22): before this suite creates a contact or enrols anyone, read EVERY published workflow on the
// location and decide, for each LIVE trigger, whether it can fire from the EVENT SET the batch declares. READ-ONLY; fails closed.
//
// EVENT SET (each batch declares which one it runs; the runner passes --event-set=<name> to the suite and asserts it matches its --through):
//   core         contact create; tags added at create and by its own steps (test-conf-<stamp>-* only); its own enrolments.
//   conversation core + a member contact (email, DND on), the internal-comment conversation on a contact, the badge and the grant (batch 7).
// DECISIONS per live trigger (a trigger is live unless it says active:false): DEFAULT-BLOCK. Every live trigger of every type blocks, contact_tag and contact_changed included
// (their conditions are only DESCRIBED in the record, never used to clear the row), and so does any type that is unknown, unmapped or untyped.
//   inactive          active:false only.
//   not in event set  ONLY a type a named run S declares unreachable in WORKFLOW_RUN_EXEMPTIONS (empty today; QA 2026-11-22 points 1, 7-8: note_add was passed by a type
//                     pattern and a published flow on it fired on a test contact; no flag default, allow-list or tag condition passes a type any more).
// An unreadable trigger list blocks (retried once). A blocker named TEST-CONF-* is a candidate the RUNNER may unpublish (never delete) by id AND name;
// any other blocker stops the run for Xander.
// The run stamp: ONE definition, used by conformance.mjs to build STAMP and by the census to recognise run-unique tags, so the two cannot drift.
export const makeStamp = () => Date.now().toString().slice(-6);
export const STAMP_TAG_RE = /^test-conf-\d{6}(-|$)/i; // tags the suite creates: test-conf-<STAMP> and test-conf-<STAMP>-<suffix>
export const GENERIC_RUN_TAG = 'test-conf';
// Lane-tagged run tags (SESSIONS.md:142, ruling A): test-conf-w9-<lane>-<anything>. The lane token may itself be followed by hyphenated parts, so only the
// prefix is matched; over-blocking is the safe side (a bare test-conf-w9-<x> is treated as a run tag too).
export const LANE_TAG_RE = /^test-conf-w9-[a-z0-9]+(-|$)/i;
// ONE definition of "a tag this run can add": the generic tag, the stamp shape, the lane shape, or an EXACT planned tag a runner passes in. Used only to DESCRIBE a contact_tag row;
// it never clears a trigger (every live contact_tag trigger blocks by default).
export const isRunTag = (tag, plannedTags = []) => {
  const v = String(tag ?? '').trim().toLowerCase();
  return v === GENERIC_RUN_TAG || STAMP_TAG_RE.test(v) || LANE_TAG_RE.test(v) || (Array.isArray(plannedTags) && plannedTags.some((p) => typeof p === 'string' && p.trim().toLowerCase() === v));
};
// CALLER RULE: every contact-creating runner must pass its EXACT planned tags to BOTH censuses — withPlannedTags(eventSet, tags) for publishedTriggerCensus and
// convAiCensus({ plannedTags }). QA gates that per runner; no shared caller exists yet (conformance.mjs passes none).
// An event set carrying the exact tags the runner plans to add (frozen copy; the census reads eventSet.plannedTags).
export const withPlannedTags = (eventSet, plannedTags) => Object.freeze({ ...eventSet, plannedTags: Object.freeze([...(plannedTags ?? [])]) });
// EVENT SET FLAGS (each batch declares them): conversation = touches a conversation; customFieldWrite = writes any contact custom field; formSubmission = makes a form
// submission; dndWrite = sets or changes DND on any contact.
// inboundMessage = the batch creates a contact message that arrives INBOUND (SMS, email, call, chat widget, reply). customer_reply and conv_ai_* fire on that (corpus: customer_reply.md
// "fires on an inbound message from the contact"; conv_ai on a bot session start or a bot-action goto). A conversation plus an INTERNAL comment is not one.
const mk = (name, f) => Object.freeze({ name, conversation: false, inboundMessage: false, customFieldWrite: false, formSubmission: false, dndWrite: false, ...f });
export const EVENT_SETS = Object.freeze({ core: mk('core', {}), conversation: mk('conversation', { conversation: true, dndWrite: true }) });
// Exemptions exist ONLY per named run S: { '<40-hex S>': ['<trigger type>', …] }, each with its own test. Zero today.
export const WORKFLOW_RUN_EXEMPTIONS = Object.freeze({});
export const workflowExempt = (runS, type) => typeof runS === 'string' && /^[0-9a-f]{40}$/.test(runS) && Array.isArray(WORKFLOW_RUN_EXEMPTIONS[runS]) && WORKFLOW_RUN_EXEMPTIONS[runS].includes(type);
export const CONTACT_FIRING_TYPES = Object.freeze(['contact_created', 'contact_changed', 'contact_tag', 'dnd_contact', 'custom_date_reminder', 'form_submission']);
const ALWAYS_BLOCK = ['contact_created'];
// contact_changed: these two patterns only DESCRIBE a row (the run provably never touches those contact fields; a 20-character alphanumeric id is a custom field the run never sets).
// They never clear a trigger: every live contact_changed trigger blocks by default, whatever its rows say. Any other field is described as one the run can touch.
const NEVER_TOUCHED_FIELDS = /^contact\.(address1|city|state|country|postalCode|website|dateOfBirth|companyName)$/;
const CUSTOM_FIELD_ID = /^contact\.[A-Za-z0-9]{20}$/;
export const isTestConf = (name) => /^TEST-CONF/.test(String(name ?? ''));

// Can the run satisfy these conditions? cannotMatch is returned ONLY when EVERY row is individually recognised AND unsatisfiable by the run. Any row whose
// field, operator or value shape is not recognised makes the trigger block (rows may be OR'd, so one satisfiable or unknown row is enough to fire).
export function judgeConditions(type, conditions, plannedTags = []) {
  const conds = Array.isArray(conditions) ? conditions : [];
  if (conds.length === 0) return { cannotMatch: false, reason: 'no conditions: it fires on any change of this kind', tags: [], fields: [] };
  const tags = [], fields = [];
  let blockedBy = null;
  for (const c of conds) {
    const field = typeof c?.field === 'string' ? c.field : '', op = typeof c?.operator === 'string' ? c.operator.toLowerCase() : '', val = c?.value;
    if (field) fields.push(field);
    let rowCannot = false;
    if (type === 'contact_tag') {
      if (/^tags(Added|Removed)$/.test(field) && op === 'index-of-true' && typeof val === 'string' && val.trim() !== '') {
        tags.push(val);
        const v = val.trim().toLowerCase();
        rowCannot = !isRunTag(v, plannedTags);
        if (!rowCannot) blockedBy ??= `a row matches a tag the run adds ("${val}": the generic tag, a run-stamp or lane-tag pattern, or a planned tag)`;
      } else blockedBy ??= `a row is not recognised (field "${field}", operator "${op}", value ${Array.isArray(val) ? 'array' : typeof val})`;
    } else if (type === 'contact_changed') {
      if (op === 'has-changed' && (val === undefined || typeof val === 'string') && (NEVER_TOUCHED_FIELDS.test(field) || CUSTOM_FIELD_ID.test(field))) rowCannot = true;
      else blockedBy ??= `a row can fire or is not recognised (field "${field}", operator "${op}", value ${Array.isArray(val) ? 'array' : typeof val})`;
    } else blockedBy ??= 'no judge exists for this type';
    if (!rowCannot) blockedBy ??= 'a row is not provably unsatisfiable';
  }
  return blockedBy ? { cannotMatch: false, reason: blockedBy, tags, fields }
    : { cannotMatch: true, reason: type === 'contact_tag' ? 'every row requires an exact tag the run never adds' : 'every row fires only on a field the run provably never touches', tags, fields };
}

export function judgeTrigger(t, eventSet, convAi = null, runS = null) {
  const type = t?.type ?? null;
  if (t?.active === false) return { type, decision: 'inactive', reason: 'active:false' };
  if (type === null) return { type: 'UNTYPED', decision: 'blocks', reason: 'a live trigger with no type' };
  if (workflowExempt(runS, type)) return { type, decision: 'not in event set', reason: 'exempt for this run S (WORKFLOW_RUN_EXEMPTIONS)' };
  if (type === 'contact_tag' || type === 'contact_changed') {
    // DEFAULT-BLOCK (QA 2026-11-22 point 1): a flow or agent fired by a test contact can add ANY tag or change ANY field, so no condition proves the run cannot satisfy it.
    // judgeConditions only DESCRIBES the row for the record (tag names / field names); it never clears it.
    const j = judgeConditions(type, t.conditions, eventSet?.plannedTags);
    return { type, decision: 'blocks', reason: `default-block: ${type} is live and no run S exempts it (conditions: ${j.reason})`, tags: type === 'contact_tag' ? j.tags : undefined, fields: j.fields };
  }
  if (ALWAYS_BLOCK.includes(type)) return { type, decision: 'blocks', reason: 'can fire from a contact the run creates or updates' };
  const flagged = (flag, why) => ({ type, decision: 'blocks', reason: `default-block: ${why}`, flag });
  if (type === 'custom_date_reminder') return flagged('customFieldWrite', 'it fires from a contact custom date field');
  if (type === 'form_submission') return flagged('formSubmission', 'it fires from a form submission');
  if (type === 'dnd_contact') return flagged('dndWrite', 'it fires when DND is set or changed on a contact');
  if (type === 'customer_reply') return flagged('inboundMessage', 'it fires on an inbound message from the contact; a conversation plus an internal comment creates none');
  if (/^conv_ai_/.test(type)) {
    // Fires on a bot session start. A session can start with NO inbound message when an agent has an enabled outbound trigger the run produces (convai-census.mjs).
    if (eventSet?.inboundMessage) return { type, decision: 'blocks', reason: "this batch's event set has inboundMessage", flag: 'inboundMessage' };
    if (!convAi || convAi.ok !== true) return { type, decision: 'blocks', reason: `the Conversation AI census is not a complete read (${convAi?.reason ?? 'not run'})`, flag: 'convAiOutbound' };
    if (convAi.blocks) return { type, decision: 'blocks', reason: convAi.reason, flag: 'convAiOutbound' };
    return { type, decision: 'blocks', reason: 'default-block: a conv_ai_* trigger is live and no run S exempts it', flag: 'convAiOutbound' };
  }
  return { type, decision: 'blocks', reason: 'unknown or unmapped trigger type' };
}

// FAIL CLOSED (orchestrator 2026-11-22 safety fix): the Conversation AI census is clean ONLY when it was read completely (ok === true) AND found nothing (blocks === false).
// Blocked, unreadable or missing all read as NOT clean, whether or not any published workflow carries a conv_ai_* trigger. The one helper both callers use.
export const convAiClean = (convAi) => convAi?.ok === true && convAi?.blocks === false;
export const censusClean = (c) => c?.ok === true && Array.isArray(c?.blockers) && c.blockers.length === 0 && convAiClean(c?.convAi);
export async function publishedTriggerCensus({ call, gw, LOCATION, eventSet = EVENT_SETS.conversation, pausable = [], convAi = null, runS = null }) {
  const lw = await call('list_workflows', { status: 'published', pageSize: 100, maxPages: 100 });
  const rows = lw.data?.workflows;
  if (lw.ok !== true || lw.data?.complete !== true || !Array.isArray(rows)) {
    return { ok: false, reason: `the published list is not a complete read (${lw.code ?? ''} complete=${lw.data?.complete ?? null})`, rows: [], blockers: [], candidates: [], nonTest: [], eventSet: eventSet.name };
  }
  const readTriggers = async (id) => {
    const r = await gw.call('GET', `/workflow/${encodeURIComponent(LOCATION)}/trigger?workflowId=${encodeURIComponent(id)}`);
    const list = r.json?.triggers ?? (Array.isArray(r.json) ? r.json : null);
    return r.ok && Array.isArray(list) ? list : null;
  };
  const out = [];
  for (const w of rows) {
    const id = w.id ?? w._id;
    const list = (await readTriggers(id)) ?? (await readTriggers(id)); // an unreadable list is retried ONCE
    if (!list) { out.push({ id, name: w.name, readable: false, decisions: [{ type: 'UNREADABLE', decision: 'blocks', reason: 'the trigger list could not be read twice' }], blocking: ['UNREADABLE'] }); continue; }
    const decisions = list.map((t) => judgeTrigger(t, eventSet, convAi, runS));
    out.push({ id, name: w.name, readable: true, decisions, blocking: decisions.filter((d) => d.decision === 'blocks').map((d) => d.type) });
  }
  // A named non-TEST flow whose ONLY blocking triggers are dnd_contact may be PAUSED by the suite for the member span (pause-flow.mjs). It is listed
  // as `pausable`, not as a blocker; the suite pauses it and re-runs this census WITHOUT the allowance, which must then be clean.
  const canPause = (x) => x.blocking.length > 0 && !isTestConf(x.name) && pausable.some((a) => a.id === x.id && a.name === x.name)
    && x.decisions.filter((d) => d.decision === 'blocks').every((d) => d.type === 'dnd_contact');
  const pausableRows = out.filter(canPause);
  const blockers = out.filter((x) => x.blocking.length > 0 && !canPause(x));
  if (!convAiClean(convAi)) {
    return { ok: false, total: rows.length, rows: out, blockers, candidates: blockers.filter((x) => isTestConf(x.name)), nonTest: blockers.filter((x) => !isTestConf(x.name)), pausable: [], convAi, convAiNotClean: true,
      reason: `the Conversation AI census is not clean (${convAi?.ok !== true ? `not a complete read: ${convAi?.reason ?? 'not run'}` : `blocks: ${convAi?.reason ?? 'an agent can fire'}`})`, eventSet: eventSet.name };
  }
  return { ok: true, total: rows.length, rows: out, blockers, candidates: blockers.filter((x) => isTestConf(x.name)), nonTest: blockers.filter((x) => !isTestConf(x.name)), pausable: pausableRows, convAi, reason: null, eventSet: eventSet.name };
}

// What the record carries: id, name, trigger type, decision and reason, plus tag names for contact_tag and field names for contact_changed. Never a condition
// value other than a tag name, and nothing from a trigger's actions.
export const censusRecord = (c) => ({ ok: c.ok, reason: c.reason, eventSet: c.eventSet, publishedWorkflows: c.total ?? 0, blockers: (c.blockers ?? []).length, convAi: c.convAi ? { ok: c.convAi.ok, blocks: c.convAi.blocks, reason: c.convAi.reason, otherComponents: c.convAi.otherComponents ?? null, agents: (c.convAi.agents ?? []).map((a) => ({ id: a.id, mode: a.mode, blocks: a.blocks, why: a.why, triggers: a.triggers })) } : null, pausable: (c.pausable ?? []).map((x) => ({ id: x.id, name: x.name, blocking: x.blocking })),
  rows: (c.rows ?? []).map((x) => ({ id: x.id, name: x.name, decisions: x.decisions.map((d) => ({ type: d.type, decision: d.decision, reason: d.reason, ...(d.flag ? { flag: d.flag } : {}), ...(d.tags?.length ? { tags: d.tags } : {}), ...(d.fields?.length ? { fields: d.fields } : {}) })), blocking: x.blocking })) });

// The ONLY write the runner may make on a census finding: take TEST-CONF-* candidates down (unpublish), never delete. Each target is proven by id
// AND name (a second read of the workflow must return the same name with the TEST-CONF prefix), the affected list is printed first, ambiguity
// refuses, and every one is read back as draft.
export async function unpublishCandidates({ call, candidates, print = console.log }) {
  const seen = new Set();
  for (const c of candidates) {
    if (!c.id || seen.has(c.id) || !isTestConf(c.name)) return { ok: false, refused: `ambiguous or non-TEST-CONF target (${c.id ?? 'no id'})`, results: [] };
    seen.add(c.id);
  }
  print(`census: ${candidates.length} published TEST-CONF workflow(s) carry a live contact-firing trigger; they will be UNPUBLISHED (never deleted):`);
  for (const c of candidates) print(`  ${c.id}  ${c.name}  [${c.blocking.join(', ')}]`);
  const results = [];
  for (const c of candidates) {
    const g = await call('get_workflow', { workflowId: c.id });
    if (!(g.ok === true && g.data?.name === c.name && g.data?.status === 'published')) { results.push({ id: c.id, name: c.name, unpublished: false, why: `re-read does not match (name=${g.data?.name ?? null} status=${g.data?.status ?? null})` }); return { ok: false, refused: 'a target did not re-read as the same name and published', results }; }
    const fails = [];
    const un = await unpublishAndAssertDraft(call, (cond, msg, detail) => { if (!cond) fails.push(`${msg}: ${detail ?? ''}`); }, c.id, 'census candidate');
    const draft = fails.length === 0;
    const after = await call('get_workflow', { workflowId: c.id });
    results.push({ id: c.id, name: c.name, unpublished: un.ok === true && draft, status: after.data?.status ?? null });
    if (!(un.ok === true && draft)) return { ok: false, refused: 'an unpublish did not read back as draft', results };
  }
  return { ok: true, results };
}
