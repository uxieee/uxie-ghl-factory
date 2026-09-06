import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

// `filterSpecs.filters` must be nested TWO levels — an outer group whose children are groups, with
// the leaf conditions inside those. A ONE-level shape (a single group holding leaves directly,
// which is exactly what POST /contacts/search/2 takes and what any reasonable caller writes) is
// accepted with a 201, reads back byte-identical, and returns the correct rows from the search
// endpoint — then the contacts screen discards it at load and renders the ENTIRE account.
//
// Five lists across three client accounts were in that state on 2026-09-07 while every API check
// agreed they were fine. No read-back can catch it, so it is caught structurally, and these tests
// pin the classifier against the two shapes as the corpus records them
// (knowledge/corpus/platform/20-api/smart-lists.md): the canonical one came from a list a human
// built in the UI and read straight back, the broken one from the lists that rendered everything.

const tool = TOOLS.find((t) => t.name === 'check_smart_lists');

// Verbatim from the corpus page — a list built by hand in the interface, read back through
// GET /contacts/smartlist/{id}. This is the reference the audit compares against.
const CANONICAL = {
  filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'tags', operator: 'eq', value: ['test-contact'], options: { minimumMatch: 'all' } },
  ] }] }],
  page: 1, limit: 20,
};
// The shape that rendered 175 of 175 and 69 of 69 before it was rewritten.
const ONE_LEVEL = {
  filters: [{ group: 'AND', filters: [{ field: 'tags', operator: 'eq', value: ['test-contact'] }] }],
};

// A gateway that answers the two reads this tool makes, and nothing else — any other call is a
// test bug rather than a silent pass.
const gwFor = (lists) => ({
  call: async (method, path) => {
    if (path.startsWith('/contacts/smartlist/search')) {
      return { ok: true, status: 200, json: { smartLists: lists.map((l) => ({ _id: l.id, listName: l.listName })) } };
    }
    const m = path.match(/^\/contacts\/smartlist\/([^?]+)$/);
    if (m) {
      const hit = lists.find((l) => l.id === decodeURIComponent(m[1]));
      if (!hit) return { ok: false, status: 400, json: { message: 'Invalid SmartList id' } };
      return { ok: true, status: 200, json: { smartList: hit } };
    }
    throw new Error(`unexpected call ${method} ${path}`);
  },
});
const run = (lists, args = {}) => tool.handler(
  { locationId: 'LOC', ...args },
  { state: {}, makeGw: () => gwFor(lists) },
);

test('the canonical two-level shape passes', async () => {
  const r = await run([{ id: 'a', listName: 'Tagged', filterSpecs: CANONICAL }]);
  assert.equal(r.ok, true);
  assert.equal(r.data.rendersEverything, 0);
  assert.equal(r.data.lists[0].verdict, 'ok');
  assert.deepEqual(r.data.lists[0].filterFields, ['tags']);
  assert.equal(r.data.lists[0].conditions, 1);
});

test('the one-level shape is caught — the failure no read-back can see', async () => {
  const r = await run([{ id: 'b', listName: 'Broken', filterSpecs: ONE_LEVEL }]);
  assert.equal(r.data.rendersEverything, 1);
  assert.equal(r.data.lists[0].verdict, 'renders-everything');
  assert.match(r.data.lists[0].reason, /ONE level/);
  // The conditions are still reported: the fix is a nesting change with the conditions unchanged,
  // so an operator needs to see that nothing about the filter itself is wrong.
  assert.equal(r.data.lists[0].conditions, 1);
  assert.deepEqual(r.data.lists[0].filterFields, ['tags']);
});

test('an empty filters array is caught, and named as the Copy/Save-as signature', async () => {
  const r = await run([{ id: 'c', listName: 'Copy of Tagged', filterSpecs: { filters: [] } }]);
  assert.equal(r.data.lists[0].verdict, 'renders-everything');
  assert.match(r.data.lists[0].reason, /Copy\/Save-as/);
});

test('a leaf at the top level is caught rather than mistaken for a group', async () => {
  const r = await run([{ id: 'd', listName: 'Flat', filterSpecs: { filters: [{ field: 'tags', operator: 'eq', value: 'x' }] } }]);
  assert.equal(r.data.lists[0].verdict, 'renders-everything');
  assert.match(r.data.lists[0].reason, /leaf condition sits at the top level/);
});

test('a UI-deleted list reads as GONE, not as a malformed argument', async () => {
  // This surface never answers 404. Reading its 400 as a bad request reports the caller's id as
  // wrong when the truth is that somebody removed the list.
  const r = await run([], { listId: 'deleted-one' });
  assert.equal(r.data.lists[0].verdict, 'gone');
  assert.match(r.data.lists[0].reason, /DELETED from the interface/);
});

test('a mixed account reports the count and warns, without burying the healthy lists', async () => {
  const r = await run([
    { id: 'a', listName: 'Good', filterSpecs: CANONICAL },
    { id: 'b', listName: 'Bad', filterSpecs: ONE_LEVEL },
    { id: 'c', listName: 'Copy of Good', filterSpecs: { filters: [] } },
  ]);
  assert.equal(r.data.checked, 3);
  assert.equal(r.data.rendersEverything, 2);
  assert.match(r.data.warning, /ENTIRE account/);
  assert.match(r.data.warning, /the PUT merges/);
  assert.equal(r.data.lists.filter((l) => l.verdict === 'ok').length, 1);
});

test('an empty roster says deletion, not failure', async () => {
  // Live-proven wording: the sandbox roster came back empty on 2026-09-07 after the operator
  // removed the probe lists, and "no lists" reads as a failed call unless the tool says otherwise.
  const r = await run([]);
  assert.equal(r.data.checked, 0);
  assert.match(r.data.note, /deleted, not that the read failed/);
});

test('the row count is never offered as the signal', async () => {
  // It is correct either way — that is what made this class expensive to find.
  const r = await run([{ id: 'b', listName: 'Broken', filterSpecs: ONE_LEVEL }]);
  assert.match(r.data.note, /row count is NOT the signal/i);
});

test('the tool is read-only — it declares no write capability', async () => {
  // Deliberate: a smart list cannot be deleted through the API, so a create is permanent and the
  // write half needs the operator's word.
  assert.deepEqual(tool.capabilities.map((c) => c.method), ['GET', 'GET']);
});

test('a clean verdict states what it did NOT check', async () => {
  // The screen drops a filter naming an unknown FIELD through the same code path, with the same
  // whole-account result, and that is invisible from the nesting. No endpoint this project knows
  // serves the account's filter-field catalogue, so the honest move is to report the fields and
  // say they were not judged — an invented allowlist would flag working custom-field filters as
  // broken, which is worse than a named gap.
  const r = await run([{ id: 'a', listName: 'Tagged', filterSpecs: CANONICAL }]);
  assert.equal(r.data.lists[0].verdict, 'ok');
  assert.match(r.data.notChecked, /filter-field catalogue/);
  assert.match(r.data.notChecked, /the SHAPE is right, not that every field in it resolves/);
  // and the fields are handed over for a human to read
  assert.deepEqual(r.data.lists[0].filterFields, ['tags']);
});
