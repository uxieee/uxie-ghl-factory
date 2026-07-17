// Deterministic compiler: IR -> GHL builder-API payloads (create/auto-save/trigger).
// See docs/superpowers/specs/2026-07-10-create-ghl-workflow-v2-design.md §5.
import { parseIR, IRError, checkOpportunityAssociation, canonicalizeOppStageCondition,
  lintConditionShape, walkNodes, OPP_STAGE_TYPE, OPP_STAGE_SUBTYPE } from './ir.mjs';

function attributesFor(node, ctx) {
  if (node.kind === 'wait') return waitAttributes(node);
  if (node.type === 'email') return emailAttributes(node);
  if (node.type === 'custom_webhook') return webhookAttributes(node.attributes ?? {});
  if (node.type === 'custom_code') return codeAttributes(node.attributes ?? {});
  if (node.type === 'voice_ai_outbound_call') return voiceAiOutboundCallAttributes(node.attributes ?? {});
  if (node.type === 'internal_notification') return internalNotificationAttributes(node.attributes ?? {});
  if (node.type === 'create_opportunity') return createOpportunityAttributes(node.attributes ?? {});
  if (node.type === 'update_opportunity') return updateOpportunityAttributes(node.attributes ?? {}, node.ref);
  // Generic path: the author supplies intent attributes; the compiler fills the
  // two structural fields the corpus shows on this type but a human never hand-writes:
  //   - attributes.type  (mirrors the step type — present on ~all linear action types)
  //   - __customInputs__  (the internal-action field envelope — present on INTERNAL types)
  // Both are catalog-gated so we never inject a field the verified-live example lacks.
  return normalizeAttrs(node, node.attributes ?? {}, ctx);
}

// Fill structural attribute fields from the catalog's verified-live shape. Only
// touches fields the real persisted example carried, so a bare intent authoring
// (e.g. { points: 5, operator: 'add' } for contact_engagement_score) round-trips
// into the exact stored shape without the author knowing the envelope.
function normalizeAttrs(node, attrs, ctx) {
  const meta = ctx?.catalog?.step(node.type);
  if (!meta) return attrs;
  const out = { ...attrs };
  if (meta.usesCustomInputs && !('__customInputs__' in out)) out.__customInputs__ = {};
  if (Array.isArray(meta.attrKeys) && meta.attrKeys.includes('type') && !('type' in out)) {
    // internal_notification's attributes.type is the CHANNEL, not the step type —
    // derive it from whichever channel envelope the author supplied.
    out.type = node.type === 'internal_notification'
      ? (['sms', 'email', 'notification', 'whatsapp'].find((c) => c in out) ?? node.type)
      : node.type;
  }
  checkAttrKeys(node, out, meta);
  return out;
}

// Attribute keys the compiler/orchestrator/resolver own, plus the documented
// name-authoring intent keys (the resolver adds the resolved id but keeps the name).
const ENGINE_ATTR_KEYS = new Set(['type', '__customInputs__', '__customInputFields__', '_template',
  'user', 'calendar', 'agent', 'employee', 'assignedEmployeeId', 'pipeline', 'stage']);

// An invented attribute key (e.g. `message` instead of `body` on sms) saves fine
// but renders a blank step at runtime — fail at compile instead. Enforced only
// where the catalog carries a verified-live example whose key set we trust;
// bundle-derived/marketplace shapes are too loosely known to fail closed on.
function checkAttrKeys(node, out, meta) {
  if (meta.confidence !== 'verified-live' || !Array.isArray(meta.attrKeys) || meta.attrKeys.length === 0) return;
  const known = new Set([...meta.attrKeys, ...(meta.requiredFields ?? []).map((k) => k.split('.')[0]), ...ENGINE_ATTR_KEYS]);
  const bad = Object.keys(out).filter((k) => !known.has(k));
  if (bad.length)
    throw new IRError('ATTR_KEY',
      `unknown attribute key(s) [${bad.join(', ')}] on '${node.ref}' (${node.type}) — ` +
      `known keys for this type: ${meta.attrKeys.join(', ')}. An invented key saves but renders a blank step; ` +
      `check the corpus example (${meta.example ?? 'catalog'}) for the real shape.`);
}

// Opportunity actions store their fields in a __customInputFields__ array
// (live-verified shape). Each field = {filterField, value, dataType, valueFieldType, __customInputs__}.
// The IR supplies resolved pipelineId + stageId (the orchestrator resolves names→ids via the
// pipelines list, like tags/templates).
function oppField(filterField, value, dataType, valueFieldType) {
  return { __customInputs__: {}, dataType, filterField, value, valueFieldType };
}
function createOpportunityAttributes(a) {
  const f = [];
  if (a.name != null) f.push(oppField('name', a.name, 'TEXT', 'string'));
  if (a.stageId != null) f.push(oppField('pipelineStageId', a.stageId, 'SINGLE_OPTIONS', 'select'));
  f.push(oppField('status', a.status ?? 'open', 'SINGLE_OPTIONS', 'select'));
  if (a.source != null) f.push(oppField('source', a.source, 'TEXT', 'string'));
  if (a.value != null) f.push(oppField('monetaryValue', String(a.value), 'NUMERICAL', 'number'));
  return { pipelineId: a.pipelineId, type: 'internal_create_opportunity', __customInputFields__: f, __customInputs__: {} };
}
// update_opportunity fields come from EITHER an explicit updates[] (full control) or the
// documented name-authoring path — attributes.pipeline/stage, which resolve.mjs turns into
// pipelineId/stageId exactly like create_opportunity. Reading only `updates` made the
// documented path compile to __customInputFields__:[] — a step that round-trips clean and
// no-ops at runtime (live 2026-07-16: a "move to Deposit Paid" step that never moved
// anything). Both paths now work; neither may produce an empty field list.
//
// allowBackward gates BACKWARD stage moves. GHL logs a regression (e.g. Booked →
// Deposit Paid on a cancellation) as [skipped] when this is false — the default — and the
// opportunity never moves. Any step that can move an opp EARLIER in its pipeline must set
// allowBackward:true. See references/build-recipe.md §6.
// The name-authoring path's known keys. The generic unknown-key guard (checkAttrKeys)
// can't police this step: it validates against the catalog's EMITTED attrKeys
// (allowBackward/type/__customInputFields__/…), none of which an author writes here —
// so every authored key looks "unknown" to it and the check is skipped wholesale.
// That left this path silently dropping typos. The trap that actually bites is
// `pipelineStageId`: it is what GHL calls the field, it is what this function EMITS, and
// it is the name the field carries in every live blob — so it is the obvious thing to
// write. The author-side key is `stageId`. Writing the emitted name got you a step with
// a pipeline and no stage, which round-trips clean and no-ops at runtime (the live
// 2026-07-16 "move to Deposit Paid that never moved anything").
const UPDATE_OPP_AUTHOR_KEYS = new Set([
  'updates', 'pipelineId', 'stageId', 'status', 'name', 'source', 'value', 'allowBackward',
  'pipeline', 'stage',    // pre-resolve name path (resolve.mjs → pipelineId/stageId)
]);
const UPDATE_OPP_ALIASES = { pipelineStageId: 'stageId', stage_id: 'stageId', pipeline_id: 'pipelineId', monetaryValue: 'value' };

function updateOpportunityAttributes(a, ref) {
  const bad = Object.keys(a).filter((k) => !UPDATE_OPP_AUTHOR_KEYS.has(k));
  if (bad.length)
    throw new IRError('UNKNOWN_ATTR',
      `update_opportunity '${ref}' has unknown attribute key(s) [${bad.join(', ')}]${
        bad.some((k) => UPDATE_OPP_ALIASES[k])
          ? ` — did you mean ${bad.filter((k) => UPDATE_OPP_ALIASES[k]).map((k) => `'${UPDATE_OPP_ALIASES[k]}' (not '${k}')`).join(', ')}?`
          : ''
      }. Author keys: ${[...UPDATE_OPP_AUTHOR_KEYS].join(', ')}. NOTE the asymmetry — you author 'stageId', `
      + `which compiles to the filterField 'pipelineStageId'; 'pipelineId' is the same on both sides. `
      + `An ignored key compiles to a step that saves, round-trips clean, and no-ops at runtime.`);
  const f = (a.updates ?? []).map((u) => oppField(u.field, u.value, u.dataType ?? 'SINGLE_OPTIONS', u.valueFieldType ?? 'select'));
  if (!f.length) {
    if (a.pipelineId != null) f.push(oppField('pipelineId', a.pipelineId, 'SINGLE_OPTIONS', 'select'));
    if (a.stageId != null) f.push(oppField('pipelineStageId', a.stageId, 'SINGLE_OPTIONS', 'select'));
    if (a.status != null) f.push(oppField('status', a.status, 'SINGLE_OPTIONS', 'select'));
    if (a.name != null) f.push(oppField('name', a.name, 'TEXT', 'string'));
    if (a.source != null) f.push(oppField('source', a.source, 'TEXT', 'string'));
    if (a.value != null) f.push(oppField('monetaryValue', String(a.value), 'NUMERICAL', 'number'));
  }
  if (!f.length)
    throw new IRError('EMPTY_STEP',
      `update_opportunity '${ref}' has nothing to update — it would compile to ` +
      `__customInputFields__:[] and no-op at runtime while round-tripping clean. Author either ` +
      `attributes.updates:[{field,value}] or the name path attributes:{pipeline,stage,status,...}.`);
  return { allowBackward: a.allowBackward ?? false, type: 'internal_update_opportunity', __customInputFields__: f, __customInputs__: {} };
}

// voice_ai_outbound_call — places an outbound call from a configured Voice AI agent
// (live-verified 2026-07-11). `agentId` (the Voice AI agent record id) and
// `fromPhoneNumber` (the literal E.164 number string — NOT a number-pool/id reference)
// are both required in the captured schema (`required: true` on both dynamic-fields
// entries) — a step saved without them is broken, so we fail fast at compile time.
// `outboundGuidelines` is a frozen, non-interactive info-banner field; the builder
// always emits it empty on save. `__customInputs__` is an empty placeholder, unused.
function voiceAiOutboundCallAttributes(a) {
  if (!a.agentId) throw new IRError('MISSING_FIELD', "voice_ai_outbound_call requires 'agentId'");
  if (!a.fromPhoneNumber) throw new IRError('MISSING_FIELD', "voice_ai_outbound_call requires 'fromPhoneNumber'");
  return {
    agentId: a.agentId,
    fromPhoneNumber: a.fromPhoneNumber,
    outboundGuidelines: '',
    type: 'voice_ai_outbound_call',
    __customInputs__: {},
  };
}

// internal_notification — a staff-facing notification on one of 4 channels
// (email/sms/notification/whatsapp), discriminated by attributes.type. The channel object
// must carry the exact fields the builder's editor form binds to, or the editor WON'T OPEN
// when the step is clicked (it still fires fine at runtime — which is why this class of bug
// stayed invisible). Field sets are the corpus-canonical shape from 180 live UI-built steps
// (ghl-internal-api-research, harvested 2026-07-15). Two typing traps the generic passthrough
// missed: (1) selectedUser is an ARRAY for email/sms/whatsapp but a STRING for notification;
// (2) userType is always present. When userType is 'user', selectedUser names the recipients;
// for 'all'/'assign'/'custom_*' the corpus omits selectedUser.
// NOTE: "editor opens" is a client-side builder behavior that can only be *confirmed* in the
// live builder — this handler makes the emitted step match real editable steps field-for-field.
const NOTIFICATION_CHANNELS = ['email', 'sms', 'notification', 'whatsapp'];
function asUserArray(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}
function internalNotificationAttributes(a) {
  const channel = (a.type && NOTIFICATION_CHANNELS.includes(a.type) ? a.type : null)
    ?? NOTIFICATION_CHANNELS.find((c) => c in a) ?? 'email';
  const b = a[channel] ?? {};
  const userType = b.userType ?? (b.selectedUser != null && b.selectedUser !== '' ? 'user' : 'all');
  const wantsUsers = userType === 'user';
  if (channel === 'email') {
    return { type: 'email', email: {
      from_name: b.from_name ?? '{{location.name}}',
      from_email: b.from_email ?? '{{location.email}}',
      userType,
      subject: b.subject ?? '',
      html: b.html ?? '',
      attachments: b.attachments ?? [],
      ...(wantsUsers ? { selectedUser: asUserArray(b.selectedUser) } : {}),
    } };
  }
  if (channel === 'sms') {
    return { type: 'sms', sms: {
      body: b.body ?? '',
      userType,
      attachments: b.attachments ?? [],
      ...(wantsUsers ? { selectedUser: asUserArray(b.selectedUser) } : {}),
    } };
  }
  if (channel === 'notification') {
    // the in-app bell: selectedUser is a single STRING, and the object carries its own
    // nested `type` (send_notification) plus title/redirectPage the editor requires.
    const sel = asUserArray(b.selectedUser);
    return { type: 'notification', notification: {
      type: b.notificationType ?? 'send_notification',
      body: b.body ?? '',
      title: b.title ?? '',
      redirectPage: b.redirectPage ?? 'contact',
      userType,
      ...(wantsUsers ? { selectedUser: sel[0] ?? '' } : {}),
    } };
  }
  // whatsapp — the staff-facing channel of internal_notification (not the native action)
  return { type: 'whatsapp', whatsapp: {
    body: b.body ?? '',
    userType,
    selectedUser: asUserArray(b.selectedUser),
  } };
}

// custom_webhook (outbound HTTP) — live-verified shape. body.rawData is a JSON STRING;
// headers/parameters are arrays of {key,value}; authorization is a {type,data} union.
function webhookAttributes(a) {
  return {
    event: a.event ?? 'CUSTOM',
    method: a.method ?? 'POST',
    url: a.url ?? '',
    body: a.body ?? { contentType: 'application/json', rawData: a.rawData ?? '{}', keyValueData: [] },
    headers: a.headers ?? [],
    parameters: a.parameters ?? [],
    authorization: a.authorization ?? { type: 'NONE', data: null },
    saveResponse: a.saveResponse ?? false,
    webhookResponse: a.webhookResponse ?? { isSampleRequested: false, selectedContact: '' },
  };
}

// custom_code (JS sandbox) — `code` is a function body; `inputData` is a flat object
// {key:value}; `output` is a REQUIRED hand-populated sample of the return value (publish
// blocks on empty output). Sandbox HTTP uses customRequest.*, not fetch.
function codeAttributes(a) {
  return {
    code: a.code ?? 'return {};',
    language: a.language ?? 'javascript',
    inputData: a.inputData ?? {},
    output: a.output ?? {},
  };
}

// wait — 9 subtypes discriminated by attributes.type. This builds LINEAR waits
// (single next). Multipath waits (timeout branching) are handled in flattenGraph.
function waitAttributes(node) {
  const a = node.attributes ?? {};
  const hybrid = { cat: '', isHybridAction: true, hybridActionType: 'wait', convertToMultipath: false, transitions: [] };
  const wt = node.waitType ?? (node.config ? 'time' : (a.type ?? 'time'));
  if (wt === 'time') {
    // Duration may be authored two ways: the canonical node.config {unit,value,when},
    // or attributes.startAfter {type,value,when} — the shape a live workflow blob stores,
    // which is what an author mirroring a real export naturally writes. Reading only
    // node.config meant the blob shape compiled to startAfter:{} and the wait DID NOT
    // PAUSE: on a live account 2026-07-16 a warm-catch + nudge + 2 close messages + a tag
    // all fired within 6 SECONDS instead of over 6 days. An empty or partial startAfter
    // must never compile.
    const c = node.config ?? {};
    const startAfter = { type: c.unit ?? a.startAfter?.type, value: c.value ?? a.startAfter?.value,
      when: c.when ?? a.startAfter?.when ?? 'after' };
    if (startAfter.type == null || startAfter.value == null)
      throw new IRError('EMPTY_STEP',
        `wait '${node.ref}' has no usable duration — a time wait needs config:{unit,value,when} ` +
        `(or attributes.startAfter:{type,value,when}). Got startAfter:${JSON.stringify(startAfter)}. ` +
        `An empty/partial startAfter compiles and publishes clean but the wait DOES NOT PAUSE at ` +
        `runtime — every following step fires immediately.`);
    const base = { type: 'time', startAfter, ...hybrid };
    // "Advance window" — resume-on days + resume-between-hours (live-verified shape).
    // Accept it from either the node level or attributes, mirroring the duration.
    const w = node.window ?? a.window;
    if (w) {
      base.window = w.condition === 'exact'
        ? { condition: 'exact', days: w.days ?? [], start: w.start }
        : { condition: 'when', days: w.days ?? [0, 1, 2, 3, 4, 5, 6], start: w.start, end: w.end };
      base.windowCondition = { field: '', operator: '', value: '' };
    }
    return base;
  }
  // other subtypes (appointment, email_event, link_clicked, condition, ...): the IR supplies
  // the subtype-specific fields in node.attributes; we set type + hybrid flags.
  return { type: wt, ...a, ...hybrid };
}

// Email attributes — fills the fields the builder requires (live-verified 2026-07-10:
// a bare {subject,html} email shows an error until these are present). Handles both the
// inline-HTML path and the template path. For template mode the `template_id` must already
// exist (created via POST /emails/builder by the orchestrator) — a non-existent id errors.
function emailAttributes(node) {
  const a = node.attributes ?? {};
  const base = {
    trackingOptions: a.trackingOptions ?? { hasTrackingLinks: true, hasUtmTracking: true, hasTags: false },
    conditions: a.conditions ?? [],
    subject: a.subject ?? '',
    preHeader: a.preHeader ?? '',
    from_name: a.from_name ?? '{{location.name}}',
    from_email: a.from_email ?? '{{location.email}}',
    templateCreationMode: a.templateCreationMode ?? 'existing',
    syncEnabled: a.syncEnabled ?? false,
    attachments: a.attachments ?? [],
    fieldDefaults: a.fieldDefaults ?? { subject: {} },
  };
  if (a.template_id) {
    // template path: html lives in the template, not the step
    base.template_id = a.template_id;
    base.templatesource = a.templatesource ?? 'email-builder';
  } else {
    // inline path: NO template_id key (a literal "none" errors); html on the step
    base.html = a.html ?? '';
    base.htmlDefaults = a.htmlDefaults ?? {};
  }
  return base;
}

function typeFor(node) {
  if (node.kind === 'wait') return 'wait';
  if (node.type === 'create_opportunity') return 'internal_create_opportunity';
  if (node.type === 'update_opportunity') return 'internal_update_opportunity';
  return node.type; // action / raw
}

// GHL's native per-action pause is a top-level template flag. Only add it when
// author intent is explicitly disabled:true; false/absent keeps the existing
// emitted shape. Merge, rather than replace, canvas metadata so a position (or
// any future builder-owned metadata) survives unchanged.
function withStepDisabled(node, template) {
  if (node.disabled !== true) return template;
  return {
    ...template,
    advanceCanvasMeta: {
      ...(node.advanceCanvasMeta ?? {}),
      ...(template.advanceCanvasMeta ?? {}),
      isDisabled: true,
    },
  };
}

// Resolve a stable id for a ref. NAMED refs (ref defined) are cached in refMap so
// goto/reply can target them and repeated mentions reuse the same id. REF-LESS
// nodes/branches (ref === undefined/null) must get a FRESH id on every call:
// caching them all under the single `undefined` key would collapse every anonymous
// branch onto ONE id — duplicating branch ids in a container's next[] and (because
// GHL dedupes branch entries by id) dropping the later branches' segments. That was
// the live if_else defect root-caused 2026-07-15 (next:[b1,b2,b2], "else" branch with
// empty segments). split/ai_decision never hit this because they mint ids positionally.
function idForRef(refMap, ctx, ref) {
  if (ref === undefined || ref === null) return ctx.idGen();
  if (!refMap.has(ref)) refMap.set(ref, ctx.idGen());
  return refMap.get(ref);
}

// Frozen UI-hint arrays present on every live UI-built if_else condition (harvested
// 2026-07-15 from the ghl-internal-api-research corpus; the 10-item UI capture —
// correct-ifelse-reference.json). Constant across conditions — copied verbatim; the
// builder/runtime carry them on the stored condition object.
export const IFELSE_NESTED_DROPDOWN_TYPES = ['inboundWebhookRequest', 'sheet', 'datetime_formatter',
  'custom_webhook', 'array_functions', 'ivr_gather', 'ivr_connect_call', 'custom_code',
  'ai_agent', 'task-notification'];
export const IFELSE_ALLOW_IS_OPERATOR_TYPES = ['contact_reply', 'inboundWebhookRequest', 'custom_webhook',
  'custom_code', 'ai_agent', 'contact_detail', 'array_functions', 'appointment', 'service_booking',
  'rental_booking'];

// Intent-only authoring keys the normalizer consumes but that must NOT survive into the
// stored condition object (`tag`/`stage`/`not`/`trigger`), plus the four canonical shape
// fields the normalizer always sets explicitly. Everything else on the authored condition
// is passed through untouched (forward-compat: __conditionId, ifElseNodeId, envelope hints…).
const CONDITION_INTENT_KEYS = new Set(['tag', 'stage', 'not', 'trigger',
  'conditionType', 'conditionSubType', 'conditionOperator', 'conditionValue']);
function conditionExtras(c) {
  const out = {};
  for (const k of Object.keys(c)) if (!CONDITION_INTENT_KEYS.has(k)) out[k] = c[k];
  return out;
}

// Normalize an authored if_else condition into the correct GHL 4-tuple SHAPE by type.
// The per-type shapes were captured from live UI-built conditions (2026-07-15,
// correct-ifelse-reference.json + workflow fc0d50bc) and differ enough that authors must
// NOT hand-craft them — a wrong shape compiles clean but MATCHES WRONGLY at runtime (silent).
// So the author writes simple INTENT and the compiler emits the exact stored shape:
//
//   Tag       { conditionType:'contact_detail', tag:'vip' }            (add not:true for "does not have")
//     → conditionSubType:'tags', conditionOperator:'index-of-true'|'index-of-false',
//       conditionValue:['vip']   (ALWAYS an array; subType is 'tags' PLURAL, not 'tag')
//   Opp stage { conditionType:'opportunities', stage:'<id or name>' }  (name→id resolved in resolve.mjs)
//     → conditionSubType:'pipelineStageId', conditionOperator:'==', conditionValue:'<stageId>' (string)
//   Field     { conditionType:'contact_detail', conditionSubType:'<fieldId>', conditionValue:'X' }
//     → conditionOperator:'contain', conditionValue lowercased  (UI "Is <value>" → contain + lowercase)
//       number/date fields: pass conditionOperator:'==' explicitly (no lowercasing).
//   Trigger   { conditionType:'trigger', conditionValue:'<triggerId>' } → conditionOperator:'=='
//
// A full author-supplied shape round-trips unchanged (idempotent); a WRONG legacy tag shape
// ({conditionSubType:'tag', conditionOperator:'contains'}) is REWRITTEN to the correct one.
export function normalizeCondition(rawC) {
  // Canonicalize opp-stage aliases FIRST so the per-type dispatch below (and the
  // resolver, which shares this helper) only ever sees the one true spelling.
  const c = canonicalizeOppStageCondition(rawC);
  const extras = conditionExtras(c);
  const type = c.conditionType;

  // Tag on contact_detail: `tag` intent key, or a (correct/legacy) tags/tag subType.
  const tagIntent = c.tag !== undefined || c.conditionSubType === 'tags' || c.conditionSubType === 'tag';
  if (type === 'contact_detail' && tagIntent) {
    const raw = c.tag ?? c.conditionValue;
    const negate = c.not === true || c.conditionOperator === 'index-of-false'
      || c.conditionOperator === 'not-contains';
    return {
      ...extras,
      conditionType: 'contact_detail',
      conditionSubType: 'tags',
      conditionOperator: negate ? 'index-of-false' : 'index-of-true',
      conditionValue: raw == null ? [] : (Array.isArray(raw) ? raw : [raw]),
    };
  }

  // Opportunity pipeline stage: `stage` intent key, or the pipelineStageId subType.
  // resolve.mjs turns a stage NAME into an id and writes it to conditionValue before compile;
  // conditionValue therefore wins over the raw `stage` name here.
  const stageIntent = c.stage !== undefined || c.conditionSubType === OPP_STAGE_SUBTYPE;
  if (type === OPP_STAGE_TYPE && stageIntent) {
    const raw = c.conditionValue ?? c.stage;
    return {
      ...extras,
      conditionType: OPP_STAGE_TYPE,
      conditionSubType: OPP_STAGE_SUBTYPE,
      conditionOperator: '==',
      conditionValue: Array.isArray(raw) ? raw[0] : raw,
    };
  }

  // Trigger identity.
  if (type === 'trigger') {
    return {
      ...extras,
      conditionType: 'trigger',
      conditionSubType: c.conditionSubType,
      conditionOperator: '==',
      conditionValue: c.conditionValue ?? c.trigger,
    };
  }

  // contact_detail custom field: default to the UI's "Is <value>" → contain + lowercase.
  // number/date fields want '=='; the author signals that by passing conditionOperator:'=='.
  if (type === 'contact_detail') {
    const op = c.conditionOperator ?? 'contain';
    let val = c.conditionValue;
    if (op === 'contain' && typeof val === 'string') val = val.toLowerCase();
    return { ...extras, conditionType: 'contact_detail', conditionSubType: c.conditionSubType, conditionOperator: op, conditionValue: val };
  }

  // Anything else: pass the shape through as authored (operator defaults to '==').
  return {
    ...extras,
    conditionType: type,
    conditionSubType: c.conditionSubType,
    conditionOperator: c.conditionOperator ?? '==',
    conditionValue: c.conditionValue,
  };
}

// Enrich an authored if_else condition into the full stored shape. First NORMALIZE the shape
// by type (normalizeCondition), then add the envelope real conditions carry: a generated
// __conditionId, ifElseNodeId:"", isWait:false, the two constant UI-hint arrays, and (for
// contact_detail) __customFieldType__:"standard". Any envelope value the author supplied wins.
export function expandCondition(c, ctx) {
  // normalizeCondition canonicalizes every alias it recognizes; the lint is the
  // fail-closed backstop for a shape it could not (e.g. an opp type paired with an
  // unrecognized subType), which would otherwise be stored as a silently-dead branch.
  const n = lintConditionShape(normalizeCondition(c));
  const out = {
    conditionType: n.conditionType,
    conditionSubType: n.conditionSubType,
    conditionOperator: n.conditionOperator,
    conditionValue: n.conditionValue,
    __conditionId: n.__conditionId ?? ctx.idGen(),
    ifElseNodeId: n.ifElseNodeId ?? '',
    isWait: n.isWait ?? false,
    nestedDropdownTypes: n.nestedDropdownTypes ?? IFELSE_NESTED_DROPDOWN_TYPES,
    allowIsOperatorTypes: n.allowIsOperatorTypes ?? IFELSE_ALLOW_IS_OPERATOR_TYPES,
  };
  if (n.conditionType === 'contact_detail') out.__customFieldType__ = n.__customFieldType__ ?? 'standard';
  // carry any extra author-specified keys through untouched (forward-compat)
  for (const k of Object.keys(n)) if (!(k in out)) out[k] = n[k];
  return out;
}

// Flatten a linear scope into template objects, wiring next/parentKey/order.
// parentScopeId: the id set as `parent` for nodes in this scope (null at root).
// Returns { templates, entryId }.
export function flattenGraph(nodes, ctx, refMap, parentScopeId = null) {
  const templates = [];
  const ids = nodes.map((n) => idForRef(refMap, ctx, n.ref));
  nodes.forEach((n, i) => {
    // Record that this node was actually reached by the flattener. compile() diffs this
    // against the authored graph to prove nothing was silently dropped (see NODE_DROPPED).
    ctx.__visited?.add(n);
    const id = ids[i];
    const next = i < nodes.length - 1 ? ids[i + 1] : null;
    const parentKey = i > 0 ? ids[i - 1] : (parentScopeId ?? null);

    if (n.kind === 'if_else') {
      // Runtime-correct structure, diffed against a live UI-built condition-node
      // (harvested 2026-07-15). CONDITIONED branches and the else/None are DIFFERENT
      // things: the container's next[] is [...conditionedBranchNodeIds, noneNodeId] — the
      // None is ALWAYS a SEPARATE node (even when no else is authored), never fused onto a
      // conditioned branch. `attributes.branches` holds the CONDITIONED branches ONLY.
      // The pre-2026-07-15 bug fused them (next.length === branches.length, else with a
      // phantom empty-segments entry); that broke the runtime graph compile so the step
      // BEFORE the container went terminal and the contact hit end_of_workflow there,
      // never reaching the condition. The earlier 2026-07-15 patch only de-duplicated the
      // reused else id (next:[b1,b2,b2]) — it did NOT split out the None node.
      // OPEN QUESTION (2026-07-17): a NESTED if_else container is the only one of the
      // eight container types that does NOT get `parent = parentScopeId` set on its own
      // entry (the others all do it explicitly before their push). It may be a genuine
      // omission or it may match GHL — the live corpus has no nested-if_else capture to
      // settle it, and changing an emitted shape on a hunch is how this engine has
      // shipped green-but-broken workflows before. Left as-is deliberately.
      // Edit-mode no longer depends on it either way: appendToBranch derives branch
      // membership by walking the `next` chain (edit.mjs scopeChain), not by filtering
      // on `parent`, so a missing parent can't orphan a subtree any more. Settle this
      // with a live capture of a nested if_else before touching it.
      const conditioned = n.branches.filter((b) => b.else !== true);
      const elseBranch = n.branches.find((b) => b.else === true);
      const conditionedIds = conditioned.map((b) => idForRef(refMap, ctx, b.ref));
      // else id reuses its ref (goto/reply targeting); a synthesized None gets a fresh id.
      const noneId = elseBranch ? idForRef(refMap, ctx, elseBranch.ref) : ctx.idGen();
      const allBranchIds = [...conditionedIds, noneId];
      const noneName = elseBranch?.name ?? 'None';
      templates.push(withStepDisabled(n, {
        id, type: 'if_else', name: n.name, order: i,
        parentKey, next: allBranchIds, nodeType: 'condition-node',
        cat: 'conditions', comments: [],
        attributes: {
          currentRecipeType: 'CUSTOM',
          branches: conditioned.map((b, bi) => ({
            id: conditionedIds[bi], name: b.name,
            segments: (b.conditions && b.conditions.length)
              ? [{ __segmentId: ctx.idGen(), operator: 'and', conditions: b.conditions.map((c) => expandCondition(c, ctx)) }]
              : [],
            operator: 'and',
            showErrors: false, branchNameError: 'Branch name cannot be empty!',
          })),
          operator: 'and',
          if: true,
          conditionName: n.name,        // <- the builder's container display label
          version: 2,
          noneBranchName: noneName,
        },
      }));
      // conditioned branch nodes (branch-yes): the editor needs the real non-empty
      // attributes shape here, NOT `{}` (an empty attributes made the node uneditable).
      conditioned.forEach((b, bi) => {
        const child = flattenGraph(b.then ?? [], ctx, refMap, conditionedIds[bi]);
        templates.push({
          id: conditionedIds[bi], type: 'if_else', name: b.name, order: bi,
          parent: id, parentKey: id, cat: 'conditions', comments: [],
          sibling: allBranchIds.filter((x) => x !== conditionedIds[bi]),
          nodeType: 'branch-yes',
          attributes: { if: false, conditionName: 'Condition', operator: 'and', branches: [] },
          next: child.entryId,
        });
        templates.push(...child.templates);
      });
      // the None node (branch-no): a separate node; next = the else fallback ladder, or
      // null when no else was authored (the builder still renders the None terminus).
      const noneChild = flattenGraph(elseBranch?.then ?? [], ctx, refMap, noneId);
      templates.push({
        id: noneId, type: 'if_else', name: noneName, order: conditioned.length,
        parent: id, parentKey: id, cat: 'conditions', comments: [],
        sibling: allBranchIds.filter((x) => x !== noneId),
        nodeType: 'branch-no',
        attributes: { else: true },
        next: noneChild.entryId,
      });
      templates.push(...noneChild.templates);
      return;
    }

    // Conversation-AI "Book appointment" node — a multi-path INTERNAL step with two
    // PRE-DEFINED branches (Appointment Booked / Appointment Not booked). Same
    // transition-step mechanics as find_opportunity. Shape mirrors the live capture
    // flow-builder-captures/conv-ai-node-templates.json exactly (2026-07-14). Tails
    // hang off `onBooked` / `onNotBooked` scopes (both optional).
    if (n.type === 'conversationai_book_appointment') {
      const attrs = n.attributes ?? {};
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const container = {
        id, type: 'conversationai_book_appointment', name: n.name ?? 'Book appointment',
        order: i, parentKey, cat: 'multi-path', workflowsActionType: 'INTERNAL', next: [t1, t2],
        attributes: {
          promptInstructions: attrs.promptInstructions ?? 'Get the customer to book an appointment',
          calendarId: attrs.calendarId,
          type: 'conversationai_book_appointment', __customInputs__: {},
          cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: t1, name: 'Appointment Booked', fields: { appointmentBooked: true, appointmentNotBooked: false }, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
            { id: t2, name: 'Appointment Not booked', fields: { appointmentNotBooked: true }, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
          ],
          __name__: n.name ?? 'Book appointment',
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      const booked = flattenGraph(n.onBooked ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: 'Appointment Booked', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: booked.entryId });
      templates.push(...booked.templates);
      const notb = flattenGraph(n.onNotBooked ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: 'Appointment Not booked', cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notb.entryId });
      templates.push(...notb.templates);
      return;
    }

    // Conversation-AI "AI splitter" node — an LLM routes the conversation to one of the
    // author-defined branches based on `attributes.description`, else the always-present
    // "No condition met" fallback (whose tail hangs off `default`). Shape mirrors the
    // captured example catalog/step-examples/conversationai_ai_splitter.json: the fallback
    // comes FIRST (conditionType:"pre-defined", meta.__branchKey__); each author branch is
    // conditionType:"user-defined" with empty meta. Each branch is a separate
    // type:"transition" node; routing is driven by description + branch name (fields stay {}).
    if (n.type === 'conversationai_ai_splitter') {
      const attrs = n.attributes ?? {};
      const authorBranches = n.branches ?? [];
      const noneId = ctx.idGen();
      const branchIds = authorBranches.map(() => ctx.idGen());
      const container = {
        id, type: 'conversationai_ai_splitter', name: n.name ?? 'AI splitter',
        order: i, parentKey, cat: 'multi-path', workflowsActionType: 'INTERNAL',
        next: [noneId, ...branchIds],
        attributes: {
          description: attrs.description ?? '',
          type: 'conversationai_ai_splitter', __customInputs__: {},
          cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: noneId, name: 'No condition met', fields: {}, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
            ...authorBranches.map((b, bi) => ({ id: branchIds[bi], name: b.name, fields: b.fields ?? {}, meta: {}, conditionType: 'user-defined' })),
          ],
          __name__: n.name ?? 'AI splitter',
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      const none = flattenGraph(n.default ?? [], ctx, refMap, noneId);
      templates.push({ id: noneId, type: 'transition', name: 'No condition met', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: none.entryId });
      templates.push(...none.templates);
      authorBranches.forEach((b, bi) => {
        const child = flattenGraph(b.then ?? [], ctx, refMap, branchIds[bi]);
        templates.push({ id: branchIds[bi], type: 'transition', name: b.name, cat: 'transition', parentKey: id, parent: id, order: bi + 1, attributes: {}, next: child.entryId });
        templates.push(...child.templates);
      });
      return;
    }

    // Multipath wait (reply/condition/email_event/link_clicked WITH a timeout) — a 2-path
    // container mirroring if_else: next=[primaryTransition, timeoutTransition], plus separate
    // type:"transition" entry steps that children hang off. Live-verified shape 2026-07-10.
    if (n.kind === 'wait' && (n.onEvent || n.onTimeout)) {
      const wt = n.waitType ?? 'reply';
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const eventDesc = n.reply?.labels?.length ? `What will happen when a contact replies on ${n.reply.labels.join(', ')}` : 'What will happen when the event fires';
      const timeoutDesc = n.timeout ? `What will happen after ${n.timeout.value} ${n.timeout.unit}` : 'What will happen on timeout';
      const startAfter = n.timeout ? { type: n.timeout.unit, value: n.timeout.value, when: n.timeout.when ?? 'after' } : undefined;
      // subtype-specific fields (reply references prior step ids — resolve via refMap)
      let subtype = {};
      if (wt === 'reply') {
        const replyIds = (n.reply?.steps ?? []).map((r) => idForRef(refMap, ctx, r));
        subtype = { reply: replyIds, replyLabel: n.reply?.labels ?? [] };
      } else {
        subtype = { ...(n.attributes ?? {}) };
      }
      const mkTrans = (tid, name, cond, primary, desc) => ({ id: tid, name, condition: cond, conditionType: 'user-defined', isPrimaryBranch: primary, description: '', attributes: { type: primary ? `wait_${wt}` : 'wait_timeout', description: desc } });
      const container = {
        id, type: 'wait', name: n.name, order: i, parentKey, next: [t1, t2], cat: 'multi-path',
        attributes: {
          type: wt, ...(startAfter ? { startAfter } : {}), ...subtype, name: n.name, cat: 'multi-path',
          timePeriodInputMode: 'standard', unitInputMode: 'standard',
          isHybridAction: true, hybridActionType: 'wait', convertToMultipath: true,
          transitions: [mkTrans(t1, 'wait', 'primary', true, eventDesc), mkTrans(t2, 'timeout', 'timeout', false, timeoutDesc)],
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      const prim = flattenGraph(n.onEvent ?? [], ctx, refMap, t1);
      templates.push({ id: t1, parentKey: id, parent: id, type: 'transition', name: 'wait', attributes: { type: `wait_${wt}`, description: eventDesc }, order: 0, cat: 'transition', next: prim.entryId });
      templates.push(...prim.templates);
      const tout = flattenGraph(n.onTimeout ?? [], ctx, refMap, t2);
      templates.push({ id: t2, parentKey: id, parent: id, type: 'transition', name: 'timeout', attributes: { type: 'wait_timeout', description: timeoutDesc }, order: 1, cat: 'transition', next: tout.entryId });
      templates.push(...tout.templates);
      return;
    }

    // find_opportunity — multipath container with PRE-DEFINED Found/Not-Found branches
    // (live-verified). Same transition-step mechanics as the multipath wait.
    if (n.type === 'find_opportunity' && (n.onFound || n.onNotFound)) {
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const fields = (n.find?.filters ?? []).map((f) => ({ __customInputs__: {}, filterField: f.field, value: f.operator ?? 'eq', secondValue: f.value }));
      const container = {
        id, type: 'find_opportunity', name: n.name, order: i, parentKey, cat: 'multi-path',
        workflowsActionType: 'INTERNAL', next: [t1, t2],
        attributes: {
          sorting: n.find?.sorting ?? 'latest', type: 'find_opportunity',
          __customInputFields__: fields, __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: t1, name: 'Opportunity Found', fields: [], meta: { __branchKey__: 'predefined_Opportunity Found' }, conditionType: 'pre-defined' },
            { id: t2, name: 'Opportunity Not Found', fields: [], meta: { __branchKey__: 'predefined_Opportunity Not Found' }, conditionType: 'pre-defined' },
          ],
          __name__: n.name,
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      const found = flattenGraph(n.onFound ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: 'Opportunity Found', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: found.entryId });
      templates.push(...found.templates);
      const notf = flattenGraph(n.onNotFound ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: 'Opportunity Not Found', cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notf.entryId });
      templates.push(...notf.templates);
      return;
    }

    if (n.kind === 'goto') {
      // Resolve the target id (forward refs legal — pre-assign if not seen yet;
      // the target node reuses this id when its own scope is walked).
      if (!refMap.has(n.target)) refMap.set(n.target, ctx.idGen());
      const tmpl = {
        id, type: 'goto', name: n.name ?? 'Go To', order: i,
        attributes: { targetNodeId: refMap.get(n.target), type: 'goto' },
        next: null, parentKey,
      };
      if (parentScopeId !== null) tmpl.parent = parentScopeId;
      templates.push(withStepDisabled(n, tmpl));
      return;
    }

    // workflow_split — random/weighted A/B/N-way split (live-verified shape mirrors
    // catalog/step-examples/workflow_split.json). Each path gets a `transition` entry
    // step (conditionType:"default") that its children hang off. Weights live in
    // extras.weightDistribution (a `random` split with no weights defaults to even).
    if (n.kind === 'split') {
      const pathIds = n.paths.map(() => ctx.idGen());
      const weighted = n.mode === 'weighted' || n.mode === 'random';
      const even = Math.round(100 / n.paths.length);
      const weightDistribution = {};
      n.paths.forEach((p, pi) => { weightDistribution[pathIds[pi]] = weighted ? (p.weight ?? even) : even; });
      const container = {
        id, type: 'workflow_split', name: n.name ?? 'Split', order: i, parentKey, cat: 'multi-path', next: pathIds,
        attributes: {
          name: n.name ?? 'Split', cat: 'multi-path', type: 'workflow_split',
          transitions: n.paths.map((p, pi) => ({
            id: pathIds[pi], name: p.name ?? `Path ${String.fromCharCode(65 + pi)}`,
            condition: p.name ?? `Path ${String.fromCharCode(65 + pi)}`,
            conditionType: 'default', isPrimaryBranch: false, description: '', attributes: {},
          })),
          paths: n.paths.map((p, pi) => ({ name: p.name ?? `Path ${String.fromCharCode(65 + pi)}`, id: pathIds[pi] })),
          condition: n.condition ?? 'random-split',
          extras: { weightDistribution },
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      n.paths.forEach((p, pi) => {
        const child = flattenGraph(p.then ?? [], ctx, refMap, pathIds[pi]);
        templates.push({ id: pathIds[pi], type: 'transition', name: p.name ?? `Path ${String.fromCharCode(65 + pi)}`,
          cat: 'transition', parentKey: id, parent: id, order: pi, attributes: {}, next: child.entryId });
        templates.push(...child.templates);
      });
      return;
    }

    // Pre-set 2-branch finder containers: find_contact (user-defined Found/Not-Found),
    // lc_merge_contact (pre-defined Duplicate Found/Not-Found). Same transition-step
    // mechanics as find_opportunity; shapes mirror the verified-live corpus examples.
    if ((n.type === 'find_contact' || n.type === 'lc_merge_contact') && (n.onFound || n.onNotFound)) {
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const isFC = n.type === 'find_contact';
      const container = {
        id, type: n.type, name: n.name ?? (isFC ? 'Find Contact' : 'Merge Contact'), order: i, parentKey, cat: 'multi-path', next: [t1, t2],
        attributes: isFC ? {
          type: 'find_contact', fields: n.find?.fields ?? [], convertToMultipath: true,
          name: n.name ?? 'Find Contact', cat: 'multi-path', isHybridAction: true, hybridActionType: 'find_contact',
          transitions: [
            { id: t1, name: 'Contact Found', condition: 'contact_found', conditionType: 'user-defined', isPrimaryBranch: true, description: '', attributes: { type: 'contact_found', description: 'Contact Found', cat: 'multi-path' } },
            { id: t2, name: 'Contact Not Found', condition: 'contact_not_found', conditionType: 'user-defined', isPrimaryBranch: false, description: '', attributes: { type: 'contact_not_found', description: 'Contact Not Found' } },
          ],
        } : {
          match_by: n.match_by ?? 'email', type: 'lc_merge_contact', __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: t1, name: 'Duplicate Contact Found', fields: {}, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
            { id: t2, name: 'Duplicate Contact Not Found', fields: {}, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
          ],
          __name__: n.name ?? `Merge Contact by ${n.match_by ?? 'email'}`,
        },
      };
      if (!isFC) container.workflowsActionType = 'INTERNAL';
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      const found = flattenGraph(n.onFound ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: container.attributes.transitions[0].name, cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: found.entryId });
      templates.push(...found.templates);
      const notf = flattenGraph(n.onNotFound ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: container.attributes.transitions[1].name, cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notf.entryId });
      templates.push(...notf.templates);
      return;
    }

    // AI decision-maker / ConvAI splitter — N author-defined branches routed by an LLM,
    // plus an always-present pre-defined Default Branch (first). Mirrors the verified-live
    // workflow_ai_decision_maker corpus shape. Author supplies branches[{name,description,then}].
    if (n.kind === 'ai_decision') {
      const type = n.type ?? 'workflow_ai_decision_maker';
      const defId = ctx.idGen();
      const branchIds = n.branches.map(() => ctx.idGen());
      const transitions = [
        { id: defId, name: 'Default Branch', fields: { description: 'Go in this branch if none of the other branches make sense.', branchKey: 'none' }, meta: { __branchKey__: 'predefined_Default Branch' }, conditionType: 'pre-defined' },
        ...n.branches.map((b, bi) => ({
          id: branchIds[bi], name: b.name,
          fields: { description: b.description ?? '', branchKey: b.branchKey ?? `branch_${bi}` },
          meta: { __branchKey__: ctx.idGen() }, conditionType: 'user-defined',
        })),
      ];
      const container = {
        id, type, name: n.name ?? 'Workflow AI - Decision Maker', order: i, parentKey, cat: 'multi-path',
        workflowsActionType: 'INTERNAL', next: [defId, ...branchIds],
        attributes: {
          instructions: n.instructions ?? '', information: n.information ?? '',
          type, __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
          transitions, __name__: n.name ?? 'Workflow AI - Decision Maker',
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container));
      // Default branch tail (optional) + each author branch
      const def = flattenGraph(n.default ?? [], ctx, refMap, defId);
      templates.push({ id: defId, type: 'transition', name: 'Default Branch', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: def.entryId });
      templates.push(...def.templates);
      n.branches.forEach((b, bi) => {
        const child = flattenGraph(b.then ?? [], ctx, refMap, branchIds[bi]);
        templates.push({ id: branchIds[bi], type: 'transition', name: b.name, cat: 'transition', parentKey: id, parent: id, order: bi + 1, attributes: {}, next: child.entryId });
        templates.push(...child.templates);
      });
      return;
    }

    // Root-scope linear steps stay lean; steps inside a branch carry `parent`
    // (= the branch-entry id) while `parentKey` advances along the chain.
    const tmpl = { id, type: typeFor(n), name: n.name, order: i, attributes: attributesFor(n, ctx), next, parentKey };
    if (parentScopeId !== null) tmpl.parent = parentScopeId;
    templates.push(withStepDisabled(n, tmpl));
  });
  return { templates, entryId: ids[0] ?? null };
}

export function casingLint({ triggerBodies, autoSaveBody }) {
  for (const tb of triggerBodies ?? []) {
    if ('workflow_id' in tb) throw new IRError('CASING', 'trigger root must use camelCase workflowId, not workflow_id');
    if (!('workflowId' in tb)) throw new IRError('CASING', 'trigger missing camelCase workflowId');
    for (const k of ['location_id', 'company_id']) if (!(k in tb)) throw new IRError('CASING', `trigger missing snake ${k}`);
  }
  if (autoSaveBody && ('location_id' in autoSaveBody || 'company_id' in autoSaveBody))
    throw new IRError('CASING', 'workflow body must use camelCase locationId/companyId');
}

// Operators that take an array value (the compiler wraps a scalar automatically).
const ARRAY_OPS = new Set(['is-any-of', 'is-in-array', 'contains-any', 'contains-none',
  'string-contains-any-of', 'string-matches-any-of']);
// index-of-true/false are deliberately NOT array ops here. They are shared with if/else
// tag CONDITIONS, which do take an array (conditionValue: ['vip']) — but on a TRIGGER
// every row carrying them is a single-select tag row (tagsAdded/tagsRemoved/contact.tags),
// and the UI sends a bare string. An array saves and reads back fine, but the tag-event
// dispatcher never subscribes, leaving the trigger permanently inert.
const SCALAR_OPS = new Set(['index-of-true', 'index-of-false']);
// Default operator by filter-row type when the row/author didn't specify one.
function defaultOp(type) {
  if (type === 'number' || type === 'date') return '==';
  if (type === 'string' || type === 'input') return 'is-any-of';
  return '=='; // select
}

// Expand an authored filter into the full GHL condition shape using the trigger's
// recovered filter model. The author may write a lean intent filter — `{ on, value }`
// (on = a row's id / label / field) or `{ field, value }` — and the compiler fills
// operator/title/type/id from the model row. A fully-specified filter (field+operator+
// title+type) passes through, so hand-authored conditions still work — save for the
// scalar-op value normalization below, which no shape is allowed to bypass.
function expandFilter(f, rows) {
  // already complete — but still normalize a scalar-op value, so a hand-authored
  // ['tag'] can't silently reintroduce the inert-trigger bug via this passthrough.
  if (f.field && f.operator && f.title && f.type) {
    return SCALAR_OPS.has(f.operator) && Array.isArray(f.value) && f.value.length === 1
      ? { ...f, value: f.value[0] }
      : f;
  }
  const key = f.on ?? f.field ?? f.id;
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  const row = rows.find((r) => r.id === key || r.value === key || r.label === key || norm(r.label) === norm(key) || norm(r.value) === norm(key));
  if (!row) return f; // unknown row — passthrough whatever was given
  const type = f.type ?? row.type ?? 'select';
  let operator = f.operator ?? row.operator ?? defaultOp(type);
  let value = f.value;
  // an array value with a scalar-equality operator means "one of" — upgrade to is-any-of
  // (e.g. form.id, whose recovered row has no operator and defaults to '==')
  if (Array.isArray(value) && operator === '==') operator = 'is-any-of';
  if (ARRAY_OPS.has(operator) && !Array.isArray(value)) value = [value];
  // Unwrap a convenience-authored ['tag'] back to the scalar the dispatcher requires.
  if (SCALAR_OPS.has(operator) && Array.isArray(value)) {
    if (value.length > 1) {
      throw new IRError('FILTER_VALUE',
        `trigger filter '${row.value}' (${operator}) takes a single tag, got ${value.length}; use one filter row per tag`);
    }
    value = value[0];
  }
  const cond = { field: row.value, operator, value, title: f.title ?? row.label, type };
  if (row.id) cond.id = row.id;
  return cond;
}

export function buildTrigger(t, ctx, wid) {
  const meta = ctx.catalog.trigger(t.type);
  const rows = meta?.filterRows ?? [];
  const conditions = (t.filters ?? []).map((f) => (rows.length ? expandFilter(f, rows) : f));
  return {
    status: 'draft', workflowId: wid, schedule_config: {},
    conditions,
    type: t.type, masterType: t.masterType ?? meta?.masterType ?? 'highlevel', name: t.name,
    actions: [{ workflow_id: wid, type: 'add_to_workflow' }],
    active: t.active !== false, triggersChanged: true,
    location_id: ctx.loc, company_id: ctx.cid, company_age: ctx.companyAge,
    // conv_ai_trigger binds a FLOW_BUILDER_BOT flow workflow to its agent — without
    // convTriggerBotId the flow builder never opens the workflow as that agent's canvas
    // (the agent→workflow half is set separately via the /ai-employees link PUT).
    ...(t.convTriggerBotId ? { convTriggerBotId: t.convTriggerBotId } : {}),
  };
}

export function compile(ir, ctx) {
  const norm = parseIR(ir);
  // update_opportunity needs an associated opportunity at runtime — enforce the
  // invariant with the catalog-derived set of opportunity-attaching triggers.
  const oppTriggerTypes = new Set(
    ctx.catalog.allTriggers().filter((t) => ctx.catalog.trigger(t)?.category === 'opportunities'));
  checkOpportunityAssociation(norm, oppTriggerTypes);
  const refMap = new Map();
  // ─── Authored-vs-compiled assertion ────────────────────────────────────────────────
  // Round-trip verification only ever proved that what was SENT came back. It never
  // checked that what was AUTHORED was sent — so a dropped subtree reported a clean
  // build for a fraction of the IR ("steps: 8 | round-trip: 8 clean" for a 51-step IR,
  // live 2026-07-16). We diff the node objects the flattener actually reached against the
  // authored graph. Node identity, not refs: `ref` is optional, and a ref-less node must
  // be provable too. Counts are NOT expected to match — containers legitimately add
  // transition/None steps, so compiled >= authored is normal and fine.
  const visited = new Set();
  const { templates } = flattenGraph(norm.graph, { ...ctx, __visited: visited }, refMap, null);

  const missing = [];
  let authored = 0;
  walkNodes(norm.graph, (n) => {
    authored += 1;
    if (!visited.has(n)) missing.push(n.ref ?? `<${n.type ?? n.kind} "${n.name ?? '?'}">`);
  });
  if (missing.length)
    throw new IRError('NODE_DROPPED',
      `${missing.length} authored node(s) never reached the built payload: ${missing.join(', ')}. ` +
      `They were silently discarded — without this check the build would have reported a clean ` +
      `round-trip for an incomplete workflow. Usually this means a node carries a child scope ` +
      `(onFound/onEvent/…) that its type has no container handler for.`);

  // situational injection (catalog-gated); parent/sibling/nodeType already set structurally
  let stepIndex = 0;
  for (const t of templates) {
    const meta = ctx.catalog.step(t.type);
    if (meta && meta.situational?.includes('workflowsActionType') && !('workflowsActionType' in t))
      t.workflowsActionType = 'INTERNAL';
    // premium actions carry a top-level stepIndex (runtime sequence id). Which types
    // carry it is derived from the verified-live corpus (catalog `premium` flag):
    // custom_webhook, custom_code, ai_agent, chatgpt, google_sheets, the *_formatter
    // family, appointment_booking, find_or_create_contact, conversationai_objective.
    if (meta?.premium && !('stepIndex' in t)) t.stepIndex = stepIndex;
    stepIndex += 1;
  }

  const wid = ctx.idGen();
  const sessionId = ctx.idGen();
  const createdSteps = templates.map((t) => t.id);

  const createBody = {
    name: norm.name, status: 'draft', parentId: null, updatedBy: ctx.uid,
    modifiedSteps: [], deletedSteps: [], createdSteps: [], senderAddress: {},
    stopOnResponse: false, allowMultiple: false, allowMultipleOpportunity: true,
    autoMarkAsRead: false, eventStartDate: '', timezone: '',
    workflowData: { templates: [] }, triggersChanged: false,
    company_id: ctx.cid, company_age: ctx.companyAge,
  };

  const autoSaveBody = {
    _id: wid, id: wid, locationId: ctx.loc, companyId: ctx.cid, companyAge: ctx.companyAge,
    name: norm.name, status: 'draft', version: 1, dataVersion: 7, type: 'workflow', parentId: null,
    // A FLOW_BUILDER_BOT's flow workflow persists with workflowType:"agent" (live capture
    // recon-flow-workflow-full.json). Plain workflows omit it. type stays "workflow".
    ...(norm.workflowType ? { workflowType: norm.workflowType } : {}),
    permission: 380, permissionMeta: { canRead: true, canWrite: true },
    creationSource: 'builder', originType: 'user', isTriggerBucketMigrated: true, deleted: false,
    timezone: norm.settings?.timezone ?? 'account',
    allowMultiple: norm.settings?.allowMultiple ?? false,
    allowMultipleOpportunity: norm.settings?.allowMultipleOpportunity ?? true,
    removeContactFromLastStep: norm.settings?.removeContactFromLastStep ?? true,
    stopOnResponse: norm.settings?.stopOnResponse ?? false,
    autoMarkAsRead: norm.settings?.autoMarkAsRead ?? false,
    scheduledPauseDates: [], senderAddress: norm.settings?.senderAddress ?? {},
    eventStartDate: norm.settings?.eventStartDate ?? '', updatedBy: ctx.uid,
    triggersChanged: false, isAutoSave: true,
    autoSaveSession: { workflowId: wid, id: sessionId, userId: ctx.uid, version: 1 },
    createdSteps, modifiedSteps: [], deletedSteps: [],
    workflowData: { templates },
  };

  const triggerBodies = norm.triggers.map((t) => buildTrigger(t, ctx, wid));
  // authored/compiled travel with the payload so the caller can report
  // `authored N → compiled M → round-tripped M` instead of a bare step count.
  const result = { createBody, autoSaveBody, triggerBodies, _wid: wid, authored, compiled: templates.length };
  casingLint(result);
  return result;
}
