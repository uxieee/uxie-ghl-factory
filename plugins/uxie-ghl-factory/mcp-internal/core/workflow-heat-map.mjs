// w6c-9 (plan Task 9, bl-789): the heat-map roll-up, pure. The read is GET /workflows/logs/enrollment-counts, which returns one count per
// workflow for the whole window (no per-day rows, so no time-zone bucketing here). GHL keeps 60 days of log rows, so a longer window is
// refused, not counted partially. A requested workflow the response does not name is `absent`, never 0.
export const HEAT_MAP_MAX_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// -> { ok: true } | { ok: false, code: 'RETENTION' | 'WINDOW_INVERTED', detail }
export function checkHeatMapWindow(fromDate, toDate) {
  if (!(Number.isFinite(fromDate) && Number.isFinite(toDate))) return { ok: false, code: 'WINDOW_INVERTED', detail: 'fromDate and toDate must be epoch milliseconds' };
  if (toDate < fromDate) return { ok: false, code: 'WINDOW_INVERTED', detail: 'toDate is before fromDate' };
  if (toDate - fromDate > HEAT_MAP_MAX_DAYS * DAY_MS) {
    return { ok: false, code: 'RETENTION', detail: `the window is over ${HEAT_MAP_MAX_DAYS} days; GHL keeps ${HEAT_MAP_MAX_DAYS} days of log rows, so a longer window is refused, not counted partially` };
  }
  return { ok: true };
}

// rows: [{ workflowId, count }] from GET /workflows/logs/enrollment-counts. A count that is not a number is unknown (undefined), not 0.
export function rollupEnrollmentCounts(rows, { workflowIds = null, fromDate, toDate } = {}) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.workflowId === undefined) continue;
    const n = typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : undefined;
    byId.set(String(row.workflowId), n);
  }
  const workflows = [];
  const absent = [];
  if (Array.isArray(workflowIds)) {
    for (const id of workflowIds) {
      if (!byId.has(String(id))) absent.push(id);
      else workflows.push({ workflowId: id, count: byId.get(String(id)) });
    }
  } else {
    for (const [id, count] of byId) workflows.push({ workflowId: id, count });
  }
  const total = workflows.reduce((s, w) => s + (typeof w.count === 'number' ? w.count : 0), 0);
  return { workflows, total, window: { fromDate, toDate }, absent };
}

// The plan interface (w6c-9): throws a coded error when the window is over 60 days (RETENTION) or inverted (WINDOW_INVERTED). Read before any request.
export function windowGuard(fromDate, toDate) {
  const r = checkHeatMapWindow(fromDate, toDate);
  if (!r.ok) {
    const e = new Error(r.detail);
    e.code = r.code;
    throw e;
  }
  return true;
}
