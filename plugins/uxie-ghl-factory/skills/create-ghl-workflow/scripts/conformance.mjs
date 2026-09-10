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
 * No publish. No trigger activation. No contact enrollment. A live workflow sends real messages
 * to real people, so everything here stays an unpublished draft with zero triggers, and the
 * publish/enrollment half of the rail is reported as NOT COVERED rather than quietly skipped.
 *
 * NOTHING IS DELETED. Probe artefacts stay named TEST-CONF-* and in place; the final report lists
 * them by id for a human to remove.
 */
import { makeGatewayFactory, TOOLS } from '../../../mcp-internal/core/tools.mjs';
import { DEFAULT_TOKEN_FILE } from '../../../mcp-internal/core/auth.mjs';
import { makeRenewer, autoRenewEnabled } from '../../../mcp-internal/core/token-renewal.mjs';

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
const tool = (n) => TOOLS.find((t) => t.name === n);
const call = (n, args) => tool(n).handler({ locationId: LOCATION, ...args }, deps);

let passed = 0, failed = 0;
const left = [];
const check = (cond, m, extra) => {
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
    check(await countTemplates() === mid, 'the container is UNCHANGED after the refusal');
  }
}

// ── 3. repair_workflow ──────────────────────────────────────────────────────────────────────
// The riskiest tool in the plugin and, until tonight, the one with zero live proof: 12 endpoints,
// a full-document PUT of workflowData.templates, and no receipt anywhere saying it had ever been
// run against a real account. A tool that rewrites an entire workflow document on evidence nobody
// has produced is the one that should be proven first, not last.
//
// Proven here in the order that makes a failure safe: PREVIEW first (asserting no write happened),
// then a real repair on a draft this suite created, then a read-back on a separate request.
console.log('\nrepair_workflow');
if (wid) {
  const current = await call('export_workflow', { workflowId: wid });
  const tpls = current.data?.workflow?.workflowData?.templates ?? [];
  const target = tpls.find((t) => t.type === 'custom_code');

  if (!target) { check(false, 'a custom_code step to repair', 'none found in the draft'); }
  else {
    const RENAMED = `${target.name} REPAIRED`;
    const patched = tpls.map((t) => (t.id === target.id ? { ...t, name: RENAMED } : t));

    // PREVIEW: default is no-write. If this is wrong, everything below is destructive by accident.
    const preview = await call('repair_workflow', { workflowId: wid, templates: patched });
    check(preview.ok === false && /CONFIRM/i.test(String(preview.code)),
      'repair_workflow PREVIEWS by default and refuses to write without confirm:true', `${preview.code}`);
    const afterPreview = await call('export_workflow', { workflowId: wid });
    const stillOld = (afterPreview.data?.workflow?.workflowData?.templates ?? []).find((t) => t.id === target.id);
    check(stillOld?.name === target.name,
      'the preview really wrote NOTHING — the step still carries its original name', `now ${stillOld?.name}`);

    // WRITE, then prove it by reading the document back rather than trusting the response.
    const done = await call('repair_workflow', { workflowId: wid, templates: patched, confirm: true });
    check(done.ok === true, 'repair_workflow writes the full document with confirm:true', done.detail);

    const verify = await call('export_workflow', { workflowId: wid });
    const vt = verify.data?.workflow?.workflowData?.templates ?? [];
    check(vt.find((t) => t.id === target.id)?.name === RENAMED,
      'the repair LANDED — read back on a separate request', `got ${vt.find((t) => t.id === target.id)?.name}`);
    check(vt.length === tpls.length,
      'and it did not drop or duplicate a step — a full-document PUT is exactly how a workflow loses one',
      `${tpls.length} before, ${vt.length} after`);

    // the numbering must survive a full-document rewrite, or every merge tag in the document breaks
    const codes = vt.filter((t) => t.type === 'custom_code').map((t) => t.stepIndex);
    check(JSON.stringify(codes) === '[1,2]', 'stepIndex survives a full-document repair unchanged', `got ${JSON.stringify(codes)}`);

    // a STALE expectedVersion must be refused, or two agents repairing at once silently clobber
    const stale = await call('repair_workflow', { workflowId: wid, templates: patched, confirm: true, expectedVersion: 1 });
    check(stale.ok === false && /VERSION_CONFLICT/i.test(String(stale.code)),
      'a stale expectedVersion is refused with VERSION_CONFLICT, not written over', `${stale.code}`);
  }
}

// ── coverage honesty ────────────────────────────────────────────────────────────────────────
console.log('\nNOT COVERED by this suite, and not counted as passing:');
console.log('  publish / unpublish   — outward-facing; a live workflow sends real messages');
console.log('  trigger activation    — same reason');
console.log('  contact enrollment    — same reason; fast_forward_contacts moves real people');
console.log('  repair_workflow       — 12 endpoints, writes, still zero live proof');

console.log(`\nLEFT IN PLACE (nothing is deleted):`);
for (const l of left) console.log(`  ${l}`);
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
