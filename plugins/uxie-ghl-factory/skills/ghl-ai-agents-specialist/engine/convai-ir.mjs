// IR (intermediate representation) parser + invariant validator for Conversation AI
// ("AI Employee") agents. Traces to the captured schema in:
//   research/ai-agents-internal/conversation-ai-internal.md
//   research/ai-agents-internal/captures/convai-{create,update,action,kb}.json
// (ghl-workflow-api-docs repo). Field names here are a clean, provider-agnostic input
// shape; convai-compiler.mjs maps them onto the exact GHL wire field names (employeeName,
// botType, etc). Mirrors create-ghl-workflow/engine/ir.mjs conventions (IRError, no deps).

export class IRError extends Error {
  constructor(code, message) { super(message); this.name = 'IRError'; this.code = code; }
}

// mode enum — observed live on both create + update (lowercase strings).
export const MODES = ['off', 'suggestive', 'autoPilot'];
// channels enum — observed live on create + update.
export const CHANNELS = ['SMS', 'IG', 'FB', 'WebChat', 'Live_Chat', 'WhatsApp'];
// Only humanHandOver is live-verified (convai-action.json). Other type values seen only as
// UI button labels (Appointment Booking, Trigger a Workflow, Contact Info, Stop Bot,
// Transfer Bot, Auto Followup) are NOT rejected here — they pass through as
// accepted-but-unverified, per the doc's "capture next" note.
export const VERIFIED_ACTION_TYPES = ['humanHandOver'];

function assertNonEmptyString(v, field) {
  if (typeof v !== 'string' || v.length === 0) throw new IRError('SCHEMA', `${field} must be a non-empty string`);
}

function checkMode(mode) {
  if (!MODES.includes(mode)) throw new IRError('BAD_MODE', `mode must be one of ${MODES.join(', ')}, got: ${JSON.stringify(mode)}`);
}

function checkChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) throw new IRError('BAD_CHANNELS', 'channels must be a non-empty array');
  for (const c of channels) {
    if (!CHANNELS.includes(c)) throw new IRError('BAD_CHANNELS', `unknown channel: ${JSON.stringify(c)} (allowed: ${CHANNELS.join(', ')})`);
  }
}

function checkActions(actions) {
  if (actions === undefined) return;
  if (!Array.isArray(actions)) throw new IRError('SCHEMA', 'actions must be an array');
  for (const a of actions) {
    if (!a || typeof a !== 'object') throw new IRError('SCHEMA', 'each action must be an object');
    assertNonEmptyString(a.type, 'action.type');
    assertNonEmptyString(a.name, 'action.name');
    if (a.details !== undefined && (typeof a.details !== 'object' || a.details === null))
      throw new IRError('SCHEMA', 'action.details must be an object when present');
  }
}

function checkWait(wait) {
  if (wait === undefined) return;
  if (!wait || typeof wait !== 'object') throw new IRError('SCHEMA', 'wait must be an object');
  if (wait.value !== undefined && typeof wait.value !== 'number') throw new IRError('SCHEMA', 'wait.value must be a number');
  if (wait.unit !== undefined && typeof wait.unit !== 'string') throw new IRError('SCHEMA', 'wait.unit must be a string');
}

function checkSleep(sleep) {
  if (sleep === undefined) return;
  if (!sleep || typeof sleep !== 'object') throw new IRError('SCHEMA', 'sleep must be an object');
  for (const boolField of ['enabled', 'onManualMessage', 'onWorkflowMessage']) {
    if (sleep[boolField] !== undefined && typeof sleep[boolField] !== 'boolean')
      throw new IRError('SCHEMA', `sleep.${boolField} must be a boolean`);
  }
  if (sleep.time !== undefined && typeof sleep.time !== 'number') throw new IRError('SCHEMA', 'sleep.time must be a number');
  if (sleep.timeUnit !== undefined && typeof sleep.timeUnit !== 'string') throw new IRError('SCHEMA', 'sleep.timeUnit must be a string');
}

function checkKnowledgeBaseIds(ids) {
  if (ids === undefined) return;
  if (!Array.isArray(ids)) throw new IRError('SCHEMA', 'knowledgeBaseIds must be an array');
}

// Full validation — used when compiling a create (POST /ai-employees/employees). Required:
// name, mode (enum), channels (enum, non-empty). Everything else is optional with
// capture-grounded defaults applied by the compiler.
export function parseConvaiIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  assertNonEmptyString(ir.name, 'name');
  checkMode(ir.mode);
  checkChannels(ir.channels);
  checkActions(ir.actions);
  checkWait(ir.wait);
  checkSleep(ir.sleep);
  checkKnowledgeBaseIds(ir.knowledgeBaseIds);
  return { ...ir };
}

// Partial validation — used when compiling an update (PUT /ai-employees/employees/:id,
// which MERGES per the captured semantics). Every field is optional, but any field that
// IS present must still satisfy its enum/shape.
export function parseConvaiPartialIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  if (ir.name !== undefined) assertNonEmptyString(ir.name, 'name');
  if (ir.mode !== undefined) checkMode(ir.mode);
  if (ir.channels !== undefined) checkChannels(ir.channels);
  checkActions(ir.actions);
  checkWait(ir.wait);
  checkSleep(ir.sleep);
  checkKnowledgeBaseIds(ir.knowledgeBaseIds);
  return { ...ir };
}
