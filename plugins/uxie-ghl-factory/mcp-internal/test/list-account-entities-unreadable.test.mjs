// w6d-9 (3): list_account_entities must tell "none" from "read failed". fetchEntities records a failed leg in `unreadable`, but as a
// NON-enumerable property (the resolver's dependency abort reads it), so the JSON result dropped it: a pipeline read that failed (500)
// looked exactly like an account with no pipelines. This test fails until the tool surfaces the failed legs as data. RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'list_account_entities');
const LOC = 'LOC1';

// Pipelines fail with a 500. Calendars answer with an empty list (a genuinely empty account object). Everything else answers an empty body.
const deps = () => ({
  state: {},
  makeGw: () => ({
    call: async (method, path) => {
      if (path.includes('/opportunities/pipelines')) return { ok: false, status: 500, json: null };
      if (path.includes('/calendars/')) return { ok: true, status: 200, json: { calendars: [] } };
      return { ok: true, status: 200, json: {} };
    },
  }),
});

test('list_account_entities is registered', () => {
  assert.ok(tool, 'list_account_entities must be registered');
});

test('a failed read is listed in the result (status and key), so it is not confused with an empty account object', async () => {
  const res = await tool.handler({ locationId: LOC }, deps());
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.data.unreadable), 'the failed legs must be a key of the result, not a hidden property');
  const failed = res.data.unreadable.filter((u) => u.status === 500);
  assert.equal(failed.length, 1, `expected exactly one 500 read, got ${JSON.stringify(res.data.unreadable)}`);
  assert.equal(typeof failed[0].key, 'string');
});

test('an empty leg that did NOT fail is not listed as unreadable (calendars answered with an empty list)', async () => {
  const res = await tool.handler({ locationId: LOC }, deps());
  const keys = res.data.unreadable.map((u) => u.key);
  assert.ok(!keys.includes('calendars'), `calendars answered ok and must not be listed: ${JSON.stringify(res.data.unreadable)}`);
});

test('the new key is enumerable (it survives JSON) and the registry object keys are still present', async () => {
  const res = await tool.handler({ locationId: LOC }, deps());
  assert.ok(Object.keys(res.data).includes('unreadable'), 'unreadable must be an enumerable key of the result');
  assert.ok(Object.keys(res.data).length > 1, 'the registry keys must still be present beside it');
});
