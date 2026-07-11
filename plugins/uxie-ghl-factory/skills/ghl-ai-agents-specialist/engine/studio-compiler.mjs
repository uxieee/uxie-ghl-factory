// Deterministic compiler: Agent Studio "Super Agent" IR -> GHL internal
// /agent-studio/* payloads. See research/ai-agents-internal/agent-studio-internal.md
// and captures/studio-{create,update,delete,session}.json for the ground truth this
// traces to (ghl-workflow-api-docs repo). This module produces request DESCRIPTORS
// ({method, path, body}) — it never makes a live call. Auth is `token-id` (same
// header as ConvAI/Voice AI/KB, NOT `Authorization: Bearer`); the caller is
// responsible for attaching the header value.
//
// ============================================================================
// Two entrypoints, because CREATE and UPDATE are fundamentally different shapes
// ============================================================================
//   - compileSuperAgentCreate(...) -> POST /agent-studio/super-agents/build. Per
//     studio-create.json, creation is an SSE natural-language "build" flow: the
//     client sends a free-text prompt (`message`) and the server streams back
//     `config_partial`/`config_update` events while an LLM (the "anton" builder
//     runtime) generates the agent's config, then auto-persists it as a draft and
//     emits `agent_saved`/`done` with the new agent id. There is NO way to POST a
//     fully-specified config at create time — the request body only carries the
//     prompt text, not systemPrompt/tools/triggers/etc. This compiler can therefore
//     only build the create REQUEST (the SSE response is out of scope for a
//     request-descriptor compiler, and the streaming protocol itself is undocumented
//     per agent-studio-internal.md's "Open items" #3). To land a fully-specified
//     agent, the caller must: issue this create request -> parse the SSE stream for
//     the `done`/`agent_saved` event to learn the new agentId -> then call
//     compileSuperAgentUpdate with the FULL desired IR against that agentId (the
//     follow-up full-replace PUT is what actually sets systemPrompt, tools,
//     triggers, knowledgeBaseIds, starterPrompts, etc. precisely).
//   - compileSuperAgentUpdate(ir, opts) -> PUT
//     /agent-studio/super-agent/agents/:agentId. FULL REPLACE (like Voice AI; unlike
//     Conversation AI's merge) — "every request body observed contains the complete
//     config... even when only ONE field changed in the UI" (agent-studio-internal.md).
//     This compiler takes a FULL Super Agent IR and emits the complete `config`
//     object every Save sends. There is no partial-update path (no parseSuperAgent
//     PartialIR counterpart) — same reasoning as voiceai-compiler.mjs.
import { parseSuperAgentIR, IRError } from './studio-ir.mjs';

export const AUTH_HEADER = 'token-id';

// NL-build `mode` — the only value ever observed live (studio-create.json's
// request_body.mode). Not proven to be the only value the endpoint accepts, but the
// only one this engine can vouch for.
export const BUILD_MODES = ['fast'];

// Stable literal defaults for config sub-objects that have no IR-level knob yet
// (no variation was ever observed across any of the 4 update-capture variants):
//   - contextManagement: identical {strategy, keepRecentTurns, compactionThreshold}
//     across studio-create.json and every studio-update.json variant.
//   - plugins: identical single 'default' plugin entry (skills:[], allSkills:true,
//     i.e. "all 423 built-in CRM tools enabled") across every capture. Per-skill
//     scoping is flagged as an unresolved/gated UI path in agent-studio-internal.md's
//     "Open items" #1 — unchecking a category never fired a PUT in the captured
//     session — so this compiler has no grounded way to emit a narrower plugins[]
//     and does not attempt to.
const DEFAULTS = {
  contextManagement: { strategy: 'summarize', keepRecentTurns: 10, compactionThreshold: 0.9 },
  reasoningEffort: 'medium',
  plugins: [{ slug: 'default', name: 'Default', description: 'Built-in crm skills for your agent', skills: [], allSkills: true }],
  description: '',
};

// Normalize the IR's singular `trigger` (or, if given instead, the length-<=1
// `triggers` array — see studio-ir.mjs's checkTrigger) into the wire's `triggers[]`.
// Per the capture: selecting a trigger type REPLACES the array wholesale, so this is
// always emitted as a 0- or 1-element array, never merged with anything prior — the
// caller supplies the full desired trigger (if any) on every call, consistent with
// the full-replace semantics of the surrounding config object.
function buildTriggers(norm) {
  const t = norm.trigger ?? (Array.isArray(norm.triggers) ? norm.triggers[0] : undefined);
  if (!t) return [];
  return [{
    type: t.type,
    name: t.name ?? t.type,
    enabled: t.enabled ?? true,
    config: t.config ?? {},
    triggerMessage: t.triggerMessage ?? '',
  }];
}

// Build the full `config` object — field names/order trace 1:1 to
// studio-update.json's request_body.config (and studio-create.json's
// final_config_update_event.data, the same shape). `norm` must already be normalized
// (parseSuperAgentIR).
function buildConfig(norm) {
  const tools = new Set(norm.tools ?? []);
  // knowledgeBaseIds: capture shows `null` when unset (never an empty array) and a
  // populated array when a KB is attached — preserve that null-vs-array distinction
  // rather than defaulting to [].
  const knowledgeBaseIds = norm.knowledgeBaseIds !== undefined ? norm.knowledgeBaseIds : null;
  // "Attaching a Knowledge Base auto-adds the kb_search tool capability" — replicate
  // that so an IR that just sets knowledgeBaseIds doesn't have to separately remember
  // to also list 'kb_search' in tools.
  if (Array.isArray(knowledgeBaseIds) && knowledgeBaseIds.length > 0) tools.add('kb_search');

  return {
    name: norm.name,
    description: norm.description ?? DEFAULTS.description,
    model: norm.model,
    systemPrompt: norm.systemPrompt,
    tools: Array.from(tools),
    triggers: buildTriggers(norm),
    contextManagement: DEFAULTS.contextManagement,
    reasoning: { effort: norm.reasoningEffort ?? DEFAULTS.reasoningEffort },
    plugins: DEFAULTS.plugins,
    starterPrompts: norm.starterPrompts ?? [],
    knowledgeBaseIds,
    actions: [],
  };
}

// PUT /agent-studio/super-agent/agents/:agentId — FULL REPLACE (see module header).
// `ir` must be a complete Super Agent IR, not a partial one: this compiler has no
// network access, so it cannot GET-then-merge — the caller is responsible for having
// reconciled the IR with the server's current document before calling this (same
// caveat as compileVoiceAiUpdate).
//
// NOTE on body shape: studio-update.json's captured request_body is
// `{ locationId, config }` — the agent id appears ONLY in the URL path, never
// repeated inside the body. This compiler emits exactly that (no invented `id` key
// in the body) to stay grounded in the capture.
export function compileSuperAgentUpdate(ir, { agentId, locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'compileSuperAgentUpdate requires agentId');
  const norm = parseSuperAgentIR(ir);
  const config = buildConfig(norm);
  return {
    method: 'PUT',
    path: `/agent-studio/super-agent/agents/${agentId}`,
    body: { locationId, config },
    authHeader: AUTH_HEADER,
  };
}

// POST /agent-studio/super-agents/build — create via NL-prompt SSE (see module
// header). Per studio-create.json, the body is JUST `{ message, locationId, context:
// {companyId}, mode }`; there is no way to pass systemPrompt/tools/triggers/etc.
// here. `buildPrompt` is the free-text instruction describing the agent to generate;
// `name` (optional) is prefixed onto the message, mirroring the captured
// "TEST-CAP-STUDIO: a test agent for..." pattern where the agent's intended name was
// embedded in the NL prompt text itself, not sent as a separate field (there is no
// separate `name` field in the wire body). `companyId` (agencyId) and `mode` are
// passed through opts; `mode` defaults to 'fast', the only value ever observed live.
export function compileSuperAgentCreate({ buildPrompt, name } = {}, { locationId, companyId, mode = 'fast' } = {}) {
  if (typeof buildPrompt !== 'string' || buildPrompt.length === 0)
    throw new IRError('SCHEMA', 'buildPrompt must be a non-empty string');
  if (name !== undefined && (typeof name !== 'string' || name.length === 0))
    throw new IRError('SCHEMA', 'name must be a non-empty string when present');
  const message = name ? `${name}: ${buildPrompt}` : buildPrompt;
  const body = {
    message,
    locationId,
    context: { companyId: companyId ?? null },
    mode,
  };
  return { method: 'POST', path: '/agent-studio/super-agents/build', body, authHeader: AUTH_HEADER };
}
