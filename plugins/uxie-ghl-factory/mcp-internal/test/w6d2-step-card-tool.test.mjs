// w6d-2 (plan Task 2): describe_step_type carries the richer card fields. Calls the registered handler (the same one the server runs).
// The card is read from the catalogue, so no account is touched: describe_step_type is a read with no capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'describe_step_type');
const parse = (r) => (typeof r === 'string' ? JSON.parse(r) : r);

test('describe_step_type {type:"update_contact_field"} carries assetReferences, requiredEnforcement and hasDynamicOptions', async () => {
  const out = parse(await tool.handler({ type: 'update_contact_field' }, {}));
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 300));
  assert.ok(Array.isArray(out.data.assetReferences));
  assert.equal(out.data.assetReferences[0].field, 'fields[].id');
  assert.equal(out.data.requiredEnforcement.actionType, 'builder');
  assert.equal(typeof out.data.hasDynamicOptions, 'object');
  assert.equal('triggerFilters' in out.data, false, 'a step card carries no triggerFilters');
});

test('describe_step_type on a trigger carries triggerFilters with known, observed and complete', async () => {
  const out = parse(await tool.handler({ type: 'appointment' }, {}));
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 300));
  const tf = out.data.triggerFilters;
  assert.ok(tf && typeof tf.known === 'number' && typeof tf.observed === 'number' && typeof tf.complete === 'boolean', JSON.stringify(tf));
});

test('describe_step_type on an unknown type stays a typed UNKNOWN_TYPE error (the extras never throw)', async () => {
  const out = parse(await tool.handler({ type: 'no_such_type_zz' }, {}));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'UNKNOWN_TYPE');
});

test('the describe_step_type description stays within 2048 characters', () => {
  assert.ok(tool.description.length <= 2048, `description is ${tool.description.length} characters`);
});
