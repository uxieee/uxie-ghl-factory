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

import { REDACTED } from './errors.mjs';

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

// The redacted-payload guard (measured 2026-09-21, proposal at console/PROPOSAL-redacted-payload-
// guard.md). `scrubSecrets` (errors.mjs) redacts a secret-named field to the literal string REDACTED
// on the way OUT, by KEY NAME, without reading the value — so a healthy secret and one already
// overwritten with the placeholder come back byte-identical. Nothing stops that placeholder being
// written back IN on top of a real credential, and the write reports success: repair_workflow's own
// round-trip verify is true, because the document really did store what was sent. This is the ONLY
// point that can catch it, because the damage is invisible afterwards through every read rail.
//
// Judges the PAYLOAD, not the workflow — a pure function of the bytes about to be sent, like the
// five rules above. Unlike those five, this one has no confirm hatch: there is no legitimate reason
// to write the literal placeholder into a workflow, so it refuses, full stop.
//
// Finds every STRING value in `payload` that CARRIES the placeholder (a substring match on the
// exact marker text, e.g. `<redacted>` — a step NAME that merely contains the word "redacted" in
// prose, with no angle brackets, does not match). Substring, not exact-equality, because the
// scrubber's own text scrub (errors.mjs `scrub()`) does not always replace a whole field: a
// credential embedded inside a longer code string (the custom_code `'Bearer ' + inputData.pit`
// case the proposal names) comes back with the placeholder rewritten INLINE inside that string —
// `attributes.code` stays a long string, now containing `Bearer <redacted>` as a substring, not
// equal to the placeholder on its own. Exact-equality alone would miss exactly this case, which is
// also the one case scrubbing left an accidental, unreliable signature on. Each hit is attributed to
// the nearest ancestor object carrying a string `id`, which is a workflow step wherever this
// payload nests its templates: repair_workflow's top-level `templates` array, edit_workflow's
// `commitBody.workflowData.templates`, or a raw_request body shaped either way. A hit with no such
// ancestor (an arbitrary raw_request body) is reported by its field path alone.
function findRedactedValues(payload) {
  const hits = [];
  const walk = (node, path, step) => {
    if (typeof node === 'string' && node.includes(REDACTED)) {
      hits.push({ id: step?.id, name: step?.name, type: step?.type, path });
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`, step)); return; }
    if (node && typeof node === 'object') {
      const nextStep = typeof node.id === 'string' && node.id ? node : step;
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, nextStep);
    }
  };
  walk(payload, '', null);
  return hits;
}

// Groups per-value hits by step, so a step with two redacted fields is named once, not twice.
function groupByStep(hits) {
  const groups = new Map();
  for (const h of hits) {
    const key = h.id ?? `path:${h.path}`;
    if (!groups.has(key)) groups.set(key, { id: h.id, name: h.name, type: h.type, paths: [] });
    groups.get(key).paths.push(h.path);
  }
  return [...groups.values()];
}

/**
 * FOR VALIDATION ONLY — never for a write. Returns `templates` with every field that is EXACTLY the
 * placeholder replaced by the value the STORED step with the same id holds at the same path.
 *
 * Why: the ordinary edit loop is export_workflow → change something → validate_workflow({templates}).
 * The export has already scrubbed every secret-named field to the placeholder, so the validator is
 * handed `authorization: "<redacted>"` and GHL answers "expected object, received string" — measured
 * 2026-09-23 on a custom_webhook, identically for three different bodies. The verdict was about our
 * own export artefact, it stopped the ACTION layer before the edit was even looked at, and it read as
 * `valid: false` on a correct edit.
 *
 * Restoring is safe for an EXACT placeholder: a value that is literally the placeholder cannot be the
 * caller's edit. A placeholder EMBEDDED in a longer string (a custom_code body with `Bearer <redacted>`
 * in it) is NOT restored — the caller may have edited the rest of that string, and substituting the
 * stored string would validate code they did not write. Those, and exact ones with no stored value to
 * restore from, come back in `unresolved`. Nothing restored is ever returned to the caller: only
 * step ids and paths.
 */
export function restoreRedactedForValidation(templates, storedTemplates) {
  const storedById = new Map((storedTemplates ?? [])
    .filter((t) => t && typeof t.id === 'string' && t.id).map((t) => [t.id, t]));
  const restored = [];
  const unresolved = [];
  const at = (obj, keys) => keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const out = (templates ?? []).map((step) => {
    if (!step || typeof step !== 'object') return step;
    const copy = structuredClone(step);
    const stored = typeof step.id === 'string' ? storedById.get(step.id) : undefined;
    const walk = (node, keys) => {
      if (typeof node === 'string') {
        if (!node.includes(REDACTED)) return;
        const path = keys.join('.');
        const original = stored ? at(stored, keys) : undefined;
        const restorable = node === REDACTED && original !== undefined
          && !(typeof original === 'string' && original.includes(REDACTED));
        if (restorable) {
          at(copy, keys.slice(0, -1))[keys[keys.length - 1]] = structuredClone(original);
          restored.push({ stepId: step.id, name: step.name ?? null, path });
        } else {
          unresolved.push({ stepId: step.id ?? null, name: step.name ?? null, path,
            reason: node === REDACTED ? 'no stored value at this path to restore from'
              : 'the placeholder is embedded inside a longer string, which may carry your edit' });
        }
        return;
      }
      if (Array.isArray(node)) node.forEach((v, i) => walk(v, [...keys, i]));
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, [...keys, k]);
    };
    walk(step, []);
    return copy;
  });
  return { templates: out, restored, unresolved };
}

const REDACTED_STEP_CAP = 6;

/**
 * The refusal for a write whose payload still carries the scrubber's placeholder, or null.
 * `payload` is whatever the caller is about to send: a templates array, a whole commit body, or a
 * raw_request body. Returns `{message, hint}` for `fail(CODES.VALIDATION_FAILED, …)`.
 */
export function refuseRedactedWrite(payload) {
  const hits = findRedactedValues(payload);
  if (!hits.length) return null;
  const steps = groupByStep(hits);
  const label = (s) => (s.id ? `${s.id} "${s.name ?? s.id}"` : `field ${s.paths[0]}`);
  const shown = steps.slice(0, REDACTED_STEP_CAP)
    .map((s) => `${label(s)}${s.type ? ` (${s.type})` : ''} at ${s.paths.join(', ')}`)
    .join('; ');
  const more = steps.length > REDACTED_STEP_CAP ? `, and ${steps.length - REDACTED_STEP_CAP} more` : '';
  return {
    message: `${hits.length} value(s) in this write are the redaction placeholder "${REDACTED}", not real `
      + `values: ${shown}${more}. Writing them back would REPLACE the stored value with the literal `
      + 'placeholder string.',
    hint: 'These steps must be re-entered by hand in the builder — the real values cannot be read back '
      + 'through this rail. scrubSecrets redacts by KEY NAME without reading the value, so the original is '
      + "not recoverable from any export or GET. There is no confirm hatch for this: there is no legitimate "
      + 'reason to write the literal placeholder into a workflow.',
  };
}
