// Does a STORED opportunity write express a real write? GHL stores anything and echoes it back,
// so sent-vs-stored comparison can never see a stage NAME, an empty row list, or a ghost id —
// each of which is a step that saves, renders half-empty, and moves nothing. Eight client
// workflows shipped with a live status row and a dead stage move while the build reported a
// clean round-trip (F5-09).
//
// Pure, never throws, and runs over READ-BACK templates, so the same predicate serves the build
// verify, the edit verify and check_workflow.
const OPP_TYPES = new Set(['internal_update_opportunity', 'internal_create_opportunity']);
const ID_ROWS = new Set(['pipelineId', 'pipelineStageId', 'lostReasonId']);
const NAME_KEYS = ['pipeline', 'stage', 'lostReason'];
const looksLikeId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(v) && !/\s/.test(v);
const isMergeTag = (v) => typeof v === 'string' && v.includes('{{');

export function lintOpportunityWrites(templates, { pipelines = null, lostReasons = null } = {}) {
  const out = [];
  const known = pipelines && {
    pipelineId: new Set(pipelines.map((p) => p.id)),
    pipelineStageId: new Set(pipelines.flatMap((p) => (p.stages ?? []).map((s) => s.id))),
    lostReasonId: lostReasons ? new Set(lostReasons.map((r) => r.id ?? r._id)) : null,
  };
  for (const t of templates ?? []) {
    if (!t || !OPP_TYPES.has(t.type)) continue;
    const a = t.attributes ?? {};
    const push = (code, severity, msg) => out.push({ stepId: t.id, name: t.name ?? t.id, type: t.type, code, severity, msg });

    const leaked = NAME_KEYS.filter((k) => a[k] !== undefined);
    if (leaked.length) {
      push('OPP_NAME_KEY', 'error',
        `carries name key(s) [${leaked.join(', ')}] at the top level — GHL stores the word and the `
        + 'write moves nothing; the value belongs in an id-bearing __customInputFields__ row');
    }

    const rows = Array.isArray(a.__customInputFields__) ? a.__customInputFields__ : [];
    if (!rows.length) {
      push('OPP_NO_ROWS', 'error',
        '__customInputFields__ is missing or empty — the step saves, round-trips clean, and no-ops at runtime');
      continue;
    }

    let hasStage = false, hasPipe = false;
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      if (r.filterField === 'pipelineStageId') hasStage = true;
      if (r.filterField === 'pipelineId') hasPipe = true;
      if (!ID_ROWS.has(r.filterField)) continue;
      // A merge tag resolves at runtime, so it cannot be judged here.
      if (isMergeTag(r.value)) continue;
      if (!looksLikeId(r.value)) {
        push('OPP_ROW_NOT_ID', 'error',
          `row '${r.filterField}' carries '${r.value}' — not an id; a NAME here saves clean and moves nothing`);
        continue;
      }
      const list = known?.[r.filterField];
      if (list && !list.has(r.value)) {
        push('OPP_UNKNOWN_ID', 'warning',
          `row '${r.filterField}' id '${r.value}' matches nothing in this account's `
          + `${r.filterField === 'lostReasonId' ? 'lost reasons' : 'pipelines'}`);
      }
    }
    if (hasStage && !hasPipe) {
      push('OPP_STAGE_NO_PIPELINE_ROW', 'error',
        'a pipelineStageId row without a pipelineId row renders the step DISABLED in the builder and it never runs');
    }
  }
  return out;
}
