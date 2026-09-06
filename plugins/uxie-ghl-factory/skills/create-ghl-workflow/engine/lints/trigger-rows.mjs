// Stored trigger condition rows against the catalog's row model. The server accepts any operator
// and any type — and 500s only on an OBJECT type — so a wrong-dialect row saves clean and never
// matches (F5-16 / F5-25 / F5-26).
//
// Universal: `operator` and `type` must be strings, checked whether or not the catalog models the
// trigger. Catalog-gated: when the row model knows this field's operator (or its operatorMenu), a
// stored operator outside that set is warned. Rows the catalog does not model are SKIPPED — this
// lint states only what is known and never guesses.
export function lintTriggerRows(triggers, catalog) {
  const out = [];
  for (const t of triggers ?? []) {
    if (!t) continue;
    const meta = catalog?.trigger?.(t.type);
    const rows = meta?.filterRows ?? [];
    // ALL rows for a field, not the first. A drawer offers the same field under several rows
    // when each row is one operator — `contact.tags` is "Has tag" (index-of-true) AND "Doesn't
    // have tag" (index-of-false), two catalogue rows with one `value`. Reading only the first
    // flagged the UI's own "Doesn't have tag" as off-menu on every customer_reply trigger (R-74).
    const rowsFor = (field) => rows.filter((r) => r.value === field || r.field === field || r.id === field);
    for (const c of t.conditions ?? []) {
      if (!c || typeof c !== 'object') continue;
      const push = (code, severity, msg) => out.push({
        triggerId: t.id ?? t._id, name: t.name ?? t.type, type: t.type, code, severity, msg,
      });
      for (const k of ['operator', 'type']) {
        if (c[k] !== undefined && c[k] !== null && typeof c[k] !== 'string') {
          push('TRIGGER_ROW_NOT_STRING', 'error',
            `condition '${c.field}' has a non-string ${k} (${JSON.stringify(c[k])}) — the trigger POST `
            + '500s on this shape and a stored one never matches');
        }
      }
      const matching = rowsFor(c.field);
      if (!matching.length) continue;
      const menu =[...new Set(matching.flatMap((r) => (Array.isArray(r.operatorMenu) && r.operatorMenu.length
        ? r.operatorMenu
        : (r.operator ? [r.operator] : []))))];
      if (menu.length && typeof c.operator === 'string' && !menu.includes(c.operator)) {
        push('TRIGGER_ROW_OPERATOR', 'warning',
          `condition '${c.field}' stores operator '${c.operator}' — the drawer's set for this field is `
          + `[${menu.join(', ')}]; an off-menu operator saves clean and may never match`);
      }
      if (matching.some((r) => r.required === true) && (c.value === undefined || c.value === '' || (Array.isArray(c.value) && !c.value.length))) {
        push('TRIGGER_ROW_EMPTY_VALUE', 'warning', `required condition '${c.field}' has no value`);
      }
    }
  }
  return out;
}
