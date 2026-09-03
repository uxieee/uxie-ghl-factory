// Agent Logs — the /agent-logs service on the AI rail (services.leadconnectorhq.com).
//
// Mapped and live-proven 2026-09-03; the corpus page is
// knowledge/corpus/ai-agents/20-api/agent-logs.md. The rules encoded here are the ones that
// silently give wrong answers rather than erroring, so they belong in code, not in a doc:
//
//  1. PAGINATION. `(page-1)*limit` must be <= 500 or the server 400s "Page too deep". There are
//     two ways past it: a big `limit` (uncapped — 1000 returned 424 rows in one call), or the
//     `pageToken` cursor. The cursor only works when `page` is OMITTED — send both and `page`
//     silently wins, which is what makes the token look inert.
//  2. The cursor is keyed on latestActivity+conversationId, so under a non-timestamp `sortBy`
//     it NEVER ADVANCES — it returns the same first row forever. We refuse that combination
//     rather than loop.
//  3. The cursor is INCLUSIVE under sortOrder:asc (one duplicate row per hop) and exclusive
//     under desc. The walker de-duplicates by conversationId so either order is safe.
//  4. The cursor carries no filters. Every hop must re-send the whole body.
//  5. spans: do NOT pass conversationId. The UI sends it and it DROPS the `ai_splitter` span —
//     the branch decision and its reasoning, the most valuable row in the trace. Live sweep:
//     6 of 24 traces differed and the dropped span was the splitter every time. Calling with
//     locationId alone returns the complete turn.

export const SORT_FIELDS = ['timestamp', 'agentName', 'aiProduct', 'contactName', 'channel', 'durationMs', 'totalTokens'];
export const TIME_RANGES = ['1_day', '7_days', '14_days', '30_days', '90_days', 'custom'];
export const PRODUCTS = ['agent_studio', 'voice_ai', 'conversation_ai', 'superagents', 'ask_ai', 'agent_logs_assistant'];
export const MAX_OFFSET = 500;

export const parseMeta = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

// llm_node `output` is either the spoken text or a JSON array of tool calls.
export const parseOutput = (raw) => {
  if (raw == null) return { text: null, toolCalls: [] };
  if (Array.isArray(raw)) return { text: null, toolCalls: raw.map(normaliseTool).filter(Boolean) };
  if (typeof raw === 'object') return { text: null, toolCalls: [normaliseTool(raw)].filter(Boolean) };
  const s = String(raw);
  const t = s.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : [j];
      const calls = arr.map(normaliseTool).filter(Boolean);
      if (calls.length) return { text: null, toolCalls: calls };
    } catch { /* plain text that merely starts with a bracket */ }
  }
  return { text: s, toolCalls: [] };
};

const normaliseTool = (o) => {
  if (!o || typeof o !== 'object') return null;
  const name = o.tool_name ?? o.toolName ?? o.name ?? null;
  if (!name) return null;
  return { name, args: o.args ?? o.arguments ?? null };
};

// knowledge_base output: [{category, content:"[Source: <title>] …"}]
const SOURCE_RE = /^\s*\[Source:\s*([^\]]+)\]\s*/;
export const knowledgeSources = (out) => {
  const rows = Array.isArray(out) ? out : (typeof out === 'string' ? (() => { try { const j = JSON.parse(out); return Array.isArray(j) ? j : []; } catch { return []; } })() : []);
  return rows.map((r) => {
    const content = typeof r?.content === 'string' ? r.content : '';
    const m = content.match(SOURCE_RE);
    return { title: m ? m[1].trim() : null, category: r?.category ?? null, chars: content.length };
  });
};

// Walk any workflow body and collect every {id,name} that looks like a branch, so an
// aiSplitterDecision.branchId can be named. Shape-agnostic on purpose: the splitter's branch
// array has moved between builder versions, and a wrong guess here would silently mislabel.
export const branchNameMap = (workflowBody) => {
  const map = new Map();
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const id = node.branchId ?? node.id ?? node._id;
    const name = node.name ?? node.label ?? node.title;
    if (typeof id === 'string' && typeof name === 'string' && name.trim()) {
      if (!map.has(id)) map.set(id, name.trim());
    }
    for (const v of Object.values(node)) visit(v);
  };
  visit(workflowBody);
  return map;
};

export const digestSpans = (spans, { includePrompt = false, branchNames = null } = {}) => {
  const rows = Array.isArray(spans) ? spans.slice() : [];
  // parentSpanId gives a tree; the timeline the UI shows is timestamp order, which is what
  // reads as a decision path. Keep both: order by timestamp, expose the parent link.
  rows.sort((a, b) => String(a?.timestamp ?? '').localeCompare(String(b?.timestamp ?? '')));

  const steps = [];
  const spoken = [];
  const totals = { latencyMs: 0, tokensInput: 0, tokensOutput: 0, tokensCacheRead: 0, tokensCacheWrite: 0 };
  let inbound = null;

  for (const [i, s] of rows.entries()) {
    const meta = parseMeta(s?.metadata);
    const { text, toolCalls } = parseOutput(s?.output);
    const step = {
      n: i + 1,
      stepType: s?.stepType ?? null,
      name: s?.name ?? null,
      product: s?.productName ?? null,
      model: s?.model ?? null,
      latencyMs: s?.latencyMs ?? null,
      statusCode: s?.statusCode ?? null,
      spanId: s?.spanId ?? null,
      parentSpanId: s?.parentSpanId ?? null,
    };
    const tk = {
      input: s?.tokensInput ?? 0, output: s?.tokensOutput ?? 0,
      cacheRead: s?.tokensCacheRead ?? 0, cacheWrite: s?.tokensCacheWrite ?? 0,
    };
    if (tk.input || tk.output || tk.cacheRead || tk.cacheWrite) step.tokens = tk;
    totals.latencyMs += Number(s?.latencyMs ?? 0);
    totals.tokensInput += Number(tk.input ?? 0);
    totals.tokensOutput += Number(tk.output ?? 0);
    totals.tokensCacheRead += Number(tk.cacheRead ?? 0);
    totals.tokensCacheWrite += Number(tk.cacheWrite ?? 0);

    if (meta?.nodeType) step.nodeType = meta.nodeType;

    if (s?.stepType === 'human') {
      inbound = { messageId: meta?.messageId ?? null, conversationId: meta?.conversationId ?? null, employeeMode: meta?.employeeMode ?? null };
      step.input = typeof s?.input === 'string' ? s.input : (s?.input ?? null);
    }

    const dec = meta?.aiSplitterDecision;
    if (dec) {
      const id = dec.branchId ?? null;
      step.branch = {
        id,
        name: id && branchNames ? (branchNames.get(id) ?? null) : null,
        reasoning: dec.reasoning ?? null,
      };
    }

    if (s?.stepType === 'contact_info_update') {
      const o = typeof s?.output === 'string' ? (() => { try { return JSON.parse(s.output); } catch { return null; } })() : s?.output;
      if (o && typeof o === 'object') step.extracted = o;
    } else if (s?.stepType === 'knowledge_base') {
      step.knowledge = knowledgeSources(s?.output);
      if (meta?.kbDurationMeasured != null) step.kbDurationMs = meta.kbDurationMeasured;
    } else if (toolCalls.length) {
      step.toolCalls = toolCalls;
    } else if (text) {
      step.spoken = text;
      if (s?.stepType !== 'human') spoken.push({ n: i + 1, stepType: s.stepType, nodeType: meta?.nodeType ?? null, text });
    }

    if (includePrompt && meta?.prompt) step.prompt = meta.prompt;
    steps.push(step);
  }

  totals.tokensTotal = totals.tokensInput + totals.tokensOutput;

  // The last speaking node is the one the contact actually received; earlier `objective`
  // nodes generate replies that are then discarded (live-proven, two unsent outputs in one turn).
  const delivered = spoken.length ? spoken[spoken.length - 1] : null;
  const notes = [];
  if (spoken.length > 1) {
    notes.push(`${spoken.length} nodes produced text; only the last one (${delivered.stepType}${delivered.nodeType ? '/' + delivered.nodeType : ''}) reached the contact — the earlier ones were generated and discarded.`);
  }
  if (steps.some((s) => (s.toolCalls ?? []).some((t) => t.name === 'conversation_ended'))) {
    notes.push('The model called the tool `conversation_ended`. The platform then writes its own closing line instead of acting on what the message asked for — check whether the message deserved a real answer.');
  }
  if (branchNames === null && steps.some((s) => s.branch)) {
    notes.push('Splitter branch ids are not resolved to names. Pass workflowId (the flow-builder workflow whose trigger carries convTriggerBotId = this agent) to have them named.');
  }

  return { inbound, totals, steps, spoken, delivered, notes };
};

export const SESSION_FILTER_KEYS = [
  'products', 'agentId', 'agentName', 'contactId', 'contactName', 'conversationId',
  'channel', 'voiceName', 'traceId', 'search', 'contentSearch', 'metadataText', 'skillId',
  'timeRange', 'dateFrom', 'dateTo',
];

export const sessionRow = (r) => ({
  agentSessionId: r.conversationId ?? null, contactId: r.contactId ?? null, contactName: r.contactName ?? null,
  product: r.aiProduct ?? null, channel: r.channel ?? null, agentId: r.agentId ?? null, agentName: r.agentName ?? null,
  status: r.status ?? null, totalTokens: r.totalTokens ?? null, latencyMs: r.latencyMs ?? null,
  durationMs: r.durationMs ?? null, timestamp: r.timestamp ?? null,
});

// The request body the Sessions table sends, minus paging. Only `exists` behaves differently
// server-side; every other op — `not_exists` included — is treated as equality, so the two we
// accept are the only two that mean anything.
export const sessionBody = (args) => {
  const body = {
    locationId: args.locationId, limit: args.limit ?? 50,
    sortBy: args.sortBy ?? 'timestamp', sortOrder: args.sortOrder ?? 'desc',
  };
  for (const k of SESSION_FILTER_KEYS) if (args[k] !== undefined && args[k] !== '') body[k] = args[k];
  if (args.metadataFilters?.length) {
    body.metadataFilters = args.metadataFilters.map((f) => (f.op === 'exists'
      ? { key: f.key, op: 'exists' }
      : { key: f.key, value: f.value ?? '', op: 'equals' }));
  }
  return body;
};

// Walk the pageToken cursor. De-duplicates because sortOrder:'asc' repeats the boundary row on
// every hop, and re-sends the whole body because the cursor carries no filters of its own.
export const walkSessions = async (gw, body, { maxRows = 1000, maxHops = 200 } = {}) => {
  const rows = []; const seen = new Set();
  let token = null; let hops = 0; let meta = null; let dupes = 0; let error = null;
  while (rows.length < maxRows && hops < maxHops) {
    const r = await gw.call('POST', '/agent-logs/logs', { ...body, ...(token ? { pageToken: token } : {}) });
    if (!r.ok) { error = r; break; }
    meta = r.json?.meta ?? null;
    const data = Array.isArray(r.json?.data) ? r.json.data : [];
    for (const row of data) {
      const id = row?.conversationId;
      if (id && seen.has(id)) { dupes++; continue; }
      if (id) seen.add(id);
      rows.push(sessionRow(row));
      if (rows.length >= maxRows) break;
    }
    hops++;
    token = meta?.nextPageToken ?? null;
    if (!data.length || !token) break;
  }
  return { rows, meta, hops, dupes, error };
};
