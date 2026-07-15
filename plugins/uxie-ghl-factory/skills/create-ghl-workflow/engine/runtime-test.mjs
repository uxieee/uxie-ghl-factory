// LIVE runtime-execution test for the create-ghl-workflow engine.
//
// WHY THIS EXISTS (Bug 3, 2026-07-15): every prior check was a round-trip (compile → save →
// GET → diff) against a DRAFT. Drafts were then published by hand in the UI, so the
// publish/runtime path was never exercised in code — which is exactly how the malformed
// if_else (a step that fires fine as a draft but breaks the runtime graph compile) stayed
// invisible. This test PUBLISHES a workflow, enrols a real contact, polls the execution
// logs, and asserts the contact reaches the tag — the only check that catches that class.
//
// It is split so the analysis logic is unit-testable OFFLINE (analyzeRun, buildRuntimeIR —
// see runtime-test.test.mjs) while the network round-trip (runRuntimeTest / the CLI) needs
// LIVE credentials and makes real writes to a real sub-account.
import { pathToFileURL } from 'node:url';
import { orchestrate } from './orchestrate.mjs';

// ---- pure core (unit-tested offline) --------------------------------------

// Build the canonical probe: trigger → wait 1 min → if_else(custom field) → add_tag.
// The tag is added on BOTH branches, so the contact reaches it no matter which way the
// condition resolves — the assertion we care about is "got PAST the wait+condition", not
// "took the Yes branch". A contact stuck by the bug never reaches either tag.
export function buildRuntimeIR({ triggerTag, customFieldId, matchValue = 'yes', tagToAdd, name = 'RUNTIME-TEST if_else probe' }) {
  const cond = (v) => [{ conditionType: 'contact_detail', conditionSubType: customFieldId, conditionOperator: 'contain', conditionValue: v }];
  const tag = (branchName) => ({ kind: 'action', type: 'add_contact_tag', name: `Reached (${branchName})`, attributes: { tags: [tagToAdd] } });
  return {
    name,
    triggers: [{ ref: 't', type: 'contact_tag', name: 'RT trigger tag added', filters: [{ field: 'tagsAdded', operator: 'index-of-true', value: [triggerTag] }] }],
    graph: [
      { ref: 'w', kind: 'wait', name: 'Wait 1 min', config: { unit: 'minutes', value: 1, when: 'after' } },
      { ref: 'c', kind: 'if_else', name: 'Has RT field?', branches: [
        { ref: 'y', name: 'Yes', conditions: cond(matchValue), then: [tag('Yes')] },
        { ref: 'n', name: 'None', else: true, then: [tag('None')] },
      ] },
    ],
  };
}

// Classify a /workflows/logs/v2 trace (bare array, newest-first) for one contact.
// verdict: 'pass' (reached the tag) | 'fail' (removed at the wait via end_of_workflow —
// the bug) | 'pending' (still waiting / not there yet) | 'unknown' (no rows).
export function analyzeRun(logs, { contactId } = {}) {
  const rows = (logs ?? []).filter((l) => !contactId || l.contactId === contactId);
  const isTag = (l) => l.type === 'add_contact_tag';
  const isWait = (l) => typeof l.type === 'string' && l.type.startsWith('wait');
  const reachedTag = rows.some(isTag);
  const endedAtWait = rows.some((l) => isWait(l) && l?.meta?.removedFrom?.type === 'end_of_workflow');
  const stuckAtWait = !reachedTag && endedAtWait;
  const bySeq = [...rows].sort((a, b) => Number(b.sequence ?? 0) - Number(a.sequence ?? 0));
  const top = bySeq[0];
  const lastStep = top ? { stepId: top.stepId, stepName: top.stepName, type: top.type, status: top.status } : null;

  let verdict, reason;
  if (reachedTag) { verdict = 'pass'; reason = 'PASS — contact reached the add_contact_tag step (flow ran past the wait + condition).'; }
  else if (stuckAtWait) { verdict = 'fail'; reason = 'FAIL — contact hit end_of_workflow AT THE WAIT and never reached the condition/tag. This is the malformed-if_else runtime bug (the step before the container went terminal).'; }
  else if (rows.length === 0) { verdict = 'unknown'; reason = 'UNKNOWN — no log rows for this contact yet.'; }
  else { verdict = 'pending'; reason = `PENDING — contact not at the tag yet (last: ${lastStep?.stepName ?? '?'} / ${lastStep?.status ?? '?'}). Poll again after the 1-min wait elapses.`; }
  return { verdict, reachedTag, stuckAtWait, lastStep, reason, rowCount: rows.length };
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

// Full live flow. Returns a structured result; never throws on a runtime FAIL (the caller
// decides exit code) — only throws on setup errors (publish/enrol failure).
export async function runRuntimeTest(gw, {
  triggerTag = 'rt-trigger', customFieldId, matchValue = 'yes', tagToAdd = 'rt-reached',
  contactEmail, pollAttempts = 12, pollMs = 15000, log = console.log,
} = {}) {
  const { call, loc } = gw;
  if (!customFieldId) throw new Error('runRuntimeTest requires customFieldId (a real contact custom-field id in the location).');
  const ir = buildRuntimeIR({ triggerTag, customFieldId, matchValue, tagToAdd });

  log('▶ publishing probe workflow…');
  const report = await orchestrate(ir, gw, { publish: true });
  if (report.aborted) throw new Error(`orchestrate aborted: ${report.aborted}`);
  if (!report.wid) throw new Error(`no workflow id in report: ${JSON.stringify(report)}`);
  if (!report.published) throw new Error(`publish did not confirm published: ${JSON.stringify(report.verify.issues)}`);
  const wid = report.wid;
  log(`  published wid=${wid} (${report.triggers.posted} trigger(s))`);

  // enrol a real contact: create with the matching custom field, then add the trigger tag
  const email = contactEmail || `rt+${wid.slice(0, 8)}@runtime-test.invalid`;
  log(`▶ enrolling contact ${email}…`);
  const created = await call('POST', '/contacts/', {
    locationId: loc, email, firstName: 'Runtime', lastName: 'Test',
    customFields: [{ id: customFieldId, value: matchValue }],
  });
  const contactId = created.json?.contact?.id || created.json?.id || created.json?._id;
  if (!contactId) throw new Error(`contact create failed: ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
  // adding the trigger tag fires the contact_tag trigger → enrols into the workflow
  const tagged = await call('POST', `/contacts/${contactId}/tags`, { tags: [triggerTag] });
  if (!tagged.ok) throw new Error(`add trigger tag failed: ${tagged.status} ${JSON.stringify(tagged.json).slice(0, 200)}`);
  log(`  contactId=${contactId} tagged '${triggerTag}'`);

  // poll the execution logs until pass/fail or attempts exhausted (wait is 1 min)
  log(`▶ polling /workflows/logs/v2 (up to ${pollAttempts}×${Math.round(pollMs / 1000)}s)…`);
  let last = { verdict: 'unknown', reason: 'no poll yet' };
  for (let i = 0; i < pollAttempts; i++) {
    await sleep(pollMs);
    const r = await call('GET', `/workflows/logs/v2?locationId=${loc}&workflowId=${wid}&contactId=${contactId}&limit=50&action=first`);
    const logs = Array.isArray(r.json) ? r.json : (r.json?.logs || r.json?.data || []);
    last = analyzeRun(logs, { contactId });
    log(`  [${i + 1}/${pollAttempts}] ${last.verdict} — ${last.lastStep?.stepName ?? 'no rows'} (${last.rowCount} rows)`);
    if (last.verdict === 'pass' || last.verdict === 'fail') break;
  }
  return { ...last, wid, contactId, workflowReport: report };
}

// ---- CLI entrypoint --------------------------------------------------------
// Run: GHL_TOKEN=<iframe-JWT> GHL_LOCATION=<loc> GHL_USER=<uid> GHL_CUSTOM_FIELD=<fieldId> \
//        node engine/runtime-test.mjs
// Refuses to run without creds so it can never fire accidentally in CI.
async function main() {
  const { GHL_TOKEN, GHL_LOCATION, GHL_USER, GHL_CUSTOM_FIELD, GHL_TRIGGER_TAG, GHL_CONTACT_EMAIL } = process.env;
  const missing = ['GHL_TOKEN', 'GHL_LOCATION', 'GHL_USER', 'GHL_CUSTOM_FIELD'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`✗ live runtime test needs env: ${missing.join(', ')}.`);
    console.error('  GHL_TOKEN = a builder-iframe Bearer JWT (referer client-app-automation-workflows…; ~1hr TTL)');
    console.error('  GHL_LOCATION = sub-account id · GHL_USER = your user id · GHL_CUSTOM_FIELD = a contact custom-field id');
    console.error('  Optional: GHL_TRIGGER_TAG, GHL_CONTACT_EMAIL. This PUBLISHES a workflow and enrols a REAL contact.');
    process.exit(2);
  }
  const gw = makeGateway({ token: GHL_TOKEN, loc: GHL_LOCATION, uid: GHL_USER });
  try {
    const res = await runRuntimeTest(gw, { customFieldId: GHL_CUSTOM_FIELD, triggerTag: GHL_TRIGGER_TAG || 'rt-trigger', contactEmail: GHL_CONTACT_EMAIL });
    console.log(`\n${res.reason}`);
    console.log(`workflow: ${res.wid} · contact: ${res.contactId}`);
    process.exit(res.verdict === 'pass' ? 0 : 1);
  } catch (e) {
    console.error(`\n✗ runtime test error: ${e.message}`);
    process.exit(3);
  }
}

// run main() only when invoked directly (not when imported by the unit test).
// Compare via pathToFileURL so a path with spaces (percent-encoded in import.meta.url) matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
