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
  if (kind === 'studio') {
    // Prefer the terminal frame, but a `done` that arrives after `agent_saved` carries
    // no id — reading ONLY the terminal event then loses the created agent's id and
    // orphans it (review D2). Recover the id from the earlier save event in that case.
    const fromTerminal = responseId(response?.terminal?.data);
    if (fromTerminal) return fromTerminal;
    for (const event of response?.events ?? []) {
      if (event?.event === 'agent_saved' || event?.event === 'done') {
        const id = responseId(event?.data);
        if (id) return id;
      }
    }
    return null;
  }
  if (kind === 'convai') return response?.json?.id ?? response?.json?.data?.id ?? null;
  if (kind === 'voiceai') return response?.json?._id ?? response?.json?.id ?? response?.json?.data?._id ?? response?.json?.data?.id ?? null;
  return null;
}

const actionId = (body) => responseId(body);

export const STUDIO_TERMINAL_EVENTS = ['done', 'agent_saved', 'awaiting_input'];
const MAX_OPTIONS_SHOWN = 20;
/** The builder's pause, with its questions, or null when the stream did not stop for input. */
export function awaitingInput(events) {
  const list = Array.isArray(events) ? events : [];
  const wait = list.find((e) => e?.event === 'awaiting_input');
  if (!wait) return null;
  const questions = list.filter((e) => e?.event === 'build_question').map(({ data: q = {} }) => {
    const options = Array.isArray(q.options) ? q.options : [];
    return {
      id: q.id ?? null,
      prompt: q.prompt ?? null,
      allowMultiple: Boolean(q.allowMultiple),
      options: options.slice(0, MAX_OPTIONS_SHOWN).map((o) => ({ value: o?.value ?? null, label: o?.label ?? null })),
      ...(options.length > MAX_OPTIONS_SHOWN || q.hasMore ? { moreOptions: true, totalCount: q.totalCount ?? options.length } : {}),
    };
  });
  const started = list.find((e) => e?.event === 'conversation_started');
  return { sessionId: wait.data?.sessionId ?? null, count: Number(wait.data?.count ?? questions.length), questions,
    stale: list.some((e) => e?.event === 'answers_stale'),
    inlineQuestionsEnabled: typeof started?.data?.inlineQuestionsEnabled === 'boolean' ? started.data.inlineQuestionsEnabled : null };
}

// The server's own words, whole. GHL answers a refused action with `{message: [..every rule it
// broke..]}`; reporting only `HTTP_422` left the caller guessing (live 2026-09-26: an action refused
// for "transferBotType must be one of the following values: Default, Custom" surfaced as a bare 422).
export const serverMessage = (json) => {
  const m = json?.message ?? json?.error ?? null;
  if (Array.isArray(m)) return m.join('; ');
  return typeof m === 'string' ? m : (json ? JSON.stringify(json).slice(0, 1000) : null);
};

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
const emptyClass = () => ({ mismatches: [], unverified: [], confirmed: [] });
const mergeClass = (parts) => parts.reduce((acc, part) => {
  acc.mismatches.push(...part.mismatches);
  acc.unverified.push(...part.unverified);
  acc.confirmed.push(...part.confirmed);
  return acc;
}, emptyClass());

// Voice AI writes FLAT and reads NESTED. The full-replace PUT sends ~55 fields at the top
// level; the GET returns most of them under `agentSettings`, with two of them wrapped as
// objects and one unit-converted:
//
//   sent  voiceId / language / voiceModel / ringDurationSeconds: 5
//   read  agentSettings.voice{voiceId,name,provider}
//         agentSettings.language{code,name}
//         agentSettings.voiceModel
//         agentSettings.ringDurationMs: 5000                  (seconds x 1000)
//
// LIVE-CAUGHT 2026-08-25 (test sub-account): a create->update->verify run that applied every
// field correctly reported 22 confirmed and **37 unverified**, because the comparison was
// flat-to-nested. Reclassifying absent keys as `unverified` (the 2026-07-21 fix) stopped the
// false mismatches but left two thirds of the write surface unwatched — a REAL failure in any
// of those 37 would have been reported as `unverified`, indistinguishable from "not exposed".
//
// Normalising the read closes that: the fields become visible, so they are genuinely confirmed
// or genuinely mismatched. Verified field-by-field against the compiler's DEFAULTS on the same
// live agent — all 37 had in fact persisted.
//
// Live result of this fix on the same agent: **37 unverified -> 4**, 52 confirmed, 0 mismatches.
//
// What remains unverified, and why — each checked against TWO live agents (a fresh probe and a
// fully configured production agent), because "absent from one read" is not "never exposed":
//   backchannelFrequency  CONDITIONAL — absent when `enableBackchannel:false`, present (0.5)
//                         when true. Unverifiable in the off state, correctly.
//   prompts               CONDITIONAL — absent on a fresh agent, `{}` on a configured one.
//   numberPoolId          UNKNOWN — absent on both, but neither agent has a pool assigned, so
//                         "never returned" and "returned only when set" are indistinguishable
//                         from this evidence. Do not assume.
//   knowledgeBasePrompt   UNKNOWN — absent even on an agent that HAS a knowledge base attached,
//                         so likely write-only, but not proven.
const normalizeRead = (kind, json) => {
  if (kind !== 'voiceai' || !json || typeof json !== 'object') return json;
  const settings = json.agentSettings;
  if (!settings || typeof settings !== 'object') return json;
  const lifted = { ...settings, ...json };          // top level wins on genuine collisions
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in json)) lifted[key] = value;
  }
  // unwrap the two object-wrapped scalars back to what the PUT sent
  if (settings.voice && typeof settings.voice === 'object' && !('voiceId' in json)) {
    lifted.voiceId = settings.voice.voiceId;
  }
  if (settings.language && typeof settings.language === 'object' && !('language' in json)) {
    lifted.language = settings.language.code;
  }
  // and undo the unit conversion so `ringDurationSeconds` compares against what we sent
  if (typeof settings.ringDurationMs === 'number' && !('ringDurationSeconds' in json)) {
    lifted.ringDurationSeconds = settings.ringDurationMs / 1000;
  }
  // `inboundPhoneNumber` is written under that name and read back as `inboundNumber` — the same
  // class of rename as ringDurationMs. Verified on two live agents: both expose `inboundNumber`
  // at the top level and neither exposes `inboundPhoneNumber`.
  if ('inboundNumber' in json && !('inboundPhoneNumber' in json)) {
    lifted.inboundPhoneNumber = json.inboundNumber;
  }
  return lifted;
};

const partitionVerification = (actual, expected) => {
  const result = emptyClass();
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (value === undefined) continue;
    if (!actual || typeof actual !== 'object' || !(key in actual)) { result.unverified.push(key); continue; }
    const child = classify(actual[key], value, key);
    result.mismatches.push(...child.mismatches);
    result.unverified.push(...child.unverified);
    result.confirmed.push(...child.confirmed);
  }
  return result;
};

// Classify every authored leaf as confirmed (server agrees), mismatched (server
// disagrees), or unverified (the read does not expose it at this level).
// D1 (review): a key ABSENT from `actual` at ANY depth is unverified, not a mismatch.
// The old subset check applied that leniency only at the top level, so Studio's whole
// assertion — nested under `config` — counted every absent nested key as a mismatch and
// the top-level leniency protected nothing. Live proof passed only because the fields
// it checked happened to round-trip.
const classify = (actual, expected, path = '') => {
  if (expected === undefined) return emptyClass();
  if (expected === null || typeof expected !== 'object') {
    return Object.is(actual, expected)
      ? { mismatches: [], unverified: [], confirmed: [path || '$'] }
      : { mismatches: [path || '$'], unverified: [], confirmed: [] };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return { mismatches: [path || '$'], unverified: [], confirmed: [] };
    }
    return mergeClass(expected.map((item, index) => classify(actual[index], item, `${path}[${index}]`)));
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return { mismatches: [path || '$'], unverified: [], confirmed: [] };
  }
  return mergeClass(Object.entries(expected).map(([key, value]) => {
    const child = path ? `${path}.${key}` : key;
    if (!(key in actual)) return { mismatches: [], unverified: [child], confirmed: [] };
    return classify(actual[key], value, child);
  }));
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
    // awaiting_input ENDS a paused build's stream: no done, no agent_saved. The gateway throws SSE_INCOMPLETE on a stream
    // that closes without a terminal event, so a pause surfaced as a bare failure with the questions lost (live
    // 2026-09-29: a build that asked for a calendar closed with no done and saved no agent). It is a terminal here.
    created = kind === 'studio'
      ? await gw.stream('POST', plan.create.path, plan.create.body, { base: AI_BASE, terminalEvents: STUDIO_TERMINAL_EVENTS })
      : await gw.call(plan.create.method, plan.create.path, plan.create.body, { base: AI_BASE });
  } catch (error) {
    return failure(error?.code ?? 'AGENT_CREATE_FAILED', 'create', report);
  }
  if (!created.ok) return failure(`HTTP_${created.status}`, 'create', report, { createStatus: created.status, serverMessage: serverMessage(created.json) });
  report.agentId = extractAgentId(kind, created);
  // THE BUILD CAN STOP AND ASK. The Managed Agent builder streams build_question events and then awaiting_input
  // {count, sessionId}, and waits for a re-POST carrying answeredQuestions / skippedQuestionIds (superagentsApp
  // 316f@4990, 3b22@51800). Treated as a finished build, that pause read as "did not complete" with no reason. It is
  // named here, with the questions, and nothing further is sent.
  const paused = kind === 'studio' ? awaitingInput(created.events) : null;
  if (paused) return failure('STUDIO_BUILD_AWAITING_INPUT', 'create', report, { awaitingInput: paused });
  if (!report.agentId) {
    // Surface a payload-free event map so a human can locate an agent the stream saved
    // but whose id we failed to extract (review D2). Only event names + any id per frame —
    // never the generated prompt/config bodies that output_delta frames carry.
    const extra = kind === 'studio'
      ? { events: (created.events ?? []).map((event) => ({ event: event?.event ?? null, id: responseId(event?.data) })) }
      : {};
    return failure('AGENT_ID_MISSING', 'create', report, extra);
  }

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

  // A HALF-BUILT AGENT NEVER READS AS SUCCESS. The agent exists before its first action is posted, so
  // an action the server refuses leaves a real agent carrying only the actions before it. Every action
  // is attempted (one refusal does not hide the next one's), and the result names the agent, what
  // attached, what was refused and why, in the server's words.
  const refused = [];
  for (let index = 0; index < (plan.actions ?? []).length; index++) {
    const action = threadAgentId(plan.actions[index], report.agentId);
    // Conversation AI action bodies carry `type`, Voice AI ones `actionType`
    const label = { index, type: action.body?.type ?? action.body?.actionType ?? null, name: action.body?.name ?? null };
    try {
      const result = await gw.call(action.method, action.path, action.body, { base: AI_BASE });
      const observed = { ...label, path: action.path, status: result.status, id: actionId(result.json) };
      if (!result.ok) observed.serverMessage = serverMessage(result.json);
      report.actions.push(observed);
      if (!result.ok) { refused.push(observed); continue; }
      if (observed.id) report.actionIds.push(observed.id);
    } catch (error) {
      const observed = { ...label, path: action.path, status: null, id: null, code: error?.code ?? 'ACTION_FAILED' };
      report.actions.push(observed);
      refused.push(observed);
    }
  }
  if (refused.length) {
    return failure('AGENT_PARTIAL_BUILD', 'action', report, {
      partialBuild: {
        agentId: report.agentId,
        attached: report.actions.filter((a) => a.id && !refused.includes(a)).map(({ index, type, name, id }) => ({ index, type, name, id })),
        refused,
        summary: `agent ${report.agentId} EXISTS with ${report.actionIds.length} of ${(plan.actions ?? []).length} actions; `
          + refused.map((r) => `action ${r.index} (${r.type} "${r.name}") refused: ${r.serverMessage ?? r.code ?? `HTTP ${r.status}`}`).join('; '),
      },
    });
  }

  let reread;
  try { reread = await gw.call('GET', readPathFor(kind, report.agentId, gw.loc), undefined, { base: AI_BASE }); }
  catch (error) { return failure(error?.code ?? 'AGENT_VERIFY_FAILED', 'verify', report); }
  if (!reread.ok) return failure(`HTTP_${reread.status}`, 'verify', report, { verifyStatus: reread.status });

  const baseExpected = verifyExpected ?? plan.verifyExpected ?? plan.create.body;
  const actual = normalizeRead(kind, reread.json);
  // The create body carries `actions: []` because actions are attached AFTER create, by their
  // own POSTs. Comparing that empty list to the re-read — which now correctly lists what we
  // attached — failed every create that had an action (bl-181). What must hold instead is that
  // every action id we attached appears on the agent.
  const attachedActions = Array.isArray(baseExpected?.actions) && (plan.actions ?? []).length > 0;
  const expected = attachedActions ? { ...baseExpected } : baseExpected;
  if (attachedActions) delete expected.actions;
  const { mismatches, unverified, confirmed } = partitionVerification(actual, expected);
  if (attachedActions) {
    const onAgent = Array.isArray(actual?.actions)
      ? new Set(actual.actions.map((a) => (a && typeof a === 'object' ? a.id ?? a._id : a)))
      : null;
    if (!onAgent) unverified.push('actions');
    else {
      const missing = report.actionIds.filter((id) => !onAgent.has(id));
      if (missing.length || report.actionIds.length === 0) mismatches.push(`actions (missing ${missing.join(', ') || 'every attached id'})`);
      else confirmed.push(...report.actionIds.map((id) => `actions[id=${id}]`));
    }
  }
  report.verification = {
    path: readPathFor(kind, report.agentId, gw.loc),
    // D3 (review): "no mismatches" is not proof of success when NOTHING was actually
    // confirmed — e.g. every authored field landed in `unverified`. Require ≥1 confirmed
    // key so a read that exposes none of what we set cannot report `verified:true`.
    verified: mismatches.length === 0 && confirmed.length > 0,
    mismatches,
    // Keys the read exposes AND agrees with — the positive evidence `verified` rests on.
    confirmed,
    // Present in what we sent, absent from what the read exposes at this level — e.g. Voice
    // AI nests voice/behavior settings under `agentSettings`. NOT evidence of a problem.
    unverified,
  };
  if (mismatches.length) return failure('AGENT_VERIFICATION_FAILED', 'verify', report);
  // An agent was created but the re-read confirmed none of the fields we set: treat it as
  // an unproven write (possible orphan), not a success (review D3).
  if (confirmed.length === 0) return failure('AGENT_VERIFY_INCONCLUSIVE', 'verify', report);
  return { ok: true, ...report };
}

// READ-MERGE-WRITE for an existing agent, with a COLLATERAL DIFF.
//
// A partial PUT to /ai-employees/employees/:agentId resets omitted agent-level booleans — measured
// live on 2026-08-28, after a capture-derived claim that the endpoint "merges" had stood for
// months (the capture's at-risk fields were already false, so a reset was invisible in it).
// The UI never sends a partial; it PUTs the whole record. So the plan carries the whole record.
//
// Verifying only what we SET would repeat the original mistake: it is precisely the fields we did
// NOT set that a bad PUT silently resets. `collateralKeys` is that list, and any movement in it
// fails the update loudly rather than reporting a clean write.
export async function executeAgentUpdate({ plan, gw } = {}) {
  const { update, collateralKeys = [], before = {}, expected = {} } = plan ?? {};
  if (!update) return { ok: false, code: 'AGENT_PLAN_INVALID', phase: 'plan', detail: 'no update in the plan' };

  const put = await gw.call(update.method ?? 'PUT', update.path, update.body);
  if (!put?.ok) {
    // Every rule the server named, not the first 300 characters of them.
    return { ok: false, code: 'AGENT_UPDATE_FAILED', phase: 'update', status: put?.status ?? null,
      detail: serverMessage(put?.json) ?? `HTTP ${put?.status ?? '?'}` };
  }

  const reread = await gw.call('GET', update.path);
  if (!reread?.ok) {
    return { ok: false, code: 'AGENT_VERIFY_UNREACHABLE', phase: 'verify',
      detail: 'the PUT succeeded but the record could not be re-read, so nothing is proven' };
  }
  // The WRITE shape names the agent `employeeName`; the READ shape calls it `name`. Compared raw,
  // every rename reported `unverified: ["employeeName"]` — including ones that had landed (live
  // 2026-09-25). Both sides are read through the same alias so the collateral check stays even.
  const readShape = (o) => (o && typeof o === 'object' && !('employeeName' in o) && 'name' in o ? { ...o, employeeName: o.name } : (o ?? {}));
  const after = readShape(reread.json?.employee ?? reread.json);
  const { mismatches, unverified, confirmed } = partitionVerification(after, expected);

  const changed = [];
  const beforeRead = readShape(before);
  for (const key of collateralKeys) {
    const b = beforeRead?.[key];
    const a = after?.[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push({ key, before: b, after: a });
  }

  const report = {
    agentId: update.path.split('/').pop(),
    verification: { verified: mismatches.length === 0, mismatches, unverified, confirmed },
    collateral: { unchanged: changed.length === 0, changed },
  };
  if (changed.length) {
    return { ok: false, code: 'AGENT_COLLATERAL_CHANGED', phase: 'verify', ...report,
      detail: `the update moved ${changed.length} field(s) it was not asked to touch: `
        + changed.map((c) => `${c.key} ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`).join('; ') };
  }
  if (mismatches.length) return { ok: false, code: 'AGENT_VERIFY_MISMATCH', phase: 'verify', ...report };
  return { ok: true, ...report };
}
