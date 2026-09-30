import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPipelineEdit, verifyPipeline, strayArrivals, cardsInRemovedStages, isReadBackLag, readBackWithBackoff, readBaseWithBackoff, READBACK_DELAYS_MS, RECENT_WRITE_MS } from '../core/pipelines.mjs';

// The GET row shape, trimmed to what matters (sandbox capture 2026-09-28).
const row = () => ({
  id: 'P', name: 'Sales', locationId: 'LOC', position: 'a4C0TZl', dateAdded: 'x', dateUpdated: 'y',
  showInFunnel: true, showInPieChart: true, useOpportunityProbability: false, colorRenderMode: 'dot', // as a UI save leaves it
  stages: [
    { id: 's1', name: 'New', position: 0, showInFunnel: true, showInPieChart: false, stageWinProbability: 10, color: '#155EEF' },
    { id: 's2', name: 'Qualified', position: 1, showInFunnel: true, showInPieChart: true, stageWinProbability: 40, color: '#039855' },
    { id: 's3', name: 'Closing', position: 3, showInFunnel: false, showInPieChart: false, stageWinProbability: 90 },
  ],
});

test('the body strips the five refused top-level keys and keeps every stage id and a 0-based position', () => {
  const plan = planPipelineEdit(row(), { name: 'Sales 2' });
  assert.equal(plan.errors, undefined);
  for (const k of ['id', 'position', 'dateAdded', 'dateUpdated', 'locationId']) assert.equal(k in plan.body, false, k);
  assert.deepEqual(plan.body.stages.map((s) => [s.id, s.position]), [['s1', 0], ['s2', 1], ['s3', 2]]);
  assert.equal(plan.body.colorRenderMode, 'dot');
  assert.deepEqual(plan.diff.pipeline, [{ field: 'name', before: 'Sales', after: 'Sales 2' }]);
});

test('CONTROL: an empty edit sends the pipeline back unchanged and reports no change', () => {
  const plan = planPipelineEdit(row(), {});
  assert.deepEqual(plan.diff, { pipeline: [], stagesChanged: [], stagesAdded: [], stagesRemoved: [] });
  assert.equal(plan.body.stages.length, 3);
});

test('a new stage without a probability is refused — one missing probability rewrites them all', () => {
  const plan = planPipelineEdit(row(), { addStages: [{ name: 'Won-ish' }] });
  assert.match(plan.errors.join(' '), /stageWinProbability/);
  const okPlan = planPipelineEdit(row(), { addStages: [{ name: 'Won-ish', stageWinProbability: 95, afterStageId: 's2' }] });
  assert.deepEqual(okPlan.body.stages.map((s) => s.name), ['New', 'Qualified', 'Won-ish', 'Closing']);
  assert.equal(okPlan.body.stages[2].id, undefined);
});

test('an existing stage with no stored probability is refused unless the edit supplies one', () => {
  const r = row(); delete r.stages[2].stageWinProbability;
  assert.match(planPipelineEdit(r, {}).errors.join(' '), /Closing.*stageWinProbability/);
  assert.equal(planPipelineEdit(r, { updateStages: [{ id: 's3', stageWinProbability: 80 }] }).errors, undefined);
});

test('removing a stage lists it; moveCardsTo must name a KEPT stage', () => {
  const plan = planPipelineEdit(row(), { removeStages: [{ id: 's3', moveCardsTo: 's1' }] });
  assert.deepEqual(plan.removed, [{ id: 's3', name: 'Closing', moveCardsTo: 's1' }]);
  assert.deepEqual(plan.diff.stagesRemoved, [{ id: 's3', name: 'Closing' }]);
  assert.match(planPipelineEdit(row(), { removeStages: [{ id: 's3', moveCardsTo: 's3' }] }).errors.join(' '), /moveCardsTo/);
  assert.match(planPipelineEdit(row(), { removeStages: [{ id: 'nope' }] }).errors.join(' '), /no stage nope/);
});

test('the last stage cannot be removed, and duplicate names are refused case-insensitively', () => {
  assert.match(planPipelineEdit(row(), { removeStages: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }).errors.join(' '), /at least one stage/);
  assert.match(planPipelineEdit(row(), { updateStages: [{ id: 's2', name: 'new' }] }).errors.join(' '), /named "new"/);
});

test('stageOrder must list every kept stage exactly once', () => {
  const plan = planPipelineEdit(row(), { stageOrder: ['s3', 's1', 's2'] });
  assert.deepEqual(plan.body.stages.map((s) => [s.id, s.position]), [['s3', 0], ['s1', 1], ['s2', 2]]);
  assert.match(planPipelineEdit(row(), { stageOrder: ['s3', 's1'] }).errors.join(' '), /stageOrder/);
});

test('colorRenderMode and stage colour are validated', () => {
  assert.match(planPipelineEdit(row(), { colorRenderMode: 'rainbow' }).errors.join(' '), /colorRenderMode/);
  assert.match(planPipelineEdit(row(), { updateStages: [{ id: 's1', color: 'blue' }] }).errors.join(' '), /#RRGGBB/);
  assert.equal(planPipelineEdit(row(), { colorRenderMode: 'bg-tint', updateStages: [{ id: 's1', color: '#000000' }] }).errors, undefined);
});

test('verifyPipeline passes an exact read-back and names every mismatch', () => {
  const plan = planPipelineEdit(row(), { name: 'Sales 2', addStages: [{ name: 'Extra', stageWinProbability: 50 }] });
  const back = { ...row(), name: 'Sales 2', stages: [...plan.body.stages.slice(0, 3), { ...plan.body.stages[3], id: 'new1' }] };
  assert.deepEqual(verifyPipeline(plan.body, back), []);
  const wrong = { ...back, stages: back.stages.map((s) => ({ ...s, stageWinProbability: 25 })) };
  assert.ok(verifyPipeline(plan.body, wrong).some((m) => /stageWinProbability/.test(m)));
  assert.deepEqual(verifyPipeline(plan.body, null), ['the pipeline is missing from the list after the write']);
});

// Sweep 2026-09-29 / live 2026-09-29: the UI derives the pipeline-level pair as OR over the stages on every save, and
// the dashboards read only that pair. A pipeline left false/false with stages on is invisible to the Funnel widget.
test('the pipeline-level showInFunnel/showInPieChart are recomputed from the stages, not copied from the row', () => {
  const stale = { ...row(), showInFunnel: false, showInPieChart: false }; // a script copied the old pair (P1-dup, live)
  const plan = planPipelineEdit(stale, {});
  assert.equal(plan.body.showInFunnel, true);
  assert.equal(plan.body.showInPieChart, true);
  // CONTROL: every stage off → the pair is false, exactly as the UI would send
  const off = planPipelineEdit(row(), { updateStages: ['s1', 's2', 's3'].map((id) => ({ id, showInFunnel: false, showInPieChart: false })) });
  assert.equal(off.body.showInFunnel, false);
  assert.equal(off.body.showInPieChart, false);
  // and the stale pair shows up in the diff, so a preview says it will change
  assert.deepEqual(plan.diff.pipeline.map((d) => d.field).sort(), ['showInFunnel', 'showInPieChart']);
});

test('setting the pipeline-level pair directly is refused: it is derived from the stages', () => {
  assert.match(planPipelineEdit(row(), { showInFunnel: false }).errors.join(' '), /derived from the stages/);
  assert.match(planPipelineEdit(row(), { showInPieChart: true }).errors.join(' '), /derived from the stages/);
});

test('a new stage gets the UI defaults: both charts on and colour #64748B, unless the caller says otherwise', () => {
  const plan = planPipelineEdit(row(), { addStages: [{ name: 'Won-ish', stageWinProbability: 95 }] });
  const s = plan.body.stages.at(-1);
  assert.deepEqual([s.showInFunnel, s.showInPieChart, s.color], [true, true, '#64748B']);
  // CONTROL: explicit values win
  const own = planPipelineEdit(row(), { addStages: [{ name: 'Quiet', stageWinProbability: 5, showInPieChart: false, color: '#155EEF' }] });
  assert.deepEqual([own.body.stages.at(-1).showInPieChart, own.body.stages.at(-1).color], [false, '#155EEF']);
});

test('strayArrivals: a card the pre-write snapshot never saw, already existing at write time, is named (index-lag race, T12)', () => {
  const writeStartedAt = '2026-09-29T05:00:10.000Z';
  const landing = [
    { id: 'old', name: 'counted before', dateAdded: '2026-09-01T00:00:00Z' },
    { id: 'lag', name: 'created seconds before', dateAdded: '2026-09-29T05:00:05.000Z' },
    { id: 'after', name: 'created after the write', dateAdded: '2026-09-29T05:00:20.000Z' },
  ];
  assert.deepEqual(strayArrivals({ snapshotIds: ['old'], landingCards: landing, writeStartedAt }),
    [{ id: 'lag', name: 'created seconds before', dateAdded: '2026-09-29T05:00:05.000Z' }]);
  // CONTROL: everything was in the snapshot → nothing to report.
  assert.deepEqual(strayArrivals({ snapshotIds: ['old', 'lag'], landingCards: landing.slice(0, 2), writeStartedAt }), []);
  // No timestamp at all → reported (fail loud, not silent).
  assert.equal(strayArrivals({ snapshotIds: [], landingCards: [{ id: 'x', name: 'no date' }], writeStartedAt }).length, 1);
});

test('cardsInRemovedStages: the last snapshot stops the edit when a card reached a stage being removed (live miss 2026-09-29)', () => {
  const rows = [{ id: 'a', pipelineStageId: 'L1' }, { id: 'late', pipelineStageId: 'L2' }];
  assert.deepEqual(cardsInRemovedStages(rows, new Set(['L2'])).map((c) => c.id), ['late']);
  // CONTROL: no card in a removed stage.
  assert.deepEqual(cardsInRemovedStages(rows, ['L3']), []);
});

// ── read-back lag: the pipeline list can trail a PUT (a real edit answered "sent 8, read back 7" though the write had landed)
const lagBody = { name: 'P', stages: [{ id: 'a', name: 'A', position: 0 }, { id: 'b', name: 'B', position: 1 }, { name: 'C', position: 2 }] };
const stored = (n) => ({ name: 'P', stages: [{ id: 'a', name: 'A', position: 0 }, { id: 'b', name: 'B', position: 1 }, { id: 'c', name: 'C', position: 2 }].slice(0, n) });
const noSleep = async () => {};

test('a short read-back is a lag, but only when nothing else is wrong', () => {
  assert.equal(isReadBackLag(lagBody, stored(2), verifyPipeline(lagBody, stored(2))), true);
  // CONTROL: a wrong name on a short read is a real mismatch
  const wrong = { ...stored(2), name: 'Q' };
  assert.equal(isReadBackLag(lagBody, wrong, verifyPipeline(lagBody, wrong)), false);
  // CONTROL: a wrong probability on a stored stage is a real mismatch even when short
  const body = { ...lagBody, stages: lagBody.stages.map((x, i) => (i === 0 ? { ...x, stageWinProbability: 50 } : x)) };
  const st = stored(2); st.stages[0].stageWinProbability = 10;
  assert.equal(isReadBackLag(body, st, verifyPipeline(body, st)), false);
  // CONTROL: the right count is never a lag; MORE stages than sent is never a lag
  assert.equal(isReadBackLag(lagBody, stored(3), []), false);
  const extra = { name: 'P', stages: [...stored(3).stages, { id: 'z', name: 'Z', position: 3 }] };
  assert.equal(isReadBackLag(lagBody, extra, verifyPipeline(lagBody, extra)), false);
  assert.equal(isReadBackLag(lagBody, null, ['the pipeline is missing from the list after the write']), false);
});

test('readBackWithBackoff: a read that catches up on the 3rd try verifies', async () => {
  const sizes = [2, 2, 3]; let i = 0; const slept = [];
  const r = await readBackWithBackoff({ read: async () => ({ row: stored(sizes[Math.min(i++, 2)]) }), body: lagBody, sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(r.mismatches, []); assert.equal(r.lag, false); assert.equal(r.attempts, 3); assert.deepEqual(slept, [500, 1000]);
});

test('readBackWithBackoff: an exact first read is one attempt and no waiting', async () => {
  const slept = []; let n = 0;
  const r = await readBackWithBackoff({ read: async () => { n++; return { row: stored(3) }; }, body: lagBody, sleep: async (ms) => slept.push(ms) });
  assert.equal(n, 1); assert.equal(r.attempts, 1); assert.equal(r.lag, false); assert.deepEqual(slept, []);
});

test('readBackWithBackoff: still short after every try is a lag (not a failure), bounded to ~3 s', async () => {
  let n = 0; const slept = [];
  const r = await readBackWithBackoff({ read: async () => { n++; return { row: stored(2) }; }, body: lagBody, sleep: async (ms) => slept.push(ms) });
  assert.equal(r.lag, true); assert.equal(n, READBACK_DELAYS_MS.length); assert.ok(slept.reduce((a, b) => a + b, 0) <= 3000);
});

test('readBackWithBackoff CONTROL: a real mismatch is returned at once, with no re-reads', async () => {
  let n = 0; const wrong = { ...stored(3), name: 'Q' };
  const r = await readBackWithBackoff({ read: async () => { n++; return { row: wrong }; }, body: lagBody, sleep: noSleep });
  assert.equal(n, 1); assert.equal(r.lag, false); assert.ok(r.mismatches.some((m) => /^name:/.test(m)));
});

test('readBackWithBackoff passes a read failure straight back', async () => {
  const r = await readBackWithBackoff({ read: async () => ({ failure: { ok: false, code: 'X' } }), body: lagBody, sleep: noSleep });
  assert.deepEqual(r.failure, { ok: false, code: 'X' });
});

test('readBaseWithBackoff: a list that trails the last edit is re-read; a stale base is reported, not planned from', async () => {
  const lastWrite = { count: 3, at: 1000 }; const slept = [];
  let i = 0; const sizes = [2, 2, 3];
  const ok = await readBaseWithBackoff({ read: async () => ({ row: stored(sizes[Math.min(i++, 2)]) }), lastWrite, now: 1500, sleep: async (ms) => slept.push(ms) });
  assert.equal(ok.stale, false); assert.equal(ok.attempts, 3);
  const stale = await readBaseWithBackoff({ read: async () => ({ row: stored(2) }), lastWrite, now: 1500, sleep: noSleep });
  assert.equal(stale.stale, true); assert.equal(stale.attempts, READBACK_DELAYS_MS.length);
});

test('readBaseWithBackoff CONTROLS: no recent write, an old write, or a list that is not short costs no extra reads', async () => {
  for (const [lastWrite, now, n] of [[undefined, 5000, 2], [{ count: 3, at: 0 }, RECENT_WRITE_MS + 1, 2], [{ count: 3, at: 1000 }, 1500, 3], [{ count: 3, at: 1000 }, 1500, 5]]) {
    let reads = 0; const r = await readBaseWithBackoff({ read: async () => { reads++; return { row: stored(Math.min(n, 3)) }; }, lastWrite, now, sleep: noSleep });
    assert.equal(r.stale, false); assert.equal(reads, 1);
  }
  const f = await readBaseWithBackoff({ read: async () => ({ failure: { ok: false } }), lastWrite: { count: 3, at: 1 }, now: 2, sleep: noSleep });
  assert.deepEqual(f.failure, { ok: false });
});

// ── removals: a stale list still SHOWS the removed stage; an edit built from it would put the stage back
const S4 = [{ id: 'a', name: 'A', position: 0 }, { id: 'b', name: 'B', position: 1 }, { id: 'c', name: 'C', position: 2 }, { id: 'd', name: 'D', position: 3 }];
const rmBody = { name: 'P', stages: [S4[0], { ...S4[2], position: 1 }, { ...S4[3], position: 2 }] };   // sent after removing b
const fourRow = { name: 'P', stages: S4 };                                                              // the stale read
const threeRow = { name: 'P', stages: rmBody.stages };                                                  // the caught-up read

test('a removal read-back that still lists the removed stage is a lag; controls stay real mismatches', () => {
  assert.equal(isReadBackLag(rmBody, fourRow, verifyPipeline(rmBody, fourRow), ['b']), true);
  // CONTROL: the same stale read with no removal known is a real mismatch (extra stage nobody removed).
  assert.equal(isReadBackLag(rmBody, fourRow, verifyPipeline(rmBody, fourRow), []), false);
  // CONTROL: an extra stage that is NOT the removed one.
  assert.equal(isReadBackLag(rmBody, fourRow, verifyPipeline(rmBody, fourRow), ['zzz']), false);
  // CONTROL: removed stage still listed AND a wrong name elsewhere.
  const renamed = { name: 'P', stages: S4.map((s) => (s.id === 'c' ? { ...s, name: 'WRONG' } : s)) };
  assert.equal(isReadBackLag(rmBody, renamed, verifyPipeline(rmBody, renamed), ['b']), false);
  // CONTROL: exactly what was sent verifies clean.
  assert.deepEqual(verifyPipeline(rmBody, threeRow), []);
});

test('readBackWithBackoff: a removal read-back catches up; without the removed ids it fails at once', async () => {
  let i = 0; const rows = [fourRow, fourRow, threeRow];
  const r = await readBackWithBackoff({ read: async () => ({ row: rows[Math.min(i++, 2)] }), body: rmBody, removedIds: ['b'], sleep: noSleep });
  assert.deepEqual(r.mismatches, []); assert.equal(r.attempts, 3); assert.equal(r.lag, false);
  const still = await readBackWithBackoff({ read: async () => ({ row: fourRow }), body: rmBody, removedIds: ['b'], sleep: noSleep });
  assert.equal(still.lag, true); assert.equal(still.attempts, READBACK_DELAYS_MS.length);
  let reads = 0;
  const control = await readBackWithBackoff({ read: async () => { reads++; return { row: fourRow }; }, body: rmBody, sleep: noSleep });
  assert.equal(control.lag, false); assert.equal(reads, 1); assert.ok(control.mismatches.length);
});

test('readBaseWithBackoff: a list that still shows a just-removed stage is stale (would resurrect it); controls read once', async () => {
  const lastWrite = { count: 3, at: 1000, removedIds: ['b'] };
  let i = 0;
  const ok = await readBaseWithBackoff({ read: async () => ({ row: [fourRow, threeRow][Math.min(i++, 1)] }), lastWrite, now: 1500, sleep: noSleep });
  assert.equal(ok.stale, false); assert.equal(ok.attempts, 2);
  const stale = await readBaseWithBackoff({ read: async () => ({ row: fourRow }), lastWrite, now: 1500, sleep: noSleep });
  assert.equal(stale.stale, true);
  // CONTROLS: caught-up list, an old write, and a write that removed nothing — one read each.
  for (const [lw, now, row] of [[lastWrite, 1500, threeRow], [lastWrite, RECENT_WRITE_MS + 2000, fourRow], [{ count: 3, at: 1000, removedIds: [] }, 1500, fourRow]]) {
    let reads = 0; const r = await readBaseWithBackoff({ read: async () => { reads++; return { row }; }, lastWrite: lw, now, sleep: noSleep });
    assert.equal(r.stale, false); assert.equal(reads, 1);
  }
});
