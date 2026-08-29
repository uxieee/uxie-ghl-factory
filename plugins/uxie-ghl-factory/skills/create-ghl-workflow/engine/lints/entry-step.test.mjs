// F5-34, proven live by runtime logs: a root wired correctly by parentKey/next but APPENDED to the
// end of the templates array never executed. The builder renders from the graph; the runtime
// enters at templates[0].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintEntryStep } from './entry-step.mjs';

const codes = (f) => f.map((x) => x.code).sort();

test('a root at index 0 is clean', () => {
  assert.deepEqual(lintEntryStep([
    { id: 'a', type: 'add_contact_tag', name: 'Head', next: 'b', parentKey: null, order: 0 },
    { id: 'b', type: 'sms', name: 'Text', next: null, parentKey: 'a', order: 1 },
  ]), []);
});

test('a root APPENDED after its successor is ENTRY_NOT_FIRST, naming what actually runs first', () => {
  const f = lintEntryStep([
    { id: 'b', type: 'sms', name: 'Text', next: null, parentKey: 'a', order: 1 },
    { id: 'a', type: 'remove_from_workflow', name: 'Remove', next: 'b', parentKey: null, order: 0 },
  ]);
  assert.deepEqual(codes(f), ['ENTRY_NOT_FIRST']);
  assert.equal(f[0].severity, 'error');
  assert.match(f[0].msg, /index 1/);
  assert.match(f[0].msg, /'Text' \(sms\)/, 'it must name the step the runtime actually starts on');
});

test('two parentKey-less steps are ENTRY_AMBIGUOUS', () => {
  const f = lintEntryStep([
    { id: 'a', type: 'add_contact_tag', name: 'One', next: null, parentKey: null },
    { id: 'b', type: 'sms', name: 'Two', next: null, parentKey: null },
  ]);
  assert.ok(codes(f).includes('ENTRY_AMBIGUOUS'));
  assert.match(f[0].msg, /'One', 'Two'/);
});

test('a branch entry does not count as a root, and an empty document says nothing', () => {
  assert.deepEqual(lintEntryStep([
    { id: 'g', type: 'if_else', name: 'Gate', next: ['t1'], parentKey: null, order: 0 },
    { id: 't1', type: 'transition', name: 'Yes', next: null, parent: 'g', order: 0 },
  ]), [], 'a transition is scoped by `parent`, not parentKey');
  assert.deepEqual(lintEntryStep([]), []);
  assert.deepEqual(lintEntryStep(null), []);
});

test('a document with no parentKey-less step at all is reported, not assumed fine', () => {
  assert.deepEqual(codes(lintEntryStep([{ id: 'a', type: 'sms', name: 'Orphan', next: null, parentKey: 'ghost' }])), ['ENTRY_MISSING']);
});
