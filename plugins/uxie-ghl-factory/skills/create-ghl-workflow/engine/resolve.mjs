// Account-ID resolver. Turns human names in an IR into the real entity IDs the
// target sub-account uses, so ID-bearing steps/filters reference things that
// actually exist (not foreign corpus IDs). Two halves:
//   - buildResolvers(raw)  — pure: takes fetched entity lists, returns name→id lookups
//   - resolveIR(ir, r)     — pure: walks the IR, rewrites known name fields to IDs
// The live fetch (which endpoints, which token) lives in the caller; these stay pure
// so they're unit-testable offline.
import { isOppStageCondition } from './ir.mjs';

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Standard contact fields — their `field` key is a literal name, never a custom-field id,
// so the resolver leaves them alone.
const STANDARD_CONTACT_FIELDS = new Set([
  'phone', 'email', 'firstName', 'lastName', 'name', 'fullName', 'address', 'address1',
  'city', 'state', 'country', 'postalCode', 'companyName', 'businessName', 'website',
  'dateOfBirth', 'timezone', 'source', 'tags', 'dnd', 'gender', 'type', 'assignedTo',
]);

// raw = { pipelines:[{id,name,stages:[{id,name}]}], calendars:[{id,name}],
//         users:[{id,firstName,lastName,email,name}], forms:[{id,name}],
//         surveys:[{id,name}], customFields:[{id,name,fieldKey}], workflows:[{id,name,status}],
//         customValues:[{id,name,fieldKey}], triggerLinks:[{id,name}], offers:[{id,name}],
//         membershipProducts:[{id,name}] }
export function buildResolvers(raw = {}) {
  const pipelines = raw.pipelines ?? [];
  const byName = (list, keyFns) => (q) => {
    const n = norm(q);
    return (list ?? []).find((x) => keyFns.some((f) => norm(f(x)) === n));
  };
  const pipeline = byName(pipelines, [(p) => p.name]);
  return {
    pipeline,
    pipelineId: (q) => pipeline(q)?.id,
    // stage lookup: within a named pipeline if given, else across all pipelines
    stageId: (stageName, pipeName) => {
      const scope = pipeName ? [pipeline(pipeName)].filter(Boolean) : pipelines;
      for (const p of scope) { const s = (p.stages ?? []).find((x) => norm(x.name) === norm(stageName)); if (s) return s.id; }
      return undefined;
    },
    calendarId: (q) => byName(raw.calendars, [(c) => c.name])(q)?.id,
    formId: (q) => byName(raw.forms, [(f) => f.name])(q)?.id,
    surveyId: (q) => byName(raw.surveys, [(s) => s.name])(q)?.id,
    userId: (q) => byName(raw.users, [(u) => u.email, (u) => u.name, (u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`])(q)?.id,
    customFieldId: (q) => byName(raw.customFields, [(c) => c.name, (c) => c.fieldKey])(q)?.id,
    // AI agents (voice + conversation AI), matched by name
    agentId: (q) => byName(raw.agents, [(a) => a.name, (a) => a.agentName, (a) => a.title])(q)?.id,
    // SECOND-ORDER (G1–G3): workflows / custom values / trigger links / offers / course products
    workflowId: (q) => byName(raw.workflows, [(w) => w.name])(q)?.id,
    customValueId: (q) => byName(raw.customValues, [(v) => v.name, (v) => v.fieldKey, (v) => String(v.fieldKey ?? '').replace(/^\{\{\s*custom_values\./, '').replace(/\s*\}\}$/, '')])(q)?.id,
    triggerLinkId: (q) => byName(raw.triggerLinks, [(l) => l.name])(q)?.id,
    offerId: (q) => byName(raw.offers, [(o) => o.name, (o) => o.title])(q)?.id,
    membershipProductId: (q) => byName(raw.membershipProducts, [(m) => m.name, (m) => m.title])(q)?.id,
  };
}

// True if the string already looks like a resolved id (leave it alone).
const looksLikeId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(v) && !/\s/.test(v);

// Rewrite a filter value that references an entity by name → its id.
function resolveFilterValue(field, value, r) {
  const one = (v) => {
    if (looksLikeId(v)) return v;
    if (field === 'opportunity.pipelineId') return r.pipelineId(v) ?? v;
    if (field === 'opportunity.pipelineStageId') return r.stageId(v) ?? v;
    if (field === 'calendar.id') return r.calendarId(v) ?? v;
    if (field === 'form.id') return r.formId(v) ?? v;
    if (field === 'survey.id') return r.surveyId(v) ?? v;
    if (field === 'opportunity.assignedTo' || field === 'task.assignedTo') return r.userId(v) ?? v;
    if (field === 'link.id') return r.triggerLinkId(v) ?? v;                       // trigger_link
    if (field === 'membership.product.id') return r.membershipProductId(v) ?? v;   // course triggers
    if (field === 'offer.id') return r.offerId(v) ?? v;                            // offer/membership triggers
    return v;
  };
  return Array.isArray(value) ? value.map(one) : one(value);
}

// Walk every node scope (mirrors ir.mjs SCOPE_KEYS) applying `visit`.
const SCOPE_KEYS = ['onEvent', 'onTimeout', 'onFound', 'onNotFound', 'default'];
function walk(nodes, visit) {
  for (const n of nodes ?? []) {
    visit(n);
    for (const b of n.branches ?? []) walk(b.then, visit);
    for (const p of n.paths ?? []) walk(p.then, visit);
    for (const k of SCOPE_KEYS) walk(n[k], visit);
  }
}

// Rewrite known name fields → ids, in place. Returns { ir, unresolved:[{where,name}] }.
// Convention: authors may put a human name in `pipeline`/`stage`/`calendar`/`user`
// (alongside or instead of the id field); the resolver fills the id field.
export function resolveIR(ir, r) {
  const unresolved = [];
  const need = (id, where, name) => { if (!id) unresolved.push({ where, name }); return id; };

  for (const t of ir.triggers ?? []) {
    for (const f of t.filters ?? []) {
      if (f.value == null) continue;
      const field = f.field ?? f.on;
      const before = JSON.stringify(f.value);
      f.value = resolveFilterValue(field ?? '', f.value, r);
      if (JSON.stringify(f.value) === before && /\.(id|pipelineId|pipelineStageId|assignedTo)$/.test(field ?? '') && !Array.isArray(f.value) && !looksLikeId(f.value)) {
        // couldn't resolve a name-looking value on an id field
        unresolved.push({ where: `trigger ${t.type} filter ${field}`, name: f.value });
      }
    }
  }

  walk(ir.graph, (n) => {
    const a = n.attributes ?? {};
    const type = n.type;
    // opportunity steps: pipeline/stage names → ids
    if (type === 'create_opportunity' || type === 'update_opportunity' || type === 'find_opportunity') {
      if (a.pipeline && !a.pipelineId) a.pipelineId = need(r.pipelineId(a.pipeline), `${type}.pipeline`, a.pipeline);
      if (a.stage && !a.stageId) a.stageId = need(r.stageId(a.stage, a.pipeline), `${type}.stage`, a.stage);
    }
    // assign_user: user name/email → user_list
    if (type === 'assign_user' && a.user && !a.user_list) {
      const id = need(r.userId(a.user), 'assign_user.user', a.user);
      if (id) a.user_list = [id];
    }
    // task-notification / opportunity owner: assignedTo/owner name → id (skip literals like contact_owner)
    if (type === 'task-notification' && a.assignedTo && !looksLikeId(a.assignedTo) && !/_/.test(a.assignedTo)) {
      a.assignedTo = need(r.userId(a.assignedTo), 'task.assignedTo', a.assignedTo) ?? a.assignedTo;
    }
    // appointment_booking: calendar name → calendarId
    if (type === 'appointment_booking' && a.calendar && !a.calendarId) {
      a.calendarId = need(r.calendarId(a.calendar), 'appointment_booking.calendar', a.calendar);
    }
    // add_to_workflow / remove_from_workflow: workflow NAME → workflow_id (G1)
    if ((type === 'add_to_workflow' || type === 'remove_from_workflow') && a.workflow && !a.workflow_id) {
      a.workflow_id = need(r.workflowId(a.workflow), `${type}.workflow`, a.workflow);
      if (a.workflow_id) delete a.workflow;   // intent key consumed (ATTR_KEY guard owns the rest)
    }
    // update_custom_value: custom value NAME/key → custom_value_id (G3)
    if (type === 'update_custom_value' && (a.customValue ?? a.custom_value) && !a.custom_value_id) {
      const q = a.customValue ?? a.custom_value;
      a.custom_value_id = need(r.customValueId(q), 'update_custom_value.customValue', q);
      delete a.customValue; delete a.custom_value;
      if (a.custom_value_id && !a.name) a.name = q;
    }
    // membership offers: offer NAME → offer_id (G2)
    if ((type === 'membership_grant_offer' || type === 'membership_revoke_offer') && a.offer && !a.offer_id) {
      a.offer_id = need(r.offerId(a.offer), `${type}.offer`, a.offer);
      delete a.offer;
    }
    // update_contact_field / create_update_contact: a fields[] entry whose `field` is a
    // human custom-field NAME (not a standard field, not already an id) → resolve to id.
    if ((type === 'update_contact_field' || type === 'create_update_contact') && Array.isArray(a.fields)) {
      for (const f of a.fields) {
        if (!f || f.field == null || STANDARD_CONTACT_FIELDS.has(f.field) || looksLikeId(f.field)) continue;
        const id = r.customFieldId(f.field);
        if (id) { if (!f.title) f.title = f.field; f.field = id; }
        else unresolved.push({ where: `${type}.field`, name: f.field });
      }
    }
    // AI agents by name: voice_ai_outbound_call.agent → agentId;
    // conversationai_* / update_conversation_ai_status .employee → assignedEmployeeId
    if (type === 'voice_ai_outbound_call' && a.agent && !a.agentId) {
      a.agentId = need(r.agentId(a.agent), 'voice_ai_outbound_call.agent', a.agent);
    }
    if (a.employee && !a.assignedEmployeeId && /^(conversationai_|update_conversation_ai_status)/.test(type ?? '')) {
      a.assignedEmployeeId = need(r.agentId(a.employee), `${type}.employee`, a.employee);
    }
    n.attributes = a;

    // if_else opportunity-stage conditions: resolve a pipeline-stage NAME → id so the
    // author can write { conditionType:'opportunities', stage:'Booked' }. Only the `stage`
    // INTENT key is resolved (a full-shape condition already carries the id in conditionValue,
    // which the compiler's normalizeCondition reads first — leave it alone). The resolved id
    // is written to conditionValue. (Tag conditions need no resolution — a tag is a literal.)
    for (const b of n.branches ?? []) {
      for (const cond of b.conditions ?? []) {
        // Match via the shared alias-aware predicate, NOT an exact type compare: an
        // aliased spelling ({conditionType:'opportunity'}) must resolve too, else the
        // stage NAME survives into conditionValue and the branch dies a second way.
        if (!cond || !isOppStageCondition(cond) || cond.stage == null) continue;
        if (looksLikeId(cond.stage)) { cond.conditionValue = cond.stage; continue; }
        const id = r.stageId(cond.stage, cond.pipeline);
        if (id) cond.conditionValue = id;
        else unresolved.push({ where: 'if_else opportunities.stage', name: cond.stage });
      }
    }
  });

  return { ir, unresolved };
}
