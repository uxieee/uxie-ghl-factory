// Deterministic compiler: IR -> GHL builder-API payloads (create/auto-save/trigger).
// See docs/superpowers/specs/2026-07-10-create-ghl-workflow-v2-design.md §5.
import { parseIR, IRError, collectRefs, checkOpportunityAssociation, canonicalizeOppStageCondition,
  lintConditionShape, walkNodes, OPP_STAGE_TYPE, OPP_STAGE_SUBTYPE } from './ir.mjs';
import { checkOppFieldShape, STANDARD_OPP_FIELDS, defaultOppFieldShape } from './opp-shapes.mjs';
import { checkGoghlSyntax } from './goghl.mjs';
import { checkWebhookRefs } from './webhook-rail.mjs';
import { checkStepOutputRefs } from './step-outputs.mjs';
import { normalizeSettings } from './settings.mjs';
import { stripNullNext } from './terminals.mjs';
import { stepNotesToComments } from './step-notes.mjs';
import { checkContactFieldShape } from './contact-field-shapes.mjs';
import { enforceRequiredFields } from './required-fields.mjs';
import { coerceDefault } from './action-schema.mjs';
import { enforceTemplates } from './enforce.mjs';
import { checkStepRefs } from './graph-refs.mjs';
import { applyUiDefaults } from './ui-defaults.mjs';
import { checkIfElseVocab } from './ifelse-vocab.mjs';
import { checkMergeTags } from './merge-tags.mjs';
import { gotoLoops } from './goto-loops.mjs';

// NINE step types take a DEDICATED attribute builder instead of the generic normalizeAttrs path,
// and normalizeAttrs is where enforceRequiredFields is wired. So every one of them reached GHL
// having run none of the conditional defaults or coupled-field rules.
//
// This was first found on `wait` and patched there, per-branch. That was treating the symptom:
// live-fire then showed `email` and `custom_webhook` were dead the same way — including
// `email.html`, the rule that stops a step sending a BLANK email, which is the highest-value
// refusal in the engine. Unit tests could not see any of it, because they call
// enforceRequiredFields directly and so never exercise this dispatch.
//
// The seam now wraps the whole dedicated-builder set, so adding a tenth builder cannot silently
// disarm its rules. The generic path is untouched: normalizeAttrs still calls enforceRequiredFields
// itself, deliberately BEFORE its ATTR_KEY check, and double-enforcing there would be wasteful and
// would double any warning.
export const DEDICATED_ATTRIBUTES = [
  [(n) => n.marketplace === true, (n, ctx) => marketplaceAttributes(n, ctx)],
  [(n) => n.kind === 'wait', (n, ctx) => waitAttributes(n, ctx)],
  [(n) => n.type === 'email', (n, ctx) => emailAttributes(n, ctx)],
  [(n) => n.type === 'custom_webhook', (n) => webhookAttributes(n.attributes ?? {}, n.ref)],
  [(n) => n.type === 'custom_code', (n) => codeAttributes(n.attributes ?? {}, n.ref)],
  [(n) => n.type === 'voice_ai_outbound_call', (n) => voiceAiOutboundCallAttributes(n.attributes ?? {})],
  [(n) => n.type === 'internal_notification', (n, ctx) => internalNotificationAttributes(n.attributes ?? {}, ctx)],
  [(n) => n.type === 'create_opportunity', (n, ctx) => createOpportunityAttributes(n.attributes ?? {}, n.ref, ctx)],
  [(n) => n.type === 'update_opportunity', (n, ctx) => updateOpportunityAttributes(n.attributes ?? {}, n.ref, ctx)],
];

function attributesFor(node, ctx) {
  for (const [matches, build] of DEDICATED_ATTRIBUTES) {
    if (!matches(node)) continue;
    // typeFor() is what the emitted template will carry, and it is what the rules key off —
    // a wait has kind:'wait' and no `type` at all, so passing the node unchanged finds nothing.
    return enforceRequiredFields({ ...node, type: typeFor(node) }, build(node, ctx), ctx);
  }
  // Generic path: the author supplies intent attributes; the compiler fills the
  // two structural fields the corpus shows on this type but a human never hand-writes:
  //   - attributes.type  (mirrors the step type — present on ~all linear action types)
  //   - __customInputs__  (the internal-action field envelope — present on INTERNAL types)
  // Both are catalog-gated so we never inject a field the verified-live example lacks.
  const out = normalizeAttrs(node, node.attributes ?? {}, ctx);
  // Advisory only — see contact-field-shapes.mjs for why this warns rather than throws.
  // Runs on the compiled attrs (post-normalize) so it sees exactly what will be sent.
  if (node.type === 'update_contact_field')
    checkContactFieldShape(out, { ref: node.ref ?? node.name ?? '?', warn: ctx?.warn });
  return out;
}

// Envelope keys the builder stores on a marketplace step but no app `inputs` list
// declares. They are structural, so they are never "unknown".
const MARKETPLACE_ENVELOPE_KEYS = new Set([
  '__customInputs__', '__dynamicAttachments__', '__customInputFields__', 'type',
]);

// Resolve a marketplace node against the live per-location index, or fail closed.
// An uninstalled app is fatal: the step saves, and then never runs.
//
// `kind` ('action' | 'trigger') is REQUIRED and comes from the CALL SITE, never guessed:
// action and trigger keys are not one namespace — `contact_engagement_score` is a REAL,
// observed collision in the live catalog (an action with required inputs AND a trigger
// with none). marketplaceAttributes (the STEP path) always asks for 'action'; buildTrigger
// (the TRIGGER path) always asks for 'trigger'. See marketplace.mjs's buildMarketplaceIndex
// for the split index this depends on.
export function marketplaceEntry(node, ctx, kind) {
  const entry = ctx?.marketplace?.get?.(node.type, kind);
  const readFailed = ctx?.marketplace?.readFailed ?? {};
  const modulesLeg = kind === 'action' ? 'actions' : 'triggers';
  if (!entry) {
    // A failed ASSETS read is not evidence the key is absent from this location. Saying
    // "no such key" on a read that never succeeded is the same false-confidence class as
    // reporting an uninstalled app (F5-11).
    if (readFailed.assets)
      throw new IRError('MARKETPLACE_READ_FAILED',
        `'${node.type}' on '${node.ref}' is flagged marketplace:true, but the marketplace assets read for this `
        + `location FAILED, so whether the key exists here is UNKNOWN. This is a read failure, not evidence the `
        + `app is missing — retry; if it persists, check the token and /workflows-marketplace/location/{loc}/assets.`);
    // An author who wrote marketplace:true on a key that belongs to the OTHER kind (a
    // trigger key on a step, or vice versa) gets a message that says so, not the generic
    // "nothing publishes that key" — that collision is exactly what this check exists to
    // catch.
    const otherKind = kind === 'action' ? 'trigger' : 'action';
    const existsAsOtherKind = ctx?.marketplace?.get?.(node.type, otherKind);
    throw new IRError('MARKETPLACE_KEY_UNKNOWN',
      existsAsOtherKind
        ? `'${node.type}' on '${node.ref}' is flagged marketplace:true and was looked up as a `
          + `marketplace ${kind}, but '${node.type}' is only published in this location as a `
          + `marketplace ${otherKind}. This node is using a ${otherKind} key in a ${kind} slot — `
          + `fix the type, or move this node to where a ${otherKind} key belongs.`
        : `'${node.type}' on '${node.ref}' is flagged marketplace:true but no installed or available `
          + `marketplace ${kind} in this location publishes that key. Run list_marketplace_apps for `
          + `this locationId to see what is actually there, or drop the marketplace flag if you `
          + `meant a native step.`);
  }
  if (!entry.installed) {
    // A failed INSTALL-TRUTH read is not evidence the app is uninstalled. This is the exact
    // sentence that sent an operator to install an app that was already there (F5-11).
    if (readFailed[modulesLeg])
      throw new IRError('MARKETPLACE_READ_FAILED',
        `'${node.type}' on '${node.ref}' belongs to "${entry.appName}", but the install-truth read `
        + `(/marketplace/core/search/module?type=${modulesLeg}) FAILED for this location, so installed / not `
        + `installed is UNKNOWN. This is a read failure, not evidence the app is uninstalled — retry before `
        + `installing anything.`);
    throw new IRError('MARKETPLACE_APP_NOT_INSTALLED',
      `'${node.type}' on '${node.ref}' belongs to "${entry.appName}", which is NOT installed in this `
      + `location. The step would save and never run. Install the app in the sub-account first.`);
  }
  return entry;
}

function marketplaceAttributes(node, ctx) {
  // A marketplace STEP is always an action key — never a trigger key.
  const entry = marketplaceEntry(node, ctx, 'action');
  const out = { ...(node.attributes ?? {}) };
  // The live shape always repeats the step type inside attributes. This is NOT gated on
  // meta.attrKeys the way the native path is — that gate reads the native catalog, which
  // by definition does not describe a third-party app.
  out.type = node.type;
  // The native path injects __customInputs__ via normalizeAttrs when the catalog
  // says usesCustomInputs — marketplace bypasses that path entirely (there is no
  // native catalog meta for a third-party type), so it must inject its own copy.
  // Live-confirmed 2026-08-16 (Jing Spa): the stored step carries
  // attributes.__customInputs__ = {} even though the app's own `inputs` list never
  // declares that key. Only fill when the author left it out — never clobber an
  // author-supplied value.
  if (out.__customInputs__ === undefined) out.__customInputs__ = {};

  const blank = (v) => v === undefined || v === null
    || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

  // Some inputs carry a structural default in the app's own schema (an internal
  // provider id, a merge-tag like {{contact.phone_raw}}) that a human author would
  // never hand-write — mirrors the native path's structural-field fill (see
  // normalizeAttrs above). Only fills when the author left the field blank.
  // Defaults arrive as STRINGS regardless of declared type (action-schema.mjs's
  // coerceDefault comment: `value: "true"` on a checkbox) — reuse that coercion
  // rather than trusting the literal, or a checkbox/numerical default round-trips
  // as the wrong JS type.
  //
  // Where this value actually comes from, and what is still unverified: at runtime
  // `entry.inputs` is `ctx.marketplace`'s live join against
  // `/workflows-marketplace/location/{loc}/assets` for the TARGET location — not a
  // baked snapshot (`fixtures/marketplace-assets.json` is a test fixture only). So
  // the default written here is whatever that location's own API returns for this
  // app right now. What is NOT yet verified is whether that value is the same one
  // GHL's own builder UI pre-fills into the field when a human adds this step —
  // Task 5 carries a live-verification item for that gap.
  //
  // Filling a REQUIRED, non-empty field inside a check whose job is to fail closed
  // is a real, silent risk on its own (e.g. conversation_provider is an opaque
  // internal id) — so unlike the undeclared-key warning below, this one fires on
  // every field the fill populates, unconditionally, not just on a surprising key.
  for (const f of entry.inputs) {
    if (!f?.field || f.value === undefined || !blank(out[f.field])) continue;
    const coerced = coerceDefault(f.value, f.fieldType);
    if (coerced === undefined) continue;
    out[f.field] = coerced;
    ctx?.warn?.(`MARKETPLACE_DEFAULT_FILLED: step '${node.ref}' (${node.type}) left '${f.field}' `
      + `blank; filled it with the value "${entry.appName}" declares in its own schema (${coerced}). `
      + `Confirm this is what you intend.`);
  }

  // Required inputs, fail-closed. Same semantics as action-schema.mjs: absent AND empty
  // both count as missing, because the builder rejects both.
  const missing = entry.inputs
    .filter((f) => f?.required === true && f.field && f.field !== 'DYNAMIC' && blank(out[f.field]))
    .map((f) => f.field);
  if (missing.length)
    throw new IRError('MARKETPLACE_REQUIRED_FIELD',
      `marketplace step '${node.ref}' (${node.type}, "${entry.appName}") is missing required `
      + `input(s): ${missing.join(', ')}. The builder would show "Resolve N Errors".`);

  // Unknown keys WARN rather than throw: `connected_phone` in the live capture maps to a
  // DYNAMIC pseudo-field that `inputs` does not list under that name, so a hard allowlist
  // would reject a shape the builder accepts.
  const declared = new Set(entry.inputs.map((f) => f?.field).filter(Boolean));
  for (const key of Object.keys(out)) {
    if (MARKETPLACE_ENVELOPE_KEYS.has(key) || declared.has(key)) continue;
    ctx?.warn?.(`marketplace step '${node.ref}' (${node.type}) sets '${key}', which "${entry.appName}" `
      + `does not declare in its inputs. It will be stored verbatim; confirm the key is right.`);
  }
  return out;
}

// Fill structural attribute fields from the catalog's verified-live shape. Only
// touches fields the real persisted example carried, so a bare intent authoring
// (e.g. { points: 5, operator: 'add' } for contact_engagement_score) round-trips
// into the exact stored shape without the author knowing the envelope.
function normalizeAttrs(node, attrs, ctx) {
  const meta = ctx?.catalog?.step(node.type);
  if (!meta) return attrs;
  // Fill defaultable required fields and hard-fail the rest BEFORE the key check, so a
  // node that is merely missing a default does not first trip ATTR_KEY on the injected
  // key. A missing required field is what makes the builder show "Resolve N Errors" on a
  // workflow this engine reported as a clean pass.
  // ctx carries `warn` — the warn-tier couplings (GHL's own result:'warning' rules) are silently
  // dropped without it, which is the failure mode that made them invisible in the first place.
  const out = { ...enforceRequiredFields(node, attrs, ctx) };
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
// `pipeline` and `stage` are NOT here. The opportunity types never reach this generic path any
// more (parseIR canonicalises the wire names), and whitelisting them was the ONLY way a NAME could
// reach the wire — the comment above claimed the resolver keeps the name beside the id, but on
// this path the resolver never ran at all (F5-09 / T1-1).
const ENGINE_ATTR_KEYS = new Set(['type', '__customInputs__', '__customInputFields__', '_template',
  'user', 'calendar', 'agent', 'employee', 'assignedEmployeeId']);

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
// A numeric opp field (valueFieldType 'numerical', e.g. monetaryValue) must carry a
// NUMBER on the wire, not a stringified one. The builder stores it in a numeric model
// and silently drops a string: the field renders EMPTY and the next UI save blanks the
// value (live-verified 2026-07-18 on a client account). Runtime
// coerced the string fine, so this was invisible until a node was reopened. A value that
// is NOT a finite number (a {{merge-field}} token, an empty string) is left untouched —
// there is no better shape for it and coercing would corrupt it (NaN / a spurious 0).
function coerceOppValue(value, valueFieldType) {
  if (valueFieldType !== 'numerical') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}
function oppField(filterField, value, dataType, valueFieldType) {
  const f = { __customInputs__: {}, filterField, value: coerceOppValue(value, valueFieldType), valueFieldType };
  if (dataType !== undefined) f.dataType = dataType;   // absence is legal; never inject a dialect
  return f;
}
// Emit a standard opportunity field on the NAME-authoring path, using the shape the builder's
// own picker assigns it. The name path (unlike updates[]) has always emitted an explicit
// dataType, so this keeps that contract for the fields added 2026-08-03 too.
function stdOppField(filterField, value) {
  const { valueFieldType, dataType } = defaultOppFieldShape(filterField);
  return oppField(filterField, value, dataType, valueFieldType);
}

// `lostReasonId` is meaningless — and actively deleted — without `status: 'lost'` in the SAME
// step. This is not a UI nicety. The builder's own field-picker generator (shipped inside the
// action asset, see catalog/opp-field-rulebook.json) enforces it twice:
//   handleStatusField()        disables the Lost Reason option unless a status entry exists
//                              whose value is 'lost'
//   checkForDependantOptions() SPLICES an existing lostReasonId entry straight out of
//                              __customInputFields__ when status is absent or not 'lost'
// Identical code in the create asset and the update asset. Live-confirmed in the UI on Grom UK
// 2026-08-03: the Lost Reason picker only appears once Status is set to Lost.
// So a step carrying a lost reason without the lost status is the exact failure class
// EMPTY_STEP / OPP_UNASSOCIATED exist to prevent — it saves, it round-trips, and the reason
// silently evaporates. Fail loud at compile instead.
// Also puts status BEFORE the lost reason, which is the only order the builder can produce
// (fidelity, not correctness — the generator's lookups are findIndex-based, order-independent).
function enforceLostReasonPrerequisite(f, ref, stepType) {
  const lostAt = f.findIndex((x) => x.filterField === 'lostReasonId');
  if (lostAt === -1) return;
  const statusAt = f.findIndex((x) => x.filterField === 'status');
  const statusVal = statusAt === -1 ? undefined : f[statusAt].value;
  if (statusAt === -1 || String(statusVal).toLowerCase() !== 'lost')
    throw new IRError('OPP_LOST_REASON_NO_LOST_STATUS',
      `${stepType} '${ref}' sets 'lostReasonId' but ${
        statusAt === -1
          ? "the step has no 'status' field"
          : `the step's status is '${statusVal}', not 'lost'`
      }. GHL only accepts a lost reason on an opportunity being marked LOST: the builder `
      + `disables the Lost Reason picker until Status is 'lost', and DELETES an existing `
      + `lostReasonId entry when it isn't — so this step would save, round-trip clean, and `
      + `drop the reason. Set status to 'lost' in the same step${
        statusAt === -1 ? '' : ", or drop 'lostReasonId'"
      }.${
        statusVal !== undefined && /\{\{/.test(String(statusVal))
          ? " (A merge-field status can't be proven to be 'lost' at compile time — author the "
            + 'literal status on the step that sets the lost reason.)'
          : ''
      }`);
  if (statusAt > lostAt) f.splice(lostAt, 0, f.splice(statusAt, 1)[0]);
}
// create_opportunity's author keys, mirroring UPDATE_OPP_AUTHOR_KEYS below. Without this
// guard the generic checkAttrKeys pass is skipped wholesale for this type (it validates
// against the EMITTED keys, none of which an author writes here), so a typo — or the
// natural mistake of writing the GHL-side spellings `pipeline_id` / `pipeline_stage_id` —
// dropped SILENTLY and produced an opportunity with no pipeline and no stage. It built
// clean, verified clean, and the builder showed no error. Live-diagnosed 2026-07-25 on AU.
// lostReasonId / forecastExpectedCloseDate / forecastProbability added 2026-08-03 — they are
// in the builder's picker for BOTH create and update (the create asset carries the same
// standardFieldMappingOptions() table, lost-reason gate included) but were missing from the
// engine's field table. Author key == emitted filterField for all three; no alias is invented.
const CREATE_OPP_AUTHOR_KEYS = new Set([
  'pipelineId', 'stageId', 'status', 'name', 'source', 'value',
  'lostReasonId', 'forecastExpectedCloseDate', 'forecastProbability',
  'pipeline', 'stage',    // pre-resolve name path (resolve.mjs → pipelineId/stageId)
]);
const CREATE_OPP_ALIASES = {
  pipelineStageId: 'stageId', stage_id: 'stageId', pipeline_stage_id: 'stageId',
  pipeline_id: 'pipelineId', monetaryValue: 'value',
};
// A pipeline/stage/lost-reason NAME that was never resolved to an id is not a shape the builder can
// paper over: written verbatim it moves nothing (F5-09 / T1-1). Names resolve on the BUILD path
// only (orchestrate → resolveIR fetches the account's pipelines); the edit path must be given ids.
function refuseUnresolvedOppNames(a, ref, stepType, ctx) {
  const missing = [];
  if (a.pipeline != null && a.pipelineId == null) missing.push(`pipeline '${a.pipeline}'`);
  if (a.stage != null && a.stageId == null) missing.push(`stage '${a.stage}'`);
  if (!missing.length) return;
  const detail = `${stepType} '${ref}' names ${missing.join(' and ')} but no id was resolved for it. `
    + `Names resolve only through build_workflow / scripts/build.mjs, which fetch the account's pipelines; on the `
    + `edit path author pipelineId/stageId from list_account_entities. A name written to the wire moves nothing.`;
  // `ignoreUnresolved` is the caller's documented, deliberate "build it anyway, pointing at
  // nothing" — the same opt-out orchestrate applies to the dependency abort. Honour it here too
  // (loudly) rather than silently revoking a hatch: an unreachable hatch is its own defect class.
  if (ctx?.ignoreUnresolved === true) { ctx.warn?.(`UNRESOLVED_NAME (ignored): ${detail}`); return; }
  throw new IRError('UNRESOLVED_NAME', detail);
}

function createOpportunityAttributes(a, ref, ctx) {
  refuseUnresolvedOppNames(a, ref, 'create_opportunity', ctx);
  const bad = Object.keys(a).filter((k) => !CREATE_OPP_AUTHOR_KEYS.has(k));
  if (bad.length)
    throw new IRError('UNKNOWN_ATTR',
      `create_opportunity '${ref}' has unknown attribute key(s) [${bad.join(', ')}]${
        bad.some((k) => CREATE_OPP_ALIASES[k])
          ? ` — did you mean ${bad.filter((k) => CREATE_OPP_ALIASES[k]).map((k) => `'${CREATE_OPP_ALIASES[k]}' (not '${k}')`).join(', ')}?`
          : ''
      }. Author keys: ${[...CREATE_OPP_AUTHOR_KEYS].join(', ')}. NOTE the asymmetry — you author `
      + `'stageId', which compiles to the filterField 'pipelineStageId'. An ignored key compiles `
      + `to a step that saves, round-trips clean, and creates an opportunity with no pipeline.`);
  // GHL's own create-opportunity validator requires BOTH pipeline and stage. A stage
  // without a pipeline renders as a DISABLED node in the builder (live-confirmed
  // 2026-07-25): the stage picker cannot resolve its options without a pipeline to
  // scope them to.
  if (a.stageId != null && a.pipelineId == null)
    throw new IRError('OPP_STAGE_NO_PIPELINE',
      `create_opportunity '${ref}' sets stageId without pipelineId. GHL scopes the stage `
      + `picker to a pipeline, so a stage-only step renders DISABLED in the builder and `
      + `never runs. Always author pipelineId alongside stageId.`);
  const f = [];
  if (a.name != null) f.push(oppField('name', a.name, 'TEXT', 'string'));
  if (a.stageId != null) f.push(oppField('pipelineStageId', a.stageId, 'SINGLE_OPTIONS', 'select'));
  f.push(oppField('status', a.status ?? 'open', 'SINGLE_OPTIONS', 'select'));
  if (a.lostReasonId != null) f.push(stdOppField('lostReasonId', a.lostReasonId));
  if (a.source != null) f.push(oppField('source', a.source, 'TEXT', 'string'));
  if (a.value != null) f.push(oppField('monetaryValue', a.value, 'NUMERICAL', 'numerical'));
  if (a.forecastExpectedCloseDate != null) f.push(stdOppField('forecastExpectedCloseDate', a.forecastExpectedCloseDate));
  if (a.forecastProbability != null) f.push(stdOppField('forecastProbability', a.forecastProbability));
  enforceLostReasonPrerequisite(f, ref, 'create_opportunity');
  for (const field of f) checkOppFieldShape(field, { ref, warn: ctx?.warn });
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
  // added 2026-08-03 — see CREATE_OPP_AUTHOR_KEYS. Author key == emitted filterField.
  'lostReasonId', 'forecastExpectedCloseDate', 'forecastProbability',
  'pipeline', 'stage',    // pre-resolve name path (resolve.mjs → pipelineId/stageId)
]);
const UPDATE_OPP_ALIASES = { pipelineStageId: 'stageId', stage_id: 'stageId', pipeline_id: 'pipelineId', monetaryValue: 'value' };

// Resolve one updates[] entry to a compiled oppField, classifying its filterField:
//   standard opp field  -> attested shape (omitted valueFieldType resolves from the table)
//   known custom field  -> row 2: warn, pass through (shape join is §7b, still blocked)
//   genuinely unknown    -> row 3: throw (a claim about the engine's own knowledge, safe)
function resolveOppUpdateField(u, ref, ctx) {
  const ff = u.field;
  if (STANDARD_OPP_FIELDS.has(ff)) {
    const vft = u.valueFieldType ?? defaultOppFieldShape(ff).valueFieldType;
    const f = oppField(ff, u.value, u.dataType, vft);   // dataType omitted unless authored
    checkOppFieldShape(f, { ref, warn: ctx?.warn });
    return f;
  }
  const cf = ctx?.customFields?.find((c) => c.id === ff || c.fieldKey === ff);
  if (cf) {
    ctx?.warn?.(`OPP_SHAPE: update_opportunity '${ref}' custom field '${ff}' shape not validated `
      + `(contact->opp dataType join pending, spec §7b) — emitted as authored`);
    return oppField(ff, u.value, u.dataType, u.valueFieldType ?? 'string');
  }
  // Row 3 is a claim: "this field is genuinely unknown." The engine may only make that
  // claim when it actually HAS the account's field list. Only throw when a customFields
  // list WAS supplied (and the field isn't in it) — an empty array counts as a supplied
  // list. With no list in this compile context (e.g. a non-orchestrate caller that didn't
  // fetch fields), degrade to passthrough so a real custom field never hits a false throw.
  if (Array.isArray(ctx?.customFields)) {
    throw new IRError('OPP_FIELD_UNKNOWN',
      `update_opportunity '${ref}': filterField '${ff}' is neither a standard opportunity field `
      + `(${[...STANDARD_OPP_FIELDS].join(', ')}) nor a custom field in this account. `
      + `Pass explicit dataType/valueFieldType, or check the field id.`);
  }
  ctx?.warn?.(`OPP_SHAPE: update_opportunity '${ref}' filterField '${ff}' not classified `
    + `(no customFields list in this compile context) — emitted as authored`);
  return oppField(ff, u.value, u.dataType, u.valueFieldType ?? 'string');
}

function updateOpportunityAttributes(a, ref, ctx) {
  refuseUnresolvedOppNames(a, ref, 'update_opportunity', ctx);
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
  const f = (a.updates ?? []).map((u) => resolveOppUpdateField(u, ref, ctx));
  if (!f.length) {
    if (a.pipelineId != null) f.push(oppField('pipelineId', a.pipelineId, 'SINGLE_OPTIONS', 'select'));
    if (a.stageId != null) f.push(oppField('pipelineStageId', a.stageId, 'SINGLE_OPTIONS', 'select'));
    if (a.status != null) f.push(oppField('status', a.status, 'SINGLE_OPTIONS', 'select'));
    if (a.lostReasonId != null) f.push(stdOppField('lostReasonId', a.lostReasonId));
    if (a.name != null) f.push(oppField('name', a.name, 'TEXT', 'string'));
    if (a.source != null) f.push(oppField('source', a.source, 'TEXT', 'string'));
    if (a.value != null) f.push(oppField('monetaryValue', a.value, 'NUMERICAL', 'numerical'));
    if (a.forecastExpectedCloseDate != null) f.push(stdOppField('forecastExpectedCloseDate', a.forecastExpectedCloseDate));
    if (a.forecastProbability != null) f.push(stdOppField('forecastProbability', a.forecastProbability));
    for (const field of f) checkOppFieldShape(field, { ref, warn: ctx?.warn });
  }
  if (!f.length)
    throw new IRError('EMPTY_STEP',
      `update_opportunity '${ref}' has nothing to update — it would compile to ` +
      `__customInputFields__:[] and no-op at runtime while round-tripping clean. Author either ` +
      `attributes.updates:[{field,value}] or the name path attributes:{pipeline,stage,status,...}.`);
  // Runs before the pipeline reorder below so the final unshift still lands pipeline at [0].
  enforceLostReasonPrerequisite(f, ref, 'update_opportunity');
  // A stage write REQUIRES its pipeline, on either authoring path. GHL scopes the stage
  // picker to a pipeline, so a stage-only step renders as a DISABLED node in the builder
  // and never runs (live-confirmed 2026-07-25 on AU: a move-stage step authored with
  // stageId alone came back "Duplicate opportunity / Disabled"). The pipeline entry must
  // also come FIRST in __customInputFields__ so the stage resolves against it.
  const idx = (ff) => f.findIndex((x) => x.filterField === ff);
  const stageAt = idx('pipelineStageId');
  if (stageAt !== -1) {
    const pipeAt = idx('pipelineId');
    if (pipeAt === -1)
      throw new IRError('OPP_STAGE_NO_PIPELINE',
        `update_opportunity '${ref}' sets a pipeline stage without a pipeline. GHL scopes the `
        + `stage picker to a pipeline, so a stage-only step renders DISABLED in the builder and `
        + `never runs. Author pipelineId alongside stageId (or add a pipelineId entry to updates[]).`);
    if (pipeAt > stageAt) f.unshift(f.splice(pipeAt, 1)[0]);   // pipeline must precede stage
  }
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
// Every key this handler is capable of emitting, per channel. Anything an author writes
// that is NOT here gets dropped by the allowlist — so we warn instead of vanishing it.
// This is the class fix for the `to` bug: the allowlist design is right (the editor binds
// to an exact field set), but a silent drop is how a "clean build" ships a dead step.
const NOTIFICATION_EMITTED_KEYS = {
  // template_id/templatesource: TEMPLATE-MODE notifications are real (3 published Living-In-Idaho
  // nodes carry email.template_id + templatesource:'email-builder' and NO inline html; GHL's own
  // guards exempt the body on !<channel>.template_id). Dropping them forced every notification
  // into inline mode and made template-mode impossible to author — found by the enforcement tests.
  email: ['from_name', 'from_email', 'to', 'userType', 'subject', 'html', 'attachments', 'selectedUser', 'cc', 'preHeader', 'template_id', 'templatesource'],
  sms: ['body', 'userType', 'attachments', 'selectedUser', 'template_id'],
  // `type` is the DRAWER's own key for the in-app channel (the stored shape reads
  // notification.type); `notificationType` is the authoring alias the builder accepted first.
  // Without `type` here, re-normalising a STORED notification reported its own real key as
  // dropped — see normalizeStoredAttributes.
  // assignedOwners + the alsoNotify* pair are real drawer keys (Notification.ts:21-23); without
  // them here the builder reported the drawer's own fields as dropped.
  notification: ['type', 'notificationType', 'body', 'title', 'redirectPage', 'userType', 'selectedUser',
    'assignedOwners', 'alsoNotifyContactFollowers', 'alsoNotifyOpportunityFollowers'],
  whatsapp: ['body', 'userType', 'selectedUser', 'template_id'],
};

// The drawer's "Assigned owners" block (Notification.ts:56-64, assigned-owners.ts). Switching
// userType to `assign` defaults the list to Contact owner; switching to anything else CLEARS it,
// so stale state cannot leak onto a notification that no longer routes by owner.
const ASSIGNED_OWNERS = new Set(['contact_owner', 'opportunity_owner']);
function assignedOwnerKeys(b, userType) {
  const out = {};
  if (userType === 'assign') {
    const authored = Array.isArray(b.assignedOwners)
      ? b.assignedOwners.map((v) => (typeof v === 'string' ? v : v?.value)).filter((v) => ASSIGNED_OWNERS.has(v))
      : [];
    out.assignedOwners = authored.length ? authored : ['contact_owner'];
  }
  if (b.alsoNotifyContactFollowers !== undefined) out.alsoNotifyContactFollowers = b.alsoNotifyContactFollowers;
  if (b.alsoNotifyOpportunityFollowers !== undefined) out.alsoNotifyOpportunityFollowers = b.alsoNotifyOpportunityFollowers;
  return out;
}

function internalNotificationAttributes(a, ctx) {
  const channel = (a.type && NOTIFICATION_CHANNELS.includes(a.type) ? a.type : null)
    ?? NOTIFICATION_CHANNELS.find((c) => c in a) ?? 'email';
  const b = a[channel] ?? {};
  const dropped = Object.keys(b).filter((k) => !NOTIFICATION_EMITTED_KEYS[channel].includes(k));
  if (dropped.length) {
    ctx?.warn?.(`NOTIFICATION_KEY_DROPPED: internal_notification (${channel}) — authored key(s) `
      + `[${dropped.join(', ')}] are not emitted by this channel's shape and were discarded. `
      + `Accepted author keys: ${NOTIFICATION_EMITTED_KEYS[channel].join(', ')}. If one of these IS real, `
      + 'harvest a live example and extend the handler rather than assuming it shipped.');
  }
  const userType = b.userType ?? (b.selectedUser != null && b.selectedUser !== '' ? 'user' : 'all');
  const wantsUsers = userType === 'user';
  if (channel === 'email') {
    // `to` carries the recipient for the custom_email userType — LIVE-CAUGHT 2026-07-21
    // (GROM AU): it was absent from this allowlist, so an authored `to` was silently
    // dropped and the builder's "To Custom Email" field came up EMPTY (the notification
    // would reach nobody). The 2026-07-15 corpus that seeded this handler happened to
    // contain no custom_email example; a UI-built step in the same account carries
    // `to: "{{inboundWebhookRequest.email}}"` alongside `userType: "custom_email"`.
    const wantsTo = userType === 'custom_email' || b.to != null;
    if (userType === 'custom_email' && (b.to == null || b.to === '')) {
      throw new IRError('MISSING_FIELD',
        "internal_notification with userType 'custom_email' requires attributes.email.to — "
        + 'without it the builder shows an empty "To Custom Email" and the notification reaches nobody.');
    }
    return { type: 'email', email: {
      from_name: b.from_name ?? ctx?.senderDefault?.from_name ?? '{{location.name}}',
      from_email: b.from_email ?? ctx?.senderDefault?.from_email ?? '{{location.email}}',
      ...(wantsTo ? { to: b.to } : {}),
      userType,
      subject: b.subject ?? '',
      // TEMPLATE-MODE: real published notifications carry email.template_id (+ templatesource
      // 'email-builder') and NO inline html key at all — GHL's guards exempt the body on
      // template_id, and the 3 live captures omit html entirely. Mirror them: template_id XOR
      // html, never both (an empty inline body next to a template invites GHL to prefer it).
      ...(b.template_id != null && b.template_id !== '' && b.template_id !== 'none'
        ? { template_id: b.template_id, ...(b.templatesource != null ? { templatesource: b.templatesource } : {}) }
        : { html: b.html ?? '' }),
      ...(b.cc != null ? { cc: b.cc } : {}),
      ...(b.preHeader != null ? { preHeader: b.preHeader } : {}),
      attachments: b.attachments ?? [],
      ...(wantsUsers ? { selectedUser: asUserArray(b.selectedUser) } : {}),
    } };
  }
  if (channel === 'sms') {
    return { type: 'sms', sms: {
      body: b.body ?? '',
      ...(b.template_id != null && b.template_id !== '' ? { template_id: b.template_id } : {}),
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
      type: b.type ?? b.notificationType ?? 'send_notification',
      body: b.body ?? '',
      title: b.title ?? '',
      redirectPage: b.redirectPage ?? 'contact',
      userType,
      ...(wantsUsers ? { selectedUser: sel[0] ?? '' } : {}),
      ...assignedOwnerKeys(b, userType),
    } };
  }
  // whatsapp — the staff-facing channel of internal_notification (not the native action)
  return { type: 'whatsapp', whatsapp: {
    body: b.body ?? '',
    ...(b.template_id != null && b.template_id !== '' ? { template_id: b.template_id } : {}),
    userType,
    selectedUser: asUserArray(b.selectedUser),
  } };
}

// custom_webhook (outbound HTTP) — live-verified shape. body.rawData is a JSON STRING;
// headers/parameters are arrays of {key,value}; authorization is a {type,data} union.
// `event` classifies the outbound webhook and DRIVES THE PANEL: the builder renders
// METHOD, CONTENT-TYPE and RAW BODY only once EVENT resolves to a known value. An
// unrecognised value (e.g. the plausible-looking 'workflow') leaves the EVENT dropdown
// blank and those three controls never appear, so the step can carry neither a method
// nor a body — while round-tripping clean. Live-confirmed 2026-07-25 on AU. 'CUSTOM' is
// the only value attested in the corpus or the reference.
const WEBHOOK_EVENTS = new Set(['CUSTOM']);
const WEBHOOK_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
function webhookAttributes(a, ref) {
  const ev = a.event ?? 'CUSTOM';
  if (!WEBHOOK_EVENTS.has(ev))
    throw new IRError('WEBHOOK_EVENT',
      `custom_webhook '${ref ?? '?'}' has event '${ev}'. Only ${[...WEBHOOK_EVENTS].join(', ')} is `
      + `attested. An unknown event leaves the builder's EVENT dropdown blank and METHOD, `
      + `CONTENT-TYPE and RAW BODY never render, so the step saves with no method and no body.`);
  // Normalize to the attested casing. The guard below compared .toUpperCase() but the
  // emitted value was the author's original, so `method: 'post'` passed validation and
  // went on the wire lowercase — a casing the corpus does not attest.
  const method = String(a.method ?? 'POST').toUpperCase();
  if (!WEBHOOK_METHODS.has(method))
    throw new IRError('WEBHOOK_METHOD',
      `custom_webhook '${ref ?? '?'}' has method '${method}'. Expected one of ${[...WEBHOOK_METHODS].join(', ')}.`);
  if (!a.url)
    throw new IRError('WEBHOOK_URL', `custom_webhook '${ref ?? '?'}' has no url — the validator requires one.`);
  return {
    event: ev,
    method,
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
function codeAttributes(a, ref) {
  // An EMPTY `output` is what the builder reports as "Code must be tested before saving".
  // That message reads like a hard platform block on automation — it is not. Pressing
  // Test in the UI is merely how a human POPULATES `output`; authoring a representative
  // sample directly satisfies the validator with no UI visit. Live-proven 2026-07-25 on
  // AU: two custom_code nodes side by side, the one without `output` carried the error
  // badge, the one with it was clean. Defaulting to {} silently produced an unpublishable
  // step, so require it instead.
  const output = a.output ?? {};
  if (output === null || typeof output !== 'object' || Object.keys(output).length === 0)
    throw new IRError('CODE_OUTPUT_EMPTY',
      `custom_code '${ref ?? '?'}' has an empty \`output\`. The builder rejects this as `
      + `"Code must be tested before saving" and the step cannot be published. Author a `
      + `representative sample of what the code returns, e.g. output: { ok: true }.`);
  return {
    code: a.code ?? 'return {};',
    language: a.language ?? 'javascript',
    inputData: a.inputData ?? {},
    output,
  };
}

// wait — 9 subtypes discriminated by attributes.type. This builds LINEAR waits
// (single next). Multipath waits (timeout branching) are handled in flattenGraph.
// The drawer's option list (Wait.ts:1588 `startAfterTypeOptions`, bundle-2026-08-21-3) is
// [{label:'seconds',value:'seconds'},{label:'minutes',value:'minutes'},{label:'hours',value:'hour'},
// {label:'days',value:'days'}] — note the plural LABEL over the singular VALUE. So the UI can only
// ever write seconds|minutes|hour|days. Stored workflows hold both spellings (startAfter blocks
// across corpus+sniffs: minutes x71, days x10, hours x4, hour x1), so a stored 'hours' was written
// by an API call rather than the drawer; whether the scheduler honours it is UNPROVEN. Accepted
// with a warning until a live probe settles it; anything outside the set is refused, because an
// unknown unit saves clean and leaves the pause undefined.
const WAIT_UNITS = new Set(['seconds', 'minutes', 'hour', 'hours', 'days']);

function waitAttributes(node, ctx) {
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
    if (!WAIT_UNITS.has(startAfter.type))
      throw new IRError('WAIT_UNIT',
        `wait '${node.ref}' has startAfter.type '${startAfter.type}' — the drawer offers `
        + `seconds | minutes | hour | days. An unknown unit saves and publishes clean, but the `
        + `scheduler's behaviour is undefined: the wait may not pause at all.`);
    if (startAfter.type === 'hours')
      ctx?.warn?.(`WAIT_UNIT_SOFT: wait '${node.ref}' uses 'hours'; the drawer writes the singular `
        + `'hour' (Wait.ts startAfterTypeOptions maps label "hours" -> value 'hour'). Both spellings `
        + `exist in stored workflows; prefer 'hour' until a live probe confirms the scheduler reads 'hours'.`);
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
  if (wt === 'specific_date') {
    // The drawer's shape (Wait.ts: the specificDate* key block; setInitialSpecificDate() at :607
    // for the defaults; checkForSpecificDateError() at :1473 for what it refuses). A build once
    // authored `timePeriodInputMode` here — that key belongs to TIME delays, and the load-bearing
    // key for a date-field wait is `dynamicSpecificDate`.
    if (a.timePeriodInputMode !== undefined || a.dynamicTimePeriod !== undefined) {
      throw new IRError('WAIT_SPECIFIC_DATE',
        `wait '${node.ref}': timePeriodInputMode belongs to TIME delays; a specific_date wait's dynamic `
        + 'mode is specificDateInputMode + dynamicSpecificDate. Author dynamicSpecificDate: "{{merge}}" '
        + 'for a date-field wait.');
    }
    const dynamic = a.dynamicSpecificDate !== undefined || a.specificDateInputMode === 'dynamic';
    return {
      type: 'specific_date',
      specificDateInputMode: dynamic ? 'dynamic' : 'standard',
      // NO time defaults on the standard path. This builder runs BEFORE enforceRequiredFields, so
      // defaulting specificTimeHour/Period here would make GHL's own checkForSpecificDateError
      // rule (ported into COUPLED_FIELDS.wait) unreachable — the engine would bless a step the
      // builder marks red. Emit only what the author supplied.
      ...(dynamic
        ? { dynamicSpecificDate: a.dynamicSpecificDate }
        : { specificDate: a.specificDate,
            ...(a.specificTimeHour !== undefined ? { specificTimeHour: a.specificTimeHour } : {}),
            ...(a.specificTimeMinute !== undefined ? { specificTimeMinute: a.specificTimeMinute } : {}),
            ...(a.specificTimePeriod !== undefined ? { specificTimePeriod: a.specificTimePeriod } : {}) }),
      // setInitialSpecificDate()'s own defaults, verbatim.
      specificDateProceed: a.specificDateProceed ?? 'on',
      specificDateOffsetDays: a.specificDateOffsetDays ?? 0,
      specificDateOffsetHours: a.specificDateOffsetHours ?? 0,
      specificDateOffsetMinutes: a.specificDateOffsetMinutes ?? 0,
      specificDatePassed: a.specificDatePassed ?? 'skip',
      ...(a.specificDateStep !== undefined ? { specificDateStep: a.specificDateStep } : {}),
      ...(a.window ? { window: a.window } : {}),
      ...hybrid,
    };
  }

  return { type: wt, ...a, ...hybrid };
}

// Email attributes — fills the fields the builder requires (live-verified 2026-07-10:
// a bare {subject,html} email shows an error until these are present). Handles both the
// inline-HTML path and the template path. For template mode the `template_id` must already
// exist (created via POST /emails/builder by the orchestrator) — a non-existent id errors.
function emailAttributes(node, ctx) {
  const a = node.attributes ?? {};
  const base = {
    trackingOptions: a.trackingOptions ?? { hasTrackingLinks: true, hasUtmTracking: true, hasTags: false },
    conditions: a.conditions ?? [],
    subject: a.subject ?? '',
    preHeader: a.preHeader ?? '',
    from_name: a.from_name ?? ctx?.senderDefault?.from_name ?? '{{location.name}}',
    from_email: a.from_email ?? ctx?.senderDefault?.from_email ?? '{{location.email}}',
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

// Re-run a STORED template's attributes through the same dispatch the BUILD path uses.
// modifyStep was a raw shallow merge — the long-known bypass: a wait window patched without
// `days`, a notification patched with a flat notificationType, were written as given while
// these builders knew the full shape all along (F5-20). This deliberately calls attributesFor,
// the one dispatch, rather than re-listing the dedicated builders here: a second copy of that
// table is exactly the divergence this whole change exists to remove.
// Only types whose AUTHOR shape is their WIRE shape can be re-run; template-normalize.mjs's
// NORMALIZE_SKIP holds the rest and routes them to retypeStep.
export function normalizeStoredAttributes(template, ctx) {
  const warnings = [];
  // COLLECT only — do not forward to ctx.warn here. The caller re-emits what it wants, and
  // forwarding as well reported every warning twice.
  const wctx = { ...ctx, warn: (m) => { warnings.push(m); } };
  const node = {
    ref: template.id,
    kind: template.type === 'wait' ? 'wait' : 'action',
    type: template.type,
    name: template.name,
    attributes: template.attributes ?? {},
  };
  return { attributes: attributesFor(node, wctx), warnings };
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
function withStepDisabled(node, template, ctx) {
  let out = template;
  // Action NOTES (IR `notes: [..]`) → `comments[]` in CommentSection.vue's exact record shape,
  // newest first. Absent/empty → no `comments` key, so every prior emitted shape is unchanged.
  if (Array.isArray(node.notes) && node.notes.length) out = { ...out, comments: stepNotesToComments(node.notes, ctx ?? {}) };
  if (node.disabled !== true) return out;
  return {
    ...out,
    advanceCanvasMeta: {
      ...(node.advanceCanvasMeta ?? {}),
      ...(out.advanceCanvasMeta ?? {}),
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
export function normalizeCondition(rawC, ctx) {
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

  // Trigger identity. The value is a trigger ID, which used to be server-minted AFTER the
  // auto-save — so an if_else routing on which trigger fired could not be authored in one pass
  // (F5-17). The IR may now name the trigger by REF: `{ conditionType:'trigger', trigger:'<ref>' }`
  // resolves through the placeholder ids compile() mints up front. A literal id passes straight
  // through, which is what an edit against a live trigger roster sends.
  if (type === 'trigger') {
    const refs = ctx?.__triggerRefs;
    let value = c.conditionValue ?? c.trigger;
    if (c.trigger !== undefined) {
      value = refs?.get(c.trigger);
      if (!value) {
        throw new IRError('REF_DANGLING',
          `REF_DANGLING: if_else condition targets trigger ref '${c.trigger}', which names no trigger `
          + 'in this IR. Give the trigger a `ref` and use the same string here, or pass a literal trigger id.');
      }
    } else if (refs?.has(value)) {
      value = refs.get(value);
    }
    return {
      ...extras,
      conditionType: 'trigger',
      conditionSubType: c.conditionSubType,
      conditionOperator: '==',
      conditionValue: value,
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
  const n = lintConditionShape(normalizeCondition(c, ctx));
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
  // `appointment` joins contact_detail here on LIVE evidence: the UI-built relative-date
  // condition (workflow 07g, captured 2026-07-19) carries __customFieldType__:'standard'
  // even though it is not a custom field. Engine-built conditions lacked it — the same
  // fidelity gap class as the nested-if_else `parent` bug (v0.3.9), where UI-built nodes
  // all carried a key the compiler omitted and the compiler turned out to be the wrong one.
  // SUPPORT = 1 (one condition in the wild across 78 swept workflows); scoped to the two
  // types actually observed rather than emitted for every type on a corpus this thin.
  if (n.conditionType === 'contact_detail' || n.conditionType === 'appointment')
    out.__customFieldType__ = n.__customFieldType__ ?? 'standard';
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
      // SETTLED 2026-07-17 by live capture: a nested if_else DOES carry
      // `parent = parentScopeId`, same as the other seven container types. Harvested from
      // UI-built workflows (e.g. "Ads Pixel - CRM Movement"): every nested condition-node
      // had `parent === its scope owner`, 6/6. This engine used to omit it — the only
      // container type that did — so engine-built nested if_else nodes (a client's 07b/11/11b)
      // are missing it while every UI-built one has it. Match the builder.
      const conditioned = n.branches.filter((b) => b.else !== true);
      const elseBranch = n.branches.find((b) => b.else === true);
      const conditionedIds = conditioned.map((b) => idForRef(refMap, ctx, b.ref));
      // else id reuses its ref (goto/reply targeting); a synthesized None gets a fresh id.
      const noneId = elseBranch ? idForRef(refMap, ctx, elseBranch.ref) : ctx.idGen();
      const allBranchIds = [...conditionedIds, noneId];
      const noneName = elseBranch?.name ?? 'None';
      const ifElseContainer = {
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
      };
      if (parentScopeId !== null) ifElseContainer.parent = parentScopeId;
      templates.push(withStepDisabled(n, ifElseContainer, ctx));
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
      // Container types build their attributes inline and never reach normalizeAttrs, so
      // the required-field check has to be invoked here too. Without it `calendarId`
      // compiled to `undefined` and the builder rendered "Select Calendar is a required
      // field" while the engine reported a clean pass.
      const attrs = enforceRequiredFields(n, n.attributes ?? {});
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
      templates.push(withStepDisabled(n, container, ctx));
      const booked = flattenGraph(n.onBooked ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: 'Appointment Booked', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: booked.entryId });
      templates.push(...booked.templates);
      const notb = flattenGraph(n.onNotBooked ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: 'Appointment Not booked', cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notb.entryId });
      templates.push(...notb.templates);
      return;
    }

    // Conversation-AI "Services booking" node — the commerce-service sibling of
    // book_appointment, and a multi-path container for the SAME reason: the marketplace asset
    // gives it two pre-defined branches, "Appointment Booked" / "Appointment Not Booked".
    //
    // It was emitted as a PLAIN node until 2026-08-26 — the catalogue carried
    // isMultipathContainer:false (a 2026-07-15 panel read) and the compiler had no case for it,
    // so an authored node saved with no `cat`, no `transitions[]` and `next: null`: a step that
    // appears on the canvas and cannot branch.
    //
    // Note the branch name casing differs from book_appointment: the asset says "Appointment Not
    // Booked" here and "Appointment Not booked" there. Copied per-type from the asset rather than
    // shared, because GHL is not consistent and the name is what the builder matches on.
    if (n.type === 'conversationai_services_booking') {
      const attrs = enforceRequiredFields(n, n.attributes ?? {});
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const container = {
        id, type: 'conversationai_services_booking', name: n.name ?? 'Services booking',
        order: i, parentKey, cat: 'multi-path', workflowsActionType: 'INTERNAL', next: [t1, t2],
        attributes: {
          conversationai_services: attrs.conversationai_services,
          conversationai_booking_description: attrs.conversationai_booking_description
            ?? 'Get customer to book a service',
          type: 'conversationai_services_booking', __customInputs__: {},
          cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: t1, name: 'Appointment Booked', fields: { appointmentBooked: true, appointmentNotBooked: false }, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
            { id: t2, name: 'Appointment Not Booked', fields: { appointmentNotBooked: true }, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
          ],
          __name__: n.name ?? 'Services booking',
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(withStepDisabled(n, container, ctx));
      const booked = flattenGraph(n.onBooked ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: 'Appointment Booked', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: booked.entryId });
      templates.push(...booked.templates);
      const notb = flattenGraph(n.onNotBooked ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: 'Appointment Not Booked', cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notb.entryId });
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
      // Same bypass as book_appointment above — enforce here, not in normalizeAttrs.
      // `description` is what the LLM routes on; it used to default to '' and render the
      // node with a red badge.
      const attrs = enforceRequiredFields(n, n.attributes ?? {});
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
      templates.push(withStepDisabled(n, container, ctx));
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
      templates.push(withStepDisabled(n, container, ctx));
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
      // Filters are authored at NODE level as find.filters — NOT as
      // attributes.__customInputFields__ (the EMITTED shape). That key is on the engine's
      // accepted list, so the generic ATTR_KEY guard stays silent, and this handler never
      // reads it: the finder compiled with ZERO filters and matched an arbitrary
      // opportunity. Combined with sorting:'latest', a contact holding two cards resolved
      // at random. Built clean, verified clean, no builder error. Live-diagnosed
      // 2026-07-25 on AU.
      if (n.attributes?.__customInputFields__ !== undefined)
        throw new IRError('FIND_FILTERS_MISPLACED',
          `find_opportunity '${n.ref ?? n.name}' authors attributes.__customInputFields__, which this `
          + `step IGNORES — that is the emitted shape, not the author shape. Move it to the node-level `
          + `find.filters: [{ field: 'pipeline_id', operator: 'eq', value: '<pipelineId>' }]. Left as `
          + `authored, the finder compiles with NO filters and matches an arbitrary opportunity.`);
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
      templates.push(withStepDisabled(n, container, ctx));
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
      // Resolve-or-throw: refMap.get() on an unknown ref returned undefined, which emitted a
      // goto with NO targetNodeId — the broken-link node GHL's panel calls "0 Errors" (its
      // gotoValidator grades !targetExists as a warning). Found from a real client screenshot.
      const gotoTarget = refMap.get(n.target);
      if (!gotoTarget)
        throw new IRError('REF_DANGLING',
          `REF_DANGLING: goto '${n.ref}' targets ref '${n.target}', which does not exist in this IR. GHL would save ` +
          `this with a green "0 Errors" panel and a broken-link icon; the runtime would have nowhere to ` +
          `send the contact. Point \`target\` at a real node ref.`);
      const tmpl = {
        id, type: 'goto', name: n.name ?? 'Go To', order: i,
        attributes: { targetNodeId: gotoTarget, type: 'goto' },
        next: null, parentKey,
      };
      if (parentScopeId !== null) tmpl.parent = parentScopeId;
      templates.push(withStepDisabled(n, tmpl, ctx));
      return;
    }

    // workflow_split — random/weighted A/B/N-way split (live-verified shape mirrors
    // catalog/step-examples/workflow_split.json). Each path gets a `transition` entry
    // step (conditionType:"default") that its children hang off. Weights live in
    // extras.weightDistribution (a `random` split with no weights defaults to even).
    if (n.kind === 'split') {
      // idForRef records the path's own ref -> its entry id, the way if_else already does for
      // its branches, so `appendToBranch { branchRef }` can anchor to a path authored earlier
      // in the same call. An unnamed path still gets a fresh id.
      const pathIds = n.paths.map((p) => idForRef(refMap, ctx, p.ref));
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
      templates.push(withStepDisabled(n, container, ctx));
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
      templates.push(withStepDisabled(n, container, ctx));
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
      const branchIds = n.branches.map((b) => idForRef(refMap, ctx, b.ref));   // see the split note above
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
      templates.push(withStepDisabled(n, container, ctx));
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
    if (n.marketplace === true) tmpl.isMarketplaceAction = true;
    if (parentScopeId !== null) tmpl.parent = parentScopeId;
    templates.push(withStepDisabled(n, tmpl, ctx));
  });
  // GHL OMITS `parentKey` on a root-scope entry node — it never emits null. Proven three ways
  // (2026-08-21): across 310 live workflows / 3,958 nodes `parentKey === null` occurs 0 times;
  // 309/310 entry nodes omit the key; and a UI-built entry node captured from the builder's own
  // PUT carries no parentKey property at all. A server check shaped like `!node.parentKey`
  // cannot distinguish null from absent, so emitting null risks a graph rejection the builder
  // itself would never provoke. Stripped here once rather than at each of the ~20 emission
  // sites above; every reader (edit.mjs, edit-driver.mjs) already tests `null || undefined`.
  // Only the root scope is affected — a nested scope passes a non-null parentScopeId, so its
  // entry node keeps a real parentKey. See notes/2026-08-21-workflow-shape-findings.md F1.
  for (const t of templates) if (t.parentKey === null) delete t.parentKey;
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

// GHL's own filter component offers exactly two operators on a marketplace trigger's
// string filters. There is NO equals. An unsupported operator saves clean and then never
// matches, so it is fatal rather than advisory.
const MARKETPLACE_OPERATORS = new Set(['string-contains-any-of', 'is-not-empty']);

// A marketplace filter's operator menu depends on the FILTER TYPE the app declares, not on a
// single global rule. The old rule ("exactly two operators, and no equals") was a STRING-filter
// fact applied to every type, so a multiselect customVar could not be filtered at all (F5-19).
function marketplaceFilterType(entry, field) {
  return entry?.filters?.find((x) => x.field === field || x.reference === field)?.fieldType
    ?? entry?.customVars?.find((v) => v.reference === field || v.name === field)?.fieldType
    ?? 'string';
}
function marketplaceMenuFor(table, type) {
  const key = type === 'multiselect' || type === 'multiselect_with_pagination' ? 'multiselect'
    : type === 'select_with_pagination' ? 'select'
      : type;
  return table.menus[key] ?? table.menus.string;
}

function checkMarketplaceFilters(triggers, ctx) {
  const values = [];
  const table = ctx?.catalog?.marketplaceFilterOperators ?? null;
  for (const t of triggers) {
    if (t.marketplace !== true) continue;
    const entry = ctx?.marketplace?.get?.(t.type, 'trigger') ?? null;
    for (const f of t.filters ?? []) {
      if (table) {
        // Per-type: default the operator the way the drawer defaults it, and refuse only what its
        // menu for THIS type does not offer.
        const ftype = marketplaceFilterType(entry, f.field);
        const menu = marketplaceMenuFor(table, ftype);
        const operator = f.operator ?? table.defaults[ftype] ?? table.defaults.string;
        if (!operator) {
          throw new IRError('MARKETPLACE_FILTER_OPERATOR',
            `trigger '${t.name ?? t.type}' filters '${f.field}' with no operator and this filter type `
            + `('${ftype}') has no default — pick one of [${menu.join(', ')}].`);
        }
        if (!menu.includes(operator)) {
          throw new IRError('MARKETPLACE_FILTER_OPERATOR',
            `trigger '${t.name ?? t.type}' filters '${f.field}' with operator '${operator}', which the `
            + `drawer does not offer for a '${ftype}' filter. Its menu is [${menu.join(', ')}]. An `
            + `unsupported operator saves and never matches.`);
        }
        for (const v of [].concat(f.value ?? [])) if (typeof v === 'string' && v) values.push(v);
        continue;
      }
      // A marketplace trigger has no catalog filterRows, so expandFilter never runs to
      // backfill a default operator the way a native trigger's filters do. A missing
      // operator is therefore not "unspecified, fill it in" — it is the exact same fatal
      // shape as an unsupported one: the condition saves with no operator key at all and
      // never matches. Fold both into one throw rather than defaulting, which would invent
      // author intent (e.g. silently matching on a phrase nobody wrote).
      if (!f.operator)
        throw new IRError('MARKETPLACE_FILTER_OPERATOR',
          `trigger '${t.name ?? t.type}' filters '${f.field}' with no operator. A marketplace filter `
          + `requires one — GHL's marketplace filter component offers only `
          + `${[...MARKETPLACE_OPERATORS].join(' and ')}. A condition saved without an operator saves `
          + `clean and never matches.`);
      if (!MARKETPLACE_OPERATORS.has(f.operator))
        throw new IRError('MARKETPLACE_FILTER_OPERATOR',
          `trigger '${t.name ?? t.type}' filters '${f.field}' with operator '${f.operator}', which GHL's `
          + `marketplace filter component does not offer. The only operators are `
          + `${[...MARKETPLACE_OPERATORS].join(' and ')}. An unsupported operator saves and never matches.`);
      for (const v of [].concat(f.value ?? [])) if (typeof v === 'string' && v) values.push(v);
    }
  }
  // Every marketplace trigger match is a SUBSTRING match, so one label containing another
  // double-fires. Warn — the author may have meant it.
  for (const a of values) {
    for (const b of values) {
      if (a !== b && b.includes(a))
        ctx?.warn?.(`marketplace trigger filter values overlap: '${a}' is a substring of '${b}'. `
          + `Marketplace filters match by substring only, so anything matching '${b}' also fires '${a}'.`);
    }
  }
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
// utils/conditions.ts (recovered source) — a custom field's wire condition `type`, by dataType.
const VALUE_TYPE_BY_DATATYPE = {
  TEXT: 'string', LARGE_TEXT: 'string', PHONE: 'string', URL: 'string', RICH_TEXT: 'string',
  NUMERICAL: 'numerical', MONETORY: 'numerical',
  SINGLE_OPTIONS: 'select', RADIO: 'select',
  MULTIPLE_OPTIONS: 'multiselect', CHECKBOX: 'multiselect',
  DATE: 'date', FILE_UPLOAD: 'file', SIGNATURE: 'string', TIME: 'string',
};
// The drawer forces `has-changed` on these — there is no value to compare.
const FORCED_HAS_CHANGED = new Set(['PHONE', 'FILE_UPLOAD', 'SIGNATURE']);

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
// Instantiate a per-account custom-field row from the catalog's filterRowTemplates. The author
// may name the field by id, by `contact.<id>`, by display name, or by fieldKey; the account's own
// field list (ctx.customFields) is the only thing that can turn any of those into a wire row.
function instantiateRowTemplate(f, key, extra) {
  const templates = extra?.meta?.filterRowTemplates;
  const fields = extra?.ctx?.customFields;
  if (!Array.isArray(templates) || !templates.length || !Array.isArray(fields) || !fields.length) return null;
  if (key == null || key === '') return null;

  const wanted = String(key).replace(/^(?:contact|opportunity)\./, '');
  const norm = (x) => String(x ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  for (const tpl of templates) {
    const model = tpl.source === 'opportunityCustomFields' ? 'opportunity' : 'contact';
    const field = fields.find((c) => {
      if ((c.model ?? 'contact') !== model) return false;
      const keySuffix = String(c.fieldKey ?? '').split('.').pop();
      return c.id === wanted || norm(c.name) === norm(wanted) || c.fieldKey === key || norm(keySuffix) === norm(wanted);
    });
    if (!field) continue;

    const type = VALUE_TYPE_BY_DATATYPE[field.dataType] ?? 'string';
    const forced = FORCED_HAS_CHANGED.has(field.dataType) ? 'has-changed' : null;
    const menu = Array.isArray(tpl.operatorMenu) && tpl.operatorMenu.length ? tpl.operatorMenu : null;
    let operator = f.operator ?? forced ?? tpl.defaultOperator ?? (menu ? null : defaultOp(type));
    if (operator == null) {
      throw new IRError('FILTER_OPERATOR_REQUIRED',
        `custom-field filter '${field.name}' has no default operator — the drawer forces a pick from `
        + `[${menu.join(', ')}]. Author one.`);
    }
    if (forced && f.operator && f.operator !== forced) {
      throw new IRError('FILTER_OPERATOR',
        `custom-field filter '${field.name}' is a ${field.dataType} field — the drawer offers only `
        + `'${forced}' for it (there is no value to compare), not '${f.operator}'.`);
    }
    if (menu && !menu.includes(operator) && operator !== forced) {
      throw new IRError('FILTER_OPERATOR',
        `custom-field filter '${field.name}' operator '${operator}' is not in the drawer's menu `
        + `[${menu.join(', ')}].`);
    }
    const cond = {
      operator,
      field: tpl.valuePattern.replace('{id}', field.id),
      title: f.title ?? field.name,
      type,
      id: field.id,
    };
    if (f.value !== undefined) cond.value = f.value;
    return cond;
  }
  return null;
}

function expandFilter(f, rows, extra = {}) {
  // already complete — but still normalize a scalar-op value, so a hand-authored
  // ['tag'] can't silently reintroduce the inert-trigger bug via this passthrough.
  if (f.field && f.operator && f.title && f.type) {
    if (typeof f.type !== 'string' || typeof f.operator !== 'string')
      throw new IRError('FILTER_SHAPE',
        `trigger filter '${f.field}' was authored with a non-string type/operator; both are strings on the wire `
        + `and GHL returns 500 on an object-valued row.`);
    return SCALAR_OPS.has(f.operator) && Array.isArray(f.value) && f.value.length === 1
      ? { ...f, value: f.value[0] }
      : f;
  }
  const key = f.on ?? f.field ?? f.id;
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  const row = rows.find((r) => r.id === key || r.value === key || r.label === key || norm(r.label) === norm(key) || norm(r.value) === norm(key));
  if (!row) {
    // No STATIC row matched. The drawer may still offer this row PER ACCOUNT FIELD — contact_changed
    // on a custom field is a row that exists only once the field does, which is why the engine could
    // not express it at all (F5-26). Instantiate from the catalog's row template.
    const instantiated = instantiateRowTemplate(f, key, extra);
    if (instantiated) return instantiated;
    return f; // unknown row — passthrough whatever was given
  }
  const type = f.type ?? row.type ?? 'select';
  // TAKE THE DEFAULT OR REQUIRE A MENU MEMBER, NEVER INVENT. Where the drawer offers a menu and no
  // default, it forces the author to pick; the engine used to invent one from the row's TYPE, which
  // produced an operator the menu never contained — saves clean, never matches (F5-25).
  const menu = Array.isArray(row.operatorMenu) && row.operatorMenu.length ? row.operatorMenu : null;
  let operator = f.operator ?? (row.defaultOperator ?? undefined) ?? row.operator;
  if (operator === undefined || operator === null) {
    if (menu) {
      throw new IRError('FILTER_OPERATOR_REQUIRED',
        `trigger filter '${row.value}' has NO default operator — the drawer forces a pick from `
        + `[${menu.join(', ')}]. Author one. An invented operator saves clean and never matches.`);
    }
    operator = defaultOp(type);
  }
  if (menu && typeof operator === 'string' && !menu.includes(operator)) {
    throw new IRError('FILTER_OPERATOR',
      `trigger filter '${row.value}' operator '${operator}' is not in the drawer's menu for this row `
      + `[${menu.join(', ')}] — an off-menu operator saves clean and never matches.`);
  }
  // WIRE-SHAPE GUARD: a condition row's type/operator are STRINGS on the wire. An object here is
  // an unresolved catalog artefact (an enum the extractor could not resolve), and GHL answers 500
  // to the trigger POST — the whole build reported ok with every trigger failed (F5-16). Refuse at
  // compile with the fix named, instead of shipping a workflow with no working trigger.
  if (typeof type !== 'string' || typeof operator !== 'string') {
    const which = typeof type !== 'string' ? `type (${JSON.stringify(type)})` : `operator (${JSON.stringify(operator)})`;
    throw new IRError('FILTER_SHAPE',
      `trigger filter '${row.value}' resolved to a non-string ${which} — an unresolved catalog artefact. GHL returns `
      + `500 on an object-valued row. Fix the catalog row (TRIGGER_CORRECTIONS in required-fields.mjs, or regenerate `
      + `with the enum resolved) rather than authoring around it.`);
  }
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
  // FIDELITY, not correctness (Task 9, workflow save-correctness) — a live per-trigger PUT
  // capture of conv_ai_autonomous_trigger's condition rows (2026-08-27) shows two quirks the
  // generic row model above doesn't reproduce: customTriggerPriority's value is a NUMBER, and
  // customTriggerDescription's condition carries its text in BOTH `value` and `title` (the
  // generic model leaves title as the row's blank label). Neither was required for the write
  // to apply — proved live sending the plain-string/blank-title shape and reading it back
  // unchanged — so this is matching the builder byte-for-byte, not fixing a write that didn't
  // work. Only applies to the row-expansion path; a hand-authored complete filter row
  // (field+operator+title+type, handled above) is passed through untouched either way.
  if (cond.field === 'customTriggerPriority' && cond.value !== undefined && cond.value !== null && cond.value !== '') {
    const n = Number(cond.value);
    if (!Number.isNaN(n)) cond.value = n;
  }
  if (cond.field === 'customTriggerDescription') cond.title = String(cond.value ?? '');
  return cond;
}

// Mirrors the builder's own isGotoTriggerType(): the registry entry's isGotoTrigger flag.
// Falls back to the one known member so an older catalog still behaves.
function isGotoTriggerType(type, ctx) {
  const meta = ctx?.catalog?.trigger?.(type);
  if (meta && 'isGotoTrigger' in meta) return Boolean(meta.isGotoTrigger);
  return type === 'conv_ai_autonomous_trigger';
}

export function buildTrigger(t, ctx, wid, refMap) {
  const meta = ctx.catalog.trigger(t.type);
  const rows = meta?.filterRows ?? [];
  let conditions = (t.filters ?? []).map((f) => expandFilter(f, rows, { ctx, meta }));
  // TRIGGER SEEDS — rows the UI adds to this trigger type by itself (TriggerMain.addMandatoryFilters,
  // on creation AND load). Only corpus-CONFIRMED rows are seeded (appointment.eventType == 'normal'
  // is present and FIRST on 95% of stored appointment triggers), with the exact stored shape.
  // Authored filters on the same field win. Hatch: ctx.skipTriggerSeeds.
  if (ctx?.skipTriggerSeeds !== true) {
    const seedRows = (ctx?.catalog?.trigger?.(t.type)?.seededFilters?.rows ?? []).filter((r) => r.verdict === 'seed-confirmed' && r.seedRow?.field);
    for (const r of seedRows.reverse()) {
      if (conditions.some((c) => c?.field === r.seedRow.field)) continue;
      const { field, operator, type, title, value } = r.seedRow;
      conditions.unshift({ operator, field, ...(value !== null && value !== undefined ? { value } : {}), ...(title ? { title } : {}), ...(type ? { type } : {}) });
    }
  }
  let marketplaceFields = {};
  if (t.marketplace === true) {
    // A marketplace TRIGGER is always a trigger key — never an action key.
    const entry = marketplaceEntry({ type: t.type, ref: t.name ?? t.type }, ctx, 'trigger');
    marketplaceFields = { version: entry.version, templateId: entry.templateId };
    // A marketplace condition addresses the event payload by dotted path, and the stored
    // shape carries `id` and `field` as the SAME string. It also carries the filter's TYPE and
    // TITLE, and its operator defaults per type exactly as the drawer pre-selects one — the row
    // is otherwise emitted with no operator at all, which saves clean and never matches.
    const table = ctx?.catalog?.marketplaceFilterOperators ?? null;
    conditions = conditions.map((c) => {
      const ftype = marketplaceFilterType(entry, c.field);
      const title = c.title
        ?? entry?.filters?.find((x) => x.field === c.field || x.reference === c.field)?.name
        ?? entry?.customVars?.find((v) => v.reference === c.field)?.name;
      return {
        ...c,
        id: c.id ?? c.field,
        ...(c.type ? {} : { type: ftype }),
        ...(title ? { title } : {}),
        ...(c.operator ? {} : (table?.defaults?.[ftype] ? { operator: table.defaults[ftype] } : {})),
      };
    });
  }
  // trigger SHAPE rules from the catalog's filterChecks (extract-trigger-validators):
  // scheduler needs an interval, IVR needs a phone number — the IVR one is also BLOCKED by the
  // backend at save (beDedupeAssetType), so surfacing it here saves a doomed round-trip.
  for (const r of (meta?.filterChecks?.shapeRules ?? [])) {
    const row = conditions.find((c) => c.field === r.field);
    const empty = !row || row.value == null || row.value === '' || (Array.isArray(row.value) && !row.value.length);
    // quote the builder's own wording when the catalog carries it (i18n, from the compiled chunk)
    const ghlText = r.i18n && ctx?.catalog?.i18n?.[r.i18n] ? ` — GHL: "${ctx.catalog.i18n[r.i18n]}"` : '';
    if (empty) ctx?.warn?.(`TRIGGER_FILTER: '${t.name ?? t.type}' (${t.type}) — GHL requires filter '${r.field}'${r.beDedupeAssetType ? ' (the SERVER blocks the save without it)' : ''}${ghlText}`);
  }
  // FLOW-BOT BINDING — a FLOW_BUILDER_BOT's flow binds to its agent through a CONDITION ROW,
  // not through a top-level key.
  //
  // LIVE-PROVEN 2026-08-26 on the designated test account. The engine previously emitted
  // `convTriggerBotId` at the top level (added 2026-07-15 as a "fix" for a binding that was
  // being dropped). It never worked: a workflow built WITH convTriggerBotId:'<agent>' reads
  // back with conditions:[] and NO convTriggerBotId key at all -- GHL discards the key outright
  // rather than storing it verbatim. Every flow workflow the engine built was therefore
  // UNBOUND, while build reported verify.pass:1 and zero warnings.
  //
  // GHL's own client stores (capture 2026-04-20, catalog/trigger-examples/conv_ai_trigger.json):
  //   conditions: [{ operator: '==', field: 'botId', value: <AGENT_ID>, title: '', type: 'input' }]
  //
  // convTriggerBotId IS real -- but only as the BUILDER URL's query parameter
  // (?triggerType=conv_ai_trigger&convTriggerBotId=<id>), never as a stored field. Reading a
  // URL and writing it to the document is the same mistake that put `reactivate`,
  // `transfer_bot.prompt` and `continue.prompt` on this surface before they were corrected.
  if (t.convTriggerBotId && !conditions.some((c) => c?.field === 'botId')) {
    conditions = [...conditions,
      { operator: '==', field: 'botId', value: t.convTriggerBotId, title: '', type: 'input' }];
  }
  if (t.type === 'conv_ai_trigger' && !conditions.some((c) => c?.field === 'botId')) {
    ctx?.warn?.(`FLOW_BINDING: '${t.name ?? t.type}' (conv_ai_trigger) has no botId condition — `
      + 'the flow will NOT be bound to any agent and the bot will never enter it. '
      + 'Pass convTriggerBotId on the trigger with the FLOW_BUILDER_BOT\'s agent id.');
  }
  // GOTO TRIGGERS — `conv_ai_autonomous_trigger` ("Custom trigger" in the UI) is not an entry
  // trigger: its registry entry carries isGotoTrigger:true and it JUMPS the contact to a step,
  // named by `targetActionId`. Authors name the step by REF, exactly as `goto` does, and the ref
  // is resolved here against the same refMap the graph filled — buildTrigger runs after the
  // graph is flattened, so every ref is already seated.
  //
  // A literal `targetActionId` is also accepted, for the edit path where the caller holds a real
  // step id from an exported workflow rather than an IR ref.
  let targetActionId = t.targetActionId;
  if (t.target) {
    targetActionId = refMap?.get(t.target);
    if (!targetActionId) {
      throw new IRError('REF_DANGLING',
        `REF_DANGLING: trigger '${t.name ?? t.type}' targets ref '${t.target}', which does not `
        + 'exist in this IR. A goto trigger with no targetActionId saves and has nowhere to send '
        + 'the contact. Point `target` at a real node ref.');
    }
  }
  if (targetActionId && !isGotoTriggerType(t.type, ctx)) {
    ctx?.warn?.(`TRIGGER_TARGET: '${t.name ?? t.type}' (${t.type}) is not a goto trigger, so `
      + 'targetActionId will be stored and ignored. Only conv_ai_autonomous_trigger jumps.');
  }
  if (!targetActionId && isGotoTriggerType(t.type, ctx)) {
    ctx?.warn?.(`TRIGGER_TARGET: '${t.name ?? t.type}' is a goto trigger with NO target — the `
      + 'builder flags it as an incomplete trigger. Pass `target: "<step ref>"`.');
  }
  if (targetActionId && isGotoTriggerType(t.type, ctx)) {
    ctx?.warn?.(`GOTO_TRIGGER_RACE: '${t.name ?? t.type}' re-enters the flow at a step via `
      + 'targetActionId. GHL can deliver the SAME trigger event twice ~15s apart (different '
      + 'workflowTraceIds, at-least-once delivery). The second firing\'s remove-from-run lands '
      + 'on the run the first one created, and its re-enrol never arrives: the run dies mid-'
      + 'conversation with no reply and no field writes. Reproduced 3/3 on 2026-08-27 '
      + '(goto-kill-evidence.md). The fatal case is a remove hitting a run WAITING at an '
      + 'interactive step, so a targeted section that only derives and records is survivable '
      + 'while one that asks a question is not. GHL\'s own pattern avoids the jump entirely: '
      + 'land every trigger at the flow HEAD and route on trigger identity with a head if_else '
      + '({conditionType:"trigger", conditionSubType:"trigger", conditionValue:"<trigger id>"} '
      + '— conditionSubType is mandatory).');
  }
  return {
    // `status` ("draft"|"published") is the ACTIVATION FIELD — measured 2026-08-28 (throwaway
    // workflows on the designated test sub-account): a trigger's `active` flag is a READ-ONLY
    // PROJECTION of this field (`active === (status !== "draft")`), not something any write
    // controls directly. Hardcoding `status:'draft'` is correct ONLY here, on the fresh-
    // workflow BUILD path: compile() always creates a new workflow in draft (see orchestrate.mjs),
    // and its triggers must stay inactive until the workflow itself is published — draft-first
    // is a deliberate product policy, not just a side effect of this field. The EDIT path
    // (edit-driver.mjs's planTriggerOps: addTrigger/duplicateTrigger/modifyTrigger) calls this
    // same function but must NOT inherit this hardcoded value unexamined — an already-published
    // target workflow needs `status:'published'` instead, or a fresh trigger lands dead with
    // nothing that will ever activate it. See planTriggerOps's mechanism note for the full
    // history of what this field's absence caused (the modifyTrigger deactivation bug) and how
    // each edit-path caller decides `status` for itself.
    status: 'draft', workflowId: wid, schedule_config: {},
    ...(targetActionId ? { targetActionId } : {}),
    conditions,
    type: t.type,
    masterType: t.marketplace === true ? 'marketplace' : (t.masterType ?? meta?.masterType ?? 'highlevel'),
    ...marketplaceFields,
    name: t.name,
    actions: [{ workflow_id: wid, type: 'add_to_workflow' }],
    // Marketplace triggers carry their schema flavour on the stored document. The builder
    // sends it (captured live 2026-07-27 from its own POST) and GHL persists it, so mirror
    // it wherever the catalog records one — and never invent it where it does not.
    ...(meta?.workflowsTriggerType ? { workflowsTriggerType: meta.workflowsTriggerType } : {}),
    active: t.active !== false, triggersChanged: true,
    location_id: ctx.loc, company_id: ctx.cid, company_age: ctx.companyAge,
    // NOTE: convTriggerBotId is deliberately NOT emitted here — GHL discards it (see above).
    // The binding is the botId condition row.
  };
}

// ─── Flow-bot trigger rules ────────────────────────────────────────────────────────────────
//
// EVERY ONE OF THESE IS CLIENT-SIDE ONLY. Probed 2026-08-26 against the live trigger POST: the
// API accepted 8 custom triggers on one workflow (the drawer caps it at 3), a targetActionId
// naming no step, NO targetActionId at all, two triggers on the same target, priority "999",
// sensitivity "telepathic", and an unverified customTriggerType — all 200, all stored. So the
// builder's uiControls are the only thing that has ever enforced them, and an engine-built flow
// gets no enforcement at all unless it happens here.
const SENSITIVITY = new Set(['low', 'medium', 'high']);
const MAX_CUSTOM_TRIGGERS = 3;

function checkFlowTriggers(triggers, ctx) {
  const list = triggers ?? [];
  const gotos = list.filter((t) => t.type === 'conv_ai_autonomous_trigger');
  if (!gotos.length) return;

  // "Conversation AI trigger is mandatory for adding custom trigger."
  if (!list.some((t) => t.type === 'conv_ai_trigger')) {
    throw new IRError('FLOW_TRIGGER',
      'FLOW_TRIGGER: a conv_ai_autonomous_trigger ("Custom trigger") requires a conv_ai_trigger on '
      + 'the same workflow — it does not start a flow, it jumps into one. The API accepts it '
      + 'without one; the builder does not.');
  }
  if (gotos.length > MAX_CUSTOM_TRIGGERS) {
    throw new IRError('FLOW_TRIGGER',
      `FLOW_TRIGGER: ${gotos.length} custom triggers, but the builder allows at most `
      + `${MAX_CUSTOM_TRIGGERS} ("Can't add more than 3 custom triggers"). The API accepts more — `
      + 'live-proven with 8 — and the drawer then refuses to work with them.');
  }
  const seen = new Set();
  for (const t of gotos) {
    const by = (f) => (t.filters ?? []).find((x) => (x.field ?? x.on) === f)?.value;
    const where = `'${t.name ?? t.type}'`;

    const prio = by('customTriggerPriority');
    if (prio !== undefined && !(Number(prio) >= 1 && Number(prio) <= 10)) {
      throw new IRError('FLOW_TRIGGER',
        `FLOW_TRIGGER: ${where} has customTriggerPriority '${prio}'. The drawer's stepper is 1-10; `
        + 'the API stored 999 without complaint. Priority decides which scenario wins when several '
        + 'match, so an out-of-range value is not harmless.');
    }
    const sens = by('customTriggerSensitivity');
    if (sens !== undefined && !SENSITIVITY.has(String(sens))) {
      throw new IRError('FLOW_TRIGGER',
        `FLOW_TRIGGER: ${where} has customTriggerSensitivity '${sens}'. Allowed: `
        + `${[...SENSITIVITY].join(' | ')} (stored lower-case). The API accepted 'telepathic'.`);
    }
    // Two triggers on one target is accepted by the API and is almost certainly an authoring
    // slip: the same jump described twice, with whichever priority wins deciding silently.
    const target = t.target ?? t.targetActionId;
    if (target) {
      if (seen.has(target)) {
        ctx?.warn?.(`FLOW_TRIGGER: ${where} targets the same step as an earlier custom trigger. `
          + 'Both persist; which one runs is decided by customTriggerPriority.');
      }
      seen.add(target);
    }
  }
}

// EXTERNAL REFS — the edit path compiles one node at a time against a LIVE document. Without
// this, every reference check inside that compile was a false positive by construction: the
// refMap was empty and `seen` held one ref, so a goto to a step on the canvas threw
// REF_DANGLING (F5-12). Live ids resolve to themselves; a UNIQUE live name resolves to its id;
// an authored ref always wins a collision with a live name.
function seedRefMap(norm, externalRefs) {
  const refMap = new Map();
  if (!externalRefs) return refMap;
  const authored = new Set(collectRefs(norm));
  for (const id of externalRefs.ids ?? []) if (!authored.has(id)) refMap.set(id, id);
  for (const [name, id] of externalRefs.byName ?? []) if (id && !authored.has(name) && !refMap.has(name)) refMap.set(name, id);
  return refMap;
}

export function compile(ir, ctx) {
  const norm = parseIR(ir, { externalRefs: ctx.externalRefs });
  checkMarketplaceFilters(norm.triggers, ctx);
  checkFlowTriggers(norm.triggers, ctx);
  // update_opportunity needs an associated opportunity at runtime — enforce the
  // invariant with the catalog-derived set of opportunity-attaching triggers.
  const oppTriggerTypes = new Set(
    ctx.catalog.allTriggers().filter((t) => ctx.catalog.trigger(t)?.category === 'opportunities'));
  checkOpportunityAssociation(norm, oppTriggerTypes);
  const refMap = seedRefMap(norm, ctx.externalRefs);
  // ─── Authored-vs-compiled assertion ────────────────────────────────────────────────
  // Round-trip verification only ever proved that what was SENT came back. It never
  // checked that what was AUTHORED was sent — so a dropped subtree reported a clean
  // build for a fraction of the IR ("steps: 8 | round-trip: 8 clean" for a 51-step IR,
  // live 2026-07-16). We diff the node objects the flattener actually reached against the
  // authored graph. Node identity, not refs: `ref` is optional, and a ref-less node must
  // be provable too. Counts are NOT expected to match — containers legitimately add
  // transition/None steps, so compiled >= authored is normal and fine.
  const visited = new Set();
  // TRIGGER REFS (F5-17). Trigger ids are server-minted on the POST, which happens AFTER the
  // auto-save that carries the graph — so an if_else routing on trigger identity had no id to
  // point at while the document was being written. Mint a placeholder per trigger here, let the
  // conditions resolve against it, and reconcile with the server's real ids after the POST loop
  // (orchestrate swaps and re-PUTs once).
  //
  // We deliberately do NOT send predeterminedId for every trigger. The builder's own
  // addPredeterminedIdIfRequired() (TriggerMain.ts:701-706) sets it ONLY for `inbound_webhook`
  // and resets it to '' otherwise, with the comment "make sure it's reset so we dont declare it
  // for all new triggers". Emitting it everywhere would be exactly the off-dialect guess this
  // engine exists to prevent.
  const triggerRefs = new Map();
  norm.triggers.forEach((t, i) => triggerRefs.set(t.ref ?? `__trigger_${i}`, ctx.idGen()));

  const { templates } = flattenGraph(norm.graph, { ...ctx, __visited: visited, __triggerRefs: triggerRefs }, refMap, null);

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

  // STEP_TYPE_UNKNOWN — fail closed on a type the catalog has never seen.
  //
  // LIVE-CAUGHT 2026-07-21 (GROM AU): `send_internal_notification` (the real slug is
  // `internal_notification`) compiled clean, built, round-tripped, and reported
  // warnings:[] — but the builder rendered a bare box with no action icon and its step
  // editor would NOT open. The catalog is complete (383 step types), so an unrecognised
  // type is an authoring error, not a gap. Silently shipping it produces exactly the
  // failure this engine exists to prevent: a workflow that saves and does nothing.
  //
  // Escape hatch, deliberately explicit: opts.allowUnknownStepTypes — for the documented
  // "harvest a live example and extend the catalog" path, where the author KNOWS the type
  // is real and the catalog is behind.
  if (!ctx.allowUnknownStepTypes) {
    // Marketplace steps are validated by marketplaceEntry() against the live
    // per-location index, not the offline native catalog — so this offline scan
    // must not also judge them, or every installed third-party app would 404 here.
    const unknown = [...new Set(templates
      .filter((t) => t.isMarketplaceAction !== true && !ctx.catalog.step(t.type))
      .map((t) => t.type))];
    if (unknown.length) {
      const known = ctx.catalog.allSteps();
      const near = (bad) => known.filter((k) => k.includes(bad) || bad.includes(k)).slice(0, 3);
      throw new Error(`STEP_TYPE_UNKNOWN: ${unknown.map((u) => {
        const suggestions = near(u);
        return `'${u}'${suggestions.length ? ` — did you mean ${suggestions.map((s) => `'${s}'`).join(' / ')}?` : ''}`;
      }).join('; ')}. These types are not in the catalog, so the builder will not recognise them: ` +
        `the step saves, renders without its action icon, and its editor will not open. ` +
        `Search the catalog (node scripts/query-catalog-cli.mjs <term>) for the real slug. ` +
        `If you have verified the type IS real and the catalog is behind, harvest an example ` +
        `and pass allowUnknownStepTypes to override this guard deliberately.`);
    }
  }

  // situational injection (catalog-gated); parent/sibling/nodeType already set structurally
  let stepIndex = 0;
  // Marketplace stepIndex is a SEPARATE, DELIBERATELY DIFFERENT rule from the premium
  // stepIndex just above — do not "unify" them.
  //   - premium stepIndex: a single GLOBAL running index over every template in the
  //     workflow, gated by the native catalog's `premium` flag.
  //   - marketplace stepIndex: a PER-ACTION-KEY, 1-based occurrence counter — the Nth
  //     time THIS key appears, not the Nth template overall. Two different marketplace
  //     keys interleaved must NOT share a counter (a wait_step between two
  //     send_outbound_whatsapp_message steps does not consume a WhatsApp slot).
  // Live-confirmed 2026-08-16 (Jing Spa): the one send_outbound_whatsapp_message step
  // carries stepIndex:1 and workflow.meta.stepIndexCounter reads
  // {send_outbound_whatsapp_message: 1} — same counter, recorded twice: running on the
  // step, final tally at workflow level. marketplaceStepIndexCounter below feeds both
  // t.stepIndex here AND autoSaveBody.meta.stepIndexCounter further down.
  const marketplaceStepIndexCounter = new Map();
  for (const t of templates) {
    const meta = ctx.catalog.step(t.type);
    if (meta && meta.situational?.includes('workflowsActionType') && !('workflowsActionType' in t))
      t.workflowsActionType = 'INTERNAL';
    // premium actions carry a top-level stepIndex (runtime sequence id). Which types
    // carry it is derived from the verified-live corpus (catalog `premium` flag):
    // custom_webhook, custom_code, ai_agent, chatgpt, google_sheets, the *_formatter
    // family, appointment_booking, find_or_create_contact, conversationai_objective.
    if (meta?.premium && !('stepIndex' in t)) t.stepIndex = stepIndex;
    // A marketplace type is never in the native catalog (meta is undefined above), so
    // the premium branch never fires for it — this is why marketplace needs its own
    // rule rather than reusing `meta?.premium`.
    if (t.isMarketplaceAction === true && !('stepIndex' in t)) {
      const next = (marketplaceStepIndexCounter.get(t.type) ?? 0) + 1;
      marketplaceStepIndexCounter.set(t.type, next);
      t.stepIndex = next;
    }
    stepIndex += 1;
  }

  const wid = ctx.idGen();
  const sessionId = ctx.idGen();
  const createdSteps = templates.map((t) => t.id);

  // WORKFLOW-LEVEL SETTINGS (settings.mjs): every key the Settings tab can write, validated —
  // an unknown key REFUSES (it used to be silently dropped). Defaults are the UI's own
  // (allowMultiple TRUE: SettingState + corpus 313/326). The create POST carries the same
  // values the UI's create body inherits from SettingState; the autosave carries them all.
  const S = normalizeSettings(norm.settings, ctx).body;
  const createBody = {
    name: norm.name, status: 'draft', parentId: null, updatedBy: ctx.uid,
    ...(norm.customObjectType ? { customObjectType: norm.customObjectType } : {}),
    modifiedSteps: [], deletedSteps: [], createdSteps: [], senderAddress: S.senderAddress,
    stopOnResponse: S.stopOnResponse, allowMultiple: S.allowMultiple, allowMultipleOpportunity: S.allowMultipleOpportunity,
    autoMarkAsRead: S.autoMarkAsRead, eventStartDate: S.eventStartDate, timezone: '',
    workflowData: { templates: [] }, triggersChanged: false,
    company_id: ctx.cid, company_age: ctx.companyAge,
  };

  const autoSaveBody = {
    _id: wid, id: wid, locationId: ctx.loc, companyId: ctx.cid, companyAge: ctx.companyAge,
    name: norm.name, status: 'draft', version: 1, dataVersion: 7, type: 'workflow', parentId: null,
    // A FLOW_BUILDER_BOT's flow workflow persists with workflowType:"agent" (live capture
    // recon-flow-workflow-full.json). Plain workflows omit it. type stays "workflow".
    ...(norm.workflowType ? { workflowType: norm.workflowType } : {}),
    // OBJECT-BASED workflow (G8): the create/save carry the schema key top-level
    // (utils/create-workflow-blank.ts; isObjectBasedWF tests startsWith('custom_objects.')).
    ...(norm.customObjectType ? { customObjectType: norm.customObjectType } : {}),
    permission: 380, permissionMeta: { canRead: true, canWrite: true },
    creationSource: 'builder', originType: 'user', isTriggerBucketMigrated: true, deleted: false,
    timezone: S.timezone,
    allowMultiple: S.allowMultiple,
    allowMultipleOpportunity: S.allowMultipleOpportunity,
    removeContactFromLastStep: S.removeContactFromLastStep,
    stopOnResponse: S.stopOnResponse,
    autoMarkAsRead: S.autoMarkAsRead,
    scheduledPauseDates: S.scheduledPauseDates, senderAddress: S.senderAddress,
    eventStartDate: S.eventStartDate, updatedBy: ctx.uid,
    // Settings-tab keys the engine never carried before 2026-08-22 (live-proven on the UI's
    // own Save PUT): the time window and the workflow note. null = the UI's "off"/"empty".
    window: S.window, workflowNote: S.workflowNote,
    triggersChanged: false, isAutoSave: true,
    autoSaveSession: { workflowId: wid, id: sessionId, userId: ctx.uid, version: 1 },
    createdSteps, modifiedSteps: [], deletedSteps: [],
    // NOTE: this shares the `templates` array by reference (not stripped yet). Every pass
    // below (applyUiDefaults, enforceTemplates, ...) mutates the array's OBJECTS in place and
    // relies on this being the same array it is looking at — stripping here would replace
    // terminal steps with new objects the later passes never touch, so their defaults/
    // enforcement would silently vanish from what actually ships. The null-terminal strip
    // happens once, at the very end, right before `templates` stops changing. See below.
    workflowData: { templates },
    // Only present when the workflow actually HAS marketplace steps — a native-only
    // build must emit exactly the autoSaveBody it emitted before this fix, with no new
    // `meta` key (existing native-output test asserts this). See marketplaceStepIndexCounter
    // above for what this map records and why it's per-key.
    ...(marketplaceStepIndexCounter.size > 0 || S.statsView
      ? { meta: { ...(marketplaceStepIndexCounter.size > 0 ? { stepIndexCounter: Object.fromEntries(marketplaceStepIndexCounter) } : {}), ...(S.statsView ? { statsView: true } : {}) } }
      : {}),
  };

  const triggerBodies = norm.triggers.map((t, i) => {
    const body = buildTrigger(t, ctx, wid, refMap);
    const placeholder = triggerRefs.get(t.ref ?? `__trigger_${i}`);
    return {
      ...body,
      // `_placeholderId` is ENGINE-ONLY (stripped before the wire by orchestrate) — it is how the
      // POST result is matched back to the id the document already points at.
      _placeholderId: placeholder,
      // inbound_webhook is the one type the builder itself predetermines, so the receiving URL can
      // be shown before save. Matching it exactly means the id we routed on IS the id GHL keeps.
      ...(t.type === 'inbound_webhook' ? { predeterminedId: placeholder } : {}),
    };
  });
  // authored/compiled travel with the payload so the caller can report
  // `authored N → compiled M → round-tripped M` instead of a bare step count.
  // Enforcement chokepoint: every emitted node, whatever path built it (linear, wait containers,
  // edit-inserted subgraphs via compileSubgraph → this same compile). A fired THROW rule refuses
  // the build BEFORE anything reaches GHL — the acceptance criterion is that a build which passes
  // opens in the builder with zero errors, and one which would not never gets written.
  // UI defaults + constructor-forced fields FIRST, so enforcement sees the same initialized
  // shape the UI's validators see (ui-defaults.mjs; corpus-verified keys only)
  applyUiDefaults(templates, ctx?.catalog, ctx);
  // A goto that closes a cycle gets the WORKFLOW stamped loopIdentified by GHL's backend and
  // demoted to draft — for a published client flow that means it silently stops running. Refuse
  // it at author time rather than shipping a workflow the platform will lock. See goto-loops.mjs.
  const loops = gotoLoops(templates);
  if (loops.length) {
    throw new IRError('GOTO_LOOP',
      `GOTO_LOOP: ${loops.length} goto step(s) jump BACKWARD to a step that can reach them again: `
      + loops.map((l) => `'${l.name ?? l.id}' -> '${l.targetName ?? l.target}'`).join('; ')
      + '. GHL detects the cycle server-side, marks the node "Loop Locked", stamps the workflow '
      + 'loopIdentified and forces its status to draft — a published workflow silently stops. '
      + 'Loops are not a legal flow shape here: restructure so the goto points forward, or use '
      + 'the dedicated `loop` step type, which is a supported container with its own body.');
  }
  // custom_code needs a SERVER test run before the builder accepts it: the drawer's Save requires
  // attributes.output to be the non-empty object returned by POST /custom-code/run-test, and editing
  // the code voids it (custom-code-components, recovered 2026-08-22). The engine can't run the test
  // offline, so an authored custom_code without a real output ships a step the builder will flag.
  if (typeof ctx?.warn === 'function') {
    for (const t of templates) {
      if (t?.type !== 'custom_code') continue;
      const out = t.attributes?.output;
      if (!out || typeof out !== 'object' || Array.isArray(out) || !Object.keys(out).length)
        ctx.warn(`custom_code '${t.name ?? t.id}': attributes.output is ${out === undefined ? 'missing' : 'empty'} — the builder requires a successful "Run test" (POST /custom-code/run-test) and will show an error on this step until one is run in the UI`);
    }
  }
  // if/else conditions against the picker's vocabulary (ifelse-vocab.mjs) — GHL has NO validator
  // for if/else; a wrong subtype/operator saves clean and matches wrongly at runtime
  checkIfElseVocab(templates, ctx?.catalog, ctx);
  // merge tags: unknown key in a CLOSED namespace / unbalanced braces → advisory (merge-tags.mjs)
  checkMergeTags(templates, ctx?.catalog, ctx);
  // step-output references ({{custom_webhook.N.*}}, {{chatgpt.N.*}}, …): does the producer exist,
  // and is a referenced webhook actually saving its response? (step-outputs.mjs; advisory)
  checkStepOutputRefs(templates, ctx);
  // GoGHL interactive-message syntax (#btn/#list) + spintax — a malformed line sends as
  // literal text to the contact (goghl.mjs; advisory, hatch skipGoghlCheck)
  checkGoghlSyntax(templates, ctx);
  // inbound-webhook references ({{inboundWebhookRequest.*}}) against a SAMPLE payload when the
  // author supplies one (ctx.sampleWebhookPayload or ir.sampleWebhookPayload) — the pinned
  // reference's leaf paths are the only vocabulary at runtime (webhook-rail.mjs; advisory,
  // hatch skipWebhookCheck). Live-proven rail 2026-08-22.
  checkWebhookRefs(templates, ctx?.sampleWebhookPayload ?? norm?.sampleWebhookPayload ?? ir?.sampleWebhookPayload, ctx);
  // OBJECT-BASED workflows: the picker offers ONLY these actions (utils/workflows.ts
  // objectBasedInternalActionMap + objectBasedCrossEntityActionMap, recovered 2026-08-22) —
  // anything else is un-producible in the UI and unproven at runtime for object records.
  if (norm.customObjectType && ctx?.skipObjectRules !== true) {
    const OBJECT_ALLOWED = new Set(['if_else', 'email', 'wait', 'update_custom_value', 'goto',
      'datetime_formatter', 'number_formatter', 'text_formatter', 'math_operation', 'custom_code',
      'add_to_workflow', 'remove_from_workflow', 'remove_from_all_workflows', 'array_functions',
      'drip', 'add_notes', 'transition']);
    const bad = templates.filter((t) => !OBJECT_ALLOWED.has(t.type));
    if (bad.length)
      throw new IRError('OBJECT_STEP',
        `OBJECT_STEP: ${bad.length} step(s) not available in an object-based workflow (customObjectType ${norm.customObjectType}): `
        + bad.map((t) => `'${t.name ?? t.id}' (${t.type})`).join(', ')
        + `. The builder's picker offers only: ${[...OBJECT_ALLOWED].filter((x) => x !== 'transition').join(', ')}. `
        + `Remove them, target a contact workflow instead, or pass skipObjectRules: true.`);
    for (const tb of []) void tb;
  }
  enforceTemplates(templates, ctx?.catalog, ctx);
  // Same chokepoint, third class: every intra-workflow step reference must resolve. The goto
  // emit above already throws with the authored ref name; this sweep catches every OTHER path
  // (wait reply/emailEventSteps/appointmentSpecificStep, workflow_goal ids, edit-composed graphs).
  checkStepRefs(templates, IRError, [...(ctx.externalRefs?.ids ?? [])]);

  // Terminals ship with no `next` key. The graph keeps `next: null` internally because the
  // flattener and every edit op above read it as "end of chain"; it is stripped here, once,
  // at the boundary where the body is assembled — after every mutation pass, so nothing
  // written above is lost, and before anything reads `autoSaveBody` for the wire.
  // See terminals.mjs for the live A/B.
  //
  // `_templates` keeps the UNSTRIPPED graph available for internal reuse: compileSubgraph
  // (edit-driver.mjs) calls compile() to build the subgraph it splices into an edit, and reads
  // this instead of `autoSaveBody.workflowData.templates` so every node it inherits keeps the
  // SAME `next: null` convention the rest of the edit graph uses. This is NOT because any
  // splice/re-scope logic reads `next: null` as a sentinel — rootTail, scopeChain, inboundOf
  // and branchTargets are all absent-safe (`typeof x.next === 'string'` / `x.next == null`
  // checks) — it is so a node compileSubgraph hands to the edit graph looks like every other
  // node already in it, rather than an inconsistent shape depending on where it came from.
  //
  // HAZARD (latent, not exercised today): stripNullNext returns the SAME object reference for
  // a non-terminal step and a FRESH object for a terminal one, so `_templates` and
  // `autoSaveBody.workflowData.templates` are a PARTIAL alias, not two independent copies. A
  // mutation applied to a step object reached via `_templates` after this point lands on both
  // arrays for a non-terminal step and on only `_templates`' copy for a terminal one.
  // orchestrate.mjs:418 does exactly this kind of post-compile `t2.attributes = {...}`
  // mutation, but over `[autoSaveBody.workflowData.templates, createBody.workflowData.templates]`
  // — `_templates` is not in that list, so nothing reads or mutates through it today. If a
  // future caller adds it to a similar sweep, a terminal step's mutation could silently miss
  // the copy that reaches the wire.
  const _templates = templates;
  autoSaveBody.workflowData.templates = stripNullNext(templates);

  const result = { createBody, autoSaveBody, triggerBodies, _wid: wid, _templates, _refMap: refMap, _triggerRefs: triggerRefs, authored, compiled: templates.length };
  casingLint(result);
  return result;
}
