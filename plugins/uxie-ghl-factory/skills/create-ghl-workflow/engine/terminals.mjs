// TERMINAL STEPS CARRY NO `next` KEY.
//
// GHL's save validator REFUSES an explicit `next: null` and accepts the key being absent.
// Live A/B 2026-08-27, the designated test sub-account, workflow 36bb7c70, identical body
// but for this one field:
//
//   next: null   -> 400  "Next is invalid. Please provide a valid value."
//                        validationType "action", source "node", naming the terminal step
//   key absent   -> 200
//
// The builder normalises the key away on its own save (captured PUT bodies wf24-save2.json
// and wf-save-body2.json carry ZERO nulls where the stored document had ten), and the server
// STORES the key absent when you send it absent. So a document read with GET and written
// straight back with PUT fails on exactly the field the server itself wrote — which is why an
// untouched legacy terminal blocks every edit to a workflow nobody meant to change.
//
// Corpus: knowledge/corpus/workflows/40-rules/server-side-validation.md — "Omit `next` rather
// than nulling it."
//
// NOTE the direction. An earlier write-up had this backwards ("the builder sends explicit
// nulls; emit them"). It does not, and emitting them is the defect.

/** Remove `next` wherever it is explicitly null. Returns the SAME array when nothing changed —
 *  several call sites rely on object identity to prove an edit emitted an unchanged body. */
export function stripNullNext(templates) {
  if (!Array.isArray(templates)) return templates;
  let changed = false;
  const out = templates.map((t) => {
    if (!t || typeof t !== 'object') return t;
    if (!('next' in t) || t.next !== null) return t;
    changed = true;
    const { next, ...rest } = t;
    return rest;
  });
  return changed ? out : templates;
}

/** The steps that would be refused, for reporting rather than repair. */
export function nullNextIds(templates) {
  if (!Array.isArray(templates)) return [];
  return templates
    .filter((t) => t && typeof t === 'object' && 'next' in t && t.next === null)
    .map((t) => ({ id: t.id, name: t.name ?? null, type: t.type ?? null }));
}

// GHL's save validator REQUIRES `input_trigger_params` on every add_to_workflow step: a step
// carrying only {workflow_id, type} is refused with "Input Trigger Params is required" — and
// that refusal blocks EVERY save on the workflow, not just the offending step (required-fields.mjs,
// same evidence: differential 2026-08-27, the builder PUT that returned 200 carries
// input_trigger_params:false on both enrol steps; the one that returned 400 carries neither).
//
// CONDITIONAL_DEFAULTS in required-fields.mjs already fills this key — but only on the COMPILE
// path (enforceRequiredFields's one importer is compiler.mjs). A stored legacy step never passes
// through the compiler again: `editCommitBody` emits it unchanged, so a workflow the pre-fix
// engine built with an enrol step stays permanently unsaveable through edit_workflow, no matter
// what the edit touches. This is the edit-path repair, at the same wire-assembly boundary
// stripNullNext already owns.
//
/** Default `input_trigger_params:false` on any add_to_workflow step whose attributes lack the
 *  key. Returns the SAME array when nothing changed, exactly as stripNullNext does. */
export function fillInputTriggerParams(templates) {
  if (!Array.isArray(templates)) return templates;
  let changed = false;
  const out = templates.map((t) => {
    if (!t || typeof t !== 'object' || t.type !== 'add_to_workflow') return t;
    const attrs = t.attributes;
    if (!attrs || typeof attrs !== 'object' || 'input_trigger_params' in attrs) return t;
    changed = true;
    return { ...t, attributes: { ...attrs, input_trigger_params: false } };
  });
  return changed ? out : templates;
}
