// A trigger row that names a tag with a capital letter never fires. GHL stores every tag in lower case (tagging a contact
// "Vip" stores "vip"), and the trigger comparison is against the stored name: measured live 2026-09-30 on two own published
// contact_tag workflows that differed only in the stored row ('TEST-CONF-WF-W29-Mixed' vs its lower-case twin) — the
// lower-case one enrolled a contact tagged 'TEST-CONF-WF-W29-Mixed', the mixed-case one never did
// (knowledge sniffs live-W29-tagcase-*.json). The builder's drawer shows such a row as "Select a tag".
//
// Measured on `tagsAdded` (contact_tag) and the other tag rows listed below; NOT MEASURED, and not claimed: if/else tag
// CONDITIONS and step tag values.
export const TAG_ROW_FIELDS = new Set(['tagsAdded', 'tagsRemoved', 'contact.tags']);

// A value with a capital letter, that is not a merge tag (merge tags resolve at run time and keep their case).
export const isMixedCaseTag = (v) => typeof v === 'string' && v !== v.toLowerCase() && !/\{\{/.test(v);

// The offending rows of one trigger's stored `conditions`: [{ field, operator, values: [the mixed-case values] }].
export function mixedCaseTagRows(conditions) {
  const out = [];
  for (const c of Array.isArray(conditions) ? conditions : []) {
    if (!c || typeof c !== 'object' || !TAG_ROW_FIELDS.has(c.field)) continue;
    const values = [].concat(c.value ?? []).filter(isMixedCaseTag);
    if (values.length) out.push({ field: c.field, operator: c.operator ?? null, values });
  }
  return out;
}

// The message a reader acts on. One place, so the lint, the sweep and the tests say the same thing.
export const tagCaseFix = (value) => `edit_workflow { op: 'replaceTag', oldTag: '${value}', newTag: '${value.toLowerCase()}', allowNoop: true }`;
export const TAG_CASE_NOT_COVERED = 'NOT COVERED: if/else tag conditions and step tag values — how GHL compares their case at run time was not measured.';
