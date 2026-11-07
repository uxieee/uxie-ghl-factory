// w6d-2 (plan Task 2, item 12): richer step cards. stepCardExtras(card) adds four fields to describe_step_type:
//   assetReferences      ids that must already exist on the account (custom field, calendar, user)
//   requiredEnforcement  per field: 'server' (only with a measured refusal), 'builder' (a builder validator enforces it), 'none', 'unknown'
//   hasDynamicOptions    per field: the options load from the account (the catalogue's DYNAMIC field type)
//   triggerFilters       for triggers only: the card's filter rows against the observed ones; complete:false when fewer were observed
// An unknown or malformed card returns {} and never throws (item 13: unknown values are other, never a crash). RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stepCardExtras, ASSET_REFERENCES, MEASURED_NOT_READ } from '../core/step-card-extras.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = JSON.parse(readFileSync(join(HERE, '../../skills/create-ghl-workflow/catalog/type-cards.json'), 'utf8')).cards;
const card = (type) => CARDS.find((c) => c.type === type);

test('update_contact_field lists its custom field id as an assetReference', () => {
  const x = stepCardExtras(card('update_contact_field'));
  const ref = x.assetReferences.find((r) => r.field === 'fields[].id');
  assert.ok(ref, JSON.stringify(x.assetReferences));
  assert.equal(ref.assetType, 'custom_field');
  assert.equal(ref.mustExist, true);
});

test('a field enforced only by the builder validator reads builder, not server', () => {
  const x = stepCardExtras(card('update_contact_field'));
  assert.equal(x.requiredEnforcement.actionType, 'builder');
  assert.notEqual(x.requiredEnforcement.actionType, 'server');
});

test('a field with a measured server refusal on record reads server (workflow_split extras: the live 33.3 refusal, w6c-11b)', () => {
  const x = stepCardExtras(card('workflow_split'));
  assert.equal(x.requiredEnforcement.extras, 'server');
});

test('a trigger with fewer observed filters than its card reports complete:false', () => {
  const t = { type: 'zz_trigger', family: 'triggers-marketplace', fields: [], filterRows: [{ field: 'a' }, { field: 'b' }, { field: 'c' }] };
  const x = stepCardExtras(t, { observed: { zz_trigger: [{ field: 'a' }] } });
  assert.deepEqual(x.triggerFilters, { known: 3, observed: 1, complete: false });
});

test('a trigger whose observed filters cover its card reads complete:true', () => {
  const t = { type: 'zz_trigger', family: 'triggers-marketplace', fields: [], filterRows: [{ field: 'a' }] };
  const x = stepCardExtras(t, { observed: { zz_trigger: [{ field: 'a' }, { field: 'b' }] } });
  assert.equal(x.triggerFilters.complete, true);
});

test('a step (not a trigger) carries no triggerFilters key', () => {
  const x = stepCardExtras(card('update_contact_field'));
  assert.equal('triggerFilters' in x, false);
});

test('an unknown type returns {} extras, never throws', () => {
  assert.deepEqual(stepCardExtras({ type: 'no_such_type' }), {});
  assert.deepEqual(stepCardExtras(undefined), {});
  assert.deepEqual(stepCardExtras(null), {});
  assert.deepEqual(stepCardExtras('not a card'), {});
});

test('hasDynamicOptions is true for the account-loaded pickers (calendar, user list) and false elsewhere', () => {
  const x = stepCardExtras(card('appointment_booking'));
  assert.equal(x.hasDynamicOptions.calendarId, true);
  const y = stepCardExtras(card('update_contact_field'));
  assert.equal(y.hasDynamicOptions.actionType, false);
  const z = stepCardExtras(card('assign_user'));
  assert.equal(z.hasDynamicOptions.user_list, true);
});

test('the catalogue placeholder row (type DYNAMIC, no field) is not a field: it has no enforcement or option entry', () => {
  const x = stepCardExtras(card('appointment_booking'));
  assert.equal('DYNAMIC' in x.requiredEnforcement, false);
  assert.equal('DYNAMIC' in x.hasDynamicOptions, false);
});

test('a non-required field reads none; a required field with no validator reads unknown', () => {
  const s = { type: 'zz_step', family: 'steps', meta: { Validator: '`zzValidator`' }, fields: [{ name: 'a', required: true, type: 'string' }, { name: 'b', required: false, type: 'string' }] };
  assert.equal(stepCardExtras(s).requiredEnforcement.b, 'none');
  assert.equal(stepCardExtras(s).requiredEnforcement.a, 'builder');
  const bare = { type: 'zz_step2', family: 'steps', fields: [{ name: 'a', required: true, type: 'string' }] };
  assert.equal(stepCardExtras(bare).requiredEnforcement.a, 'unknown');
});

test('a trigger card that keeps its rows under `conditions` (no fields list) is still counted and completed', () => {
  const t = { type: 'zz_cond', family: 'triggers', conditions: [{ label: 'a' }, { label: 'b' }] };
  const x = stepCardExtras(t, { observed: { zz_cond: [{ field: 'a' }, { field: 'b' }] } });
  assert.deepEqual(x.triggerFilters, { known: 2, observed: 2, complete: true });
  assert.deepEqual(x.requiredEnforcement, {});
});

// w6d-2 QA FAIL items 1 and 2 (RED first). Every site the engine's own evidence records is in the table, and a site nobody measured
// is 'unmeasured', never 'none' (none means "measured: the server does not read it").
test('add_to_workflow lists its workflow id as an assetReference checked by validate-assets (ASSET_WORKFLOW_NOT_FOUND, asset-preflight)', () => {
  const x = stepCardExtras(card('add_to_workflow'));
  const ref = x.assetReferences.find((r) => r.field === 'workflow_id');
  assert.ok(ref, JSON.stringify(x.assetReferences));
  assert.equal(ref.assetType, 'workflow');
  assert.equal(ref.checkedBy, 'validate-assets');
  assert.equal(ref.mustExist, true);
});

test('the appointment TRIGGER lists its calendar condition as an assetReference checked by validate-assets (ASSET_CALENDAR_NOT_FOUND)', () => {
  const x = stepCardExtras(card('appointment'));
  const ref = x.assetReferences.find((r) => r.field === 'calendar.id');
  assert.ok(ref, JSON.stringify(x.assetReferences));
  assert.equal(ref.checkedBy, 'validate-assets');
});

test('remove_from_workflow names its workflow id as an assetReference, unmeasured (no recorded check)', () => {
  const x = stepCardExtras(card('remove_from_workflow'));
  const ref = x.assetReferences.find((r) => r.field === 'workflow_id');
  assert.ok(ref, JSON.stringify(x.assetReferences));
  assert.equal(ref.checkedBy, 'unmeasured');
});

test('the custom-field id on update_contact_field is unmeasured, not none (no measurement of the server check exists)', () => {
  const x = stepCardExtras(card('update_contact_field'));
  const ref = x.assetReferences.find((r) => r.field === 'fields[].id');
  assert.equal(ref.checkedBy, 'unmeasured');
});

test('a site with no measurement is never checkedBy none: none is reserved for "measured, the server does not read it"', () => {
  for (const t of Object.keys(ASSET_REFERENCES)) {
    for (const r of ASSET_REFERENCES[t]) {
      if (r.checkedBy === 'none') assert.ok(MEASURED_NOT_READ.has(`${t}.${r.field}`), `${t}.${r.field} is none but has no recorded not-read measurement`);
    }
  }
});

test('the measured not-read sites are the calendar step and the traffic sites (bl-140, bl-144), and nothing else', () => {
  const none = [];
  for (const t of Object.keys(ASSET_REFERENCES)) for (const r of ASSET_REFERENCES[t]) if (r.checkedBy === 'none') none.push(`${t}.${r.field}`);
  assert.deepEqual(none.sort(), [...MEASURED_NOT_READ].sort());
});
