// d18 A/B-test and test-run proof. FIVE tools: get_ab_test_stats, declare_ab_test_winner, list_workflow_test_runs, get_workflow_test_run, get_step_latest_test_result.
// It touches ONE workflow, handed in by the runner (GHL_PROOF_WORKFLOW_ID plus its exact name GHL_PROOF_WORKFLOW_NAME, which must begin TEST-CONF-), and ONE contact
// (GHL_PROOF_CONTACT_ID, no email, no phone). No real id lives in this public file.
//
// Order: read the workflow and refuse unless it is a TEST-CONF draft with an A/B step whose paths hold no steps (nothing in it can send) -> baseline reads -> ONE test run for the
// contact (the route the builder's Test panel uses) -> read the run, the list, the step result and the stats back on separate requests -> publish the draft -> declare WITHOUT confirm
// (a preview, nothing written, a separate stats read agrees) -> declare WITH confirm on the first path -> read the winner back on a separate request -> UNPUBLISH on every exit.
// No contact is created, no tag is added, so the workflow's tag trigger enrols nobody while it is published.
// Every write goes through a body-aware fence: a write is allowed only on a route in WRITE_ROUTES and only if every UUID in its path and body belongs to the one workflow.
// Declaring a winner cannot be undone in the UI; it is done once, on the TEST-CONF workflow only, and the winner is left as residue.
import { join } from 'node:path';
import { createDeclaredMarker } from './declared-marker.mjs';
import { gateOrExit } from './d18-gate.mjs';
import { makeStopControl } from './stop-control.mjs';

export const AB_TOOLS = Object.freeze(['get_ab_test_stats', 'declare_ab_test_winner', 'list_workflow_test_runs', 'get_workflow_test_run', 'get_step_latest_test_result']);
const UNPUBLISH = 'unpublish_workflows'; // always followed by a separate GET that must read draft (bl-1021)
const USED_TOOLS = Object.freeze([...AB_TOOLS, 'get_workflow', 'publish_workflow', 'unpublish_workflows']);
export const WID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CID_RE = /^[A-Za-z0-9]{16,30}$/;
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export class FenceError extends Error { constructor(m) { super(m); this.name = 'FenceError'; } }
export class AuthStop extends Error { constructor(code) { super(`auth stop: ${code}`); this.name = 'AuthStop'; this.code = code; } }
const AUTH_CODES = Object.freeze(['TOKEN_EXPIRED', 'ACCESS_DENIED']);

// The only writes this proof may send. {L} is the location, {W} the workflow; a trigger id is one the workflow's own document names.
export const WRITE_ROUTES = Object.freeze([
  ['POST', /^\/workflow\/[^/]+\/test-workflow\/[0-9a-f-]{36}$/],
  ['POST', /^\/workflow\/[^/]+\/split\/ab-test\/declare-winner$/],
  ['PUT', /^\/workflow\/[^/]+\/[0-9a-f-]{36}$/],
  ['PUT', /^\/workflow\/[^/]+\/trigger\/[A-Za-z0-9]{16,30}$/],
  ['POST', /^\/workflow\/[^/]+\/[0-9a-f-]{36}\/validate-workflows$/],
  ['PUT', /^\/workflow\/[^/]+\/change-status$/],
]);

// `scope` is { location, ids:Set<string> (the workflow, its step, paths, triggers), contactId }. GET always passes. Any other method needs a listed route AND every
// UUID in the path, the query and the body inside scope.ids AND every contact id in the body equal to the one contact. readBackUntil is dropped.
export function fenceGateway(gw, scope) {
  const allowed = (method, path, body) => {
    const m = String(method).toUpperCase();
    if (m === 'GET') return;
    const [p, q = ''] = String(path).split('?');
    if (!WRITE_ROUTES.some(([mm, re]) => mm === m && re.test(p))) throw new FenceError(`write fence: ${m} ${p} is not a route this proof may call`);
    if (!p.includes(`/${scope.location}/`)) throw new FenceError('write fence: the route is not on the proof location');
    const tm = /\/trigger\/([A-Za-z0-9]{16,30})$/.exec(p);
    if (tm && !scope.triggers.has(tm[1])) throw new FenceError('write fence: the trigger is not one of the workflow\'s own triggers');
    // the publish PUT carries the whole workflow document, whose inner ids are not all listed: for it (and validate) only the path and query are scanned; the path names the one workflow
    const docBody = (m === 'PUT' && /^\/workflow\/[^/]+\/[0-9a-f-]{36}$/.test(p)) || /\/validate-workflows$/.test(p);
    const text = `${p}?${q}\n${docBody ? '' : JSON.stringify(body ?? null)}`;
    for (const u of text.match(UUID_G) ?? []) if (!scope.ids.has(u.toLowerCase())) throw new FenceError('write fence: an id in the request is not part of the one workflow');
    if (body && typeof body === 'object' && 'contactId' in body && body.contactId !== scope.contactId) throw new FenceError('write fence: the contact is not the one contact');
  };
  const fenced = (fn) => (typeof fn === 'function' ? async (method, path, body, ...rest) => { allowed(method, path, body); return fn(method, path, body, ...rest); } : undefined);
  const { readBackUntil: _dropped, ...rest } = gw;
  return { ...rest, call: fenced(gw.call), callWithMeta: fenced(gw.callWithMeta), stream: fenced(gw.stream) };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// The step the proof works on: the workflow's first workflow_ab_test template, its paths, and a refusal reason when the workflow is not safe to use.
export function inspectWorkflow(wf, { workflowId, name, triggers = [] }) {
  const w = wf?.json ?? wf;
  const templates = w?.workflowData?.templates ?? [];
  const step = templates.find((t) => t?.type === 'workflow_ab_test');
  const paths = step?.attributes?.paths ?? [];
  const pathIds = new Set(paths.map((p) => p.id));
  const inside = templates.filter((t) => t?.parentKey === step?.id || pathIds.has(t?.parentKey));
  const pathSteps = inside.filter((t) => t?.type !== 'transition');
  const triggerIds = triggers.filter((t) => (t?.actions ?? []).some((a) => a?.workflow_id === workflowId)).map((t) => t.id).filter(Boolean);
  let why = null;
  if ((w?._id ?? w?.id) !== workflowId) why = 'the workflow id does not match';
  else if (typeof w?.name !== 'string' || w.name !== name || !w.name.startsWith('TEST-CONF-')) why = 'the workflow name is not the expected TEST-CONF name';
  else if (w?.status !== 'draft') why = `the workflow is not a draft (status ${w?.status})`;
  else if (!step || paths.length < 2) why = 'the workflow has no A/B step with two or more paths';
  else if (pathSteps.length > 0) why = 'a path holds a step (the proof only runs on empty paths)';
  else if (templates.some((t) => t?.type !== 'workflow_ab_test' && t?.type !== 'transition')) why = 'the workflow holds a template that is not the A/B step or a path transition (deny by default: anything else might send)';
  return { why, step, paths, pathIds: [...pathIds], triggerIds, templateIds: templates.map((t) => t.id).filter(Boolean) };
}

export async function runAbTestProof({ call, gw, LOCATION, workflowId, workflowName, contactId, chk, mk, say = console.log, ctl = {}, sleep = sleepMs, stopped = () => false, pollMs = 4000, polls = 6 }) {
  const out = { halted: false, published: false, declared: false, unknown: false };
  let dead = null;
  const guarded = async (n, a) => {
    if (!USED_TOOLS.includes(n)) throw new FenceError(`fence: tool ${n} is not on the list`);
    if (dead) throw new AuthStop(dead);
    if (stopped()) throw new AuthStop('STOPPED');
    const r = await call(n, a);
    if (AUTH_CODES.includes(r?.code)) { dead = r.code; say(`AUTH STOP code=${r.code} on ${n}`); throw new AuthStop(r.code); }
    return r;
  };
  const credit = (tool, cond, msg, detail) => { mk.subject(tool); chk(cond, msg, detail); mk.subject(false); };
  const noCredit = (cond, msg, detail) => { mk.subject(false); chk(cond, msg, detail); };
  const readWf = () => gw.call('GET', `/workflow/${LOCATION}/${workflowId}`);
  const sumEntered = (r) => (Array.isArray(r?.data?.paths) ? r.data.paths.reduce((s, p) => s + (typeof p.entered === 'number' ? p.entered : NaN), 0) : NaN);

  // THE RESTORE: unpublish if the workflow is published, then read the status back on a separate request. Runs on every exit.
  const restore = async () => {
    const cur = await gw.call('GET', `/workflow/${LOCATION}/${workflowId}`).catch(() => null);
    const status = cur?.json?.status;
    if (status === 'draft') return { state: 'draft' };
    if (status !== 'published') return { state: 'unknown', why: `status ${status ?? 'unreadable'}` };
    mk.subject(false);
    await call(UNPUBLISH, { workflowIds: [workflowId], confirm: true }).catch(() => null);
    const back = await gw.call('GET', `/workflow/${LOCATION}/${workflowId}`).catch(() => null);
    return back?.json?.status === 'draft' ? { state: 'restored' } : { state: 'unknown', why: `status ${back?.json?.status ?? 'unreadable'} after the unpublish` };
  };
  ctl.restore = restore;

  let insp = null;
  try {
    // ── preconditions: id AND name match, TEST-CONF, draft, empty paths. Anything else: nothing is written. ────────────
    const first = await readWf();
    const trg = await gw.call('GET', `/workflow/${LOCATION}/trigger?workflowId=${workflowId}`);
    insp = inspectWorkflow(first, { workflowId, name: workflowName, triggers: Array.isArray(trg?.json) ? trg.json : [] });
    if (insp.why) { noCredit(false, `NOT exercised: ${insp.why}; nothing was written`); out.halted = true; return out; }
    const scope = ctl.scope; if (scope) { for (const id of [workflowId, insp.step.id, ...insp.pathIds, ...insp.templateIds]) scope.ids.add(String(id).toLowerCase()); for (const t of insp.triggerIds) scope.triggers.add(t); }
    const stepId = insp.step.id; const firstPath = insp.pathIds[0];
    say(`  workflow is a TEST-CONF draft: A/B step with ${insp.pathIds.length} paths, no step inside any path, ${insp.triggerIds.length} trigger(s)`);

    // ── baseline reads (no write) ────────────────────────────────────────────────────────────────────────────────────────
    const listBefore = await guarded('list_workflow_test_runs', { workflowId });
    const runsBefore = Array.isArray(listBefore?.data?.runs) ? listBefore.data.runs.length : null;
    noCredit(listBefore?.ok === true && runsBefore !== null, `baseline: the test-run list reads ok (${runsBefore ?? '?'} run(s) before this run)`, listBefore?.code ?? '');

    // ── ONE test run for the one contact (the Test panel's route, fenced) ──────────────────────────────────────────────
    const started = await gw.call('POST', `/workflow/${LOCATION}/test-workflow/${workflowId}`, { contactId });
    const requestId = started?.json?.requestId;
    noCredit(started?.ok === true && typeof requestId === 'string' && requestId.length > 0, 'the test run started: 200 with a request id', `status=${started?.status ?? 'none'}`);
    if (typeof requestId !== 'string' || !requestId) { out.halted = true; return out; }

    // the run: poll until it reports finished, never more than `polls` reads
    let run = null; let events = [];
    for (let i = 0; i < polls; i += 1) {
      await sleep(pollMs);
      run = await guarded('get_workflow_test_run', { requestId, stepId });
      events = Array.isArray(run?.data?.progress?.events) ? run.data.progress.events : (Array.isArray(run?.data?.progress) ? run.data.progress : []);
      if (/finished/i.test(JSON.stringify(run?.data?.progress ?? ''))) break;
    }
    const finished = /finished/i.test(JSON.stringify(run?.data?.progress ?? ''));
    credit('get_workflow_test_run', run?.ok === true && finished && run?.data?.stepEvents !== null && typeof run?.data?.stepEvents === 'object',
      `get_workflow_test_run: the run reports finished and the A/B step's events came back from the step-events route (${events.length} progress event(s))`, run?.code ?? '');

    const listAfter = await guarded('list_workflow_test_runs', { workflowId });
    const rows = Array.isArray(listAfter?.data?.runs) ? listAfter.data.runs : null;
    credit('list_workflow_test_runs', listAfter?.ok === true && rows !== null && rows.length === (runsBefore ?? 0) + 1 && JSON.stringify(rows[0] ?? '').includes(requestId),
      `list_workflow_test_runs: the list grew by exactly one and its newest run is the request that was started (${rows ? rows.length : '?'} run(s))`, listAfter?.code ?? '');

    const r1 = await guarded('get_step_latest_test_result', { workflowId, stepId });
    const r2 = await guarded('get_step_latest_test_result', { workflowId, stepId });
    credit('get_step_latest_test_result', r1?.ok === true && r2?.ok === true && typeof r1.data?.present === 'boolean' && r1.data.present === r2.data.present,
      `get_step_latest_test_result: two reads of the A/B step agree (present=${r1?.data?.present ?? '?'}); present:false is the proven absence of a pinned result after a run that was not pinned`, `${r1?.code ?? ''} ${r2?.code ?? ''}`);

    // ── stats: two reads agree and the path ids are the document's ───────────────────────────────────────────────────────
    const s1 = await guarded('get_ab_test_stats', { workflowId, stepId });
    const s2 = await guarded('get_ab_test_stats', { workflowId, stepId });
    const ids1 = Array.isArray(s1?.data?.paths) ? s1.data.paths.map((p) => p.pathId).sort().join(',') : null;
    credit('get_ab_test_stats', s1?.ok === true && s2?.ok === true && ids1 === [...insp.pathIds].sort().join(',') && (s1.data.absent ?? []).length === 0
      && sumEntered(s1) > 0 && sumEntered(s1) === sumEntered(s2),
    `get_ab_test_stats: every document path is reported, none absent, the entered total is above zero (${sumEntered(s1)}) and a second read gives the same total`, `${s1?.code ?? ''} ${s2?.code ?? ''}`);

    // ── publish, then declare ─────────────────────────────────────────────────────────────────────────────────────────────
    mk.subject(false);
    const pub = await guarded('publish_workflow', { workflowId, confirm: true });
    const afterPub = await readWf();
    out.published = afterPub?.json?.status === 'published';
    noCredit(pub?.ok === true && out.published, 'the draft published (status read back on a separate request); nobody can enter it: no tag is added, no contact is created', pub?.code ?? '');
    if (!out.published) { out.halted = true; return out; }

    const before = await guarded('get_ab_test_stats', { workflowId, stepId });
    const prev = await guarded('declare_ab_test_winner', { workflowId, stepId });
    const mid = await guarded('get_ab_test_stats', { workflowId, stepId });
    const none = (r) => r?.data?.winnerPathId === null || r?.data?.winnerPathId === undefined;
    noCredit(prev?.code === 'CONFIRM_REQUIRED' && before?.ok === true && mid?.ok === true && none(before) && none(mid), 'declare without confirm previews and writes nothing (a separate stats read still shows no winner)', prev?.code ?? '');

    const dec = await guarded('declare_ab_test_winner', { workflowId, stepId, confirm: true });
    out.declared = dec?.ok === true;
    const after = await guarded('get_ab_test_stats', { workflowId, stepId });
    credit('declare_ab_test_winner', dec?.ok === true && dec.data?.declared === true && after?.ok === true && after.data?.winnerPathId === firstPath,
      'declare_ab_test_winner: the declare answered ok and a separate stats read shows the named path as the winner (read from GHL, not from the tool)', `${dec?.code ?? ''} winner=${after?.data?.winnerPathId ?? 'none'}`);
  } catch (e) {
    out.halted = true; out.reason = e instanceof AuthStop ? e.code : String(e?.message ?? e).slice(0, 120);
    say(`HALT: ${out.reason}`);
    noCredit(false, `the proof stopped early: ${out.reason}`);
  }
  // restore on every exit (the handler runs it on a signal)
  if (!stopped()) {
    const rs = await restore();
    mk.subject(false);
    if (rs.state === 'draft' || rs.state === 'restored') noCredit(true, 'FENCE: the workflow reads back as a draft when the section ends', rs.state);
    else { out.unknown = true; say(`workflow state UNKNOWN (${rs.why}) — unpublish it by hand and tell the orchestrator`); noCredit(false, 'FENCE: the workflow reads back as a draft when the section ends', rs.why); }
  } else out.unknown = true;
  say('\nLEFT IN PLACE (nothing is deleted): the test run record, the winner on the A/B step, one new workflow version, the contact\'s test enrolment.');
  return out;
}

// CLI
if (process.argv[1]?.endsWith('wf-abtest-proof.mjs')) {
  gateOrExit({ what: 'the entry point would run the A/B-test proof', allowed: ['--go='] }); // FIRST: before any token, gateway or tool import
  const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
  if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(2); }
  const workflowId = process.env.GHL_PROOF_WORKFLOW_ID; const workflowName = process.env.GHL_PROOF_WORKFLOW_NAME; const contactId = process.env.GHL_PROOF_CONTACT_ID;
  if (!WID_RE.test(workflowId ?? '') || !CID_RE.test(contactId ?? '') || !String(workflowName ?? '').startsWith('TEST-CONF-')) { console.error('REFUSED: GHL_PROOF_WORKFLOW_ID, GHL_PROOF_WORKFLOW_NAME (TEST-CONF-…) and GHL_PROOF_CONTACT_ID are required and must have the right shape'); process.exit(2); }
  if (!process.env.GHL_INTERNAL_TOK_FILE) { console.error('REFUSED: GHL_INTERNAL_TOK_FILE is not set; there is no default token file'); process.exit(2); }
  const { fileURLToPath } = await import('node:url');
  const CORE = join(fileURLToPath(new URL('.', import.meta.url)), '../../../mcp-internal/core');
  const { makeGatewayFactory, TOOLS } = await import(join(CORE, 'tools.mjs'));
  const { callSafe } = await import('./run-hygiene.mjs');
  const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE, engineVersion: 'workflows-wf-abtest-proof', allowedLocations: new Set([LOCATION]), renewer: null };
  const scope = { location: LOCATION, ids: new Set([workflowId]), triggers: new Set(), contactId };
  const mkGw = (o = {}) => fenceGateway(makeGatewayFactory({ state })(o), scope);
  const deps = { state, makeGw: mkGw };
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const mk = createDeclaredMarker(AB_TOOLS);
  const stopCtl = makeStopControl();
  const rawCall = (n, a) => stopCtl.guard(() => callSafe((nm, args) => tool(nm).handler({ locationId: LOCATION, ...args }, deps), n, a));
  const call = mk.wrapCall(rawCall);
  const gw0 = mkGw({ loc: LOCATION, state });
  const gw = { ...gw0, call: (...a) => stopCtl.guard(() => gw0.call(...a)) };
  let passed = 0, failed = 0;
  const check = (cond, m, extra) => { if (cond) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); } };
  const chk = (c, m, d) => mk.check(c, m, d, check);
  const ctl = { scope };
  const onSig = async () => {
    await stopCtl.stop(30000).catch(() => {});
    let rs = { state: 'unknown' }; try { rs = await ctl.restore?.() ?? rs; } catch { /* reported below */ }
    console.log(`signal: workflow ${rs.state === 'draft' || rs.state === 'restored' ? 'reads back as a draft' : 'state UNKNOWN — unpublish it by hand and tell the orchestrator'}`);
    try { mk.write(); } catch { /* reported by exit */ }
    process.exit(rs.state === 'draft' || rs.state === 'restored' ? 143 : 3);
  };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { void onSig(); });
  console.log(`A/B-test proof: ${AB_TOOLS.length} tools, one TEST-CONF workflow, one contact`);
  let res = { halted: true, unknown: true };
  try { res = await runAbTestProof({ call, gw, LOCATION, workflowId, workflowName, contactId, chk, mk, ctl, stopped: () => stopCtl.stopped }); }
  catch (e) { failed++; console.log(`  FAIL  the proof threw: ${String(e?.message ?? e).slice(0, 120)}`); }
  if (stopCtl.stopped) await new Promise(() => {}); // a signal is being handled: only the handler exits
  try { mk.write(); } catch (e) { console.log(`  FAIL  the exercised marker could not be written: ${String(e?.message ?? e).slice(0, 120)}`); failed++; }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(res.unknown ? 3 : (res.halted ? 3 : (failed === 0 ? 0 : 1)));
}
