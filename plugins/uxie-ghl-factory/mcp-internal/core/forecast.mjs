// Forecast reads for get_pipeline_forecast — pure: request bodies and response shaping only.
//
// Report endpoints on services (knowledge corpus pipelines-opportunities/20-api/forecast.md,
// measured 2026-09-07, 2026-09-25 and 2026-09-29): POST /opportunities/forecast/{summary,column,
// slippage}. They answer 201 with computed rows and no id; locationId goes in the BODY.
// The service labels stage and owner rows with their UUIDs (label === key), so names are joined
// here from the pipeline and user lists.
//
// The drilldown view is the Forecast tab's own: a KPI tile, summary row or close-date bucket
// opens a paged list read from POST /opportunities/search, or from forecast/column for a month or
// quarter bucket (opportunitiesApp 2614, chunk 2593). POST /forecast/drilldown exists but the app
// never calls it, so its numbers need not match what the user clicks; it is not used.

export const FORECAST_VIEWS = ['summary', 'timeline', 'drilldown', 'slippage'];
export const GROUP_BY = ['stage', 'owner', 'status', 'close_date'];
export const DRILLDOWN_BY = ['kpi', 'stage', 'owner', 'status', 'close_date'];
export const KPI_KEYS = ['activeOpportunities', 'bestCase', 'weightedForecast', 'closedWon'];
export const CLOSE_DATE_BUCKETS = ['month', 'quarter', 'year'];
export const PATHS = {
  summary: '/opportunities/forecast/summary',
  timeline: '/opportunities/forecast/column',
  drilldown: '/opportunities/search',
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
        if (a.closeDateBucket === 'year') return { error: 'closeDateBucket "year" is a drilldown bucket; summary has been measured with month and quarter only' };
      } else if (a.closeDateBucket || a.closeDateMode) {
        return { error: 'closeDateBucket and closeDateMode apply only with groupBy:"close_date"' };
      }
      return { body: withFilters(b) };
    }
    case 'timeline': {
      const b = { locationId: a.locationId };
      for (const k of ['periodType', 'startDate', 'endDate', 'showBy', 'page', 'limit']) if (a[k] !== undefined) b[k] = a[k];
      return { body: withFilters(b) };
    }
    case 'drilldown':
      return drilldownRequest(a);
    case 'slippage': {
      const b = { locationId: a.locationId };
      for (const k of ['risk', 'riskThresholds', 'page', 'limit']) if (a[k] !== undefined) b[k] = a[k];
      return { body: withFilters(b) };
    }
    default:
      return { error: `view must be one of ${FORECAST_VIEWS.join(', ')}` };
  }
}

const ymd = (d) => d.toISOString().slice(0, 10);
/** Last day of the month, quarter or year that starts the bucket at `start` (YYYY-MM-DD), as the app's endOf(). */
export function bucketEnd(start, bucket) {
  const d = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const lastMonth = bucket === 'year' ? 11 : bucket === 'quarter' ? m - (m % 3) + 2 : m;
  return ymd(new Date(Date.UTC(y, lastMonth + 1, 0)));
}

/**
 * The Forecast tab's drilldown request (opportunitiesApp 2614, chunk 2593 @84300-86400): base filters are the
 * caller's filters plus the pipeline, and lost + abandoned are excluded unless the drilldown IS a lost or abandoned
 * status row. Then one filter per kind. Paged with page / limit (the app shows 10 rows a page).
 * Returns { path, body } or { error }.
 */
export function drilldownRequest(a) {
  let by = a.drilldownBy, key = a.key, bucket = a.closeDateBucket ?? 'month';
  // Earlier contract: periodStart (+ metric) was the forecast/drilldown call; it maps to the close-date bucket.
  if (!by && a.periodStart) { by = 'close_date'; key = a.periodStart; }
  if (!by || key === undefined || key === '') return { error: `drilldown needs drilldownBy (${DRILLDOWN_BY.join(', ')}) and key: a KPI tile (${KPI_KEYS.join(', ')}), a stage id, an owner user id ("__none__" for unassigned), a status, or a close-date bucket start YYYY-MM-DD` };
  if (!DRILLDOWN_BY.includes(by)) return { error: `drilldownBy must be one of ${DRILLDOWN_BY.join(', ')}` };
  const page = a.page ?? 1, limit = a.limit ?? 10;
  const filters = (a.filters ?? []).filter((f) => f?.field !== 'pipeline_id');
  if (a.pipelineId) filters.push({ field: 'pipeline_id', operator: 'eq', value: a.pipelineId });
  const k = String(key).trim().toLowerCase();
  if (!(by === 'status' && (k === 'lost' || k === 'abandoned'))) {
    filters.push({ field: 'status', operator: 'not_eq', value: 'lost' }, { field: 'status', operator: 'not_eq', value: 'abandoned' });
  }
  const search = (f, extra = {}) => ({ path: '/opportunities/search', body: { locationId: a.locationId, filters: f, page, limit, ...extra } });
  switch (by) {
    case 'kpi':
      if (!KPI_KEYS.includes(key)) return { error: `a kpi drilldown key is one of ${KPI_KEYS.join(', ')}` };
      if (key === 'closedWon') filters.push({ field: 'status', operator: 'eq', value: 'won' });
      else filters.push({ field: 'status', operator: 'eq', value: 'open' });
      return search(filters);
    case 'stage':
      return search([...filters, { field: 'pipeline_stage_id', operator: 'eq', value: key }]);
    case 'owner': {
      const owner = key === '__unassigned__' ? '__none__' : key;
      return search([...filters, owner === '__none__' ? { field: 'assigned_to', operator: 'eq', value: ['__none__'] } : { field: 'assigned_to', operator: 'eq', value: owner }]);
    }
    case 'status':
      return search([...filters, { field: 'status', operator: 'eq', value: key }]);
    case 'close_date': {
      if (!CLOSE_DATE_BUCKETS.includes(bucket)) return { error: `closeDateBucket must be one of ${CLOSE_DATE_BUCKETS.join(', ')}` };
      const end = bucketEnd(key, bucket);
      if (!end) return { error: 'a close_date drilldown key is the bucket start as YYYY-MM-DD' };
      if (bucket === 'year') {
        // The app sends the day bounds in the browser's timezone; this sends them in UTC.
        const range = { gte: Date.parse(`${key}T00:00:00.000Z`), lte: Date.parse(`${end}T23:59:59.999Z`) };
        return search([...filters, { field: 'forecast_expected_close_date', operator: 'range', value: range }], { query: '', sort: [] });
      }
      return { path: '/opportunities/forecast/column', body: { locationId: a.locationId, startDate: key, endDate: end, periodType: bucket, filters, query: '', sort: [], page, limit } };
    }
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

// Row keys differ per report: timeline, search and drilldown rows carry pipelineStageId and
// forecastExpectedCloseDate; slippage rows carry stage, probability, origCloseDate and newCloseDate.
const card = (o, m) => {
  const stageId = o.pipelineStageId ?? o.stage;
  const ownerId = o.ownerId ?? o.assignedTo ?? o.owner;
  const out = {
    id: o.id, name: o.name, status: o.status,
    value: o.monetaryValue ?? o.amount ?? null,
    pipeline: m.pipes.get(o.pipelineId) ?? o.pipelineId ?? null,
    stage: m.stages.get(stageId) ?? stageId ?? null,
    owner: m.people.get(ownerId) ?? ownerId ?? null,
    closeDate: o.forecastExpectedCloseDate ?? o.newCloseDate ?? null,
    probability: o.effectiveProbability ?? o.forecastProbability ?? o.probability ?? null,
  };
  if (o.contribution !== undefined) out.contribution = o.contribution;
  const times = o.slippageCount ?? o.forecastSlippageCount;
  if (times !== undefined) out.slipped = { times, days: o.daysSlipped ?? o.forecastDaysSlipped, from: o.origCloseDate ?? o.forecastOriginalCloseDate, lastAt: o.lastSlippedAt ?? o.forecastLastSlippedAt };
  if (o.risk !== undefined) out.risk = o.risk;
  return out;
};

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
  if (view === 'drilldown') {
    const rows = j.opportunities ?? j.data ?? [];
    return { total: j.total ?? j.pagination?.total ?? 0, opportunities: rows.map((o) => card(o, m)) };
  }
  return { summary: j.summary, pagination: j.pagination, opportunities: (j.opportunities ?? []).map((o) => card(o, m)) };
}
