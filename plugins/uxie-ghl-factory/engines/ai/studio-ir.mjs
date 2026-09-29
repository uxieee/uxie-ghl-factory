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

// Underlying model, per BOTH studio-create.json and studio-update.json's captured
// config.model — the only value ever observed live. Not proven to be the only value
// the builder can emit, but it's the only one this engine can vouch for, so it's
// also the default studio-compiler.mjs falls back to when the IR omits `model`.
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

// config.tools[] — the built-in capability ids. Each was written to a Managed Agent and read back live
// (2026-09-28), and the editor lists them under Capabilities / Knowledge / Apps. The server does NOT
// validate this list (an unknown id was stored), so this engine does. Attaching a KB auto-adds kb_search.
export const TOOLS = ['web_search', 'kb_search', 'web_fetch', 'image_generation', 'tts_generation', 'video_generation', 'mcp'];

// config.triggers[].type — the 13 types the editor's Add-trigger picker offers. Each type's config was
// written and read back live (2026-09-28). The server enforces one rule about them, the chat-alone rule
// below; everything else the editor requires (a form, a calendar, a page…) is client-side only.
export const VERIFIED_TRIGGER_TYPES = ['chat', 'form', 'tag', 'schedule', 'appointment_booked', 'appointment_status',
  'contact_created', 'opportunity_created', 'opportunity_status_changed', 'survey_submission', 'facebook_lead_gen',
  'facebook_comment', 'workflows'];

// The server's own rule, verbatim from its 400: "A Managed Agent can be triggered by chat alone, or by a
// combination of non-chat triggers (…), but not both. Being invoked from a workflow is an exception — it
// can be combined with either."
export const TRIGGER_MIX_RULE = 'A Managed Agent can be triggered by chat alone, or by a combination of non-chat triggers, but not both; "workflows" can be combined with either.';

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
  if (types.includes('chat') && types.some((t) => t !== 'chat' && t !== 'workflows')) throw new IRError('TRIGGER_MIX', TRIGGER_MIX_RULE);
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
export const CREATE_KEYS = ['name', 'buildPrompt', 'systemPrompt', 'description', 'model', 'tools', 'trigger', 'triggers',
  'plugins', 'reasoningEffort', 'knowledgeBaseIds', 'starterPrompts', 'imageGeneration', 'mediaSettings',
  'templateId', 'folderId', 'folderName', 'customApiEnabled'];
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
  assertStringIfPresent(ir.model, 'model');
  checkTools(ir.tools);
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
  assertStringIfPresent(ir.model, 'model');
  checkTools(ir.tools);
  checkTrigger(ir);
  checkPlugins(ir.plugins);
  checkMedia(ir);
  assertStringIfPresent(ir.reasoningEffort, 'reasoningEffort');
  checkKnowledgeBaseIds(ir.knowledgeBaseIds);
  checkStarterPrompts(ir.starterPrompts);
  checkPlacementAndSwitches(ir);
  return { ...ir, model: ir.model ?? DEFAULT_MODEL };
}
