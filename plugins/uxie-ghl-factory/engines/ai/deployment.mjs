// set_agent_deployment — put ONE agent on ONE channel (a row of the Agent Deployment routing table), and prove
// that nothing else in the table moved.
//
// The routing table is account-wide: every agent's rows live in one list (GET …/configs?locationId=), and a row
// decides which bot answers a channel's conversations. So the write here is shaped by one rule — only the named
// agent's row is ever written — and one proof: the whole table is read before and after, and every other row
// must come back byte-identical.
//
// Measured (knowledge corpus ai-agents/20-api/agent-deployment-routing.md):
//   - POST /routing-config/configs creates a row: full row + locationId, agentId, agentProductType; providerId is
//     the channel name for a native channel, or an installed provider's _id. Create does NOT run the conflict check.
//   - PATCH /routing-config/configs/{id} MERGES; the editor sends the full row, and so does this tool.
//   - Enabling a row whose audience overlaps another agent's enabled row on the same channel + provider +
//     product answers 409 naming that row. Disjoint tag scopes coexist.
//   - Email and WebChat (the Chat widget card) are always "all" — the editor offers no identifier picker.
//   - The DTO is a strict whitelist; operators are AND | OR.

export const DEPLOY_PATH = '/agent-deployment/routing-config/configs';
export const CHANNELS = ['SMS', 'Email', 'WhatsApp', 'IG', 'FB', 'WebChat', 'Live_Chat', 'TIKTOK'];
export const FORCED_ALL = new Set(['Email', 'WebChat']);
const OPERATORS = ['AND', 'OR'];
// The keys the editor sends on save (the full row); POST adds the identity keys.
export const ROW_KEYS = ['enabled', 'allIdentifiers', 'specificIdentifiers', 'includeTags', 'includeTagsOperator', 'excludeTags', 'excludeTagsOperator'];
// 🔴 Measured 2026-09-29: a POST with an EMPTY list stores the row WITHOUT that key (excludeTags: [] came back absent),
// while a PATCH with [] stores []. So an absent list means []: every comparison reads the lists through this.
const LIST_KEYS = new Set(['specificIdentifiers', 'includeTags', 'excludeTags']);
const val = (r, k) => (r?.[k] === undefined && LIST_KEYS.has(k) ? [] : r?.[k] ?? null);

class DeployError extends Error { constructor(message) { super(message); this.code = 'VALIDATION_FAILED'; } }
const strings = (v, name) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) throw new DeployError(`${name} must be a list of non-empty strings`);
  return [...new Set(v)];
};

// args → the row the caller wants. Everything is explicit: a row is always written whole.
export function compileDeploymentIntent(args) {
  const { agentId, channel } = args;
  if (typeof agentId !== 'string' || !agentId) throw new DeployError('agentId is required');
  if (!CHANNELS.includes(channel)) throw new DeployError(`channel must be one of ${CHANNELS.join(', ')}`);
  if (typeof args.enabled !== 'boolean') throw new DeployError('enabled must be true or false — the whole intent is always sent');
  const providerId = args.providerId ?? channel;
  if (typeof providerId !== 'string' || !providerId) throw new DeployError('providerId must be a non-empty string (omit it for a native channel)');
  if (providerId !== channel && !['SMS', 'Email'].includes(channel)) throw new DeployError('a marketplace providerId is only offered for SMS or Email');
  const agentProductType = args.agentProductType ?? 'conversation_ai';
  const specificIdentifiers = strings(args.specificIdentifiers, 'specificIdentifiers');
  const forced = FORCED_ALL.has(channel) || providerId !== channel;
  if (forced && specificIdentifiers.length) throw new DeployError(`${providerId !== channel ? 'a marketplace provider row' : channel} is always "all" — specificIdentifiers are not offered`);
  const allIdentifiers = forced ? true : (args.allIdentifiers ?? specificIdentifiers.length === 0);
  if (typeof allIdentifiers !== 'boolean') throw new DeployError('allIdentifiers must be true or false');
  if (allIdentifiers && specificIdentifiers.length) throw new DeployError('allIdentifiers:true and specificIdentifiers together — pick one');
  if (!allIdentifiers && !specificIdentifiers.length) throw new DeployError('allIdentifiers:false needs at least one specificIdentifier (the editor requires one)');
  const includeTags = strings(args.includeTags, 'includeTags');
  const excludeTags = strings(args.excludeTags, 'excludeTags');
  const both = includeTags.filter((t) => excludeTags.includes(t));
  if (both.length) throw new DeployError(`a tag may not be in both lists (${both.join(', ')}) — the editor refuses it`);
  const includeTagsOperator = args.includeTagsOperator ?? 'AND';
  const excludeTagsOperator = args.excludeTagsOperator ?? 'AND';
  for (const [k, v] of [['includeTagsOperator', includeTagsOperator], ['excludeTagsOperator', excludeTagsOperator]]) {
    if (!OPERATORS.includes(v)) throw new DeployError(`${k} must be AND or OR`);
  }
  return {
    identity: { agentId, channel, providerId, agentProductType },
    row: { enabled: args.enabled, allIdentifiers, specificIdentifiers, includeTags, includeTagsOperator, excludeTags, excludeTagsOperator },
  };
}

const sameTarget = (r, id) => r.agentId === id.agentId && r.channel === id.channel && r.providerId === id.providerId
  && (r.agentProductType ?? 'conversation_ai') === id.agentProductType;
const overlaps = (a, b) => {
  // Two audiences are disjoint only when one includes a tag the other excludes (or both include different tags).
  const ai = a.includeTags ?? [], bi = b.includeTags ?? [], ae = a.excludeTags ?? [], be = b.excludeTags ?? [];
  if (ai.some((t) => be.includes(t)) || bi.some((t) => ae.includes(t))) return false;
  if (ai.length && bi.length && !ai.some((t) => bi.includes(t))) return false;
  return true;
};

// rows (the whole table) + intent → create | update | noop, plus what else on this channel could collide.
export function planDeployment(rows, intent, { locationId }) {
  if (!Array.isArray(rows)) throw new DeployError('the routing table read did not return a list');
  const mine = rows.filter((r) => sameTarget(r, intent.identity));
  if (mine.length > 1) {
    return { refuse: `the agent has ${mine.length} rows for ${intent.identity.channel} / ${intent.identity.providerId} — ambiguous, nothing written`, rows: mine.map((r) => r.id) };
  }
  const rivals = rows.filter((r) => r.agentId !== intent.identity.agentId && r.enabled && r.channel === intent.identity.channel
    && r.providerId === intent.identity.providerId && (r.agentProductType ?? 'conversation_ai') === intent.identity.agentProductType);
  const collisions = intent.row.enabled ? rivals.filter((r) => overlaps(r, intent.row)).map((r) => ({ rowId: r.id, agentId: r.agentId, includeTags: r.includeTags, excludeTags: r.excludeTags })) : [];
  if (!mine.length) {
    return { action: 'create', method: 'POST', path: DEPLOY_PATH, body: { locationId, ...intent.identity, ...intent.row }, collisions, othersCount: rows.length };
  }
  const cur = mine[0];
  const changed = ROW_KEYS.filter((k) => JSON.stringify(val(cur, k)) !== JSON.stringify(intent.row[k]));
  if (!changed.length) return { action: 'noop', rowId: cur.id, collisions, othersCount: rows.length - 1 };
  return { action: 'update', method: 'PATCH', path: `${DEPLOY_PATH}/${encodeURIComponent(cur.id)}`, rowId: cur.id, body: { ...intent.row }, changed, before: pick(cur), collisions, othersCount: rows.length - 1 };
}

const pick = (r) => Object.fromEntries(ROW_KEYS.map((k) => [k, val(r, k)]));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// before/after tables + the target → the proof: the target row equals the intent, every other row is identical.
export function verifyDeployment(beforeRows, afterRows, intent, targetId) {
  const target = targetId ? afterRows.find((r) => r.id === targetId) : afterRows.filter((r) => sameTarget(r, intent.identity));
  const row = Array.isArray(target) ? (target.length === 1 ? target[0] : null) : target;
  const mismatches = row ? ROW_KEYS.filter((k) => JSON.stringify(val(row, k)) !== JSON.stringify(intent.row[k])) : ['row not found after the write'];
  const byId = new Map(afterRows.map((r) => [r.id, r]));
  const others = beforeRows.filter((r) => r.id !== row?.id);
  const changedOthers = others.filter((r) => !byId.has(r.id) || !same(r, byId.get(r.id))).map((r) => r.id);
  const appeared = afterRows.filter((r) => r.id !== row?.id && !beforeRows.some((b) => b.id === r.id)).map((r) => r.id);
  return { verified: !!row && !mismatches.length && !changedOthers.length && !appeared.length, rowId: row?.id ?? null,
    row: row ? pick(row) : null, mismatches, othersUnchanged: others.length - changedOthers.length, changedOthers, appeared };
}

export async function executeDeployment({ gw, locationId, intent, confirm }) {
  const list = `${DEPLOY_PATH}?locationId=${encodeURIComponent(locationId)}`;
  const r0 = await gw.call('GET', list);
  if (!r0?.ok) return { ok: false, http: r0 };
  const before = r0.json;
  let plan;
  try { plan = planDeployment(before, intent, { locationId }); } catch (e) { return { ok: false, code: 'ENGINE_ABORT', detail: e.message }; }
  const preview = plan;
  if (plan.refuse) return { ok: false, code: 'VALIDATION_FAILED', detail: plan.refuse, preview };
  if (!confirm || plan.action === 'noop') return { ok: true, preview, confirmed: false };
  const w = await gw.call(plan.method, plan.path, plan.body);
  if (!w?.ok) {
    // A 409 names the enabled row it collided with; nothing else is attempted. Re-read anyway: a 500 may half-write.
    const r1 = await gw.call('GET', list);
    const verification = r1?.ok ? verifyDeployment(before, r1.json, intent, plan.rowId) : null;
    return { ok: false, http: w, preview, verification };
  }
  const createdId = plan.action === 'create' ? (w.json?.id ?? w.json?._id ?? w.json?.data?.id) : plan.rowId;
  const r1 = await gw.call('GET', list);
  if (!r1?.ok) return { ok: false, code: 'VERIFY_FAILED', detail: 'the write was acknowledged but the table could not be re-read', preview, written: plan.action };
  const verification = verifyDeployment(before, r1.json, intent, createdId);
  return { ok: verification.verified, code: verification.verified ? undefined : 'VERIFY_FAILED', preview, written: plan.action, verification };
}
