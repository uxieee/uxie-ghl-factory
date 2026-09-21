// The redacted-payload write guard (PROPOSAL-redacted-payload-guard.md, approved 2026-09-21).
//
// scrubSecrets (core/errors.mjs) redacts a secret-named field to the literal placeholder on the
// way OUT, by KEY NAME, without reading the value — so a healthy secret and one already
// overwritten with the placeholder come back byte-identical through every read rail. Nothing
// stopped that placeholder being written back IN on top of a real credential: repair_workflow's
// own round-trip verify reports roundTrip:true, because the document really did store what was
// sent. This suite proves the guard closes that on every whole-document write path: repair_workflow
// (templatesPath and inline), edit_workflow's modifyStep attrPatch bypass, and raw_request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { REDACTED } from '../core/errors.mjs';
import { refuseRedactedWrite } from '../core/raw-request-guards.mjs';

const repairTool = () => TOOLS.find((t) => t.name === 'repair_workflow');
const editTool = () => TOOLS.find((t) => t.name === 'edit_workflow');
const rawRequestTool = () => TOOLS.find((t) => t.name === 'raw_request');

const repairDeps = { state: {}, makeGw: () => ({ call: async () => ({ status: 200, json: {} }) }) };

// ---- core function: repuseRedactedWrite (pure, payload-shape-agnostic) ------------------------

test('refuseRedactedWrite: one redacted step is named id beside name, and the field path is reported', () => {
  const templates = [
    { id: '28a7ad81', name: 'Generate team summary (worker)', type: 'facebook_conversion_api',
      attributes: { accessToken: REDACTED } },
  ];
  const r = refuseRedactedWrite(templates);
  assert.ok(r, 'reverting the guard makes this null — the payload IS the placeholder');
  assert.match(r.message, /28a7ad81 "Generate team summary \(worker\)"/);
  assert.match(r.message, /attributes\.accessToken/);
  assert.match(r.message, /facebook_conversion_api/);
});

test('refuseRedactedWrite: several offending steps are all named, and the cap reports an accurate "+N more"', () => {
  const templates = Array.from({ length: 9 }, (_, i) => ({
    id: `s${i}`, name: `Step ${i}`, type: 'facebook_conversion_api',
    attributes: { accessToken: REDACTED },
  }));
  const r = refuseRedactedWrite(templates);
  assert.ok(r);
  for (let i = 0; i < 6; i++) assert.match(r.message, new RegExp(`s${i} "Step ${i}"`));
  assert.doesNotMatch(r.message, /s6 "Step 6"/, 'the 7th step must be folded into the "+N more" count, not named');
  assert.match(r.message, /, and 3 more/);
});

test('refuseRedactedWrite: the marker nested deep inside a step (a code string, or under attributes.…) is still found', () => {
  // The custom_code case from the proposal: `Authorization: 'Bearer ' + inputData.pit` gets
  // scrubbed by the TEXT scrubber (errors.mjs `scrub()`), which rewrites the marker INLINE inside
  // the longer code string rather than replacing the whole field — so the hit is a substring, not
  // an exact-equality match on `attributes.code`.
  const codeStep = { id: 's1', name: 'Worker', type: 'custom_code',
    attributes: { code: `const headers = { Authorization: 'Bearer ${REDACTED}' };` } };
  const codeHit = refuseRedactedWrite([codeStep]);
  assert.ok(codeHit, 'a marker embedded inside a longer code string must still be found');
  assert.match(codeHit.message, /attributes\.code/);

  const deepStep = { id: 's2', name: 'Deep', type: 'custom_webhook',
    attributes: { headers: [{ key: 'X', value: REDACTED }] } };
  const deepHit = refuseRedactedWrite([deepStep]);
  assert.ok(deepHit);
  assert.match(deepHit.message, /attributes\.headers\[0\]\.value/);
});

test('CONTROL: a clean payload with real-looking values is not refused', () => {
  const templates = [
    { id: 's1', name: 'Real hook', type: 'custom_webhook',
      attributes: { url: 'https://example.test/h', authorization: { type: 'NONE', data: null } } },
    { id: 's2', name: 'Real tag', type: 'add_contact_tag', attributes: { tags: ['vip'] } },
    { id: 's3', name: 'Real CAPI', type: 'facebook_conversion_api',
      attributes: { accessToken: 'EAAB1234567890realtokenlookinglong' } },
  ];
  assert.equal(refuseRedactedWrite(templates), null);
});

test('CONTROL: the word "redacted" in harmless prose (a step NAME) is not refused — the marker, not the word', () => {
  const templates = [
    { id: 's1', name: 'Fields redacted for demo screenshot', type: 'add_contact_tag', attributes: { tags: ['x'] } },
    { id: 's2', name: 'Note', type: 'add_contact_tag', attributes: { note: 'client asked these be redacted before sharing' } },
  ];
  assert.equal(refuseRedactedWrite(templates), null);
});

// ---- repair_workflow: the measured route (templatesPath's inline equivalent) -------------------

test('repair_workflow REFUSES a document still carrying the redaction placeholder, VALIDATION_FAILED, naming the step', async () => {
  const templates = [
    { id: '28a7ad81', name: 'Generate team summary (worker)', type: 'custom_webhook',
      attributes: { url: 'https://example.test/h', authorization: REDACTED } },
    { id: 's2', name: 'Tag', type: 'add_contact_tag', attributes: { tags: ['a'] } },
  ];
  const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'W', templates, confirm: true }, repairDeps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /28a7ad81 "Generate team summary \(worker\)"/);
  assert.match(r.detail, /attributes\.authorization/);
  assert.match(r.hint ?? r.remediation, /re-entered by hand/);
  assert.match(r.hint ?? r.remediation, /cannot be read back/);
});

test('repair_workflow: a document with REAL values is not blocked by this check (control)', async () => {
  const templates = [
    { id: 's1', name: 'Hook', type: 'custom_webhook', attributes: { authorization: { type: 'NONE', data: null } } },
    { id: 's2', name: 'Tag', type: 'add_contact_tag', attributes: { tags: ['a'] } },
  ];
  const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'W', templates, confirm: true }, repairDeps);
  // Not `r.ok` and not `r.code !== VALIDATION_FAILED` — repair_workflow's separate, pre-existing
  // tool-argument credential scanner can ALSO answer VALIDATION_FAILED on an unrelated shape. The
  // assertion specific to THIS guard is that its message never appears.
  assert.doesNotMatch(r.detail ?? '', /redaction placeholder/,
    `a real authorization object must pass this guard, got: ${r.detail}`);
});

// ---- edit_workflow: modifyStep's attrPatch bypasses the compiler, same as templatesPath --------

test('edit_workflow REFUSES a modifyStep attrPatch carrying the redaction placeholder', async () => {
  const initial = {
    _id: 'WID', id: 'WID', name: 'Ads Pixel', status: 'published', version: 3, filePath: 'keep.json',
    workflowData: { templates: [
      { id: 's1', type: 'facebook_conversion_api', name: 'CAPI step', next: null, parentKey: null, order: 0,
        attributes: { access_token: 'EAAB_real_token_value_1234567890', pixel_id: '123' } },
    ] },
  };
  const gw = {
    loc: 'LOC', uid: 'USER',
    call: async (method, path) => {
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { status: 200, ok: true, json: structuredClone(initial) };
      if (method === 'GET' && path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
      if (method === 'GET' && path === '/locations/LOC/customValues') return { status: 200, ok: true, json: { customValues: [] } };
      throw new Error(`unexpected call in redacted-guard test: ${method} ${path}`);
    },
  };
  const r = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { access_token: REDACTED } }],
  }, { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /s1 "CAPI step"/);
  assert.match(r.detail, /access_token/);
});

// ---- raw_request: not path-scoped, judges the payload wherever it lands ------------------------

test('raw_request REFUSES a write whose body carries the redaction placeholder, in the guard\'s own words', async () => {
  const gw = { loc: 'LOC', uid: 'USER', call: async () => { throw new Error('must not reach the gateway'); } };
  const body = { workflowData: { templates: [
    { id: 's1', name: 'Ads Pixel step', type: 'facebook_conversion_api', attributes: { accessToken: REDACTED } },
  ] } };
  const r = await rawRequestTool().handler({
    locationId: 'LOC', method: 'PUT', path: '/workflow/LOC/WID', body, confirm: true,
  }, { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /redaction placeholder/);
  assert.match(r.detail, /s1 "Ads Pixel step"/);
});

test('a READ is never refused by this guard — GET is not scanned even if the body(shape) carries the marker', async () => {
  const calls = [];
  const gw = { loc: 'LOC', uid: 'USER', call: async (method, path) => { calls.push({ method, path }); return { status: 200, ok: true, json: { workflow: {} } }; } };
  const r = await rawRequestTool().handler({
    locationId: 'LOC', method: 'GET', path: '/workflow/LOC/WID',
  }, { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1, 'the GET must actually reach the gateway, unrefused');
});
