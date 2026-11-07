// t23 (2026-09-29): Agent Logs fidelity + the Voice AI / Conversation AI log reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, registerTools } from '../core/tools.mjs';
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

// W5a Task 7 (2026-10-30): the log tools see OUTBOUND. Fixtures are the verbatim bodies of
// knowledge/sniffs/convai-wave-2026-10-29 (live-outbound-envelopes.json → agentLogInteractions; the outbound
// conversation-logs read of live-outbound-runtime-L5-L7.json step 7), every identifier and name replaced by a placeholder.
const OUTBOUND_INTERACTIONS = {
  status: 'success', conversationId: 'session_1', meta: { totalRecords: 3, page: 1, limit: 100, totalPages: 1 },
  interactions: [
    { traceId: 'trace_1', timestamp: '2026-10-29 16:19:16.396', lastSpanName: 'agent_llm_1', contactId: 'contact_1', contactName: 'Contact One',
      userQuery: '[outbound] trigger', aiResponse: 'Hi there, checking in.', userQueries: ['[outbound] trigger'], aiResponses: ['Hi there, checking in.'],
      allAttachments: [], metrics: { latencyMs: 2, statusCode: 1 } },
    { traceId: 'trace_2', timestamp: '2026-10-29 16:39:23.113', lastSpanName: 'agent_llm_1', contactId: 'contact_1', contactName: 'Contact One',
      userQuery: '[outbound] bulk_action', aiResponse: 'Hi there, checking in.', userQueries: ['[outbound] bulk_action'], aiResponses: ['Hi there, checking in.'],
      allAttachments: [], metrics: { latencyMs: 3, statusCode: 1 } },
    { traceId: 'trace_3', timestamp: '2026-10-29 16:43:56.413', lastSpanName: 'Writing reply', contactId: 'contact_1', contactName: 'Contact One',
      userQuery: '[outbound] trigger', aiResponse: 'Hello! How can I help you today?', userQueries: ['[outbound] trigger'], aiResponses: ['Hello! How can I help you today?'],
      allAttachments: [], metrics: { latencyMs: 1454, turnTokens: 2313, inputTokens: 2220, outputTokens: 93, statusCode: 1 } },
  ],
  traceId: 'trace_0',
};

test('get_agent_session labels each outbound turn with its source, parsed from "[outbound] <source>" (3 live rows)', async () => {
  const deps = gwFrom([[/summary/, { summary: {} }], [/interactions/, OUTBOUND_INTERACTIONS]]);
  const r = await tool('get_agent_session').handler({ locationId: L, agentSessionId: 'session_1', includeMetrics: false }, deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.interactions.map((i) => i.outbound), ['trigger', 'bulk_action', 'trigger']);
  // The rest of the row is untouched: the userQuery still reads verbatim.
  assert.equal(r.data.interactions[1].userQuery, '[outbound] bulk_action');
  assert.equal(r.data.interactions[2].traceId, 'trace_3');
});

test('get_agent_session: an ordinary inbound turn is outbound:null; a source the wave never saw is kept as its own string', async () => {
  const inbound = { traceId: 'msg_1', userQuery: 'What are your hours?', aiResponse: 'We open at 9.', userQueries: ['What are your hours?'], aiResponses: ['We open at 9.'] };
  const other = { traceId: 'trace_9', userQuery: '[outbound] ai_campaign', aiResponse: 'Hi', userQueries: ['[outbound] ai_campaign'], aiResponses: ['Hi'] };
  const greeting = { traceId: 'msg_2', userQuery: '', aiResponse: 'Hi', userQueries: [], aiResponses: ['Hi'] };
  const deps = gwFrom([[/summary/, { summary: {} }], [/interactions/, { interactions: [inbound, other, greeting], meta: { totalPages: 1 } }]]);
  const r = await tool('get_agent_session').handler({ locationId: L, agentSessionId: 's', includeMetrics: false }, deps);
  assert.deepEqual(r.data.interactions.map((i) => i.outbound), [null, 'ai_campaign', null]);
});

const OUTBOUND_LOGS = { items: [{ id: 'log_1', conversationId: 'conversation_1', dateAdded: '2026-10-29T16:19:17.000Z', employeeId: 'agent_1', contactId: 'contact_1',
  channel: 'SMS', lastMessage: 'Hi there, checking in.', contactName: 'Contact One', isContactDeleted: false, employeeName: 'Agent One', isEmployeeDeleted: false }],
pagination: { page: 1, limit: 20, totalItems: 1, sortOrder: 'desc' } };

test('get_convai_conversation_logs: direction "outbound" is sent as the direction query; without it no direction is sent (unchanged)', async () => {
  assert.equal(caiConversationLogsQuery({ direction: 'outbound' }).get('direction'), 'outbound');
  assert.equal(caiConversationLogsQuery({}).has('direction'), false);
  const calls = [];
  const r = await tool('get_convai_conversation_logs').handler({ locationId: L, presetPeriod: 'this-month', direction: 'outbound' },
    gwFrom([[/conversation-logs/, OUTBOUND_LOGS]], calls));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(new URLSearchParams(calls[0].p.split('?')[1]).get('direction'), 'outbound');
  assert.equal(r.data.conversations[0].conversationId, 'conversation_1');
  assert.equal(r.data.conversations[0].agentId, 'agent_1');
  const plain = [];
  await tool('get_convai_conversation_logs').handler({ locationId: L }, gwFrom([[/conversation-logs/, OUTBOUND_LOGS]], plain));
  assert.equal(plain[0].p.includes('direction='), false);
});

test('get_convai_conversation_logs: direction is outbound-only — inbound (never executed) and any other value are refused', async () => {
  let wrapped;
  const deps = gwFrom([[/conversation-logs/, OUTBOUND_LOGS]]);
  registerTools({ registerTool: (_n, _meta, fn) => { wrapped = fn; } }, deps, [tool('get_convai_conversation_logs')]);
  const call = async (a) => JSON.parse((await wrapped(a)).content[0].text);
  for (const bad of ['inbound', 'OUTBOUND', 'both']) {
    const r = await call({ locationId: L, direction: bad });
    assert.equal(r.ok, false, bad);
    assert.equal(r.code, 'VALIDATION_FAILED', bad);
  }
  // CONTROL: the schema accepts the one measured value.
  assert.equal((await call({ locationId: L, direction: 'outbound' })).ok, true);
  // The handler refuses on its own too (a caller that bypasses the schema).
  const direct = await tool('get_convai_conversation_logs').handler({ locationId: L, direction: 'inbound' }, deps);
  assert.equal(direct.code, 'VALIDATION_FAILED');
  assert.match(tool('get_convai_conversation_logs').description, /direction[^.]*outbound[^.]*inbound[^.]*(never|not) (been )?executed/i);
});
