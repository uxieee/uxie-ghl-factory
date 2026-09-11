// validate_workflow asks GHL's own server validator for a verdict. Stub shapes mirror the LIVE
// responses captured on the sandbox 2026-09-11 (knowledge/sniffs/live-2026-09-11-builder-additions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'validate_workflow');
const DOC = { _id: 'W', name: 'WF', status: 'draft', workflowData: { templates: [{ id: 's1', type: 'sms', attributes: { body: 'hi' } }], other: 1 } };
const TRIGGERS = [{ id: 'T1', type: 'conv_ai_trigger', name: 'Chat Initiated', conditions: [] }];

function gwStub({ triggers = { ok: true, status: 200, json: TRIGGERS }, verdict }) {
  const calls = [];
  return {
    calls,
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/trigger?')) return triggers;
      if (method === 'GET') return { ok: true, status: 200, json: DOC };
      if (method === 'POST' && path.endsWith('/validate-workflows')) return verdict;
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
}
const run = (gw, extra = {}) => tool.handler({ locationId: 'L', workflowId: 'W', ...extra }, { state: {}, makeGw: () => gw });

test('a pass is reported as valid, and the stored document is sent WITH its triggers', async () => {
  const gw = gwStub({ verdict: { ok: true, status: 200, json: { valid: true, message: 'Validation successful', assetWarnings: [] } } });
  const res = await run(gw);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.valid, true);
  assert.equal(res.data.triggersSent, 1);
  const post = gw.calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/workflow/L/W/validate-workflows');
  assert.deepEqual(post.body.newTriggers, TRIGGERS, 'without newTriggers the server skips the trigger layer and says valid');
  assert.deepEqual(post.body.workflowData, DOC.workflowData);
});

test('a 400 verdict is a result, not an error: layer, rule and entity come through', async () => {
  const gw = gwStub({ verdict: { ok: false, status: 400, json: {
    valid: false, message: 'Validation unsuccessful',
    errorMessage: 'Trigger: Chat Initiated is missing required fields.',
    errorMetadata: { validationFailure: true, validationType: 'trigger', errors: [
      { message: 'Bot is required', ruleId: 'missing-required-field', severity: 'error', source: 'trigger',
        triggerId: 'T1', triggerName: 'Chat Initiated', triggerType: 'conv_ai_trigger' }] },
  } } });
  const res = await run(gw);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.valid, false);
  assert.equal(res.data.layer, 'trigger');
  assert.equal(res.data.errors[0].ruleId, 'missing-required-field');
  assert.equal(res.data.errors[0].triggerId, 'T1');
  assert.match(res.data.note, /One layer per call/);
});

test('templates replace only workflowData.templates; the rest of the stored document is kept', async () => {
  const gw = gwStub({ verdict: { ok: true, status: 200, json: { valid: true, assetWarnings: [] } } });
  const edited = [{ id: 's1', type: 'sms', attributes: {} }];
  const res = await run(gw, { templates: edited });
  assert.equal(res.data.validated, 'the stored document with the supplied templates');
  const post = gw.calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.workflowData, { templates: edited, other: 1 });
  assert.equal(post.body.name, 'WF');
});

test('an unreadable trigger list stops before the POST: a verdict that skipped a layer is worse than none', async () => {
  const gw = gwStub({ triggers: { ok: false, status: 500, json: { message: 'boom' } }, verdict: null });
  const res = await run(gw);
  assert.equal(res.ok, false);
  assert.equal(gw.calls.some((c) => c.method === 'POST'), false);
});

test('a response that is not a verdict is reported as the HTTP failure, never as a pass or a fail', async () => {
  const gw = gwStub({ verdict: { ok: false, status: 404, json: 'Not Found' } });
  const res = await run(gw);
  assert.equal(res.ok, false);
  assert.equal(res.data?.valid, undefined);
});

test('it POSTs, so it declares the POST and stays out of the GET-only audit profile', () => {
  assert.deepEqual(tool.capabilities.map((c) => c.method), ['GET', 'GET', 'POST']);
  assert.ok(tool.capabilities.some((c) => c.path === '/workflow/{loc}/{wid}/validate-workflows'));
});
