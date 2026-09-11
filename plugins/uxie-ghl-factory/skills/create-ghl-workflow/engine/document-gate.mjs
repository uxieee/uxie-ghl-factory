// THE WORKFLOW VALIDATION GATE — what every write path runs over the bytes it is about to send.
//
// Two oracles, because neither is enough alone:
//
//   ENGINE (offline, this file)  catches what GHL's server lets through. Measured 2026-09-11: the
//                                server answers valid:true on an invented attribute key, a wrong inner
//                                attributes.type, an extra top-level step key, a number out of range,
//                                and a corrupted step type on an AGENT flow.
//   SERVER (live-validate.mjs)   catches what the engine cannot know: assets that do not exist in the
//                                account, enum values, and GHL's own structural and field rules.
//
// Before this, some guards were attached to PATHS, not to the DOCUMENT: the unknown-attribute-key
// guard (checkAttrKeys) and the inner-type rule ran only inside the compiler, so an edit or a repair
// never met them, and modifyStep merges attributes "as given" for seventeen types. The edit path DID
// already refuse dangling step references and parentKeys and run GHL's own field guards on touched
// steps; the gate reports those too and yields to their hatches. It checks the final document,
// whatever produced it.
//
// Every allowlist here was CALIBRATED against 2,602 stored, working steps on two accounts before it
// was allowed to block (observed-step-keys.mjs). The type cards' attrKeys alone would have refused
// every stored if_else; an allowlist from the engine-built account alone would have refused every
// advanced-canvas workflow a human made.
import { loadCatalog } from './catalog.mjs';
import { INNER_ATTRIBUTE_TYPE, requiredKeysFor, isSupplied } from './required-fields.mjs';
import { fires } from './enforce.mjs';
import { checkStepRefs } from './graph-refs.mjs';
import { danglingParentKeys } from './edit.mjs';
import { checkFieldCaps, describeCap } from './field-caps.mjs';
import { ENGINE_ATTR_KEYS } from './compiler.mjs';
import { OBSERVED_TOP_LEVEL_KEYS, OBSERVED_ATTRIBUTE_KEYS, OBSERVED_INNER_TYPES } from './observed-step-keys.mjs';
import { liveValidate } from './live-validate.mjs';

export const STEP_TOP_LEVEL_KEYS = new Set(OBSERVED_TOP_LEVEL_KEYS);

// Keys a type carries only in one state, so a census can miss them. Each is grounded in the file
// that already handles it: conversationai_objective gains closingMessage (required) and tags the
// moment proceedIfNotMet is true (required-fields.mjs, the asset's conditional fields).
const CONDITIONAL_ATTR_KEYS = { conversationai_objective: ['closingMessage', 'tags'] };

/** Every attribute key this type is known to carry, from every evidence source there is. */
export function knownAttributeKeys(type, card) {
  const model = (card?.modelFields?.fields ?? []).map((f) => f?.name).filter(Boolean);
  return new Set([
    ...(card?.attrKeys ?? []),
    ...(card?.requiredFields ?? []).map((k) => String(k).split(/[.[]/)[0]),
    ...model,
    ...(OBSERVED_ATTRIBUTE_KEYS[type] ?? []),
    ...(CONDITIONAL_ATTR_KEYS[type] ?? []),
    ...ENGINE_ATTR_KEYS,
  ]);
}

const finding = (check, severity, t, message) => ({
  check, severity, stepId: t?.id ?? null, stepName: t?.name ?? null, type: t?.type ?? null, message,
});

/**
 * The ENGINE oracle over a document's steps. No I/O.
 *
 * @param templates the steps about to be written
 * @param opts.catalog          loadCatalog() by default
 * @param opts.marketplaceTypes Set of marketplace action keys for this location, when known. An
 *   unknown type is only an ERROR once marketplace has been ruled out; without the set it is a
 *   warning, because a marketplace app step is legitimately absent from the native catalogue.
 * @param opts.scope Set of step ids this write changed. Findings on steps OUTSIDE it are reported
 *   as warnings: a pre-existing defect on a step nobody touched must not block an unrelated edit.
 * @returns {errors, warnings, checked}
 */
export function gateDocument(templates = [], { catalog = loadCatalog(), marketplaceTypes = null, scope = null, waive = null } = {}) {
  const out = [];
  for (const t of templates) {
    if (!t || typeof t !== 'object') continue;
    for (const k of Object.keys(t)) {
      if (!STEP_TOP_LEVEL_KEYS.has(k)) out.push(finding('TOP_LEVEL_KEY', 'error', t,
        `unknown top-level step key '${k}' — no stored step on either calibration account carries it`));
    }
    const card = catalog.step(t.type);
    if (t.isMarketplaceAction === true) continue;
    if (!card) {
      if (marketplaceTypes?.has(t.type)) {
        out.push(finding('MARKETPLACE_FLAG', 'warning', t,
          `'${t.type}' is a marketplace action stored without isMarketplaceAction:true — the rail's complete step shape carries it`));
      } else {
        out.push(finding('STEP_TYPE', marketplaceTypes ? 'error' : 'warning', t,
          `'${t.type}' is not a known step type${marketplaceTypes ? ', native or marketplace' : ' (marketplace types were not available to rule it out)'}. `
          + 'GHL does NOT catch this on an agent flow.'));
      }
      continue;
    }
    const attrs = t.attributes ?? {};
    // attributes.type: the explicit map where the inner spelling differs from the row type, else every
    // value a stored step of this type was seen carrying (plus the source model's union members). A
    // type never observed is not judged — absence of evidence is not a rule.
    const innerAllowed = INNER_ATTRIBUTE_TYPE[t.type]
      ? new Set([INNER_ATTRIBUTE_TYPE[t.type]])
      : (OBSERVED_INNER_TYPES[t.type]
        ? new Set([...OBSERVED_INNER_TYPES[t.type], ...((card.modelFields?.fields ?? []).find((f) => f?.name === 'type')?.members ?? [])])
        : null);
    if (innerAllowed && 'type' in attrs && !innerAllowed.has(attrs.type)) out.push(finding('INNER_TYPE', 'error', t,
      `attributes.type is ${JSON.stringify(attrs.type)}; '${t.type}' stores ${[...innerAllowed].map((v) => `'${v}'`).join(' or ')}. `
      + 'It saves, publishes and round-trips clean, and the builder\'s drawer then cannot bind it. GHL does not catch this.'));
    const known = knownAttributeKeys(t.type, card);
    const bad = Object.keys(attrs).filter((k) => !known.has(k));
    if (bad.length) out.push(finding('ATTRIBUTE_KEY', card.confidence === 'verified-live' ? 'error' : 'warning', t,
      `unknown attribute key(s) [${bad.join(', ')}] — an invented key saves but moves nothing. GHL does not catch this.`));
    const missing = requiredKeysFor(t.type).filter((k) => !isSupplied(t.type, k, attrs));
    if (missing.length) out.push(finding('REQUIRED', 'error', t, `missing required field(s): ${missing.join(', ')}`));
    for (const r of card.enforcement?.throw ?? []) {
      if (fires(r, attrs)) out.push(finding('ENFORCEMENT', 'error', t, `GHL's own guard fires: ${r.field ?? ''} ${r.guard ?? ''}`.trim()));
    }
  }
  for (const f of checkFieldCaps(templates)) {
    out.push({ check: 'FIELD_CAP', severity: 'error', stepId: f.stepId ?? null, stepName: f.step ?? f.stepName ?? null, type: f.type ?? null, message: describeCap(f) });
  }
  for (const d of danglingParentKeys(templates)) {
    out.push({ check: 'PARENT_KEY', severity: 'error', stepId: d.id, stepName: d.name, type: null, message: `parentKey points at '${d.parentKey}', which is not a step in this workflow` });
  }
  try { checkStepRefs(templates); } catch (e) {
    out.push({ check: 'STEP_REF', severity: 'error', stepId: null, stepName: null, type: null, message: String(e.message).split('\n').slice(0, 4).join(' ') });
  }
  // Outside the write's scope, a finding is REPORTED, never blocking.
  for (const f of out) if (scope && f.stepId && !scope.has(f.stepId) && f.severity === 'error') f.severity = 'warning';
  // A check the caller has ALREADY acknowledged with its own, more specific hatch (allowOverCap,
  // allowDanglingStepRefs, allowDanglingParentKeys) is reported, not re-refused. Without this the
  // gate overrode deliberate decisions its callers had made one argument earlier.
  for (const f of out) {
    if (waive?.has(f.check) && f.severity === 'error') { f.severity = 'warning'; f.message += ' (acknowledged by the caller\'s own hatch)'; }
  }
  return {
    errors: out.filter((f) => f.severity === 'error'),
    warnings: out.filter((f) => f.severity !== 'error'),
    checked: templates.length,
  };
}

const findingKey = (f) => `${f.ruleId ?? ''}|${f.where ?? ''}|${f.message ?? ''}`;

/**
 * Both oracles, one verdict. The server half needs a workflow id, so a build runs it against the
 * freshly created empty draft with the compiled steps swapped in — before a single step is written.
 *
 * @param opts.baseline a server verdict for the document AS STORED. When given (edit, repair), only
 *   server findings the write INTRODUCES block: a flow bot mid-build or a pre-existing defect on an
 *   untouched step must not freeze every later edit. Build and publish pass none, so every finding blocks.
 * @param opts.allow the caller's hatch. Findings are still reported in full.
 */
export async function runValidationGate({ call, loc, wid, document, templates, triggers, catalog, marketplaceTypes, scope, waive = null, baseline = null, allow = false } = {}) {
  const steps = templates ?? document?.workflowData?.templates ?? [];
  const engine = gateDocument(steps, { catalog, marketplaceTypes, scope, waive });
  const server = call && wid ? await liveValidate(call, loc, wid, { document, templates, triggers }) : { ran: false, why: 'no workflow id to validate against' };
  let serverBlocking = [];
  if (server.ran && server.valid === false) {
    const before = new Set((baseline?.ran && baseline.valid === false ? baseline.findings : []).map(findingKey));
    serverBlocking = server.findings.filter((f) => f.severity !== 'warning' && !before.has(findingKey(f)));
  }
  const blocked = !allow && (engine.errors.length > 0 || serverBlocking.length > 0);
  const lines = [
    ...engine.errors.map((f) => `ENGINE ${f.check}: '${f.stepName ?? f.stepId ?? '?'}' (${f.type ?? '?'}): ${f.message}`),
    ...serverBlocking.map((f) => `GHL ${server.layer ?? ''}: ${f.where}: ${f.message}${f.ruleId ? ` [${f.ruleId}]` : ''}`),
  ];
  return { blocked, engine, server, serverBlocking, preExisting: server.ran && baseline ? (server.findings?.length ?? 0) - serverBlocking.length : 0, summary: lines.join('\n') };
}
