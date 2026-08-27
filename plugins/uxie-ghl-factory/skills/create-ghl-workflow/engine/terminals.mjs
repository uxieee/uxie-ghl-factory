// TERMINAL STEPS CARRY NO `next` KEY.
//
// GHL's save validator REFUSES an explicit `next: null` and accepts the key being absent.
// Live A/B 2026-08-27, Sandbox probe 36bb7c70, identical body but for this one field:
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
