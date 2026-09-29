// t23 (2026-09-29): Agent Logs fidelity + the Voice AI / Conversation AI log reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { classifyCall } from '../core/location-binding.mjs';
import { PRODUCTS, sessionRow, FILTER_FIELDS } from '../core/agent-logs.mjs';
import { voiceCallLogsQuery, voiceCallRow, voicePendingQuery, caiConversationLogsQuery, toEpochMs } from '../core/ai-call-logs.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const L = 'loc-1';
const gwFrom = (routes, calls = []) => ({ state: {}, makeGw: () => ({ call: async (m, p, b) => { calls.push({ m, p, b }); const hit = routes.find(([re]) => re.test(p)); return hit ? { ok: true, status: 200, json: hit[1] } : { ok: false, status: 404, json: {} }; } }) });

test('Agent Logs: ai_studio is a product, and a session row carries messageCount', () => {
  assert.ok(PRODUCTS.includes('ai_studio'));
  assert.equal(sessionRow({ conversationId: 'c', messageCount: 4 }).messageCount, 4);
  assert.equal(sessionRow({ conversationId: 'c' }).messageCount, null);
  assert.deepEqual(FILTER_FIELDS, ['agentName', 'contactName', 'channel', 'voiceName']);
});

test('get_agent_session keeps userQueries[] and aiResponses[] (the greeting turn has userQuery "")', async () => {
  const deps = gwFrom([[/summary/, { summary: {} }], [/interactions/, { interactions: [{ traceId: 't', userQuery: '', aiResponse: 'Hi', userQueries: [], aiResponses: ['Hi', 'How can I help?'] }], meta: { totalPages: 1 } }]]);
  const r = await tool('get_agent_session').handler({ locationId: L, agentSessionId: 's', includeMetrics: false }, deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.interactions[0].aiResponses, ['Hi', 'How can I help?']);
  assert.deepEqual(r.data.interactions[0].userQueries, []);
});

test('get_agent_log_filter_values is a READ despite its POST (clears the unbound-registration write gate); control: without readOnly it would classify write', () => {
  const t = tool('get_agent_log_filter_values');
  assert.equal(classifyCall(t, { locationId: L }), 'read');
  assert.equal(classifyCall({ ...t, readOnly: undefined }, { locationId: L }), 'write');
  for (const n of ['get_voice_call_logs', 'get_convai_conversation_logs']) assert.equal(classifyCall(tool(n), { locationId: L }), 'read', n);
});

test('get_agent_log_filter_values sends the dropdown body and returns the names', async () => {
  const calls = [];
  const r = await tool('get_agent_log_filter_values').handler({ locationId: L, field: 'channel' }, gwFrom([[/filter-values/, { status: 'success', data: ['SMS', 'web_call'] }]], calls));
  assert.deepEqual(r.data.values, ['SMS', 'web_call']);
  assert.deepEqual(calls[0].b, { locationId: L, field: 'channel', search: '', limit: 100 });
});

test('voice call-logs query: server spellings (ascend/descend, csv lists, epoch-ms dates), and never `query`', () => {
  const q = voiceCallLogsQuery({ locationId: L, page: 2, pageSize: 50, agentId: 'a', contactIds: ['c1', 'c2'], actionTypes: ['SMS', 'KNOWLEDGE_BASE'],
    startDate: '2026-09-01', endDate: '2026-09-02', sortBy: 'duration', sortOrder: 'asc', callType: 'LIVE', direction: 'INBOUND' });
  assert.equal(q.get('sort'), 'ascend');
  assert.equal(q.get('contactId'), 'c1,c2');
  assert.equal(q.get('actionType'), 'SMS,KNOWLEDGE_BASE');
  assert.equal(q.get('startDate'), String(Date.parse('2026-09-01T00:00:00.000Z')));
  assert.equal(q.get('endDate'), String(Date.parse('2026-09-02T23:59:59.999Z')));
  assert.equal(q.get('page'), '2');
  assert.equal(q.has('query'), false);
  assert.equal(voiceCallLogsQuery({ locationId: L, sortOrder: 'desc' }).get('sort'), 'descend');
  assert.equal(toEpochMs('1790000000000'), 1790000000000);
  assert.equal(toEpochMs('not a date'), null);
});

test('voice call row: concise by default, the transcript on request', () => {
  const raw = { _id: 'x', duration: 70, executedCallActions: [{ actionType: 'WORKFLOW_TRIGGER' }], transcript: 'bot: hi', agentName: 'A', callType: 'web_call' };
  assert.equal('transcript' in voiceCallRow(raw), false);
  assert.deepEqual(voiceCallRow(raw).actions, ['WORKFLOW_TRIGGER']);
  assert.equal(voiceCallRow(raw, { includeTranscript: true }).transcript, 'bot: hi');
});

test('get_voice_call_logs: the call view needs callId AND agentId; the queue takes one contact; the table maps rows', async () => {
  const t = tool('get_voice_call_logs');
  const none = gwFrom([]);
  assert.equal((await t.handler({ locationId: L, view: 'call', callId: 'x' }, none)).code, 'VALIDATION_FAILED');
  assert.equal((await t.handler({ locationId: L, view: 'pending', contactIds: ['a', 'b'] }, none)).code, 'VALIDATION_FAILED');
  assert.equal((await t.handler({ locationId: L, startDate: 'nope' }, none)).code, 'VALIDATION_FAILED');
  const calls = [];
  const r = await t.handler({ locationId: L, pageSize: 1 }, gwFrom([[/call-logs/, { callLogs: [{ _id: 'x', duration: 5 }], totalRecords: 3 }]], calls));
  assert.equal(r.data.calls[0].callId, 'x');
  assert.equal(r.data.hasMore, true);
  const p = await t.handler({ locationId: L, view: 'pending', status: 'queued' }, gwFrom([[/pending-call-logs/, { pendingCalls: [], total: 0, nextCursor: null, hasMore: false }]]));
  assert.equal(p.data.count, 0);
  assert.equal(voicePendingQuery({ locationId: L, status: 'queued', contactIds: ['c'] }).get('contactId'), 'c');
});

test('get_convai_conversation_logs: a scope is always sent; from/to go together; summaries need a contact', async () => {
  assert.equal(caiConversationLogsQuery({}).get('presetPeriod'), 'this-month');
  const ft = caiConversationLogsQuery({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z', agentId: 'e' });
  assert.equal(ft.has('presetPeriod'), false);
  assert.equal(ft.get('employeeId'), 'e');
  const t = tool('get_convai_conversation_logs');
  const none = gwFrom([]);
  assert.equal((await t.handler({ locationId: L, from: '2026-09-01T00:00:00Z' }, none)).code, 'VALIDATION_FAILED');
  assert.equal((await t.handler({ locationId: L, view: 'summaries' }, none)).code, 'VALIDATION_FAILED');
  const s = await t.handler({ locationId: L, view: 'summaries', contactId: 'c', channel: 'SMS' },
    gwFrom([[/summary/, { items: [{ summary: 'S', trigger: 'INACTIVITY', transcript: [{ direction: 'inbound', body: 'hi' }], channelName: 'SMS' }], totalCount: 1 }]]));
  assert.equal(s.data.summaries[0].summary, 'S');
  assert.equal(s.data.summaries[0].transcript.length, 1);
  const logs = await t.handler({ locationId: L, presetPeriod: 'this-year', limit: 1 },
    gwFrom([[/conversation-logs/, { items: [{ id: 'i', employeeId: 'e', employeeName: 'E', channel: 'SMS' }], pagination: { page: 1, limit: 1, totalItems: 5 } }]]));
  assert.equal(logs.data.conversations[0].agentName, 'E');
  assert.equal(logs.data.hasMore, true);
});
