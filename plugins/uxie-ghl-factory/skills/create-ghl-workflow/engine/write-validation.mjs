// THE validation entry point. Every workflow write asks this — build, edit, repair, publish — and
// no path picks its own layers.
//
// WHY IT EXISTS. Until 0.84.0 each write path assembled its own checks, and publish_workflow had
// assembled fewer: it ran the engine gate and GHL's server validator but never GHL's own
// WorkflowValidator rules, so an empty workflow, or a goto with no target, published through the
// API while the builder refused it in the browser. Nobody decided that; it was simply never wired
// in, and it stayed invisible because each path looked reasonable on its own. Layers belong to the
// INTENT here, so a new path cannot quietly ship with one missing.
//
// The four layers, in the order they refuse:
//   workflow_rules  GHL's WorkflowValidator, replayed (graph-rules.mjs). Publish-only rules fire
//                   when this write publishes — which includes SAVING an already-published
//                   workflow, because that re-publishes it (use-save-workflow.ts).
//   canvas          the advanced canvas's own stored `advanceCanvasMeta.hasErrors` flag, which the
//                   builder's publish gate reads off the step (should-allow-publish-new-builder.ts).
//   engine          document-gate.mjs — the classes GHL answers valid:true on.
//   server          GHL's live validator, differential against the stored document where there is one.
//
// A build runs the offline layers BEFORE anything is created and the server layer after the empty
// draft exists, because GHL's validator needs a workflow id in its path. That is the one split,
// and it is the endpoint's shape, not a choice.
import { evaluateWorkflowRules } from './graph-rules.mjs';
import { gateDocument } from './document-gate.mjs';
import { liveValidate } from './live-validate.mjs';
import { loadCatalog } from './catalog.mjs';

export const LAYERS = ['workflow_rules', 'canvas', 'engine', 'server'];

/** Saving an already-published workflow re-publishes it, so it is judged as a publish. */
export const publishingFor = (intent, status) => intent === 'publish' || status === 'published';

/**
 * The advanced canvas stamps its own validation result onto the STEP. The builder's publish gate
 * refuses while any step or trigger carries it, so an API publish that ignores it publishes
 * exactly what the UI would not.
 */
export function canvasFindings(templates = [], triggers = []) {
  const out = [];
  const flagged = (x) => x?.advanceCanvasMeta?.hasErrors === true;
  for (const t of templates ?? []) if (flagged(t)) out.push({ check: 'CANVAS_HAS_ERRORS', stepId: t.id ?? null, stepName: t.name ?? null, type: t.type ?? null,
    message: `the advanced canvas has this step flagged (advanceCanvasMeta.hasErrors) — the builder refuses to publish while it is set` });
  for (const tr of triggers ?? []) if (flagged(tr)) out.push({ check: 'CANVAS_HAS_ERRORS', stepId: tr.id ?? null, stepName: tr.name ?? null, type: tr.type ?? null,
    message: `the advanced canvas has this TRIGGER flagged (advanceCanvasMeta.hasErrors) — the builder refuses to publish while it is set` });
  return out;
}

const findingKey = (f) => `${f.ruleId ?? ''}|${f.where ?? ''}|${f.message ?? ''}`;

/**
 * The offline layers. No I/O, so a build can ask before it creates anything.
 *
 * @param opts.intent   build | edit | repair | publish
 * @param opts.status   the workflow's CURRENT stored status; 'published' makes this a publish
 * @param opts.scope    step ids this write touched; a finding outside it is reported, not blocking
 * @param opts.waive    checks the caller already owns with its own hatch (FIELD_CAP, STEP_REF…)
 * @param opts.skipWorkflowRules true | ['ruleName'] — the rules layer's own hatch
 * @param opts.senderDomain the workflow's sending domain, when known; without it checkFromEmailFormat
 *   reports itself unjudged rather than passing
 * @param opts.webhookReference the first inbound_webhook trigger's mapped sample ({ triggerId, payload },
 *   or null when GHL has none); without it inboundWebhookTriggerValidator reports itself unjudged
 * @param opts.creationSource the stored document's creationSource; validateIfElseCondition keys on it
 * @param opts.baselineDocument the document AS STORED ({ templates, triggers, settings, status,
 *   creationSource }), for an edit or repair. When it is PUBLISHED, a finding of one of the rules GHL
 *   stops checking there (workflowRules.skipHatch.appliesTo) that the stored document already carries
 *   is reported in rules.preExisting and does not block; the same finding introduced by this write
 *   does. Every other rule blocks as before: GHL checks it on every save. Ignored on a publish
 *   (console bl-146).
 */
export function validateDocument({
  intent = 'edit', templates = [], triggers = [], settings = null, status = null, senderDomain,
  webhookReference, creationSource, baselineDocument = null,
  catalog = loadCatalog(), marketplaceTypes = null, scope = null, waive = null,
  skipWorkflowRules = false, allow = false,
} = {}) {
  const publishing = publishingFor(intent, status);
  const rulebook = catalog?.workflowRules;
  const evaluated = rulebook
    ? evaluateWorkflowRules({ templates, triggers, settings, status, publishing, senderDomain, webhookReference, creationSource }, rulebook)
    : { findings: [], advisories: [], notEvaluable: ['no rulebook in the catalog'] };
  const skipAll = skipWorkflowRules === true;
  const skipSet = new Set(Array.isArray(skipWorkflowRules) ? skipWorkflowRules : []);
  const isSkipped = (f) => skipAll || skipSet.has(f.rule);
  const skipped = evaluated.findings.filter(isSkipped);
  // WHY A BASELINE, AND WHY ONLY THESE RULES. GHL stops checking if_else / router / wait once a
  // workflow is published (its skipHatch, deliberately not mirrored: graph-rules.mjs), so published
  // documents carrying those violations exist, and saving one is judged as a publish. Without a
  // baseline, one such step froze every later edit of the workflow, including edits that never
  // touched it, unless the caller skipped the rule wholesale. GHL itself saves that edit (it skips the
  // rule); we still refuse the violation when THIS write introduces it, which is stricter than GHL
  // and never looser. Any other rule GHL checks on every save, so a pre-existing violation of it is
  // refused here exactly as the builder refuses it. The stored document is judged with the SAME
  // publishing flag and inputs, so a finding matches only when the rule and its message are identical.
  const hatched = new Set(rulebook?.skipHatch?.appliesTo ?? []);
  const baselineKeys = baselineDocument?.status === 'published' && rulebook && intent !== 'publish' && hatched.size
    ? new Set(evaluateWorkflowRules({ ...baselineDocument, publishing, senderDomain, webhookReference }, rulebook)
      .findings.filter((f) => hatched.has(f.rule)).map((f) => `${f.rule}|${f.message}`))
    : null;
  const isPreExisting = (f) => hatched.has(f.rule) && Boolean(baselineKeys?.has(`${f.rule}|${f.message}`));
  const preExistingRules = evaluated.findings.filter((f) => !isSkipped(f) && isPreExisting(f));
  const ruleFindings = evaluated.findings.filter((f) => !isSkipped(f) && !isPreExisting(f));

  const canvasAll = publishing ? canvasFindings(templates, triggers) : [];
  const outOfScope = (f) => Boolean(scope && f.stepId && !scope.has(f.stepId));
  const canvasErrors = canvasAll.filter((f) => !outOfScope(f));
  const canvasWarnings = canvasAll.filter(outOfScope);

  const engine = gateDocument(templates, { catalog, marketplaceTypes, scope, waive });

  const blockedLayers = [];
  if (ruleFindings.length) blockedLayers.push('workflow_rules');
  if (canvasErrors.length) blockedLayers.push('canvas');
  if (engine.errors.length) blockedLayers.push('engine');
  const summary = [
    ...ruleFindings.map((f) => `WORKFLOW_RULE [${f.rule}] ${f.message}`),
    ...canvasErrors.map((f) => `CANVAS '${f.stepName ?? f.stepId}': ${f.message}`),
    ...engine.errors.map((f) => `ENGINE ${f.check}: '${f.stepName ?? f.stepId ?? '?'}' (${f.type ?? '?'}): ${f.message}`),
  ].join('\n');
  return {
    intent, publishing,
    blocked: !allow && blockedLayers.length > 0,
    blockingLayer: blockedLayers[0] ?? null,
    blockedLayers,
    rules: { findings: ruleFindings, preExisting: preExistingRules, skipped, advisories: evaluated.advisories ?? [], notEvaluable: evaluated.notEvaluable ?? [] },
    canvas: { errors: canvasErrors, warnings: canvasWarnings },
    engine,
    summary,
  };
}

/**
 * Every layer, including GHL's live validator.
 *
 * @param opts.baseline a server verdict for the document AS STORED (edit, repair). With one, only
 *   findings this write INTRODUCES block — a pre-existing defect must not freeze every later edit.
 *   Build and publish pass none, so everything blocks.
 * @param opts.serverTriggers the triggers GHL's validator is shown, when they must differ from the
 *   ones the rules judge: a build leaves a flow bot's unbound entry trigger out of GHL's call, but its
 *   AI steps REQUIRE that trigger, so the rules must still see it.
 */
export async function validateForWrite({
  call, loc, wid, document, templates, triggers = [], serverTriggers, baseline = null, allow = false, creationSource, ...rest
} = {}) {
  const steps = templates ?? document?.workflowData?.templates ?? [];
  const offline = validateDocument({ ...rest, templates: steps, triggers, allow,
    creationSource: creationSource ?? document?.creationSource });
  const server = call && wid
    ? await liveValidate(call, loc, wid, { document, templates, triggers: serverTriggers ?? triggers })
    : { ran: false, why: 'no workflow id to validate against — GHL\'s validator needs one in its path' };
  let serverBlocking = [];
  if (server.ran && server.valid === false) {
    const before = new Set((baseline?.ran && baseline.valid === false ? baseline.findings : []).map(findingKey));
    serverBlocking = server.findings.filter((f) => f.severity !== 'warning' && !before.has(findingKey(f)));
  }
  const blockedLayers = [...offline.blockedLayers, ...(serverBlocking.length ? ['server'] : [])];
  const summary = [offline.summary,
    ...serverBlocking.map((f) => `GHL ${server.layer ?? ''}: ${f.where}: ${f.message}${f.ruleId ? ` [${f.ruleId}]` : ''}`)]
    .filter(Boolean).join('\n');
  return {
    ...offline,
    blocked: !allow && blockedLayers.length > 0,
    blockingLayer: blockedLayers[0] ?? null,
    blockedLayers,
    server,
    serverBlocking,
    preExisting: server.ran && baseline ? (server.findings?.length ?? 0) - serverBlocking.length : 0,
    summary,
  };
}
