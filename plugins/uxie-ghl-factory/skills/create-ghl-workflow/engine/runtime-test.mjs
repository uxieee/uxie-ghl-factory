// LIVE runtime-execution test for the create-ghl-workflow engine.
//
// WHY THIS EXISTS (Bug 3, 2026-07-15): every prior check was a round-trip (compile → save →
// GET → diff) against a DRAFT. Drafts were then published by hand in the UI, so the
// publish/runtime path was never exercised in code — which is exactly how the malformed
// if_else (a step that fires fine as a draft but breaks the runtime graph compile) stayed
// invisible. This test PUBLISHES a workflow, enrols a real contact, polls the execution
// logs, and asserts the contact reaches the MATCHED branch — the only check that catches
// that class.
//
// WHY IT PROBES PER-BRANCH (2026-07-15 follow-up): the original probe added the SAME tag on
// both branches, so it only proved "got past the wait" — a condition that mis-routed a
// qualifying contact to None still looked green. That is exactly how the wrong tag shape
// (subType 'tag' + 'contains' → matches nothing → falls to None) shipped silently. This
// version tags the Match branch and the None branch DIFFERENTLY, so the logs reveal WHICH
// branch ran: reaching the None tag with a qualifying contact is a distinct 'wrong-branch'
// verdict. It probes three condition kinds — custom-field, TAG, and OPPORTUNITY-STAGE —
// because the custom-field-only probe would not have caught the tag mis-routing.
//
// It is split so the analysis logic is unit-testable OFFLINE (analyzeRun, buildRuntimeIR,
// probeConditions — see runtime-test.test.mjs) while the network round-trip (runRuntimeTest /
// the CLI) needs LIVE credentials and makes real writes to a real sub-account.
import { pathToFileURL } from 'node:url';
import { orchestrate } from './orchestrate.mjs';

// ---- pure core (unit-tested offline) --------------------------------------

const MATCH_STEP = 'Reached (Match)';
const NONE_STEP = 'Reached (None)';

// Authored if_else condition INTENT per probe kind — deliberately the SIMPLE author form,
// so the probe exercises the compiler's condition normalizer (the thing under test), not a
// hand-crafted shape. The enrolled contact is set up to satisfy the Match branch.
export const probeConditions = {
  // "custom field contains <value>" — normalizer emits contain + lowercase
  customField: (fieldId, value = 'yes') => ({ conditionType: 'contact_detail', conditionSubType: fieldId, conditionValue: value }),
  // "has tag <name>" — normalizer emits tags/index-of-true/[name] (the shape that mis-routed live)
  tag: (tagName) => ({ conditionType: 'contact_detail', tag: tagName }),
  // "opportunity is in stage <id>" — normalizer emits pipelineStageId/==/<id>
  oppStage: (stageId) => ({ conditionType: 'opportunities', stage: stageId }),
};

// Build the probe: trigger → wait 1 min → if_else(<condition>) → distinct tag per branch.
// The MATCHED (Yes) branch adds matchTag; the None branch adds noneTag. Because the tags —
// and therefore the step NAMES — DIFFER, analyzeRun can tell which branch ran. A contact
// stuck by the graph bug never reaches either tag.
export function buildRuntimeIR({ triggerTag, condition, matchTag = 'rt-matched', noneTag = 'rt-none', name = 'RUNTIME-TEST if_else probe' }) {
  if (!condition) throw new Error('buildRuntimeIR requires a `condition` (see probeConditions.*)');
  const tag = (t, step) => ({ kind: 'action', type: 'add_contact_tag', name: step, attributes: { tags: [t] } });
  return {
    name,
    triggers: [{ ref: 't', type: 'contact_tag', name: 'RT trigger tag added', filters: [{ field: 'tagsAdded', operator: 'index-of-true', value: [triggerTag] }] }],
    graph: [
      { ref: 'w', kind: 'wait', name: 'Wait 1 min', config: { unit: 'minutes', value: 1, when: 'after' } },
      { ref: 'c', kind: 'if_else', name: 'Probe condition', branches: [
        { ref: 'y', name: 'Match', conditions: [condition], then: [tag(matchTag, MATCH_STEP)] },
        { ref: 'n', name: 'None', else: true, then: [tag(noneTag, NONE_STEP)] },
      ] },
    ],
  };
}

// Classify a /workflows/logs/v2 trace (bare array, newest-first) for one contact.
// verdict: 'pass'         — reached the MATCH-branch tag (condition matched, correct routing)
//          'wrong-branch' — a QUALIFYING contact reached the NONE-branch tag (the condition
//                           mis-routed — exactly the tag-shape bug this probe exists to catch)
//          'fail'         — removed at the wait via end_of_workflow (the malformed-graph bug)
//          'pending'      — still waiting / not there yet
//          'unknown'      — no rows
// Back-compat: when matchStepName/noneStepName are omitted, reaching ANY tag is a 'pass'
// (the original single-tag probe semantics).
export function analyzeRun(logs, { contactId, matchStepName = MATCH_STEP, noneStepName = NONE_STEP } = {}) {
  const rows = (logs ?? []).filter((l) => !contactId || l.contactId === contactId);
  const isTag = (l) => l.type === 'add_contact_tag';
  const isWait = (l) => typeof l.type === 'string' && l.type.startsWith('wait');
  const reachedMatch = rows.some((l) => isTag(l) && l.stepName === matchStepName);
  const reachedNone = rows.some((l) => isTag(l) && l.stepName === noneStepName);
  const reachedTag = rows.some(isTag);
  const endedAtWait = rows.some((l) => isWait(l) && l?.meta?.removedFrom?.type === 'end_of_workflow');
  const stuckAtWait = !reachedTag && endedAtWait;
  const bySeq = [...rows].sort((a, b) => Number(b.sequence ?? 0) - Number(a.sequence ?? 0));
  const top = bySeq[0];
  const lastStep = top ? { stepId: top.stepId, stepName: top.stepName, type: top.type, status: top.status } : null;

  let verdict, reason;
  if (reachedMatch) { verdict = 'pass'; reason = 'PASS — contact reached the MATCH branch (condition matched and routed correctly).'; }
  else if (reachedNone) { verdict = 'wrong-branch'; reason = 'WRONG-BRANCH — a qualifying contact reached the NONE branch. The condition mis-matched (e.g. a wrong tag/stage shape) and mis-routed the contact. This is the class the same-tag-both-branches probe could not see.'; }
  else if (reachedTag) { verdict = 'pass'; reason = 'PASS — contact reached the add_contact_tag step (flow ran past the wait + condition).'; }
  else if (stuckAtWait) { verdict = 'fail'; reason = 'FAIL — contact hit end_of_workflow AT THE WAIT and never reached the condition/tag. This is the malformed-if_else runtime bug (the step before the container went terminal).'; }
  else if (rows.length === 0) { verdict = 'unknown'; reason = 'UNKNOWN — no log rows for this contact yet.'; }
  else { verdict = 'pending'; reason = `PENDING — contact not at a branch tag yet (last: ${lastStep?.stepName ?? '?'} / ${lastStep?.status ?? '?'}). Poll again after the 1-min wait elapses.`; }
  return { verdict, reachedMatch, reachedNone, reachedTag, stuckAtWait, lastStep, reason, rowCount: rows.length };
}

// ---- live harness (needs credentials; makes real writes) ------------------

// Minimal fetch gateway with the builder-iframe auth headers (see
// research/execution-logs-internal/README.md §1). `call` returns { status, ok, json }.
export function makeGateway({ token, loc, uid, base = 'https://backend.leadconnectorhq.com' }) {
  const headers = {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
    accept: 'application/json, text/plain, */*', channel: 'APP', source: 'WEB_USER', version: '2021-04-15',
  };
  const call = async (method, path, body, b = base) => {
    const res = await fetch(`${b}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, json };
  };
  return { call, loc, uid };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Enrol a real contact whose state SATISFIES the Match branch, per probe kind. Returns the
// new contactId. Throws on any setup failure (the caller treats that as a harness error, not
// a runtime FAIL). `spec` carries the kind-specific ids (customFieldId / probeTag /
// pipelineId+stageId). Every enrolment ends by adding `triggerTag`, which fires the workflow.
async function enrolMatchingContact(gw, { kind, email, triggerTag, spec }) {
  const { call, loc } = gw;
  const base = { locationId: loc, email, firstName: 'Runtime', lastName: 'Test' };
  if (kind === 'customField') base.customFields = [{ id: spec.customFieldId, value: spec.matchValue ?? 'yes' }];
  const created = await call('POST', '/contacts/', base);
  const contactId = created.json?.contact?.id || created.json?.id || created.json?._id;
  if (!contactId) throw new Error(`contact create failed: ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);

  if (kind === 'tag') {
    // the CONDITION tag must be present before the trigger fires — add it first, separately
    const t = await call('POST', `/contacts/${contactId}/tags`, { tags: [spec.probeTag] });
    if (!t.ok) throw new Error(`add probe tag failed: ${t.status} ${JSON.stringify(t.json).slice(0, 200)}`);
  }
  if (kind === 'oppStage') {
    // create an opportunity in the target stage so the opportunities/pipelineStageId condition matches
    const opp = await call('POST', '/opportunities/', {
      locationId: loc, pipelineId: spec.pipelineId, pipelineStageId: spec.stageId,
      contactId, name: `RT probe ${email}`, status: 'open',
    });
    if (!opp.ok && !(opp.json?.opportunity?.id || opp.json?.id)) throw new Error(`opportunity create failed: ${opp.status} ${JSON.stringify(opp.json).slice(0, 200)}`);
  }

  // adding the trigger tag fires the contact_tag trigger → enrols into the workflow
  const tagged = await call('POST', `/contacts/${contactId}/tags`, { tags: [triggerTag] });
  if (!tagged.ok) throw new Error(`add trigger tag failed: ${tagged.status} ${JSON.stringify(tagged.json).slice(0, 200)}`);
  return contactId;
}

// Full live flow for ONE probe kind. Returns a structured result; never throws on a runtime
// FAIL/WRONG-BRANCH (the caller decides exit code) — only throws on setup errors.
// `probe` = { kind: 'customField'|'tag'|'oppStage', ...ids } — see runRuntimeSuite for shapes.
export async function runRuntimeTest(gw, {
  probe, triggerTag = 'rt-trigger', matchTag = 'rt-matched', noneTag = 'rt-none',
  contactEmail, pollAttempts = 12, pollMs = 15000, log = console.log,
} = {}) {
  const { call, loc } = gw;
  if (!probe || !probe.kind) throw new Error('runRuntimeTest requires a `probe` ({ kind, ...ids }).');
  const condition = buildProbeCondition(probe);
  const ir = buildRuntimeIR({ triggerTag, condition, matchTag, noneTag, name: `RUNTIME-TEST if_else probe (${probe.kind})` });

  log(`▶ [${probe.kind}] publishing probe workflow…`);
  const report = await orchestrate(ir, gw, { publish: true });
  if (report.aborted) throw new Error(`orchestrate aborted: ${report.aborted}`);
  if (!report.wid) throw new Error(`no workflow id in report: ${JSON.stringify(report)}`);
  if (!report.published) throw new Error(`publish did not confirm published: ${JSON.stringify(report.verify?.issues)}`);
  const wid = report.wid;
  log(`  published wid=${wid} (${report.triggers.posted} trigger(s))`);

  const email = contactEmail || `rt+${probe.kind}-${wid.slice(0, 8)}@runtime-test.invalid`;
  log(`▶ [${probe.kind}] enrolling matching contact ${email}…`);
  const contactId = await enrolMatchingContact(gw, { kind: probe.kind, email, triggerTag, spec: probe });
  log(`  contactId=${contactId} enrolled (trigger '${triggerTag}')`);

  // poll the execution logs until a terminal verdict or attempts exhausted (wait is 1 min)
  log(`▶ [${probe.kind}] polling /workflows/logs/v2 (up to ${pollAttempts}×${Math.round(pollMs / 1000)}s)…`);
  let last = { verdict: 'unknown', reason: 'no poll yet' };
  for (let i = 0; i < pollAttempts; i++) {
    await sleep(pollMs);
    const r = await call('GET', `/workflows/logs/v2?locationId=${loc}&workflowId=${wid}&contactId=${contactId}&limit=50&action=first`);
    const logs = Array.isArray(r.json) ? r.json : (r.json?.logs || r.json?.data || []);
    last = analyzeRun(logs, { contactId, matchStepName: MATCH_STEP, noneStepName: NONE_STEP });
    log(`  [${i + 1}/${pollAttempts}] ${last.verdict} — ${last.lastStep?.stepName ?? 'no rows'} (${last.rowCount} rows)`);
    if (['pass', 'fail', 'wrong-branch'].includes(last.verdict)) break;
  }
  return { ...last, kind: probe.kind, wid, contactId, workflowReport: report };
}

// Map a probe descriptor to its authored condition intent.
function buildProbeCondition(probe) {
  if (probe.kind === 'customField') return probeConditions.customField(probe.customFieldId, probe.matchValue ?? 'yes');
  if (probe.kind === 'tag') return probeConditions.tag(probe.probeTag);
  if (probe.kind === 'oppStage') return probeConditions.oppStage(probe.stageId);
  throw new Error(`unknown probe kind: ${probe.kind}`);
}

// Run every probe whose credentials/ids are present. Returns { results, ok }.
export async function runRuntimeSuite(gw, { probes, log = console.log, ...opts } = {}) {
  const results = [];
  for (const probe of probes) {
    try {
      results.push(await runRuntimeTest(gw, { probe, log, ...opts }));
    } catch (e) {
      log(`✗ [${probe.kind}] harness error: ${e.message}`);
      results.push({ verdict: 'error', kind: probe.kind, reason: e.message });
    }
  }
  const ok = results.every((r) => r.verdict === 'pass');
  return { results, ok };
}

// ---- CLI entrypoint --------------------------------------------------------
// Run: GHL_TOKEN=<iframe-JWT> GHL_LOCATION=<loc> GHL_USER=<uid> \
//        GHL_CUSTOM_FIELD=<fieldId> [GHL_PROBE_TAG=<tag>] [GHL_PIPELINE=<id> GHL_STAGE=<id>] \
//        node engine/runtime-test.mjs
// Each probe runs only if its ids are present: custom-field needs GHL_CUSTOM_FIELD; the tag
// probe needs GHL_PROBE_TAG; the opportunity-stage probe needs GHL_PIPELINE + GHL_STAGE.
// Refuses to run without core creds so it can never fire accidentally in CI.
async function main() {
  const {
    GHL_TOKEN, GHL_LOCATION, GHL_USER, GHL_CUSTOM_FIELD, GHL_PROBE_TAG,
    GHL_PIPELINE, GHL_STAGE, GHL_TRIGGER_TAG, GHL_CONTACT_EMAIL,
  } = process.env;
  const missing = ['GHL_TOKEN', 'GHL_LOCATION', 'GHL_USER'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`✗ live runtime test needs env: ${missing.join(', ')}.`);
    console.error('  GHL_TOKEN = a builder-iframe Bearer JWT (referer client-app-automation-workflows…; ~1hr TTL)');
    console.error('  GHL_LOCATION = sub-account id · GHL_USER = your user id');
    console.error('  Probes: GHL_CUSTOM_FIELD=<fieldId> · GHL_PROBE_TAG=<tag> · GHL_PIPELINE=<id> GHL_STAGE=<id>');
    console.error('  Optional: GHL_TRIGGER_TAG, GHL_CONTACT_EMAIL. This PUBLISHES workflows and enrols REAL contacts.');
    process.exit(2);
  }
  const probes = [];
  if (GHL_CUSTOM_FIELD) probes.push({ kind: 'customField', customFieldId: GHL_CUSTOM_FIELD, matchValue: 'yes' });
  if (GHL_PROBE_TAG) probes.push({ kind: 'tag', probeTag: GHL_PROBE_TAG });
  if (GHL_PIPELINE && GHL_STAGE) probes.push({ kind: 'oppStage', pipelineId: GHL_PIPELINE, stageId: GHL_STAGE });
  if (!probes.length) {
    console.error('✗ no probe ids supplied — set at least GHL_CUSTOM_FIELD (and optionally GHL_PROBE_TAG, GHL_PIPELINE+GHL_STAGE).');
    process.exit(2);
  }

  const gw = makeGateway({ token: GHL_TOKEN, loc: GHL_LOCATION, uid: GHL_USER });
  try {
    const { results, ok } = await runRuntimeSuite(gw, { probes, triggerTag: GHL_TRIGGER_TAG || 'rt-trigger', contactEmail: GHL_CONTACT_EMAIL });
    console.log('\n──── runtime probe results ────');
    for (const r of results) console.log(`  ${r.kind}: ${r.verdict} — ${r.reason}${r.wid ? ` (wf ${r.wid}, contact ${r.contactId})` : ''}`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`\n✗ runtime test error: ${e.message}`);
    process.exit(3);
  }
}

// run main() only when invoked directly (not when imported by the unit test).
// Compare via pathToFileURL so a path with spaces (percent-encoded in import.meta.url) matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
