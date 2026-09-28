// Forecast reads for get_pipeline_forecast — pure: request bodies and response shaping only.
//
// Four report endpoints on services (knowledge corpus pipelines-opportunities/20-api/forecast.md,
// measured 2026-09-07 and 2026-09-25): POST /opportunities/forecast/{summary,column,drilldown,
// slippage}. All four answer 201 with computed rows and no id; locationId goes in the BODY.
// The service labels stage and owner rows with their UUIDs (label === key), so names are joined
// here from the pipeline and user lists.

export const FORECAST_VIEWS = ['summary', 'timeline', 'drilldown', 'slippage'];
export const GROUP_BY = ['stage', 'owner', 'status', 'close_date'];
export const PATHS = {
  summary: '/opportunities/forecast/summary',
  timeline: '/opportunities/forecast/column',
  drilldown: '/opportunities/forecast/drilldown',
  slippage: '/opportunities/forecast/slippage',
};

/** The request body for a view, or { error }. */
export function forecastBody(view, a) {
  const filters = [...(a.filters ?? [])];
  if (a.pipelineId) filters.push({ field: 'pipeline_id', operator: 'eq', value: [a.pipelineId] });
  const withFilters = (b) => (filters.length ? { ...b, filters } : b);
  switch (view) {
    case 'summary': {
      const b = { locationId: a.locationId, groupBy: a.groupBy ?? 'status' };
      if (b.groupBy === 'close_date') {
        if (a.closeDateBucket) b.closeDateBucket = a.closeDateBucket;
        if (a.closeDateMode) b.closeDateMode = a.closeDateMode;
      } else if (a.closeDateBucket || a.closeDateMode) {
        return { error: 'closeDateBucket and closeDateMode apply only with groupBy:"close_date"' };
      }
      return { body: withFilters(b) };
    }
    case 'timeline': {
      const b = { locationId: a.locationId };
      for (const k of ['periodType', 'startDate', 'endDate', 'showBy']) if (a[k] !== undefined) b[k] = a[k];
      return { body: withFilters(b) };
    }
    case 'drilldown':
      if (!a.periodStart || !a.metric) return { error: 'drilldown needs periodStart (YYYY-MM-DD) and metric ("weighted" or "unweighted")' };
      if (filters.length) return { error: 'drilldown has only been measured with locationId, periodStart and metric; filters and pipelineId are not sent rather than guessed. Use view:"timeline" for a filtered period' };
      return { body: { locationId: a.locationId, periodStart: a.periodStart, metric: a.metric } };
    case 'slippage': {
      const b = { locationId: a.locationId };
      for (const k of ['risk', 'riskThresholds', 'page', 'limit']) if (a[k] !== undefined) b[k] = a[k];
      return { body: withFilters(b) };
    }
    default:
      return { error: `view must be one of ${FORECAST_VIEWS.join(', ')}` };
  }
}

/** Lookup maps from the pipeline list and the user list. */
export function nameMaps(pipelines = [], users = []) {
  const stages = new Map(), pipes = new Map(), people = new Map();
  for (const p of pipelines) {
    pipes.set(p.id, p.name);
    for (const s of p.stages ?? []) stages.set(s.id, s.name);
  }
  for (const u of users) people.set(u.id, u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id);
  return { stages, pipes, people };
}

const card = (o, m) => ({
  id: o.id, name: o.name, status: o.status,
  value: o.monetaryValue ?? o.amount ?? null,
  pipeline: m.pipes.get(o.pipelineId) ?? o.pipelineId ?? null,
  stage: m.stages.get(o.pipelineStageId) ?? o.pipelineStageId ?? null,
  owner: m.people.get(o.ownerId ?? o.assignedTo) ?? (o.ownerId ?? o.assignedTo ?? null),
  closeDate: o.forecastExpectedCloseDate ?? null,
  probability: o.effectiveProbability ?? o.forecastProbability ?? null,
  ...(o.contribution !== undefined ? { contribution: o.contribution } : {}),
  ...(o.slippageCount !== undefined || o.forecastSlippageCount !== undefined ? { slipped: { times: o.slippageCount ?? o.forecastSlippageCount, days: o.daysSlipped ?? o.forecastDaysSlipped } } : {}),
  ...(o.risk !== undefined ? { risk: o.risk } : {}),
});

/** Concise response with names beside ids. `raw` keeps the service's answer untouched. */
export function shapeForecast(view, json, m) {
  const j = json ?? {};
  if (view === 'summary') {
    const g = j.grouping ?? {};
    const rename = (row) => {
      if (g.groupBy === 'stage') return m.stages.get(row.key) ?? row.label;
      if (g.groupBy === 'owner') return m.people.get(row.key) ?? row.label;
      return row.label;
    };
    return { summary: j.summary, readiness: j.readiness, groupBy: g.groupBy, closeDateBucket: g.closeDateBucket, closeDateMode: g.closeDateMode,
      rows: (g.rows ?? []).map((r) => ({ ...r, label: rename(r) })), total: g.total };
  }
  if (view === 'timeline') return { periodStart: j.periodStart, periodEnd: j.periodEnd, metrics: j.metrics, total: j.total, opportunities: (j.opportunities ?? []).map((o) => card(o, m)) };
  if (view === 'drilldown') return { total: j.total, opportunities: (j.opportunities ?? []).map((o) => card(o, m)) };
  return { summary: j.summary, pagination: j.pagination, opportunities: (j.opportunities ?? []).map((o) => card(o, m)) };
}
