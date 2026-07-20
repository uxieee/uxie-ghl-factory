// Execute a compiled AI-agent request plan through the MCP gateway. This module
// never owns credentials or fetches directly: every request is gw.call/gw.stream.

export const AI_BASE = 'https://services.leadconnectorhq.com';

const kindFor = (create) => {
  if (create?.path === '/ai-employees/employees') return 'convai';
  if (create?.path === '/voice-ai/agents') return 'voiceai';
  if (create?.path === '/agent-studio/super-agents/build') return 'studio';
  return null;
};

// The verification re-read MUST carry ?locationId= where the API requires it.
// LIVE-CAUGHT 2026-07-21 (GROM AU): `GET /voice-ai/agents/{id}` without it returns 403
// (with it: 200 — probed read-only against an existing agent). The driver reported that
// 403 as the whole operation failing, when create had returned 201 and the update 200 —
// i.e. a correct agent looked like a broken one because the CHECK was malformed.
const readPathFor = (kind, agentId, locationId) => {
  const loc = encodeURIComponent(locationId ?? '');
  return {
    convai: `/ai-employees/employees/${agentId}`,
    voiceai: `/voice-ai/agents/${agentId}?locationId=${loc}`,
    studio: `/agent-studio/super-agent/agents/${agentId}?locationId=${loc}`,
  }[kind];
};

const responseId = (body) => body?.id ?? body?._id ?? body?.agentId ?? body?.data?.id ?? body?.data?._id ?? body?.data?.agentId ?? null;

export function extractAgentId(kind, response) {
  if (kind === 'studio') return responseId(response?.terminal?.data);
  if (kind === 'convai') return response?.json?.id ?? response?.json?.data?.id ?? null;
  if (kind === 'voiceai') return response?.json?._id ?? response?.json?.id ?? response?.json?.data?._id ?? response?.json?.data?.id ?? null;
  return null;
}

const actionId = (body) => responseId(body);

const threadAgentId = (descriptor, agentId) => {
  const body = { ...(descriptor?.body ?? {}) };
  if ('employeeId' in body) body.employeeId = agentId;
  if ('agentId' in body) body.agentId = agentId;
  return { ...descriptor, path: descriptor.path.replaceAll('{agentId}', agentId), body };
};

// Separates "the server disagrees with us" from "we cannot see this field here".
// LIVE-CAUGHT 2026-07-21 (GROM AU): the Voice AI re-read returns voice/behavior settings
// nested under `agentSettings`, not top-level, so a CORRECT agent reported 37 "mismatches"
// — including fields the read never exposes flat. Reporting a false mismatch is worse than
// reporting nothing: it tells the caller their agent is broken when it is fine. Fields the
// read does not surface are now `unverified`, not `mismatched`.
const partitionVerification = (actual, expected) => {
  const mismatches = [];
  const unverified = [];
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (value === undefined) continue;
    if (!actual || typeof actual !== 'object' || !(key in actual)) { unverified.push(key); continue; }
    mismatches.push(...subsetMismatches(actual[key], value, key));
  }
  return { mismatches, unverified };
};

const subsetMismatches = (actual, expected, path = '') => {
  if (expected === undefined) return [];
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected) ? [] : [path || '$'];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [path || '$'];
    return expected.flatMap((item, index) => subsetMismatches(actual[index], item, `${path}[${index}]`));
  }
  if (!actual || typeof actual !== 'object') return [path || '$'];
  return Object.entries(expected).flatMap(([key, value]) => subsetMismatches(actual[key], value, path ? `${path}.${key}` : key));
};

const failure = (code, phase, report, extra = {}) => ({
  ok: false,
  code,
  phase,
  partial: Boolean(report.agentId),
  ...report,
  ...extra,
});

// `plan.verifyExpected` should describe the persisted state expected from the
// create/follow-up requests. It is compared as a recursive subset after a fresh GET.
export async function executeAgentPlan({ plan, gw, verifyExpected } = {}) {
  const kind = kindFor(plan?.create);
  const report = { kind, agentId: null, actionIds: [], followUps: [], actions: [], verification: null };
  if (!gw?.call || !plan?.create || !kind) return failure('AGENT_PLAN_INVALID', 'validation', report);

  let created;
  try {
    created = kind === 'studio'
      ? await gw.stream('POST', plan.create.path, plan.create.body, { base: AI_BASE })
      : await gw.call(plan.create.method, plan.create.path, plan.create.body, { base: AI_BASE });
  } catch (error) {
    return failure(error?.code ?? 'AGENT_CREATE_FAILED', 'create', report);
  }
  if (!created.ok) return failure(`HTTP_${created.status}`, 'create', report, { createStatus: created.status });
  report.agentId = extractAgentId(kind, created);
  if (!report.agentId) return failure('AGENT_ID_MISSING', 'create', report);

  for (let index = 0; index < (plan.followUps ?? []).length; index++) {
    const followUp = threadAgentId(plan.followUps[index], report.agentId);
    try {
      const result = await gw.call(followUp.method, followUp.path, followUp.body, { base: AI_BASE });
      const observed = { index, path: followUp.path, status: result.status };
      report.followUps.push(observed);
      if (!result.ok) return failure(`HTTP_${result.status}`, 'follow_up', report, { failedFollowUp: observed });
    } catch (error) {
      const observed = { index, path: followUp.path, status: null, code: error?.code ?? 'FOLLOW_UP_FAILED' };
      report.followUps.push(observed);
      return failure(observed.code, 'follow_up', report, { failedFollowUp: observed });
    }
  }

  for (let index = 0; index < (plan.actions ?? []).length; index++) {
    const action = threadAgentId(plan.actions[index], report.agentId);
    try {
      const result = await gw.call(action.method, action.path, action.body, { base: AI_BASE });
      const observed = { index, path: action.path, status: result.status, id: actionId(result.json) };
      report.actions.push(observed);
      if (!result.ok) return failure(`HTTP_${result.status}`, 'action', report, { failedAction: observed });
      if (observed.id) report.actionIds.push(observed.id);
    } catch (error) {
      const observed = { index, path: action.path, status: null, id: null, code: error?.code ?? 'ACTION_FAILED' };
      report.actions.push(observed);
      return failure(observed.code, 'action', report, { failedAction: observed });
    }
  }

  let reread;
  try { reread = await gw.call('GET', readPathFor(kind, report.agentId, gw.loc), undefined, { base: AI_BASE }); }
  catch (error) { return failure(error?.code ?? 'AGENT_VERIFY_FAILED', 'verify', report); }
  if (!reread.ok) return failure(`HTTP_${reread.status}`, 'verify', report, { verifyStatus: reread.status });

  const expected = verifyExpected ?? plan.verifyExpected ?? plan.create.body;
  const { mismatches, unverified } = partitionVerification(reread.json, expected);
  report.verification = {
    path: readPathFor(kind, report.agentId, gw.loc),
    verified: mismatches.length === 0,
    mismatches,
    // Present in what we sent, absent from what the read exposes at this level — e.g. Voice
    // AI nests voice/behavior settings under `agentSettings`. NOT evidence of a problem.
    unverified,
  };
  if (mismatches.length) return failure('AGENT_VERIFICATION_FAILED', 'verify', report);
  return { ok: true, ...report };
}
