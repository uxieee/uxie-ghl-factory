// Handler tests for get_contact_ai_status / set_contact_ai_status — the per-contact
// Conversation AI toggle. These two tools were shipped in the published 0.20.0 build but
// their source was never committed to this repo (recovered from the installed plugin
// cache; see docs/superpowers/notes/2026-08-16-contact-ai-tool-restore.md). Restored
// verbatim; this file locks the one behaviour that cost a reverse-engineering session to
// learn: the PUT REPLACES the reactivation pair rather than merging it, so the write must
// always carry the whole intent — including explicit nulls when "no reactivation" is meant
// — never omit the pair and hope the server keeps or clears it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
const AI_BASE = 'https://services.leadconnectorhq.com';

// A gw stub whose GET returns `beforeConfig` on the first call and `afterConfig` (default:
// same as before) on every subsequent call — matching the tool's own read -> write ->
// read-back sequence — while recording every call's method/path/body/opts for assertion.
function depsFixture({
  configId = 'cfg-1',
  beforeConfig = {},
  afterConfig = null,
  writeFailure = null,
  writeThrows = false,
  noConfigId = false,
} = {}) {
  const calls = [];
  let getCount = 0;
  const gw = {
    loc: 'L',
    uid: 'u',
    call: async (method, path, body, opts) => {
      calls.push({ method, path, body, opts });
      if (method === 'GET') {
        getCount += 1;
        if (noConfigId) return { status: 200, ok: true, json: {} };
        const json = getCount === 1
          ? { id: configId, ...beforeConfig }
          : { id: configId, ...(afterConfig ?? beforeConfig) };
        return { status: 200, ok: true, json };
      }
      if (method === 'PUT') {
        if (writeThrows) throw new Error('transport lost after PUT was sent');
        if (writeFailure) return writeFailure;
        return { status: 200, ok: true, json: { id: configId, ...(afterConfig ?? beforeConfig) } };
      }
      return { status: 404, ok: false, json: { message: `unstubbed ${method} ${path}` } };
    },
  };
  return { calls, deps: { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw } };
}

test('both contact-AI tools are registered', () => {
  assert.ok(tool('get_contact_ai_status'), 'get_contact_ai_status must exist');
  assert.ok(tool('set_contact_ai_status'), 'set_contact_ai_status must exist');
});

// ---------------------------------------------------------------------------
// get_contact_ai_status
// ---------------------------------------------------------------------------

test('get_contact_ai_status returns the summarized config shape', async () => {
  const { deps, calls } = depsFixture({
    configId: 'cfg-1',
    beforeConfig: {
      status: 'active',
      sleepingTill: null,
      reactivateAfterTimeValue: null,
      reactivateAfterTimeUnit: null,
      assignedEmployee: { id: 'emp-1' },
      updatedAt: '2026-08-01T00:00:00.000Z',
      // Present in the live capture but never characterised — must not leak into the summary.
      messageCount: 5,
      followupTaskId: 'task-1',
      agentLogsSessionId: 'sess-1',
    },
  });
  const result = await tool('get_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C' },
    deps,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    { ...result.data, config: undefined },
    {
      configId: 'cfg-1',
      status: 'active',
      sleepingTill: null,
      reactivateAfterTimeValue: null,
      reactivateAfterTimeUnit: null,
      assignedEmployeeId: 'emp-1',
      updatedAt: '2026-08-01T00:00:00.000Z',
      config: undefined,
    },
  );
  // The raw config is carried too, alongside the summary — but the summary itself is what
  // is characterised and promised.
  assert.equal(result.data.config.messageCount, 5);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].opts.base, AI_BASE);
  assert.ok(calls[0].path.startsWith('/conversations-ai/employeeConfigs?'));
  const query = new URLSearchParams(calls[0].path.split('?')[1]);
  assert.equal(query.get('locationId'), 'L');
  assert.equal(query.get('contactId'), 'C');
  assert.equal(query.has('conversationId'), false, 'omitted conversationId must not be sent as an empty string');
});

test('get_contact_ai_status forwards a non-empty conversationId, and surfaces an HTTP failure', async () => {
  const { deps, calls } = depsFixture({ configId: 'cfg-1', beforeConfig: { status: 'inactive' } });
  const result = await tool('get_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', conversationId: 'conv-1' },
    deps,
  );
  assert.equal(result.ok, true);
  const query = new URLSearchParams(calls[0].path.split('?')[1]);
  assert.equal(query.get('conversationId'), 'conv-1');

  const failing = depsFixture({});
  failing.deps.makeGw = () => ({
    call: async () => ({ status: 403, ok: false, json: { message: 'no' } }),
  });
  const failResult = await tool('get_contact_ai_status').handler({ locationId: 'L', contactId: 'C' }, failing.deps);
  assert.equal(failResult.ok, false);
  assert.equal(failResult.code, 'ACCESS_DENIED');
});

// ---------------------------------------------------------------------------
// set_contact_ai_status — validation and preview
// ---------------------------------------------------------------------------

test('set_contact_ai_status rejects an invalid status before any gateway is built', async () => {
  let built = false;
  const deps = { state: {}, makeGw: () => { built = true; throw new Error('must not build a gateway'); } };
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'sleeping', confirm: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.equal(built, false);
});

test('set_contact_ai_status rejects a reactivation window given alongside status:"active"', async () => {
  let built = false;
  const deps = { state: {}, makeGw: () => { built = true; throw new Error('must not build a gateway'); } };
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'active', reactivateAfterTimeValue: 5, confirm: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.equal(built, false);
});

test('set_contact_ai_status preview (confirm:false) makes no gateway call and no write', async () => {
  let built = false;
  const deps = { state: {}, makeGw: () => { built = true; throw new Error('preview must not build a gateway'); } };
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive' },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.method, 'PUT');
  assert.equal(result.data.preview.path, '/conversations-ai/employeeConfigs/{configId}');
  assert.deepEqual(result.data.preview.body.data, {
    status: 'inactive',
    reactivateAfterTimeValue: null,
    reactivateAfterTimeUnit: null,
  });
  assert.equal(built, false, 'the preview must not resolve a configId — that GET auto-creates a config');
});

// ---------------------------------------------------------------------------
// set_contact_ai_status — the load-bearing replace-not-merge write behaviour
// ---------------------------------------------------------------------------

test('set_contact_ai_status sends the FULL intent with EXPLICIT nulls when no reactivation is meant (replace, not merge)', async () => {
  const { deps, calls } = depsFixture({
    configId: 'cfg-1',
    // A previously-set 99-hour reactivation — exactly the value that was live-observed to
    // get silently nulled out by a `{"status":"active"}`-only PUT.
    beforeConfig: { status: 'active', sleepingTill: null, reactivateAfterTimeValue: 99, reactivateAfterTimeUnit: 'hour' },
    afterConfig: { status: 'inactive', sleepingTill: null, reactivateAfterTimeValue: null, reactivateAfterTimeUnit: null },
  });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', confirm: true },
    deps,
  );
  assert.equal(result.ok, true, JSON.stringify(result));

  const putCall = calls.find((c) => c.method === 'PUT');
  assert.ok(putCall, 'a PUT must have been sent');
  assert.equal(putCall.path, '/conversations-ai/employeeConfigs/cfg-1');
  assert.equal(putCall.opts.base, AI_BASE);
  // The critical assertion: the pair is sent as EXPLICIT nulls, not omitted — a bare
  // `{status:"inactive"}` would let the server MERGE and keep the stale 99-hour value.
  assert.deepEqual(putCall.body, {
    locationId: 'L',
    data: { status: 'inactive', reactivateAfterTimeValue: null, reactivateAfterTimeUnit: null },
  });
  assert.equal(Object.hasOwn(putCall.body.data, 'reactivateAfterTimeValue'), true);
  assert.equal(Object.hasOwn(putCall.body.data, 'reactivateAfterTimeUnit'), true);

  assert.equal(result.data.applied, true);
  assert.deepEqual(result.data.mismatches, []);
  assert.equal(calls.filter((c) => c.method === 'GET').length, 2, 'resolve-id read, then a read-back assertion');
});

test('set_contact_ai_status sends the reactivation pair verbatim when a window is requested', async () => {
  const { deps, calls } = depsFixture({
    configId: 'cfg-1',
    beforeConfig: { status: 'active', sleepingTill: null },
    afterConfig: { status: 'inactive', sleepingTill: '2026-08-20T00:00:00.000Z', reactivateAfterTimeValue: 24, reactivateAfterTimeUnit: 'hour' },
  });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', reactivateAfterTimeValue: 24, reactivateAfterTimeUnit: 'hour', confirm: true },
    deps,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(putCall.body.data, { status: 'inactive', reactivateAfterTimeValue: 24, reactivateAfterTimeUnit: 'hour' });
  assert.equal(result.data.applied, true);
});

test('set_contact_ai_status defaults the unit to "hour" when a bare positive value is given', async () => {
  const { deps, calls } = depsFixture({
    configId: 'cfg-1',
    beforeConfig: { status: 'active' },
    afterConfig: { status: 'inactive', sleepingTill: '2026-08-20T00:00:00.000Z', reactivateAfterTimeValue: 3, reactivateAfterTimeUnit: 'hour' },
  });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', reactivateAfterTimeValue: 3, confirm: true },
    deps,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(putCall.body.data, { status: 'inactive', reactivateAfterTimeValue: 3, reactivateAfterTimeUnit: 'hour' });
});

// ---------------------------------------------------------------------------
// set_contact_ai_status — failure and ambiguity paths
// ---------------------------------------------------------------------------

test('set_contact_ai_status aborts with no write attempted when the id-resolving read returns no config id', async () => {
  const { deps, calls } = depsFixture({ noConfigId: true });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', confirm: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(calls.some((c) => c.method === 'PUT'), false, 'no write may be attempted without a resolved id');
});

test('set_contact_ai_status marks the write AMBIGUOUS (never a clean failure) when the PUT transport throws', async () => {
  const { deps } = depsFixture({
    configId: 'cfg-1',
    beforeConfig: { status: 'active' },
    writeThrows: true,
  });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', confirm: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.data.partialProgress.write.attempted, true);
  assert.equal(result.data.partialProgress.write.acknowledged, false);
  assert.equal(result.data.partialProgress.write.ambiguous, true);
  assert.match(result.remediation, /URGENT/);
  assert.match(result.remediation, /get_contact_ai_status/);
});

test('set_contact_ai_status reports a coded HTTP failure from the PUT without claiming ambiguity', async () => {
  const { deps, calls } = depsFixture({
    configId: 'cfg-1',
    beforeConfig: { status: 'active' },
    writeFailure: { status: 422, ok: false, json: { message: 'rejected' } },
  });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', confirm: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.data.partialProgress.write.attempted, true);
  assert.equal(result.data.partialProgress.write.acknowledged, false);
  assert.equal(calls.filter((c) => c.method === 'GET').length, 1, 'a rejected write must not proceed to a read-back');
});

test('set_contact_ai_status reports a mismatch, never a false ok, when the read-back disagrees with the intent', async () => {
  const { deps } = depsFixture({
    configId: 'cfg-1',
    beforeConfig: { status: 'active', sleepingTill: null },
    // The write was acknowledged (200) but the observed state never actually flipped.
    afterConfig: { status: 'active', sleepingTill: null },
  });
  const result = await tool('set_contact_ai_status').handler(
    { locationId: 'L', contactId: 'C', status: 'inactive', confirm: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.applied, false);
  assert.ok(result.data.mismatches.length > 0);
  assert.match(result.remediation, /URGENT/);
});
