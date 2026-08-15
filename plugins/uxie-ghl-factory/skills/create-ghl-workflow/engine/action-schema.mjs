// GHL's OWN action schema — the rulebook the workflow builder itself reads.
//
// WHAT THIS IS
// ------------
// `GET /workflows-marketplace/location/{loc}/assets?workflowTypes=default,contacts`
// returns ~3 MB describing every action GHL can build: 46 apps -> 307 actions (1,224
// individual fields) plus 147 triggers. For each field it states the real key, the human
// LABEL, whether it is REQUIRED, GHL's own DEFAULT, the field type, and its validation
// rules. For each action it also states how it executes, which triggers it requires, and
// whether it is premium.
//
// WHY IT MATTERS
// --------------
// The builder's "Resolve N Errors" banner is computed IN THE BROWSER from exactly this
// schema — no endpoint returns that error list (POST /workflow/{loc}/validate-assets is
// NOT it: it checks that referenced assets still exist and returns {errors:[],warnings:[]}
// even for a step missing a required field — verified live against a workflow whose builder
// showed "Resolve 1 Errors"). So the only way to know before you build is to apply the
// schema yourself, which is what this module does.
//
// Live-proven 2026-07-27 on AU: reproducing the check over this schema reproduced the
// builder's list EXACTLY — same count, same step, same stepId, same message string, because
// the message is built from the field's own `title`.
//
// 🔴 COVERAGE BOUNDARY — READ BEFORE RELYING ON THIS
// --------------------------------------------------
// This endpoint is the MARKETPLACE catalog. It carries 307 action types out of the engine's
// 383 known step types (~80%) — but it does NOT contain the core native actions, which are
// the ones most workflows are actually built from:
//
//     add_contact_tag  send_email  sms  if_else  wait  goto  custom_webhook
//     custom_code  find_contact  create_opportunity  update_opportunity
//     internal_notification  workflow_split                     ← none of these are here
//
// Those come from the OG/bundle registry instead, which is what catalog.data.json already
// carries for them. So this schema is authoritative WHERE IT APPLIES and silent elsewhere —
// `checkWorkflow` deliberately skips unknown types rather than guessing, because a step
// being absent here means "not described by this source", NOT "has no required fields".
//
// Practical consequence: this is a strong ADDITION to the existing checks, not a
// replacement for them. Anything asserting "we now validate everything" is wrong.
//
// RELATIONSHIP TO required-fields.mjs
// -----------------------------------
// That file is a hand-attested map covering 9 conversationai_* types, written before this
// schema was discovered. It stays as the OFFLINE fallback: compile() must remain
// deterministic and network-free (unit tests, dry runs), so it cannot depend on a fetch.
// When a live schema IS available the orchestrator passes it in and it takes precedence —
// covering all 273 actions that declare a required field rather than the hand-mapped 9.
import { requiredKeysFor, isSupplied } from './required-fields.mjs';

// `DYNAMIC` is a UI-only pseudo-field present in 72 field definitions across the catalog.
// It never corresponds to a stored attribute key, so treating it as required invents
// phantom errors on nodes the builder considers clean.
const PSEUDO_FIELDS = new Set(['DYNAMIC']);

// The builder rejects empty as well as absent — an empty `description` on an ai_splitter is
// exactly as broken as a missing one. Mirrors required-fields.mjs's non-empty rule.
function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Field defaults arrive as STRINGS regardless of type (`value: "true"` on a checkbox), so
// coerce by the declared fieldType rather than trusting the literal. Exported so callers
// outside this module (e.g. compiler.mjs's marketplace path) reuse the same coercion
// instead of duplicating it.
export function coerceDefault(raw, fieldType) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (fieldType === 'checkbox' || fieldType === 'toggle') {
    if (raw === true || raw === false) return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }
  if (fieldType === 'numerical') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return raw;
}

// Flatten the app-grouped payload into type -> spec. The response nests actions under
// `actions[].actions[]` (apps, then their actions), which is easy to miss.
//
// Also parses `assets.triggers` into the SAME map, so a trigger's type resolves through
// one lookup alongside actions (marketplaceDrift below needs this). Trigger entries carry
// `kind: 'trigger'` and empty `fields`/`requiredFields` — a workflow STEP's `type` never
// resolves to a trigger entry in practice, but `kind` lets callers exclude trigger entries
// from step-shaped counts (e.g. check_workflow's `coverage.stepsDescribed`) defensively,
// in case a step type and a trigger key ever collide.
export function parseActionSchema(assets) {
  const byType = new Map();
  for (const app of assets?.actions ?? []) {
    for (const action of app?.actions ?? []) {
      if (!action?.key || !Array.isArray(action.inputs)) continue;
      const fields = action.inputs
        .filter((f) => f?.field && !PSEUDO_FIELDS.has(f.field))
        .map((f) => ({
          field: f.field,
          title: f.title ?? f.field,
          required: f.required === true,
          fieldType: f.fieldType,
          default: coerceDefault(f.value, f.fieldType),
        }));
      byType.set(action.key, {
        type: action.key,
        app: app.appName,
        section: action.section,
        version: action.version,
        templateId: action.templateId,
        fields,
        requiredFields: fields.filter((f) => f.required).map((f) => f.field),
        requiredTriggers: action.requiredTriggers ?? [],
        isPremium: action.additionalConfig?.isPremium === true,
        isMultipath: action.branchesConfig != null,
      });
    }
  }
  for (const app of assets?.triggers ?? []) {
    for (const trigger of app?.triggers ?? []) {
      if (!trigger?.key) continue;
      byType.set(trigger.key, {
        type: trigger.key,
        app: app.appName,
        version: trigger.version,
        templateId: trigger.templateId,
        fields: [],
        requiredFields: [],
        requiredTriggers: [],
        isPremium: false,
        isMultipath: false,
        kind: 'trigger',
      });
    }
  }
  return byType;
}

// Marketplace apps version independently of us. A workflow stores whatever version was
// current when it was built; the installed app moves on. This compares the two — but
// TRIGGER-ONLY, by evidence, not by choice.
//
// 🔴 SCOPE: a stored marketplace TRIGGER carries `version` and `templateId`
// (live-captured, JING SPA account, 2026-08-16). A stored marketplace ACTION step does
// NOT — its complete key set is `id, stepIndex, order, attributes, name, type,
// isMarketplaceAction`. No version anywhere, not at step level, not inside `attributes`.
// There is nothing stored to compare an action against, so there is nothing to detect.
// This function only ever looks at `masterType === 'marketplace'`, a field that exists on
// stored triggers and does not exist on stored action steps at all — so an action object
// passed in here is excluded by construction, not by an incidental filter that could later
// be loosened by mistake.
//
// Reported SEPARATELY from checkWorkflow's error list, never folded into errorCount: that
// headline is a live-proven exact reproduction of the builder's own panel, and mixing our
// own findings into it would destroy the property that makes it trustworthy.
export function marketplaceDrift(storedTriggers, schema) {
  const out = [];
  for (const t of storedTriggers ?? []) {
    if (t?.masterType !== 'marketplace') continue;
    const spec = schema?.get?.(t.type);
    if (!spec) continue;
    if (t.templateId && spec.templateId && t.templateId !== spec.templateId) {
      out.push({ type: t.type, name: t.name, kind: 'templateId',
        stored: { version: t.version, templateId: t.templateId },
        installed: { version: spec.version, templateId: spec.templateId } });
      continue;
    }
    if (t.version && spec.version && t.version !== spec.version) {
      out.push({ type: t.type, name: t.name, kind: 'version',
        stored: { version: t.version, templateId: t.templateId },
        installed: { version: spec.version, templateId: spec.templateId } });
    }
  }
  return out;
}

// Which required fields a single step is missing, phrased the way the builder phrases it.
export function missingForStep(step, schema) {
  const spec = schema?.get?.(step?.type);
  if (!spec) return [];
  return spec.fields
    .filter((f) => f.required && isBlank((step.attributes ?? {})[f.field]))
    .map((f) => ({
      field: f.field,
      title: f.title,
      message: `"${f.title}" is a required field`,
    }));
}

// Reproduce the builder's error list for a whole workflow. Returns the same shape the
// builder's panel renders: one entry per offending step, with its id and messages.
//
// `triggerTypes` enables the second check the schema supports: 11 actions declare
// `requiredTriggers`, i.e. they cannot run unless the workflow is entered by one of those
// triggers. Pass the workflow's trigger types to enable it; omit to skip.
export function checkWorkflow(templates, schema, { triggerTypes } = {}) {
  const errors = [];
  for (const step of templates ?? []) {
    const missing = missingForStep(step, schema);
    if (missing.length) {
      errors.push({ stepId: step.id, step: step.name, type: step.type, messages: missing.map((m) => m.message), fields: missing.map((m) => m.field) });
    }
    if (triggerTypes) {
      const need = schema?.get?.(step.type)?.requiredTriggers ?? [];
      if (need.length && !need.some((t) => triggerTypes.includes(t))) {
        errors.push({ stepId: step.id, step: step.name, type: step.type,
          messages: [`'${step.type}' requires one of these triggers: ${need.join(', ')} — this workflow has [${triggerTypes.join(', ') || 'none'}]`],
          fields: [] });
      }
    }
  }
  return errors;
}

// Defaults GHL itself would fill for a type, for the fields the author left out. Only
// returns values the schema actually declares — never invents one.
export function defaultsFor(type, schema, attrs = {}) {
  const spec = schema?.get?.(type);
  if (!spec) return {};
  const out = {};
  for (const f of spec.fields) {
    if (f.default === undefined) continue;
    if (!isBlank(attrs[f.field])) continue;
    out[f.field] = f.default;
  }
  return out;
}

// The offline path. Uses the hand-attested map so a network-free compile still catches the
// conversationai_* family; returns the same shape as checkWorkflow so callers do not branch.
export function checkWorkflowOffline(templates) {
  const errors = [];
  for (const step of templates ?? []) {
    const missing = requiredKeysFor(step?.type).filter((k) => !isSupplied(step.type, k, step.attributes ?? {}));
    if (missing.length) errors.push({ stepId: step.id, step: step.name, type: step.type, messages: missing.map((k) => `'${k}' is a required field`), fields: missing });
  }
  return errors;
}

// Fetch + parse in one step. `call` is the orchestrator's gateway function so throttling,
// auth and scrubbing are inherited. Returns null (never throws) when the schema cannot be
// fetched — callers fall back to the offline map, because a build must not fail just
// because this optional enrichment was unavailable.
export async function fetchActionSchema(call, loc) {
  try {
    const r = await call('GET', `/workflows-marketplace/location/${loc}/assets?workflowTypes=default,contacts`);
    if (!r?.ok || !r.json) return null;
    const schema = parseActionSchema(r.json);
    return schema.size ? schema : null;
  } catch {
    return null;
  }
}
