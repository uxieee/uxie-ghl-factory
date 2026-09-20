#!/usr/bin/env node
/**
 * LIVE CONFORMANCE SUITE for the GHL workflow builder rail.
 *
 *   GHL_LOCATION='<locId>' node conformance.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * Every offline test in this repo runs against fixtures, so they all stay green on the day GHL
 * changes what an endpoint MEANS. The workflow rail's defects are the silent kind: a step that
 * saves, round-trips and reports errorCount 0 while doing nothing at runtime. GHL enforces a
 * validator on 51 of its 385 step types, so a clean check is usually the ABSENCE of a validator
 * rather than the presence of correctness — which means our own guards are the only thing
 * standing between an author and a dead workflow, and those guards need proving against the real
 * API, not against my assumptions about it.
 *
 * It asserts EFFECTS read back on a SEPARATE request, never status codes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * No trigger activation. No contact enrollment. A trigger is the ONLY path by which a contact can
 * enter a workflow, so an unpublished-or-published draft with ZERO triggers cannot reach anybody —
 * which is what makes the publish leg safe to run and what the suite asserts immediately before
 * publishing rather than inheriting from how the object was built. Enrolment itself stays out and
 * is reported as NOT COVERED rather than quietly skipped.
 *
 * NOTHING IS DELETED. Probe artefacts stay named TEST-CONF-* and in place; the final report lists
 * them by id for a human to remove.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeGatewayFactory, TOOLS } from '../../../mcp-internal/core/tools.mjs';
import { createExerciseLog } from '../../../mcp-internal/core/exercise-log.mjs';
import { DEFAULT_TOKEN_FILE } from '../../../mcp-internal/core/auth.mjs';
import { makeRenewer, autoRenewEnabled } from '../../../mcp-internal/core/token-renewal.mjs';
import { liveValidate } from '../engine/live-validate.mjs';
import { planReadinessChecks, runReadinessChecks } from '../engine/preflight.mjs';

const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
if (!LOCATION) {
  console.error("GHL_LOCATION is required — the sub-account to run against.\n  GHL_LOCATION='<locationId>' node conformance.mjs");
  process.exit(1);
}
const STAMP = Date.now().toString().slice(-6);
const NAME = (s) => `TEST-CONF-${s}-${STAMP}`;

const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'workflows-conformance', allowedLocations: null };
state.renewer = autoRenewEnabled(process.env) ? makeRenewer({ getTokenFile: () => state.tokenFile }) : null;
const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
const log = createExerciseLog();
// A crash mid-run must still leave a record of what had been driven up to that point — the explicit
// log.write() calls below are harmless and clearer, but this is what survives an uncaught throw.
process.on('exit', () => log.write());
const tool = (n) => log.wrap(TOOLS.find((t) => t.name === n));
const call = (n, args) => tool(n).handler({ locationId: LOCATION, ...args }, deps);

let passed = 0, failed = 0;
const left = [];
const check = (cond, m, extra) => {
  log.result(Boolean(cond), m);
  if (cond) { passed++; console.log(`  PASS  ${m}`); }
  else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); }
};

const code = (n) => ({ ref: `c${n}`, kind: 'action', type: 'custom_code', name: `Code ${n}`,
  attributes: { code: 'return {slot: 1}', language: 'javascript', output: { slot: 1 } } });
const hook = (n) => ({ ref: `h${n}`, kind: 'action', type: 'custom_webhook', name: `Hook ${n}`,
  attributes: { event: 'CUSTOM', method: 'post', url: 'https://example.com/conformance' } });
const tag = (n) => ({ ref: `t${n}`, kind: 'action', type: 'add_contact_tag', name: `Tag ${n}`,
  attributes: { tags: ['test-conf'] } });

console.log(`\nWORKFLOWS CONFORMANCE  location …${LOCATION.slice(-4)}  ${new Date().toISOString()}\n`);

// ── 1. stepIndex is per-type and 1-based, PROVEN BY READ-BACK ───────────────────────────────
// The engine emitted a global 0-based index here until 2026-09-10. A merge tag resolves N as the
// per-type 1-based index, so the reference rendered empty at runtime behind a clean write. This
// is the assertion that proves the fix against GHL rather than against the compiler's own opinion.
console.log('stepIndex numbering');
log.subject('build_workflow'); // every read-back below proves what build_workflow produced
const built = await call('build_workflow', {
  spec: { name: NAME('stepindex'), triggers: [], graph: [tag(1), code(1), hook(1), code(2)] },
});
check(built.ok === true, 'build_workflow creates a draft with two custom_code steps', built.detail);
// `wid`, not `workflowId` or `id`. Naming it wrong is not a small mistake here: the first run of
// this suite reported "1 passed, 0 failed" while every read-back below silently skipped, which is
// the exact shape of the failure the suite exists to catch. So the id is asserted, not assumed.
const wid = built.data?.wid;
check(typeof wid === 'string' && wid.length > 0,
  'the build reports the workflow id (wid) — without it every assertion below is vacuous', JSON.stringify(Object.keys(built.data ?? {})));
if (wid) left.push(`workflow ${wid} (${NAME('stepindex')})`);

if (wid) {
  const back = await call('export_workflow', { workflowId: wid });
  const tpls = back.data?.workflow?.workflowData?.templates ?? [];
  check(tpls.length === 4, 'the export reads back all four steps on a SEPARATE request', `got ${tpls.length}`);
  const idx = (t) => tpls.filter((x) => x.type === t).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((x) => x.stepIndex);
  check(JSON.stringify(idx('custom_code')) === '[1,2]',
    'GHL stores custom_code stepIndex as [1,2] — per-type, 1-based', `got ${JSON.stringify(idx('custom_code'))}`);
  check(JSON.stringify(idx('custom_webhook')) === '[1]',
    'a second producer TYPE keeps its own counter, not the global position', `got ${JSON.stringify(idx('custom_webhook'))}`);
  const counter = back.data?.workflow?.meta?.stepIndexCounter ?? null;
  check(counter?.custom_code === 2 && counter?.custom_webhook === 1,
    'meta.stepIndexCounter records NATIVE producers — the builder reads this to number the next step',
    `got ${JSON.stringify(counter)}`);
  check(!tpls.some((t) => t.stepIndex === 0),
    'no step carries stepIndex 0 — a 1-based vocabulary can never legitimately produce it');
  check(tpls.find((t) => t.type === 'add_contact_tag')?.stepIndex === undefined,
    'a non-producer carries NO stepIndex — the gate is the requiresStepIndex set, not every step');
}

// ── 2. the guards REFUSE, and refuse BEFORE writing ─────────────────────────────────────────
// A refusal is only worth anything if the document is untouched afterwards. Each of these reads
// the workflow back on a separate request and asserts the template count did not move.
console.log('\nguards refuse before writing');
log.subject('edit_workflow'); // every refusal/acceptance below is proving edit_workflow's guards
// IDS, NOT A COUNT. A count says the document moved; it cannot say WHAT moved, and those are two
// different bugs with opposite fixes. This assertion failed 1 run in 4 on 2026-09-15 (bl-129) and
// the count could not distinguish (a) the guard writing before it refuses — a release blocker —
// from (b) a lagging read of an EARLIER write on a rail with known read-after-write lag, which
// would make the test flaky and the tool innocent. The symmetric difference names the template, and
// the template names the cause: if it is the step the refused edit tried to append, it is (a).
//
// SETTLE-AWARE, and this is the fix for six assertions rather than one (bl-135). This rail has
// read-after-write lag: across 12 live runs on 2026-09-15 every intermittent failure sat
// immediately downstream of a single read taken straight after a write. One run returned an export
// with NO templates at all and took three assertions down with it. A single read is not evidence
// about a document that was just written.
//
// So: read until TWO CONSECUTIVE reads agree, and if they never do, FAIL saying exactly that. This
// is not a retry-until-green — a retry wrapper hides a real failure by construction. It establishes
// that the thing being asserted about has stopped moving, which is a precondition of the assertion
// meaning anything, and it reports loudly when that precondition cannot be met.
const exportOnce = async () => {
  const r = await call('export_workflow', { workflowId: wid });
  return { r, ids: (r.data?.workflow?.workflowData?.templates ?? []).map((t) => `${t.type}:${t.id}`) };
};
const settled = async (what = 'the document') => {
  let prev = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { r, ids } = await exportOnce();
    if (prev !== null && JSON.stringify(prev) === JSON.stringify(ids)) return { r, ids };
    prev = ids;
    await new Promise((res) => setTimeout(res, 400));
  }
  check(false, `${what} never settled — six reads, no two consecutive agreed`,
    `last read: ${JSON.stringify(prev)} — the assertions that follow are about a document still in motion`);
  return { r: null, ids: prev ?? [] };
};
const templateIds = async () => (await settled()).ids;
const diffOf = (before, after) => {
  const b = new Set(before), a = new Set(after);
  return {
    appeared: after.filter((x) => !b.has(x)),
    vanished: before.filter((x) => !a.has(x)),
  };
};
const unchangedSince = async (before, label) => {
  const after = await templateIds();
  const { appeared, vanished } = diffOf(before, after);
  const same = appeared.length === 0 && vanished.length === 0;
  check(same, label,
    same ? '' : `appeared: ${JSON.stringify(appeared)}  vanished: ${JSON.stringify(vanished)}  `
      + `(before ${before.length}, after ${after.length}) — if an APPEARED template is the step the `
      + 'refused edit tried to append, the guard wrote before refusing; if it is from an earlier '
      + 'step in this run, the read lagged and the TEST is at fault, not the tool');
  return after;
};
if (wid) {
  let before = await templateIds();

  // kind:'step' — the value our own catalogue teaches via describe_step_type
  const badKind = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [
    { op: 'appendStep', step: { kind: 'step', type: 'if_else', name: NAME('kind'),
      branches: [{ name: 'Yes', condition: { conditionType: 'contact_detail' } }] } }] });
  check(badKind.ok === false, "an unrecognised node kind ('step') is REFUSED, not compiled to an empty step", JSON.stringify(badKind.data ?? {}).slice(0, 120));
  check(/KIND_UNKNOWN|kind/i.test(`${badKind.code} ${badKind.detail}`), 'the refusal names the kind problem', badKind.detail);
  check(/describe_step_type/.test(String(badKind.detail)), 'and names the catalogue collision that taught it');
  before = await unchangedSince(before, 'the document is UNCHANGED after the refusal');

  // a trigger-filter condition smuggled onto a container through attrPatch
  const gate = await call('edit_workflow', { workflowId: wid, confirm: true, deadBranchAcknowledged: true, ops: [
    { op: 'appendStep', step: { kind: 'if_else', type: 'if_else', name: NAME('gate'), branches: [
      { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail', tag: 'test-conf' }], then: [] },
      { ref: 'n', name: 'No', else: true, then: [] }] } }] });
  check(gate.ok === true, 'a CORRECTLY authored if_else still lands — the guards are not a blanket refusal', gate.detail);

  if (gate.ok) {
    const after = await call('export_workflow', { workflowId: wid });
    const tpls2 = after.data?.workflow?.workflowData?.templates ?? [];
    const container = tpls2.find((t) => t.nodeType === 'condition-node');
    const smuggle = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [
      { op: 'modifyStep', stepId: container?.id, attrPatch: {
        branches: [{ segments: [{ conditions: [{ field: 'email', operator: 'is', value: 'a@b.com' }] }] }] } }] });
    check(smuggle.ok === false, 'modifyStep cannot smuggle a trigger-filter condition past the compiler', JSON.stringify(smuggle.data ?? {}).slice(0, 120));
    check(/COND_SHAPE|condition/i.test(`${smuggle.code} ${smuggle.detail}`), 'the refusal names the condition shape', smuggle.detail);
    // Compare the CONTAINER's branches, not the template count. The count is subject to the
    // document store settling after the previous write and produced a false failure once; the
    // branches array is what the guard actually protects.
    //
    // 2026-09-15: the FIRST guard assertion, forty lines up, was still comparing counts and failed
    // 1 live run in 4 (bl-129). This note had already identified why and the other site was never
    // migrated — so the same defect was diagnosed here, fixed here, and left in place there. Both
    // now compare identity rather than quantity.
    const post = await call('export_workflow', { workflowId: wid });
    const postContainer = (post.data?.workflow?.workflowData?.templates ?? []).find((t) => t.id === container?.id);
    check(JSON.stringify(postContainer?.attributes?.branches) === JSON.stringify(container?.attributes?.branches),
      'the container is UNCHANGED after the refusal — same branches, not merely the same step count');
  }
}

// ── 2b. the flow-entry guard, and the hatch that gets past it ────────────────────────────────
// guardFlowEntry (edit-driver.mjs) refuses any op on a conv_ai_trigger and names
// allowFlowTriggerEdit as the remedy. Until 2026-09-11 the edit_workflow schema did not declare that
// flag, so the remedy the error named could not be passed — a dead end. This proves the hatch is
// REACHABLE, with the same op sent twice and only the flag changed, and proves it with a no-change
// patch so the hatched call writes nothing.
//
// SAFETY: an agent-type flow whose conv_ai_trigger is UNBOUND (no botId condition) and INACTIVE.
// Unbound, no agent can enter it; inactive, it cannot fire at all. An unbound trigger with empty
// conditions is exactly the any-match shape that makes an ACTIVE one dangerous, so inactivity is
// asserted before anything else runs, and the section stops if it does not hold.
console.log('\nflow-entry guard and its hatch');
log.subject('build_workflow'); // proves what build_workflow produced (the unbound, inactive trigger)
const flow = await call('build_workflow', { spec: {
  name: NAME('flowentry'), workflowType: 'agent',
  triggers: [{ ref: 'ft', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [] }],
  graph: [{ ref: 'm', kind: 'action', type: 'conversationai_custom_message', name: 'Conformance message',
    attributes: { message: 'TEST-CONF flow-entry probe', waitForReply: false } }],
} });
check(flow.ok === true, 'an agent-type flow with an UNBOUND conv_ai_trigger builds', flow.detail);
const fwid = flow.data?.wid;
if (fwid) left.push(`workflow ${fwid} (${NAME('flowentry')}, agent-type, trigger unbound and inactive)`);
if (fwid) {
  const trig = (await call('export_workflow', { workflowId: fwid })).data?.workflow?.triggers
    ?? (await call('export_workflow', { workflowId: fwid })).data?.triggers ?? [];
  const entry = (Array.isArray(trig) ? trig : []).find((t) => t.type === 'conv_ai_trigger');
  const safe = entry && entry.active !== true && !(entry.conditions ?? []).some((c) => c?.field === 'botId');
  check(Boolean(safe), 'PRECONDITION: the conv_ai_trigger is inactive and bound to no agent — nothing can enter or fire it',
    JSON.stringify({ active: entry?.active, conditions: entry?.conditions }));
  if (safe) {
    log.subject('edit_workflow'); // everything below proves edit_workflow's flow-entry guard and hatch
    const op = [{ op: 'modifyTrigger', name: 'Chat Initiated', trigger: { name: 'Chat Initiated' } }];
    const guarded = await call('edit_workflow', { workflowId: fwid, confirm: true, acknowledgeDrift: true, ops: op });
    check(guarded.ok === false && /refusing to touch a conv_ai_trigger/.test(String(guarded.detail)),
      'WITHOUT the hatch, an op on the flow entry is REFUSED', String(guarded.detail).slice(0, 140));
    check(/allowFlowTriggerEdit/.test(String(guarded.detail)), 'and the refusal names the hatch as its remedy');
    const hatched = await call('edit_workflow', { workflowId: fwid, confirm: true, acknowledgeDrift: true,
      allowFlowTriggerEdit: true, ops: op });
    check(!/unsupported fields/.test(String(hatched.detail)),
      'the tool schema ACCEPTS allowFlowTriggerEdit — the remedy is reachable, not a dead end', String(hatched.detail).slice(0, 140));
    check(!/refusing to touch a conv_ai_trigger/.test(JSON.stringify(hatched)),
      'WITH the hatch, the same op gets past the guard', `${hatched.code ?? ''} ${String(hatched.detail ?? '').slice(0, 140)}`);
    check(/TRIGGER_NOOP/.test(JSON.stringify(hatched)),
      'and a no-change patch is planned as a NOOP, so the proof itself writes nothing', JSON.stringify(hatched.data?.warnings ?? hatched.warnings ?? null).slice(0, 160));
  }
}

  // validate_workflow on the same flow: GHL's own server validator. The unbound flow trigger is a
  // real defect ("Bot is required"), which makes this flow a natural fixture for it.
  if (fwid) {
    log.subject('validate_workflow'); // this whole block proves validate_workflow, via read-backs
    const before = JSON.stringify((await call('export_workflow', { workflowId: fwid })).data ?? null);
    const v = await call('validate_workflow', { workflowId: fwid });
    check(v.ok === true && v.data?.valid === false && v.data?.layer === 'trigger',
      'validate_workflow: the unbound flow trigger is refused by GHL\'s own validator, as a TRIGGER-layer verdict', JSON.stringify(v.data ?? v).slice(0, 200));
    check((v.data?.errors ?? []).some((e) => e.ruleId === 'missing-required-field' && e.triggerType === 'conv_ai_trigger'),
      'and it names the rule and the trigger, not just "invalid"');
    const stored = (await call('export_workflow', { workflowId: fwid })).data;
    const tpls = stored?.workflow?.workflowData?.templates ?? stored?.workflowData?.templates ?? stored?.templates ?? [];
    if (tpls.length) {
      const stripped = tpls.map((t, i) => (i === 0 ? { ...t, attributes: {} } : t));
      const v2 = await call('validate_workflow', { workflowId: fwid, templates: stripped });
      check(v2.data?.valid === false && v2.data?.layer === 'action',
        'validate_workflow with edited templates: stripped attributes fail the ACTION layer, before any save', JSON.stringify(v2.data ?? v2).slice(0, 200));
    } else check(false, 'the flow exported no templates to edit', JSON.stringify(stored).slice(0, 160));
    const after = JSON.stringify((await call('export_workflow', { workflowId: fwid })).data ?? null);
    check(before === after, 'validate_workflow wrote nothing: the export reads back identical after both calls');
  }

// ── 2c. the WORKFLOW VALIDATION GATE — both oracles, on every write path ─────────────────────
// GHL's own validator answers valid:true on documents that are wrong (an invented attribute key, a
// wrong inner attributes.type, an extra top-level key...), so the gate runs the engine's checks as
// well as GHL's, over the bytes each write would send. These assertions execute it against the real
// account: a real build passes both halves, an edit GHL would accept is refused by the engine half
// with nothing written, a pre-existing server finding does not freeze an unrelated edit, and publish
// refuses a workflow GHL itself calls invalid.
console.log('\nworkflow validation gate');
log.subject('build_workflow'); // these two check built.data?.validation, from section 1's build_workflow call
const gateReport = built.data?.validation;
check(gateReport?.server?.ran === true && gateReport?.server?.valid === true,
  'BUILD: section 1\'s real build went through GHL\'s validator against the empty draft, and passed',
  JSON.stringify(gateReport?.server ?? null).slice(0, 180));
check(Array.isArray(gateReport?.engine?.errors) && gateReport.engine.errors.length === 0,
  'BUILD: and through the engine half, with no finding', JSON.stringify(gateReport?.engine ?? null).slice(0, 160));
if (wid) {
  const before = (await call('export_workflow', { workflowId: wid })).data?.workflow;
  const tpls = before?.workflowData?.templates ?? [];
  const hook = tpls.find((t) => t.type === 'custom_webhook');
  const op = [{ op: 'modifyStep', stepId: hook?.id, attrPatch: { inventedGateKey: 'TEST-CONF' } }];
  // The control first: GHL's own validator, on exactly the document this edit would write. From the
  // RAW stored document, not the export: export_workflow scrubs a webhook's authorization object to the
  // string "<redacted>", and GHL rightly refuses THAT ("expected object, received string") whatever
  // else the document carries — the first run of this control measured the scrub, not the key.
  log.subject(false); // both CONTROL checks below run through a raw fetch / raw gw.call, no tool of ours — proves nothing about one
  const rawDoc = before?.fileUrl ? await (await fetch(before.fileUrl)).json() : null;
  const rawTpls = rawDoc?.workflowData?.templates ?? rawDoc?.templates ?? [];
  check(rawTpls.length === tpls.length, 'CONTROL: the raw stored document was read, unscrubbed', `raw ${rawTpls.length} vs export ${tpls.length}`);
  const edited = rawTpls.map((t) => (t.id === hook?.id ? { ...t, attributes: { ...t.attributes, inventedGateKey: 'TEST-CONF' } } : t));
  // Straight through liveValidate — the call the gate itself makes — because the raw webhook step
  // carries an `authorization` object, and validate_workflow's tool-argument credential guard refuses
  // that key by name whatever its value ({type:"NONE", data:null} here). That guard is doing its job;
  // it is simply not what this control is about.
  const gwc = deps.makeGw({ loc: LOCATION, state });
  const ghlOnly = await liveValidate((m, p, b) => gwc.call(m, p, b), LOCATION, wid, { document: rawDoc, templates: edited, triggers: [] });
  check(ghlOnly.ran === true && ghlOnly.valid === true,
    'CONTROL: GHL\'s validator calls a document with an invented attribute key VALID — the hole the engine half closes',
    JSON.stringify(ghlOnly).slice(0, 160));
  log.subject('edit_workflow'); // back to proving edit_workflow: the refusal, and the hatch past it
  const refused = await call('edit_workflow', { workflowId: wid, confirm: true, acknowledgeDrift: true, ops: op });
  check(refused.ok === false && refused.code === 'VALIDATION_FAILED' && /ATTRIBUTE_KEY/.test(String(refused.detail)) && /inventedGateKey/.test(String(refused.detail)),
    'EDIT: the same edit is REFUSED by the engine half, naming the key', `${refused.code} ${String(refused.detail).slice(0, 160)}`);
  // A FAILED READ IS NOT A MOVED VERSION. On 2026-09-19 this check failed as "version 3 -> undefined":
  // the read-back itself had not answered, and the message could not say so — it read as "the edit
  // wrote something". The read is checked first and reports its own failure.
  const afterRes = await call('export_workflow', { workflowId: wid });
  check(afterRes.ok === true, 'EDIT: the read-back after the refusal answered', `${afterRes.code} ${String(afterRes.detail ?? '').slice(0, 200)}`);
  const after = afterRes.data?.workflow;
  check(after?.version === before?.version && !JSON.stringify(after?.workflowData ?? {}).includes('inventedGateKey'),
    'EDIT: and nothing was written — the version is unmoved and the key is nowhere in the stored document',
    `version ${before?.version} -> ${after?.version}`);
  const hatched = await call('edit_workflow', { workflowId: wid, acknowledgeDrift: true, allowValidationFailure: true, ops: op });
  check(hatched.code === 'CONFIRM_REQUIRED' && JSON.stringify(hatched.data ?? {}).includes('VALIDATION BYPASSED'),
    'EDIT: allowValidationFailure lets it through to the confirm step, and still reports what it bypassed (preview only — nothing written)',
    `${hatched.code}`);
}
if (fwid) {
  log.subject('edit_workflow'); // the DIFFERENTIAL block proves edit_workflow's pre-existing-finding behaviour
  const flowTpls = (await call('export_workflow', { workflowId: fwid })).data?.workflow?.workflowData?.templates ?? [];
  const step = flowTpls[0];
  const rename = await call('edit_workflow', { workflowId: fwid, acknowledgeDrift: true,
    ops: [{ op: 'renameStep', stepId: step?.id, name: `${step?.name ?? 'step'} (gate probe)` }] });
  // Not vacuous: the server must actually have SEEN the flow's unbound trigger ("Bot is required") on the
  // planned document — which it can only do if the edit sent the workflow's triggers. The first run of
  // this assertion passed while the edit sent none, so the trigger layer was skipped and there was no
  // finding to be differential about.
  const seen = rename.data?.preview?.validation?.server;
  check(seen?.ran === true && seen?.valid === false && seen?.layer === 'trigger',
    'DIFFERENTIAL: the edit sent the flow\'s triggers, and GHL saw the unbound entry on the planned document',
    JSON.stringify(seen ?? null).slice(0, 160));
  check(rename.code === 'CONFIRM_REQUIRED' && (seen?.introduced ?? []).length === 0,
    'DIFFERENTIAL: and the edit is NOT refused for it — the stored document already had it',
    `${rename.code} ${String(rename.detail ?? '').slice(0, 120)}`);
  check(JSON.stringify(rename.data ?? {}).includes('already had'),
    'DIFFERENTIAL: and it says so, rather than hiding the pre-existing finding');
  log.subject('publish_workflow'); // this assertion proves publish_workflow refuses an invalid flow
  const pub = await call('publish_workflow', { workflowId: fwid });
  check(pub.ok === false && pub.code === 'VALIDATION_FAILED' && /Bot is required/.test(String(pub.detail)),
    'PUBLISH: the preview is refused — GHL itself calls this flow invalid, and publishing is when every finding counts',
    `${pub.code} ${String(pub.detail).slice(0, 140)}`);
}

// ── 3. repair_workflow ──────────────────────────────────────────────────────────────────────
// The riskiest tool in the plugin and, until tonight, the one with zero live proof: 12 endpoints,
// a full-document PUT of workflowData.templates, and no receipt anywhere saying it had ever been
// run against a real account.
//
// The reason it had none turns out to be that the round trip its own description recommended did
// not work. export_workflow SCRUBS on the key name without reading the value, so a custom_webhook
// comes back with attributes.authorization = "<redacted>" even though GHL stores
// {type:"NONE", data:null} and there is no credential anywhere near it. Feeding that back would
// replace a real authorization with a seven-character string, through a full-document PUT with no
// validator on the far side.
console.log('\nrepair_workflow');
if (wid) {
  log.subject('export_workflow'); // this assertion is specifically about export_workflow's own scrub behaviour
  const exported = await call('export_workflow', { workflowId: wid });
  const tpls = exported.data?.workflow?.workflowData?.templates ?? [];
  const fileUrl = exported.data?.workflow?.fileUrl;
  const webhook = tpls.find((t) => t.type === 'custom_webhook');
  const target = tpls.find((t) => t.type === 'custom_code');

  check(webhook?.attributes?.authorization === '<redacted>',
    'export_workflow SCRUBS a webhook authorization to a placeholder, on the key name alone',
    JSON.stringify(webhook?.attributes?.authorization));

  // and what GHL actually stores there — read from the document itself, not through our scrub
  log.subject(false); // a raw fetch of the stored document, not any of our tools
  let realAuth;
  if (fileUrl) {
    const raw = await (await fetch(fileUrl)).json();
    realAuth = (raw.workflowData?.templates ?? raw.templates ?? [])
      .find((t) => t.type === 'custom_webhook')?.attributes?.authorization;
    check(realAuth && typeof realAuth === 'object',
      'the STORED value is a structured object carrying no credential — the scrub was reading the key, not the value',
      JSON.stringify(realAuth));
  }

  // 1. the scrubbed export must be REFUSED, or the sanctioned round trip corrupts the step
  const renamed = `${target.name} REPAIRED`;
  const scrubbed = tpls.map((t) => (t.id === target.id ? { ...t, name: renamed } : t));
    // the scrubbed doc goes through a file too, so this proves the REDACTION refusal rather than
  // tripping the credential guard on the way in and looking like the same thing
  const scrubTmp = join(tmpdir(), `ghl-conformance-scrubbed-${STAMP}.json`);
  writeFileSync(scrubTmp, JSON.stringify({ templates: scrubbed }, null, 1), { mode: 0o600 });
  left.push(`templates file ${scrubTmp}`);
  log.subject('repair_workflow'); // everything from here proves repair_workflow, via read-backs through export_workflow
  const refused = await call('repair_workflow', { workflowId: wid, templatesPath: scrubTmp, confirm: true });
  check(refused.ok === false, 'repair_workflow REFUSES a document still carrying redaction placeholders', `${refused.code}`);
  check(/redaction placeholder/i.test(String(refused.detail)) && /authorization/.test(String(refused.detail)),
    'and names the step and the path, not just "something is redacted"', String(refused.detail).slice(0, 120));

  // 2. with the real value restored, PREVIEW must still write nothing.
  //
  // Via templatesPath, NOT inline. `authorization` is a credential-named key, and containsSecrets
  // refuses it as a tool ARGUMENT whatever it holds — including the {type:"NONE"} object GHL
  // actually stores. A file is not a tool argument, which is why templatesPath is the only way to
  // repair any workflow containing a webhook step. That is a real constraint on the tool, so the
  // suite exercises the path that works rather than the one that reads more naturally.
  const honest = scrubbed.map((t) => (t.type === 'custom_webhook'
    ? { ...t, attributes: { ...t.attributes, authorization: realAuth ?? { type: 'NONE', data: null } } } : t));
  const tmp = join(tmpdir(), `ghl-conformance-${STAMP}.json`);
  writeFileSync(tmp, JSON.stringify({ templates: honest }, null, 1), { mode: 0o600 });
  left.push(`templates file ${tmp}`);
  const preview = await call('repair_workflow', { workflowId: wid, templatesPath: tmp });
  check(preview.ok === false && /CONFIRM/i.test(String(preview.code)),
    'repair_workflow previews by default and refuses to write without confirm:true', `${preview.code}`);
  const afterPreview = await call('export_workflow', { workflowId: wid });
  check((afterPreview.data?.workflow?.workflowData?.templates ?? []).find((t) => t.id === target.id)?.name === target.name,
    'the preview really wrote NOTHING');

  // 3. the write, proven by reading the document back rather than by trusting the response
  const done = await call('repair_workflow', { workflowId: wid, templatesPath: tmp, confirm: true });
  check(done.ok === true, 'repair_workflow writes the full document with confirm:true', done.detail);

  const verify = await call('export_workflow', { workflowId: wid });
  const vt = verify.data?.workflow?.workflowData?.templates ?? [];
  check(vt.find((t) => t.id === target.id)?.name === renamed,
    'the repair LANDED — read back on a separate request', `got ${vt.find((t) => t.id === target.id)?.name}`);
  check(vt.length === tpls.length,
    'and dropped nor duplicated a step — a full-document PUT is exactly how a workflow loses one',
    `${tpls.length} before, ${vt.length} after`);
  const codes = vt.filter((t) => t.type === 'custom_code').map((t) => t.stepIndex);
  check(JSON.stringify(codes) === '[1,2]', 'stepIndex survives a full-document repair unchanged', `got ${JSON.stringify(codes)}`);

  // 4. a stale expectedVersion must be refused — two agents repairing at once otherwise clobber
  const stale = await call('repair_workflow', { workflowId: wid, templatesPath: tmp, confirm: true, expectedVersion: 1 });
  check(stale.ok === false && /VERSION/i.test(String(stale.code) + String(stale.detail)),
    'a stale expectedVersion is refused, not written over', `${stale.code}: ${String(stale.detail).slice(0, 80)}`);
}

// ── 4. publish / unpublish ──────────────────────────────────────────────────────────────────
// publish_workflow is `destructive` and was the OLDEST proof in the plugin at 61 days — last
// exercised 2026-07-11, in the same window this platform demonstrably moved its funnels auth rail.
// A publish is the one workflow write that can reach a real person, so the safety argument is
// asserted rather than assumed:
//
//   ENROLLMENT REQUIRES A TRIGGER. This draft was built with `triggers: []` and nothing has added
//   one, so a published copy has no path by which any contact can enter it. The suite CHECKS that
//   the trigger list is empty immediately before publishing and refuses to publish if it is not —
//   an assumption that guards a live send has to be re-measured at the moment it matters, not
//   inherited from how the object was created 90 seconds earlier.
//
// It is unpublished again immediately, and the final state is asserted.
console.log('\npublish / unpublish');
if (wid) {
  log.subject(false); // the cumulative object state from earlier tools, not a fresh call's effect
  const pre = await call('export_workflow', { workflowId: wid });
  const triggers = pre.data?.triggers ?? [];
  const steps = (pre.data?.workflow?.workflowData?.templates ?? []);
  const sends = steps.filter((t) => /email|sms|call|whatsapp|slack|notification|messenger/i.test(String(t.type)));

  check(triggers.length === 0,
    'PRECONDITION: the draft has ZERO triggers, so a published copy can enrol nobody',
    `found ${triggers.length} trigger(s) — refusing to publish`);
  check(sends.length === 0,
    'PRECONDITION: and no step that could message anyone even if it somehow ran',
    sends.map((t) => t.type).join(', '));

  log.subject('publish_workflow'); // covers the publish leg, whether it runs or is skipped below
  if (triggers.length === 0 && sends.length === 0) {
    const pub = await call('publish_workflow', { workflowId: wid, confirm: true });
    check(pub.ok === true, 'publish_workflow publishes a draft', pub.detail);

    const live = await call('export_workflow', { workflowId: wid });
    check(live.data?.workflow?.status === 'published',
      'the workflow reads back as published on a SEPARATE request — not merely a 200',
      `status ${live.data?.workflow?.status}`);

    log.subject('unpublish_workflows');
    const un = await call('unpublish_workflows', { workflowIds: [wid], confirm: true });
    check(un.ok === true, 'unpublish_workflows takes it back down', un.detail);

    const after = await call('export_workflow', { workflowId: wid });
    check(after.data?.workflow?.status === 'draft',
      'and it reads back as draft again — the suite leaves nothing published',
      `status ${after.data?.workflow?.status}`);
  } else {
    check(false, 'publish leg SKIPPED because a precondition failed — nothing was published');
  }
}

// ── 5. the read rail, and the two traps that make it worth having ───────────────────────────
// Added 2026-09-15. Until then this suite exercised 8 of the 27 tools on the workflows surface;
// the other 19 had no suite at all, so their proof records could never be anything but a
// carried-over label and 23 of the surface's 51 "usable" routes rested on one. Reads are cheap to
// exercise and there was no reason for them to be uncovered except that nobody had done it.
console.log('\nthe read rail');
if (wid) {
  // Settled, not a bare read: run 1951 of 2026-09-15 got an export with no templates here and took
  // get_workflow, get_workflow_digest and get_contacts_at_step down together on one short read.
  const { r: exported } = await settled('the export the read rail compares against');
  const steps = exported?.data?.workflow?.workflowData?.templates ?? [];

  log.subject('get_workflow');
  const one = await call('get_workflow', { workflowId: wid });
  check(one.data?.id === wid, 'get_workflow returns the workflow we asked for', `got ${one.data?.id}`);
  check(one.data?.name === NAME('stepindex'), 'and its name, not a placeholder', one.data?.name);
  check(one.data?.status === 'draft', 'and it agrees with the publish leg that the workflow is back to draft', one.data?.status);
  check(one.data?.stepCount === steps.length,
    'its stepCount agrees with the full export — two rails, one answer', `${one.data?.stepCount} vs ${steps.length}`);

  log.subject('get_workflow_digest');
  const dig = await call('get_workflow_digest', { workflowId: wid });
  check(dig.data?.workflowId === wid, 'get_workflow_digest answers for the same workflow', dig.detail);
  check(dig.data?.stepCount === steps.length, 'and counts the same steps as the export', `${dig.data?.stepCount} vs ${steps.length}`);
  check(dig.data?.triggersRead === true,
    'it reports that it READ the triggers — an empty trigger list means nothing if the read never happened');
  check(Array.isArray(dig.data?.triggers) && dig.data.triggers.length === 0,
    'and finds none, which is the precondition the publish leg depends on');

  log.subject('list_workflow_versions');
  const vers = await call('list_workflow_versions', { workflowId: wid, limit: 10, all: false });
  check(Array.isArray(vers.data?.versions) && vers.data.versions.length > 0,
    'list_workflow_versions returns the versions this run created — the suite edited it several times',
    `got ${vers.data?.versions?.length}`);
  check(vers.data?.count === vers.data?.versions?.length,
    'and its count matches the rows it returned, rather than a total it did not fetch');

  log.subject('get_workflow_version');
  const newest = vers.data?.versions?.[0];
  const vid = newest?.versionId ?? newest?.id ?? newest?.version;
  if (vid !== undefined) {
    const v = await call('get_workflow_version', { workflowId: wid, versionId: String(vid) });
    check(v.ok === true, 'get_workflow_version fetches a version named by list_workflow_versions', v.detail);
  } else {
    check(false, 'get_workflow_version SKIPPED — list_workflow_versions returned no usable version id',
      JSON.stringify(newest ?? {}).slice(0, 120));
  }

  // ── runtime reads against a workflow that has DEMONSTRABLY never run ──
  // These assert ZERO, and zero is only meaningful because the precondition is proven, not assumed:
  // this workflow has no triggers, and a trigger is the only path a contact can enter by. A runtime
  // read that returned rows here would mean the tool is reading somebody else's workflow.
  log.subject('get_workflow_stats');
  const st = await call('get_workflow_stats', { workflowId: wid, days: 7, stepTypes: [], includeTriggers: true, includeContactsPerStep: false });
  check(st.data?.workflowId === wid, 'get_workflow_stats answers for this workflow', st.detail);
  check(Array.isArray(st.data?.steps) && st.data.steps.length === 0,
    'and reports no step statistics for a workflow nobody has ever entered', `got ${st.data?.steps?.length}`);

  log.subject('get_workflow_logs');
  const lg = await call('get_workflow_logs', { workflowId: wid, limit: 10, allEnrollments: false, maxEnrollmentPages: 1, enrollmentTotals: false });
  check(Array.isArray(lg.data?.logs) && lg.data.logs.length === 0, 'get_workflow_logs finds no executions', `got ${lg.data?.logs?.length}`);
  check(Array.isArray(lg.data?.enrollments) && lg.data.enrollments.length === 0, 'and no enrolments — nothing can have entered a trigger-less draft');

  log.subject('get_workflow_runtime_window');
  // Epoch MILLISECONDS, not an ISO date. The tool rejects a 'YYYY-MM-DD' string outright with
  // "fromDate must be a non-negative integer epoch-millisecond value" — found by this assertion
  // failing on its first live run, which is the only reason it is written correctly here.
  const toMs = Date.now(), fromMs = toMs - 7 * 864e5;
  const rw = await call('get_workflow_runtime_window', { workflowId: wid, fromDate: fromMs, toDate: toMs,
    eventTypes: [], stepIds: [], logPageSize: 20, maxLogPages: 1, maxLogRetries: 1, maxEnrollmentPages: 1, maxStepRosterPages: 1 });
  check(rw.ok === true, 'get_workflow_runtime_window accepts an explicit date window', rw.detail);

  log.subject('get_contacts_at_step');
  const anyStep = steps[0]?.id;
  if (anyStep) {
    const at = await call('get_contacts_at_step', { workflowId: wid, stepId: String(anyStep), all: false, skip: 0, limit: 10 });
    check(at.ok === true, 'get_contacts_at_step accepts a step id taken from the export', at.detail);
  } else {
    check(false, 'get_contacts_at_step SKIPPED — the export produced no step id');
  }

  log.subject('get_trigger_logs');
  const tl = await call('get_trigger_logs', { workflowId: wid, days: 7, limit: 10, includeFailedReasons: false });
  check(Array.isArray(tl.data?.triggers) && tl.data.triggers.length === 0,
    'get_trigger_logs finds no trigger activity, because there is no trigger to have any');
}

// ── 5b. check_workflow answers about references, and the answer is not vacuous ──────────────
// bl-136: this tool reported "Resolve 0 Errors" about a workflow whose triggers pointed at a
// calendar in a DIFFERENT sub-account. It was not lying — it replays GHL's step validators, and
// GHL's step validators do not check whether a referenced object exists. The reference check is
// now wired in under its own key. Two assertions, because either alone is worthless:
//   1. it RAN. validateAssets fails OPEN by contract, returning zero errors when it could not
//      check at all, so "0 broken" and "not checked" are the same shape and must be told apart.
//   2. it DETECTS. A checker that reports zero on a clean document has proven nothing; this runs
//      the same function over a fabricated dangling reference, against a control, and requires it
//      to come back with errors. Nothing is written — the fabricated templates never leave memory.
if (wid) {
  log.subject('check_workflow');
  const chk = await call('check_workflow', { workflowId: wid });
  check(chk.data?.assetReferences?.ran === true,
    'check_workflow RAN the asset-reference check — not merely returned zero',
    chk.data?.assetReferences?.note);
  check(/asset references:/.test(String(chk.data?.headline)),
    'and the headline states that third scope, so two clean scopes cannot read as a whole-workflow verdict',
    chk.data?.headline);
  check((chk.data?.assetReferences?.errors ?? []).length === 0,
    "the suite's own workflow references nothing broken", JSON.stringify(chk.data?.assetReferences?.errors));

  // the differential, with a control
  const { validateAssets, describeFinding } = await import('../engine/asset-preflight.mjs');
  const gwDirect = deps.makeGw({ loc: LOCATION, state: deps.state });
  const probeAssets = (templates) => validateAssets((m, p, b) => gwDirect.call(m, p, b), LOCATION, { templates, triggers: [] });
  const control = await probeAssets([{ id: 's1', type: 'add_contact_tag', name: 'Control', attributes: { tags: ['test-conf'] } }]);
  const dangling = await probeAssets([{ id: 's1', type: 'create_opportunity', name: 'Dangling',
    attributes: { pipeline_id: '00000000-0000-4000-8000-000000000001',
      pipeline_stage_id: '00000000-0000-4000-8000-000000000002', status: 'open', name: 'x' } }]);
  check(control.checked === true && (control.errors ?? []).length === 0,
    'CONTROL: a step referencing nothing reports no broken references', control.skipped ?? JSON.stringify(control.errors));
  check(dangling.checked === true && (dangling.errors ?? []).length > 0,
    'TEST: the same check over a DANGLING pipeline reference reports it — the check is not vacuous',
    dangling.skipped ?? JSON.stringify((dangling.errors ?? []).map(describeFinding)));
  check((dangling.errors ?? []).some((e) => /pipeline/i.test(describeFinding(e))),
    'and names the pipeline, not just a count', JSON.stringify((dangling.errors ?? []).map(describeFinding)).slice(0, 160));

  // 🔴 TRIGGER-BORNE REFERENCES, AND THE COVERAGE ASYMMETRY. Measured 2026-09-15 with a positive
  // control. Two facts this pins, both of which cost a session to establish:
  //
  //  1. A finding can belong to a TRIGGER, and GHL reports it with stepId/stepName/stepType all
  //     null. `templates: []` below is load-bearing — with no steps at all, anything reported is
  //     trigger-borne BY CONSTRUCTION rather than by inference from a null stepId. (Null alone is
  //     only 'unattributed': a marketplace step's tag warning carries a null stepId too.) This
  //     matters downstream because tools.mjs deliberately BLOCKS an unattributed error rather than
  //     demoting it to legacy debt, so a dangling trigger calendar refuses edits to unrelated steps.
  //
  //  2. The SAME asset type is checked on a trigger and MISSED on a step: a ghost `calendarId` on
  //     an `appointment_booking` step returns clean (asset-preflight.mjs's long-standing 'confirmed
  //     MISS'), while the ghost calendar on the trigger below is caught. So coverage is per
  //     REFERENCE SITE, not per asset type — never generalise from one site to the other.
  //
  // The condition shape is VERBATIM from a live sandbox trigger. Guessed shapes do not work: five
  // variants (`calendar`, `calendar_id`, a `filters` array, a top-level `calendarId`) each returned
  // byte-identical to the control, which discriminates nothing. The real field is `calendar.id`.
  const apptTrigger = (calendarId) => ([{
    type: 'appointment', masterType: 'highlevel', name: 'Conformance appointment trigger',
    conditions: [
      { field: 'appointment.eventType', operator: '==', value: 'normal', title: 'Event type', type: 'select' },
      { field: 'calendar.id', operator: '==', value: calendarId, title: 'In calendar', type: 'select' },
      { field: 'contactMode', operator: 'is-any-of', value: ['contact'] },
    ],
  }]);
  const realCal = (await call('list_account_entities', { kinds: ['calendars'] })).data?.calendars?.[0]?.id;
  check(typeof realCal === 'string' && realCal.length > 0,
    'the account has a calendar to use as the POSITIVE CONTROL for the trigger check', String(realCal));
  if (typeof realCal === 'string' && realCal) {
    const trigControl = await validateAssets((m, p, b) => gwDirect.call(m, p, b), LOCATION,
      { templates: [], triggers: apptTrigger(realCal) });
    const trigGhost = await validateAssets((m, p, b) => gwDirect.call(m, p, b), LOCATION,
      { templates: [], triggers: apptTrigger('00000000-0000-4000-8000-000000000009') });
    check(trigControl.checked === true && (trigControl.errors ?? []).length === 0,
      'CONTROL: a trigger naming a calendar that EXISTS reports nothing',
      trigControl.skipped ?? JSON.stringify(trigControl.errors));
    const borne = (trigGhost.errors ?? []).find((e) => e.assetType === 'calendar');
    check(trigGhost.checked === true && !!borne,
      'TEST: the same trigger with a GHOST calendar is reported — trigger references are checked, '
        + 'so a clean step sweep is not a clean document',
      trigGhost.skipped ?? JSON.stringify(trigGhost.errors));
    check(!!borne && borne.stepId === null && borne.stepName === null && borne.stepType === null,
      'and it arrives with NO step attribution — the shape tools.mjs treats as document-level and BLOCKS',
      JSON.stringify(borne));
    check(!!borne && !/^workflow:/.test(describeFinding(borne)) && /unattributed/.test(describeFinding(borne)),
      'and it renders as unattributed rather than as a whole-workflow problem it is not',
      borne ? describeFinding(borne) : 'no finding');

    // The asymmetry, asserted rather than commented: same asset type, other reference site.
    const stepCal = await validateAssets((m, p, b) => gwDirect.call(m, p, b), LOCATION, {
      templates: [{ id: 's1', type: 'appointment_booking', name: 'Ghost cal step',
        attributes: { calendarId: '00000000-0000-4000-8000-000000000009' } }], triggers: [] });
    check(stepCal.checked === true && (stepCal.errors ?? []).length === 0,
      'ASYMMETRY: the same ghost calendar on a STEP is NOT caught — coverage is per reference site, '
        + 'not per asset type. A day GHL closes this gap fails here, which is the point',
      stepCal.skipped ?? JSON.stringify(stepCal.errors));
  }
}

// ── 6. the account rail ─────────────────────────────────────────────────────
// 🔴 WHAT THIS SECTION USED TO BE, AND WHY IT IS NOT THAT ANY MORE. Until 2026-09-16 there were
// two listing tools: a one-page `list_workflows` that stopped silently at the row cap, and
// `list_workflows_complete` that walked and reconciled. This section was a DIFFERENTIAL between
// them — assert the cap exists on one rail, assert the other beats it. They were merged into one
// tool, so that differential would now compare a tool against itself and discriminate nothing.
//
// What survives is the invariant that actually matters and is still checkable with one rail:
// the walk must return EVERY row it reports, and its reported total must equal the total the
// account reports for a one-row probe. A cap, if GHL brings one back, now shows up as
// complete:false or as a row/total mismatch — both of which fail here.
console.log('\nthe account rail');
log.subject('list_workflows');
// THE LIMIT IS DERIVED FROM THE ACCOUNT, NEVER A CONSTANT. Written as a literal this passed four
// runs and then failed four in a row — not because GHL changed, but because THIS SUITE had grown
// the account past it. It creates workflows on every run and tears nothing down by design.
const probe = await call('list_workflows', { pageSize: 1, maxPages: 1 });
const total = probe.data?.reportedTotal;
check(typeof total === 'number' && total > 0, 'list_workflows reports an account total', String(total));
// A one-page walk of a multi-page account MUST refuse to call itself complete. This is the
// positive control for every completeness claim below: if a truncated walk still said
// complete:true, the assertions that follow would prove nothing.
if (total > 1) {
  check(probe.data?.complete === false,
    'a 1-page budget against a larger account is complete:FALSE — a short walk never reads as a whole one',
    `complete=${probe.data?.complete} for ${total} workflows`);
  check((probe.data?.workflows ?? null) === null,
    'and it publishes a NULL roster rather than a partial list', JSON.stringify(probe.data?.workflows)?.slice(0, 40));
}

const full = await call('list_workflows', { pageSize: 100, maxPages: Math.ceil((total ?? 100) / 100) + 2 });
// The detail names every page's status: a bare FAIL here cost a run to diagnose (2026-09-19).
check(full.data?.complete === true, 'given enough budget it exhausts the pages',
  `${full.code ?? ''} ${full.data?.terminalReason ?? ''} pages=${JSON.stringify((full.data?.sourceRoutes ?? []).map((r) => r.status ?? r.failureClass))} pagination=${JSON.stringify(full.data?.pagination)} rateLimit=${JSON.stringify(full.data?.rateLimit)}`);
check(full.data?.reportedTotal === total,
  'and reconciles to the same account total the one-row probe reported', `${full.data?.reportedTotal} vs ${total}`);
const fullRows = full.data?.workflows ?? [];
check(fullRows.length === full.data?.reportedTotal,
  'it returns EVERY row it reported, which is the whole reason it exists', `${fullRows.length} of ${full.data?.reportedTotal}`);

// The filters moved onto the walk in the merge, so the reconciled total must be the total FOR
// THE FILTER — not the account total. A filter that was accepted and ignored would show up
// here as a published count equal to the unfiltered one.
const published = await call('list_workflows', { status: 'published', pageSize: 100, maxPages: 20 });
check(published.data?.complete === true, 'a filtered walk also reaches a terminal proof', published.data?.terminalReason);
check((published.data?.reportedTotal ?? 0) <= total,
  'and its reconciled total is the total FOR THE FILTER, never the account total',
  `published ${published.data?.reportedTotal} vs account ${total}`);
check((published.data?.workflows ?? []).every((w) => w.status === 'published'),
  'every row a status-filtered walk returns carries that status');

log.subject('get_account_workflow_overview');
const ov = await call('get_account_workflow_overview', { workflowIds: [], needsReviewLimit: 5 });
const ovTotal = ov.data?.statistics?.totalWorkflows;
check(typeof ovTotal === 'number' && ovTotal > 0, 'the account overview reports a total', String(ovTotal));
// ⚠️ DELIBERATELY NOT ASSERTED EQUAL. Measured 2026-09-15: the overview said 225 while BOTH listing
// rails said 165 on the same account in the same minute — a stable ~60 row disagreement about what
// "total workflows" means. Asserting either number would pick a winner before anyone has worked out
// which is right, and asserting inequality would enshrine a bug. It is recorded as console bl-132
// and reported here so a run cannot pass while quietly disagreeing with itself.
if (ovTotal !== total) {
  console.log(`  NOTE  the overview total (${ovTotal}) disagrees with the listing rails (${total}) — bl-132, undiagnosed`);
}

// ── raw_request: four shapes it refuses, and the trap note in the preview ─────────────────────
// Every refusal is for a call that answers 200 and does silent damage (or nothing). The proof that
// matters is that NOTHING IS SENT — so each case is given confirm:true.
// 🔴 THE CODE ALONE IS A ONE-WAY ERROR. fromHttp maps an upstream 422 (and a 401 naming a missing
// field) to VALIDATION_FAILED too, so if the guard were deleted and the call really went to GHL, a
// rejection would come back wearing the SAME code and this section would still print PASS. So each
// case also asserts a phrase out of the GUARD'S OWN message — `detail` is refusal.message here and
// GHL's own body there, which is what makes them separable. Delete the guard and these go red.
console.log('\nraw_request: refused shapes');
log.subject('raw_request');
{
  const GHOST = '00000000-0000-4000-8000-000000000000';
  const refused = [
    ['POST', `/workflow/${LOCATION}/${GHOST}/remove-stuck-statuses/${GHOST}`, { actionFrom: {} }, 'remove-stuck-statuses without statusIds', /evicts EVERYONE at the step/],
    ['POST', `/workflow/${LOCATION}/${GHOST}/start-workflow`, {}, 'start-workflow with an empty body', /creates a PHANTOM enrolment/],
    ['PUT', `/workflow/${LOCATION}/change-status/${GHOST}`, { status: 'published', updatedBy: 'x' }, 'the per-workflow publish door', /second publish door/],
    ['PUT', `/workflow/${LOCATION}/permission/${GHOST}`, {}, 'permission with no `permission` key', /the 200 carries no information/],
  ];
  for (const [method, path, body, label, mine] of refused) {
    const r = await call('raw_request', { method, path, body, confirm: true });
    check(r.ok === false && r.code === 'VALIDATION_FAILED' && mine.test(r.detail ?? ''),
      `raw_request REFUSES ${label} in its OWN words, even with confirm:true — so a sent-and-rejected call could not fake this`,
      `${r.code} ${String(r.detail ?? '').slice(0, 160)}`);
  }
  // CONTROL: the same route with a well-formed body is NOT refused — it reaches the confirm gate.
  const control = await call('raw_request', { method: 'PUT', path: `/workflow/${LOCATION}/permission/${GHOST}`, body: { permission: 380 } });
  check(control.code === 'CONFIRM_REQUIRED', 'CONTROL: a well-formed body on the same route reaches the confirm gate instead', control.code);
  const trap = await call('raw_request', { method: 'DELETE', path: `/workflow/${LOCATION}/split?workflowId=${GHOST}&stepId=${GHOST}` });
  check(trap.code === 'CONFIRM_REQUIRED' && /WIPES/.test(trap.data?.preview?.trap?.note ?? ''), 'the confirm preview carries the route\'s measured trap note', JSON.stringify(trap.data?.preview?.trap ?? null).slice(0, 200));
}

// ── preflight: GHL's own From-address verdict, by DIFFERENTIAL ────────────────────────────────
// TWO addresses, which must come back refused for two DIFFERENT codes: if the route ever starts
// answering one code for everything, this goes red instead of quietly reporting "allowed".
// The third leg measured 2026-09-19 — a real company domain answering `success` — is deliberately
// OMITTED: it would commit a real domain name to a public repo. engine/preflight.test.mjs covers
// that success path offline instead.
// The merge-field check below is a CONTROL: it asserts an ABSENCE (nothing planned, nothing sent),
// so it stays green even if the from_email branch is deleted and cannot detect that. The two
// differential checks carry the whole deletion-detection load.
// 🔴 The address below reaches a DELIVERABLE domain. validate-from-email is believed to send
// nothing, but see engine/preflight.mjs — that is asserted, not measured — so the local part is
// written so it cannot plausibly be a person's mailbox.
console.log('\npreflight: From-address check');
log.subject(false);
{
  const gwp = deps.makeGw({ loc: LOCATION, state });
  const verdict = async (from_email) => {
    const plan = planReadinessChecks({ settings: { senderAddress: { from_email } } }).filter((p) => p.key === 'from_email');
    return (await runReadinessChecks(plan, { call: (m, p, b) => gwp.call(m, p, b), loc: LOCATION }))[0] ?? null;
  };
  const webmail = await verdict(`test-conf-no-such-mailbox-${STAMP}@gmail.com`);
  const nodns = await verdict(`test-conf@no-such-domain-${STAMP}.example`);
  check(webmail?.checked === true && webmail.ok === false && webmail.code === 'free_webmail_blocked', 'a free-webmail From is reported NOT allowed, code free_webmail_blocked', JSON.stringify(webmail).slice(0, 220));
  check(nodns?.checked === true && nodns.ok === false && nodns.code !== 'free_webmail_blocked', 'DIFFERENTIAL: a domain with no DNS is refused for a DIFFERENT reason', JSON.stringify(nodns).slice(0, 220));
  check((await verdict('{{user.email}}')) === null, 'CONTROL: a merge-field From is not planned and nothing is sent');
}

// ── 6b. the account-level settings rail, and the three routes that answer 200 with nothing ──
// 🔴 WHY THIS SECTION EXISTS. Every route behind get_workflow_settings answers 200 whether or not
// the account holds a record, and three answer 200 with an EMPTY body (workflow-ai and
// workflow-location-setting return {}, error-notification returns a bare null). A tool over that
// rail can look perfectly healthy while telling the caller nothing, and the friendly reading —
// "the feature is off" — is a claim GHL never made. So the assertions below check the DISTINCTION
// the tool is for, not merely that it returned.
//
// These routes had reach:null before 2026-09-15 — never probed, which on the parity page looks the
// same as unreachable and is not.
console.log('\nthe account settings rail');
log.subject('get_workflow_settings');
{
  const st = await call('get_workflow_settings', { workflowId: wid });
  check(st.ok === true, 'get_workflow_settings returns', st.detail);
  const sections = ['autoSave', 'workflowAi', 'locationSettings', 'scheduledPause', 'elizaUsers', 'errorNotification'];
  check(sections.every((k) => st.data?.[k] && 'present' in st.data[k]),
    'every section carries its OWN present verdict — one rail-wide boolean could not express "3 of 6"',
    JSON.stringify(Object.keys(st.data ?? {})));
  check(sections.every((k) => st.data[k].present !== null),
    'and no section FAILED on this account', JSON.stringify(sections.filter((k) => st.data[k].present === null)));
  // The empty-body population is the point. It is allowed to be zero on some account, so this
  // asserts the CONTRACT (an empty section explains which kind of empty it is) rather than a count.
  const empties = sections.filter((k) => st.data[k].present === false);
  check(empties.every((k) => /no record on this route/.test(st.data[k].note ?? '')
    && /NOT the same as the feature being disabled/.test(st.data[k].note ?? '')),
    `an empty section says WHICH kind of empty it is and refuses the friendly misreading (${empties.length} empty here)`,
    JSON.stringify(empties.map((k) => st.data[k].note)).slice(0, 200));
  check(empties.every((k) => st.data[k].error === undefined),
    'and an empty section is not dressed up as a failure — empty and failed are different states',
    JSON.stringify(empties));
  check(/section\(s\) read/.test(st.data?.headline ?? '') && /FAILED/.test(st.data?.headline ?? ''),
    'the headline names all three populations, so a caller reading one line cannot mistake empty for clean',
    st.data?.headline);
  // A record describing zero items is PRESENT. Asserted because conflating it with an empty body
  // would make "no scheduled pauses" indistinguishable from "this route told us nothing".
  check(st.data?.scheduledPause?.present === true && st.data?.scheduledPause?.value !== null,
    'a record that describes zero items is PRESENT — {pauseConfigs: []} is an answer, not a silence',
    JSON.stringify(st.data?.scheduledPause).slice(0, 140));

  const noWf = await call('get_workflow_settings', {});
  check(noWf.ok === true && !('errorNotification' in (noWf.data ?? {})),
    'without workflowId the per-workflow section is ABSENT, not invented as empty',
    JSON.stringify(Object.keys(noWf.data ?? {})));
  check(/needs workflowId/.test(noWf.data?.readNote ?? ''),
    'and the tool says why it was not read', noWf.data?.readNote);
}

// ── set_workflow_error_alerts: read → merge → write → read back, then RESTORED ────────────────
// Location-wide state on the sandbox, so the section puts back exactly what it found and proves it.
// The write that matters is the MERGE: GHL's route replaces the list, the tool must not.
console.log('\nset_workflow_error_alerts');
log.subject('set_workflow_error_alerts');
{
  const gwe = deps.makeGw({ loc: LOCATION, state });
  const readSettings = async () => { const j = (await gwe.call('GET', `/workflow/${LOCATION}/error-notification/settings`)).json; return { isActive: j?.isActive === true, users: Array.isArray(j?.users) ? j.users : [] }; };
  const original = await readSettings();
  const usersJson = (await gwe.call('GET', `/users/?${new URLSearchParams({ locationId: LOCATION })}`)).json;
  const candidates = (usersJson?.users ?? []).map((u) => u.id ?? u._id).filter((id) => id && !original.users.includes(id));
  const ghost = await call('set_workflow_error_alerts', { addUsers: ['zzNotAUserId'], confirm: true });
  check(ghost.code === 'VALIDATION_FAILED', 'an id that is not a user of this location is REFUSED before any write', ghost.code);
  check(JSON.stringify(await readSettings()) === JSON.stringify(original), 'CONTROL: the refusal left the settings byte-identical');
  if (!candidates.length) check(false, 'the sandbox has a user who is not already a recipient — needed to prove the merge', `${original.users.length} recipient(s), no spare user`);
  else {
    const preview = await call('set_workflow_error_alerts', { addUsers: [candidates[0]] });
    check(preview.code === 'CONFIRM_REQUIRED' && JSON.stringify(await readSettings()) === JSON.stringify(original), 'without confirm it previews and writes nothing', preview.code);
    const added = await call('set_workflow_error_alerts', { addUsers: [candidates[0]], confirm: true });
    const now = await readSettings();
    check(added.ok === true && added.data?.verified === true && now.users.includes(candidates[0]) && original.users.every((u) => now.users.includes(u)),
      'MERGE: the new recipient is stored AND every original recipient survived — read from GHL, not from the tool', JSON.stringify({ before: original.users.length, after: now.users.length }));
    const restored = await call('set_workflow_error_alerts', { removeUsers: [candidates[0]], confirm: true });
    const end = await readSettings();
    check(restored.ok === true && JSON.stringify([...end.users].sort()) === JSON.stringify([...original.users].sort()) && end.isActive === original.isActive,
      'RESTORED: the settings are what this section found', JSON.stringify({ original, end }).slice(0, 240));
    // ABSOLUTE repair, not delegated to the tool under test. The restore above is RELATIVE —
    // "remove the one id we added" — computed from whatever GHL holds right now. If this section's
    // own tool had WIPED the recipient list (GHL's PUT replaces the whole array; that wipe is the
    // exact defect this section exists to catch), the restore would read the wiped state, subtract
    // one id from it, and leave []: it would report the wipe correctly but could never undo it,
    // because the safety net would depend on the correctness of the thing it is testing. So compare
    // the settings actually on GHL against the `original` snapshot and, if they differ in EITHER
    // field, write the snapshot back directly through the gateway — no tool, no merge, no reliance
    // on set_workflow_error_alerts being right.
    const after = await readSettings();
    const usersDiffer = JSON.stringify([...after.users].sort()) !== JSON.stringify([...original.users].sort());
    const activeDiffers = after.isActive !== original.isActive;
    if (usersDiffer || activeDiffers) {
      if (usersDiffer) await gwe.call('PUT', `/workflow/${LOCATION}/error-notification/settings/users`, { users: original.users });
      if (activeDiffers) await gwe.call('PUT', `/workflow/${LOCATION}/error-notification/settings/is-active`, { isActive: original.isActive });
    }
    const final = await readSettings();
    check(JSON.stringify([...final.users].sort()) === JSON.stringify([...original.users].sort()) && final.isActive === original.isActive,
      'the sandbox is left exactly as found — a direct write, independent of the tool under test',
      JSON.stringify({ original, final }).slice(0, 240));
  }
}

log.subject('list_workflow_templates');
{
  const t = await call('list_workflow_templates', {});
  check(t.ok === true, 'list_workflow_templates returns', t.detail);
  check(Number.isInteger(t.data?.count) && t.data.count > 0,
    'and GHL offers templates on this account — a zero here would mean the bare-ARRAY response shape drifted',
    JSON.stringify(t.data?.count));
  check(t.data.count === (t.data.templates ?? []).length,
    'the count is the rows, not a number from the envelope', `${t.data?.count} vs ${(t.data?.templates ?? []).length}`);
  check((t.data.templates ?? []).every((x) => typeof x.id === 'string' && x.id && typeof x.title === 'string' && x.title),
    'every template carries an id and a title — the two fields that make the list actionable',
    JSON.stringify((t.data.templates ?? []).filter((x) => !x.id || !x.title).slice(0, 3)));
}

// ── 6c. the ES index: two counts that are not the same number ───────────────────────────────
// 🔴 THE POINT. POST /workflows/es/search indexes one document per STEP and per TRIGGER, so its
// `count` is DOCUMENTS — 4161 unfiltered on an account holding 224 workflows. find_workflows_using
// exposes two modes over it and they count different things; a caller who reads one as the other is
// wrong by a large factor, silently. These assertions pin the DIFFERENCE, not either number.
console.log('\nthe workflow content index');
// ── inbound webhook: the ONE fixture with a trigger ─────────────────────────────────────────
// Every other build here is trigger-less by design. This one carries an inbound_webhook trigger and
// the whole section is fenced by the two facts that keep it harmless: the workflow stays a DRAFT and
// the trigger stays INACTIVE — both asserted AFTER the pin, because "we did not activate it" is a
// claim about the account, not about our intentions. A draft enrols nobody, so the sample POST is
// recorded as a request and goes nowhere else.
console.log('\ninbound webhook sample');
log.subject('build_workflow');
const hookBuilt = await call('build_workflow', { spec: { name: NAME('webhook'),
  triggers: [{ ref: 'wh', type: 'inbound_webhook', name: 'TEST-CONF inbound (stays inactive)', filters: [] }],
  graph: [{ ref: 'w', kind: 'wait', name: 'Wait 1 day', config: { unit: 'days', value: 1, when: 'after' } }] } });
const hwid = hookBuilt.data?.wid;
// The build's report IS `data` — `data.webhookUrls`, not `data.report.webhookUrls`. The first run of
// this section read the wrong level, found no id, and skipped every assertion below it.
const htid = hookBuilt.data?.webhookUrls?.[0]?.triggerId ?? hookBuilt.data?.triggers?.ids?.[0];
check(hookBuilt.ok === true && typeof htid === 'string', 'build_workflow creates a draft with an inbound_webhook trigger and reports its id',
  `${hookBuilt.code ?? ''} ${String(hookBuilt.detail ?? '').slice(0, 160)} ${JSON.stringify(hookBuilt.data?.triggers ?? null).slice(0, 120)}`);
if (hwid) left.push(`workflow ${hwid} (${NAME('webhook')}, inbound_webhook trigger INACTIVE, one pinned sample)`);
if (hwid && htid) {
  log.subject('pin_webhook_sample');
  const sample = { probe: `TEST-CONF-${STAMP}`, nested: { n: 1 }, list: ['a'] };
  const gwh = deps.makeGw({ loc: LOCATION, state });
  const listed = () => gwh.call('GET', `/hooks/inbound-webhook-request/trigger/${htid}?${new URLSearchParams({ limit: '10', locationId: LOCATION })}`);
  const preview = await call('pin_webhook_sample', { workflowId: hwid, triggerId: htid, samplePayload: sample });
  const afterPreview = await listed();
  check(preview.ok === true && preview.data?.preview === true && Array.isArray(afterPreview.json) && afterPreview.json.length === 0,
    'without confirm it is a PREVIEW, and nothing was posted — the trigger still has zero recorded requests',
    `preview=${preview.data?.preview} recorded=${JSON.stringify(afterPreview.json)?.slice(0, 80)}`);
  const pinned = await call('pin_webhook_sample', { workflowId: hwid, triggerId: htid, samplePayload: sample, confirm: true });
  check(pinned.ok === true, 'with confirm it posts the sample, finds it, and pins it', `${pinned.code ?? ''} ${String(pinned.detail ?? '').slice(0, 200)}`);
  const tags = JSON.stringify(pinned.data ?? {});
  check(tags.includes('{{inboundWebhookRequest.nested.n}}') && tags.includes('{{inboundWebhookRequest.probe}}'),
    'and returns the merge tags the payload makes real, nested paths included', tags.slice(0, 200));
  // READ BACK ON A SEPARATE REQUEST, not from the tool's own answer.
  const ref = await gwh.call('GET', `/hooks/inbound-webhook-request/reference/${htid}?${new URLSearchParams({ locationId: LOCATION })}`);
  check(ref.ok === true && JSON.stringify(ref.json ?? {}).includes(sample.probe),
    'READ-BACK: the trigger\'s reference, fetched separately, carries THIS run\'s payload', `${ref.status} ${JSON.stringify(ref.json ?? null).slice(0, 120)}`);
  // CONTROL: a trigger that does not exist must not "succeed". Same tool, same payload.
  // This control is why the tool takes a workflowId at all: GHL itself accepts a sample for ANY id.
  const GHOST = 'zzNotATriggerId000000';
  const ghost = await call('pin_webhook_sample', { workflowId: hwid, triggerId: GHOST, samplePayload: sample, confirm: true, maxPolls: 1, pollMs: 500 });
  check(ghost.ok === false && /Nothing was posted/.test(String(ghost.detail)), 'CONTROL: the same call against a trigger id that does not exist is REFUSED', `${ghost.ok} ${ghost.code ?? ''}`);
  log.subject(false);
  const ghostRows = await gwh.call('GET', `/hooks/inbound-webhook-request/trigger/${GHOST}?${new URLSearchParams({ limit: '10', locationId: LOCATION })}`);
  const mine = (Array.isArray(ghostRows.json) ? ghostRows.json : []).filter((r) => JSON.stringify(r?.payload ?? {}).includes(sample.probe));
  log.subject('pin_webhook_sample');
  check(mine.length === 0, 'and the refusal came BEFORE the POST — no request carrying this run\'s payload was recorded against the ghost id', `recorded=${mine.length}`);
  // THE FENCE, asserted last.
  log.subject(false);
  const fenceRes = await call('export_workflow', { workflowId: hwid });
  check(fenceRes.ok === true, 'FENCE: the read that the fence rests on answered', `${fenceRes.code ?? ''} ${String(fenceRes.detail ?? '').slice(0, 240)}`);
  const fence = fenceRes.data;
  const trig = (fence?.triggers ?? []).find((t) => (t.id ?? t._id) === htid);
  check(fence?.workflow?.status === 'draft' && trig && trig.active !== true,
    'FENCE: after all of it the workflow is still a DRAFT and the trigger is still INACTIVE', `status=${fence?.workflow?.status} active=${trig?.active}`);
}

// ── scheduler preview: a trigger that fires, and one that NEVER does ────────────────────────
// Both triggers are inactive on a draft. The second is a real authoring mistake — days with no
// times — that saves, validates and publishes cleanly and that GHL computes zero executions for.
console.log('\nscheduler preview');
log.subject('build_workflow');
const schedBuilt = await call('build_workflow', { spec: { name: NAME('scheduler'),
  triggers: [
    { ref: 'fires', type: 'scheduler_trigger', name: 'TEST-CONF mondays 09:00', filters: [
      { field: 'scheduler.interval', value: 'weekly' }, { field: 'scheduler.weekly.days', value: ['monday'] }, { field: 'scheduler.weekly.times', value: ['09:00'] }] },
    { ref: 'never', type: 'scheduler_trigger', name: 'TEST-CONF days but no times', filters: [
      { field: 'scheduler.interval', value: 'weekly' }, { field: 'scheduler.weekly.days', value: ['monday'] }] }],
  graph: [{ ref: 'w', kind: 'wait', name: 'Wait 1 day', config: { unit: 'days', value: 1, when: 'after' } }] } });
const swid = schedBuilt.data?.wid;
check(schedBuilt.ok === true && typeof swid === 'string', 'build_workflow creates a draft with two scheduler triggers', `${schedBuilt.code ?? ''} ${String(schedBuilt.detail ?? '').slice(0, 200)}`);
if (swid) {
  left.push(`workflow ${swid} (${NAME('scheduler')}, two scheduler triggers INACTIVE)`);
  log.subject('check_workflow');
  const london = await call('check_workflow', { workflowId: swid, timezone: 'Europe/London' });
  const rows = london.data?.schedulerPreview ?? [];
  const fires = rows.find((r) => /mondays/.test(r.name ?? '')), never = rows.find((r) => /no times/.test(r.name ?? ''));
  check(london.ok === true && rows.length === 2 && rows.every((r) => r.checked === true), 'check_workflow previews BOTH scheduler triggers through GHL', JSON.stringify(rows.map((r) => [r.name, r.checked])));
  const inLondon = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  check(fires?.neverFires === false && fires.executions.length > 0 && fires.executions.every((e) => /^Monday.*09:00$/.test(inLondon(e))),
    'the Monday 09:00 trigger: every instant GHL returns IS a Monday 09:00 in the zone asked for', JSON.stringify((fires?.executions ?? []).slice(0, 2).map(inLondon)));
  check(never?.neverFires === true && never.executions.length === 0,
    '🔴 the days-with-no-times trigger is reported neverFires — it built, and GHL computes no run for it', JSON.stringify(never ?? null).slice(0, 160));
  const sydney = await call('check_workflow', { workflowId: swid, timezone: 'Australia/Sydney' });
  const sFires = (sydney.data?.schedulerPreview ?? []).find((r) => /mondays/.test(r.name ?? ''));
  check(sFires?.executions?.[0] && sFires.executions[0] !== fires?.executions?.[0],
    'DIFFERENTIAL: the same trigger previewed in another zone gives DIFFERENT instants — the zone is really read', `${fires?.executions?.[0]} vs ${sFires?.executions?.[0]}`);
  log.subject(false);
  const sFence = (await call('export_workflow', { workflowId: swid })).data;
  check(sFence?.workflow?.status === 'draft' && (sFence?.triggers ?? []).every((t) => t.active !== true),
    'FENCE: still a DRAFT, both scheduler triggers still INACTIVE', `status=${sFence?.workflow?.status}`);
}

// ── GHL's FIRST-PARTY panel items: steps and triggers that arrive through the marketplace list ──
// 138 of them were unbuildable: refused as "app not installed" (there is no app), and their
// triggers emitted masterType 'marketplace', which GHL's validator rejects. Both fixed 2026-09-19.
console.log('\nfirst-party marketplace items');
log.subject('build_workflow');
const fpBuilt = await call('build_workflow', { spec: { name: NAME('firstparty'),
  triggers: [{ ref: 'ev', type: 'event_registration', marketplace: true, name: 'TEST-CONF event registration (inactive)', filters: [] }],
  graph: [
    { ref: 'c', kind: 'action', type: 'internal_comment_action', marketplace: true, name: 'Internal comment', attributes: { message_rich_text: '<p>TEST-CONF</p>' } },
    { ref: 'good', kind: 'action', type: 'workflow_ai_analyze_image', marketplace: true, name: 'Image VALID url', attributes: { model: 'gpt-5.6-luna', image: 'https://example.com/a.png', prompt: 'Describe it.', detailLevel: 'auto' } },
    { ref: 'bad', kind: 'action', type: 'workflow_ai_analyze_image', marketplace: true, name: 'Image INVALID url', attributes: { model: 'gpt-5.6-luna', image: 'not a url', prompt: 'Describe it.', detailLevel: 'auto' } }] } });
const fpwid = fpBuilt.data?.wid;
check(fpBuilt.ok === true && typeof fpwid === 'string', 'build_workflow builds first-party marketplace items — no "app not installed" refusal', `${fpBuilt.code ?? ''} ${String(fpBuilt.detail ?? '').slice(0, 220)}`);
if (fpwid) {
  left.push(`workflow ${fpwid} (${NAME('firstparty')}, event_registration trigger INACTIVE)`);
  log.subject(false);
  const fp = (await call('export_workflow', { workflowId: fpwid })).data;
  const fpTrig = (fp?.triggers ?? [])[0];
  log.subject('build_workflow');
  check(fpTrig?.masterType === 'internal' && fpTrig?.type === 'event_registration',
    'READ-BACK: the trigger is stored masterType "internal" — GHL\'s validator refuses "marketplace" on a first-party trigger', `${fpTrig?.type} / ${fpTrig?.masterType}`);
  const fpStep = (fp?.workflow?.workflowData?.templates ?? []).find((t) => t.type === 'internal_comment_action');
  check(fpStep?.workflowsActionType === 'INTERNAL' && !('isMarketplaceAction' in (fpStep ?? {})),
    'READ-BACK: the first-party STEP is stored with workflowsActionType "INTERNAL" and NOT isMarketplaceAction — the builder writes exactly one of the two, and the wrong one is skipped at runtime',
    JSON.stringify({ workflowsActionType: fpStep?.workflowsActionType, isMarketplaceAction: fpStep?.isMarketplaceAction }));
  check(fp?.workflow?.status === 'draft' && fpTrig?.active !== true, 'FENCE: still a DRAFT, trigger INACTIVE', `status=${fp?.workflow?.status} active=${fpTrig?.active}`);
  log.subject('check_workflow');
  const fpCheck = await call('check_workflow', { workflowId: fpwid });
  const errsFor = (name) => (fpCheck.data?.errors ?? []).filter((e) => (e.step ?? e.name ?? e.stepName) === name);
  check(fpCheck.ok === true && errsFor('Image VALID url').length === 0,
    'check_workflow reports NO schema error on a valid https URL and a non-empty prompt (isValidURL and "/\\S/" used to be run as regex source and failed every value)',
    JSON.stringify(errsFor('Image VALID url')).slice(0, 200));
  check(errsFor('Image INVALID url').length > 0,
    'CONTROL: the same step with "not a url" IS reported — the rule is enforced, not switched off', JSON.stringify(fpCheck.data?.errors ?? []).slice(0, 200));
}

log.subject('list_account_entities');
{
  // The sweep must agree with a RAW read of the same endpoint — ids and names, not just a count —
  // so a projection that silently maps the wrong keys cannot pass. The expectation comes off the
  // account: a suite that hard-codes "one event" passes until somebody adds a second.
  const swept = await call('list_account_entities', { kinds: ['events', 'eventTickets'] });
  log.subject(false);
  const rawEv = await deps.makeGw({ loc: LOCATION, state }).call('GET', `/events-management/events/options?${new URLSearchParams({ locationId: LOCATION })}`);
  log.subject('list_account_entities');
  const want = (rawEv.json?.events ?? []).map((e) => `${e.value}|${e.label}`).sort();
  const got = (swept.data?.events ?? []).map((e) => `${e.id}|${e.name}`).sort();
  check(swept.ok === true && rawEv.ok === true && JSON.stringify(got) === JSON.stringify(want),
    'list_account_entities returns the account\'s EVENTS, id-for-id and name-for-name with a raw read', `${got.length} vs raw ${want.length}`);
  check(want.length > 0, 'and the account holds at least one event, so that agreement is not two empty lists agreeing', String(want.length));
  check(Array.isArray(swept.data?.eventTickets), 'eventTickets comes back as a list (possibly empty) from the same sweep', JSON.stringify(swept.data?.eventTickets)?.slice(0, 60));
}

log.subject('search_merge_tags');
{
  // Three claims, each with its control: the static inventory answers with no account at all; a
  // locationId JOINS this account's own fields and values in; and a nonsense phrase returns
  // nothing — without that last one, "it found tags" would be true of a tool that returns the
  // same ten rows for every question.
  const offline = await call('search_merge_tags', { intent: 'contact first name', locationId: undefined });
  const live = await call('search_merge_tags', { intent: 'contact first name' });
  const nonsense = await call('search_merge_tags', { intent: 'zzqx vrrk plomb' });
  check(offline.ok === true && (offline.data?.tags ?? []).length > 0 && offline.data.tags.every((t) => /^\{\{.+\}\}$/.test(t.tag)),
    'search_merge_tags answers from the static picker inventory, and every hit is a {{tag}}', JSON.stringify(offline.data?.searched));
  check(nonsense.ok === true && (nonsense.data?.tags ?? []).length === 0,
    'CONTROL: a nonsense phrase finds NOTHING — the ranking discriminates', JSON.stringify((nonsense.data?.tags ?? []).slice(0, 2)));
  check((live.data?.searched?.perLocation ?? 0) > 0 && !(offline.data?.searched?.perLocation > 0),
    'DIFFERENTIAL: with a locationId the account\'s own fields and values are joined in; without one they are not',
    JSON.stringify([offline.data?.searched, live.data?.searched]));
  // A per-location tag must be FINDABLE, not merely counted. The name comes off the account, never
  // a literal: a suite that hard-codes a custom value passes until somebody renames it.
  log.subject(false); // a raw read, to learn a name — proves nothing about the tool
  const gwm = deps.makeGw({ loc: LOCATION, state });
  const cv = await gwm.call('GET', `/locations/${LOCATION}/customValues`);
  const named = (cv.json?.customValues ?? []).find((v) => typeof v?.name === 'string' && v.name.trim().split(/\s+/).length >= 2);
  log.subject('search_merge_tags');
  if (named) {
    const hit = await call('search_merge_tags', { intent: named.name, limit: 10 });
    check((hit.data?.tags ?? []).some((t) => t.source !== 'picker'),
      'and a custom value that exists on the account is FOUND by its own name, marked as not-from-the-picker',
      JSON.stringify((hit.data?.tags ?? []).map((t) => t.source)));
  } else {
    check(false, 'the account holds a custom value with a multi-word name to search for', `customValues: ${(cv.json?.customValues ?? []).length}`);
  }
}

log.subject('find_workflows_using');
{
  // A step type the suite's own build guarantees exists, so this cannot pass vacuously on an
  // account that happens to hold none.
  const TYPE = 'wait';
  const wfs = await call('find_workflows_using', { types: [TYPE] });
  const steps = await call('find_workflows_using', { types: [TYPE], returns: 'steps' });
  check(wfs.ok === true && steps.ok === true, 'find_workflows_using answers in both modes',
    JSON.stringify([wfs.detail, steps.detail]));
  check(Number.isInteger(wfs.data?.count) && wfs.data.count > 0,
    `and finds workflows using '${TYPE}' — a zero would mean the index or the join shape moved`,
    JSON.stringify(wfs.data?.count));
  check(/workflows/.test(wfs.data?.countIs ?? '') && /documents/.test(steps.data?.countIs ?? ''),
    'each mode SAYS which thing it counted, in the payload rather than only in the docs',
    JSON.stringify([wfs.data?.countIs, steps.data?.countIs]));
  check(steps.data.count >= wfs.data.count,
    'step documents are never FEWER than the workflows holding them — the invariant that makes the '
      + 'two counts distinguishable at a glance',
    `${steps.data?.count} steps vs ${wfs.data?.count} workflows`);
  check((wfs.data?.workflows ?? []).every((w) => w.id && w.name),
    'every workflow row carries an id and a name, so the answer is actionable without a second read',
    JSON.stringify((wfs.data?.workflows ?? []).filter((w) => !w.id || !w.name).slice(0, 3)));
  check((steps.data?.steps ?? []).every((x) => x.workflowId && x.stepId),
    'and every step row says WHICH workflow it lives in — otherwise the match is unactionable',
    JSON.stringify((steps.data?.steps ?? []).filter((x) => !x.workflowId || !x.stepId).slice(0, 3)));

  // 🔴 NEGATIVE CONTROL. Without it, an index that silently returned everything, or nothing, would
  // pass every assertion above.
  const ghost = await call('find_workflows_using', { types: ['TEST-CONF-no-such-step-type'] });
  check(ghost.ok === true && ghost.data?.count === 0 && (ghost.data?.workflows ?? []).length === 0,
    'CONTROL: a step type that does not exist matches NOTHING — the filter is real, not ignored',
    JSON.stringify(ghost.data?.count));

  const empty = await call('find_workflows_using', { types: [] });
  check(empty.ok === false, 'an empty type list is REFUSED rather than matching the whole index', empty.code);
}

// ── 6d. the marketplace and ai_agent option rails ───────────────────────────────────────────
// 🔴 BOTH OF THESE RAILS SAY "NO SUCH THING" WITH A 200. The marketplace action route answers 200
// carrying only a traceId for a key that does not exist, and the agent rail wraps failures as
// {success:false} inside a 200. A tool over either can look healthy while describing nothing, so
// these assertions check the REFUSAL as hard as the success.
console.log('\nthe marketplace and agent option rails');
log.subject('describe_marketplace_action');
{
  const apps = await call('list_marketplace_apps', {});
  const key = (apps.data?.apps ?? apps.data?.installed ?? [])
    .flatMap((a) => a.actions ?? []).map((x) => x.key).find(Boolean);
  check(apps.ok === true, 'list_marketplace_apps answers, so a real action key can be derived rather than hardcoded', apps.detail);
  if (key) {
    const d = await call('describe_marketplace_action', { actionKey: key });
    check(d.ok === true, `describe_marketplace_action resolves a REAL key ('${key}')`, d.detail);
    check(typeof d.data?.appId === 'string' && d.data.appId.length > 0,
      'and names the owning app, which is what makes the install status readable', JSON.stringify(d.data?.appId));
    check(d.data?.app && 'installed' in d.data.app,
      'and reports whether that app is installed here — false is an ANSWER, not an error',
      JSON.stringify(d.data?.app));
  } else {
    check(false, 'the account exposes at least one marketplace action key to test against',
      'no installed app declared an action key — cannot test this rail vacuously');
  }
  // 🔴 THE CONTROL THAT MATTERS. Without it, a tool that described every key as an empty schema
  // would pass everything above.
  const ghost = await call('describe_marketplace_action', { actionKey: 'TEST-CONF-no-such-action-key' });
  check(ghost.ok === false && /no marketplace action published/.test(ghost.detail ?? ''),
    'CONTROL: an unknown key is REFUSED — this rail answers 200 with an empty body, so a tool that '
      + 'trusts the status describes actions that do not exist',
    `${ghost.ok} ${String(ghost.detail).slice(0, 80)}`);
  const native = await call('describe_marketplace_action', { actionKey: 'wait' });
  check(native.ok === false, 'and a NATIVE step type is refused too — it is not on this rail at all', native.code);
}

log.subject('get_ai_agent_options');
{
  const a = await call('get_ai_agent_options', {});
  check(a.ok === true, 'get_ai_agent_options answers', a.detail);
  check(Number.isInteger(a.data?.models?.count) && a.data.models.count > 0,
    'and the account can pick at least one model — a zero here means the envelope shape moved',
    JSON.stringify(a.data?.models?.count ?? a.data?.models));
  check(typeof a.data?.models?.defaultModelId === 'string' && a.data.models.defaultModelId,
    'and names the DEFAULT model, which is what an ai_agent step gets when it names none',
    JSON.stringify(a.data?.models?.defaultModelId));
  check((a.data?.models?.models ?? []).every((m) => m.id && typeof m.contextWindow === 'number'),
    'every model carries an id and a context window — the two facts that decide whether a prompt fits',
    JSON.stringify((a.data?.models?.models ?? []).filter((m) => !m.id || typeof m.contextWindow !== 'number').slice(0, 2)));
  check(Number.isInteger(a.data?.mcpConnections?.count) && Number.isInteger(a.data?.oauth2Tokens?.count),
    'MCP connections and their oauth tokens both report a COUNT — zero is a real answer here, and is '
      + 'why an ai_agent step referencing a connectionId on this account would not resolve',
    JSON.stringify([a.data?.mcpConnections?.count, a.data?.oauth2Tokens?.count]));
  check(/10 COMBINED/.test(a.data?.toolCapNote ?? ''),
    'and the response carries the 10-tool cap, which is shared between built-in tools and MCP connections',
    a.data?.toolCapNote);
}

// ── 7. folders, and moving something into one ───────────────────────────────────────────────
console.log('\nfolders');
log.subject('list_workflow_folders');
const beforeFolders = await call('list_workflow_folders', { limit: 100, offset: 0 });
check(Array.isArray(beforeFolders.data?.folders), 'list_workflow_folders returns folders', beforeFolders.detail);
check((beforeFolders.data?.folders ?? []).every((f) => f.type === 'directory'),
  "every row is type 'directory' — the listing is filtered, not a mixed bag of workflows and folders");

log.subject('create_workflow_folder');
const folder = await call('create_workflow_folder', { name: NAME('folder'), confirm: true });
const fid = folder.data?.id ?? folder.data?.folderId ?? folder.data?.directoryId;
check(folder.ok === true, 'create_workflow_folder creates a folder', folder.detail);
check(typeof fid === 'string' && fid.length > 0,
  'and reports its id — without one the read-back below would be vacuous', JSON.stringify(Object.keys(folder.data ?? {})));
if (fid) {
  left.push(`folder ${fid} (${NAME('folder')})`);
  const afterFolders = await call('list_workflow_folders', { limit: 100, offset: 0 });
  check((afterFolders.data?.folders ?? []).some((f) => f.id === fid),
    'the folder reads back in a SEPARATE listing — not merely a 200 on the create');
}

// ── rename, both kinds ──────────────────────────────────────────────────────────────────────
// A wrong name used to be permanent: the rule is iterate-in-place, never spawn a v2, and nothing
// could fix a FOLDER's name without the UI. The workflow rename (updateSettings.name) shipped long
// before and had never been run live by this suite.
if (fid) {
  log.subject('create_workflow_folder');
  const RENAMED = NAME('folder-renamed');
  const ghostFolder = await call('create_workflow_folder', { folderId: 'zzNotAFolderId', name: RENAMED, confirm: true });
  check(ghostFolder.ok === false, 'CONTROL: renaming a folder id that does not exist is refused', `${ghostFolder.ok} ${ghostFolder.code ?? ''}`);
  const foldersBefore = (await call('list_workflow_folders', { limit: 200, offset: 0 })).data?.folders ?? [];
  const renamedFolder = await call('create_workflow_folder', { folderId: fid, name: RENAMED, confirm: true });
  check(renamedFolder.ok === true && renamedFolder.data?.renamed === true && renamedFolder.data?.verified === true,
    'create_workflow_folder with a folderId RENAMES it, verified', `${renamedFolder.code ?? ''} ${JSON.stringify(renamedFolder.data ?? {}).slice(0, 160)}`);
  const foldersAfter = (await call('list_workflow_folders', { limit: 200, offset: 0 })).data?.folders ?? [];
  check(foldersAfter.find((f) => f.id === fid)?.name === RENAMED && foldersAfter.length === foldersBefore.length,
    'READ-BACK: a separate listing shows the new name on the SAME id, and no folder was created',
    `${foldersAfter.find((f) => f.id === fid)?.name} | ${foldersBefore.length} -> ${foldersAfter.length}`);
  left.push(`   (folder ${fid} was renamed to ${RENAMED})`);
}
if (wid) {
  log.subject('edit_workflow');
  const beforeName = (await call('get_workflow', { workflowId: wid })).data;
  const NEWNAME = NAME('stepindex-renamed');
  const renamedWf = await call('edit_workflow', { workflowId: wid, confirm: true, acknowledgeDrift: true, ops: [{ op: 'updateSettings', settings: { name: NEWNAME } }] });
  check(renamedWf.ok === true, 'edit_workflow updateSettings{name} renames a workflow in place', `${renamedWf.code ?? ''} ${String(renamedWf.detail ?? '').slice(0, 200)}`);
  const afterName = (await call('get_workflow', { workflowId: wid })).data;
  check(afterName?.name === NEWNAME && afterName?.status === beforeName?.status && afterName?.stepCount === beforeName?.stepCount,
    'READ-BACK: the new name landed, and status and step count are untouched',
    `${afterName?.name} | ${beforeName?.status} -> ${afterName?.status} | steps ${beforeName?.stepCount} -> ${afterName?.stepCount}`);
  left.push(`   (workflow ${wid} was renamed to ${NEWNAME})`);
}

log.subject('move_workflows');
if (wid && fid) {
  const moved = await call('move_workflows', { workflowIds: [wid], parentId: fid, toRoot: false, allowPublished: false, confirm: true });
  check(moved.ok === true, 'move_workflows moves the draft into the folder', moved.detail);
  // A DIFFERENT ENVELOPE from the unfiltered listing, and the difference is easy to miss:
  // list_workflow_folders() returns {count, folders[]} of directories only, while the same tool
  // WITH a parentId returns {count, folderId, folderName, contents[]} where contents carries the
  // workflows too, each with type:'workflow' and its parentId. Reading .folders here found nothing
  // and made a move that had actually worked look like a failure.
  const inFolder = await call('list_workflow_folders', { parentId: fid, limit: 100, offset: 0 });
  const kids = inFolder.data?.contents ?? [];
  const mine = kids.find((k) => k.id === wid);
  check(Boolean(mine), 'and the workflow reads back INSIDE that folder on a separate request',
    `folder holds ${kids.length} row(s): ${JSON.stringify(kids.map((k) => k.id)).slice(0, 120)}`);
  check(mine?.parentId === fid && mine?.type === 'workflow',
    "the row names the folder as its parentId and types itself 'workflow', not 'directory'",
    JSON.stringify(mine ?? {}).slice(0, 140));
} else {
  check(false, 'move_workflows SKIPPED — no workflow id or no folder id to move into');
}

log.subject('duplicate_workflow');
if (wid) {
  const dup = await call('duplicate_workflow', { workflowId: wid, newName: NAME('dup'), confirm: true });
  const did = dup.data?.id ?? dup.data?.wid ?? dup.data?.workflowId;
  check(dup.ok === true, 'duplicate_workflow copies the draft', dup.detail);
  check(typeof did === 'string' && did.length > 0 && did !== wid,
    'and the copy is a NEW workflow, not the original returned back', `${did} vs ${wid}`);
  if (did) {
    left.push(`workflow ${did} (${NAME('dup')}, duplicate)`);
    const copy = await call('get_workflow', { workflowId: did });
    check(copy.data?.name === NAME('dup'), 'the copy reads back under the new name', copy.data?.name);
  }
}

// ── 8. the custom-code sandbox, and what it silently drops ──────────────────────────────────
// A differential, not a smoke test: the same sandbox is asked for an OBJECT and then a PRIMITIVE.
// The object round-trips; the primitive does not survive, which is why the engine requires
// `output` to be an object and why a step returning a bare value reads as untested at runtime.
console.log('\nthe custom-code sandbox');
log.subject('test_custom_code');
const obj = await call('test_custom_code', { code: 'return {slot: 1, txt: "x"}', language: 'javascript', inputData: {} });
// GHL's sandbox is a REMOTE EXECUTOR and it is not always up: this section failed all three of its
// assertions in one run of four on 2026-09-15 while the primitive check beside it passed, which is
// the signature of the service faulting rather than the contract changing. So the transport is
// asserted FIRST and separately, and the two content assertions below only run if it held. An
// assertion that reports "an object return did not survive the sandbox" when the sandbox was simply
// unavailable is a false finding about GHL, which is worse than no finding.
const sandboxUp = obj.ok === true && obj.data?.hasError === false;
check(sandboxUp, "test_custom_code runs javascript in GHL's sandbox",
  `ok=${obj.ok} code=${obj.code ?? '-'} hasError=${obj.data?.hasError} errorMessage=${obj.data?.errorMessage ?? '-'} `
  + `detail=${String(obj.detail ?? '').slice(0, 100)} — if this is a transport or 5xx failure the two `
  + 'content assertions below are SKIPPED, not failed: the sandbox being down says nothing about the contract');
if (sandboxUp) {
  check(obj.data?.passed === true, 'and reports the run as passed', obj.data?.errorMessage);
  check(obj.data?.output?.slot === 1 && obj.data?.output?.txt === 'x',
    'an OBJECT return survives the sandbox intact — both keys, both values', JSON.stringify(obj.data?.output));
  check(obj.data?.outputValid === true && JSON.stringify(obj.data?.outputKeys) === '["slot","txt"]',
    'and the tool reports the keys a later step could reference as merge tags', JSON.stringify(obj.data?.outputKeys));
} else {
  console.log('  SKIP  the two content assertions — the sandbox did not run, so it proved nothing either way');
}

const prim = await call('test_custom_code', { code: 'return 5', language: 'javascript', inputData: {} });
if (prim.ok !== true) {
  console.log('  SKIP  the primitive-return check — the sandbox did not answer this call either');
} else check(prim.data?.output?.valueOf?.() !== 5 || prim.data?.outputValid === false,
  'a PRIMITIVE return does NOT survive as a usable output — the sandbox drops it',
  `output=${JSON.stringify(prim.data?.output)} outputValid=${prim.data?.outputValid}`);

// ── RUNTIME: a real enrolment, on contacts this suite creates ───────────────────────────────
// Authorised by the operator 2026-09-19 ("if we need to enroll contacts to prove it, then we do
// that"), under three fences that make it harmless, each asserted rather than intended:
//   • the contacts are CREATED HERE and carry no email and no phone — nothing can be sent to them
//   • the workflow has NO TRIGGER, so the only way in is the enrol call below
//   • its steps are drip, tag, wait, tag — none of them sends anything to anyone
// It is unpublished again at the end. This is the only section that proves anything RUNS.
console.log('\nruntime: enrolment, drip queue, fast-forward');
{
  const gwr = deps.makeGw({ loc: LOCATION, state });
  const TAG_DRIP = `test-conf-${STAMP}-past-drip`, TAG_WAIT = `test-conf-${STAMP}-past-wait`;
  log.subject('build_workflow');
  const rt = await call('build_workflow', { spec: { name: NAME('runtime'), triggers: [], graph: [
    { ref: 'd', kind: 'action', type: 'drip', name: 'Drip Mode', attributes: { batchSize: 1, interval: { timeUnit: 'minutes', value: 1 }, type: 'drip' } },
    { ref: 't1', kind: 'action', type: 'add_contact_tag', name: 'Tag past drip', attributes: { tags: [TAG_DRIP] } },
    { ref: 'w', kind: 'wait', name: 'Wait 7 days', config: { unit: 'days', value: 7, when: 'after' } },
    { ref: 't2', kind: 'action', type: 'add_contact_tag', name: 'Tag past wait', attributes: { tags: [TAG_WAIT] } }] } });
  const rwid = rt.data?.wid;
  check(rt.ok === true && typeof rwid === 'string', 'build_workflow creates the trigger-less runtime probe', `${rt.code ?? ''} ${String(rt.detail ?? '').slice(0, 200)}`);
  if (rwid) {
    left.push(`workflow ${rwid} (${NAME('runtime')}, was PUBLISHED for the run and unpublished after)`);
    const tpls = (await call('export_workflow', { workflowId: rwid })).data?.workflow?.workflowData?.templates ?? [];
    const dripId = tpls.find((t) => t.type === 'drip')?.id, waitId = tpls.find((t) => t.type === 'wait')?.id;

    log.subject('publish_workflow');
    const pub = await call('publish_workflow', { workflowId: rwid, confirm: true });
    check(pub.ok === true && pub.data?.verify?.status === 'published' && pub.data?.verify?.totalTriggers === 0,
      'publish_workflow publishes a workflow that carries a drip step — GHL stamps `configuredAt` onto it on save, and the engine gate must not call that an invented key',
      `${pub.code ?? ''} ${String(pub.detail ?? '').slice(0, 240)}`);

    log.subject(false);
    const mk = async (n) => (await gwr.call('POST', '/contacts/', { locationId: LOCATION, firstName: 'TEST-CONF', lastName: `${STAMP}-${n} (no email, no phone)`, tags: ['test-conf'] }));
    const made = [await mk('a'), await mk('b'), await mk('c'), await mk('d')].map((r) => r.json?.contact ?? r.json);
    const ids = made.map((c) => c?.id).filter(Boolean);
    check(ids.length === 4 && made.every((c) => !c.email && !c.phone), 'FENCE: four contacts created by this run, none with an email or a phone', JSON.stringify(made.map((c) => [Boolean(c?.id), c?.email ?? null, c?.phone ?? null])));
    for (const id of ids) left.push(`contact ${id} (TEST-CONF ${STAMP}, no email, no phone)`);
    const tagsOf = async (id) => { const r = await gwr.call('GET', `/contacts/${id}`); return (r.json?.contact ?? r.json)?.tags ?? []; };
    const until = async (fn, { tries = 12, ms = 5000 } = {}) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, ms)); } return null; };

    if (pub.ok && ids.length === 4 && dripId && waitId) {
      // ONE contact first: it clears the drip at once (the first batch is immediate) and parks at the wait.
      const e1 = await gwr.call('POST', `/contacts/${ids[0]}/workflow/${rwid}`, { eventStartTime: '' });
      check(e1.ok === true, 'the enrol call is accepted — which proves nothing yet', `${e1.status}`);
      const ran = await until(async () => (await tagsOf(ids[0])).includes(TAG_DRIP));
      check(ran === true, 'EFFECT: the contact\'s OWN RECORD gains the first tag — the workflow really ran, read from a source the workflow does not control', JSON.stringify(await tagsOf(ids[0])));

      log.subject('get_contacts_at_step');
      const parked = await until(async () => { const r = await call('get_contacts_at_step', { workflowId: rwid, stepId: waitId }); return (r.data?.contacts ?? []).some((c) => JSON.stringify(c).includes(ids[0])) ? r : null; });
      check(Boolean(parked), 'get_contacts_at_step finds that contact parked at the wait step', String(parked?.data?.total));
      check(parked && !('drip' in parked.data), 'CONTROL: a WAIT step gets no `drip` block', JSON.stringify(Object.keys(parked?.data ?? {})));

      // THREE at once into a batch-of-one drip: one leaves immediately, the rest must queue.
      log.subject(false);
      for (const id of ids.slice(1)) await gwr.call('POST', `/contacts/${id}/workflow/${rwid}`, { eventStartTime: '' });
      log.subject('get_contacts_at_step');
      const queued = await until(async () => { const r = await call('get_contacts_at_step', { workflowId: rwid, stepId: dripId }); return r.data?.drip ? r : null; }, { tries: 8, ms: 3000 });
      check(Boolean(queued) && queued.data.drip.contactsInDrip >= 1 && queued.data.drip.nextBatch?.scheduledAt && queued.data.drip.queued.every((q) => ids.includes(q.contactId)),
        'DIFFERENTIAL: on the DRIP step the same tool reports GHL\'s queue — held count, next batch, and only contacts this run enrolled', JSON.stringify(queued?.data?.drip ?? null).slice(0, 220));

      log.subject('fast_forward_contacts');
      const before = await tagsOf(ids[0]);
      const ffp = await call('fast_forward_contacts', { workflowId: rwid, stepId: waitId, contactId: ids[0] });
      check(ffp.code === 'CONFIRM_REQUIRED' && ffp.data?.preview?.count === 1 && !(await tagsOf(ids[0])).includes(TAG_WAIT),
        'fast_forward_contacts previews exactly ONE enrolment and moves nobody', `${ffp.code} count=${ffp.data?.preview?.count}`);
      const ffc = await call('fast_forward_contacts', { workflowId: rwid, stepId: waitId, contactId: ids[0], previewToken: ffp.data?.preview?.previewToken, confirm: true });
      check(ffc.ok === true && ffc.data?.moved === 1, 'with the preview token and confirm it reports one moved', `${ffc.code ?? ''} ${JSON.stringify(ffc.data ?? ffc.detail ?? {}).slice(0, 160)}`);
      const past = await until(async () => (await tagsOf(ids[0])).includes(TAG_WAIT));
      check(past === true && !before.includes(TAG_WAIT), 'EFFECT: the step AFTER the 7-day wait ran — the second tag is on the contact\'s own record, and was not before', JSON.stringify(await tagsOf(ids[0])));
      const others = await Promise.all(ids.slice(1).map(tagsOf));
      check(others.every((t) => !t.includes(TAG_WAIT)), 'CONTROL: the contacts that were NOT fast-forwarded do not have it', JSON.stringify(others.map((t) => t.includes(TAG_WAIT))));
    }

    // DOES A FIRST-PARTY STEP ACTUALLY RUN? Built, validated and published clean, 'Add Internal
    // Comments' was SKIPPED at runtime ("No app integration found for this action") until its stored
    // shape matched the builder's. Only an execution can see that, so this is one.
    if (pub.ok && ids.length === 4) {
      log.subject('build_workflow');
      const COMMENT = `<p>TEST-CONF ${STAMP} internal comment</p>`;
      // A SECOND first-party step whose effect is a NUMBER on another service: Update Inventory.
      // Its dropdown is GHL's own options route — the ALL-fields form, because the per-field form
      // answers `{options:[]}` for a real field and a nonsense one alike. The value is the PRICE id,
      // and only prices with inventory tracking ON are offered. FENCE: a TEST-named product only.
      log.subject(false);
      const invOpts = await gwr.call('GET', `/workflows-marketplace/actions/options/update_inventory?locationId=${LOCATION}&optionType=default`);
      const stockItem = (invOpts.json?.product ?? []).find((o) => /^TEST-/.test(String(o.label ?? '')));
      const stockOf = async () => ((await gwr.call('GET', `/products/inventory?altId=${LOCATION}&altType=location&limit=100`)).json?.inventory ?? [])
        .find((i) => i._id === stockItem?.value)?.availableQuantity;
      const stockBefore = stockItem ? await stockOf() : null;
      log.subject('build_workflow');
      const fr = await call('build_workflow', { spec: { name: NAME('firstparty-run'), triggers: [], graph: [
        { ref: 'c', kind: 'action', type: 'internal_comment_action', marketplace: true, name: 'Internal comment', attributes: { message_rich_text: COMMENT } },
        ...(stockItem ? [{ ref: 'i', kind: 'action', type: 'update_inventory', marketplace: true, name: 'Add one to stock', attributes: { product: stockItem.value, update_type: 'increment_by', value: 1 } }] : [])] } });
      // The build had READ the account's assets; a gate that is then told "marketplace types unknown"
      // calls a correct first-party step "not a known step type".
      check(!(fr.data?.warnings ?? []).some((w) => /is not a known step type/.test(String(w))),
        'the build does not call a first-party step it just looked up "not a known step type"', JSON.stringify(fr.data?.warnings ?? []).slice(0, 240));
      const frwid = fr.data?.wid;
      if (frwid) left.push(`workflow ${frwid} (${NAME('firstparty-run')}, published for the run and unpublished after)`);
      const frPub = frwid ? await call('publish_workflow', { workflowId: frwid, confirm: true }) : { ok: false };
      log.subject(false);
      const conv = await gwr.call('POST', '/conversations/', { locationId: LOCATION, contactId: ids[3] });
      const convId = conv.json?.conversation?.id ?? conv.json?.id ?? conv.json?.conversationId;
      if (frPub.ok && convId) await gwr.call('POST', `/contacts/${ids[3]}/workflow/${frwid}`, { eventStartTime: '' });
      const landed = frPub.ok && convId ? await until(async () => {
        const m = await gwr.call('GET', `/conversations/${convId}/messages?limit=10`);
        return (m.json?.messages?.messages ?? m.json?.messages ?? []).some((x) => String(x.body ?? '').includes(`TEST-CONF ${STAMP} internal comment`));
      }) : null;
      log.subject('build_workflow');
      check(fr.ok === true && frPub.ok === true && Boolean(convId), 'a first-party step builds, publishes, and its contact has a conversation to comment on', `${fr.code ?? ''} ${frPub.code ?? ''} conv=${Boolean(convId)}`);
      check(landed === true, 'EFFECT: the internal comment is IN THE CONVERSATION — the first-party step RAN, read from the conversations endpoint rather than the workflow\'s own log', String(landed));
      // A FIRST-PARTY STEP'S OWN OUTPUT TAG. {{<customVarPrefix>.<stepIndex>.<field>}} resolves —
      // proven live 2026-09-19, the image step's answer and the parser's fields rendered in a
      // comment — but the picker's static inventory lists no such namespace, so the merge-tag check
      // called all three "will render literally". BUILD ONLY: these steps bill per RUN, and a draft
      // that is never enrolled costs nothing.
      log.subject('build_workflow');
      const aiSpec = (tag) => ({ name: NAME('firstparty-output-tag'), triggers: [], graph: [
        { ref: 'a', kind: 'action', type: 'workflow_ai_analyze_image', marketplace: true, name: 'AI analyze image',
          attributes: { model: 'gpt-5.6-luna', image: 'https://www.gstatic.com/webp/gallery/1.jpg', prompt: 'Describe this image.', detailLevel: 'low' } },
        { ref: 'c', kind: 'action', type: 'internal_comment_action', marketplace: true, name: 'Print it', attributes: { message_rich_text: `<p>${tag}</p>` } }] });
      const aiBuild = await call('build_workflow', { spec: aiSpec('{{workflow_ai_analyze_image.1.response}}') });
      if (aiBuild.data?.wid) left.push(`workflow ${aiBuild.data.wid} (${NAME('firstparty-output-tag')}, NEVER published — the AI steps bill per run)`);
      const literal = (w) => (w ?? []).filter((x) => /namespace the picker does not list/.test(String(x)));
      check(aiBuild.ok === true && literal(aiBuild.data?.warnings).length === 0,
        'a first-party step\'s OWN output tag is not called "it will render literally"', JSON.stringify(literal(aiBuild.data?.warnings)).slice(0, 200));
      // CONTROL: the same shape with a typo'd namespace still warns — the rule is the document's
      // own producers, not "anything that looks like a step output".
      const typo = await call('build_workflow', { spec: { ...aiSpec('{{workflow_ai_analyse_image.1.response}}'), name: NAME('firstparty-output-tag-typo') } });
      if (typo.data?.wid) left.push(`workflow ${typo.data.wid} (${NAME('firstparty-output-tag-typo')}, NEVER published — control for the typo'd namespace)`);
      check(literal(typo.data?.warnings).length === 1,
        'CONTROL: a typo in that namespace is still reported', JSON.stringify(literal(typo.data?.warnings)).slice(0, 200));

      if (stockItem) {
        const moved = landed === true ? await until(async () => (await stockOf()) === stockBefore + 1) : null;
        check(moved === true, 'EFFECT: Update Inventory RAN — the stock count on the products service is exactly one higher than before the enrolment', `${stockBefore} -> ${await stockOf()}`);
      } else console.log('  NOTE  no TEST-named product with inventory tracking on — the Update Inventory run was NOT exercised');
      if (frwid) await call('unpublish_workflows', { workflowIds: [frwid], confirm: true });

      // THREE MORE first-party steps, each with an effect on ANOTHER service: Issue Badge (the
      // certificates registry), Grant and Revoke course access (the course's own enrolment list).
      // Fixtures are found through GHL's own dropdown routes and must be TEST-named. 🔴 A course
      // grant to a contact with NO EMAIL is logged `success` and does NOTHING — so this contact has
      // one, on a reserved undeliverable domain, with email DND on: nothing is sent.
      log.subject(false);
      const badge = ((await gwr.call('GET', `/workflows-marketplace/actions/options/issue_badge_workflow?locationId=${LOCATION}&optionType=default`)).json?.templateId ?? [])
        .find((o) => /^TEST-/.test(String(o.label ?? '')));
      const course = ((await gwr.call('POST', `/workflows-marketplace/actions/dynamic-source/membership_course_grant_access?locationId=${LOCATION}&filterField=membership_default_courses`, {})).json?.membership_default_courses ?? [])
        .find((o) => /^TEST-/.test(String(o.label ?? '')));
      if (!badge || !course) console.log(`  NOTE  badge template ${badge ? 'found' : 'MISSING'}, priced test course ${course ? 'found' : 'MISSING'} — those runs were NOT exercised`);
      else {
        const mc = await gwr.call('POST', '/contacts/', { locationId: LOCATION, firstName: 'TEST-CONF', lastName: `member-${STAMP}`, email: `test-conf-member-${STAMP}@example.com`, dnd: true, dndSettings: { Email: { status: 'active', message: 'probe contact: never email', code: '' } } });
        const mid = mc.json?.contact?.id;
        if (mid) left.push(`contact ${mid} (TEST-CONF member-${STAMP}, reserved-domain email, email DND on)`);
        const issuedTo = async () => ((await gwr.call('GET', `/certificates/locations/${LOCATION}/registry?skip=0&limit=50&search=`)).json?.issuedCertificates ?? []).filter((c) => c.contactId === mid).length;
        const members = async () => (await gwr.call('GET', `/membership/locations/${LOCATION}/user-purchase/no-of-users-purchasedOffer/${course.value}`)).json?.userCount;
        const [badges0, members0] = [await issuedTo(), await members()];
        const runOne = async (name, graph) => {
          log.subject('build_workflow');
          const b = await call('build_workflow', { spec: { name: NAME(name), triggers: [], graph } });
          const id = b.data?.wid; if (id) left.push(`workflow ${id} (${NAME(name)}, published for the run and unpublished after)`);
          const p = id ? await call('publish_workflow', { workflowId: id, confirm: true }) : { ok: false };
          log.subject(false);
          if (p.ok && mid) await gwr.call('POST', `/contacts/${mid}/workflow/${id}`, { eventStartTime: '' });
          return { id, ok: b.ok === true && p.ok === true, code: `${b.code ?? ''} ${p.code ?? ''}` };
        };
        const g = await runOne('firstparty-badge-grant', [
          { ref: 'b', kind: 'action', type: 'issue_badge_workflow', marketplace: true, name: 'Issue test badge', attributes: { templateId: badge.value } },
          { ref: 'g', kind: 'action', type: 'membership_course_grant_access', marketplace: true, name: 'Grant test course', attributes: { membership_default_courses: course.value } }]);
        const badged = g.ok ? await until(async () => (await issuedTo()) === badges0 + 1) : null;
        const granted = g.ok ? await until(async () => (await members()) === members0 + 1, { tries: 10, ms: 4000 }) : null;
        log.subject('build_workflow');
        check(g.ok, 'Issue Badge and Grant course access build and publish', g.code);
        check(badged === true, 'EFFECT: Issue Badge RAN — the certificates registry holds one more badge for this contact', `${badges0} -> ${await issuedTo()}`);
        check(granted === true, 'EFFECT: Grant course access RAN — the offer\'s member count on the memberships service is one higher', `${members0} -> ${await members()}`);
        if (g.id) await call('unpublish_workflows', { workflowIds: [g.id], confirm: true });
        if (granted === true) {
          // 🔴 the revoke step's field is SINGULAR (`membership_default_course`); the grant's is plural.
          const r = await runOne('firstparty-revoke', [
            { ref: 'r', kind: 'action', type: 'membership_default_course_revoke', marketplace: true, name: 'Revoke test course', attributes: { membership_default_course: course.value } }]);
          const revoked = r.ok ? await until(async () => (await members()) === members0, { tries: 10, ms: 4000 }) : null;
          log.subject('build_workflow');
          check(revoked === true, 'EFFECT: Revoke course access RAN — the member count is back where it started', `${await members()} vs ${members0}`);
          if (r.id) await call('unpublish_workflows', { workflowIds: [r.id], confirm: true });
        }
      }
    }

    log.subject('unpublish_workflows');
    const un = await call('unpublish_workflows', { workflowIds: [rwid], confirm: true });
    const st = (await call('get_workflow', { workflowId: rwid })).data?.status;
    check(un.ok === true && st === 'draft', 'FENCE: the runtime probe is a DRAFT again when the section ends', `${un.code ?? ''} status=${st}`);
  }
}

// ── get_workflow_stats: A/B split results, proven by DIFFERENTIAL ─────────────────────────────
// Same fence as the runtime block above: trigger-less workflow, a contact this run creates with no
// email and no phone, steps that only tag. The proof is the count MOVING: 0 before, 1 after, on
// exactly one path, and that path's tag is the one on the contact's own record.
// A path's child steps key is `then` (compiler.mjs reads `flattenGraph(p.then ?? [], …)`); with
// `graph` both paths compile EMPTY and the differential would prove nothing while printing PASS.
// `mode: 'weighted'` is what makes `weight` mean anything — without it every path gets an even share.
console.log('\nget_workflow_stats: split results');
{
  const gws = deps.makeGw({ loc: LOCATION, state });
  const TAG_A = `test-conf-${STAMP}-split-a`, TAG_B = `test-conf-${STAMP}-split-b`;
  log.subject('build_workflow');
  const sp = await call('build_workflow', { spec: { name: NAME('split'), triggers: [], graph: [
    { ref: 's', kind: 'split', name: 'A/B', mode: 'weighted', paths: [
      { ref: 'pa', name: 'Path A', weight: 50, then: [{ ref: 'ta', kind: 'action', type: 'add_contact_tag', name: 'Tag A', attributes: { tags: [TAG_A] } }] },
      { ref: 'pb', name: 'Path B', weight: 50, then: [{ ref: 'tb', kind: 'action', type: 'add_contact_tag', name: 'Tag B', attributes: { tags: [TAG_B] } }] },
    ] }] } });
  const swid = sp.data?.wid;
  check(sp.ok === true && typeof swid === 'string', 'build_workflow creates the trigger-less split probe', `${sp.code ?? ''} ${String(sp.detail ?? '').slice(0, 200)}`);
  if (swid) {
    left.push(`workflow ${swid} (${NAME('split')}, was PUBLISHED for the run and unpublished after)`);
    log.subject('get_workflow_stats');
    const before = await call('get_workflow_stats', { workflowId: swid, stepTypes: [], includeTriggers: false, includeContactsPerStep: false });
    const b0 = before.data?.splits?.[0];
    // The message claims the paths are NAMED, so the check tests the names, not just the count —
    // they come from the transition templates, which is the thing that could silently go null.
    const b0names = (b0?.paths ?? []).map((p) => p.name).join('|');
    check(before.ok && b0names === 'Path A|Path B' && b0.totalContactsEntered === 0, 'BEFORE: one split, two NAMED paths, zero entered', JSON.stringify(before.data?.splits ?? null).slice(0, 240));
    log.subject('publish_workflow');
    const pub = await call('publish_workflow', { workflowId: swid, confirm: true });
    check(pub.ok === true && pub.data?.verify?.totalTriggers === 0, 'published with ZERO triggers', `${pub.code ?? ''}`);
    log.subject(false);
    const made = (await gws.call('POST', '/contacts/', { locationId: LOCATION, firstName: 'TEST-CONF', lastName: `${STAMP}-split (no email, no phone)`, tags: ['test-conf'] })).json;
    const person = made?.contact ?? made;
    const cid = person?.id;
    // The no-email/no-phone property is what stands between this suite and messaging a real
    // person, so it is READ BACK off the created record rather than inherited from the POST body.
    check(Boolean(cid) && !person?.email && !person?.phone, 'FENCE: one contact created by this run, no email, no phone', JSON.stringify([Boolean(cid), person?.email ?? null, person?.phone ?? null]));
    if (pub.ok && cid) {
      left.push(`contact ${cid} (TEST-CONF ${STAMP} split, no email, no phone)`);
      await gws.call('POST', `/contacts/${cid}/workflow/${swid}`, { eventStartTime: '' });
      const tagsOf = async () => ((await gws.call('GET', `/contacts/${cid}`)).json?.contact ?? {}).tags ?? [];
      let tags = [];
      for (let i = 0; i < 12 && !tags.some((t) => t === TAG_A || t === TAG_B); i++) { await new Promise((r) => setTimeout(r, 5000)); tags = await tagsOf(); }
      const took = tags.includes(TAG_A) ? 'Path A' : tags.includes(TAG_B) ? 'Path B' : null;
      check(took !== null, 'EFFECT: the contact\'s OWN RECORD carries exactly one path\'s tag — which is also the proof the paths compiled NON-EMPTY', JSON.stringify(tags));
      log.subject('get_workflow_stats');
      const after = await call('get_workflow_stats', { workflowId: swid, stepTypes: [], includeTriggers: false, includeContactsPerStep: false });
      const a0 = after.data?.splits?.[0];
      const entered = Object.fromEntries((a0?.paths ?? []).map((p) => [p.name, p.entered]));
      check(a0?.totalContactsEntered === 1 && entered[took] === 1 && Object.values(entered).reduce((x, y) => x + y, 0) === 1,
        'DIFFERENTIAL: split stats moved 0 → 1 on the SAME path the contact\'s tag names, and on no other', JSON.stringify(a0 ?? null).slice(0, 240));
    }
    log.subject('unpublish_workflows');
    const sun = await call('unpublish_workflows', { workflowIds: [swid], confirm: true });
    const sst = (await call('get_workflow', { workflowId: swid })).data?.status;
    check(sun.ok === true && sst === 'draft', 'FENCE: the split probe is a DRAFT again when the section ends — which is what its LEFT IN PLACE line claims', `${sun.code ?? ''} status=${sst}`);
  }
}

// ── coverage honesty ────────────────────────────────────────────────────────────────────────
console.log('\nNOT COVERED by this suite, and not counted as passing:');
console.log('  trigger activation    — a trigger is the ONLY enrolment path, so activating one is the');
console.log('                          line between a draft nobody can enter and a live automation');
console.log('                          (the runtime section enrols by DIRECT CALL into a trigger-less workflow)');
console.log('  anything that SENDS   — sms, email, calls. The runtime contacts carry no email and no phone.');

console.log(`\nLEFT IN PLACE (nothing is deleted):`);
for (const l of left) console.log(`  ${l}`);
log.write();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
