// w6d-9 (4): the trigger-overlap check, reused from the G3 roster. Pure: it takes the find_workflows_using result and says which published
// workflows listen to the same trigger types. Every result carries the label "may also fire: trigger filters not evaluated", because the
// read does not evaluate a trigger's filters, so an overlap is a candidate, not a collision. RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerOverlap, OVERLAP_LABEL } from './trigger-overlap.mjs';

const found = (workflows, extra = {}) => ({ countIs: 'workflows containing at least one of these types', count: workflows?.length ?? null,
  searched: ['contact_tag'], duplicatesDropped: 0, complete: true, workflows, ...extra });
const row = (id, name, status) => ({ id, name, status, paused: false, folderId: null });

test('the label is exact and every result carries it (the trigger filters are not evaluated)', () => {
  assert.equal(OVERLAP_LABEL, 'may also fire: trigger filters not evaluated');
  assert.equal(triggerOverlap({ types: ['contact_tag'], found: found([]) }).label, OVERLAP_LABEL);
  assert.equal(triggerOverlap({ types: ['contact_tag'], found: found([row('a', 'A', 'published')]) }).label, OVERLAP_LABEL);
});

test('published workflows are the overlaps that matter; each hit carries its name, status and the trigger types it was searched for', () => {
  const out = triggerOverlap({ types: ['contact_tag'], found: found([row('p1', 'Live nurture', 'published'), row('d1', 'Draft idea', 'draft')]) });
  assert.equal(out.complete, true);
  assert.deepEqual(out.publishedHits.map((h) => h.id), ['p1']);
  assert.deepEqual(out.hits.map((h) => [h.id, h.name, h.status]), [['p1', 'Live nurture', 'published'], ['d1', 'Draft idea', 'draft']]);
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
