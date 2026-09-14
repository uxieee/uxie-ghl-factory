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
const countTemplates = async () => {
  const r = await call('export_workflow', { workflowId: wid });
  return (r.data?.workflow?.workflowData?.templates ?? []).length;
};
if (wid) {
  const before = await countTemplates();

  // kind:'step' — the value our own catalogue teaches via describe_step_type
  const badKind = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [
    { op: 'appendStep', step: { kind: 'step', type: 'if_else', name: NAME('kind'),
      branches: [{ name: 'Yes', condition: { conditionType: 'contact_detail' } }] } }] });
  check(badKind.ok === false, "an unrecognised node kind ('step') is REFUSED, not compiled to an empty step", JSON.stringify(badKind.data ?? {}).slice(0, 120));
  check(/KIND_UNKNOWN|kind/i.test(`${badKind.code} ${badKind.detail}`), 'the refusal names the kind problem', badKind.detail);
  check(/describe_step_type/.test(String(badKind.detail)), 'and names the catalogue collision that taught it');
  check(await countTemplates() === before, 'the document is UNCHANGED after the refusal');

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
    const mid = await countTemplates();
    const smuggle = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [
      { op: 'modifyStep', stepId: container?.id, attrPatch: {
        branches: [{ segments: [{ conditions: [{ field: 'email', operator: 'is', value: 'a@b.com' }] }] }] } }] });
    check(smuggle.ok === false, 'modifyStep cannot smuggle a trigger-filter condition past the compiler', JSON.stringify(smuggle.data ?? {}).slice(0, 120));
    check(/COND_SHAPE|condition/i.test(`${smuggle.code} ${smuggle.detail}`), 'the refusal names the condition shape', smuggle.detail);
    // Compare the CONTAINER's branches, not the template count. The count is subject to the
    // document store settling after the previous write and produced a false failure once; the
    // branches array is what the guard actually protects.
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
  const after = (await call('export_workflow', { workflowId: wid })).data?.workflow;
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
  const exported = await call('export_workflow', { workflowId: wid });
  const steps = exported.data?.workflow?.workflowData?.templates ?? [];

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

// ── 6. the account rail, and the silent cap ─────────────────────────────────────────────────
// 🔴 THE POINT OF THIS SECTION. list_workflows stops at 100 rows and says nothing about it: the
// envelope's own `count` reports the account total, so a caller who trusts the rows has silently
// censused a fraction of the account and has no way to tell. This asserts the cap EXISTS rather
// than documenting it, and then asserts list_workflows_complete beats it — a differential, so a
// day when GHL raises the cap fails here instead of being discovered by a wrong report.
console.log('\nthe account rail');
log.subject('list_workflows');
const capped = await call('list_workflows', { limit: 200, offset: 0 });
const rows = capped.data?.workflows ?? [];
const total = capped.data?.count;
check(typeof total === 'number' && total > 0, 'list_workflows reports an account total', String(total));
// 🔴 THE 100-ROW CAP IS NOT REPRODUCIBLE AS OF 2026-09-15 — see console bl-131.
// This assertion was written the other way round, expecting the cap, because a reference note of
// 2026-09-11 records list_workflows stopping at 100 silently on this very account. Asked for 200
// against 165 workflows, it returned all 165. So the rule is asserted in the direction it is now
// TRUE, and it fails loudly the day a cap comes back — which is the only way a census built on
// this rail finds out before a report does.
if (total > 100) {
  check(rows.length === total,
    `list_workflows returned ALL ${total} rows for limit=200 — the 100-row cap recorded on 2026-09-11 does NOT reproduce`,
    `asked 200, got ${rows.length} of ${total}`);
} else {
  check(false, `cap NOT EXERCISED — this account has only ${total} workflows, fewer than the 100 the old note describes. `
    + 'Neither the cap nor its absence is proven here; run against an account with more than 100.');
}

log.subject('list_workflows_complete');
const full = await call('list_workflows_complete', { pageSize: 100, maxPages: 10 });
check(full.data?.complete === true, 'list_workflows_complete reports that it exhausted the pages', full.data?.terminalReason);
check(full.data?.reportedTotal === total,
  'and agrees with list_workflows about the account total — the two rails read the same account',
  `${full.data?.reportedTotal} vs ${total}`);
const fullRows = full.data?.workflows ?? [];
check(fullRows.length === full.data?.reportedTotal,
  'it returns EVERY row it reported, which is the whole reason it exists', `${fullRows.length} of ${full.data?.reportedTotal}`);
check(fullRows.length === rows.length,
  'and with the cap absent the two rails now return the SAME rows — list_workflows_complete is '
  + 'currently belt-and-braces rather than the only correct census', `${fullRows.length} vs ${rows.length}`);

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
check(obj.data?.passed === true && obj.data?.hasError === false, 'test_custom_code runs javascript in GHL\'s sandbox', obj.data?.errorMessage);
check(obj.data?.output?.slot === 1 && obj.data?.output?.txt === 'x',
  'an OBJECT return survives the sandbox intact — both keys, both values', JSON.stringify(obj.data?.output));
check(obj.data?.outputValid === true && JSON.stringify(obj.data?.outputKeys) === '["slot","txt"]',
  'and the tool reports the keys a later step could reference as merge tags', JSON.stringify(obj.data?.outputKeys));

const prim = await call('test_custom_code', { code: 'return 5', language: 'javascript', inputData: {} });
check(prim.data?.output?.valueOf?.() !== 5 || prim.data?.outputValid === false,
  'a PRIMITIVE return does NOT survive as a usable output — the sandbox drops it',
  `output=${JSON.stringify(prim.data?.output)} outputValid=${prim.data?.outputValid}`);

// ── coverage honesty ────────────────────────────────────────────────────────────────────────
console.log('\nNOT COVERED by this suite, and not counted as passing:');
console.log('  trigger activation    — a trigger is the ONLY enrolment path, so activating one is the');
console.log('                          line between a draft nobody can enter and a live automation');
console.log('  contact enrollment    — same reason; fast_forward_contacts moves real people');
console.log('  fast_forward_contacts — REFUSED, not skipped. It advances real enrolments past a wait,');
console.log('                          which fires whatever comes next at whoever is parked there.');
console.log('                          There is no safe way to exercise it on an account with contacts.');
console.log('  pin_webhook_sample    — needs an inbound-webhook TRIGGER, and this suite builds nothing');
console.log('                          with a trigger by design. Covering it means a second fixture');
console.log('                          whose trigger stays inactive — worth doing, not done here.');

console.log(`\nLEFT IN PLACE (nothing is deleted):`);
for (const l of left) console.log(`  ${l}`);
log.write();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
