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
// Coverage is PARTIAL and it is per REFERENCE SITE, not per asset type. That correction was
// measured on GROM Sandbox 2026-09-15 against a positive control: the SAME ghost calendar id is
// CAUGHT on an `appointment` trigger's `calendar.id` condition (ASSET_CALENDAR_NOT_FOUND) and
// MISSED on an `appointment_booking` step's `calendarId`. So never reason "asset type X is
// covered" — a site-by-site claim is the only kind the evidence supports.
//
// Confirmed catches: a nonexistent workflow id on `add_to_workflow` (ASSET_WORKFLOW_NOT_FOUND);
// a nonexistent user id on `assign_user` (ASSET_USER_NOT_FOUND); a nonexistent calendar in an
// `appointment` TRIGGER condition (ASSET_CALENDAR_NOT_FOUND). Confirmed MISS: a nonexistent
// `calendarId` on an `appointment_booking` STEP. The full ruleId vocabulary is unmapped.
//
// TRIGGERS ARE VALIDATED, so a clean sweep of the steps is not a clean document. A trigger-borne
// finding arrives with stepId, stepName and stepType all null. Proven by construction rather than
// inferred: with `templates: []` — no steps at all — the ghost-calendar trigger still reports.
// Null attribution alone means only "not attributed to a step" (a marketplace step's tag warning
// carries a null stepId too), which is why describeFinding below refuses to name it a trigger.
// The trigger condition field is `calendar.id`; five guessed spellings each returned identical to
// the control, i.e. discriminated nothing. Pinned by conformance.mjs §5.
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
  // 🔴 NO STEP ATTRIBUTION IS INFORMATION, NOT A BLANK. Measured live 2026-09-15 against a control:
  // a step-borne finding carries stepId + stepName + stepType; a TRIGGER-borne one carries all three
  // as null. Rendering that as 'workflow:' read like a document-level problem and hid the single
  // most useful fact about it — that the reference is on a TRIGGER, which is a different repair
  // (modifyTrigger, not replaceInAttributes) and a different failure (the validation gate refuses
  // the very edit that fixes it — see console bl-137).
  //
  // Stated as what is KNOWN rather than as a guess: a tag finding on a marketplace step was also
  // reported with a null stepId, so null means 'not attributed to a step', not 'is a trigger'.
  // Naming it 'trigger' would invent precision the payload does not carry.
  const where = f.stepName || f.stepType || f.stepId || 'unattributed (trigger-borne or document-level)';
  const what = f.message || f.ruleId || 'asset problem';
  const id = f.assetId ? ` (${f.assetType ?? 'asset'} ${f.assetId})` : '';
  return `${where}: ${what}${id}${remediationFor(f)}`;
}

// 🔴 GHL'S OWN MESSAGE SENDS YOU TO THE WRONG PLACE for a deactivated calendar. Measured live
// 2026-09-20 with a positive control (an `isActive:true` calendar validates clean): a calendar
// with `isActive:false` is reported as ASSET_CALENDAR_NOT_FOUND carrying the text "does not
// exist or does not belong to this location" — WORD FOR WORD the answer a ghost id gets. The
// calendar is there and a direct GET of it returns 200; the repair is to re-activate it, not to
// hunt for something deleted. Passing that sentence through verbatim costs the reader the one
// fact the payload does not contain, so the two cases are named here rather than merged.
// Pinned as a live regression in the conformance suite (scripts/conformance.mjs, the
// validate-assets section) — if GHL ever starts accepting inactive calendars, that fails loudly
// instead of this hint quietly going stale.
const REMEDIATION = new Map([
  ['ASSET_CALENDAR_NOT_FOUND', ' — NOTE: GHL returns this same not-found text for a calendar that merely has isActive:false as for one that is gone. Read the calendar directly before assuming it was deleted; if it answers 200, re-activate it rather than re-pointing the step.'],
]);

/** The hint that turns a misleading GHL message into an actionable one, or '' when there is none. */
export function remediationFor(f) {
  return REMEDIATION.get(f?.ruleId) ?? '';
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
