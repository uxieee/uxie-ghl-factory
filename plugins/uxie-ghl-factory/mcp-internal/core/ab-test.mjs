// w6c-6 (plan Task 6, bl-788): the A/B Test tools, pure. No network here: the handlers in workflow-w6c-tools.mjs call the gateway and
// hand the responses to these functions.
//
// Shapes that are INFERRED, not read back, are marked so. The live run (gate G1) settles them:
//   - the `pathIds` query serialisation (three forms are pinned by the test; the live run picks one; AB:88 names the bracket form);
//   - the stats response (`paths[]` rows with pathId, entered, converted; a top-level winnerPathId).
// The isExecuted response is the builder's own shape: { isStepExecuted: boolean } (the w6c-0 FINDINGS).

export const PATH_IDS_FORMS = ['csv', 'repeated', 'bracket'];

// The `pathIds` query for GET /workflow/{loc}/split/stats. 'csv' is the default until gate G1 proves which form GHL reads.
export function pathIdsQuery(pathIds, form = 'csv') {
  if (!PATH_IDS_FORMS.includes(form)) throw new Error(`pathIdsQuery: unknown form '${form}' (use ${PATH_IDS_FORMS.join(', ')})`);
  const enc = (v) => encodeURIComponent(v);
  if (form === 'csv') return `pathIds=${pathIds.map(enc).join(',')}`;
  if (form === 'repeated') return pathIds.map((p) => `pathIds=${enc(p)}`).join('&');
  return pathIds.map((p) => `pathIds[]=${enc(p)}`).join('&');
}

// A count the response did not give is undefined: unknown, never 0. A count that is present but not a number is also unknown.
const count = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : undefined;
};

// Normalise the stats response to a Map of pathId -> { entered, converted }. Accepts { paths: [...] }, a bare array of rows, or an
// object keyed by path id. Rows name the path as pathId, id or pathid, and the counts as entered/converted.
function rowsOf(stats) {
  const rows = new Map();
  const add = (row, keyFallback) => {
    const id = row?.pathId ?? row?.id ?? row?.pathid ?? keyFallback;
    if (id === undefined) return;
    rows.set(String(id), {
      entered: count(row?.entered ?? row?.contactsEntered),
      converted: count(row?.converted ?? row?.conversions),
    });
  };
  if (Array.isArray(stats)) stats.forEach((r) => add(r));
  else if (Array.isArray(stats?.paths)) stats.paths.forEach((r) => add(r));
  else if (stats && typeof stats === 'object') for (const [k, v] of Object.entries(stats)) if (v && typeof v === 'object') add(v, k);
  return rows;
}

// The plan's interface, as ruled (DECISIONS, w6c-6): rollupAbStats(statsResponse, definitionPaths[, isExecutedResponse]) returns
// { status, winnerPathId | null, paths: [{ pathId, name, entered?, converted?, rate? }], absent: [pathId] }.
// definitionPaths is the step's own attributes.paths ([{ id, name }]). A path the stats did not report is `absent`, never 0: a 0 would
// read as "it ran and converted nothing". A count the stats did not give stays undefined (unknown), so its rate is unknown too. rate is
// converted / entered; null when the path entered no contacts (0/0 is not a rate). status is the stats response's own status when it has
// one, else from isExecuted; with no isExecuted response it is 'not-executed' (fail closed).
// w6c-6b (live G1, 2026-11-07): GHL's real stats body (repeated pathIds) carries the counts in three places: abTest.perPath[id]
// {entered, converted}, a top-level numeric key per path id, and rows in the older shapes rowsOf reads. abTest.status is the status and
// abTest.winnerPathId the winner. All three counts are read; a path with none of them is absent.
export function rollupAbStats(stats, definitionPaths = [], isExecutedResponse) {
  const rows = rowsOf(stats);
  const perPath = stats?.abTest?.perPath ?? stats?.perPath ?? {};
  const paths = [];
  const absent = [];
  for (const def of definitionPaths) {
    const id = String(def.id);
    const row = rows.get(id);
    const pp = perPath && typeof perPath === 'object' ? perPath[id] : undefined;
    const top = stats && typeof stats === 'object' ? stats[id] : undefined;
    const entered = row?.entered ?? count(pp?.entered) ?? (typeof top === 'number' ? count(top) : undefined);
    const converted = row?.converted ?? count(pp?.converted);
    if (entered === undefined && converted === undefined) { absent.push(def.id); continue; }
    let rate;
    if (entered === 0) rate = null;
    else if (entered !== undefined && converted !== undefined) rate = converted / entered;
    paths.push({ pathId: def.id, name: def.name ?? null, entered, converted, rate });
  }
  const statusOf = typeof stats?.status === 'string' ? stats.status
    : (typeof stats?.abTest?.status === 'string' ? stats.abTest.status : (executedOf(isExecutedResponse) ? 'executed' : 'not-executed'));
  const winnerPathId = stats?.winnerPathId ?? stats?.abTest?.winnerPathId ?? null;
  return { status: statusOf, winnerPathId, paths, absent };
}

// GET /split/isExecuted: the builder's own shape is { isStepExecuted: boolean }. Anything else is not executed (fail closed).
export function executedOf(response) {
  return response?.isStepExecuted === true;
}

// Declaring a winner routes every NEW contact to the leading path. The preview is what the no-confirm call returns, with no request.
export const DECLARE_PREVIEW = 'Declaring a winner routes every new contact to the leading path; this cannot be undone in the UI. '
  + 'Call again with confirm: true to declare it.';

// The declare-winner call as data (the plan's interface, as ruled): the handler sends it, and the tests check it with no gateway.
export function declareWinnerRequest(locationId, workflowId, stepId) {
  return {
    method: 'POST',
    path: `/workflow/${encodeURIComponent(locationId)}/split/ab-test/declare-winner`,
    query: `workflowId=${encodeURIComponent(workflowId)}&stepId=${encodeURIComponent(stepId)}`,
    body: {},
  };
}
