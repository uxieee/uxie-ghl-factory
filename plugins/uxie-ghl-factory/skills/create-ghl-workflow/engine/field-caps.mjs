// MEASURED character caps on Conversation AI flow fields.
//
// The server stores an over-length value VERBATIM and round-trips it clean; only the builder's
// own action schema (the marketplace assets catalog, `schemaViolations`) reports it, as a field
// inside a block nobody reads while the top-level result says ok. On the standardisation rails
// four different caps were crossed in one week, each time committed with `verify.roundTrip:
// true`, and each was found later by opening the builder or by reading the block by hand
// (D-68, D-74, D-81, D-88, R-144; backlog 15 and 25). This table is the union of what was
// measured, so the caps can be REFUSED before a write and shown by describe_step_type without a
// catalog fetch.
//
// Every number here was crossed live and read back: a 550-char promptInstructions committed
// while the schema said 500 (R-144); 640/640/497 on splitter description / ai_message message /
// book_appointment promptInstructions all round-tripped while the schema reported them (D-74);
// 549 on promptInstructions again (D-83). `conversationai_continue` has no documented cap — an
// 821-char message stored and ran (D-81) — so it is deliberately absent. Do not add a cap that
// was not crossed and read back.
export const FIELD_CAPS = Object.freeze({
  conversationai_objective: Object.freeze({ instructions: 1000 }),
  conversationai_ai_message: Object.freeze({ message: 600 }),
  conversationai_book_appointment: Object.freeze({ promptInstructions: 500 }),
  conversationai_ai_splitter: Object.freeze({ description: 500 }),
});

/**
 * Over-cap fields on the given templates. `scope` (a Set of step ids) restricts REPORTING to
 * those steps — the touched set on an edit. Pure; never throws.
 * @returns {{ stepId, name, type, field, length, cap }[]}
 */
export function checkFieldCaps(templates, { scope = null } = {}) {
  const out = [];
  for (const t of templates ?? []) {
    if (!t || typeof t !== 'object') continue;
    if (scope && !scope.has(t.id)) continue;
    const caps = FIELD_CAPS[t.type];
    if (!caps) continue;
    for (const [field, cap] of Object.entries(caps)) {
      const v = t.attributes?.[field];
      if (typeof v !== 'string' || v.length <= cap) continue;
      out.push({ stepId: t.id, name: t.name ?? t.id, type: t.type, field, length: v.length, cap });
    }
  }
  return out;
}

/** One-line description of a finding, for refusals and warnings. */
export const describeCap = (f) =>
  `'${f.name}' (${f.type}) ${f.field} is ${f.length} characters; the builder's cap is ${f.cap}. The server stores it `
  + 'verbatim and the round-trip reads clean; the builder shows an error badge and the drawer refuses to save.';
