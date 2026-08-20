// Asset pre-flight — GHL's OWN reference validator, called before we write anything.
//
// `POST /workflow/{loc}/validate-assets` is the endpoint the builder itself calls on every
// action-save, before it persists. It is stateless: it takes a payload, not a workflow id, so
// we can hand it a candidate build and get GHL's verdict without creating a thing.
//
//   request : { templates: [...], triggers: [...], companyId }
//   response: { errors: [...], warnings: [...] }
//   finding : { ruleId, assetType, assetId, message, severity, stepId, stepName, stepType }
//
// ── WHAT IT IS NOT ────────────────────────────────────────────────────────────────────────
// It validates ASSET REFERENCES, not field shapes. Proven by differential on GROM AU
// (2026-08-21): a `wait` with `type:'time'` and `startAfter` DELETED — which GHL's own
// wait-validator marks as an error — came back `{errors:[],warnings:[]}`. Never describe this
// as a shape or schema check, and never let its silence be read as "the step is well-formed".
//
// Coverage is per-asset-type and PARTIAL. Confirmed catches: a nonexistent workflow id on
// `add_to_workflow` (ASSET_WORKFLOW_NOT_FOUND) and a nonexistent user id on `assign_user`
// (ASSET_USER_NOT_FOUND). Confirmed MISS: a nonexistent `calendarId` on `appointment_booking`.
// The full ruleId vocabulary and asset-type coverage are unmapped.
// See docs/superpowers/notes/2026-08-21-workflow-shape-findings.md F3.
//
// ── FAIL-OPEN ─────────────────────────────────────────────────────────────────────────────
// This runs BEFORE the create, on a path that worked fine without it. A transport failure, a
// 404, or an unparseable body must therefore NOT become a new way for a previously-working
// build to die — it degrades to `skipped` with a reason, and the build proceeds. Only a
// definitive `errors[]` from GHL is allowed to stop anything. Same principle the edit path
// already applies to its custom-field index.

const EMPTY = Object.freeze([]);

/** Normalise one GHL finding into the shape the build report carries. */
function normalizeFinding(f) {
  if (!f || typeof f !== 'object') return { message: String(f), severity: 'error' };
  return {
    ruleId: f.ruleId ?? null,
    assetType: f.assetType ?? null,
    assetId: f.assetId ?? null,
    message: f.message ?? '',
    severity: f.severity ?? 'error',
    stepId: f.stepId ?? null,
    stepName: f.stepName ?? null,
    stepType: f.stepType ?? null,
  };
}

/** One-line human summary of a finding, for the build report and abort text. */
export function describeFinding(f) {
  const where = f.stepName || f.stepType || f.stepId || 'workflow';
  const what = f.message || f.ruleId || 'asset problem';
  const id = f.assetId ? ` (${f.assetType ?? 'asset'} ${f.assetId})` : '';
  return `${where}: ${what}${id}`;
}

/**
 * Ask GHL whether every asset a candidate build references actually exists.
 *
 * @param {(m:string,p:string,b?:any)=>Promise<{ok:boolean,status:number,json:any}>} call gateway
 * @param {string} loc      locationId
 * @param {object} payload  { templates, triggers, companyId }
 * @returns {Promise<{checked:boolean, skipped?:string, errors:object[], warnings:object[]}>}
 */
export async function validateAssets(call, loc, { templates, triggers, companyId } = {}) {
  if (!Array.isArray(templates)) return { checked: false, skipped: 'no templates to validate', errors: EMPTY, warnings: EMPTY };

  // companyId is OPTIONAL — proven live on GROM AU 2026-08-21: the same bad `assign_user`
  // reference returned ASSET_USER_NOT_FOUND both with and without it. This matters because
  // the engine has no company id at all (orchestrate.mjs passes `cid: undefined`), so
  // requiring it would have made this whole pre-flight a silent no-op in production while
  // every test still passed. Send it when we have it; never gate on it.
  const reqBody = { templates, triggers: Array.isArray(triggers) ? triggers : [] };
  if (companyId) reqBody.companyId = companyId;

  let res;
  try {
    res = await call('POST', `/workflow/${encodeURIComponent(loc)}/validate-assets`, reqBody);
  } catch (e) {
    // Fail-open: a transport error here is not a reason to refuse a build.
    return { checked: false, skipped: `transport failed: ${e?.message ?? String(e)}`, errors: EMPTY, warnings: EMPTY };
  }

  if (!res || res.ok !== true) {
    return { checked: false, skipped: `endpoint returned ${res?.status ?? 'no response'}`, errors: EMPTY, warnings: EMPTY };
  }

  const body = res.json;
  if (!body || typeof body !== 'object' || (!Array.isArray(body.errors) && !Array.isArray(body.warnings))) {
    return { checked: false, skipped: 'unrecognised response shape', errors: EMPTY, warnings: EMPTY };
  }

  return {
    checked: true,
    errors: (body.errors ?? []).map(normalizeFinding),
    warnings: (body.warnings ?? []).map(normalizeFinding),
  };
}
