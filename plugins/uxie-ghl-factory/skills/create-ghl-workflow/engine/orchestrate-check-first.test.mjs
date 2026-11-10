// W6a items 3 + 4: check everything first, create nothing on a refusal, mark a refused draft.
// Before: inline email templates and missing tags were POSTed at step 3, BEFORE compile, the validation gate and
// validate-assets — so a spec any later check refused still left templates and tags behind. These tests assert on the
// recorded CALL LOG, not on the report alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate } from './orchestrate.mjs';

function mockGateway({ tags = [], assets = { errors: [], warnings: [] }, server = { valid: true } } = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: [] } };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, json: { tags: tags.map((n) => ({ name: n })) } };
    if (method === 'POST' && path.match(/\/tags$/)) return { ok: true, json: { id: 'TAG_' + body.name } };
    if (method === 'POST' && path === '/emails/builder') return { ok: true, status: 201, json: { id: 'TEMPLATE_1' } };
    if (method === 'POST' && path === '/emails/builder/data') return { ok: true, json: {} };
    if (method === 'POST' && path.includes('/validate-assets')) return { ok: true, status: 200, json: assets };
    if (method === 'POST' && path.includes('/validate-workflows')) return { ok: true, status: 200, json: server };
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'PUT' && path.includes('/rename-workflow/')) return { ok: true, json: {} };
    if (method === 'PUT' && path.includes('/auto-save')) return { ok: true, json: {} };
    if (method === 'GET' && path.includes('/workflow/')) return { ok: true, json: { status: 'draft', name: '[REFUSED] W', workflowData: { templates: [] } } };
    if (method === 'GET') return { ok: true, json: {} };
    return { ok: true, json: {} };
  };
  return { gw: { call, loc: 'LOC', uid: 'UID' }, calls };
}

const STATELESS_POST = /\/validate-assets$|\/workflow\/custom-code\/run-test$/;
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && !STATELESS_POST.test(c.path));

const spec = (extraGraph = []) => ({
  name: 'W',
  triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: 'new-tag' }] }],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['new-tag'] } },
    { ref: 'e', kind: 'action', type: 'email', name: 'Email',
      attributes: { subject: 'Hello', _template: { title: 'Shared email', html: '<p>Hello</p>', previewText: 'Hello' } } },
    ...extraGraph,
  ],
});
const unassociatedUpdate = { ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Upd',
  attributes: { updates: [{ field: 'status', value: 'won' }] } };
const ASSET_ERR = { ruleId: 'ASSET_USER_NOT_FOUND', assetType: 'user', assetId: 'GONE',
  message: 'Referenced User does not exist or does not belong to this location.', severity: 'error', stepId: 'S1', stepName: 'Assign', stepType: 'assign_user' };

test('a compile error makes no write at all — no tag, no email template', async () => {
  const { gw, calls } = mockGateway();
  const report = await orchestrate(spec([unassociatedUpdate]), gw);
  assert.match(report.aborted, /OPP_UNASSOCIATED/);
  assert.deepEqual(writes(calls), []);
  assert.deepEqual(report.createdTags, []);
  assert.deepEqual(report.createdTemplates, []);
});

test('a validate-assets refusal makes no write: its POST is the only non-GET call', async () => {
  const { gw, calls } = mockGateway({ assets: { errors: [ASSET_ERR], warnings: [] } });
  const report = await orchestrate(spec(), gw);
  assert.equal(report.failurePhase, 'validate_assets');
  assert.deepEqual(writes(calls), []);
});

test('the tag and the template are created only after every check, and before the workflow create', async () => {
  const { gw, calls } = mockGateway();
  const report = await orchestrate(spec(), gw);
  assert.equal(report.aborted, null);
  const at = (re, m = 'POST') => calls.findIndex((c) => c.method === m && re.test(c.path));
  const assets = at(/\/validate-assets$/);
  assert.ok(assets !== -1);
  assert.ok(at(/^\/emails\/builder$/) > assets, 'template after validate-assets');
  assert.ok(at(/\/tags$/) > assets, 'tag after validate-assets');
  assert.ok(at(/\/workflow\/LOC$/) > at(/\/tags$/), 'workflow create after the tag');
  assert.deepEqual(report.createdTags, ['new-tag']);
  assert.deepEqual(report.createdTemplates, [{ title: 'Shared email', id: 'TEMPLATE_1' }]);
});

test('the real template id reaches the document; the pending placeholder reaches no call', async () => {
  const { gw, calls } = mockGateway();
  await orchestrate(spec(), gw);
  for (const c of calls) assert.equal(JSON.stringify(c.body ?? '').includes('__pending'), false, `${c.method} ${c.path}`);
  const save = calls.find((c) => c.method === 'PUT' && c.path.includes('/auto-save'));
  const email = save.body.workflowData.templates.find((t) => t.type === 'email');
  assert.equal(email.attributes.template_id, 'TEMPLATE_1');
  assert.equal(email.attributes.templatesource, 'email-builder');
});

test('a tag the build is about to create is not reported as a missing-tag warning', async () => {
  const tagWarn = { ruleId: 'ASSET_TAG_NOT_FOUND', assetType: 'tag', assetId: 'new-tag', message: 'Referenced Tag does not exist or does not belong to this location.', severity: 'warning', stepId: 'S', stepName: 'Tag', stepType: 'add_contact_tag' };
  const { gw } = mockGateway({ assets: { errors: [], warnings: [tagWarn] } });
  const report = await orchestrate(spec(), gw);
  assert.equal(report.warnings.some((w) => /ASSET_TAG_NOT_FOUND|Referenced Tag/.test(w)), false);
  assert.deepEqual(report.assetPreflight.pendingCreation, [{ assetType: 'tag', assetId: 'new-tag' }]);
});

test('dryRun: only GETs and the stateless validate-assets POST; reports what it would create', async () => {
  const { gw, calls } = mockGateway();
  const report = await orchestrate(spec(), gw, { dryRun: true });
  assert.deepEqual(writes(calls), []);
  assert.equal(report.wid, null);
  assert.equal(report.check.valid, true);
  assert.deepEqual(report.check.errors, []);
  assert.equal(report.check.server, 'not run (no workflow)');
  assert.deepEqual(report.check.wouldCreate, { tags: ['new-tag'], templates: ['Shared email'] });
});

test('dryRun collects the asset error as {code, path, stage, context}', async () => {
  const { gw, calls } = mockGateway({ assets: { errors: [ASSET_ERR], warnings: [] } });
  const report = await orchestrate(spec(), gw, { dryRun: true });
  assert.deepEqual(writes(calls), []);
  assert.equal(report.check.valid, false);
  assert.deepEqual(report.check.errors, [{ code: 'ASSET_USER_NOT_FOUND', path: 'S1', stage: 'validate_assets',
    context: 'Assign: Referenced User does not exist or does not belong to this location. (user GONE)' }]);
});

test('dryRun on a compile error: valid:false, stage compile, the IRError code', async () => {
  const { gw, calls } = mockGateway();
  const report = await orchestrate(spec([unassociatedUpdate]), gw, { dryRun: true });
  assert.deepEqual(writes(calls), []);
  assert.equal(report.check.valid, false);
  assert.equal(report.check.errors[0].stage, 'compile');
  assert.equal(report.check.errors[0].code, 'OPP_UNASSOCIATED');
});

test('a server-gate refusal renames the empty draft [REFUSED] <name>, writes no step, and returns the leftovers', async () => {
  const server = { valid: false, errorMetadata: { validationFailure: true, validationType: 'action',
    errors: [{ message: 'bad step', severity: 'error', stepId: 'X', stepName: 'Email', stepType: 'email' }] } };
  const { gw, calls } = mockGateway({ server });
  const report = await orchestrate(spec(), gw);
  assert.equal(report.failurePhase, 'validation_server');
  const rename = calls.find((c) => c.method === 'PUT' && c.path === '/workflow/LOC/rename-workflow/WID_1');
  assert.ok(rename, 'rename PUT sent');
  assert.deepEqual(rename.body, { name: '[REFUSED] W' });
  assert.equal(calls.some((c) => c.method === 'PUT' && c.path.includes('/auto-save')), false, 'no step written');
  assert.deepEqual(report.leftovers, { workflowId: 'WID_1', name: '[REFUSED] W', renameVerified: true,
    tags: ['new-tag'], templates: [{ title: 'Shared email', id: 'TEMPLATE_1' }] });
});

test('a pending tag GHL flags on both the trigger and the step is listed once (live 2026-10-30: two findings, one tag)', async () => {
  const f = (stepId) => ({ ruleId: 'ASSET_TAG_NOT_FOUND', assetType: 'tag', assetId: 'new-tag', message: 'Referenced Tag does not exist or does not belong to this location.', severity: 'warning', stepId, stepName: null, stepType: null });
  const { gw } = mockGateway({ assets: { errors: [], warnings: [f(null), f('S')] } });
  const report = await orchestrate(spec(), gw, { dryRun: true });
  assert.deepEqual(report.assetPreflight.pendingCreation, [{ assetType: 'tag', assetId: 'new-tag' }]);
});

// Final review W6a (Important #6): a dry run returned at the first missing dependency, so a spec with an unknown name AND
// a compile error took two calls to learn both.
test('dryRun reports a missing dependency AND the compile error in one call', async () => {
  const { gw } = mockGateway();
  const ghost = { ref: 'o', kind: 'action', type: 'create_opportunity', name: 'Op', attributes: { name: 'D', pipeline: 'Ghost', status: 'open' } };
  const report = await orchestrate(spec([ghost, unassociatedUpdate]), gw, { dryRun: true });
  const stages = report.check.errors.map((e) => e.stage);
  assert.ok(stages.includes('dependency_resolution'), JSON.stringify(report.check.errors));
  assert.ok(report.check.errors.some((e) => e.stage === 'compile'), JSON.stringify(report.check.errors));
});

// Final review W6a (Important #7): orchestrate mutated the caller's spec (the inline template became a placeholder id),
// so a second build on the same object created no template and sent __pending_email_template_0__ to GHL.
test('the caller\'s spec is not mutated: a dry run then a real build on the same object creates the template', async () => {
  const ir = spec();
  const before = JSON.stringify(ir);
  await orchestrate(ir, mockGateway().gw, { dryRun: true });
  assert.equal(JSON.stringify(ir), before);
  const { gw, calls } = mockGateway();
  await orchestrate(ir, gw);
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/emails/builder'));
  for (const c of calls) assert.equal(JSON.stringify(c.body ?? '').includes('__pending'), false, `${c.method} ${c.path}`);
});
