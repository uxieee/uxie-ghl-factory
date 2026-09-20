// Call shapes raw_request REFUSES, and the lookup that puts a route's trap note in its preview.
//
// A refusal here is for a shape with NO legitimate version: each one below answers 200 and does
// silent damage, or answers 200 and does nothing. Anything merely dangerous stays behind the
// confirm gate instead — a guard that second-guesses a deliberate call would just teach callers
// to route around this tool. Every rule was measured live on the designated sandbox (bulk
// change-status 2026-09-08, the rest 2026-09-19); the measurements are on the catalogue rows
// (describe_endpoint prints them).
//
// Pure on purpose: no gateway, no catalogue read. tools.mjs passes what it already holds.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pathOnly = (path) => String(path).split('?')[0].replace(/\/+$/, '');

// EVERY predicate below asks about THIS value, never about the object the caller happens to hold.
// The gateway serializes with JSON.stringify, which DROPS a key whose value is undefined — so
// `{contactId: undefined}` is a one-key object in the caller's hand and `{}` on the wire, which is
// the exact phantom-enrolment body rule 2 exists to stop. Reading the JS value instead of the wire
// value gave three shapes a way through a rail that was measured to be closed.
const onWire = (body) => {
  if (body === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(body)); } catch { return body; }
};
// Empty AS SENT: `{}`, and `[]`, which serializes to a body carrying no contact just the same.
// `typeof x === 'object'` rather than isPlainObject precisely so the array is not waved through.
const isEmptyOnWire = (wire) => wire !== null && typeof wire === 'object' && Object.keys(wire).length === 0;

const RULES = [
  {
    rule: 'remove-stuck-statuses-needs-statusIds',
    method: 'POST',
    path: /^\/workflow\/[^/]+\/[^/]+\/remove-stuck-statuses\/[^/]+$/,
    refuses: (wire) => !(isPlainObject(wire) && Array.isArray(wire.statusIds) && wire.statusIds.length > 0),
    message: 'remove-stuck-statuses WITHOUT a non-empty `statusIds` array evicts EVERYONE at the step, stuck or not — a contact on day one of a seven-day wait was removed this way.',
    hint: 'Pass body.statusIds:[…] naming the executions to remove (the `id` of each enrolment row from get_contacts_at_step / get_workflow_logs). To take one contact out of a workflow, the public API removes by contactId + workflowId.',
  },
  {
    rule: 'start-workflow-empty-body',
    method: 'POST',
    path: /^\/workflow\/[^/]+\/[^/]+\/start-workflow$/,
    refuses: (wire) => wire === undefined || wire === null || isEmptyOnWire(wire),
    message: 'start-workflow with an EMPTY body is accepted (200) and creates a PHANTOM enrolment: an execution with no contact that runs the first step.',
    hint: 'This route takes the builder\'s Test Workflow payload plus actionFrom{userId, channel:"web_app", source:"workflow_test_page"}. Never probe a write route with an empty body — describe_endpoint carries the measured shape.',
  },
  {
    rule: 'change-status-publish-door',
    method: 'PUT',
    path: /^\/workflow\/[^/]+\/change-status\/[^/]+$/,
    refuses: (wire) => isPlainObject(wire) && String(wire.status ?? '').trim().toLowerCase() === 'published',
    message: 'PUT …/change-status/{workflowId} with status:"published" is a second publish door that runs NONE of the four validation layers publish_workflow runs.',
    hint: 'Use publish_workflow. Setting status:"draft" through this route is not refused.',
  },
  {
    rule: 'bulk-change-status-publish-door',
    method: 'PUT',
    path: /^\/workflow\/[^/]+\/change-status$/,
    refuses: (wire) => isPlainObject(wire) && String(wire.status ?? '').trim().toLowerCase() === 'published',
    message: 'PUT …/change-status (no trailing workflowId) with status:"published" is the BULK publish door — it runs NONE of the validation layers publish_workflow runs, and it does so for every id in body.workflowIds at once.',
    hint: 'Use publish_workflow. Setting status:"draft" through this route is not refused — bulk stand-down is legitimate; unpublish_workflows is the tool for it.',
  },
  {
    rule: 'permission-needs-key',
    method: 'PUT',
    path: /^\/workflow\/[^/]+\/permission\/[^/]+$/,
    refuses: (wire) => !(isPlainObject(wire) && Object.hasOwn(wire, 'permission')),
    message: 'PUT …/permission/{workflowId} with no `permission` key answers 200 with an empty body and changes NOTHING — the 200 carries no information.',
    hint: 'Pass body {permission:<number>}: 50 agency admin, 180 agency user, 280 account admin, 380 all, 404 none. Read the workflow row back to verify.',
  },
];

/** The refusal for this call, or null. `method` upper-case; `body` already JSON-parsed. */
export function refuseRawRequest({ method, path, body }) {
  const p = pathOnly(path);
  const wire = onWire(body);
  for (const r of RULES) {
    if (r.method === method && r.path.test(p) && r.refuses(wire)) return { rule: r.rule, message: r.message, hint: r.hint };
  }
  return null;
}

/**
 * The catalogue row a WIRE path belongs to, or null. Rows are templated (`/workflow/{locationId}/…`);
 * a `{param}` segment matches any one segment. Several rows can match one path
 * (`/workflow/{a}/{b}` and `/workflow/{a}/change-status`) — the one with the most LITERAL segments wins.
 */
export function matchCatalogRow(pool, method, path) {
  const want = String(method).toUpperCase();
  const segs = pathOnly(path).split('/');
  let best = null, bestLiteral = -1;
  for (const row of pool) {
    if (row.method !== want) continue;
    const rs = String(row.path).split('?')[0].replace(/\/+$/, '').split('/');
    if (rs.length !== segs.length) continue;
    let literal = 0, ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (/^\{[^}]+\}$/.test(rs[i])) continue;
      if (rs[i] !== segs[i]) { ok = false; break; }
      literal++;
    }
    if (ok && literal > bestLiteral) { best = row; bestLiteral = literal; }
  }
  return best;
}
