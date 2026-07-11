// Deterministic compiler: Conversation AI IR -> GHL internal /ai-employees/* payloads.
// See research/ai-agents-internal/conversation-ai-internal.md and
// captures/convai-{create,update,action,kb}.json for the ground truth this traces to.
// This module produces request DESCRIPTORS ({method, path, body}) — it never makes a
// live call. Auth is `token-id` (NOT `Authorization: Bearer`) per the capture notes;
// the caller is responsible for attaching the header value.
import { parseConvaiIR, parseConvaiPartialIR, IRError } from './convai-ir.mjs';

export const AUTH_HEADER = 'token-id';

// Static defaults exactly as captured in convai-create.json's request_body (the "Start
// from Scratch" preset) — used whenever the IR omits the corresponding optional field.
const DEFAULT_WAIT = { value: 2, unit: 'seconds' };
const DEFAULT_SLEEP = { enabled: false, onManualMessage: false, onWorkflowMessage: false, time: 2, timeUnit: 'hours' };
const DEFAULT_AUTOPILOT_MAX_MESSAGES = 75;

// summary{} default — identical shape/values to convai-create.json (no IR-level knobs for
// this yet; not part of the documented input shape).
function defaultSummary() {
  return {
    enabled: false,
    inactivity: { value: 15, unit: 'minutes' },
    minimumMessages: 3,
    workflowIds: [],
    emailNotifications: { admins: false, allUsers: false, contactAssignedUser: false, specificUsers: [], customEmail: '' },
  };
}

// Build the full create-body. Field names, order, and static defaults trace 1:1 to
// convai-create.json's `request_body`.
function buildCreateBody(ir, { locationId }) {
  const wait = ir.wait ?? {};
  const sleep = ir.sleep ?? {};
  return {
    locationId,
    employeeName: ir.name,
    businessName: '',
    mode: ir.mode,
    channels: ir.channels,
    isPrimary: false,
    waitTime: wait.value ?? DEFAULT_WAIT.value,
    waitTimeUnit: wait.unit ?? DEFAULT_WAIT.unit,
    sleepEnabled: sleep.enabled ?? DEFAULT_SLEEP.enabled,
    sleepOnManualMessage: sleep.onManualMessage ?? DEFAULT_SLEEP.onManualMessage,
    sleepOnWorkflowMessage: sleep.onWorkflowMessage ?? DEFAULT_SLEEP.onWorkflowMessage,
    sleepTime: sleep.time ?? DEFAULT_SLEEP.time,
    sleepTimeUnit: sleep.timeUnit ?? DEFAULT_SLEEP.timeUnit,
    autoPilotMaxMessages: ir.autoPilotMaxMessages ?? DEFAULT_AUTOPILOT_MAX_MESSAGES,
    // actions are a separate resource (POST /ai-employees/actions, see compileConvaiAction
    // below) — they require the employeeId this create call returns, so the create body
    // itself always carries an empty array (matches convai-create.json's request_body).
    actions: [],
    personality: ir.personality ?? '',
    goal: ir.goal ?? '',
    instructions: ir.instructions ?? '',
    botType: 'PROMPT_BASED_BOT',
    knowledgeBaseIds: ir.knowledgeBaseIds ?? [],
    knowledgeBaseTriggers: [],
    summary: defaultSummary(),
    respondToImages: ir.respondToImages ?? false,
    respondToAudio: ir.respondToAudio ?? false,
    objectiveBuilderWorkflowId: '',
    isObjectiveBuilderEnabled: false,
    aiResponseLengthEnabled: false,
    responseLength: 'balanced',
  };
}

// POST /ai-employees/actions — body: {employeeId, locationId, type, name, details}
// (convai-action.json). `agentId` defaults to null: at the point compileConvaiAgent()
// assembles these, the agent does not exist yet (employeeId is server-assigned on the
// create response) — the orchestrator must patch the real id into each action body
// after issuing the create request, before POSTing the actions. Call this directly with
// a known `agentId` to compile an action against an already-existing agent.
export function compileConvaiAction(action, { agentId = null, locationId } = {}) {
  if (!action || typeof action !== 'object') throw new IRError('SCHEMA', 'action must be an object');
  if (typeof action.type !== 'string' || !action.type) throw new IRError('SCHEMA', 'action.type is required');
  if (typeof action.name !== 'string' || !action.name) throw new IRError('SCHEMA', 'action.name is required');
  if (action.details !== undefined && (typeof action.details !== 'object' || action.details === null))
    throw new IRError('SCHEMA', 'action.details must be an object when present');
  const body = {
    employeeId: agentId,
    locationId,
    type: action.type,
    name: action.name,
    details: action.details ?? {},
  };
  return { method: 'POST', path: '/ai-employees/actions', body };
}

// POST /ai-employees/employees — full create. Returns the create descriptor plus the
// (employeeId-less) action descriptors for anything in ir.actions[].
export function compileConvaiAgent(ir, { locationId } = {}) {
  const norm = parseConvaiIR(ir);
  const create = { method: 'POST', path: '/ai-employees/employees', body: buildCreateBody(norm, { locationId }) };
  const actions = (norm.actions ?? []).map((a) => compileConvaiAction(a, { agentId: null, locationId }));
  return { create, actions, authHeader: AUTH_HEADER };
}

// IR key -> wire key, for the scalar fields a partial update may touch directly.
const UPDATE_FIELD_MAP = {
  name: 'employeeName',
  mode: 'mode',
  channels: 'channels',
  personality: 'personality',
  goal: 'goal',
  instructions: 'instructions',
  autoPilotMaxMessages: 'autoPilotMaxMessages',
  knowledgeBaseIds: 'knowledgeBaseIds',
  knowledgeBaseTriggers: 'knowledgeBaseTriggers',
  respondToImages: 'respondToImages',
  respondToAudio: 'respondToAudio',
};

// PUT /ai-employees/employees/:agentId — the backend MERGES (confirmed by convai-kb.json,
// which sent only `locationId` + `knowledgeBaseTriggers` and had the rest of the record
// survive untouched). So only keys actually present on `partialIr` are emitted; there are
// no defaults here (unlike the create body).
export function compileConvaiUpdate(partialIr, { agentId, locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'compileConvaiUpdate requires agentId');
  const norm = parseConvaiPartialIR(partialIr);
  const body = { locationId };
  for (const [irKey, wireKey] of Object.entries(UPDATE_FIELD_MAP)) {
    if (norm[irKey] !== undefined) body[wireKey] = norm[irKey];
  }
  if (norm.wait !== undefined) {
    if (norm.wait.value !== undefined) body.waitTime = norm.wait.value;
    if (norm.wait.unit !== undefined) body.waitTimeUnit = norm.wait.unit;
  }
  if (norm.sleep !== undefined) {
    const s = norm.sleep;
    if (s.enabled !== undefined) body.sleepEnabled = s.enabled;
    if (s.onManualMessage !== undefined) body.sleepOnManualMessage = s.onManualMessage;
    if (s.onWorkflowMessage !== undefined) body.sleepOnWorkflowMessage = s.onWorkflowMessage;
    if (s.time !== undefined) body.sleepTime = s.time;
    if (s.timeUnit !== undefined) body.sleepTimeUnit = s.timeUnit;
  }
  return { method: 'PUT', path: `/ai-employees/employees/${agentId}`, body, authHeader: AUTH_HEADER };
}
