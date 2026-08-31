// Graph-context rules: the two GHL validators that need the whole template list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGraphContextRules } from './graph-context-rules.mjs';

const run = (templates) => checkGraphContextRules(templates, {});

test('goto: a step after a goto is unreachable and is reported', () => {
  const f = run([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: 'z' },
    { id: 'z', type: 'sms' },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /unreachable/);
});

test('goto: a goto at the end of its branch is fine', () => {
  assert.deepEqual(run([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: null },
  ]), []);
});

test('goto: a goto with no parent pointing at it is not judged', () => {
  assert.deepEqual(run([{ id: 'g', type: 'goto', name: 'Orphan', next: 'z' }]), []);
});

test('math: a reference to a deleted upstream step is reported', () => {
  // {{math_operation.3.result}} with only one math step present — nothing resolves it.
  const f = run([
    { id: 'm1', type: 'math_operation', name: 'Second', stepIndex: 1,
      attributes: { selectField: '{{math_operation.3.result}}', selectFieldtype: 'numerical' } },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /does not exist/);
});

test('math: a type that drifted from its upstream step is reported', () => {
  const f = run([
    { id: 'm0', type: 'math_operation', name: 'First', stepIndex: 0,
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'date' } },
    { id: 'm1', type: 'math_operation', name: 'Second', stepIndex: 1,
      attributes: { selectField: '{{math_operation.0.result}}', selectFieldtype: 'numerical' } },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /types drifted apart/);
});

test('math: matching types are silent', () => {
  assert.deepEqual(run([
    { id: 'm0', type: 'math_operation', name: 'First', stepIndex: 0,
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'numerical' } },
    { id: 'm1', type: 'math_operation', name: 'Second', stepIndex: 1,
      attributes: { selectField: '{{math_operation.0.result}}', selectFieldtype: 'numerical' } },
  ]), []);
});

test('math: GHL falls back to template ORDER when stepIndex is unset, and so do we', () => {
  // No stepIndex anywhere — GHL indexes the math steps positionally. mathOps[0] is First.
  const f = run([
    { id: 'm0', type: 'math_operation', name: 'First',
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'date' } },
    { id: 'm1', type: 'math_operation', name: 'Second',
      attributes: { selectField: '{{math_operation.0.result}}', selectFieldtype: 'numerical' } },
  ]);
  assert.equal(f.length, 1, 'the positional fallback must resolve, not silently miss');
});

test('a non-reference selectField is never judged against upstream', () => {
  assert.deepEqual(run([
    { id: 'm0', type: 'math_operation', name: 'Only',
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'numerical' } },
  ]), []);
});

test('the hatch disables the whole layer', () => {
  const f = checkGraphContextRules([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: 'z' },
  ], { skipGraphContextRules: true });
  assert.deepEqual(f, []);
});

test('findings reach the caller through warn, prefixed', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: 'z' },
  ], { warn: (m) => warns.push(m) });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /^GRAPH_CONTEXT: /);
});

// T3-9: a manual step is a TASK. The run waits there for a human, so an outbound send below it
// does not go out on a schedule — a sequencing surprise that only shows up in runtime logs.
test('a manual-call ahead of an outbound send in the same chain warns — the queue HOLDS the run', () => {
  const templates = [
    { id: 'a', type: 'manual-call', name: 'Call task', next: 'b', parentKey: null, order: 0, attributes: {} },
    { id: 'b', type: 'sms', name: 'Text', next: null, parentKey: 'a', order: 1, attributes: { body: 'hi' } },
  ];
  const warns = [];
  checkGraphContextRules(templates, { warn: (m) => warns.push(m) });
  assert.ok(warns.some((w) => /GRAPH_CONTEXT/.test(w) && /HOLDS the run/.test(w) && /Text/.test(w)), warns.join('\n'));
});

test('a send ABOVE the manual step is fine, and an unrelated chain is silent', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'a', type: 'sms', name: 'Text first', next: 'b', parentKey: null, order: 0, attributes: { body: 'hi' } },
    { id: 'b', type: 'manual-call', name: 'Call task', next: null, parentKey: 'a', order: 1, attributes: {} },
  ], { warn: (m) => warns.push(m) });
  assert.deepEqual(warns.filter((w) => /HOLDS the run/.test(w)), []);
});

// F5-36, measured live: a card created with POST /opportunities/ read back by ID immediately but
// did not appear in GET /opportunities/search for about a minute. Fetch-by-id is the record;
// search is an index behind it.
test('a find_opportunity soon after a create_opportunity warns about the index lag', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'a', type: 'internal_create_opportunity', name: 'Create card', next: 'b', parentKey: null, order: 0, attributes: {} },
    { id: 'b', type: 'find_opportunity', name: 'Find it', next: null, parentKey: 'a', order: 1, attributes: {} },
  ], { warn: (m) => warns.push(m) });
  assert.ok(warns.some((w) => /GRAPH_CONTEXT/.test(w) && /INDEX and lags/.test(w) && /Find it/.test(w)), warns.join('\n'));
});

// Live, GROM sandbox 2026-08-30: a splitter branch wired directly to a
// conversationai_book_appointment (itself a multipath container) was never once chosen across
// four conversations whose wording matched its label almost verbatim; two description rewrites
// changed nothing. One add_notes at the head of the branch and it fired on the very next message.
test('a splitter branch whose head is a container warns — GHL never offers that branch', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'sp', type: 'conversationai_ai_splitter', name: 'Route', cat: 'multi-path', order: 0, parentKey: null,
      next: ['tr0', 'tr1'], attributes: { description: 'route by intent', cat: 'multi-path' } },
    { id: 'tr0', type: 'transition', name: 'No condition met', cat: 'transition', parentKey: 'sp', parent: 'sp', order: 0, attributes: {}, next: null },
    { id: 'tr1', type: 'transition', name: 'Wants to book', cat: 'transition', parentKey: 'sp', parent: 'sp', order: 1, attributes: {}, next: 'ba' },
    { id: 'ba', type: 'conversationai_book_appointment', name: 'Book appt', cat: 'multi-path', parentKey: 'tr1', order: 0,
      next: ['bt1', 'bt2'], attributes: { calendarId: 'CAL', cat: 'multi-path' } },
    { id: 'bt1', type: 'transition', name: 'Appointment Booked', cat: 'transition', parentKey: 'ba', parent: 'ba', order: 0, attributes: {}, next: null },
    { id: 'bt2', type: 'transition', name: 'Appointment Not booked', cat: 'transition', parentKey: 'ba', parent: 'ba', order: 1, attributes: {}, next: null },
  ], { warn: (m) => warns.push(m) });
  assert.ok(warns.some((w) => /GRAPH_CONTEXT/.test(w) && /never/.test(w) && /Wants to book/.test(w)
    && /Book appt/.test(w) && /simple step/.test(w)), warns.join('\n'));
});

test('a splitter branch that leads with a simple step is silent, even with a container below it', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'sp', type: 'conversationai_ai_splitter', name: 'Route', cat: 'multi-path', order: 0, parentKey: null,
      next: ['tr0', 'tr1'], attributes: { description: 'route by intent', cat: 'multi-path' } },
    { id: 'tr0', type: 'transition', name: 'No condition met', cat: 'transition', parentKey: 'sp', parent: 'sp', order: 0, attributes: {}, next: null },
    { id: 'tr1', type: 'transition', name: 'Wants to book', cat: 'transition', parentKey: 'sp', parent: 'sp', order: 1, attributes: {}, next: 'note' },
    { id: 'note', type: 'add_notes', name: 'Log intent', parentKey: 'tr1', order: 0, attributes: { note: 'wants to book' }, next: 'ba' },
    { id: 'ba', type: 'conversationai_book_appointment', name: 'Book appt', cat: 'multi-path', parentKey: 'note', order: 1,
      next: ['bt1', 'bt2'], attributes: { calendarId: 'CAL', cat: 'multi-path' } },
    { id: 'bt1', type: 'transition', name: 'Appointment Booked', cat: 'transition', parentKey: 'ba', parent: 'ba', order: 0, attributes: {}, next: null },
    { id: 'bt2', type: 'transition', name: 'Appointment Not booked', cat: 'transition', parentKey: 'ba', parent: 'ba', order: 1, attributes: {}, next: null },
  ], { warn: (m) => warns.push(m) });
  assert.deepEqual(warns.filter((w) => /simple step/.test(w)), [], warns.join('\n'));
});

test('an empty splitter branch is not judged — there is no head to lead with', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'sp', type: 'conversationai_ai_splitter', name: 'Route', cat: 'multi-path', order: 0, parentKey: null,
      next: ['tr0'], attributes: { description: 'route by intent', cat: 'multi-path' } },
    { id: 'tr0', type: 'transition', name: 'No condition met', cat: 'transition', parentKey: 'sp', parent: 'sp', order: 0, attributes: {}, next: null },
  ], { warn: (m) => warns.push(m) });
  assert.deepEqual(warns, []);
});

test('a wait between them silences it, and a find with no create above is silent', () => {
  const withWait = [];
  checkGraphContextRules([
    { id: 'a', type: 'internal_create_opportunity', name: 'Create', next: 'w', parentKey: null, order: 0, attributes: {} },
    { id: 'w', type: 'wait', name: 'Settle', next: 'b', parentKey: 'a', order: 1, attributes: { type: 'time' } },
    { id: 'b', type: 'find_opportunity', name: 'Find', next: null, parentKey: 'w', order: 2, attributes: {} },
  ], { warn: (m) => withWait.push(m) });
  assert.deepEqual(withWait.filter((w) => /INDEX and lags/.test(w)), [], 'a wait is the fix');

  const alone = [];
  checkGraphContextRules([{ id: 'b', type: 'find_opportunity', name: 'Find', next: null, parentKey: null, order: 0, attributes: {} }],
    { warn: (m) => alone.push(m) });
  assert.deepEqual(alone.filter((w) => /INDEX and lags/.test(w)), []);
});
