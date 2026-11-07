// w6d-9 (4): the trigger-overlap check, reused from the G3 roster (knowledge sniffs w6d3-testrun.mjs rosterCheck).
//
// Given the result of find_workflows_using (returns:'workflows', with the trigger types a draft listens for), this says which workflows on
// the account listen to the SAME trigger types, and which of them are published. It is pure: the caller makes the read and passes the data.
//
// What it does NOT do: it does not evaluate trigger filters (a tag filter, a pipeline filter, a field filter). So an overlap is a candidate
// that "may also fire", not a collision. Every result carries that label, and a designer reads it as a question to check, not an answer.
// An incomplete read (find_workflows_using reports complete:false) is not a clear answer either: no hits are reported, and the note says so.

export const OVERLAP_LABEL = 'may also fire: trigger filters not evaluated';

// `types`: the trigger types the draft listens for. `found`: the find_workflows_using data ({complete, workflows, count, ...}).
// `excludeId`: the draft's own id, which never counts as an overlap with itself.
export function triggerOverlap({ types = [], found = {}, excludeId = null } = {}) {
  const wanted = (Array.isArray(types) ? types : []).filter((t) => typeof t === 'string' && t.trim());
  const base = { label: OVERLAP_LABEL, types: wanted, count: found?.count ?? null };
  if (!wanted.length) {
    return { ...base, complete: false, hits: [], publishedHits: [],
      note: 'no trigger types were given, so there is no overlap question to answer. Pass the draft\'s trigger types.' };
  }
  if (found?.complete !== true || !Array.isArray(found?.workflows)) {
    return { ...base, complete: false, hits: [], publishedHits: [],
      note: 'the find_workflows_using read is incomplete (complete is not true), so this is not a clear answer. Re-run the read as one call with a limit above count.' };
  }
  const hits = found.workflows
    .filter((w) => w && (w.id ?? null) !== null && String(w.id) !== String(excludeId ?? ''))
    .map((w) => ({ id: String(w.id), name: w.name ?? null, status: w.status ?? null, paused: w.paused ?? null, folderId: w.folderId ?? null,
      triggerTypes: wanted.slice() }));
  const publishedHits = hits.filter((h) => h.status === 'published');
  return { ...base, complete: true, hits, publishedHits,
    note: publishedHits.length
      ? `${publishedHits.length} published workflow(s) listen to the same trigger type(s). Check each one's trigger filters before building: ${OVERLAP_LABEL}.`
      : 'no published workflow listens to the same trigger type(s). Drafts are listed too, so check them if they are about to publish.' };
}
