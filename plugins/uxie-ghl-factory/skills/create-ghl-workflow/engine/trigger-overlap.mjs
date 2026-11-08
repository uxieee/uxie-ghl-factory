// w6d-9 (4): the trigger-overlap check, reused from the G3 roster (knowledge sniffs w6d3-testrun.mjs rosterCheck).
// wf-4: the filters are compared statically, not evaluated against an event.
//
// Given the result of find_workflows_using (returns:'workflows', with the trigger types a draft listens for), this says which workflows on
// the account listen to the same trigger, and how each one relates to the draft's trigger. It is pure: the caller makes the reads and passes
// the data. For each workflow the caller passes its trigger rows as `triggers: [{type, conditions}]` (one GET of
// /workflow/{loc}/trigger?workflowId= per hit), and the draft's as `draftTriggers`.
//
// Verdict per workflow (the strongest across its trigger pairs):
//   WILL   the same trigger type, and no filters on either side, or identical filters. Both fire on the same event.
//   CANT   the same trigger type, and a SINGLE-VALUED field (allowlist SINGLE_VALUED) both filter on has disjoint values (form A vs form B, pipeline 1 vs 2).
//          Tags and every multi-valued field are never CANT: one add can carry VIP and Lead together.
//          The two cannot both match one event. Listed apart in `cannotOverlap`, not as a hit.
//   MIGHT  anything else: a filter on one side only, different filter fields, a different trigger type the find matched, an operator that
//          cannot be compared, or filters that were not read or passed. Reported as a candidate that "might also fire".
//   NONE   the workflow has no trigger of the searched types (the find matched a step). Listed apart; it is not a trigger overlap.
// No event is simulated. Filter rows are compared as the builder stores them (conditions[]); the rows of one trigger are read as ANDed
// (the builder's filter-row model). Tag and value comparisons are case-insensitive, which can only turn a CANT into a MIGHT, never the reverse.
// An incomplete read (find_workflows_using reports complete:false) is not a clear answer either: no hits are reported, and the note says so.

export const OVERLAP_LABEL = 'might also fire: trigger filters compared statically, no event simulated';

// Operators whose value is a set of accepted values, so two different sets on the same field cannot both match one event.
// index-of-true and contains operators are NOT here: they test a multi-valued field (tags added), where one event can carry both values.
const DISJOINT_OPS = new Set(['==', 'eq', 'is', 'is-any-of', 'is-in-array']);
// CANT is allowed only for a field that holds ONE value per event (the corpus's own examples), per trigger type. Anything else is MIGHT:
// a tag list, a multi-select, or a field whose cardinality is not known. When unsure, MIGHT.
const SINGLE_VALUED = {
  form_submission: ['form.id'],
  survey_submission: ['survey.id'],
  customer_appointment: ['calendar.id'],
  trigger_link: ['link.id'],
  pipeline_stage_updated: ['opportunity.pipelineId'],
  opportunity_created: ['opportunity.pipelineId', 'opportunity.pipelineStageId'],
  opportunity_changed: ['opportunity.assignedTo'],
};
const singleValued = (type, field) => (SINGLE_VALUED[type] ?? []).includes(field);

const normRows = (conds) => (Array.isArray(conds) ? conds : []).map((r) => {
  const values = [].concat(r?.value ?? []).map((v) => String(v).trim().toLowerCase()).filter((v) => v !== '');
  return { field: String(r?.field ?? ''), op: String(r?.operator ?? ''), values: [...new Set(values)].sort() };
});
const rowKey = (r) => `${r.field}\u0001${r.op}\u0001${r.values.join('\u0002')}`;
const sameFilters = (a, b) => a.length === b.length && (() => { const kb = b.map(rowKey).sort(); return a.map(rowKey).sort().every((k, i) => k === kb[i]); })();

// One draft trigger against one workflow trigger. Returns {verdict, reason}.
function verdictPair(d, c) {
  if (d.type !== c.type) return { verdict: 'MIGHT', reason: `different trigger types (${d.type} / ${c.type}) may fire on the same event; their filters are not compared` };
  if (!Array.isArray(d.conditions) || !Array.isArray(c.conditions)) return { verdict: 'MIGHT', reason: 'the trigger filters were not read, so they cannot be compared' };
  const dn = normRows(d.conditions);
  const cn = normRows(c.conditions);
  if (dn.length === 0 && cn.length === 0) return { verdict: 'WILL', reason: 'same trigger, no filters on either side: both fire on the same event' };
  if (sameFilters(dn, cn)) return { verdict: 'WILL', reason: 'same trigger with identical filters: both fire on the same event' };
  for (const a of dn) {
    for (const b of cn) {
      if (a.field !== b.field || a.values.length === 0 || b.values.length === 0) continue;
      if (!singleValued(d.type, a.field)) continue;
      if (!DISJOINT_OPS.has(a.op) || !DISJOINT_OPS.has(b.op)) continue;
      if (a.values.some((v) => b.values.includes(v))) continue;
      return { verdict: 'CANT', reason: `both filter ${a.field} with disjoint values (${a.values.join(', ')} / ${b.values.join(', ')}): they cannot match one event` };
    }
  }
  return { verdict: 'MIGHT', reason: 'the filters cannot be decided statically (one side has a filter the other does not, or different fields)' };
}

const RANK = { WILL: 3, MIGHT: 2, CANT: 1, NONE: 0 };

// Judge one workflow against the draft's triggers. `triggers` null means the workflow's trigger rows were not read.
function judge(draft, wanted, triggers) {
  if (!Array.isArray(triggers)) return { verdict: 'MIGHT', reason: 'this workflow\'s trigger filters were not read, so they cannot be compared', triggerTypes: wanted.slice() };
  const candidates = triggers.filter((t) => t && wanted.includes(t.type));
  if (!candidates.length) return { verdict: 'NONE', reason: 'no trigger of the searched type(s): the find matched a step, not a trigger', triggerTypes: [] };
  let best = null;
  for (const d of draft) {
    for (const c of candidates) {
      const v = verdictPair(d, c);
      if (!best || RANK[v.verdict] > RANK[best.verdict]) best = v;
    }
  }
  return { ...best, triggerTypes: [...new Set(candidates.map((c) => c.type))] };
}

// `types`: the trigger types the draft listens for. `draftTriggers`: [{type, conditions}] for the draft (optional; without it the filters
// cannot be compared and every trigger overlap is a MIGHT). `found`: the find_workflows_using data ({complete, workflows, count, ...}).
// `excludeId`: the draft's own id, which never counts as an overlap with itself.
export function triggerOverlap({ types = [], draftTriggers = null, found = {}, excludeId = null } = {}) {
  const fromDraft = Array.isArray(draftTriggers) ? draftTriggers.filter((t) => t && typeof t.type === 'string') : [];
  const wanted = [...new Set([...(Array.isArray(types) ? types : []), ...fromDraft.map((t) => t.type)])]
    .filter((t) => typeof t === 'string' && t.trim());
  const draft = fromDraft.length ? fromDraft : wanted.map((t) => ({ type: t, conditions: null }));
  const base = { label: OVERLAP_LABEL, types: wanted, count: found?.count ?? null };
  if (!wanted.length) {
    return { ...base, complete: false, hits: [], publishedHits: [], draftHits: [], cannotOverlap: [],
      note: 'no trigger types were given, so there is no overlap question to answer. Pass the draft\'s trigger types.' };
  }
  if (found?.complete !== true || !Array.isArray(found?.workflows)) {
    return { ...base, complete: false, hits: [], publishedHits: [], draftHits: [], cannotOverlap: [],
      note: 'the find_workflows_using read is incomplete (complete is not true), so this is not a clear answer. Re-run the read as one call with a limit above count.' };
  }
  const judged = found.workflows
    .filter((w) => w && (w.id ?? null) !== null && String(w.id) !== String(excludeId ?? ''))
    .map((w) => {
      const j = judge(draft, wanted, w.triggers);
      // A row with no status is NOT a draft: it may be published. It is reported as status 'unknown' and counts as a live hit.
      const status = w.status == null || w.status === '' ? 'unknown' : w.status;
      return { id: String(w.id), name: w.name ?? null, status, ...(status === 'unknown' ? { statusLabel: 'status unknown, check it' } : {}), paused: w.paused ?? null, folderId: w.folderId ?? null,
        verdict: j.verdict, reason: j.reason, triggerTypes: j.triggerTypes };
    });
  // A draft fires nothing: only published workflows are hits. A draft that would overlap is listed in draftHits, with its verdict.
  const live = judged.filter((h) => h.status === 'published' || h.status === 'unknown');
  const hits = live.filter((h) => h.verdict === 'WILL' || h.verdict === 'MIGHT');
  const draftHits = judged.filter((h) => h.status !== 'published' && h.status !== 'unknown' && (h.verdict === 'WILL' || h.verdict === 'MIGHT'));
  const unknownStatus = hits.filter((h) => h.status === 'unknown').length;
  const cannotOverlap = judged.filter((h) => h.verdict === 'CANT' || h.verdict === 'NONE');
  const publishedHits = hits;
  const will = hits.filter((h) => h.verdict === 'WILL').length;
  const might = hits.length - will;
  const parts = [];
  if (will) parts.push(`${will} will also fire (same trigger, same filters)`);
  if (might) parts.push(`${might} might also fire (the filters cannot be decided statically)`);
  let note = parts.length
    ? `${parts.join('; ')}. ${OVERLAP_LABEL}. Check each one's filters before building.`
    : 'no workflow listens to the same trigger type(s) with a filter that could match the draft\'s. Drafts are listed too, so check them if they are about to publish.';
  if (cannotOverlap.some((h) => h.verdict === 'CANT')) note += ` ${cannotOverlap.filter((h) => h.verdict === 'CANT').length} cannot fire on the same event (disjoint filter values), listed in cannotOverlap.`;
  if (unknownStatus) note += ` ${unknownStatus} hit(s) are labelled "status unknown, check it" (the row carried no status); they are listed among the hits, never dropped.`;
  if (draftHits.length) note += ` ${draftHits.length} draft(s) would overlap once published (listed in draftHits; a draft fires nothing now).`;
  return { ...base, complete: true, hits, publishedHits, draftHits, cannotOverlap, note };
}
