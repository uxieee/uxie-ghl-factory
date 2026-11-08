// w6d-9 (4): the trigger-overlap check, reused from the G3 roster. Pure: it takes the find_workflows_using result and says which published
// workflows listen to the same trigger types. Every result carries the label "may also fire: trigger filters not evaluated", because the
// read does not evaluate a trigger's filters, so an overlap is a candidate, not a collision. RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerOverlap, OVERLAP_LABEL } from './trigger-overlap.mjs';

const found = (workflows, extra = {}) => ({ countIs: 'workflows containing at least one of these types', count: workflows?.length ?? null,
  searched: ['contact_tag'], duplicatesDropped: 0, complete: true, workflows, ...extra });
const row = (id, name, status) => ({ id, name, status, paused: false, folderId: null });

test('the label is exact and every result carries it (the filters are compared statically, no event is simulated)', () => {
  assert.equal(OVERLAP_LABEL, 'might also fire: trigger filters compared statically, no event simulated');
  assert.equal(triggerOverlap({ types: ['contact_tag'], found: found([]) }).label, OVERLAP_LABEL);
  assert.equal(triggerOverlap({ types: ['contact_tag'], found: found([row('a', 'A', 'published')]) }).label, OVERLAP_LABEL);
});

test('published workflows are the overlaps that matter; each hit carries its name, status and the trigger types it was searched for; a draft is listed apart', () => {
  const out = triggerOverlap({ types: ['contact_tag'], found: found([row('p1', 'Live nurture', 'published'), row('d1', 'Draft idea', 'draft')]) });
  assert.equal(out.complete, true);
  assert.deepEqual(out.publishedHits.map((h) => h.id), ['p1']);
  assert.deepEqual(out.hits.map((h) => [h.id, h.name, h.status]), [['p1', 'Live nurture', 'published']]);
  assert.deepEqual(out.draftHits.map((h) => [h.id, h.name, h.status]), [['d1', 'Draft idea', 'draft']]);
  assert.deepEqual(out.hits[0].triggerTypes, ['contact_tag']);
});

test('the excluded id (the draft being designed) never counts as an overlap with itself', () => {
  const out = triggerOverlap({ types: ['contact_tag'], found: found([row('self', 'This draft', 'draft'), row('p1', 'Live', 'published')]), excludeId: 'self' });
  assert.deepEqual(out.hits.map((h) => h.id), ['p1']);
});

test('an incomplete read is NOT a clear answer: complete is false, no hits are reported, and the note says why', () => {
  const out = triggerOverlap({ types: ['contact_tag'], found: found(null, { complete: false, count: 40, workflows: null }) });
  assert.equal(out.complete, false);
  assert.deepEqual(out.hits, []);
  assert.deepEqual(out.publishedHits, []);
  assert.match(out.note, /incomplete/i);
  assert.equal(out.label, OVERLAP_LABEL, 'the label stays on an incomplete read too');
});

test('no types means no overlap question: the check refuses to answer rather than matching everything', () => {
  const out = triggerOverlap({ types: [], found: found([row('p1', 'Live', 'published')]) });
  assert.equal(out.complete, false);
  assert.deepEqual(out.hits, []);
  assert.match(out.note, /no trigger types/i);
});

// w6d-9 r2 (QA): the completeness guard must be pinned by a PARTIAL read that still carries a published row. Without `complete !== true` in the
// module, this read would come back complete:true with the published row reported as an overlap, a clear answer from a read that did not finish.
test('a PARTIAL read (complete:false) with a published row is NOT a clear answer: no hits, incomplete note, no published overlap reported', () => {
  const partial = { countIs: 'workflows containing at least one of these types', count: 40, searched: ['contact_tag'], duplicatesDropped: 0,
    complete: false, workflows: [row('p1', 'Live nurture', 'published')] };
  const out = triggerOverlap({ types: ['contact_tag'], found: partial });
  assert.equal(out.complete, false, 'a read that did not finish is not complete');
  assert.deepEqual(out.hits, [], 'a partial read reports no hits, not the rows it happened to return');
  assert.deepEqual(out.publishedHits, [], 'no published overlap may be reported from a partial read');
  assert.match(out.note, /incomplete/i);
});

// wf-4: filter-aware static comparison. Real filter rows, as the corpus and the AB-1 readback store them (conditions[] rows):
//   contact_tag      {field:'tagsAdded', operator:'index-of-true', value:'<tag>'}           (readback-ab-1-draft.json; 30-types/triggers/contact_tag.md)
//   form_submission  {field:'form.id', operator:'is-any-of', value:['<form id>']}            (catalog/trigger-examples/form_submission.json)
//   pipeline_stage_updated {field:'opportunity.pipelineId', operator:'==', value:'<id>'}      (catalog/trigger-examples/pipeline_stage_updated.json)
//   opportunity_created    {field:'opportunity.pipelineStageId', operator:'==', value:'<id>'} (catalog/trigger-examples/opportunity_created.json)
// Verdicts per workflow: WILL (same trigger type, no filters or identical filters: both fire on the same event), CANT (a shared field
// with disjoint values: the two cannot both match one event), MIGHT (anything else, including filters that could not be read).
const tagRow = (v, field = 'tagsAdded') => ({ field, operator: 'index-of-true', value: v, title: 'Tag added', type: 'select' });
const formRow = (ids) => ({ field: 'form.id', operator: 'is-any-of', value: ids, title: 'Form is', type: 'string' });
const pipeRow = (id) => ({ field: 'opportunity.pipelineId', operator: '==', value: id, title: 'In pipeline', type: 'select' });
const stageRow = (id) => ({ field: 'opportunity.pipelineStageId', operator: '==', value: id, title: 'Pipeline stage', type: 'select' });
const withTriggers = (w, triggers) => ({ ...w, triggers });
const one = (out) => out.hits[0];

test('WILL: same trigger type, same tag filter (case-insensitive: tags are stored lower case)', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('VIP')] }],
    found: found([withTriggers(row('p1', 'Live', 'published'), [{ type: 'contact_tag', conditions: [tagRow('vip')] }])]) });
  assert.equal(one(out).verdict, 'WILL');
  assert.match(out.note, /will also fire/i);
});

test('WILL: a draft with no filters and a workflow with no filters are the same trigger', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [] }],
    found: found([withTriggers(row('p1', 'Live', 'published'), [{ type: 'contact_tag', conditions: [] }])]) });
  assert.equal(one(out).verdict, 'WILL');
});

test('tag = VIP vs tag = Lead on tagsAdded is MIGHT, a hit, never CANT (the ruling: a tag list is multi-valued, one add can carry both)', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('VIP')] }],
    found: found([withTriggers(row('p1', 'Lead nurture', 'published'), [{ type: 'contact_tag', conditions: [tagRow('Lead')] }])]) });
  assert.deepEqual(out.cannotOverlap, []);
  assert.deepEqual(out.hits.map((h) => h.id), ['p1']);
  assert.equal(out.hits[0].verdict, 'MIGHT');
});

test('MIGHT: a draft with no filter against a workflow that filters on one tag (the filtered one fires on a subset)', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [] }],
    found: found([withTriggers(row('p1', 'VIP only', 'published'), [{ type: 'contact_tag', conditions: [tagRow('vip')] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
  assert.match(out.note, /might also fire/i);
});

test('MIGHT: different filter fields (a tag on one side, a form on the other) cannot be compared, so they might both fire', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([withTriggers(row('p1', 'Form-gated', 'published'), [{ type: 'contact_tag', conditions: [formRow(['f1'])] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
});

test('MIGHT: the same tag plus an extra row on one side is not identical, and no shared field is disjoint', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([withTriggers(row('p1', 'VIP + form', 'published'), [{ type: 'contact_tag', conditions: [tagRow('vip'), formRow(['f1'])] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
});

test('CAN\'T: form.id is-any-of with disjoint form ids (different forms)', () => {
  const out = triggerOverlap({ types: ['form_submission'], draftTriggers: [{ type: 'form_submission', conditions: [formRow(['form-A'])] }],
    found: found([withTriggers(row('p1', 'Form B flow', 'published'), [{ type: 'form_submission', conditions: [formRow(['form-B'])] }])]) });
  assert.equal(out.cannotOverlap[0].verdict, 'CANT');
});

test('WILL: the same form list, in any order, is identical', () => {
  const out = triggerOverlap({ types: ['form_submission'], draftTriggers: [{ type: 'form_submission', conditions: [formRow(['a', 'b'])] }],
    found: found([withTriggers(row('p1', 'Same forms', 'published'), [{ type: 'form_submission', conditions: [formRow(['b', 'a'])] }])]) });
  assert.equal(one(out).verdict, 'WILL');
});

test('CAN\'T: pipeline_stage_updated on two different pipelines', () => {
  const out = triggerOverlap({ types: ['pipeline_stage_updated'], draftTriggers: [{ type: 'pipeline_stage_updated', conditions: [pipeRow('pipe-1')] }],
    found: found([withTriggers(row('p1', 'Pipe 2', 'published'), [{ type: 'pipeline_stage_updated', conditions: [pipeRow('pipe-2')] }])]) });
  assert.equal(out.cannotOverlap[0].verdict, 'CANT');
});

test('CAN\'T: opportunity_created on the same pipeline but different stages (one shared field is enough to rule the overlap out)', () => {
  const out = triggerOverlap({ types: ['opportunity_created'],
    draftTriggers: [{ type: 'opportunity_created', conditions: [pipeRow('pipe-1'), stageRow('stage-a')] }],
    found: found([withTriggers(row('p1', 'Stage B', 'published'), [{ type: 'opportunity_created', conditions: [pipeRow('pipe-1'), stageRow('stage-b')] }])]) });
  assert.equal(out.cannotOverlap[0].verdict, 'CANT');
});

test('MIGHT: the draft\'s filters are unknown (not passed), so they cannot be compared', () => {
  const out = triggerOverlap({ types: ['contact_tag'], found: found([withTriggers(row('p1', 'Live', 'published'), [{ type: 'contact_tag', conditions: [tagRow('vip')] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
});

test('MIGHT: a workflow whose trigger filters were not read is a might, with a reason, never a clear answer', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([row('p1', 'Unread', 'published')]) });
  assert.equal(one(out).verdict, 'MIGHT');
  assert.match(one(out).reason, /not read/i);
});

test('MIGHT: a different trigger type that the find matched (contact_changed next to contact_tag) might fire on the same event', () => {
  const out = triggerOverlap({ types: ['contact_tag', 'contact_changed'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([withTriggers(row('p1', 'Changed', 'published'), [{ type: 'contact_changed', conditions: [] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
});

test('a workflow with no trigger of the searched types (the find matched a step) is not an overlap at all', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [] }],
    found: found([withTriggers(row('p1', 'Step only', 'published'), [{ type: 'form_submission', conditions: [] }])]) });
  assert.deepEqual(out.hits, []);
  assert.equal(out.cannotOverlap[0].verdict, 'NONE');
});

test('a workflow with several triggers is the strongest verdict across its pairs (one WILL is a WILL)', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([withTriggers(row('p1', 'Two', 'published'), [{ type: 'contact_tag', conditions: [tagRow('lead')] }, { type: 'contact_tag', conditions: [tagRow('VIP')] }])]) });
  assert.equal(one(out).verdict, 'WILL');
});

test('the note says what each list means: will and might are overlaps, can\'t is listed apart', () => {
  const out = triggerOverlap({ types: ['pipeline_stage_updated'], draftTriggers: [{ type: 'pipeline_stage_updated', conditions: [pipeRow('pipe-1')] }],
    found: found([withTriggers(row('p1', 'Pipe 2', 'published'), [{ type: 'pipeline_stage_updated', conditions: [pipeRow('pipe-2')] }]),
      withTriggers(row('p2', 'Any', 'published'), [{ type: 'pipeline_stage_updated', conditions: [] }])]) });
  assert.deepEqual(out.hits.map((h) => h.id), ['p2']);
  assert.deepEqual(out.cannotOverlap.map((h) => h.id), ['p1']);
  assert.match(out.note, /might also fire/i);
});

test('the CLI wrapper passes draftTriggers and each hit\'s triggers through to the verdicts', async () => {
  const { run } = await import('../scripts/trigger-overlap-cli.mjs');
  const out = run(JSON.stringify({ types: ['form_submission'], draftTriggers: [{ type: 'form_submission', conditions: [formRow(['form-A'])] }],
    found: found([withTriggers(row('p1', 'Form B', 'published'), [{ type: 'form_submission', conditions: [formRow(['form-B'])] }])]) }));
  assert.equal(out.cannotOverlap[0].verdict, 'CANT');
});

// wf-4 ruling (orchestrator + QA, 2026-11-08). CANT only for a field that holds ONE value per event, from an allowlist. Tags and every
// array or contains field are multi-valued in the event: one add of [VIP, Lead] matches both filters, so disjoint values there are MIGHT.
// A draft fires nothing, so a draft is never a WILL (it is listed apart as a draft hit).
test('TWO-TAG ADD: tagsAdded tag = VIP vs tag = Lead is MIGHT, not CANT (one add can carry both tags, so both filters match one event)', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('VIP')] }],
    found: found([withTriggers(row('p1', 'Lead nurture', 'published'), [{ type: 'contact_tag', conditions: [tagRow('Lead')] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
  assert.deepEqual(out.cannotOverlap, []);
});

test('TWO-TAG ADD: a contains-any tag row against a single tag is MIGHT (the multi-valued field never gives CANT)', () => {
  const contains = { field: 'tagsAdded', operator: 'contains-any', value: ['Lead', 'Nurture'], title: 'Tag added', type: 'multiselect' };
  const out = triggerOverlap({ types: ['contact_created'], draftTriggers: [{ type: 'contact_created', conditions: [tagRow('VIP')] }],
    found: found([withTriggers(row('p1', 'Contact created', 'published'), [{ type: 'contact_created', conditions: [contains] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
});

test('a field NOT on the single-valued allowlist is never CANT, even with disjoint == values (its cardinality is not known)', () => {
  const a = { field: 'contact.favorite_color', operator: '==', value: 'red', title: 'Color', type: 'select' };
  const b = { field: 'contact.favorite_color', operator: '==', value: 'blue', title: 'Color', type: 'select' };
  const out = triggerOverlap({ types: ['contact_changed'], draftTriggers: [{ type: 'contact_changed', conditions: [a] }],
    found: found([withTriggers(row('p1', 'Blue', 'published'), [{ type: 'contact_changed', conditions: [b] }])]) });
  assert.equal(one(out).verdict, 'MIGHT');
});

test('CAN\'T: different form ids on a single-valued form field (one submission has one form)', () => {
  const out = triggerOverlap({ types: ['form_submission'], draftTriggers: [{ type: 'form_submission', conditions: [formRow(['form-A'])] }],
    found: found([withTriggers(row('p1', 'Form B', 'published'), [{ type: 'form_submission', conditions: [formRow(['form-B'])] }])]) });
  assert.equal(out.cannotOverlap[0].verdict, 'CANT');
});

test('a DRAFT is never a WILL: an identical-filter draft is listed in draftHits, not hits, and the note does not say "will also fire" for it', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([withTriggers(row('d1', 'Draft twin', 'draft'), [{ type: 'contact_tag', conditions: [tagRow('vip')] }])]) });
  assert.deepEqual(out.hits, [], 'a draft fires nothing, so it is not an overlap hit');
  assert.equal(out.draftHits[0].id, 'd1');
  assert.equal(out.draftHits[0].verdict, 'WILL', 'the verdict is kept for the draft, so it can be read when it is published');
  assert.doesNotMatch(out.note, /will also fire/i);
  assert.match(out.note, /draft/i);
});

// QA follow-up (2026-11-08): a row whose status is missing is NOT a draft. It may be published, so it is a hit, marked unknown, never a draft.
test('a workflow with no status is a hit with status unknown, never listed as a draft', () => {
  const out = triggerOverlap({ types: ['contact_tag'], draftTriggers: [{ type: 'contact_tag', conditions: [tagRow('vip')] }],
    found: found([withTriggers({ id: 'n1', name: 'No status row', paused: false, folderId: null }, [{ type: 'contact_tag', conditions: [tagRow('vip')] }])]) });
  assert.deepEqual(out.draftHits, [], 'an unknown status is not a draft');
  assert.equal(out.hits.length, 1);
  assert.equal(out.hits[0].id, 'n1');
  assert.equal(out.hits[0].status, 'unknown');
  assert.equal(out.hits[0].verdict, 'WILL');
  assert.match(out.note, /status unknown/i);
});
