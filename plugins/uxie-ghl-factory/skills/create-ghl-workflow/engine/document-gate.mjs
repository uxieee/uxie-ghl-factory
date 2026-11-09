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
import { TYPES_OUTSIDE_CATALOG } from './ir.mjs';
import { OBSERVED_TOP_LEVEL_KEYS, OBSERVED_ATTRIBUTE_KEYS, OBSERVED_INNER_TYPES } from './observed-step-keys.mjs';

// The builder's own step type, models/Workflow.ts `WorkflowTemplateBase` (09-29 capture, lines 805-850): every key a
// builder-saved step may carry at its root. The 09-11 census alone refused real builder keys — `parentContainerId` on
// every loop-body step, `integrationAccountId` / `testRequest` / `testResponse` on every account-bound INTEGRATION_AI
// step — so publish_workflow refused those whole workflows (completeness sweep 2026-09-29 §3 #3). A drift test compares
// this list with the newest capture when one sits beside the checkout.
export const BUILDER_TEMPLATE_KEYS = Object.freeze(['id', 'stepIndex', 'type', 'customVarPrefix', 'name', 'window', 'start_after',
  'attributes', 'next', 'parent', 'sibling', 'order', 'cat', 'comments', 'nodeType', 'position', 'isMarketplaceAction', 'version',
  'workflowsActionType', 'integrationAccountId', 'parentKey', 'parentContainerId', 'currentStepEnd', 'hasErrors', 'errorMessage',
  'advanceCanvasMeta', 'testRequest', 'testResponse',
  // 2026-11-06 capture (utils/iatf-action-flags.ts): a marketplace action whose author allows {{contact.*}} in company /
  // custom-object workflows carries `allowContactValuesInNonContactWorkflows: true` on the step (true or absent, never false).
  'allowContactValuesInNonContactWorkflows']);
export const STEP_TOP_LEVEL_KEYS = new Set([...OBSERVED_TOP_LEVEL_KEYS, ...BUILDER_TEMPLATE_KEYS]);

// Keys a type carries only in one state, so a census can miss them. Each is grounded in the file
// that already handles it: conversationai_objective gains closingMessage (required) and tags the
// moment proceedIfNotMet is true (required-fields.mjs, the asset's conditional fields).
// workflow_ai_generate_image: the drawer's run-time reference images live in `__dynamicAttachments__`
// ({referenceImages:[{content, filename, attachmentMode:'url'}]}), outside the IGenerateImageAI model. Live
// 2026-09-28 a step whose only reference was `{{workflow_ai_generate_image.1.image_url}}` redrew that image
// (knowledge sniffs/workflows-wave1-2026-09-25/live-3Q-generate-image.json), so the key moves the output.
// Step types whose attribute interface the model-shapes extractor leaves UNMAPPED (it cannot pair the type with its
// interface), so the card carries no model fields and the gate called the drawer's own keys unknown. Each entry is the
// interface's keys verbatim; a drift test re-reads the interface from the newest capture.
//   send_to_eliza — models/actions/SendToEliza.ts `ISendToEliza` {sendToSpecificUser, userId?}
export const MODEL_KEYS_UNMAPPED_BY_EXTRACTOR = { send_to_eliza: ['sendToSpecificUser', 'userId'] };

// loop.exitNext: the builder persists the step that runs after the loop — "the one fact that cannot be recovered from
// the tree" (utils/loop.helper.ts:571-596, use-latest-node-saved.ts:935). Absent from the census only because no
// census workflow had a loop.
// bl-919 (w9-w5), from SOURCE: the builder writes and reads these router keys (utils/router.ts:634 writes routerBranch on each
// branch; models/conditions/Router.ts:122-170 reads and writes routerName; the root carries version and branches). Not invented.
const CONDITIONAL_ATTR_KEYS = { router: ['routerName', 'version', 'branches', 'routerBranch'], conversationai_objective: ['closingMessage', 'tags'], workflow_ai_generate_image: ['__dynamicAttachments__'], loop: ['exitNext'],
  ...MODEL_KEYS_UNMAPPED_BY_EXTRACTOR };

// Keys GHL's SERVER writes onto a step when the document is saved. The author never sends them and
// the builder's front-end source does not contain them, so no model, card or asset lists them — and
// a census taken before the server started writing one cannot have seen it either. Without this the
// gate refuses to PUBLISH a workflow this engine built a minute earlier, calling the server's own
// stamp "an invented key". Found the first time a drip workflow was published through this path
// (live 2026-09-19: sent {batchSize, interval, type}; read back with `configuredAt` added — a key
// absent from all 3,803 steps of the 2026-09-12 census, so GHL began writing it after that).
const SERVER_WRITTEN_ATTR_KEYS = { drip: ['configuredAt'] };

// Step types that only exist as a branching CONTAINER. A linear one (scalar `next`, no transitions)
// saves, validates clean on GHL's server, publishes — and cannot branch at runtime. Calibrated on the
// harvest (2026-09-23): 55 of 55 stored steps of these types carry an array `next` of transition
// children and `cat:'multi-path'`; not one is linear. `convertToMultipath:true` is on every one
// except workflow_split, which never carries it. The multipath WAIT is deliberately absent: it is
// a hybrid that is legitimately linear when its timeout is off.
export const MULTIPATH_TYPES = new Map([
  ['find_opportunity', { convertFlag: true }], ['find_contact', { convertFlag: true }],
  ['lc_merge_contact', { convertFlag: true }], ['workflow_ai_decision_maker', { convertFlag: true }],
  ['conversationai_ai_splitter', { convertFlag: true }], ['conversationai_book_appointment', { convertFlag: true }],
  ['conversationai_services_booking', { convertFlag: true }], ['workflow_split', { convertFlag: false }],
  // No harvested sample (0 stored); the builder's own shape was captured 2026-09-28 (live-3CB-intent-builder-specimen.json).
  ['workflow_ai_intent_detection', { convertFlag: true }],
]);

/** What is wrong with a multipath container's wiring, or [] when nothing is. */
export function multipathDefects(t, byId) {
  const spec = MULTIPATH_TYPES.get(t?.type);
  if (!spec) return [];
  const bad = [];
  const attrs = t.attributes ?? {};
  if (t.cat !== 'multi-path') bad.push(`cat is ${JSON.stringify(t.cat ?? null)}, not 'multi-path'`);
  if (spec.convertFlag && attrs.convertToMultipath !== true) bad.push('attributes.convertToMultipath is not true');
  const trs = Array.isArray(attrs.transitions) ? attrs.transitions : [];
  if (!trs.length) bad.push('attributes.transitions is empty');
  if (!Array.isArray(t.next) || !t.next.length) {
    bad.push(`next is ${JSON.stringify(t.next ?? null)}, not an array of branch ids`);
    return bad;
  }
  for (const id of t.next) {
    const child = byId.get(id);
    if (!child) bad.push(`branch '${id}' in next[] is not a step in this workflow`);
    else if (child.type !== 'transition') bad.push(`branch '${id}' is a '${child.type}', not a transition`);
    else if (child.parentKey !== t.id) bad.push(`transition '${child.name ?? id}' has parentKey '${child.parentKey}', not this step`);
  }
  const trIds = new Set(trs.map((x) => x?.id));
  const missing = t.next.filter((id) => !trIds.has(id));
  if (trs.length && missing.length) bad.push(`next[] names ${missing.length} branch(es) that attributes.transitions does not`);
  const unwired = trs.filter((x) => !t.next.includes(x?.id));
  if (unwired.length) bad.push(`attributes.transitions has ${unwired.length} branch(es) next[] does not wire (${unwired.map((x) => `'${x?.name}'`).join(', ')})`);
  return bad;
}

/** Every attribute key this type is known to carry, from every evidence source there is. */
// The builder's CORE_ACTIONS: native type names it always renders with the marketplace-asset drawer.
const CORE_ASSET_ACTIONS = new Set(['task-notification', 'edit_conversation']);

// W6a item 5 (bl-450): the run-time structure of an If/Else, exactly as the compiler writes it (compiler.mjs ~1680-1726).
// A repair-built If/Else without these keys passed every validator and was skipped at run time ("Malformed Node").
// Containers are if_else steps that carry an array `next` or are the parent of other if_else steps.
export function ifElseDefects(templates, byId) {
  const out = [];
  const ifElse = templates.filter((t) => t && t.type === 'if_else');
  const parentsOfBranches = new Set(ifElse.map((t) => t.parent ?? t.parentKey).filter(Boolean));
  for (const c of ifElse.filter((t) => Array.isArray(t.next) || (parentsOfBranches.has(t.id) && t.nodeType !== 'branch-yes' && t.nodeType !== 'branch-no'))) {
    const bad = [];
    if (c.nodeType !== 'condition-node') bad.push(`container nodeType is ${JSON.stringify(c.nodeType)}, not "condition-node"`);
    if (c.cat !== 'conditions') bad.push(`container cat is ${JSON.stringify(c.cat)}, not "conditions"`);
    const next = Array.isArray(c.next) ? c.next : [];
    const branchIds = (c.attributes?.branches ?? []).map((b) => b?.id);
    const missingFromNext = branchIds.filter((id) => !next.includes(id));
    if (missingFromNext.length) bad.push(`attributes.branches id(s) ${missingFromNext.join(', ')} are not in next[]`);
    if (next.length !== branchIds.length + 1) bad.push(`next[] has ${next.length} entries; attributes.branches has ${branchIds.length} (next must be the conditioned branches plus one else)`);
    let elseCount = 0;
    for (const id of next) {
      const b = byId.get(id);
      if (!b) { bad.push(`next[] names ${id}, which is not a step`); continue; }
      const label = `branch '${b.name ?? id}'`;
      if (b.type !== 'if_else') bad.push(`${label} is type ${b.type}, not if_else`);
      if (b.parent !== c.id) bad.push(`${label} parent is ${JSON.stringify(b.parent)}, not the container`);
      if (b.parentKey !== c.id) bad.push(`${label} parentKey is ${JSON.stringify(b.parentKey)}, not the container`);
      if (b.cat !== 'conditions') bad.push(`${label} cat is ${JSON.stringify(b.cat)}, not "conditions"`);
      if (b.nodeType !== 'branch-yes' && b.nodeType !== 'branch-no') bad.push(`${label} nodeType is ${JSON.stringify(b.nodeType)}, not branch-yes/branch-no`);
      const want = next.filter((x) => x !== id).sort();
      const sib = Array.isArray(b.sibling) ? [...b.sibling].sort() : null;
      if (!sib || JSON.stringify(sib) !== JSON.stringify(want)) bad.push(`${label} sibling is ${JSON.stringify(b.sibling)}, not the other branches ${JSON.stringify(want)}`);
      if (b.nodeType === 'branch-no') { elseCount += 1; if (b.attributes?.else !== true) bad.push(`${label} is branch-no without attributes.else:true`); }
    }
    if (elseCount !== 1 && next.length) bad.push(`${elseCount} branch-no (else) node(s); exactly one is required`);
    // members: the container AND its branch nodes — a write touching ANY of them owns this If/Else's wiring (final review W6a)
    if (bad.length) out.push({ step: c, bad, members: [c.id, ...next] });
  }
  return out;
}

export function knownAttributeKeys(type, card) {
  const model = (card?.modelFields?.fields ?? []).map((f) => f?.name).filter(Boolean);
  return new Set([
    ...(card?.attrKeys ?? []),
    ...(card?.requiredFields ?? []).map((k) => String(k).split(/[.[]/)[0]),
    ...model,
    ...(OBSERVED_ATTRIBUTE_KEYS[type] ?? []),
    ...(CONDITIONAL_ATTR_KEYS[type] ?? []),
    ...(SERVER_WRITTEN_ATTR_KEYS[type] ?? []),
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
// A branching wait's transition rows store `wait_<wait type>` (Wait.ts:512,536) for each type GHL lets a wait branch on
// (WorkflowValidator.ts:927, extracted into workflowRules.vocab.multipathSupportedWaitTypes), plus `wait_timeout` for the
// timeout leg. Derived, not listed: the census had seen only three of them and refused builder-made
// user_replied / link_clicked / email_event branches.
export function transitionInnerTypes(catalog) {
  return [...(catalog?.workflowRules?.vocab?.multipathSupportedWaitTypes ?? []).map((w) => `wait_${w}`), 'wait_timeout'];
}

// unknownStepSeverity: a step type found in neither the native catalogue nor the account's asset list is an ERROR when
// the list was read (a build or an edit is about to write it), unless the caller says otherwise. publish and repair say
// 'warning': the document is already stored, and a type the catalogue lacks is no reason to refuse to publish it (bl-309).
// storedTemplates: the steps as GHL stored them. A top-level key the STORED step already carries is GHL's (a key it added
// after the calibration sweep) and is a warning; a key this write adds is still an error (W6a item 13).
export function gateDocument(templates = [], { catalog = loadCatalog(), marketplaceTypes = null, scope = null, waive = null, unknownStepSeverity = null, storedTemplates = null } = {}) {
  const out = [];
  const storedById = new Map((storedTemplates ?? []).filter((s) => s && typeof s === 'object').map((s) => [s.id, s]));
  for (const t of templates) {
    if (!t || typeof t !== 'object') continue;
    for (const k of Object.keys(t)) {
      if (STEP_TOP_LEVEL_KEYS.has(k)) continue;
      const fromStorage = Boolean(storedById.get(t.id) && k in storedById.get(t.id));
      out.push(finding('TOP_LEVEL_KEY', fromStorage ? 'warning' : 'error', t, fromStorage
        ? `unknown top-level step key '${k}' — the stored step already carries it (GHL's own key, kept as stored)`
        : `unknown top-level step key '${k}' — no stored step on either calibration account carries it`));
    }
    const card = catalog.step(t.type);
    if (t.isMarketplaceAction === true) continue;
    // A LABELLED asset step (first-party or hosted integration) carries `workflowsActionType`
    // INSTEAD of isMarketplaceAction — that is the builder's own shape, not a missing flag. It has no
    // native card to check its keys against; its inputs are checked against the asset schema.
    if (!card && typeof t.workflowsActionType === 'string' && marketplaceTypes?.has(t.type)) continue;
    // An engine type outside the native catalogue (the A/B Test container, TYPES_OUTSIDE_CATALOG): it has no card, and the compiler
    // already owns its shape. Not unknown.
    if (!card && TYPES_OUTSIDE_CATALOG.has(t.type)) continue;
    if (!card) {
      if (marketplaceTypes?.has(t.type)) {
        out.push(finding('MARKETPLACE_FLAG', 'warning', t,
          `'${t.type}' is a marketplace action stored without isMarketplaceAction:true — the rail's complete step shape carries it`));
      } else {
        out.push(finding('STEP_TYPE', unknownStepSeverity ?? (marketplaceTypes ? 'error' : 'warning'), t,
          `'${t.type}' is not a known step type${marketplaceTypes ? ', native or marketplace' : ' (marketplace types were not available to rule it out)'}. `
          + 'GHL does NOT catch this on an agent flow.'));
      }
      continue;
    }
    const attrs = t.attributes ?? {};
    // A value the model allows but the drawer cannot show: RentalBookingStatusType includes 'partial', the rental status
    // list (AppointmentStatus.ts:39-47) does not. It saves and reads back; a person who opens and saves the step loses it.
    if (t.type === 'update_appointment_status' && attrs.category === 'rental_booking' && attrs.status_type === 'partial')
      out.push(finding('DRAWER_CANNOT_SHOW', 'warning', t,
        "the builder's drawer cannot display 'partial' for rental appointments; a person who opens and saves this step will lose it (AppointmentStatus.ts:39-47)"));
    // attributes.type: the explicit map where the inner spelling differs from the row type, else every
    // value a stored step of this type was seen carrying (plus the source model's union members). A
    // type never observed is not judged — absence of evidence is not a rule.
    const innerAllowed = INNER_ATTRIBUTE_TYPE[t.type]
      ? new Set([INNER_ATTRIBUTE_TYPE[t.type]])
      : (OBSERVED_INNER_TYPES[t.type]
        ? new Set([...OBSERVED_INNER_TYPES[t.type], ...((card.modelFields?.fields ?? []).find((f) => f?.name === 'type')?.members ?? []),
          ...(t.type === 'transition' ? transitionInnerTypes(catalog) : [])])
        : null);
    if (innerAllowed && 'type' in attrs && !innerAllowed.has(attrs.type)) out.push(finding('INNER_TYPE', 'error', t,
      `attributes.type is ${JSON.stringify(attrs.type)}; '${t.type}' stores ${[...innerAllowed].map((v) => `'${v}'`).join(' or ')}. `
      + 'It saves, publishes and round-trips clean, and the builder\'s drawer then cannot bind it. GHL does not catch this.'));
    // A step GHL LABELS as an asset (workflowsActionType + a live marketplace key) is rendered by the
    // asset drawer, not by the native model its card was built from, so its keys are the asset's
    // inputs — which the compiler already checks against the live asset. edit_conversation is the
    // case: a CORE_ACTION whose native EditConversation drawer is dead wiring; its card knew `read`
    // and refused the asset's declared `archive` (live 2026-09-28, knowledge sniffs/workflows-wave1-
    // 2026-09-25/live-3S-edit-conversation-draft.json). Only the key check is skipped.
    // publish_workflow and repair judge a document WITHOUT the assets read (marketplaceTypes null), so
    // the builder's own CORE_ACTIONS — always rendered by the asset drawer (constants/actions.ts:39-40,
    // AsideSection.vue:1417-1419) — count as labelled on the flag alone.
    const assetLabelled = typeof t.workflowsActionType === 'string'
      && (Boolean(marketplaceTypes?.has(t.type)) || CORE_ASSET_ACTIONS.has(t.type));
    const known = knownAttributeKeys(t.type, card);
    const bad = assetLabelled ? [] : Object.keys(attrs).filter((k) => !known.has(k));
    if (bad.length) out.push(finding('ATTRIBUTE_KEY', card.confidence === 'verified-live' ? 'error' : 'warning', t,
      `unknown attribute key(s) [${bad.join(', ')}] — an invented key saves but moves nothing. GHL does not catch this.`));
    const missing = requiredKeysFor(t.type).filter((k) => !isSupplied(t.type, k, attrs));
    if (missing.length) out.push(finding('REQUIRED', 'error', t, `missing required field(s): ${missing.join(', ')}`));
    for (const r of card.enforcement?.throw ?? []) {
      if (fires(r, attrs)) out.push(finding('ENFORCEMENT', 'error', t, `GHL's own guard fires: ${r.field ?? ''} ${r.guard ?? ''}`.trim()));
    }
  }
  const byId = new Map(templates.filter((t) => t && typeof t === 'object').map((t) => [t.id, t]));
  for (const t of templates) {
    const bad = multipathDefects(t, byId);
    if (bad.length) out.push(finding('MULTIPATH_SHAPE', 'error', t,
      `'${t.type}' only works as a branching container, and this one is not wired as one: ${bad.join('; ')}. `
      + 'It saves, validates and publishes clean, and then cannot branch. GHL does not catch this.'));
  }
  for (const { step, bad, members } of ifElseDefects(templates, byId)) {
    out.push({ ...finding('IF_ELSE_STRUCTURE', 'error', step,
      `this If/Else is not wired the way GHL runs it: ${bad.join('; ')}. It can save and validate clean and then be skipped `
      + 'at run time as a "Malformed Node" (bl-450). Build branches with the compiler, or send every key it writes.'), members });
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
  // A finding about a GROUP of steps (an If/Else's container and branches) is in scope when any member is.
  const inScope = (f) => scope.has(f.stepId) || (f.members ?? []).some((id) => scope.has(id));
  for (const f of out) if (scope && f.stepId && !inScope(f) && f.severity === 'error') f.severity = 'warning';
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

// The two-oracle gate that used to live here is write-validation.mjs: every write path asks THAT,
// so no path can assemble a shorter list of layers than another. This file is the ENGINE oracle only.
