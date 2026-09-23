import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCustomObjectSteps, referencedObjectKeys, fetchObjectSchemas } from './custom-object-fields.mjs';

// A schema in the shape GET /objects/{key}?fetchProperties=true answers (refused-but-mined.md).
const SCHEMA = { object: { key: 'custom_objects.pets', primaryDisplayProperty: 'custom_objects.pets.name', requiredProperties: ['custom_objects.pets.species'] },
  fields: [
    { id: 'F_NAME', fieldKey: 'custom_objects.pets.name', name: 'Name', dataType: 'TEXT' },
    { id: 'F_SPECIES', fieldKey: 'custom_objects.pets.species', name: 'Species', dataType: 'SINGLE_OPTIONS', picklistOptions: ['Dog', 'Cat'] },
    { id: 'F_SIG', fieldKey: 'custom_objects.pets.sig', name: 'Signature', dataType: 'SIGNATURE' },
  ] };
const schemas = new Map([['custom_objects.pets', SCHEMA]]);
const step = (fields, type = 'create_custom_object', extra = {}) => ({ id: 's1', name: 'Create pet', type, attributes: { key: 'custom_objects.pets', fields, ...extra } });
const codes = (r) => r.errors.map((e) => e.code).sort();

test('a complete, valid create passes (control)', () => {
  assert.deepEqual(checkCustomObjectSteps([step([{ fieldKey: 'F_NAME', value: '{{contact.first_name}}' }, { fieldKey: 'F_SPECIES', value: 'Dog' }])], schemas).errors, []);
});
test('a field named by its fieldKey instead of its id is caught, with the id to use', () => {
  const r = checkCustomObjectSteps([step([{ fieldKey: 'custom_objects.pets.name', value: 'x' }, { fieldKey: 'F_SPECIES', value: 'Dog' }])], schemas);
  assert.match(r.errors.find((e) => e.code === 'CUSTOM_OBJECT_FIELD').message, /F_NAME/);
});
test('a ghost field, a bad option and a missing mandatory field are each named', () => {
  const r = checkCustomObjectSteps([step([{ fieldKey: 'F_GHOST', value: 'x' }, { fieldKey: 'F_SPECIES', value: 'Lizard' }])], schemas);
  assert.deepEqual(codes(r), ['CUSTOM_OBJECT_FIELD', 'CUSTOM_OBJECT_OPTION', 'CUSTOM_OBJECT_REQUIRED']);
});
test('update does not demand mandatory fields; clear does not judge values; non-settable types are refused', () => {
  assert.deepEqual(checkCustomObjectSteps([step([{ fieldKey: 'F_NAME', value: 'x' }], 'update_custom_object')], schemas).errors, []);
  assert.deepEqual(checkCustomObjectSteps([step([{ fieldKey: 'F_SPECIES', value: 'Lizard' }], 'clear_custom_object_fields')], schemas).errors, []);
  assert.deepEqual(codes(checkCustomObjectSteps([step([{ fieldKey: 'F_SIG', value: 'x' }], 'update_custom_object')], schemas)), ['CUSTOM_OBJECT_FIELD_TYPE']);
});
test('an object that does not exist, an unread schema, and an empty step', () => {
  assert.deepEqual(codes(checkCustomObjectSteps([step([{ fieldKey: 'F_NAME', value: 'x' }])], new Map([['custom_objects.pets', null]]))), ['CUSTOM_OBJECT_NOT_FOUND']);
  const nc = checkCustomObjectSteps([step([{ fieldKey: 'F_NAME', value: 'x' }])], new Map());
  assert.equal(nc.errors.length, 0); assert.equal(nc.notChecked.length, 1);
  assert.deepEqual(codes(checkCustomObjectSteps([step([], 'update_custom_object')], schemas)), ['CUSTOM_OBJECT_EMPTY']);
});
test('CRM objects are not judged here, and only custom-object keys are fetched', () => {
  assert.deepEqual(referencedObjectKeys([step([], 'create_custom_object', { key: 'contact' }), step([]), { type: 'sms' }]), ['custom_objects.pets']);
});
test('existence comes from the object LIST, never from a 4xx on the detail read', async () => {
  const call = async (_m, p) => (p.startsWith('/objects/?') ? { ok: true, json: { objects: [{ key: 'custom_objects.pets' }] } }
    : { ok: false, status: 404, json: 'Not Found' });
  const m = await fetchObjectSchemas(call, 'LOC', ['custom_objects.pets', 'custom_objects.ghost']);
  assert.equal(m.has('custom_objects.pets'), false, 'a failed detail read is NOT CHECKED, not absent');
  assert.equal(m.get('custom_objects.ghost'), null, 'absent from the list = does not exist');
});
