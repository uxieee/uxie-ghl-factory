// d18 read-only proof: seven workflow-area READ tools, no write, no contact created, no workflow created or changed.
// Tools: get_contact_workflow_history, get_contact_workflow_journey, get_workflow_step_counts, get_workflow_heat_map,
// get_workflow_linked_assets, list_workflow_error_notifications, list_ai_agent_skills.
// The objects it reads come from the environment (GHL_PROOF_WORKFLOW_IDS, GHL_PROOF_CONTACT_IDS), set by the knowledge runner from committed records.
// No real id lives in this public file. The gateway the tools get is fenced: only GET, plus the one read-shaped POST (linked-assets search).
// Anything else throws before a socket is opened. A tool is credited only when its answer is ok AND its own completeness flag holds AND a
// second, separate read agrees; an empty answer is a shape check, not a credit. An absent route is a finding (printed), never a failure.
import { join } from 'node:path';
import { createDeclaredMarker } from './declared-marker.mjs';
import { gateOrExit } from './d18-gate.mjs';
import { makeStopControl } from './stop-control.mjs';

export const READONLY_TOOLS = Object.freeze([
  'get_contact_workflow_history', 'get_contact_workflow_journey', 'get_workflow_step_counts', 'get_workflow_heat_map',
  'get_workflow_linked_assets', 'list_workflow_error_notifications', 'list_ai_agent_skills',
]);
export const LINKED_ASSETS_ROUTE = '/workflows/es/linked-assets';
export const WID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CID_RE = /^[A-Za-z0-9]{16,30}$/;
const MAX_IDS = 3;
const DAY = 86_400_000;

export class FenceError extends Error { constructor(m) { super(m); this.name = 'FenceError'; } }
export class AuthStop extends Error { constructor(code) { super(`auth stop: ${code}`); this.name = 'AuthStop'; this.code = code; } }
const AUTH_CODES = Object.freeze(['TOKEN_EXPIRED', 'ACCESS_DENIED']);

// the ids, validated by shape and count. Anything else is refused before a call.
export function parseIds(raw, re, what) {
  const list = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new Error(`${what} is required`);
  if (list.length > MAX_IDS) throw new Error(`${what}: at most ${MAX_IDS} ids`);
  for (const x of list) if (!re.test(x)) throw new Error(`${what}: an id has the wrong shape`);
  return [...new Set(list)];
}

// A gateway whose every request method (call, callWithMeta, stream) refuses everything but a GET and the one linked-assets search POST. readBackUntil is
// dropped: no read tool in this proof uses it, and a caller that did would get a TypeError, which fails closed. Built around the real gateway.
export function fenceGateway(gw) {
  const allowed = (method, path) => {
    const m = String(method).toUpperCase();
    if (m === 'GET') return;
    if (m === 'POST' && String(path).split('?')[0] === LINKED_ASSETS_ROUTE) return;
    throw new FenceError(`read-only fence: ${m} ${String(path).split('?')[0]} is not allowed`);
  };
  const fenced = (fn) => (typeof fn === 'function' ? async (method, path, ...rest) => { allowed(method, path); return fn(method, path, ...rest); } : undefined);
  const { readBackUntil: _dropped, ...rest } = gw;
  return { ...rest, call: fenced(gw.call), callWithMeta: fenced(gw.callWithMeta), stream: fenced(gw.stream) };
}

export async function runReadonlyProof({ call, LOCATION, workflowIds, contactIds, chk, mk, say = console.log, now = Date.now(), stopped = () => false }) {
  const out = { halted: false };
  let dead = null;
  const guarded = async (n, a) => {
    if (!READONLY_TOOLS.includes(n) && n !== 'get_workflow') throw new FenceError(`read-only fence: tool ${n} is not on the list`);
    if (dead) throw new AuthStop(dead);
    if (stopped()) throw new AuthStop('STOPPED');
    const r = await call(n, a);
    if (AUTH_CODES.includes(r?.code)) { dead = r.code; say(`AUTH STOP code=${r.code} on ${n}`); throw new AuthStop(r.code); }
    return r;
  };
  const credit = (tool, cond, msg, detail) => { mk.subject(tool); chk(cond, msg, detail); mk.subject(false); };
  const noCredit = (cond, msg, detail) => { mk.subject(false); chk(cond, msg, detail); };
  const from = now - 30 * DAY;
  const [wid] = workflowIds;

  try {
    // ── error notifications (location-wide; counts only, no row is printed) ────────────────────────────────────────────
    { const a = await guarded('list_workflow_error_notifications', {});
      const b = await guarded('list_workflow_error_notifications', {});
      const rowsA = a?.data?.notifications; const rowsB = b?.data?.notifications;
      credit('list_workflow_error_notifications', a?.ok === true && a?.data?.complete === true && Array.isArray(rowsA) && rowsA.length === a.data.totalCount
        && b?.ok === true && b?.data?.complete === true && Array.isArray(rowsB) && rowsB.length === rowsA.length,
      `list_workflow_error_notifications: ok, complete, ${Array.isArray(rowsA) ? rowsA.length : '?'} row(s) reach totalCount ${a?.data?.totalCount ?? '?'}, a second read gives the same count`, `${a?.code ?? ''} ${b?.code ?? ''}`); }

    // ── AI agent skills: an absent route is a finding, not a failure ───────────────────────────────────────────────────
    { const s = await guarded('list_ai_agent_skills', {});
      if (s?.ok === true && s?.data?.complete === true && Array.isArray(s.data.skills) && s.data.skills.length === s.data.total) {
        const ids = s.data.skills.slice(0, 3).map((x) => x?.id).filter((x) => typeof x === 'string');
        if (ids.length) {
          const r = await guarded('list_ai_agent_skills', { ids });
          credit('list_ai_agent_skills', r?.ok === true && Array.isArray(r?.data?.resolved) && r.data.resolved.length === ids.length && r.data.unresolved.length === 0,
            `list_ai_agent_skills: the library walk is complete (${s.data.total}) and the resolve route returns the same ${ids.length} id(s)`, `${r?.code ?? ''}`);
        } else credit('list_ai_agent_skills', false, 'list_ai_agent_skills: the library is complete but empty, so the resolve route cannot be checked (no credit)');
      } else {
        mk.subject(false);
        say(`FINDING list_ai_agent_skills: the library read did not complete (ok=${s?.ok} code=${s?.code ?? 'none'}); recorded, no credit`);
        noCredit(true, 'list_ai_agent_skills: an absent or incomplete route is recorded as a finding (not credited)');
      } }

    // ── per-workflow reads ─────────────────────────────────────────────────────────────────────────────────────────────
    { const base = { workflowId: wid, fromDate: from, toDate: now, timezone: 'UTC' };
      const bySt = await guarded('get_workflow_step_counts', { ...base, groupBy: ['status'] });
      const byTy = await guarded('get_workflow_step_counts', { ...base, groupBy: ['type'] });
      const sum = (r) => (Array.isArray(r?.data?.statistics) ? r.data.statistics.reduce((s, x) => s + (typeof x.count === 'number' ? x.count : NaN), 0) : NaN);
      const good = bySt?.ok === true && byTy?.ok === true && bySt.data.complete === true && byTy.data.complete === true
        && sum(bySt) === bySt.data.count && sum(byTy) === byTy.data.count && bySt.data.count === byTy.data.count;
      credit('get_workflow_step_counts', good && bySt.data.count > 0,
        `get_workflow_step_counts: the 30-day window is complete and two groupings of the same walk give the same total (${bySt?.data?.count ?? '?'} row(s)); an empty window is shape-only and not credited`, `${bySt?.code ?? ''} ${byTy?.code ?? ''}`); }

    { const base = { fromDate: from, toDate: now, workflowIds: [wid] };
      const a = await guarded('get_workflow_heat_map', base);
      const b = await guarded('get_workflow_heat_map', base);
      const sumW = (r) => (Array.isArray(r?.data?.workflows) ? r.data.workflows.reduce((s, x) => s + (typeof x.count === 'number' ? x.count : 0), 0) : NaN);
      const absentA = Array.isArray(a?.data?.absent) ? a.data.absent.includes(wid) : null;
      const named = Array.isArray(a?.data?.workflows) && a.data.workflows.some((x) => x.workflowId === wid || x.id === wid);
      credit('get_workflow_heat_map', a?.ok === true && b?.ok === true && sumW(a) === a.data.total && a.data.total === b.data.total && absentA !== null && absentA === !named,
        `get_workflow_heat_map: total equals the rows, a second read gives the same total (${a?.data?.total ?? '?'}), and the workflow is named or absent, never both`, `${a?.code ?? ''} ${b?.code ?? ''}`); }

    { const a = await guarded('get_workflow_linked_assets', { workflowIds: [wid], includeWorkflowsWithoutAssets: true });
      const b = await guarded('get_workflow_linked_assets', { workflowIds: [wid], includeWorkflowsWithoutAssets: true });
      const idsA = Array.isArray(a?.data?.workflows) ? a.data.workflows.map((w) => w.id).sort().join(',') : null;
      const idsB = Array.isArray(b?.data?.workflows) ? b.data.workflows.map((w) => w.id).sort().join(',') : null;
      credit('get_workflow_linked_assets', a?.ok === true && a.data.complete === true && idsA !== null && idsA === idsB && (idsA === '' || idsA.split(',').every((x) => workflowIds.includes(x))),
        `get_workflow_linked_assets: complete, only the asked workflow(s) come back, and a second read names the same ones (${a?.data?.workflows?.length ?? '?'})`, `${a?.code ?? ''} ${b?.code ?? ''}`); }

    // ── per-contact reads ──────────────────────────────────────────────────────────────────────────────────────────────
    for (const [i, contactId] of contactIds.entries()) {
      const tag = `contact #${i + 1}`;
      const j = await guarded('get_contact_workflow_journey', { contactId });
      const h = await guarded('get_contact_workflow_history', { contactId, limit: 20 });
      const rows = Array.isArray(j?.data?.workflowStatuses) ? j.data.workflowStatuses : null;
      const runs = Array.isArray(h?.data?.runs) ? h.data.runs : null;
      credit('get_contact_workflow_journey', j?.ok === true && j.data.complete === true && rows !== null && rows.length > 0,
        `get_contact_workflow_journey (${tag}): ok, complete, count matches ${rows ? rows.length : '?'} row(s); an empty journey is shape-only and not credited`, `${j?.code ?? ''}`);
      // history: the runs' workflow ids must all appear in the journey (a separate route), and every run carries an id and status
      const jtext = rows ? JSON.stringify(rows) : '';
      const wfIds = runs ? [...new Set(runs.map((r) => r.workflowId).filter(Boolean))] : [];
      credit('get_contact_workflow_history', h?.ok === true && runs !== null && runs.length > 0 && runs.every((r) => typeof r.runId === 'string' && r.workflowId)
        && wfIds.every((x) => jtext.includes(x)),
      `get_contact_workflow_history (${tag}): ${runs ? runs.length : '?'} run(s), each with a run id and workflow, and every workflow is in the journey read from a separate route`, `${h?.code ?? ''}`);
    }
  } catch (e) {
    out.halted = true; out.reason = e instanceof AuthStop ? e.code : String(e?.message ?? e).slice(0, 120);
    say(`HALT: ${out.reason}`);
    noCredit(false, `the proof stopped early: ${out.reason}`);
  }
  say('\nLEFT: nothing was created or changed (read-only run).');
  return out;
}

// CLI
if (process.argv[1]?.endsWith('wf-readonly-proof.mjs')) {
  gateOrExit({ what: 'the entry point would run the read-only workflow proof', allowed: ['--go='] }); // FIRST: before any token, gateway or tool import
  const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
  if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(2); }
  let workflowIds; let contactIds;
  try { workflowIds = parseIds(process.env.GHL_PROOF_WORKFLOW_IDS, WID_RE, 'GHL_PROOF_WORKFLOW_IDS'); contactIds = parseIds(process.env.GHL_PROOF_CONTACT_IDS, CID_RE, 'GHL_PROOF_CONTACT_IDS'); }
  catch (e) { console.error(`REFUSED: ${e.message}`); process.exit(2); }
  if (!process.env.GHL_INTERNAL_TOK_FILE) { console.error('REFUSED: GHL_INTERNAL_TOK_FILE is not set; there is no default token file'); process.exit(2); }
  const { fileURLToPath } = await import('node:url');
  const CORE = join(fileURLToPath(new URL('.', import.meta.url)), '../../../mcp-internal/core');
  const { makeGatewayFactory, TOOLS } = await import(join(CORE, 'tools.mjs'));
  const { callSafe } = await import('./run-hygiene.mjs');
  const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE, engineVersion: 'workflows-wf-readonly-proof', allowedLocations: new Set([LOCATION]), renewer: null };
  const deps = { state, makeGw: (o = {}) => fenceGateway(makeGatewayFactory({ state })(o)) };
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const mk = createDeclaredMarker(READONLY_TOOLS);
  const stopCtl = makeStopControl();
  const rawCall = (n, a) => stopCtl.guard(() => callSafe((nm, args) => tool(nm).handler({ locationId: LOCATION, ...args }, deps), n, a));
  const call = mk.wrapCall(rawCall);
  let passed = 0, failed = 0;
  const check = (cond, m, extra) => { if (cond) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); } };
  const chk = (c, m, d) => mk.check(c, m, d, check);
  const onSig = async () => { await stopCtl.stop(5000).catch(() => {}); try { mk.write(); } catch { /* reported by exit */ } process.exit(143); };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { void onSig(); });
  console.log(`read-only proof: ${READONLY_TOOLS.length} tools, ${workflowIds.length} workflow(s), ${contactIds.length} contact(s)`);
  let res = { halted: true };
  try { res = await runReadonlyProof({ call, LOCATION, workflowIds, contactIds, chk, mk, stopped: () => stopCtl.stopped }); }
  catch (e) { failed++; console.log(`  FAIL  the proof threw: ${String(e?.message ?? e).slice(0, 120)}`); }
  try { mk.write(); } catch (e) { console.log(`  FAIL  the exercised marker could not be written: ${String(e?.message ?? e).slice(0, 120)}`); failed++; }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(res.halted ? 3 : (failed === 0 ? 0 : 1));
}
