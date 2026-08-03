// update_contact_field's actionType discriminator — the silent-choice guard.
//
// THE DEFECT THIS EXISTS FOR
// --------------------------
// `update_contact_field` carries TWO action types, confirmed in the builder's own dropdown
// (live, 2026-08-03):
//
//     actionType: "update_field_data"   write a value into the field
//     actionType: "clear_field_data"    blank the field
//
// Picking the wrong one fails SILENTLY. `update_field_data` with `value: ""` is not a clear
// — it is a write of nothing, which appears to be a no-op — so a step authored to WIPE a
// field leaves the stale value in place, and nothing anywhere raises an error: the step
// saves, round-trips clean, and the builder renders it fine.
//
// Found live in a client account 2026-08-03: a step named "Blank <outcome field>" was
// `update_field_data` with `value: ""`. It very likely never blanked anything, so the next
// call's outcome would have been read against the PREVIOUS call's stale result. (Corrected
// in that account; the engine gap is what this file closes.)
//
// WHY A WARNING AND NOT A THROW
// -----------------------------
// GHL's own `updateContactFieldValidator` grades this at result level **warning**, not
// error (reference/steps/og/update_contact_field.md, from `sniffs/bundle/validators.json`),
// so the workflow still publishes. An author may also have a real reason — an empty write
// against a merge-field-shaped intent, a placeholder step being filled in later. The engine
// does not get to overrule that. It gets to say so out loud.
//
// This is deliberately NOT the compiler's usual fail-loud posture (EMPTY_STEP,
// OPP_UNASSOCIATED, OPP_LOST_REASON_NO_LOST_STATUS all throw). Those encode shapes GHL
// itself rejects or silently discards. This one encodes a shape GHL accepts and stores
// exactly as authored — the ambiguity is about INTENT, and intent is the caller's.
//
// THE EMPTINESS RULE IS GHL'S, NOT OURS
// -------------------------------------
// `updateContactFieldValidator` pushes `value_required` for a fields[] entry when:
//
//     actionType === "update_field_data" && date !== "currentDate" && (value == null || value === "")
//
// That is reproduced verbatim below. Note the ONLY date exemption is the literal
// `"currentDate"` sentinel — an ISO date string in `date` does not exempt an empty `value`.
// A date-typed field whose whole point is "stamp now" is therefore correctly NOT flagged.
//
// NOTE ON COVERAGE: `update_contact_field` is a core native action, so it is absent from the
// marketplace assets schema (`action-schema.mjs`) — 307 of 383 types are in there and this
// is not one of them. checkWorkflow() can never see this step, which is why the check lives
// here, on the compile path, rather than being derived from GHL's schema at runtime.

// The two values the builder's dropdown offers. Closed on purpose: a third value is either
// a typo or a GHL change, and both are worth surfacing.
export const CONTACT_FIELD_ACTION_TYPES = ['update_field_data', 'clear_field_data'];

// The documented default when `actionType` is absent (reference/steps/og/update_contact_field.md
// — "Default: update_field_data"). An author who omits it while meaning to CLEAR lands in the
// exact defect above, so absence is analysed as the default rather than skipped.
export const DEFAULT_CONTACT_FIELD_ACTION_TYPE = 'update_field_data';

const CLEAR_HINT =
  "Use actionType:'clear_field_data' to empty a field and actionType:'update_field_data' to write one.";

// The validator's own notion of "no value". An empty array is included for the multi-select
// field types the validator's `value == null || value === ''` predates; a whitespace-only
// string is NOT — that is a real (if odd) write, and calling it empty would be this module
// inventing a rule GHL does not have.
export function isEmptyFieldValue(value) {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

// `currentDate` is the sentinel meaning "stamp execution time"; it supplies the value the
// empty `value` does not, so the validator exempts it.
export function fieldSuppliesNoValue(field) {
  return isEmptyFieldValue(field?.value) && field?.date !== 'currentDate';
}

const label = (field, index) => {
  const id = field?.field;
  const title = field?.title;
  if (id && title) return `${id} ("${title}")`;
  return id || title || `fields[${index}]`;
};

// Inspect one update_contact_field attributes object and emit advisory warnings.
// `warn` is the same ctx.warn sink the compiler's other advisories use (surfaced as
// `warnings` on build_workflow's report and edit_workflow's preview). No-ops without one.
export function checkContactFieldShape(attrs, { ref = '?', warn } = {}) {
  if (!warn) return;
  const fields = Array.isArray(attrs?.fields) ? attrs.fields : [];
  if (!fields.length) return;   // the empty-fields case is GHL's at_least_one_field_required, not ours

  const declared = attrs?.actionType;
  const actionType = declared ?? DEFAULT_CONTACT_FIELD_ACTION_TYPE;
  const where = `update_contact_field '${ref}'`;

  if (declared != null && !CONTACT_FIELD_ACTION_TYPES.includes(declared)) {
    warn(`CONTACT_FIELD_ACTION_TYPE_UNKNOWN: ${where} declares actionType '${declared}', which is `
      + `neither of the two the builder offers (${CONTACT_FIELD_ACTION_TYPES.join(', ')}). GHL stores `
      + `an unrecognised discriminator as authored and the step saves clean, so a typo here is silent. `
      + CLEAR_HINT);
    return;   // every check below is defined relative to a known actionType
  }

  const blank = fields.filter(fieldSuppliesNoValue);

  if (actionType === 'update_field_data') {
    if (!blank.length) return;
    const named = blank.map((f) => label(f, fields.indexOf(f))).join(', ');
    const viaDefault = declared == null
      ? ` (actionType is absent, which GHL defaults to '${DEFAULT_CONTACT_FIELD_ACTION_TYPE}')`
      : '';
    if (blank.length === fields.length) {
      warn(`CONTACT_FIELD_CLEAR_MISMATCH: ${where} is '${actionType}'${viaDefault} but EVERY field it `
        + `writes carries an empty value with no 'currentDate' — [${named}]. That is almost certainly `
        + `meant to be a clear: an empty '${DEFAULT_CONTACT_FIELD_ACTION_TYPE}' write appears to be a `
        + `no-op, so the stale value survives and nothing raises an error. ${CLEAR_HINT} `
        + `If the empty write is intentional, this warning is advisory only — nothing was blocked.`);
    } else {
      warn(`CONTACT_FIELD_EMPTY_VALUE: ${where} is '${actionType}' and ${blank.length} of `
        + `${fields.length} field(s) carry an empty value with no 'currentDate' — [${named}]. GHL's own `
        + `updateContactFieldValidator flags each of these 'value_required'; they will not be cleared, `
        + `they will simply not be written. ${CLEAR_HINT}`);
    }
    return;
  }

  // clear_field_data — the mirror. GHL ignores `value` in this mode, so a populated value is
  // authored intent that evaporates: the field is blanked, not set to what was written.
  const populated = fields.filter((f) => !isEmptyFieldValue(f?.value));
  if (!populated.length) return;
  warn(`CONTACT_FIELD_CLEAR_HAS_VALUE: ${where} is 'clear_field_data' but ${populated.length} of `
    + `${fields.length} field(s) carry a non-empty value — `
    + `[${populated.map((f) => `${label(f, fields.indexOf(f))}=${JSON.stringify(f.value)}`).join(', ')}]. `
    + `A clear BLANKS the field and ignores the value, so anything authored here is discarded silently. `
    + CLEAR_HINT);
}

// Lint persisted templates[] — the edit path's entry point. Edit ops that ADD a step run
// through compile() and are already checked there; `modifyStep` merges an attribute patch
// straight onto a stored step and never touches the compiler, so without this a patch could
// flip a clear into an empty write with nothing looking at it.
//
// `stepIds` scopes the lint to the steps this edit actually touched — warning about
// untouched pre-existing steps would be noise the caller cannot act on in this request.
export function lintContactFieldTemplates(templates, stepIds, warn) {
  if (!warn) return;
  const wanted = stepIds == null ? null : new Set(stepIds);
  for (const step of templates ?? []) {
    if (step?.type !== 'update_contact_field') continue;
    if (wanted && !wanted.has(step.id)) continue;
    checkContactFieldShape(step.attributes ?? {}, { ref: step.name ?? step.id ?? '?', warn });
  }
}
