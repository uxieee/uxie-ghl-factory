// Pipeline edit planning for edit_pipeline — pure: no gateway, no catalogue. tools.mjs fetches the
// pipeline row, calls planPipelineEdit, and does the writes and the read-back.
//
// Every rule here is a measured behaviour of PUT /opportunities/pipelines/{pipelineId}
// (knowledge corpus pipelines-opportunities/20-api/pipelines.md, sandbox 2026-09-02 and 2026-09-25):
//   - the body is the GET row TRIMMED: id, position, dateAdded, dateUpdated, locationId are refused
//     at the top level, while each stage keeps its id and its 0-based integer position;
//   - `stages` is a FULL REPLACE: a stage with an id is updated in place, one without is created, and
//     one left out is DELETED — its cards silently move to the first stage, with no audit row;
//   - if ANY stage lacks stageWinProbability, EVERY supplied probability is discarded and the array is
//     rewritten as (i + 1) / (n + 1) * 100;
//   - stages must hold at least one element; names are 1–255 characters and unique case-insensitively
//     (the UI's rule);
//   - colorRenderMode is none | dot | bg-tint, stages[].color a #RRGGBB string;
//   - the top-level showInFunnel / showInPieChart are DERIVED: the UI sends each as "any stage has it on" on
//     every save, and the dashboards read only this pair (a false pair hides the pipeline from the Funnel and
//     Stage-distribution widgets). It is stored: one UI save turned a stale false/false into true/true (live
//     2026-09-29), so this module always recomputes it;
//   - a stage added in the UI starts with both charts on and colour #64748B.

export const COLOR_RENDER_MODES = ['none', 'dot', 'bg-tint'];
const TOP_LEVEL = ['name', 'showInFunnel', 'showInPieChart', 'useOpportunityProbability', 'colorRenderMode'];
const DERIVED = ['showInFunnel', 'showInPieChart'];
export const NEW_STAGE_COLOR = '#64748B';
const STAGE_PROPS = ['name', 'stageWinProbability', 'color', 'showInFunnel', 'showInPieChart'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

const trimName = (s) => (typeof s === 'string' ? s.trim() : s);

/**
 * Merge the caller's edit onto the pipeline row GET returned.
 * Returns { errors: string[] } or { body, diff, removed: [{id, name, moveCardsTo}], final: [stage] }.
 */
export function planPipelineEdit(row, edit = {}) {
  const errors = [];
  const current = Array.isArray(row?.stages) ? row.stages : [];
  const byId = new Map(current.map((s) => [s.id, s]));

  const update = edit.updateStages ?? [];
  const add = edit.addStages ?? [];
  const remove = edit.removeStages ?? [];

  for (const u of update) if (!byId.has(u?.id)) errors.push(`updateStages: no stage ${u?.id} on this pipeline`);
  for (const r of remove) if (!byId.has(r?.id)) errors.push(`removeStages: no stage ${r?.id} on this pipeline`);
  const removeIds = new Set(remove.map((r) => r?.id));
  for (const u of update) if (removeIds.has(u?.id)) errors.push(`stage ${u.id} is both updated and removed`);
  const dupe = (list) => list.map((x) => x?.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set([...dupe(update), ...dupe(remove)])) errors.push(`stage ${id} appears more than once in one list`);

  const kept = current.filter((s) => !removeIds.has(s.id));
  const keptIds = new Set(kept.map((s) => s.id));
  for (const r of remove) {
    if (r?.moveCardsTo !== undefined && !keptIds.has(r.moveCardsTo)) {
      errors.push(`removeStages ${r.id}: moveCardsTo must be an existing stage that is kept (got ${r.moveCardsTo})`);
    }
  }

  // Existing stages, with updates applied, in their current order.
  const updates = new Map(update.map((u) => [u.id, u]));
  let final = kept.map((s) => {
    const u = updates.get(s.id) ?? {};
    const out = { ...s };
    for (const k of STAGE_PROPS) if (u[k] !== undefined) out[k] = k === 'name' ? trimName(u[k]) : u[k];
    return out;
  });

  if (edit.stageOrder !== undefined) {
    const order = edit.stageOrder;
    const same = Array.isArray(order) && order.length === final.length && new Set(order).size === order.length
      && order.every((id) => keptIds.has(id));
    if (!same) errors.push('stageOrder must list every KEPT existing stage id exactly once (new stages are placed with afterStageId)');
    else final = order.map((id) => final.find((s) => s.id === id));
  }

  for (const a of add) {
    const stage = { name: trimName(a?.name), stageWinProbability: a?.stageWinProbability,
      showInFunnel: a?.showInFunnel ?? true, showInPieChart: a?.showInPieChart ?? true, color: a?.color ?? NEW_STAGE_COLOR };
    if (a?.afterStageId === undefined) { final.push(stage); continue; }
    const at = final.findIndex((s) => s.id === a.afterStageId);
    if (at < 0) { errors.push(`addStages "${stage.name}": afterStageId ${a.afterStageId} is not a kept stage`); continue; }
    final.splice(at + 1, 0, stage);
  }

  if (!final.length) errors.push('a pipeline must keep at least one stage');
  const seen = new Map();
  for (const s of final) {
    if (typeof s.name !== 'string' || s.name.length < 1 || s.name.length > 255) errors.push(`stage name must be 1–255 characters (got ${JSON.stringify(s.name)})`);
    const key = String(s.name).toLowerCase();
    if (seen.has(key)) errors.push(`two stages would be named "${s.name}" (names are unique, case-insensitively)`);
    seen.set(key, true);
    const p = s.stageWinProbability;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
      errors.push(`stage "${s.name}" needs stageWinProbability 0–100 — GHL rewrites EVERY stage's probability to an even ramp when one is missing`);
    }
    if (s.color !== undefined && !HEX.test(String(s.color))) errors.push(`stage "${s.name}": color must be #RRGGBB (got ${s.color})`);
  }

  for (const k of DERIVED) if (edit[k] !== undefined) {
    errors.push(`${k} at pipeline level is derived from the stages (true when any stage has it on, as the GHL UI sends it); set it per stage in updateStages / addStages instead`);
  }
  const top = {};
  for (const k of TOP_LEVEL) if (!DERIVED.includes(k) && row?.[k] !== undefined) top[k] = row[k];
  for (const k of TOP_LEVEL) if (!DERIVED.includes(k) && edit[k] !== undefined) top[k] = k === 'name' ? trimName(edit[k]) : edit[k];
  if (typeof top.name !== 'string' || !top.name || top.name.length > 255) errors.push('pipeline name must be 1–255 characters');
  if (top.colorRenderMode !== undefined && !COLOR_RENDER_MODES.includes(top.colorRenderMode)) {
    errors.push(`colorRenderMode must be one of ${COLOR_RENDER_MODES.join(', ')}`);
  }

  if (errors.length) return { errors };

  const stages = final.map((s, position) => {
    const out = { name: s.name, position, showInFunnel: s.showInFunnel ?? true, showInPieChart: s.showInPieChart ?? false,
      stageWinProbability: s.stageWinProbability };
    if (s.id) out.id = s.id;
    if (s.color !== undefined) out.color = s.color;
    return out;
  });
  const body = { ...top, showInFunnel: stages.some((s) => s.showInFunnel === true), showInPieChart: stages.some((s) => s.showInPieChart === true), stages };
  return { body, final: stages, removed: remove.map((r) => ({ id: r.id, name: byId.get(r.id)?.name, moveCardsTo: r.moveCardsTo })),
    diff: diffPipeline(row, body) };
}

/** What changes, in names beside ids. */
export function diffPipeline(row, body) {
  const top = [];
  for (const k of TOP_LEVEL) if (body[k] !== undefined && body[k] !== row?.[k]) top.push({ field: k, before: row?.[k] ?? null, after: body[k] });
  const before = new Map((row?.stages ?? []).map((s, i) => [s.id, { ...s, index: i }]));
  const after = new Set(body.stages.filter((s) => s.id).map((s) => s.id));
  const changed = [], added = [];
  body.stages.forEach((s, index) => {
    if (!s.id) { added.push({ name: s.name, position: index, stageWinProbability: s.stageWinProbability }); return; }
    const b = before.get(s.id);
    const fields = STAGE_PROPS.filter((k) => s[k] !== undefined && s[k] !== b[k]).map((k) => ({ field: k, before: b[k] ?? null, after: s[k] }));
    if (b.index !== index) fields.push({ field: 'order', before: b.index, after: index });
    if (fields.length) changed.push({ id: s.id, name: s.name, fields });
  });
  const removed = [...before.values()].filter((s) => !after.has(s.id)).map((s) => ({ id: s.id, name: s.name }));
  return { pipeline: top, stagesChanged: changed, stagesAdded: added, stagesRemoved: removed };
}

/** Compare the intended body with the row read back afterwards. Returns a list of mismatches. */
export function verifyPipeline(body, row) {
  const bad = [];
  if (!row) return ['the pipeline is missing from the list after the write'];
  for (const k of TOP_LEVEL) if (body[k] !== undefined && row[k] !== body[k]) bad.push(`${k}: sent ${JSON.stringify(body[k])}, read back ${JSON.stringify(row[k])}`);
  const got = row.stages ?? [];
  if (got.length !== body.stages.length) bad.push(`stage count: sent ${body.stages.length}, read back ${got.length}`);
  const sorted = [...got].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  body.stages.forEach((s, i) => {
    const r = s.id ? got.find((g) => g.id === s.id) : sorted[i];
    if (!r) { bad.push(`stage "${s.name}" (${s.id ?? 'new'}) is missing after the write`); return; }
    for (const k of STAGE_PROPS) if (s[k] !== undefined && r[k] !== s[k]) bad.push(`stage "${s.name}" ${k}: sent ${JSON.stringify(s[k])}, read back ${JSON.stringify(r[k])}`);
    if (s.id && sorted.indexOf(r) !== i) bad.push(`stage "${s.name}" is at index ${sorted.indexOf(r)}, sent at ${i}`);
  });
  return bad;
}

/**
 * Cards that reached the landing stage without being counted (T12, sweep 2026-09-29). The search index lags a write by
 * seconds, so a card created just before a stage is removed is invisible to every count; GHL then moves it to the
 * pipeline's first stage and nothing says so. After the write, a card in the landing stage that was NOT in the
 * pre-write snapshot of the whole pipeline, and that already existed when the write started, is exactly that card
 * (or one created in the landing stage in the same few seconds — the caller is told to check).
 */
export function strayArrivals({ snapshotIds, landingCards, writeStartedAt }) {
  const seen = new Set(snapshotIds);
  const t0 = Date.parse(writeStartedAt);
  return (landingCards ?? []).filter((c) => {
    if (!c?.id || seen.has(c.id)) return false;
    const added = Date.parse(c.dateAdded ?? c.createdAt ?? '');
    return !Number.isFinite(added) || !Number.isFinite(t0) || added <= t0;
  }).map((c) => ({ id: c.id, name: c.name, dateAdded: c.dateAdded ?? c.createdAt ?? null }));
}

/** Cards of a pipeline snapshot that sit in a stage being removed — GHL would move them to the first stage (T12). */
export function cardsInRemovedStages(rows, removedStageIds) {
  const gone = new Set(removedStageIds);
  return (rows ?? []).filter((c) => c && gone.has(c.pipelineStageId));
}
