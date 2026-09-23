import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateDocument, knownAttributeKeys, STEP_TOP_LEVEL_KEYS } from './document-gate.mjs';
import { validateForWrite } from './write-validation.mjs';
import { loadCatalog } from './catalog.mjs';
import { liveValidate } from './live-validate.mjs';

const catalog = loadCatalog();
const ucf = (over = {}) => ({ id: 's1', name: 'Set field', type: 'update_contact_field', order: 0,
  attributes: { type: 'update_contact_field', actionType: 'update_field_data', fields: [{ field: 'x', value: 'y' }] }, ...over });

test('a clean stored-shape step passes the engine oracle', () => {
  const r = gateDocument([ucf()], { catalog, marketplaceTypes: new Set() });
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
});

test('the classes GHL lets through are errors here: invented key, wrong inner type, extra top-level key', () => {
  const r = gateDocument([
    ucf({ id: 'a', attributes: { ...ucf().attributes, totallyInventedKey: 1 } }),
    ucf({ id: 'b', attributes: { ...ucf().attributes, type: 'no_such_inner_type' } }),
    ucf({ id: 'c', inventedTopLevelKey: true }),
  ], { catalog, marketplaceTypes: new Set() });
  assert.deepEqual(r.errors.map((f) => `${f.stepId}:${f.check}`).sort(), ['a:ATTRIBUTE_KEY', 'b:INNER_TYPE', 'c:TOP_LEVEL_KEY']);
});

test('an unknown type is an error once marketplace is ruled out, and only a warning before', () => {
  const t = [ucf({ type: 'no_such_action_type' })];
  assert.equal(gateDocument(t, { catalog, marketplaceTypes: new Set() }).errors[0].check, 'STEP_TYPE');
  assert.equal(gateDocument(t, { catalog }).errors.length, 0);
  assert.equal(gateDocument(t, { catalog }).warnings[0].check, 'STEP_TYPE');
});

test('a marketplace type stored without its flag is named, not refused', () => {
  const r = gateDocument([{ id: 'w', name: 'WA', type: 'send_outbound_whatsapp_message', order: 0, attributes: { type: 'send_outbound_whatsapp_message' } }],
    { catalog, marketplaceTypes: new Set(['send_outbound_whatsapp_message']) });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings[0].check, 'MARKETPLACE_FLAG');
});

test('calibration evidence is in the allowlists: advanced-canvas meta, and the if_else keys the card omits', () => {
  assert.ok(STEP_TOP_LEVEL_KEYS.has('advanceCanvasMeta'));
  const k = knownAttributeKeys('if_else', catalog.step('if_else'));
  for (const key of ['else', 'branches', 'operator', 'conditionName']) assert.ok(k.has(key), key);
});

test('scope turns a finding on an untouched step into a warning', () => {
  const r = gateDocument([ucf({ id: 'old', attributes: { ...ucf().attributes, junk: 1 } }), ucf({ id: 'new' })],
    { catalog, marketplaceTypes: new Set(), scope: new Set(['new']) });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings[0].stepId, 'old');
});

test('a check the caller already hatched is reported, not re-refused', () => {
  const r = gateDocument([ucf({ attributes: { ...ucf().attributes, junk: 1 } })],
    { catalog, marketplaceTypes: new Set(), waive: new Set(['ATTRIBUTE_KEY']) });
  assert.equal(r.errors.length, 0);
  assert.match(r.warnings[0].message, /acknowledged by the caller's own hatch/);
});

const gw = (verdict) => async () => ({ ok: verdict.valid === true, status: verdict.valid ? 200 : 400, json: verdict });
const refused = (message, ruleId) => ({ valid: false, errorMessage: message, errorMetadata: { validationFailure: true, validationType: 'action', errors: [{ message, ruleId }] } });

test('a server finding blocks a build; the hatch lets it through, still reported', async () => {
  const opts = { call: gw(refused('Fields is required.', 'x')), loc: 'L', wid: 'W', document: { workflowData: { templates: [ucf()] } }, catalog, marketplaceTypes: new Set() };
  const r = await validateForWrite(opts);
  assert.equal(r.blocked, true);
  assert.match(r.summary, /Fields is required/);
  const hatched = await validateForWrite({ ...opts, allow: true });
  assert.equal(hatched.blocked, false);
  assert.equal(hatched.serverBlocking.length, 1);
});

test('on an edit, only a server finding the write INTRODUCES blocks', async () => {
  const pre = refused('Bot is required', 'missing-required-field');
  // The baseline comes from the same call the gate makes, exactly as the write paths produce it —
  // a hand-written one tested a finding shape the parser never emits.
  const baseline = await liveValidate(gw(pre), 'L', 'W', { document: { workflowData: { templates: [ucf()] } } });
  const opts = { call: gw(pre), loc: 'L', wid: 'W', document: { workflowData: { templates: [ucf()] } }, catalog, marketplaceTypes: new Set(), baseline };
  const same = await validateForWrite(opts);
  assert.equal(same.blocked, false, 'a pre-existing finding must not freeze the workflow');
  const worse = await validateForWrite({ ...opts, call: gw(refused('Fields is required.', 'x')) });
  assert.equal(worse.blocked, true);
});

test('no verdict from the server is neither a pass nor a fail', async () => {
  const r = await validateForWrite({ call: async () => ({ ok: false, status: 502, json: 'Bad Gateway' }), loc: 'L', wid: 'W', document: { workflowData: { templates: [ucf()] } }, catalog, marketplaceTypes: new Set() });
  assert.equal(r.server.ran, false);
  assert.equal(r.blocked, false, 'a transport failure is reported, not turned into a refusal');
});

test('a key GHL\'s SERVER stamps on save is not an invented key — but an invented one beside it still is', () => {
  const drip = (extra) => [{ id: 's1', name: 'Drip', type: 'drip', attributes: { type: 'drip', batchSize: 1, interval: { timeUnit: 'minutes', value: 1 }, ...extra } }];
  const keyFindings = (tpl) => { const r = gateDocument(tpl, { catalog, marketplaceTypes: new Set() }); return [...r.errors, ...r.warnings].filter((f) => f.check === 'ATTRIBUTE_KEY'); };
  assert.deepEqual(keyFindings(drip({ configuredAt: '2026-09-18T19:49:11.397Z' })), [], 'the server\'s own stamp must not block a publish');
  const bad = keyFindings(drip({ configuredAt: 'x', inventedKey: 1 }));
  assert.equal(bad.length, 1); assert.match(bad[0].message, /inventedKey/); assert.doesNotMatch(bad[0].message, /configuredAt/);
});

// ── MULTIPATH_SHAPE (2026-09-23): a linear finder saves, validates and publishes clean ──────
test('MULTIPATH_SHAPE refuses a linear find_opportunity and passes a wired one', () => {
  const linear = [
    { id: 'h', type: 'add_contact_tag', name: 'H', next: 'f', order: 0, attributes: { tags: ['a'] } },
    { id: 'f', type: 'find_opportunity', name: 'F', next: null, parentKey: 'h', order: 1, workflowsActionType: 'INTERNAL',
      attributes: { type: 'find_opportunity', sorting: 'latest', __customInputFields__: [], __customInputs__: {} } },
  ];
  const bad = gateDocument(linear).errors.filter((e) => e.check === 'MULTIPATH_SHAPE');
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /not an array of branch ids/);
  const tr = (id, name) => ({ id, name, fields: [], meta: { __branchKey__: `predefined_${name}` }, conditionType: 'pre-defined' });
  const wired = [
    { id: 'f', type: 'find_opportunity', name: 'F', next: ['t1', 't2'], order: 0, cat: 'multi-path', workflowsActionType: 'INTERNAL',
      attributes: { type: 'find_opportunity', sorting: 'latest', __customInputFields__: [], __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
        transitions: [tr('t1', 'Opportunity Found'), tr('t2', 'Opportunity Not Found')], __name__: 'F' } },
    { id: 't1', type: 'transition', name: 'Opportunity Found', cat: 'transition', parentKey: 'f', parent: 'f', order: 0, attributes: {}, next: null },
    { id: 't2', type: 'transition', name: 'Opportunity Not Found', cat: 'transition', parentKey: 'f', parent: 'f', order: 1, attributes: {}, next: null },
  ];
  assert.equal(gateDocument(wired).errors.filter((e) => e.check === 'MULTIPATH_SHAPE').length, 0);
  // a transition that has lost its template is caught too
  assert.match(gateDocument(wired.slice(0, 2)).errors.find((e) => e.check === 'MULTIPATH_SHAPE').message, /'t2' in next\[\] is not a step/);
  // outside the write's scope it is reported, not blocking
  assert.equal(gateDocument(linear, { scope: new Set(['h']) }).errors.filter((e) => e.check === 'MULTIPATH_SHAPE').length, 0);
});
