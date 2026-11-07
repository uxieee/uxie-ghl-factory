// bl-384: modifyTrigger on a custom_date_reminder was refused "needs the contact DATE field" even though the stored trigger
// had one — the rebuild never saw the stored custom_date_reminder_config. The workaround (add + delete) changed trigger ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTriggerOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';

const stored = {
  id: 'TRIG', type: 'custom_date_reminder', name: 'Renewal', match_year: false,
  custom_date_reminder_config: { recordType: 'contact', customDateFieldId: 'FIELD_RENEWAL_DATE_01', customDateFieldType: 'DATE', matchYear: false,
    offsetDays: -1, runHour: '9', timezone: '', last_run: '2026-10-29T09:00:00.000Z' },
  conditions: [
    { operator: 'custom-field-eq', field: 'contact.customFields', value: 'FIELD_RENEWAL_DATE_01', title: 'Contact date field', type: 'select', id: 'custom-field' },
    { operator: 'index-of-true', field: 'contact.tags', value: 'test-contact', title: 'Has tag', type: 'select', id: 'has-tag' },
  ],
};
const ctx = { catalog: loadCatalog(), customFields: [], warn: () => {} };

test('modifyTrigger on a stored custom_date_reminder keeps its date field, schedule and last run', () => {
  const [p] = planTriggerOps([{ op: 'modifyTrigger', triggerId: 'TRIG', trigger: { name: 'Renewal (renamed)' } }],
    { ctx, wid: 'W', uid: 'U', existing: [stored], workflowStatus: 'published' });
  assert.equal(p.method, 'PUT');
  assert.equal(p.body.name, 'Renewal (renamed)');
  const c = p.body.custom_date_reminder_config;
  assert.equal(c.customDateFieldId, 'FIELD_RENEWAL_DATE_01');
  assert.equal(c.offsetDays, -1); assert.equal(c.runHour, '9'); assert.equal(c.matchYear, false);
  assert.equal(c.last_run, '2026-10-29T09:00:00.000Z');
  assert.equal(p.body.match_year, false);
  assert.equal(p.body.conditions.filter((r) => r.id === 'custom-field').length, 1);
});
