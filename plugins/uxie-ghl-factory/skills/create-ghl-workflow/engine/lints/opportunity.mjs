// Does a STORED opportunity write express a real write? GHL stores anything and echoes it back,
// so sent-vs-stored comparison can never see a stage NAME, an empty row list, or a ghost id —
// each of which is a step that saves, renders half-empty, and moves nothing. Eight client
// workflows shipped with a live status row and a dead stage move while the build reported a
// clean round-trip (F5-09).
//
// Pure, never throws, and runs over READ-BACK templates, so the same predicate serves the build
// verify, the edit verify and check_workflow.
import { STANDARD_OPP_FIELDS, OPP_CUSTOM_FIELD_PREFIX, leakedOppNames } from '../opp-shapes.mjs';

const OPP_TYPES = new Set(['internal_update_opportunity', 'internal_create_opportunity']);
const ID_ROWS = new Set(['pipelineId', 'pipelineStageId', 'lostReasonId']);
const looksLikeId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(v) && !/\s/.test(v);
const isMergeTag = (v) => typeof v === 'string' && v.includes('{{');
// `leakedOppNames` (opp-shapes.mjs) owns what counts as a leak — the same predicate the
// edit-commit guard uses, so the lint and the guard can never again disagree about one shape.

// Does anything ON THE WRITE'S OWN PATH bind a card? A card write that relies on how the contact
// ENTERED works only through an opportunity trigger: enrolled any other way (an add_to_workflow
// from another workflow — the `.5` pattern makes these routine — or manual/API enrolment) the
// live engine either logs `skipped` with "Internal Action Error - Please use Opportunity
// trigger/find opportunity action to get the opportunity" or logs `success` with an empty
// meta.actionFrom and moves nothing (GROM sandbox, 2026-08-30). Either way silent. The IR-level
// OPP_UNASSOCIATED hard-fails only when there is NO association at all — a trigger-only
// association passes it, which is exactly this risky shape.
//
// GHL stores templates flat; execution order is recoverable by walking `parentKey` backwards
// (a step's parentKey is the previous node — a prior step, or the transition id for the first
// step under a branch; a transition's parentKey is its container; a container's parentKey is the
// step before it). The path is BOUND when the walk meets an internal_create_opportunity (the
// create binds the card it made) or the FOUND transition of a find_opportunity. Passing through
// the Not-Found transition binds nothing.
const FOUND_KEY = 'predefined_Opportunity Found';
const FOUND_NAME = 'Opportunity Found';
function pathBindsCard(t, byId) {
  const seen = new Set();
  let cur = t;
  while (cur && typeof cur.parentKey === 'string' && !seen.has(cur.parentKey)) {
    seen.add(cur.parentKey);
    const up = byId.get(cur.parentKey);
    if (!up) return false;
    if (up.type === 'internal_create_opportunity') return true;
    if (up.type === 'transition') {
      const container = byId.get(up.parent);
      if (container?.type === 'find_opportunity') {
        // The stable __branchKey__ lives on the CONTAINER's attributes.transitions[] row (the
        // flat transition node itself may carry only its name); both spellings exist live, so
        // accept the key on either node, or the name.
        const row = (container.attributes?.transitions ?? []).find?.((r) => r?.id === up.id);
        if (up.meta?.__branchKey__ === FOUND_KEY || row?.meta?.__branchKey__ === FOUND_KEY
            || up.name === FOUND_NAME || row?.name === FOUND_NAME) return true;
      }
    }
    cur = up;
  }
  return false;
}

export function lintOpportunityWrites(templates, { pipelines = null, lostReasons = null } = {}) {
  const out = [];
  const byId = new Map();
  for (const t of templates ?? []) if (t && typeof t.id === 'string') byId.set(t.id, t);
  const known = pipelines && {
    pipelineId: new Set(pipelines.map((p) => p.id)),
    pipelineStageId: new Set(pipelines.flatMap((p) => (p.stages ?? []).map((s) => s.id))),
    lostReasonId: lostReasons ? new Set(lostReasons.map((r) => r.id ?? r._id)) : null,
  };
  for (const t of templates ?? []) {
    if (!t || !OPP_TYPES.has(t.type)) continue;
    const a = t.attributes ?? {};
    const push = (code, severity, msg) => out.push({ stepId: t.id, name: t.name ?? t.id, type: t.type, code, severity, msg });

    // A create needs no bound card — it makes one. Only the UPDATE relies on a binding.
    if (t.type === 'internal_update_opportunity' && !pathBindsCard(t, byId)) {
      push('OPP_WRITE_UNBOUND_PATH', 'warning',
        `'${t.name ?? t.id}' writes to a card but nothing on its path binds one — it works only when `
        + 'the run entered through an opportunity trigger; an add_to_workflow from another workflow '
        + 'or a manual/API enrolment SKIPS it silently (or logs success with an empty actionFrom and '
        + 'moves nothing). Use the pattern: find_opportunity → Not Found: create_opportunity → '
        + 'Found: update_opportunity.');
    }

    const leaked = leakedOppNames(a);
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

    let hasStage = false;
    // create_opportunity carries the pipeline as a TOP-LEVEL attribute and never as a row — the
    // compiler enforces that pairing itself, and the picker rulebook calls the asymmetry
    // deliberate. Reading only the rows therefore flags every correctly-built create step.
    // update_opportunity is the opposite: there the pipeline belongs in a row, so the rule keeps
    // its teeth and this exemption must not reach it.
    let hasPipe = t.type === 'internal_create_opportunity'
      && (looksLikeId(a.pipelineId) || isMergeTag(a.pipelineId));
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      if (r.filterField === 'pipelineStageId') hasStage = true;
      if (r.filterField === 'pipelineId') hasPipe = true;
      if (typeof r.filterField === 'string'
          && !r.filterField.startsWith(OPP_CUSTOM_FIELD_PREFIX)
          && !STANDARD_OPP_FIELDS.has(r.filterField)
          && looksLikeId(r.filterField)) {
        push('OPP_CUSTOM_FIELD_BARE_ID', 'error',
          `row addresses custom field '${r.filterField}' by its bare id — the opportunities DTO `
          + `rejects that as a top-level property ("property ${r.filterField} should not exist") `
          + `and the step SKIPS with a 400 nobody reads. Write it as `
          + `'${OPP_CUSTOM_FIELD_PREFIX}${r.filterField}'; only STANDARD properties take a bare name.`);
      }
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
