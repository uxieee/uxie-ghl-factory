// WORKFLOW-level rules — GHL's second validation layer, mirrored.
//
// GHL validates at TWO levels. Per-step validators (enforce.mjs) answer "is this step
// configured?". `utils/WorkflowValidator.ts` answers "is this WORKFLOW legal?" — 21 rules that
// THROW and abort the save BEFORE any HTTP. They are graph-scoped and TRIGGER-aware: an action can
// be illegal purely because of the trigger above it, a step can be illegal because of what else is
// in the workflow. Found in the 2026-08-22 full-source sweep (research workflow-rules.json); until
// then the engine could build documents the UI would refuse.
//
// Each check below cites its GHL rule NAME. The vocabulary it tests against (which actions are
// banned inside loops, which triggers satisfy interactive messenger, the trigger/action restriction
// map …) is NOT retyped here: it rides in the catalog (`catalog.workflowRules.vocab`), extracted
// from the same source the rules read. Hand-written predicates are banned for guard translation;
// these are GRAPH predicates with no guard to translate, so the discipline is different:
// corpus-replayed (0 fires across every published workflow) and each one a literal restatement of
// a 3–10 line method, cited by name.
//
// Severity: GHL blocks; so does the engine (IRError 'WORKFLOW_RULE'). Hatch:
// `skipWorkflowRules: true | ['ruleName']` — same grammar as skipEnforcement.
//
// Two of GHL's rules cannot be evaluated from the document alone and are reported as such, never
// silently passed: inboundWebhookTriggerValidator reads builder module state; validateIfElseCondition
// only runs for workflow_ai-authored workflows (creationSource), which the engine never is.
// validateRequiredTriggersForActions is already enforced at compile by action-schema.mjs and is
// cited, not duplicated.
import { IRError } from './ir.mjs';

const has = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
const present = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length));

/**
 * Evaluate every rule. Returns { findings: [{rule, message}], notEvaluable: [rule] }.
 * @param doc   { templates, triggers, settings?, status?, publishing? }
 *              triggers: the workflow's trigger docs/bodies ({type, name, conditions})
 *              settings: { senderAddress? } — the workflow document's own settings
 *              publishing: true when this write sets status 'published'
 * @param rules catalog.workflowRules ({ vocab, rules })
 */
export function evaluateWorkflowRules(doc, rules) {
  const V = rules?.vocab ?? {};
  const T = doc.templates ?? [];
  const TR = doc.triggers ?? [];
  const F = [];
  const fire = (rule, message) => F.push({ rule, message });
  const types = (list) => new Set(list ?? []);
  const hasTrigger = (t) => TR.some((x) => x?.type === t);

  // checkEmptyPublish — "Workflow cannot be published with empty actions."
  if (doc.publishing && T.length === 0) fire('checkEmptyPublish', 'a workflow cannot be published with zero steps');

  // checkDanglingGoto — (graph-refs refuses this earlier and harder; kept for edit-path parity)
  for (const t of T) if (t.type === 'goto' && !has(t.attributes?.targetNodeId)) fire('checkDanglingGoto', `goto '${t.name ?? t.id}' has no target`);

  // checkMultipleGoal
  const goals = T.filter((t) => t.type === 'workflow_goal');
  if (goals.length > 1) fire('checkMultipleGoal', `${goals.length} workflow_goal steps — GHL allows exactly one per workflow`);

  // checkUnsupportedActionsInsideLoop / checkUnsupportedWaitTypesInsideLoop / checkLoopHasBody
  const bannedInLoop = types(V.actionsUnsupportedInsideLoop), bannedWaits = types(V.waitTypesUnsupportedInsideLoop);
  for (const t of T) {
    if (!t.parentContainerId) continue;
    if (bannedInLoop.has(t.type)) fire('checkUnsupportedActionsInsideLoop', `'${t.name ?? t.id}' (${t.type}) cannot sit inside a loop body`);
    if (t.type === 'wait' && bannedWaits.has(t.attributes?.type)) fire('checkUnsupportedWaitTypesInsideLoop', `wait '${t.name ?? t.id}' of type '${t.attributes?.type}' cannot sit inside a loop body (time-based waits only)`);
  }
  for (const t of T) if (t.type === 'loop' && !T.some((c) => c.parentContainerId === t.id)) fire('checkLoopHasBody', `loop '${t.name ?? t.id}' has no body steps — an empty loop re-runs the step after it on every iteration`);

  // checkSenderAddress
  const sa = doc.settings?.senderAddress;
  if (sa?.from_name && !sa?.from_email) fire('checkSenderAddress', 'settings.senderAddress has from_name but no from_email');

  // filterlessContactChangedLoopValidator
  if (V.contactChangedTrigger && TR.some((x) => x?.type === V.contactChangedTrigger && !present(x.conditions))) {
    const loopers = types(V.contactChangedLoopActions);
    for (const t of T) if (loopers.has(t.type)) fire('filterlessContactChangedLoopValidator', `'${t.name ?? t.id}' (${t.type}) mutates what a FILTERLESS contact_changed trigger listens to — infinite loop; add a filter to the trigger or remove the step`);
  }

  // createUpdateContactValidator
  if (V.createUpdateContact?.actionType) {
    const ok = new Set(V.createUpdateContact.acceptedFieldTitles ?? []);
    for (const t of T) if (t.type === V.createUpdateContact.actionType && !(t.attributes?.fields ?? []).some((f) => ok.has(f?.title)))
      fire('createUpdateContactValidator', `'${t.name ?? t.id}' maps neither ${[...ok].join(' nor ')} — GHL requires one to identify the contact`);
  }

  // sheetsLookupValidator
  if (V.sheets?.actionType) {
    const sheets = T.filter((t) => t.type === V.sheets.actionType);
    const lookups = sheets.filter((s) => s.attributes?.action?.id === V.sheets.lookupActionId);
    for (const s of sheets) {
      const ref = s.attributes?.lookupStep;
      if (!ref?.id) continue;
      if (!lookups.some((l) => l.id === ref.id && l.stepIndex === ref.stepIndex))
        fire('sheetsLookupValidator', `'${s.name ?? s.id}' references lookup step ${ref.id}#${ref.stepIndex}, which is not a current lookup_row step`);
    }
  }

  // validateDeleteContact
  if (V.deleteContactAction) for (const t of T) if (t.type === V.deleteContactAction && has(t.next)) fire('validateDeleteContact', `'${t.name ?? t.id}' must be the LAST step — nothing may follow a delete-contact`);

  // validateInteractiveMessenger
  {
    const acts = types(V.interactiveMessengerActions), trigs = types(V.interactiveMessengerTriggers);
    const offenders = T.filter((t) => acts.has(t.type));
    if (offenders.length && !TR.some((x) => trigs.has(x?.type)))
      fire('validateInteractiveMessenger', `'${offenders[0].name ?? offenders[0].id}' (${offenders[0].type}) requires a comment-on-post or DM trigger (${[...trigs].join(', ')})`);
  }

  // validateAppointmentBooking
  if (V.appointmentBookingAction && T.some((t) => t.type === V.appointmentBookingAction)) {
    const conflict = TR.find((x) => types(V.appointmentBookingConflictTriggers).has(x?.type));
    if (conflict) fire('validateAppointmentBooking', `'${V.appointmentBookingAction}' cannot be used with an appointment trigger ('${conflict.type}') — unintended loops`);
  }

  // validateIVRActions
  {
    const ivr = types(V.ivrActionKeys);
    const first = T.find((t) => ivr.has(t.type));
    if (first && V.ivrTrigger && !hasTrigger(V.ivrTrigger)) fire('validateIVRActions', `'${first.name ?? first.id}' (${first.type}) cannot be used without the '${V.ivrTrigger}' trigger`);
  }

  // validateCreateOpportunity — the INTERNAL create-opportunity action only (per source)
  if (V.createOpportunity?.triggerType && hasTrigger(V.createOpportunity.triggerType)) {
    const C = V.createOpportunity;
    const acts = T.filter((t) => t.type === C.actionType);
    for (const trig of TR.filter((x) => x?.type === C.triggerType)) {
      if (!acts.length) break;
      const conds = trig.conditions ?? [];
      const tp = conds.find((c) => c?.field === C.triggerPipelineField)?.value;
      const ts = conds.find((c) => c?.field === C.triggerStageField)?.value;
      if (!tp) { fire('validateCreateOpportunity', `'${C.actionType}' with an '${C.triggerType}' trigger that has no pipeline filter — unintended loops`); continue; }
      for (const a of acts) {
        const at = a.attributes ?? {};
        const ap = (C.actionPipelineKeys ?? []).map((k) => at[k]).find(has);
        const as = (C.actionStageKeys ?? []).map((k) => at[k]).find(has)
          ?? at.__customInputFields__?.find?.((f) => f?.filterField === C.actionStageCustomInputFilterField)?.value;
        if (!ap) { fire('validateCreateOpportunity', `'${a.name ?? a.id}' has no pipeline but the workflow is entered by '${C.triggerType}' — unintended loops`); continue; }
        if (ap !== tp) continue;
        if (ts && as) { if (as === ts) fire('validateCreateOpportunity', `'${a.name ?? a.id}' targets the SAME pipeline and stage as the '${C.triggerType}' trigger — unintended loops`); continue; }
        fire('validateCreateOpportunity', `'${a.name ?? a.id}' targets the SAME pipeline as the '${C.triggerType}' trigger — unintended loops`);
      }
    }
  }

  // validateTriggerActionRestrictions — GHL's legacy map (trigger → restricted actions) plus each
  // action's own restrictedTriggers (catalog schema); both inverted to action → {triggers}
  {
    const byAction = new Map();
    for (const [trig, acts] of Object.entries(V.triggerActionRestrictions ?? {})) for (const a of acts) (byAction.get(a) ?? byAction.set(a, new Set()).get(a)).add(trig);
    for (const [a, trigs] of Object.entries(rules?.restrictedTriggersByAction ?? {})) for (const trig of trigs) (byAction.get(a) ?? byAction.set(a, new Set()).get(a)).add(trig);
    for (const t of T) {
      const bad = byAction.get(t.type);
      if (!bad?.size) continue;
      const trig = TR.find((x) => bad.has(x?.type));
      if (trig) fire('validateTriggerActionRestrictions', `'${t.name ?? t.id}' (${t.type}) cannot be used with trigger '${trig.name ?? trig.type}' — unintended loops`);
    }
  }

  // validateWaitStep
  {
    const okBranching = types(V.multipathSupportedWaitTypes);
    const ids = new Set(T.map((t) => t.id));
    for (const w of T) {
      if (w.type !== 'wait' || w.attributes?.type === undefined) continue;
      const a = w.attributes;
      if (a.window != null && typeof a.window === 'string') fire('validateWaitStep', `wait '${w.name ?? w.id}' has a STRINGIFIED window — the backend crashes on window.start.split`);
      const branching = w.cat === 'multi-path' || Array.isArray(w.next);
      if (branching && !okBranching.has(a.type)) fire('validateWaitStep', `wait '${w.name ?? w.id}' of type '${a.type}' cannot branch — only ${[...okBranching].join(', ')} may`);
      if (w.cat === 'multi-path' || a.convertToMultipath) {
        if (!Array.isArray(w.next) || w.next.length < 2) fire('validateWaitStep', `branching wait '${w.name ?? w.id}' needs at least two transitions`);
        for (const tr of (a.transitions ?? [])) if (tr?.id && !ids.has(tr.id)) fire('validateWaitStep', `branching wait '${w.name ?? w.id}' transition '${tr.name ?? tr.id}' has no step in the workflow`);
      }
    }
  }

  // ── ADVISORY (ui-disabled): combinations the UI cannot produce because the picker greys the
  // action out while the trigger is present (TriggerMain.inCompatibleActions) — nothing refuses
  // them on save, so these WARN rather than block. Vocab: catalog.workflowRules.disabledActionsByTrigger.
  const A = [];
  for (const [trigType, acts] of Object.entries(rules?.disabledActionsByTrigger ?? {})) {
    if (!hasTrigger(trigType)) continue;
    const bad = new Set(acts);
    for (const t of T) if (bad.has(t.type)) A.push({ rule: 'inCompatibleActions', message: `'${t.name ?? t.id}' (${t.type}) is greyed out in the builder while a '${trigType}' trigger is present — the UI cannot produce this combination` });
  }

  const notEvaluable = ['inboundWebhookTriggerValidator (builder module state)', 'validateIfElseCondition (workflow_ai-authored only)'];
  return { findings: F, advisories: A, notEvaluable };
}

/**
 * Do any TRIGGER-aware rules apply to these templates? Lets an edit path skip the trigger GET
 * when no step type in the document is one a trigger-aware rule cares about — a plain sms/email/
 * wait edit stays network-identical. Derived from the same vocab the rules use.
 */
export function rulesNeedTriggers(templates, rules) {
  const V = rules?.vocab ?? {};
  const care = new Set([
    ...(V.contactChangedLoopActions ?? []), ...(V.interactiveMessengerActions ?? []), ...(V.ivrActionKeys ?? []),
    ...(V.appointmentBookingAction ? [V.appointmentBookingAction] : []), ...(V.createOpportunity?.actionType ? [V.createOpportunity.actionType] : []),
    ...Object.values(V.triggerActionRestrictions ?? {}).flat(), ...Object.keys(rules?.restrictedTriggersByAction ?? {}),
  ]);
  return (templates ?? []).some((t) => care.has(t?.type));
}

/**
 * Chokepoint: refuse a document GHL's WorkflowValidator would refuse. `opts.skipWorkflowRules`
 * = true | ['ruleName', …]. Returns the findings (empty when clean) so callers can report.
 */
export function checkWorkflowRules(doc, rules, opts = {}) {
  if (!rules || opts.skipWorkflowRules === true) return [];
  const { findings, advisories } = evaluateWorkflowRules(doc, rules);
  for (const a of advisories ?? []) opts.warn?.(`WORKFLOW_RULE_SOFT: [${a.rule}] ${a.message}`);
  const skip = Array.isArray(opts.skipWorkflowRules) ? new Set(opts.skipWorkflowRules) : new Set();
  const live = findings.filter((f) => !skip.has(f.rule));
  if (!live.length) return [];
  const lines = live.map((f) => `  - [${f.rule}] ${f.message}`);
  throw new IRError('WORKFLOW_RULE',
    `WORKFLOW_RULE: GHL's builder would REFUSE to save this workflow (WorkflowValidator — it throws before any HTTP):\n${lines.join('\n')}\n` +
    `Fix the structure, or pass skipWorkflowRules (true, or ['${live[0].rule}']) if you are certain.`);
}
