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
const gwFor = (lists, customFields = []) => ({
  call: async (method, path) => {
    if (path.startsWith('/contacts/smartlist/search')) {
      // userId is REQUIRED. Without it the route answers 200 + an empty array when `globals=true`
      // is set, and 422 otherwise — so a roster read that omits it silently reports an empty
      // account. The stub refuses it the way the server would.
      if (!/[?&]userId=/.test(path)) return { ok: false, status: 422, json: { message: 'userId is required' } };
      return { ok: true, status: 200, json: { smartLists: lists.map((l) => ({ _id: l.id, listName: l.listName })) } };
    }
    if (path.startsWith('/locations/')) {
      return { ok: true, status: 200, json: { customFields: customFields } };
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
const run = (lists, args = {}, customFields = []) => tool.handler(
  { locationId: 'LOC', ...args },
  { state: {}, makeGw: () => ({ ...gwFor(lists, customFields), uid: 'USER1' }) },
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

test('an empty roster claims only what it establishes', async () => {
  // It must NOT say "deleted". The roster is scoped to the calling user, and this tool originally
  // shipped a query with no userId that answered 200 + empty on an account holding seven lists —
  // on the strength of which I told a colleague their lists had been deleted. They had not.
  const r = await run([]);
  assert.equal(r.data.checked, 0);
  assert.match(r.data.note, /not proof there are none/);
  assert.doesNotMatch(r.data.note, /deleted/i);
});

test('the roster read sends userId — without it the server reports an empty account', async () => {
  const seen = [];
  const gw = { ...gwFor([{ id: 'a', listName: 'X', filterSpecs: CANONICAL }]), uid: 'USER1' };
  const spy = { ...gw, call: (m, p) => { seen.push(p); return gw.call(m, p); } };
  const r = await tool.handler({ locationId: 'LOC' }, { state: {}, makeGw: () => spy });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(seen.some((p) => p.includes('/contacts/smartlist/search') && p.includes('userId=USER1')),
    `roster read must carry userId; sent ${seen.filter((p) => p.includes('search')).join(' ')}`);
});

test('the row count is never offered as the signal', async () => {
  // It is correct either way — that is what made this class expensive to find.
  const r = await run([{ id: 'b', listName: 'Broken', filterSpecs: ONE_LEVEL }]);
  assert.match(r.data.note, /row count is NOT the signal/i);
});

test('the tool is read-only — it declares no write capability', async () => {
  // Deliberate: a smart list cannot be deleted through the API, so a create is permanent and the
  // write half needs the operator's word.
  // Three GETs now: the roster, each list's detail, and the account's contact custom fields for
  // the field half of the catalogue. Still no write of any kind.
  assert.deepEqual(tool.capabilities.map((c) => c.method), ['GET', 'GET', 'GET']);
});

test('a clean verdict states the two things the field check still rests on', async () => {
  const r = await run([{ id: 'a', listName: 'Tagged', filterSpecs: CANONICAL }]);
  assert.equal(r.data.lists[0].verdict, 'ok');
  // The static half is mined from ONE build of the contacts app, and a stale list would flag a
  // real field — the false positive this tool must never produce quietly.
  assert.match(r.data.fieldCatalogue, /per ACCOUNT and per BUILD/);
  assert.match(r.data.scoreCaveat, /PUBLISHED score profile/);
});

test('a filter naming a field the account does not offer is caught, and named as such', async () => {
  const withDeadField = { filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'custom_fields.deletedFieldId', operator: 'eq', value: 'x' },
  ] }] }] };
  const r = await run([{ id: 'a', listName: 'Was fine yesterday', filterSpecs: withDeadField }]);
  assert.equal(r.data.lists[0].verdict, 'renders-everything');
  assert.equal(r.data.lists[0].cause, 'unknown-field');
  assert.match(r.data.lists[0].reason, /nesting is NOT the problem/);
  assert.deepEqual(r.data.lists[0].fieldStatus, [{ field: 'custom_fields.deletedFieldId', status: 'unknown' }]);
});

test('a live custom field resolves, so a good list is not flagged', async () => {
  const spec = { filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'custom_fields.abc123', operator: 'eq', value: 'x' },
  ] }] }] };
  const r = await run([{ id: 'a', listName: 'Custom', filterSpecs: spec }], {},
    [{ id: 'abc123', dataType: 'TEXT' }]);
  assert.equal(r.data.lists[0].verdict, 'ok');
});

test('a FILE_UPLOAD or SIGNATURE field is excluded, exactly as the builder excludes it', async () => {
  const spec = { filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'custom_fields.sigField', operator: 'eq', value: 'x' },
  ] }] }] };
  const r = await run([{ id: 'a', listName: 'Signature filter', filterSpecs: spec }], {},
    [{ id: 'sigField', dataType: 'SIGNATURE' }]);
  assert.equal(r.data.lists[0].cause, 'unknown-field');
});

test('an unresolved custom field on an account WITH a TEXTBOX_LIST is unverified, never flagged', async () => {
  // A TEXTBOX_LIST contributes one key per OPTION id and none for itself, and the customFields
  // endpoint returns picklistOptions as plain strings with no ids — so those keys cannot be
  // enumerated. Calling one unknown would send somebody to fix a list that works.
  const spec = { filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'custom_fields.someOptionId', operator: 'eq', value: 'x' },
  ] }] }] };
  const r = await run([{ id: 'a', listName: 'Textbox list', filterSpecs: spec }], {},
    [{ id: 'tbl', dataType: 'TEXTBOX_LIST' }]);
  assert.equal(r.data.lists[0].verdict, 'ok');
  assert.deepEqual(r.data.lists[0].fieldStatus, [{ field: 'custom_fields.someOptionId', status: 'unverified' }]);
});

test('a static key from the mined list resolves', async () => {
  const spec = { filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'address_1', operator: 'eq', value: 'x' },
  ] }] }] };
  const r = await run([{ id: 'a', listName: 'Address', filterSpecs: spec }]);
  assert.equal(r.data.lists[0].verdict, 'ok');
});

test('score is allowed without checking, and the caveat says so', async () => {
  const spec = { filters: [{ group: 'OR', filters: [{ group: 'AND', filters: [
    { field: 'score', operator: 'gt', value: 5 },
  ] }] }] };
  const r = await run([{ id: 'a', listName: 'Scored', filterSpecs: spec }]);
  assert.equal(r.data.lists[0].verdict, 'ok');
});

test('bad nesting still reports nesting, not the field, when both could be blamed', async () => {
  const r = await run([{ id: 'b', listName: 'Broken', filterSpecs: ONE_LEVEL }]);
  assert.equal(r.data.lists[0].cause, 'one-level-nesting');
});

test('a list with BOTH a flattened envelope and a dead field says so', async () => {
  // Live case: TEST-CAP-SL-03 on the sandbox is one-level AND filters on `not_a_field`. Reporting
  // only the envelope sends somebody to fix the nesting and find the list still showing everything.
  const both = { filters: [{ group: 'AND', filters: [{ field: 'not_a_field', operator: 'eq', value: 'x' }] }] };
  const r = await run([{ id: 'a', listName: 'Both', filterSpecs: both }]);
  assert.equal(r.data.lists[0].cause, 'one-level-nesting+unknown-field');
  assert.match(r.data.lists[0].reason, /Correcting the nesting alone will NOT fix it/);
});

test('a blank or missing user id is REFUSED, never reported as an empty account', async () => {
  // `userId=` answers 200 with an empty array exactly as an absent one does — the shape a caller
  // hits when a variable is undefined rather than absent, which slips past any "did I include
  // userId" check. gw.uid is null whenever the token carries no authClassId.
  for (const uid of [null, undefined, '', '   ']) {
    const gw = { ...gwFor([{ id: 'a', listName: 'X', filterSpecs: CANONICAL }]), uid };
    const r = await tool.handler({ locationId: 'LOC' }, { state: {}, makeGw: () => gw });
    assert.equal(r.ok, false, `uid ${JSON.stringify(uid)} must refuse`);
    assert.equal(r.code, 'VALIDATION_FAILED');
    assert.match(r.remediation, /report a clean account for one full of broken lists/);
  }
});

test('checking ONE list by id still works without a user id', async () => {
  // The detail read is not user-scoped, so the escape hatch the refusal points at must actually work.
  const gw = { ...gwFor([{ id: 'a', listName: 'X', filterSpecs: CANONICAL }]), uid: null };
  const r = await tool.handler({ locationId: 'LOC', listId: 'a' }, { state: {}, makeGw: () => gw });
  assert.equal(r.ok, true);
  assert.equal(r.data.lists[0].verdict, 'ok');
});
