// F5-33: twenty-one workflows passed check_workflow with 0 errors and the publish PUT refused
// three. These are the structural rules the marketplace action schema cannot see, because they
// read the GRAPH rather than a step's own fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintPublishRules } from './publish-rules.mjs';

const codes = (f) => f.map((x) => x.code).sort();

test('a parentKey that disagrees with the step whose next points at it is named', () => {
  const f = lintPublishRules([
    { id: 'a', type: 'sms', name: 'A', next: 'b', parentKey: null },
    { id: 'b', type: 'sms', name: 'B', next: 'c', parentKey: 'a' },
    // c is reached from b, but claims a as its parent
    { id: 'c', type: 'sms', name: 'C', next: null, parentKey: 'a' },
  ]);
  assert.deepEqual(codes(f), ['NEXT_PARENTKEY_MISMATCH']);
  assert.match(f[0].msg, /parentKey 'A'.*next points at it is 'B'/s);
});

test('a correctly wired chain is clean, and a root or dangling parentKey is not this lint\'s business', () => {
  assert.deepEqual(lintPublishRules([
    { id: 'a', type: 'sms', name: 'A', next: 'b', parentKey: null },
    { id: 'b', type: 'sms', name: 'B', next: null, parentKey: 'a' },
  ]), []);
  assert.deepEqual(lintPublishRules([{ id: 'x', type: 'sms', name: 'X', next: null, parentKey: 'ghost' }]), [],
    'a dangling parentKey has its own lint');
});

test('an update_contact_field row missing title or type is named, with the working shape given', () => {
  const f = lintPublishRules([{ id: 's', type: 'update_contact_field', name: 'Clear it',
    attributes: { actionType: 'clear_field_data', fields: [
      { field: 'F1', value: '', title: 'Callback', type: 'string', date: '' },
      { field: 'F2', value: '' },
    ] } }]);
  assert.deepEqual(codes(f), ['FIELD_ROW_INCOMPLETE']);
  assert.match(f[0].msg, /row 1 \(F2\) is missing \[title, type\]/);
  assert.match(f[0].msg, /value: "", title, type: "string", date: ""/);
});

test('nothing throws on a hostile document', () => {
  for (const bad of [null, [], [null, {}], [{ id: 'a', type: 'update_contact_field', attributes: { fields: 'nope' } }]]) {
    assert.ok(Array.isArray(lintPublishRules(bad)));
  }
});
