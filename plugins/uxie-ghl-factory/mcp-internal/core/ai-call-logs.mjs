// Voice AI call logs and Conversation AI conversation logs — the two per-product log tables outside Agent Logs.
//
// Measured on the designated test sub-account, 2026-09-29 (knowledge/sniffs/ai-agents-t23-logs-2026-09-29/), every
// filter by a differential against the unfiltered read:
//
//  Voice AI (`GET /voice-ai/dashboard/call-logs`, the call-logs table):
//   - `page` is REQUIRED (1–10000) and `pageSize` is at most 50 (422 "pageSize cannot exceed 50").
//   - `sort` is `ascend | descend` (not asc/desc) and `sortBy` is `duration | createdAt` — both server enums.
//   - `direction` is `INBOUND | OUTBOUND` (uppercase). `callType` `LIVE | TRIAL` splits real calls from test calls; with
//     neither, both come back (44 = 3 LIVE + 41 TRIAL).
//   - `contactId` and `actionType` take comma-separated lists; actionType is a server enum (below).
//   - `startDate` / `endDate` are epoch MILLISECONDS.
//   - `query` is REFUSED: 422 "property query should not exist" — the client still has the parameter, the UI never sends it.
//   - `timezone` is optional (the UI sends the browser's).
//  Voice call detail: `GET /voice-ai/call/{callId}?locationId&agentId` with the call-log row's `_id` (the provider call id
//   answers 403). Returns the transcript with tool calls, telephony data, summary and status.
//  Voice outbound queue: `GET /voice-ai/dashboard/pending-call-logs?locationId&limit&after&status&contactId&agentId&
//   startDate&endDate` → {pendingCalls, total, nextCursor, hasMore}. The server does NOT validate `status` (a bogus value
//   answers 200); the builder's values are queued · scheduled · rejected.
//
//  Conversation AI (`GET /ai-employees/employees/{locationId}/conversation-logs`, the dashboard's Conversation Logs):
//   - scope is REQUIRED: `presetPeriod` (server enum below) OR both `from` and `to` (ISO 8601).
//   - `channel`, `employeeId`, `contactId` filter; `sortOrder` asc|desc; `page` + `limit` (default 20; not capped by the
//     server — 101 returned 101 — so this tool caps it at 100).
//   - a bogus channel answers 200 with 0 rows, so a typo reads as "no conversations".
//  Its View Transcript / Summary: `GET /ai-employees/summary/{locationId}/contact/{contactId}?page&limit&channelName` →
//   {items[{summary, trigger, transcript[{direction, body…}], channelName, employeeId, summaryWindowStart/EndTime…}],
//   totalCount}. Items exist only where the agent's conversation summary produced one; `channelName` filters them.

export const VOICE_ACTION_TYPES = ['CALL_TRANSFER', 'DATA_EXTRACTION', 'IN_CALL_DATA_EXTRACTION', 'WORKFLOW_TRIGGER', 'SMS',
  'APPOINTMENT_BOOKING', 'CUSTOM_ACTION', 'KNOWLEDGE_BASE'];
export const VOICE_SORT_FIELDS = ['createdAt', 'duration'];
export const VOICE_PAGE_SIZE_MAX = 50;
export const PENDING_STATUSES = ['queued', 'scheduled', 'rejected'];
export const CAI_PRESET_PERIODS = ['today', 'this-week', 'prev-week', 'this-month', 'prev-month', 'this-year', 'prev-year'];
export const CAI_LIMIT_MAX = 100;

/** A date the caller wrote (ISO date / datetime, or epoch ms) → epoch ms, or null when unreadable. */
export const toEpochMs = (v, { endOfDay = false } = {}) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (/^\d{10,}$/.test(s)) return Number(s);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const t = Date.parse(dateOnly ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s);
  return Number.isFinite(t) ? t : null;
};

export function voiceCallLogsQuery(args) {
  const q = new URLSearchParams({ locationId: args.locationId, pageSize: String(args.pageSize ?? 20), page: String(args.page ?? 1) });
  if (args.timezone) q.set('timezone', args.timezone);
  if (args.agentId) q.set('agentId', args.agentId);
  if (args.contactIds?.length) q.set('contactId', args.contactIds.join(','));
  const from = toEpochMs(args.startDate); const to = toEpochMs(args.endDate, { endOfDay: true });
  if (from !== null) q.set('startDate', String(from));
  if (to !== null) q.set('endDate', String(to));
  if (args.actionTypes?.length) q.set('actionType', args.actionTypes.join(','));
  if (args.sortBy) q.set('sortBy', args.sortBy);
  if (args.sortOrder) q.set('sort', args.sortOrder === 'asc' ? 'ascend' : 'descend');
  if (args.callType) q.set('callType', args.callType);
  if (args.direction) q.set('direction', args.direction);
  return q;
}

const actionsOf = (row) => (row?.executedCallActions ?? []).map((a) => a?.actionType ?? a?.type ?? null).filter(Boolean);

export const voiceCallRow = (r, { includeTranscript = false } = {}) => ({
  callId: r._id ?? null, createdAt: r.createdAt ?? null, durationSec: r.duration ?? null,
  agentId: r.agentId ?? null, agentName: r.agentName ?? null, agentDeleted: r.isAgentDeleted ?? null,
  contactId: r.contactId ?? null, contactName: r.contactName ?? null,
  callType: r.callType ?? null, direction: r.direction ?? null, trialCall: r.trialCall ?? null, callStatus: r.callStatus ?? null,
  actions: actionsOf(r), agentTransferOccurred: r.agentTransferOccurred ?? null, workflowName: r.workflowName ?? null,
  summary: r.summary ?? null, extractedData: r.extractedData ?? null,
  ...(includeTranscript ? { transcript: r.transcript ?? null, translation: r.translation ?? null } : {}),
});

export function voicePendingQuery(args) {
  const q = new URLSearchParams({ locationId: args.locationId, limit: String(args.limit ?? 20) });
  if (args.after) q.set('after', args.after);
  if (args.status) q.set('status', args.status);
  if (args.contactIds?.length === 1) q.set('contactId', args.contactIds[0]);
  if (args.agentId) q.set('agentId', args.agentId);
  const from = toEpochMs(args.startDate); const to = toEpochMs(args.endDate, { endOfDay: true });
  if (from !== null) q.set('startDate', String(from));
  if (to !== null) q.set('endDate', String(to));
  return q;
}

export function caiConversationLogsQuery(args) {
  const q = new URLSearchParams();
  if (args.from || args.to) { q.set('from', args.from); q.set('to', args.to); } else q.set('presetPeriod', args.presetPeriod ?? 'this-month');
  if (args.channel) q.set('channel', args.channel);
  if (args.agentId) q.set('employeeId', args.agentId);
  if (args.contactId) q.set('contactId', args.contactId);
  q.set('sortOrder', args.sortOrder ?? 'desc');
  q.set('limit', String(args.limit ?? 20));
  q.set('page', String(args.page ?? 1));
  return q;
}

export const caiLogRow = (r) => ({
  id: r.id ?? null, conversationId: r.conversationId ?? null, at: r.dateAdded ?? null, channel: r.channel ?? null,
  agentId: r.employeeId ?? null, agentName: r.employeeName ?? null, agentDeleted: r.isEmployeeDeleted ?? null,
  contactId: r.contactId ?? null, contactName: r.contactName ?? null, contactDeleted: r.isContactDeleted ?? null,
  lastMessage: r.lastMessage ?? null,
});

export const caiSummaryRow = (r, { includeTranscript = true } = {}) => ({
  channel: r.channelName ?? null, agentId: r.employeeId ?? null, trigger: r.trigger ?? null, summary: r.summary ?? null,
  windowStart: r.summaryWindowStartTime ?? null, windowEnd: r.summaryWindowEndTime ?? null, createdAt: r.createdAt ?? null,
  firstMessageId: r.firstMessageId ?? null, lastMessageId: r.lastMessageId ?? null,
  ...(includeTranscript ? { transcript: r.transcript ?? [] } : { transcriptMessages: (r.transcript ?? []).length }),
});
