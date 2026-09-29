// scheduler_trigger Daily: the drawer's "At what time" row is scheduler.daily.times; the catalogue did not model it, so it went out with no
// operator/title/type and the drawer showed the Interval with no time row. Drawer walk 2026-09-30 (live-W29-g-scheduler_trigger-intervals.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const run = (filters) => {
  const warnings = [];
  const ctx = { loc: 'L', cid: 'C', uid: 'U', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: (m) => warnings.push(m) };
  const r = compile({ name: 'W', triggers: [{ ref: 't', type: 'scheduler_trigger', name: 'T', filters }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] }, ctx);
  return { conditions: r.triggerBodies[0].conditions, warnings };
};

test('a Daily interval with times is stored the way the drawer stores it', () => {
  const { conditions, warnings } = run([{ field: 'scheduler.interval', value: 'daily' }, { field: 'scheduler.daily.times', value: ['09:00', '17:30'] }]);
  assert.deepEqual(conditions[1], { field: 'scheduler.daily.times', value: ['09:00', '17:30'], operator: '==', title: 'At what time', type: 'multiselect' });
  assert.deepEqual(warnings.filter((w) => /TRIGGER_FILTER/.test(w)), []);
});

test('the times row is refused under another interval, and without an interval (the drawer offers it only for Daily)', () => {
  assert.throws(() => run([{ field: 'scheduler.interval', value: 'weekly' }, { field: 'scheduler.daily.times', value: ['09:00'] }]), (e) => e.code === 'TRIGGER_FILTER_PARENT');
  assert.throws(() => run([{ field: 'scheduler.daily.times', value: ['09:00'] }]), (e) => e.code === 'TRIGGER_FILTER_PARENT');
});

test('CONTROLS: the weekly and hourly rows are unchanged', () => {
  const w = run([{ field: 'scheduler.interval', value: 'weekly' }, { field: 'scheduler.weekly.days', value: ['monday'] }, { field: 'scheduler.weekly.times', value: ['09:00'] }]).conditions;
  assert.equal(w[2].title, 'At what time'); assert.equal(w[1].operator, 'is-any-of');
  assert.equal(run([{ field: 'scheduler.interval', value: 'hourly' }, { field: 'scheduler.hourly.every', value: 2 }]).conditions[1].title, 'Every');
});
