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

// config.tools[] enum — agent-studio-internal.md: "Capabilities -> tools[] 1:1:
// web_search, image_generation; attaching a KB auto-adds kb_search." All three are
// captured live (studio-update.json variants 1/3/4).
export const TOOLS = ['web_search', 'image_generation', 'kb_search'];

// config.triggers[].type values actually observed live: 'chat' (studio-create.json's
// default "Chat Started" trigger, auto-added by the NL build) and 'contact_created'
// (studio-update.json variant 2, "Add trigger" -> "Contact created"). The doc's
// endpoint map also lists 6 more UI labels (Form submitted, Lead tag, Schedule,
// Appointment booked, Appointment status, Opportunity created, Opportunity status
// changed) but their wire `type` slugs were never captured, so — same epistemic
// stance as voiceai-ir.mjs's VERIFIED_ACTION_TYPES — this engine does not guess
// them. Any trigger.type string is accepted; only these two are "verified".
export const VERIFIED_TRIGGER_TYPES = ['chat', 'contact_created'];

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

// Single-trigger constraint: per agent-studio-internal.md, "PUT REPLACES the whole
// `config` object... the UI only supports one active trigger at a time per agent,
// not multiple concurrent triggers" (selecting a new type REPLACES the array, it
// never appends). This IR mirrors that with a singular `trigger` field (the primary,
// documented input shape) but also accepts a raw `triggers` array — for callers that
// already have a wire-shaped list (e.g. reconciled from a prior GET) — PROVIDED it
// has at most one element; 2+ elements is a hard IRError, since the real builder can
// never produce or accept that shape.
function checkTrigger(ir) {
  const hasSingle = ir.trigger !== undefined;
  const hasArray = ir.triggers !== undefined;
  if (hasSingle && hasArray) throw new IRError('SCHEMA', 'specify either `trigger` or `triggers`, not both');
  if (hasSingle) {
    if (Array.isArray(ir.trigger)) throw new IRError('TOO_MANY_TRIGGERS', 'trigger must be a single object, not an array — Super Agents support only ONE active trigger');
    checkTriggerShape(ir.trigger, 'trigger');
  }
  if (hasArray) {
    if (!Array.isArray(ir.triggers)) throw new IRError('SCHEMA', 'triggers must be an array');
    if (ir.triggers.length > 1) throw new IRError('TOO_MANY_TRIGGERS', `Super Agents support only ONE active trigger; got ${ir.triggers.length}`);
    for (const t of ir.triggers) checkTriggerShape(t, 'triggers[]');
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

// Full validation — used by both compileSuperAgentUpdate (full-replace PUT) and
// (for its up-front shape check) compileSuperAgentCreate. Required: name,
// systemPrompt (non-empty strings). model defaults to DEFAULT_MODEL when omitted —
// this is the one field this IR normalizes rather than leaving to the compiler,
// since both captures show it as a fixed literal with no IR-level knob to vary it
// yet.
export function parseSuperAgentIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  assertNonEmptyString(ir.name, 'name');
  assertNonEmptyString(ir.systemPrompt, 'systemPrompt');
  assertStringIfPresent(ir.description, 'description');
  assertStringIfPresent(ir.model, 'model');
  checkTools(ir.tools);
  checkTrigger(ir);
  assertStringIfPresent(ir.reasoningEffort, 'reasoningEffort');
  checkKnowledgeBaseIds(ir.knowledgeBaseIds);
  checkStarterPrompts(ir.starterPrompts);
  return { ...ir, model: ir.model ?? DEFAULT_MODEL };
}
