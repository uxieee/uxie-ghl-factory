// d18 read-only follow-up proof: get_workflow_step_counts and get_workflow_heat_map on ONE workflow that has real past executions. No write, no create, no contact created.
// The first read-only batch could not credit either tool: its workflow had no execution rows in the window, so both answers were empty (shape-only, no credit).
// This proof reads a workflow that already ran. A later draft of that workflow does not change reads of PAST executions. It credits a tool only when the answer is
// non-empty, complete and agrees with a second, separate read. An empty answer is shape-only and is reported as FAIL, never green. Same fenced gateway as wf-readonly-proof.
import { join } from 'node:path';
import { createDeclaredMarker } from './declared-marker.mjs';
import { gateOrExit } from './d18-gate.mjs';
import { makeStopControl } from './stop-control.mjs';
import { fenceGateway, parseIds, WID_RE, AuthStop } from './wf-readonly-proof.mjs';

export const RUNTIME_TOOLS = Object.freeze(['get_workflow_step_counts', 'get_workflow_heat_map']);
const DAY = 86_400_000;
const AUTH_CODES = Object.freeze(['TOKEN_EXPIRED', 'ACCESS_DENIED']);

export async function runRuntimeProof({ call, workflowId, chk, mk, say = console.log, now = Date.now(), stopped = () => false }) {
  const out = { halted: false }; let dead = null;
  const guarded = async (n, a) => {
    if (!RUNTIME_TOOLS.includes(n)) throw new Error(`read-only fence: tool ${n} is not on the list`);
    if (dead) throw new AuthStop(dead);
    if (stopped()) throw new AuthStop('STOPPED');
    const r = await call(n, a);
    if (AUTH_CODES.includes(r?.code)) { dead = r.code; say(`AUTH STOP code=${r.code} on ${n}`); throw new AuthStop(r.code); }
    return r;
  };
  const credit = (tool, cond, msg, detail) => { mk.subject(tool); chk(cond, msg, detail); mk.subject(false); };
  const from = now - 30 * DAY;
  try {
    const base = { workflowId, fromDate: from, toDate: now, timezone: 'UTC' };
    const bySt = await guarded('get_workflow_step_counts', { ...base, groupBy: ['status'] });
    const byTy = await guarded('get_workflow_step_counts', { ...base, groupBy: ['type'] });
    const sum = (r) => (Array.isArray(r?.data?.statistics) ? r.data.statistics.reduce((s, x) => s + (typeof x.count === 'number' ? x.count : NaN), 0) : NaN);
    credit('get_workflow_step_counts', bySt?.ok === true && byTy?.ok === true && bySt.data.complete === true && byTy.data.complete === true
      && sum(bySt) === bySt.data.count && sum(byTy) === byTy.data.count && bySt.data.count === byTy.data.count && bySt.data.count > 0,
    `get_workflow_step_counts: the 30-day window is complete, two groupings of the same walk give the same non-empty total (${bySt?.data?.count ?? '?'} row(s))`, `${bySt?.code ?? ''} ${byTy?.code ?? ''}`);
    const hb = { fromDate: from, toDate: now, workflowIds: [workflowId] };
    const a = await guarded('get_workflow_heat_map', hb);
    const b = await guarded('get_workflow_heat_map', hb);
    const sumW = (r) => (Array.isArray(r?.data?.workflows) ? r.data.workflows.reduce((s, x) => s + (typeof x.count === 'number' ? x.count : 0), 0) : NaN);
    const named = Array.isArray(a?.data?.workflows) && a.data.workflows.some((x) => (x.workflowId ?? x.id) === workflowId);
    const absent = Array.isArray(a?.data?.absent) ? a.data.absent.includes(workflowId) : null;
    credit('get_workflow_heat_map', a?.ok === true && b?.ok === true && named && absent === false && sumW(a) === a.data.total && a.data.total > 0 && a.data.total === b.data.total,
      `get_workflow_heat_map: the workflow is NAMED with a non-zero count, total equals the rows (${a?.data?.total ?? '?'}), and a second read gives the same total`, `${a?.code ?? ''} ${b?.code ?? ''}`);
  } catch (e) {
    out.halted = true; out.reason = e instanceof AuthStop ? e.code : String(e?.message ?? e).slice(0, 120);
    say(`HALT: ${out.reason}`); mk.subject(false); chk(false, `the proof stopped early: ${out.reason}`);
  }
  say('\nLEFT: nothing was created or changed (read-only run).');
  return out;
}

// CLI
if (process.argv[1]?.endsWith('wf-readonly-runtime-proof.mjs')) {
  gateOrExit({ what: 'the entry point would run the read-only runtime proof', allowed: ['--go='] }); // FIRST
  const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
  if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(2); }
  if (!process.env.GHL_INTERNAL_TOK_FILE) { console.error('REFUSED: GHL_INTERNAL_TOK_FILE is not set; there is no default token file'); process.exit(2); }
  let workflowId; try { [workflowId] = parseIds(process.env.GHL_PROOF_WORKFLOW_IDS, WID_RE, 'GHL_PROOF_WORKFLOW_IDS'); if (process.env.GHL_PROOF_WORKFLOW_IDS.includes(',')) throw new Error('exactly one workflow id'); }
  catch (e) { console.error(`REFUSED: ${e.message}`); process.exit(2); }
  const { fileURLToPath } = await import('node:url');
  const CORE = join(fileURLToPath(new URL('.', import.meta.url)), '../../../mcp-internal/core');
  const { makeGatewayFactory, TOOLS } = await import(join(CORE, 'tools.mjs'));
  const { callSafe } = await import('./run-hygiene.mjs');
  const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE, engineVersion: 'workflows-wf-readonly-runtime-proof', allowedLocations: new Set([LOCATION]), renewer: null };
  const deps = { state, makeGw: (o = {}) => fenceGateway(makeGatewayFactory({ state })(o)) };
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const mk = createDeclaredMarker(RUNTIME_TOOLS);
  const stopCtl = makeStopControl();
  const call = mk.wrapCall((n, a) => stopCtl.guard(() => callSafe((nm, args) => tool(nm).handler({ locationId: LOCATION, ...args }, deps), n, a)));
  let passed = 0, failed = 0;
  const check = (cond, m, extra) => { if (cond) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); } };
  const chk = (c, m, d) => mk.check(c, m, d, check);
  const onSig = async () => { await stopCtl.stop(5000).catch(() => {}); try { mk.write(); } catch { /* reported by exit */ } process.exit(143); };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { void onSig(); });
  console.log(`read-only runtime proof: ${RUNTIME_TOOLS.length} tools, 1 workflow`);
  let res = { halted: true };
  try { res = await runRuntimeProof({ call, workflowId, chk, mk, stopped: () => stopCtl.stopped }); }
  catch (e) { failed++; console.log(`  FAIL  the proof threw: ${String(e?.message ?? e).slice(0, 120)}`); }
  try { mk.write(); } catch (e) { console.log(`  FAIL  the exercised marker could not be written: ${String(e?.message ?? e).slice(0, 120)}`); failed++; }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(res.halted ? 3 : (failed === 0 ? 0 : 1));
}
