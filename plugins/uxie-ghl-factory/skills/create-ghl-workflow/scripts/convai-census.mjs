// READ-ONLY Conversation AI census (orchestrator 2026-11-22, DECISIONS item 4; default-block rule 2026-11-22). A Conversation AI agent can start a session with NO inbound message
// when it has an ENABLED outbound trigger. conv_ai_* workflow triggers therefore BLOCK when any agent whose mode is not off has:
//   - an enabled outbound trigger of ANY type, contact_tag included whatever its tag (a non-TEST flow fired by a test contact can add any tag), unless the named run S exempts that
//     type in RUN_EXEMPTIONS (bundle-components-census.mjs; none today), or
//   - an enabled flag that is neither true nor false, or
//   - unreadable state: the agent list, its detail (mode) or its outbound rows could not be read.
// There is NO "not in event set" list any more. Agent Studio and Voice AI are judged by the same bundle read in bundle-components-census.mjs. The record carries ids, modes and trigger types only.
import { bundleComponentsCensus, bundleComponentsRecord, exempt } from './bundle-components-census.mjs';
import { agentStudioFolders } from './agent-studio-folders-read.mjs';

// No default exemptions: an enabled outbound trigger of ANY type blocks unless the named run S exempts it (see RUN_EXEMPTIONS in bundle-components-census.mjs).
export const judgeAgent = (item, plannedTags = [], runS = null) => {
  const id = item?.id ?? null;
  const mode = item?.detailRead === true && typeof item?.detail?.mode === 'string' ? item.detail.mode : null;
  const base = { id, mode, triggers: [] };
  if (mode === 'off') return { ...base, blocks: false, why: 'mode off' };
  if (mode === null) return { ...base, blocks: true, why: 'mode unreadable' };
  const rows = item?.outboundRead === true && Array.isArray(item?.outbound?.triggers) ? item.outbound.triggers : null;
  if (rows === null) return { ...base, blocks: true, why: 'outbound triggers unreadable' };
  const why = [];
  for (const r of rows) {
    const type = typeof r?.type === 'string' ? r.type : null;
    if (r?.enabled === false) { base.triggers.push({ type, enabled: false }); continue; }
    base.triggers.push({ type, enabled: r?.enabled === true ? true : null });
    if (r?.enabled !== true) { why.push(`${type ?? 'trigger'}: enabled flag unreadable`); continue; }
    if (!exempt(runS, 'convAi', type)) why.push(`${type ?? 'trigger'} outbound trigger is enabled (no exemption for this run)`);
  }
  return { ...base, blocks: why.length > 0, why: why.join('; ') || 'no enabled trigger the run can fire' };
};

// The tool's own error code and detail go in the reason and the record, so an unreadable census says WHY. Anything id-shaped (16+ alphanumerics) is masked so no account id reaches a record.
const scrub = (x, n = 200) => String(x ?? '').replace(/[A-Za-z0-9]{16,}/g, '<id>').slice(0, n);
// Why is the component incomplete? Codes, phases, counts and rate-limit state only: warning and error rows as {code, capabilityId, phase, occurrences, message} with the message
// masked by scrub() and cut short, never an item, a name, a tag or a companyId. Per phase (discovery, detail, routing, outbound) how many reads were ok or failed.
const diagRow = (w) => ({ code: scrub(w?.code ?? null, 80) || null, capabilityId: scrub(w?.capabilityId ?? null, 80) || null, phase: scrub(w?.phase ?? null, 40) || null, occurrences: Number.isFinite(w?.occurrences) ? w.occurrences : null, message: scrub(w?.detailSamples?.[0] ?? w?.detail ?? '', 120) });
// The cursor walk's own record: per page {requestedLimit, rows, newUnique, cursorPresent, totalReported} and the final {served, totalCount}. Counts and booleans only.
const walkRecord = (cw) => (cw && typeof cw === 'object' && Array.isArray(cw.pages)
  ? { pages: cw.pages.map((p) => ({ requestedLimit: p?.requestedLimit ?? null, rows: p?.rows ?? null, newUnique: p?.newUnique ?? null, cursorPresent: p?.cursorPresent === true, totalReported: Number.isFinite(p?.totalReported) ? p.totalReported : null })), served: Number.isFinite(cw.served) ? cw.served : null, totalCount: Number.isFinite(cw.totalCount) ? cw.totalCount : null }
  : null);
export function convAiDiagnostics(data) {
  const comp = data?.components?.conversation_ai ?? null;
  const items = Array.isArray(comp?.items) ? comp.items : [];
  const okCount = (key) => items.filter((x) => x?.[key] === true).length;
  const warnings = (Array.isArray(data?.warnings) ? data.warnings : []).filter((w) => w?.component === 'conversation_ai').map(diagRow);
  const errors = (Array.isArray(comp?.errors) ? comp.errors : []).map(diagRow);
  const rl = data?.rateLimit ?? null;
  return {
    complete: comp?.complete ?? null, applicable: comp?.applicable ?? null,
    warnings, errors, cursorWalk: walkRecord(comp?.cursorWalk),
    rateLimit: rl ? { limited: rl.limited === true, retryAfterMs: Number.isFinite(rl.retryAfterMs) ? rl.retryAfterMs : null } : null,
    discovery: { count: items.length, detailDenominator: Number.isFinite(comp?.detailDenominator) ? comp.detailDenominator : null },
    phases: {
      detail: { ok: okCount('detailRead'), failed: items.length - okCount('detailRead') },
      routing: { ok: okCount('routingRead'), failed: items.length - okCount('routingRead') },
      outbound: { ok: okCount('outboundRead'), failed: items.length - okCount('outboundRead') },
    },
  };
}
// read(path) -> { ok, json, status?, code? } is a GET-only reader and locationId is the 20-character location. Whenever Agent Studio is complete (foldered or not, zero agents included)
// the strict folders read (agent-studio-folders-read.mjs) is made, because the real bundle component carries no totalFolders; without a reader and location, or if the read does not prove, Agent Studio blocks.
export async function convAiCensus({ call, companyId, plannedTags = [], runS = null, read = null, locationId = null }) {
  const r = await call('get_ai_configuration_bundle', companyId ? { companyId } : {});
  const comp = r?.data?.components?.conversation_ai;
  const items = comp?.items;
  if (r?.ok !== true || !Array.isArray(items) || comp?.complete !== true) {
    const diagnostics = convAiDiagnostics(r?.data);
    const error = { code: scrub(r?.code ?? r?.error?.code ?? null, 60) || null, detail: scrub(r?.detail ?? r?.error?.message ?? r?.message ?? null), ok: r?.ok === true, hasComponent: Boolean(comp), complete: comp?.complete ?? null, itemsIsArray: Array.isArray(items), companyIdPassed: Boolean(companyId) };
    const codes = [...new Set([...diagnostics.warnings, ...diagnostics.errors].map((x) => x.code).filter(Boolean))].join(',');
    return { ok: false, blocks: true, reason: `the Conversation AI agent list is not a complete read (${error.code ?? 'no code'}: ${error.detail || 'no detail'}; component warning codes: ${codes || 'none'}; rate limited: ${diagnostics.rateLimit?.limited ?? 'unknown'})`, error, diagnostics, agents: [] };
  }
  // The read is only trusted when the server's own total is a finite number and every row was served.
  const cw = comp?.cursorWalk;
  const tot = cw?.totalCount, srv = cw?.served;
  if (!Number.isFinite(tot) || !Number.isFinite(srv) || srv !== tot || items.length !== tot) {
    return { ok: false, blocks: true, reason: `the Conversation AI agent list is not proven whole (served ${Number.isFinite(srv) ? srv : 'unknown'} of a reported total ${Number.isFinite(tot) ? tot : 'unknown'}, ${items.length} rows)`, error: null, diagnostics: convAiDiagnostics(r?.data), cursorWalk: walkRecord(cw), agents: [] };
  }
  const agents = items.map((i) => judgeAgent(i, plannedTags, runS));
  const blocking = agents.filter((a) => a.blocks);
  // Agent Studio and Voice AI come from the SAME bundle read, judged by the shared helper, so both censuses and censusGate see them.
  const studio = r.data?.components?.agent_studio;
  let foldersProof = null;
  if (studio?.complete === true && Array.isArray(studio.items) && typeof read === 'function' && typeof locationId === 'string') {
    foldersProof = await agentStudioFolders({ get: read, locationId, judged: studio.items.map((i) => i?.id).filter((x) => typeof x === 'string') });
  }
  const other = bundleComponentsCensus(r.data, plannedTags, runS, foldersProof);
  const reasons = [blocking.length ? `${blocking.length} agent(s) can start a session without an inbound message` : null, other.reason].filter(Boolean);
  return { ok: other.ok, cursorWalk: walkRecord(comp?.cursorWalk), blocks: blocking.length > 0 || other.blocks, reason: reasons.join('; ') || null, agents, otherComponents: { ...bundleComponentsRecord(other), foldersRead: foldersProof ? { ok: foldersProof.ok, reason: foldersProof.reason ?? null, totalAgents: foldersProof.totalAgents ?? null, totalFolders: foldersProof.totalFolders ?? null } : null } };
}
export const convAiRecord = (c) => ({ ok: c.ok, blocks: c.blocks, reason: c.reason, error: c.error ?? null, diagnostics: c.diagnostics ?? null, cursorWalk: c.cursorWalk ?? null, otherComponents: c.otherComponents ?? null, agents: (c.agents ?? []).map((a) => ({ id: a.id, mode: a.mode, blocks: a.blocks, why: a.why, triggers: a.triggers })) });
