import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

// TRIGGER SEEDS: rows the UI adds by itself (TriggerMain.addMandatoryFilters). The engine seeds
// only corpus-CONFIRMED rows with the exact stored shape; authored filters on that field win.
const catalog = loadCatalog();
const ctx = (extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog, ...extra });
const build = (trigger, extra) => compile({ name: 'S', triggers: [trigger], graph: [{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: { body: 'hi' } }] }, ctx(extra)).triggerBodies[0];

test('catalog: appointment.eventType is seed-confirmed with the stored row', () => {
  const row = catalog.trigger('appointment').seededFilters.rows.find((r) => r.field === 'appointment.eventType');
  assert.equal(row.verdict, 'seed-confirmed');
  assert.deepEqual(row.seedRow, { field: 'appointment.eventType', operator: '==', type: 'select', title: 'Event Type', value: 'normal', valueDominance: 95 });
});

test('an appointment trigger authored without eventType gains the seeded row FIRST; authored eventType wins; hatch skips', () => {
  const seeded = build({ ref: 't', type: 'appointment', name: 'Appt', filters: [{ field: 'appointment.status', operator: '==', value: 'confirmed' }] });
  assert.deepEqual(seeded.conditions[0], { operator: '==', field: 'appointment.eventType', value: 'normal', title: 'Event Type', type: 'select' });
  assert.equal(seeded.conditions.length, 2);
  const authored = build({ ref: 't', type: 'appointment', name: 'Appt', filters: [{ field: 'appointment.eventType', operator: '==', value: 'any' }] });
  assert.equal(authored.conditions.filter((c) => c.field === 'appointment.eventType').length, 1);
  assert.equal(authored.conditions[0].value, 'any');
  const skipped = build({ ref: 't', type: 'appointment', name: 'Appt', filters: [] }, { skipTriggerSeeds: true });
  assert.equal(skipped.conditions.length, 0);
});

test('types with no confirmed seed (or no seed at all) are untouched', () => {
  assert.equal(build({ ref: 't', type: 'contact_tag', name: 'T', filters: [] }).conditions.length, 0);
  // dnd_contact seeds contact.dnd_direction in the UI, but the corpus has no stored sample → documented, NOT emitted
  const dnd = catalog.trigger('dnd_contact').seededFilters.rows[0];
  assert.equal(dnd.verdict, 'insufficient-corpus');
  assert.equal(build({ ref: 't', type: 'dnd_contact', name: 'D', filters: [] }).conditions.length, 0);
});
