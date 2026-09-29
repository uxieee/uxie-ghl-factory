// A trigger row that names a tag with a capital letter never fires. GHL stores every tag in lower case (tagging a contact
// "Vip" stores "vip"), and the trigger comparison is against the stored name: measured live 2026-09-30 on two own published
// contact_tag workflows that differed only in the stored row ('TEST-CONF-WF-W29-Mixed' vs its lower-case twin) — the
// lower-case one enrolled a contact tagged 'TEST-CONF-WF-W29-Mixed', the mixed-case one never did
// (knowledge sniffs live-W29-tagcase-*.json). The builder's drawer shows such a row as "Select a tag".
//
// Measured on `tagsAdded` (contact_tag) and, in wave31 (2026-09-30), on an if/else TAG CONDITION: same own contact, same tag — the
// lower-case condition took Yes, the mixed-case one took Else (live-W31-ifelse-tag-result.json). NOT MEASURED, and not claimed: the tag
// values a STEP writes: measured wave33 (2026-09-30), NOT affected — a mixed-case add_contact_tag stored the lower-case tag and a mixed-case
// remove_contact_tag removed it (live-W32-steptag-result.json). Other trigger types' tag rows were not fired.
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
export const TAG_CASE_NOT_COVERED = 'Checked and NOT affected: add/remove-tag STEPS (GHL lower-cases their value at write: a mixed-case add stored the lower-case tag, a mixed-case remove removed it). NOT fired: the tag rows of other trigger types (customer_reply, appointment, invoice, note_add, custom_date_reminder), which compare the same stored name.';

// The mixed-case tag values in ONE if/else step's stored attributes: [{ branch, values }].
export function mixedCaseIfElseTags(attributes) {
  const out = [];
  for (const b of Array.isArray(attributes?.branches) ? attributes.branches : []) {
    const values = [];
    for (const seg of Array.isArray(b?.segments) ? b.segments : []) for (const c of Array.isArray(seg?.conditions) ? seg.conditions : []) {
      if (c?.conditionType !== 'contact_detail' || c?.conditionSubType !== 'tags') continue;
      values.push(...[].concat(c.conditionValue ?? []).filter(isMixedCaseTag));
    }
    if (values.length) out.push({ branch: b?.name ?? null, values });
  }
  return out;
}

// check_workflow: one finding per mixed-case value in an if/else tag condition (it always takes the other branch).
export function lintIfElseTagCase(templates) {
  const out = [];
  for (const t of Array.isArray(templates) ? templates : []) {
    if (t?.type !== 'if_else') continue;
    for (const r of mixedCaseIfElseTags(t.attributes)) for (const v of r.values) {
      out.push({ code: 'IFELSE_TAG_CASE', severity: 'error', stepId: t.id,
        msg: `if/else '${t.name ?? t.id}' branch '${r.branch ?? '?'}' tests the tag '${v}' — GHL stores tags in lower case and a condition with a capital letter never matched in the live test (the contact took Else). Fix: ${tagCaseFix(v)}` });
    }
  }
  return out;
}
