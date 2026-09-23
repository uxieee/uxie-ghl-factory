// Trigger conditions that match an account-level vocabulary BY NAME, checked against that vocabulary.
//
// WHY THIS IS NOT THE ASSET CHECK. The asset-reference preflight answers "does the object this id
// names still exist". A condition that stores a NAME has no id to look up, so it is invisible to it:
// a Call Outcome Router whose trigger named two dispositions the account did not have carried two
// permanently dead branches — one a multi-day recovery ladder — behind a CLEAN asset preflight and
// a CLEAN check_workflow (console bl-139, found live 2026-09-15).
//
// THE KNOWN CASE, from GHL's own source (models/Triggers/Filters/CallStatusFilter.ts): the
// call_status trigger's `custom_disposition` filter stores the disposition LABEL, deliberately —
// "keep label and values same as people can add and delete same custom disposition … Changed IDs
// won't work". So the stored value must equal an active disposition's name, exactly.
//
// Other name-matched condition kinds are NOT enumerated yet; this module checks only what it knows,
// and says so in its note rather than implying the whole vocabulary class is covered.

export const NAME_MATCHED_CONDITIONS = [
  { triggerType: 'call_status', field: 'custom_disposition', vocabulary: 'callDispositions' },
];

const conditionsOf = (t) => [
  ...(Array.isArray(t?.conditions) ? t.conditions : []),
  ...(Array.isArray(t?.filters) ? t.filters : []),
];
const valuesOf = (c) => (Array.isArray(c?.value) ? c.value : (c?.value == null || c.value === '' ? [] : [c.value]))
  .filter((v) => typeof v === 'string');

/** True when any trigger carries a condition this module would check — so a caller fetches nothing otherwise. */
export function needsVocabularies(triggers = []) {
  return triggers.some((t) => NAME_MATCHED_CONDITIONS.some((k) => (t?.type === k.triggerType || !t?.type)
    && conditionsOf(t).some((c) => c?.field === k.field)));
}

/**
 * @param triggers   stored trigger records (conditions[]) or authored ones (filters[])
 * @param vocabularies { callDispositions: string[] | null } — null means the list could not be read
 * @returns {checked, findings:[{triggerId, triggerName, field, value, message, suggestion?}], notChecked:[...]}
 */
export function checkVocabularyRefs(triggers = [], vocabularies = {}) {
  const findings = [];
  const notChecked = [];
  let checked = 0;
  for (const t of triggers) {
    for (const k of NAME_MATCHED_CONDITIONS) {
      if (t?.type && t.type !== k.triggerType) continue;
      for (const c of conditionsOf(t)) {
        if (c?.field !== k.field) continue;
        const names = vocabularies[k.vocabulary];
        if (!Array.isArray(names)) {
          notChecked.push({ triggerId: t.id ?? null, triggerName: t.name ?? null, field: k.field,
            why: `the account's ${k.vocabulary} could not be read` });
          continue;
        }
        const exact = new Set(names);
        const folded = new Map(names.map((n) => [n.trim().toLowerCase(), n]));
        for (const v of valuesOf(c)) {
          checked++;
          if (exact.has(v)) continue;
          const near = folded.get(v.trim().toLowerCase());
          findings.push({
            triggerId: t.id ?? null, triggerName: t.name ?? null, field: k.field, value: v,
            ...(near ? { suggestion: near } : {}),
            message: `trigger '${t.name ?? t.id ?? '?'}' matches ${k.field} '${v}', which is not an active call disposition on this account`
              + (near ? ` — the account has '${near}'; the stored LABEL must match exactly` : '')
              + '. GHL matches this condition by NAME, so it can never fire for that value, and nothing else reports it.',
          });
        }
      }
    }
  }
  return { checked, findings, notChecked };
}

/** Every ACTIVE disposition name on the location, or null when the list cannot be read completely. */
export async function fetchDispositionNames(call, loc) {
  const names = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call('GET', `/phone-system/call-dispositions?locationId=${encodeURIComponent(loc)}&page=${page}&limit=50&includeDeleted=false`);
    const rows = r?.json?.dispositions;
    if (!r?.ok || !Array.isArray(rows)) return null;
    for (const d of rows) if (d && d.isDeleted !== true && typeof d.name === 'string') names.push(d.name);
    const totalPages = Number(r.json.totalPages ?? 1);
    if (!(page < totalPages)) return names;
  }
  return null;   // more pages than the walk allows: an incomplete vocabulary would report false misses
}
