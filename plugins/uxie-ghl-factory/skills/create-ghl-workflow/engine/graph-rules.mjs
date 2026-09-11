// WORKFLOW-level rules — GHL's second validation layer, mirrored.
//
// GHL validates at TWO levels. Per-step validators (enforce.mjs) answer "is this step
// configured?". `utils/WorkflowValidator.ts` answers "is this WORKFLOW legal?" — 22 rules, any
// finding of which aborts the save BEFORE any HTTP. They are graph-scoped and TRIGGER-aware: an
// action can be illegal purely because of the trigger above it, a step can be illegal because of
// what else is in the workflow. Found in the 2026-08-22 full-source sweep (research
// workflow-rules.json); until then the engine could build documents the UI would refuse.
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
// Three rules ask whether the workflow can RUN at all: validateRequiredTriggersForActions,
// inboundWebhookTriggerValidator, validateIfElseCondition. GHL's builder refuses them on every
// save; the engine refuses them when the write PUBLISHES and warns on a draft. A draft cannot run,
// and a build or edit legitimately completes a workflow across calls — the webhook sample is pinned
// after the workflow exists, a trigger may arrive in a later edit. Silent is never an option.
//
// Two rules read inputs the document does not carry; the caller reads them and passes them in,
// and without them the rule reports itself NOT EVALUABLE rather than passing:
//   senderDomain      checkFromEmailFormat           GET /workflow/{loc}/email/domain-selection
//   webhookReference  inboundWebhookTriggerValidator GET /hooks/inbound-webhook-request/reference/{triggerId}
// creationSource, which validateIfElseCondition keys on, IS a stored document field.
import { IRError } from './ir.mjs';
import { isRouterRoot, isInsideRouterBranch, canNestRouterAt, templateParentId } from './router-graph.mjs';
import { incompleteBranchViolation, duplicatePairViolation } from './router-branches.mjs';

const has = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
const present = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length));
const CV_REGEX_TEST = /\{\{([^{}]+)\}\}/;          // utils/customVariableHelper.ts

/**
 * Could checkFromEmailFormat refuse this From Email on SOME sending domain? A full address passes on
 * every domain and a merge field is exempt, so only a bare local part is worth reading the domain for.
 */
export const fromEmailNeedsDomain = (fromEmail) => Boolean(fromEmail) && !CV_REGEX_TEST.test(String(fromEmail))
  && (!String(fromEmail).includes('@') || !String(fromEmail).includes('.'));

/**
 * Evaluate every rule. Returns { findings: [{rule, message}], advisories, notEvaluable: [rule] }.
 * @param doc   { templates, triggers, settings?, status?, publishing?, senderDomain?, webhookReference?, creationSource? }
 *              triggers: the workflow's trigger docs/bodies ({type, name, conditions})
 *              settings: { senderAddress? } — the workflow document's own settings
 *              status: the workflow's STORED status; publishing: true when this write publishes
 *              senderDomain / webhookReference: read by the caller (see the header); undefined = not read
 *              creationSource: the stored document's creationSource
 * @param rules catalog.workflowRules ({ vocab, rules, restrictedTriggersByAction, requiredTriggersByAction })
 */
export function evaluateWorkflowRules(doc, rules) {
  const V = rules?.vocab ?? {};
  const T = doc.templates ?? [];
  const TR = doc.triggers ?? [];
  const F = [], A = [];
  // atPublish: a rule about whether the workflow can RUN — refused on publish, warned on a draft
  const fire = (rule, message, { atPublish = false } = {}) => {
    if (!atPublish || doc.publishing) F.push({ rule, message });
    else A.push({ rule, message: `${message} (a draft cannot run; this is refused when the workflow is published)` });
  };
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

  // checkFromEmailFormat — GHL 2026-09-11, throw-style, the tail of validate(). It reads the
  // workflow's SENDING DOMAIN, which is not in the document: GET /workflow/{loc}/email/domain-selection
  // (see corpus workflows/20-api/sender-domain.md). With "All Domains" the From Email is a local
  // part by design, so the check is domain-specific only; a merge field is exempt because it
  // resolves at send time and its literal text cannot be format-checked.
  {
    const SDV = V.senderDomain;
    const fromEmail = doc.settings?.senderAddress?.from_email;
    const domain = doc.senderDomain;
    if (SDV && domain && domain !== SDV.allDomains && fromEmailNeedsDomain(fromEmail))
      fire('checkFromEmailFormat', `From Email '${fromEmail}' is not a full address, and this workflow sends from '${domain}' — GHL refuses the save`);
  }

  // validateRouterConditions — GHL's newest workflow rule (2026-09-11), and one it added because
  // its own publish path had drifted: "it never checked for two paths routing on the same
  // conditions, so a router made ambiguous anywhere but the branch panel went live". A router is
  // not an if/else — every branch evaluates — so two branches matching the same execution leave it
  // with no single answer. Per router GHL reports the FIRST rule the branch list breaks, in its
  // order (validateRouterBranches): capacity, branch-type cardinality, an unfinished branch, a
  // duplicate pair — then nesting depth, then each step GHL bans inside a branch. The unfinished and
  // duplicate halves read GHL's branch model, ported in router-branches.mjs.
  {
    const RV = V.router;
    if (RV) {
      const opts = { laneNodeTypes: RV.laneNodeTypes };
      for (const r of T.filter((t) => isRouterRoot(t, opts))) {
        const branches = r.attributes?.branches ?? [];
        const who = `router '${r.name ?? r.id}'`;
        const fallbacks = branches.filter((b) => b?.branchType === 'fallback').length;
        const modelViolation = () => { const m = incompleteBranchViolation(branches) ?? duplicatePairViolation(branches); return m ? `${who}: ${m}` : null; };
        const violation = RV.maxBranches != null && branches.length > RV.maxBranches ? `${who} has ${branches.length} branches — GHL allows at most ${RV.maxBranches}`
          : fallbacks > 1 ? `${who} has ${fallbacks} fallback branches — GHL allows one`
          : fallbacks > 0 && branches.some((b) => b?.branchType === 'always_run') ? `${who} has both an always-run branch and a fallback — the fallback can never run`
          : modelViolation();
        if (violation) fire('validateRouterConditions', violation);
        if (RV.maxNesting != null && !canNestRouterAt(templateParentId(r), T, RV.maxNesting, opts))
          fire('validateRouterConditions', `${who} nests deeper than GHL's limit of ${RV.maxNesting} routers`);
      }
      const banned = new Set(RV.disallowedBranchSteps ?? []);
      for (const t of T) {
        if (!banned.has(t.type)) continue;
        if (isInsideRouterBranch(templateParentId(t), T, opts))
          fire('validateRouterConditions', `'${t.name ?? t.id}' (${t.type}) cannot sit inside a router branch`);
      }
    }
  }

  // validateRequiredTriggersForActions — an action whose GHL metadata (getActionMetaData(type)
  // .requiredTriggers, folded into catalog.workflowRules.requiredTriggersByAction) names required
  // triggers needs ONE of them on the workflow. GHL's server validator does not check this —
  // measured 2026-09-12, an AI step with no trigger answers valid:true — so this is the only guard.
  // The message names trigger TYPES where GHL names display titles: types are what a caller writes.
  for (const t of T) {
    const need = rules?.requiredTriggersByAction?.[t.type];
    if (!need?.length || need.some(hasTrigger)) continue;
    const list = need.length > 1 ? `${need.slice(0, -1).join(', ')} or ${need[need.length - 1]}` : need[0];
    fire('validateRequiredTriggersForActions', `There is a problem with this workflow setup, "${t.name ?? t.id}" action requires ${list} trigger to be present. Please add the required trigger or remove this action.`, { atPublish: true });
  }

  // inboundWebhookTriggerValidator — GHL reads the FIRST inbound_webhook trigger's mapped sample and
  // refuses when the answer has no payload (a failed lookup counts as an answer: states/workflow.ts
  // setInboundWebhookReference). `doc.webhookReference` is that answer, { triggerId, payload } or null.
  const firstHook = TR.find((x) => x?.type === 'inbound_webhook');
  if (firstHook && doc.webhookReference !== undefined && !doc.webhookReference?.payload)
    fire('inboundWebhookTriggerValidator', 'There is a problem with this workflow setup, Mapping Reference is required for the Inbound Webhook Trigger to function. Please map a request to be used as reference in your Inbound Webhook Trigger. (pin_webhook_sample maps one.)', { atPublish: true });

  // validateIfElseCondition — GHL judges only a workflow Workflow AI authored (stored creationSource
  // 'workflow_ai'), and skips the rule entirely when any legacy if/else (attributes.segments) is
  // present. Verbatim, `continue`s included: one finding per node, branch, segment or condition, as
  // GHL reports them. GHL's hatch (shouldEmitValidationError) silences it when a published workflow
  // is saved as a draft.
  if (doc.creationSource === 'workflow_ai' && !T.some((t) => t.type === 'if_else' && t.attributes?.segments?.length)) {
    const wasPublished = doc.status === 'published';
    const emit = !(!doc.publishing && wasPublished);
    const ifFire = (message) => { if (emit) fire('validateIfElseCondition', message, { atPublish: true }); };
    const problem = 'There is a problem with this workflow setup,';
    const unstamped = T.find((t) => t.type === 'if_else' && !t.nodeType);
    if (unstamped) {
      ifFire(doc.publishing && wasPublished
        ? `Unable to save: The condition "${unstamped.name}" is missing required configuration. Your published workflow will continue running with the previous version.`
        : `Unable to save: The condition "${unstamped.name}" is missing required configuration. Try creating a new workflow using AI.`);
    } else {
      for (const t of T.filter((x) => x.type === 'if_else' && x.nodeType === 'condition-node')) {
        const tn = t.name;
        if (!Array.isArray(t.next) || t.next.length < 2) { ifFire(`${problem} "${tn}" condition requires at least two next nodes. Please add a next node to proceed.`); continue; }
        const branches = t.attributes?.branches;
        if (!branches?.length) { ifFire(`${problem} "${tn}" condition requires at least one branch. Please add a branch to proceed.`); continue; }
        for (const b of branches) {
          const bn = b.name;
          if (!b.segments?.length) { ifFire(`${problem} branch "${bn}" in "${tn}" condition requires at least one segment. Please add a segment to proceed.`); continue; }
          for (const s of b.segments) {
            if (!s.conditions?.length) { ifFire(`${problem} a segment in branch "${bn}" of "${tn}" condition requires at least one condition. Please add a condition to proceed.`); continue; }
            for (const c of s.conditions) {
              const at = `a condition in branch "${bn}" of "${tn}"`;
              if (!c.conditionType) { ifFire(`${problem} ${at} is missing a condition type. Please select a condition type to proceed.`); continue; }
              if (!c.conditionSubType) { ifFire(`${problem} ${at} is missing a condition field. Please select a condition field to proceed.`); continue; }
              if (!c.conditionOperator) { ifFire(`${problem} ${at} is missing a condition operator. Please select a condition operator to proceed.`); continue; }
              if (['has_value', 'has_no_value', 'timeout'].includes(c.conditionOperator)) continue;
              if (c.conditionValueOperator) {
                if (['today', 'yesterday', 'tomorrow'].includes(c.conditionValueOperator)) continue;
                if (!['on', 'between', 'afterDate', 'beforeDate'].includes(c.conditionValueOperator) && !c.conditionValueUnit) {
                  ifFire(`${problem} ${at} with relative date operator requires a time unit. Please select a time unit to proceed.`);
                  continue;
                }
              }
              if (!c.conditionValue || (Array.isArray(c.conditionValue) && !c.conditionValue.length))
                ifFire(`${problem} ${at} is missing a condition value. Please enter a condition value to proceed.`);
            }
          }
        }
      }
    }
  }

  // ── ADVISORY (ui-disabled): combinations the UI cannot produce because the picker greys the
  // action out while the trigger is present (TriggerMain.inCompatibleActions) — nothing refuses
  // them on save, so these WARN rather than block. Vocab: catalog.workflowRules.disabledActionsByTrigger.
  for (const [trigType, acts] of Object.entries(rules?.disabledActionsByTrigger ?? {})) {
    if (!hasTrigger(trigType)) continue;
    const bad = new Set(acts);
    for (const t of T) if (bad.has(t.type)) A.push({ rule: 'inCompatibleActions', message: `'${t.name ?? t.id}' (${t.type}) is greyed out in the builder while a '${trigType}' trigger is present — the UI cannot produce this combination` });
  }

  // A rule whose INPUT is missing is reported as unjudged, never as passed.
  const notEvaluable = [];
  if (firstHook && doc.webhookReference === undefined)
    notEvaluable.push("inboundWebhookTriggerValidator (needs the webhook's mapped sample: GET /hooks/inbound-webhook-request/reference/{triggerId})");
  if (doc.senderDomain === undefined && fromEmailNeedsDomain(doc.settings?.senderAddress?.from_email))
    notEvaluable.push("checkFromEmailFormat (needs this workflow's sending domain: GET /workflow/{loc}/email/domain-selection?workflowId=…)");
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
    ...Object.keys(rules?.requiredTriggersByAction ?? {}),
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
