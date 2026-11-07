// IR (intermediate representation) parser + invariant validator for Agent Studio
// "Super Agents" (a GPT-builder-style agent; NOT the public 11-action `agent-studio`
// category). Traces to the captured schema in:
//   research/ai-agents-internal/agent-studio-internal.md
//   research/ai-agents-internal/captures/studio-{create,update,delete,session}.json
// (ghl-workflow-api-docs repo). Field names here are a clean input shape;
// studio-compiler.mjs maps them onto the exact GHL wire `config` object (tools,
// triggers, contextManagement, reasoning, plugins, etc). Mirrors convai-ir.mjs /
// voiceai-ir.mjs conventions — no deps, and the SAME IRError class (imported, not
// redefined) so callers can catch one error type across the whole engine.
import { IRError } from './convai-ir.mjs';
export { IRError };

// Underlying model. Since the 2026-10 wave the server, the AI builder and the n8n import all default a new agent to
// sonnet-5-5 (live 2026-10-30); 4-6 was the default before and still runs. Used when the IR omits `model`.
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5-5';

// The server validates a SUBAGENT's model against this list, verbatim from its 422 (live 2026-10-30, a
// subagent on anthropic/claude-haiku-4-5). It does NOT validate the parent's model: anthropic/claude-bogus-0-0
// was stored with a 200. So the parent is held to this roster plus the defaults seen running.
export const SUBAGENT_MODELS = ['anthropic/claude-sonnet-4-6', 'openrouter/z-ai/glm-5.3-flash',
  'openrouter/deepseek/deepseek-v4-flash-0731', 'openrouter/qwen/qwen3.8-27b', 'openrouter/deepseek/deepseek-v4-pro-0813',
  'openrouter/google/gemini-3.8-flash'];
const PARENT_MODELS = [DEFAULT_MODEL, ...SUBAGENT_MODELS];
// Accepted ≠ works: a subagent on this model was saved and read back, then failed EVERY delegation at run time
// (tool_completed error subagent_failed, recoverable:false, twice — the parent silently did the work itself).
const RUNTIME_FAILED_MODELS = { 'openrouter/google/gemini-3.8-flash': 'saved and read back, then failed every delegation at run time (subagent_failed, 2026-10-30)' };

// config.tools[] — the built-in capability ids. Each was written to a Managed Agent and read back live
// (2026-09-28), and the editor lists them under Capabilities / Knowledge / Apps. The server does NOT
// validate this list (an unknown id was stored), so this engine does. Attaching a KB auto-adds kb_search.
export const TOOLS = ['web_search', 'kb_search', 'web_fetch', 'image_generation', 'tts_generation', 'video_generation', 'mcp'];
// Switch-owned tool ids (2026-10): the editor's Computer switch adds the three sandbox ids, its Wait & follow up switch adds
// wait_until. They are set through `computer` / `followUp`, never listed in tools[], so a switch and its ids cannot disagree.
export const COMPUTER_TOOLS = ['sandbox_browser', 'sandbox_file', 'sandbox_exec'];
export const FOLLOW_UP_TOOL = 'wait_until';

// config.triggers[].type — the 13 types the editor's Add-trigger picker offers. Each type's config was
// written and read back live (2026-09-28). The server enforces one rule about them, the chat-alone rule
// below; everything else the editor requires (a form, a calendar, a page…) is client-side only.
export const VERIFIED_TRIGGER_TYPES = ['chat', 'form', 'tag', 'schedule', 'appointment_booked', 'appointment_status',
  'contact_created', 'opportunity_created', 'opportunity_status_changed', 'survey_submission', 'facebook_lead_gen',
  'facebook_comment', 'workflows'];
// The server's own trigger vocabulary as of 2026-10-30 (its 400 lists them): the 13 above plus three the Add-trigger picker
// gained. Their configs were not written live — inbound_webhook mints a public URL, api needs a token — so they are accepted
// by type only. Two of the 15 "supported" picker entries (`workflows`, `api`) are invocations, not events.
export const SERVER_TRIGGER_TYPES = [...VERIFIED_TRIGGER_TYPES, 'customer_reply', 'inbound_webhook', 'api'];

// The server's own rule, verbatim from its 400 (2026-10-30 wording): "…chat alone, or by a combination of non-chat
// triggers (…), but not both. Being invoked from a workflow or over the API is an exception — either can be combined with both."
export const TRIGGER_MIX_RULE = 'A Managed Agent can be triggered by chat alone, or by a combination of non-chat triggers, but not both; "workflows" and "api" can be combined with either.';
const MIX_EXEMPT = new Set(['chat', 'workflows', 'api']);

export const IMAGE_QUALITIES = ['low', 'medium', 'high'];

function assertNonEmptyString(v, field) {
  if (typeof v !== 'string' || v.length === 0) throw new IRError('SCHEMA', `${field} must be a non-empty string`);
}

function assertStringIfPresent(v, field) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw new IRError('SCHEMA', `${field} must be a string`);
}

function assertBooleanIfPresent(v, field) {
  if (v !== undefined && typeof v !== 'boolean') throw new IRError('SCHEMA', `${field} must be a boolean`);
}

function assertObject(v, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new IRError('SCHEMA', `${field} must be an object`);
}

// tools[] — optional; when present, every entry must be in the TOOLS enum. Note:
// studio-compiler.mjs auto-adds 'kb_search' when knowledgeBaseIds is non-empty
// (matching the capture's "attaching a KB auto-adds kb_search" behavior), so callers
// do not need to list it explicitly just because a KB is attached.
function checkTools(tools) {
  if (tools === undefined) return;
  if (!Array.isArray(tools)) throw new IRError('SCHEMA', 'tools must be an array');
  for (const t of tools) {
    if (!TOOLS.includes(t)) throw new IRError('BAD_TOOL', `tools[] entries must be one of ${TOOLS.join(', ')}, got: ${JSON.stringify(t)}`);
  }
}

// A single trigger's shape: {type (required), name?, enabled?, config?, triggerMessage?}.
// `field` is the caller-supplied label used in error messages (either 'trigger' or
// 'triggers[]', depending on which input shape was used — see checkTrigger below).
function checkTriggerShape(t, field) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new IRError('SCHEMA', `${field} must be an object`);
  assertNonEmptyString(t.type, `${field}.type`);
  if (!SERVER_TRIGGER_TYPES.includes(t.type)) {
    throw new IRError('BAD_TRIGGER', `${field}.type ${JSON.stringify(t.type)} is not in the server's trigger vocabulary (${SERVER_TRIGGER_TYPES.join(', ')})`);
  }
  assertStringIfPresent(t.name, `${field}.name`);
  assertBooleanIfPresent(t.enabled, `${field}.enabled`);
  if (t.config !== undefined) assertObject(t.config, `${field}.config`);
  assertStringIfPresent(t.triggerMessage, `${field}.triggerMessage`);
}

// Triggers: a singular `trigger` or a `triggers` array of any length (several triggers were stored and
// read back live; the editor marks each added type "Added"). An older version of this file allowed only
// one — that came from a capture, and the platform refutes it.
function checkTrigger(ir) {
  const hasSingle = ir.trigger !== undefined;
  const hasArray = ir.triggers !== undefined;
  if (hasSingle && hasArray) throw new IRError('SCHEMA', 'specify either `trigger` or `triggers`, not both');
  if (hasSingle && Array.isArray(ir.trigger)) throw new IRError('SCHEMA', 'trigger must be a single object; use `triggers` for several');
  if (hasArray && !Array.isArray(ir.triggers)) throw new IRError('SCHEMA', 'triggers must be an array');
  const list = hasSingle ? [ir.trigger] : hasArray ? ir.triggers : [];
  list.forEach((t) => checkTriggerShape(t, hasSingle ? 'trigger' : 'triggers[]'));
  const types = list.map((t) => t.type);
  if (types.includes('chat') && types.some((t) => !MIX_EXEMPT.has(t))) throw new IRError('TRIGGER_MIX', TRIGGER_MIX_RULE);
  for (const t of list.filter((x) => x.type === 'schedule')) {
    const sch = t.config?.schedule;
    if (!sch || typeof sch !== 'object') throw new IRError('SCHEMA', 'a schedule trigger needs config.schedule {mode, startDate, startTime, …}');
    if (!['once', 'interval', 'cron'].includes(sch.mode)) throw new IRError('SCHEMA', 'config.schedule.mode must be once, interval or cron');
  }
}

// plugins[] — the apps an agent may use. Absent means GHL's default: the Default plugin with ALL of its
// built-in CRM skills (it can message contacts and write CRM records). [] removes every app.
function checkPlugins(plugins) {
  if (plugins === undefined) return;
  if (!Array.isArray(plugins)) throw new IRError('SCHEMA', 'plugins must be an array ([] for no apps)');
  for (const p of plugins) {
    if (!p || typeof p !== 'object' || typeof p.slug !== 'string' || !p.slug) throw new IRError('SCHEMA', 'each plugin must be an object with a slug');
  }
}

function checkMedia(ir) {
  if (ir.imageGeneration !== undefined && ir.imageGeneration !== null) {
    assertObject(ir.imageGeneration, 'imageGeneration');
    if (ir.imageGeneration.quality !== undefined && !IMAGE_QUALITIES.includes(ir.imageGeneration.quality))
      throw new IRError('SCHEMA', `imageGeneration.quality must be one of ${IMAGE_QUALITIES.join(', ')}`);
  }
  if (ir.mediaSettings !== undefined) assertObject(ir.mediaSettings, 'mediaSettings');
}

function checkModel(model) {
  if (model === undefined) return;
  assertNonEmptyString(model, 'model');
  // RUNTIME_FAILED_MODELS is a SUBAGENT finding; it is not applied to the parent, where it was never observed.
  if (!PARENT_MODELS.includes(model)) {
    throw new IRError('BAD_MODEL', `model ${JSON.stringify(model)} is not one the server runs — it stores any string as an agent's model without checking. `
      + `Use one of ${PARENT_MODELS.join(', ')}, or omit it for ${DEFAULT_MODEL}.`);
  }
}

// subagents[] — inline in the agent config, not records of their own: {name, description, systemPrompt, model?}. The parent
// delegates through a `Task` tool; [] turns delegation off. The server stores unknown subagent keys verbatim, so only these
// four are accepted.
const SUBAGENT_KEYS = ['name', 'description', 'systemPrompt', 'model'];
function checkSubagents(list) {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new IRError('SCHEMA', 'subagents must be an array ([] turns delegation off)');
  list.forEach((sa, i) => {
    if (!sa || typeof sa !== 'object' || Array.isArray(sa)) throw new IRError('SCHEMA', `subagents[${i}] must be an object`);
    for (const k of ['name', 'description', 'systemPrompt']) assertNonEmptyString(sa[k], `subagents[${i}].${k}`);
    const extra = Object.keys(sa).filter((k) => !SUBAGENT_KEYS.includes(k));
    if (extra.length) throw new IRError('SCHEMA', `subagents[${i}] (${sa.name}) has key(s) the server would store and never use: ${extra.join(', ')}`);
    if (sa.model === undefined) return;
    const why = RUNTIME_FAILED_MODELS[sa.model];
    if (why) throw new IRError('BAD_MODEL', `subagents[${i}] (${sa.name}) model ${sa.model}: ${why}. Omit model to run it on the parent's.`);
    if (!SUBAGENT_MODELS.includes(sa.model)) {
      throw new IRError('BAD_MODEL', `subagents[${i}] (${sa.name}) model ${JSON.stringify(sa.model)} is not on the server's subagent roster (${SUBAGENT_MODELS.join(', ')}); the save would answer 422.`);
    }
  });
}

// The two 2026-10 editor switches. Each is {enabled: boolean} and owns its tool ids (COMPUTER_TOOLS, FOLLOW_UP_TOOL).
function checkSwitch(v, field) {
  if (v === undefined) return;
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.enabled !== 'boolean') {
    throw new IRError('SCHEMA', `${field} must be {enabled: true|false}`);
  }
}

function checkKnowledgeBaseIds(ids) {
  if (ids === undefined) return;
  if (!Array.isArray(ids)) throw new IRError('SCHEMA', 'knowledgeBaseIds must be an array');
}

// starterPrompts[] — {label, prompt}, per both captures' config.starterPrompts.
function checkStarterPrompts(prompts) {
  if (prompts === undefined) return;
  if (!Array.isArray(prompts)) throw new IRError('SCHEMA', 'starterPrompts must be an array');
  for (const p of prompts) {
    if (!p || typeof p !== 'object') throw new IRError('SCHEMA', 'each starterPrompt must be an object');
    assertNonEmptyString(p.label, 'starterPrompt.label');
    assertNonEmptyString(p.prompt, 'starterPrompt.prompt');
  }
}

// The keys create_studio_agent applies (buildPrompt is the build message; the rest land in the config PUT). Anything
// else is refused before the build starts: the compiler used to copy only what it knew, so an unknown key was dropped
// and the create still reported success.
// memoryEnabled is deliberately absent: the proven write is PATCH …/memory/settings (it sets config.memoryEnabled), and
// whether a config PUT carrying it does the same was not tested.
export const CREATE_KEYS = ['name', 'buildPrompt', 'systemPrompt', 'description', 'model', 'tools', 'trigger', 'triggers',
  'plugins', 'reasoningEffort', 'knowledgeBaseIds', 'starterPrompts', 'imageGeneration', 'mediaSettings',
  'templateId', 'folderId', 'folderName', 'customApiEnabled', 'subagents', 'computer', 'followUp'];
// The "Start from a use case" cards — a CLIENT-side list (superagentsApp 1a50@63158); the server creates from these ids.
export const STUDIO_TEMPLATE_IDS = ['knowledge-base-assistant', 'social-media-posting', 'lead-qualifier', 'welcome-email',
  'review-request', 'deal-brief', 'opportunity-pipeline', 'email-campaign', 'weekly-creative-studio', 'prospect-finder',
  'competitor-watch', 'marketing-performance-report'];
const ELSEWHERE = {
  publish: 'this tool never publishes; the agent is created as a draft',
  config: 'pass the config fields at the top level of spec (name, systemPrompt, tools, triggers, …)',
};
export function refuseUnappliedStudioKeys(spec) {
  const unapplied = Object.keys(spec ?? {}).filter((k) => !CREATE_KEYS.includes(k));
  if (!unapplied.length) return;
  const where = unapplied.filter((k) => k in ELSEWHERE).map((k) => `${k}: ${ELSEWHERE[k]}`);
  throw new IRError('SPEC_KEY_UNAPPLIED', `create_studio_agent cannot apply spec key(s) [${unapplied.join(', ')}], and refuses rather `
    + `than creating an agent without them. ${where.length ? `${where.join('; ')}. ` : ''}Nothing was sent. Applicable keys: ${CREATE_KEYS.join(', ')}.`);
}

// Folder placement and the custom-API switch, shared by both create doors. folderName travels only beside a folderId
// (the builder takes both from its route query, superagentsApp 1a50@48387).
function checkPlacementAndSwitches(ir) {
  assertStringIfPresent(ir.folderId, 'folderId');
  assertStringIfPresent(ir.folderName, 'folderName');
  if (ir.folderId === '') throw new IRError('SCHEMA', 'folderId must be a Managed Agent folder id');
  if (ir.folderName !== undefined && ir.folderId === undefined) throw new IRError('SCHEMA', 'folderName needs folderId');
  if (ir.customApiEnabled !== undefined && typeof ir.customApiEnabled !== 'boolean') throw new IRError('SCHEMA', 'customApiEnabled must be a boolean');
}

// The template door: POST …/from-template creates the agent from a use-case template (no AI build), and a PUT then
// applies ONLY what the spec authors over the template's own config. name is required, so the agent never keeps the
// template's name; systemPrompt is optional (the template has one); buildPrompt has nothing to build.
export function parseSuperAgentTemplateIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  if (!STUDIO_TEMPLATE_IDS.includes(ir.templateId)) {
    throw new IRError('SCHEMA', `templateId must be one of the use-case templates: ${STUDIO_TEMPLATE_IDS.join(', ')}`);
  }
  if (ir.buildPrompt !== undefined) {
    throw new IRError('SPEC_KEY_UNAPPLIED', 'buildPrompt is the AI build\'s message; a template create runs no build. Pass systemPrompt to replace the template\'s prompt, or drop templateId to build. Nothing was sent.');
  }
  assertNonEmptyString(ir.name, 'name');
  assertStringIfPresent(ir.systemPrompt, 'systemPrompt');
  assertStringIfPresent(ir.description, 'description');
  checkModel(ir.model);
  checkTools(ir.tools);
  checkSubagents(ir.subagents);
  checkSwitch(ir.computer, 'computer');
  checkSwitch(ir.followUp, 'followUp');
  checkTrigger(ir);
  checkPlugins(ir.plugins);
  checkMedia(ir);
  assertStringIfPresent(ir.reasoningEffort, 'reasoningEffort');
  checkKnowledgeBaseIds(ir.knowledgeBaseIds);
  checkStarterPrompts(ir.starterPrompts);
  checkPlacementAndSwitches(ir);
  return { ...ir };
}

// Full validation for the config PUT that follows the build (compileSuperAgentUpdate). Required: name, systemPrompt
// (non-empty strings). model defaults to DEFAULT_MODEL when omitted.
export function parseSuperAgentIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  assertNonEmptyString(ir.name, 'name');
  assertNonEmptyString(ir.systemPrompt, 'systemPrompt');
  assertStringIfPresent(ir.description, 'description');
  checkModel(ir.model);
  checkTools(ir.tools);
  checkSubagents(ir.subagents);
  checkSwitch(ir.computer, 'computer');
  checkSwitch(ir.followUp, 'followUp');
  checkTrigger(ir);
  checkPlugins(ir.plugins);
  checkMedia(ir);
  assertStringIfPresent(ir.reasoningEffort, 'reasoningEffort');
  checkKnowledgeBaseIds(ir.knowledgeBaseIds);
  checkStarterPrompts(ir.starterPrompts);
  checkPlacementAndSwitches(ir);
  return { ...ir, model: ir.model ?? DEFAULT_MODEL };
}
