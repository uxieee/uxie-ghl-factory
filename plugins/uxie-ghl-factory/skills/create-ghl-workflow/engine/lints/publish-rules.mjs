// THE PUBLISH VALIDATOR'S STRUCTURAL RULES.
//
// Publish is the only validator that matters. On 2026-08-29, twenty-one workflows passed
// check_workflow with 0 errors and the publish PUT refused three of them, each with a precise
// message the pre-flight could not see (F5-33). These are the structural ones — the rules that
// read the graph rather than a step's own fields, which is exactly what the marketplace action
// schema cannot check.
//
//   NEXT_PARENTKEY_MISMATCH  a step's parentKey does not name the step whose `next` points at it.
//                            GHL answers "next-parentkey-mismatch". Left behind by builder edits
//                            that splice in front of a step without repairing the pair.
//   FIELD_ROW_INCOMPLETE     an update_contact_field row missing `title` or `type`. GHL answers
//                            "Title is required" / "Type is required". A working clear row is
//                            { field, value: "", title, type: "string", date: "" }.
//
// Advisory on a read (they describe a publish that would be refused, not a document that is
// already broken), and both are cheap to compute from the templates alone.
export function lintPublishRules(templates) {
  const list = Array.isArray(templates) ? templates.filter(Boolean) : [];
  const out = [];
  const byId = new Map(list.map((t) => [t.id, t]));

  // Who does each step's `next` actually point at? A container's next[] is branch wiring, not a
  // linear successor, so it is excluded — branch entries carry `parent`, not parentKey.
  const inbound = new Map();
  for (const t of list) if (typeof t.next === 'string' && t.next) inbound.set(t.next, t.id);

  for (const t of list) {
    if (!t.id) continue;
    const pk = t.parentKey;
    const pred = inbound.get(t.id);
    // Only judge a step that HAS a parentKey and HAS an inbound linear edge: a root has neither,
    // a branch entry has `parent`, and a dangling parentKey is a different lint's business.
    if (pk == null || pred === undefined) continue;
    if (pk !== pred && byId.has(pk)) {
      out.push({
        code: 'NEXT_PARENTKEY_MISMATCH', severity: 'warning', stepId: t.id, name: t.name ?? t.id,
        msg: `'${t.name ?? t.id}' has parentKey '${byId.get(pk)?.name ?? pk}' but the step whose next points at it is `
          + `'${byId.get(pred)?.name ?? pred}'. GHL's publish validator refuses this as "next-parentkey-mismatch"; `
          + 'the builder renders it fine, so it survives until someone tries to publish.',
      });
    }
  }

  for (const t of list) {
    if (t.type !== 'update_contact_field') continue;
    const rows = Array.isArray(t.attributes?.fields) ? t.attributes.fields : [];
    rows.forEach((r, i) => {
      if (!r || typeof r !== 'object') return;
      const missing = ['title', 'type'].filter((k) => r[k] === undefined || r[k] === null || r[k] === '');
      if (!missing.length) return;
      out.push({
        code: 'FIELD_ROW_INCOMPLETE', severity: 'warning', stepId: t.id, name: t.name ?? t.id,
        msg: `'${t.name ?? t.id}' field row ${i} (${r.field ?? 'unnamed'}) is missing [${missing.join(', ')}] — `
          + 'GHL\'s publish validator answers "Title is required" / "Type is required". A working clear row is '
          + '{ field, value: "", title, type: "string", date: "" }.',
      });
    });
  }
  return out;
}
