// get_funnel analytics: advanced filters, filter values, video engagement, and the Sales tab's order list.
// Wire formats captured from the Sites → Analytics screen (knowledge sniffs/funnels-wave40-f5d-analytics-2026-09-30):
//   advancedFilters = JSON {group:"OR"|"AND", filters:[{group:"AND"|"OR", filters:[{field, operator:"in"|"not_in", value:[…]}]}]}
//   (the screen's default: top group OR, each nested group AND); ≤ 5 groups, ≤ 5 conditions per group, value non-empty;
//   GET /stats/filter-values {field, limit ≤ 20, offset, search}; GET /stats/video/stats {includeGraphData}; GET /funnels/order.

/** The filter fields the screen offers for funnels, websites and webinars (analytics bundle, the filter store's field list). */
export const FILTER_FIELDS = Object.freeze(['city', 'region', 'country', 'pageId', 'browser', 'deviceType', 'trafficSource', 'trafficChannel']);
export const FILTER_OPERATORS = Object.freeze(['in', 'not_in']);
export const MAX_FILTER_GROUPS = 5;
export const MAX_FILTER_CONDITIONS = 5;
/** Only these two filters reach the VIDEO read; the screen renames deviceType to `device` there (any other field answers 400 with a raw database error). */
export const VIDEO_FILTER_FIELDS = Object.freeze({ pageId: 'pageId', deviceType: 'device' });

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate and normalise a filter spec into the wire object. Defaults are the screen's: top group OR, nested groups AND, operator "in".
 * Returns {filters} (the object to JSON.stringify) or {refuse}.
 */
export function planAdvancedFilters(spec) {
  if (spec === undefined || spec === null) return { filters: null };
  if (!isObj(spec) || !Array.isArray(spec.filters)) return { refuse: 'filters is {group?: "OR"|"AND", filters: [{group?: "AND"|"OR", filters: [{field, operator?: "in"|"not_in", value: [..]}]}]}' };
  const top = spec.group ?? 'OR';
  if (!['OR', 'AND'].includes(top)) return { refuse: 'filters.group is "OR" or "AND"' };
  if (spec.filters.length === 0) return { filters: null };
  if (spec.filters.length > MAX_FILTER_GROUPS) return { refuse: `at most ${MAX_FILTER_GROUPS} filter groups (GHL answers 422 above that)` };
  const groups = [];
  for (const [gi, g] of spec.filters.entries()) {
    if (!isObj(g) || !Array.isArray(g.filters) || g.filters.length === 0) return { refuse: `filters.filters[${gi}] needs a non-empty filters list` };
    const group = g.group ?? 'AND';
    if (!['OR', 'AND'].includes(group)) return { refuse: `filters.filters[${gi}].group is "OR" or "AND"` };
    if (g.filters.length > MAX_FILTER_CONDITIONS) return { refuse: `at most ${MAX_FILTER_CONDITIONS} conditions per group (filters.filters[${gi}] has ${g.filters.length})` };
    const conds = [];
    for (const [ci, c] of g.filters.entries()) {
      const at = `filters.filters[${gi}].filters[${ci}]`;
      if (!isObj(c) || !FILTER_FIELDS.includes(c.field)) return { refuse: `${at}.field is one of ${FILTER_FIELDS.join(', ')}` };
      const operator = c.operator ?? 'in';
      if (!FILTER_OPERATORS.includes(operator)) return { refuse: `${at}.operator is "in" (is) or "not_in" (is not)` };
      if (!Array.isArray(c.value) || c.value.length === 0 || c.value.some((v) => typeof v !== 'string' || !v)) return { refuse: `${at}.value is a non-empty list of strings (GHL answers 422 for an empty list) — filter_values lists the values that exist` };
      conds.push({ field: c.field, operator, value: c.value });
    }
    groups.push({ group, filters: conds });
  }
  return { filters: { group: top, filters: groups } };
}

/**
 * What the screen sends to the VIDEO read: only pageId and deviceType (renamed `device`) survive, empty groups go. Returns {filters|null, dropped: [fields]}.
 * A city filter sent to the video route answers 400 with a database identifier error, so it is dropped here as the screen drops it.
 */
export function videoFilters(filters) {
  if (!filters) return { filters: null, dropped: [] };
  const dropped = new Set();
  const groups = filters.filters.map((g) => ({
    ...g, filters: g.filters.filter((c) => { if (VIDEO_FILTER_FIELDS[c.field]) return true; dropped.add(c.field); return false; })
      .map((c) => ({ ...c, field: VIDEO_FILTER_FIELDS[c.field] })),
  })).filter((g) => g.filters.length > 0);
  return { filters: groups.length ? { group: filters.group, filters: groups } : null, dropped: [...dropped] };
}

export const filterQuery = (filters) => (filters ? `&advancedFilters=${encodeURIComponent(JSON.stringify(filters))}` : '');

/** GET /stats/video/stats?includeGraphData=true → the Video engagement cards + graph. averageTime and completion are PERCENT of the video (the screen prints "67%"). */
export function videoView(data) {
  const d = data ?? {};
  const xs = d.graphData?.xAxis ?? [], ys = d.graphData?.yAxis ?? [];
  return {
    plays: d.videoPlay ?? 0, pauses: d.videoPauses ?? 0, completionPct: d.completion ?? null, averageWatchedPct: d.averageTime ?? null, dropOffSpikePct: d.dropOffSpike ?? null,
    progress: xs.map((x, i) => ({ atPct: x, users: ys[i] ?? 0 })),
  };
}

/** Sales tab rows (GET /funnels/order). The screen joins the contact's name and email from a contact search; this view keeps contactId and adds step and product names. */
export function ordersView(rows, { steps = [], products = {} } = {}) {
  const stepName = new Map(steps.map((s) => [s.id, s.name]));
  return (rows ?? []).map((o) => ({
    orderId: o._id ?? o.id ?? null, contactId: o.contactId ?? null, stepId: o.stepId ?? null, stepName: stepName.get(o.stepId) ?? null,
    productId: o.productId ?? null, productName: products[o.productId]?.productName ?? null, amount: o.amount ?? null, currency: o.currency ?? null,
    chargeId: o.chargeId ?? null, dateAdded: o.dateAdded ?? null,
  }));
}

export const SALES_NOTE = 'The Sales tab is VERSION 1 order forms only (its own banner: "All orders/sales on version 2 of the funnel are available in Payments → Orders and Transactions"). A funnel on version 2 order forms — every new one — lists nothing here even when it has sales; read those in Payments (orders / transactions). Customer names and emails are not joined: contactId is returned.';
