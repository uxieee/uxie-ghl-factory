import OPP_SHAPES from '../catalog/opp-field-shapes.json' with { type: 'json' };
import OPP_RULEBOOK from '../catalog/opp-field-rulebook.json' with { type: 'json' };
import { IRError } from './ir.mjs';

export { OPP_SHAPES, OPP_RULEBOOK };

// The engine's opportunity-field table has TWO sources, and they answer different questions:
//
//   catalog/opp-field-rulebook.json  — WHICH fields exist. The builder's own field-picker
//     definition, lifted from the `standardFieldMappingOptions()` function that ships inside
//     the internal_update_opportunity / internal_create_opportunity marketplace assets.
//     Complete by construction: it IS the picker.
//   catalog/opp-field-shapes.json    — WHAT SHAPES those fields were observed carrying, counted
//     per (field, key) across a provenance-filtered live corpus. Complete only up to what the
//     sampled accounts happened to use.
//
// The set used to be corpus-only, which made it silently SHORT: lostReasonId,
// forecastExpectedCloseDate and forecastProbability are real picker fields that no sampled
// account had written, so authoring them threw OPP_FIELD_UNKNOWN before any network call and
// the engine reported a GHL limitation that does not exist (live, Grom UK 2026-08-03).
//
// The union is what the engine knows; the corpus still owns the shape rules where it has any.
// How a CUSTOM field is addressed on an opportunity action. `filterField` becomes a TOP-LEVEL
// body property, and the opportunities DTO whitelists those, so a bare field id is rejected with
// `property <id> should not exist` and the step SKIPS with a 400 nobody sees (live-proven, GROM
// sandbox 2026-08-30). This prefix makes the action build a `customFields` entry instead.
// STANDARD properties (pipelineStageId, status, lostReasonId, monetaryValue…) take a bare name —
// that asymmetry is the whole rule. Shared by the compiler's emit and the lint that guards it.
export const OPP_CUSTOM_FIELD_PREFIX = 'custom_fields.';

// The NAME keys an opportunity write may carry beside its ids, and what counts as one being
// LEAKED. GHL stores a name verbatim and the step then moves nothing, so a real name must fail
// closed — but the BUILDER writes `pipeline: null` / `stage: null` on its own update steps, so
// key PRESENCE says nothing. Only a non-empty string is a leak.
//
// Shared by the check_workflow lint and the edit-commit guard because they disagreed: the lint
// learned this on 2026-08-31 and the guard did not, so a UI-stored step that leaks no name at all
// aborted every edit in its scope with "carries name key(s) [pipeline, stage]" (R-57, GROM
// sandbox 2026-09-02). One predicate, one meaning.
export const OPP_NAME_KEYS = ['pipeline', 'stage', 'lostReason'];
export const isLeakedOppName = (v) => typeof v === 'string' && v.trim() !== '';
export const leakedOppNames = (attributes) =>
  OPP_NAME_KEYS.filter((k) => isLeakedOppName(attributes?.[k]));

export const STANDARD_OPP_FIELDS = new Set([
  ...Object.keys(OPP_RULEBOOK.fields),
  ...Object.keys(OPP_SHAPES.fields),
]);

// The shape to EMIT for a standard field when the author didn't specify one. Prefer the
// corpus's most-attested value (unchanged behaviour for the 6 fields it covers — all 6 agree
// with the rulebook anyway); fall back to the rulebook for fields the corpus never saw.
export function defaultOppFieldShape(filterField) {
  const corpus = OPP_SHAPES.fields[filterField];
  const rule = OPP_RULEBOOK.fields[filterField];
  return {
    valueFieldType: corpus?.valueFieldType?.allowed?.[0] ?? rule?.valueFieldType,
    dataType: corpus?.dataType?.allowed?.[0] ?? rule?.dataType,
  };
}

// Validate ONE compiled oppField {filterField, value, valueFieldType, dataType?} against
// the live-attested table. Absence is always legal (dialect). A present value outside the
// attested set is reported by SUPPORT TIER, both thresholds read from the data file:
//   accounts >= _threshold.throw  -> throw  (strong support — a wrong shape is a real defect)
//   accounts >= _threshold.warn   -> warn   (thin support — surface it, don't block a build)
//   accounts <  _threshold.warn   -> silent (too little evidence to even warn — never gate on n=1)
// Unknown filterFields are left for the Task-3 classifier.
//
// Fields the corpus never saw fall back to the RULEBOOK, which is not an observation but the
// builder's own definition — there is exactly one legal value and a mismatch always throws.
// (The generator assigns dataType unconditionally from that table, so these fields have no
// per-account dialect freedom for a wrong value to hide in.)
export function checkOppFieldShape(field, { ref, warn } = {}) {
  const spec = OPP_SHAPES.fields[field.filterField];
  if (!spec) return checkAgainstRulebook(field, ref);
  const { throw: throwAt, warn: warnAt } = OPP_SHAPES._threshold;
  for (const key of ['valueFieldType', 'dataType']) {
    const rule = spec[key];
    if (!rule) continue;
    const val = field[key];
    if (val === undefined) continue;              // dialect: absence always legal
    if (rule.allowed.includes(val)) continue;
    const support = `set: [${rule.allowed.join(', ')}], n=${rule.n}, ${rule.accounts} accounts`;
    const msg = `OPP_SHAPE: ${field.filterField} ${key} '${val}' not attested (${support})`
      + `${ref ? ` on '${ref}'` : ''} — verify against a live step`;
    if (rule.accounts >= throwAt) throw new IRError('OPP_SHAPE', msg);
    if (rule.accounts >= warnAt) warn?.(msg);
  }
}

function checkAgainstRulebook(field, ref) {
  const rule = OPP_RULEBOOK.fields[field.filterField];
  if (!rule) return;
  for (const key of ['valueFieldType', 'dataType']) {
    const val = field[key];
    if (val === undefined) continue;              // dialect: absence always legal
    if (val === rule[key]) continue;
    throw new IRError('OPP_SHAPE',
      `OPP_SHAPE: ${field.filterField} ${key} '${val}' contradicts the builder's own field `
      + `picker, which defines this field as ${key} '${rule[key]}' (source: `
      + `${OPP_RULEBOOK._source.split(' — ')[0]}, ${OPP_RULEBOOK._captured})`
      + `${ref ? ` on '${ref}'` : ''}.`);
  }
}
