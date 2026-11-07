// Deterministic compiler: Agent Studio "Super Agent" IR -> GHL internal
// /agent-studio/* payloads. See research/ai-agents-internal/agent-studio-internal.md
// and captures/studio-{create,update,delete,session}.json for the ground truth this
// traces to (ghl-workflow-api-docs repo). This module produces request DESCRIPTORS
// ({method, path, body}) — it never makes a live call. Auth is the gateway's `ai`
// rail (Bearer JWT plus Firebase token-id); the caller owns no credential value.
//
// ============================================================================
// Create = SSE build, then a config PUT
// ============================================================================
//   - compileSuperAgentCreate(...) -> POST /agent-studio/super-agents/build (SSE). The builder's full body is
//     { message, locationId, context:{companyId}, mode:"fast", existingAgentId?, sessionId?, answeredQuestions?,
//     skippedQuestionIds?, folderId?, folderName? } (superagentsApp 3b22@47053); this compiler sends the first four.
//     The stream carries conversation_started {inlineQuestionsEnabled}, generating, config events, agent_saved {id},
//     done — and, when the builder wants answers, build_question {id, prompt, options[{value,label}], allowMultiple}
//     and awaiting_input {count, sessionId}, after which the build waits for a re-POST carrying answeredQuestions /
//     skippedQuestionIds (316f@4990, 3b22@51800). driver.mjs stops on awaiting_input and names the questions; this
//     tool does not answer them.
//   - There are other create doors this tool does not use: a direct save POST /agent-studio/super-agent/agents
//     {locationId, agencyId, builderSessionId, config, folderId?} (316f@6534) and POST
//     /agent-studio/super-agent/agents/from-template {templateId, locationId, folderId?, folderName?} (316f@10170).
//   - compileSuperAgentUpdate(ir, opts) -> PUT /agent-studio/super-agent/agents/:agentId with { locationId, config }.
//     The builder sends the WHOLE config on every save, so this compiler emits the complete config from a full IR;
//     every key it sends overwrites the build's own; a top-level key it omits is KEPT by the server (live 2026-10-30).
import { parseSuperAgentIR, refuseUnappliedStudioKeys, IRError, COMPUTER_TOOLS, FOLLOW_UP_TOOL } from './studio-ir.mjs';

export const AUTH_HEADER = 'ai';

// NL-build `mode` — the only value ever observed live (studio-create.json's
// request_body.mode). Not proven to be the only value the endpoint accepts, but the
// only one this engine can vouch for.
export const BUILD_MODES = ['fast'];

// Stable literal defaults for config sub-objects that have no IR-level knob yet
// (no variation was ever observed across any of the 4 update-capture variants):
//   - contextManagement: identical {strategy, keepRecentTurns, compactionThreshold}
//     across studio-create.json and every studio-update.json variant.
//   - plugins: GHL's own default for a new agent — the Default plugin with every built-in CRM skill
//     (allSkills:true; 540 skills on 2026-09-28, including sending SMS/email and writing contacts and
//     opportunities). Used only when the IR omits `plugins`; `plugins: []` (no apps) is honoured, and
//     the tool's preview names the default so it is never applied silently.
export const DEFAULT_PLUGINS = [{ slug: 'default', name: 'Default', description: 'Built-in crm skills for your agent', skills: [], allSkills: true }];

const DEFAULTS = {
  contextManagement: { strategy: 'summarize', keepRecentTurns: 10, compactionThreshold: 0.9 },
  reasoningEffort: 'medium',
  plugins: DEFAULT_PLUGINS,
  description: '',
};

// The IR's singular `trigger` or its `triggers` array, mapped whole onto the wire's `triggers[]` (the
// config is sent whole, so the caller supplies every trigger it wants on every call).
function buildTriggers(norm) {
  const list = norm.trigger ? [norm.trigger] : Array.isArray(norm.triggers) ? norm.triggers : [];
  return list.map((t) => ({
    type: t.type,
    name: t.name ?? t.type,
    enabled: t.enabled ?? true,
    config: t.config ?? {},
    // Omitted when not given: GHL replaces a missing or empty triggerMessage with a per-type default (live
    // 2026-09-28: chat → "A new chat conversation has started with a contact. Begin the intake flow."), so an
    // emitted '' could never verify.
    ...(t.triggerMessage !== undefined ? { triggerMessage: t.triggerMessage } : {}),
  }));
}

// Build the full `config` object — field names/order trace 1:1 to
// studio-update.json's request_body.config (and studio-create.json's
// final_config_update_event.data, the same shape). `norm` must already be normalized
// (parseSuperAgentIR).
// tools[] with the switch-owned ids applied: Computer adds the three sandbox ids, Wait & follow up adds wait_until (as the
// editor's autosave does, live 2026-10-30). A switch the IR leaves unset adds nothing.
function switchTools(norm, base) {
  const tools = new Set(base);
  if (norm.computer?.enabled) COMPUTER_TOOLS.forEach((t) => tools.add(t));
  if (norm.followUp?.enabled) tools.add(FOLLOW_UP_TOOL);
  return tools;
}

// The keys the 2026-10 wave added, each only when the IR sets it: the server KEEPS a config key a PUT omits (subagents and
// starterPrompts proven live 2026-10-30), so an unset key must stay out rather than overwrite with a default. `computer` is
// sent null when switched on, as the editor sends it; the server then stamps {approvalRevision}.
function waveKeys(norm) {
  return {
    ...(norm.subagents !== undefined ? { subagents: norm.subagents } : {}),
    ...(norm.computer?.enabled ? { computer: null } : {}),
  };
}

function buildConfig(norm) {
  const tools = switchTools(norm, norm.tools ?? []);
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
    plugins: norm.plugins ?? DEFAULTS.plugins,
    starterPrompts: norm.starterPrompts ?? [],
    knowledgeBaseIds,
    actions: [],
    ...(norm.imageGeneration !== undefined ? { imageGeneration: norm.imageGeneration } : {}),
    ...(norm.mediaSettings !== undefined ? { mediaSettings: norm.mediaSettings } : {}),
    // The editor's Custom API switch is a top-level config key, sent only by this PUT (superagentsApp 3b22@151825).
    ...(norm.customApiEnabled !== undefined ? { customApiEnabled: norm.customApiEnabled } : {}),
    ...waveKeys(norm),
  };
}

// PUT /agent-studio/super-agent/agents/:agentId — the whole config, as the builder saves it (see module header).
// `ir` must be a complete Super Agent IR: every config field it omits gets the default below.
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
// header). The build body carries no config: systemPrompt, tools, triggers etc. land in
// the config PUT that follows. `buildPrompt` is the free-text instruction describing the agent to generate;
// `name` (optional) is prefixed onto the message, mirroring the captured
// "TEST-CAP-STUDIO: a test agent for..." pattern where the agent's intended name was
// embedded in the NL prompt text itself, not sent as a separate field (there is no
// separate `name` field in the wire body). `companyId` (agencyId) and `mode` are
// passed through opts; `mode` defaults to 'fast', the only value ever observed live.
export function compileSuperAgentCreate({ buildPrompt, name, folderId, folderName } = {}, { locationId, companyId, mode = 'fast' } = {}) {
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
    // Folder placement rides the build body, each key only when set (superagentsApp 3b22@47060).
    ...(folderId ? { folderId } : {}),
    ...(folderId && folderName ? { folderName } : {}),
  };
  return { method: 'POST', path: '/agent-studio/super-agents/build', body, authHeader: AUTH_HEADER };
}

// POST /agent-studio/super-agent/agents/from-template — a "Start from a use case" card (superagentsApp 316f@10170): the
// server creates a DRAFT from the template at once, no AI build, and answers {id, config, status, …} (live 2026-09-29:
// knowledge-base-assistant → the Default plugin with ALL skills, kb_search + web_search, a CHAT trigger enabled:true).
export function compileSuperAgentFromTemplate({ templateId, folderId, folderName } = {}, { locationId } = {}) {
  const body = { templateId, locationId, ...(folderId ? { folderId } : {}), ...(folderId && folderName ? { folderName } : {}) };
  return { method: 'POST', path: '/agent-studio/super-agent/agents/from-template', body, json: true, authHeader: AUTH_HEADER };
}

// What a template create overlays on the template's own config: ONLY the keys the spec authors (the PUT is a whole
// replace, so the template's config is read from the create's answer and sent back with these on top).
export function templateOverrides(ir) {
  const o = {};
  for (const k of ['name', 'description', 'model', 'systemPrompt', 'plugins', 'starterPrompts', 'knowledgeBaseIds',
    'imageGeneration', 'mediaSettings', 'customApiEnabled']) if (ir[k] !== undefined) o[k] = ir[k];
  if (ir.tools !== undefined) {
    o.tools = [...switchTools(ir, [...ir.tools, ...(Array.isArray(ir.knowledgeBaseIds) && ir.knowledgeBaseIds.length ? ['kb_search'] : [])])];
  } else if (ir.computer?.enabled || ir.followUp?.enabled) {
    // No tools authored: the switch ids are ADDED to the template's own tools at merge time, never put in their place.
    o.addTools = [...switchTools(ir, [])];
  }
  Object.assign(o, waveKeys(ir));
  if (ir.reasoningEffort !== undefined) o.reasoning = { effort: ir.reasoningEffort };
  if (ir.trigger !== undefined || (Array.isArray(ir.triggers) && ir.triggers.length)) o.triggers = buildTriggers(ir);
  return o;
}

// 🔴 `triggers: []` in the PUT is IGNORED — the stored triggers stay, enabled (live 2026-09-29, own draft, twice). What
// sticks is each trigger sent back with enabled:false. So a spec's `triggers: []` means "disable every trigger".
export const disablesTriggers = (ir) => Array.isArray(ir.triggers) && ir.triggers.length === 0 && ir.trigger === undefined;
export function mergeTemplateConfig(templateConfig, overrides, { disableTriggers = false } = {}) {
  const { addTools, ...rest } = overrides ?? {};
  const merged = { ...(templateConfig ?? {}), ...rest };
  if (addTools) merged.tools = [...new Set([...(templateConfig?.tools ?? []), ...addTools])];
  if (disableTriggers) merged.triggers = (templateConfig?.triggers ?? []).map((t) => ({ ...t, enabled: false }));
  return merged;
}
