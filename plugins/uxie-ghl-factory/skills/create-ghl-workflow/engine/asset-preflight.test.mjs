import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssets, describeFinding } from './asset-preflight.mjs';

const OK = (json) => async () => ({ ok: true, status: 200, json });
const payload = { templates: [{ id: 'a', type: 'wait' }], triggers: [], companyId: 'C1' };

// A real finding, copied verbatim from the live GROM AU response 2026-08-21.
const LIVE_ERROR = {
  ruleId: 'ASSET_WORKFLOW_NOT_FOUND',
  assetType: 'workflow',
  assetId: 'ffffffff-dead-4000-8000-ffffffffffff',
  message: 'Referenced Workflow does not exist or does not belong to this location.',
  severity: 'error',
  stepId: 'aaaaaaaa-0000-4000-8000-000000000002',
  stepName: 'Add to missing workflow',
  stepType: 'add_to_workflow',
};

test('parses a clean response', async () => {
  const r = await validateAssets(OK({ errors: [], warnings: [] }), 'LOC', payload);
  assert.equal(r.checked, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('parses a live error finding without losing any field', async () => {
  const r = await validateAssets(OK({ errors: [LIVE_ERROR], warnings: [] }), 'LOC', payload);
  assert.equal(r.checked, true);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0], LIVE_ERROR);
});

test('sends the exact request shape GHL expects', async () => {
  let seen = null;
  const call = async (method, path, body) => { seen = { method, path, body }; return { ok: true, status: 200, json: { errors: [], warnings: [] } }; };
  await validateAssets(call, 'LOC 1', payload);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.path, '/workflow/LOC%201/validate-assets');   // location is encoded
  assert.deepEqual(Object.keys(seen.body).sort(), ['companyId', 'templates', 'triggers']);
});

test('companyId is OPTIONAL — omitted from the body when absent, and still checked', async () => {
  // Live-proven 2026-08-21: the same bad assign_user reference returns ASSET_USER_NOT_FOUND
  // with and without companyId. The engine has no company id (orchestrate passes cid:undefined),
  // so gating on it would make this pre-flight a silent no-op in production.
  let seen = null;
  const call = async (m, p, b) => { seen = b; return { ok: true, status: 200, json: { errors: [LIVE_ERROR], warnings: [] } }; };
  const r = await validateAssets(call, 'LOC', { templates: payload.templates, triggers: [] });
  assert.equal('companyId' in seen, false, 'no companyId key when we do not have one');
  assert.equal(r.checked, true, 'still ran');
  assert.equal(r.errors.length, 1, 'still caught the bad reference');
});

test('non-array triggers are normalised to []', async () => {
  let seen = null;
  const call = async (m, p, b) => { seen = b; return { ok: true, status: 200, json: { errors: [], warnings: [] } }; };
  await validateAssets(call, 'LOC', { ...payload, triggers: undefined });
  assert.deepEqual(seen.triggers, []);
});

// ── fail-open: this runs before the create, so it must never invent a new failure mode ──
test('FAIL-OPEN: a transport throw is skipped, not an error', async () => {
  const call = async () => { throw new Error('ECONNRESET'); };
  const r = await validateAssets(call, 'LOC', payload);
  assert.equal(r.checked, false);
  assert.match(r.skipped, /ECONNRESET/);
  assert.deepEqual(r.errors, []);
});

test('FAIL-OPEN: a non-ok status is skipped, not an error', async () => {
  const r = await validateAssets(async () => ({ ok: false, status: 404, json: null }), 'LOC', payload);
  assert.equal(r.checked, false);
  assert.match(r.skipped, /404/);
  assert.deepEqual(r.errors, []);
});

test('FAIL-OPEN: an unrecognised body shape is skipped, not an error', async () => {
  const r = await validateAssets(OK({ something: 'else' }), 'LOC', payload);
  assert.equal(r.checked, false);
  assert.match(r.skipped, /unrecognised/);
});

test('FAIL-OPEN: missing templates skips without calling out', async () => {
  let called = false;
  const call = async () => { called = true; return { ok: true, status: 200, json: {} }; };
  const b = await validateAssets(call, 'LOC', { ...payload, templates: undefined });
  assert.equal(b.checked, false);
  assert.equal(called, false, 'must not hit the network with nothing to validate');
});

// ── the differential that defines this endpoint's scope ──
test('SCOPE: a shape-broken step validating clean is reported as clean, not as proof of validity', async () => {
  // Live-proven 2026-08-21: a wait with type:'time' and startAfter DELETED — which GHL's own
  // wait-validator marks as an error — returns {errors:[],warnings:[]}. The module must
  // faithfully report that as clean; callers must not read silence as "shape is fine".
  const r = await validateAssets(OK({ errors: [], warnings: [] }), 'LOC', {
    templates: [{ id: 'w', type: 'wait', attributes: { type: 'time' } }], triggers: [], companyId: 'C1',
  });
  assert.equal(r.checked, true);
  assert.deepEqual(r.errors, []);
});

test('describeFinding names the step and the missing asset', () => {
  assert.equal(
    describeFinding(LIVE_ERROR),
    'Add to missing workflow: Referenced Workflow does not exist or does not belong to this location. '
    + '(workflow ffffffff-dead-4000-8000-ffffffffffff)',
  );
});

test('describeFinding degrades when the finding is sparse', () => {
  assert.equal(describeFinding({ message: 'boom' }), 'workflow: boom');
});
