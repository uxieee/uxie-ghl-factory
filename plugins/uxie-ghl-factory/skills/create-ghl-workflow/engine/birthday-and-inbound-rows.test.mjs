// batch (h) drawer render checks (live-W33-render-build-h.json): birthday_reminder's Month/Day were authored as a name / a string and the
// drawer showed "Select"; the builder stores a 0-based month index and a numeric day. inbound_trigger's email rows were called unknown
// although the drawer renders them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const run = (type, filters) => {
  const warnings = [];
  const ctx = { loc: 'L', cid: 'C', uid: 'U', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: (m) => warnings.push(m) };
  const r = compile({ name: 'W', triggers: [{ ref: 't', type, name: 'T', filters }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] }, ctx);
  return { conditions: r.triggerBodies[0].conditions, warnings };
};

test('birthday month: a name or the calendar number is stored as the 0-based index; the day is a number', () => {
  for (const m of ['May', 'may', 'MAY', 5, '5']) assert.equal(run('birthday_reminder', [{ field: 'contact.birthMonth', value: m }]).conditions[0].value, 4);
  assert.equal(run('birthday_reminder', [{ field: 'contact.birthMonth', value: 'January' }]).conditions[0].value, 0);
  assert.equal(run('birthday_reminder', [{ field: 'contact.birthMonth', value: 'dec' }]).conditions[0].value, 11);
  assert.equal(run('birthday_reminder', [{ field: 'contact.birthDay', value: '16' }]).conditions[0].value, 16);
});

test('birthday month/day out of range are refused', () => {
  assert.throws(() => run('birthday_reminder', [{ field: 'contact.birthMonth', value: 'Smarch' }]), (e) => e.code === 'FILTER_VALUE');
  assert.throws(() => run('birthday_reminder', [{ field: 'contact.birthMonth', value: 13 }]), (e) => e.code === 'FILTER_VALUE');
  assert.throws(() => run('birthday_reminder', [{ field: 'contact.birthDay', value: 32 }]), (e) => e.code === 'FILTER_VALUE');
});

test('CONTROL: the before/after rows are untouched', () => {
  const c = run('birthday_reminder', [{ field: 'contact.dateOfBirth', operator: 'time-diff-now-lte', value: 3 }]).conditions[0];
  assert.equal(c.operator, 'time-diff-now-lte'); assert.equal(c.value, 3);
});

test('inbound_trigger email rows are known: title, type and the drawer\'s operator', () => {
  const { conditions, warnings } = run('inbound_trigger', [{ field: 'email.subject', operator: 'string-contains-any-of', value: ['refund'] }]);
  assert.equal(conditions[0].title, 'Subject'); assert.equal(conditions[0].type, 'string'); assert.equal(conditions[0].operator, 'string-contains-any-of');
  assert.deepEqual(warnings.filter((w) => /TRIGGER_FILTER_UNKNOWN/.test(w)), []);
});

test('inbound_trigger: an operator outside the row\'s menu is refused; none warns', () => {
  assert.throws(() => run('inbound_trigger', [{ field: 'email.subject', operator: 'contains-any', value: ['x'] }]), (e) => e.code === 'FILTER_OPERATOR');
  const { conditions, warnings } = run('inbound_trigger', [{ field: 'email.to', value: ['a'] }]);
  assert.equal('operator' in conditions[0], false);
  assert.ok(warnings.some((w) => /TRIGGER_FILTER_NO_OPERATOR/.test(w)));
});

test('inbound_trigger: has-attachments takes its baked-in operator', () => {
  const c = run('inbound_trigger', [{ field: 'email.has_attachments', value: true }]).conditions[0];
  assert.equal(c.operator, '=='); assert.equal(c.title, 'Has attachments');
});
