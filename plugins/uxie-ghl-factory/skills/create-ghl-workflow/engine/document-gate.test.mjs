import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateDocument, knownAttributeKeys, STEP_TOP_LEVEL_KEYS, BUILDER_TEMPLATE_KEYS, MODEL_KEYS_UNMAPPED_BY_EXTRACTOR } from './document-gate.mjs';
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

// wave22: a branching wait's transition rows carry attributes.type `wait_<wait type>` (Wait.ts:512,536) for every type
// GHL lets a wait branch on (WorkflowValidator.ts:927, carried in workflowRules.vocab.multipathSupportedWaitTypes), plus
// `wait_timeout` for the timeout leg. The census had seen only wait_condition / wait_reply / wait_timeout, so the gate
// refused a builder-authored user_replied / link_clicked / email_event branch.
const transition = (id, type) => ({ id, name: type, type: 'transition', parentKey: 'w', parent: 'w', order: 0, cat: 'transition',
  attributes: { type, description: '' } });
test('transition inner types are derived from the branching-wait vocabulary: every wait_<type> + wait_timeout passes', () => {
  const vocab = catalog.workflowRules.vocab.multipathSupportedWaitTypes;
  assert.ok(vocab.includes('user_replied') && vocab.includes('link_clicked') && vocab.includes('email_event'), JSON.stringify(vocab));
  const rows = [...vocab.map((v, i) => transition(`t${i}`, `wait_${v}`)), transition('tt', 'wait_timeout')];
  const r = gateDocument(rows, { catalog, marketplaceTypes: new Set() });
  assert.deepEqual(r.errors.filter((f) => f.check === 'INNER_TYPE'), [], JSON.stringify(r.errors));
});
test('CONTROL: a transition named for a wait that cannot branch, or for no wait at all, is still refused', () => {
  const r = gateDocument([transition('a', 'wait_time'), transition('b', 'wait_specific_date'), transition('c', 'wait_nonsense')], { catalog, marketplaceTypes: new Set() });
  assert.deepEqual(r.errors.filter((f) => f.check === 'INNER_TYPE').map((f) => f.stepId).sort(), ['a', 'b', 'c']);
});

// wave22 (completeness sweep 2026-09-29 §3 #3): the gate's top-level allowlist was a 09-11 census of 18 keys, so it
// refused keys the builder stores — parentContainerId on every loop-body step, integrationAccountId / testRequest /
// testResponse on every account-bound INTEGRATION_AI step — and publish_workflow (scope null) refused those whole
// workflows. The builder's own step type is the list (models/Workflow.ts WorkflowTemplateBase).
const builderDoc = () => [
  { id: 'L', type: 'loop', name: 'Loop', cat: '', order: 0, next: 'b1', attributes: { type: 'loop', items: '{{inboundWebhookRequest.items}}', exitNext: 'ia' } },
  { id: 'b1', type: 'add_contact_tag', name: 'Tag', cat: '', order: 1, parentKey: 'L', next: 'ia', parentContainerId: 'L', attributes: { type: 'add_contact_tag', tags: ['x'] } },
  { id: 'ia', type: 'lc_linear_create_issue', name: 'Linear', order: 2, parentKey: 'b1', workflowsActionType: 'INTEGRATION_AI', version: '1', stepIndex: 1,
    integrationAccountId: 'acct_1', testRequest: '{}', testResponse: '{}', attributes: { type: 'lc_linear_create_issue' } },
];
test('builder-stored step keys pass the gate on publish (scope null) and edit (scoped): loop body + integration step', () => {
  for (const scope of [null, new Set(['b1'])]) {
    const g = gateDocument(builderDoc(), { catalog, scope, marketplaceTypes: new Set(['lc_linear_create_issue']) });
    assert.deepEqual(g.errors.map((f) => `${f.check} ${f.stepId}`), [], JSON.stringify(g.errors));
    assert.deepEqual(g.warnings.filter((f) => /exitNext/.test(f.message)), [], 'the loop exit pointer is a real builder key');
  }
});
test('every WorkflowTemplateBase key is accepted at the step root', () => {
  for (const k of BUILDER_TEMPLATE_KEYS) assert.ok(STEP_TOP_LEVEL_KEYS.has(k), k);
});
test('CONTROL: an invented top-level key is still refused', () => {
  const doc = builderDoc(); doc[1] = { ...doc[1], inventedRootKey: 1 };
  const g = gateDocument(doc, { catalog, marketplaceTypes: new Set(['lc_linear_create_issue']) });
  assert.deepEqual(g.errors.map((f) => `${f.check} ${f.stepId}`), ['TOP_LEVEL_KEY b1']);
});
// Drift guard: when the captured builder source sits beside this repo, the list must equal the interface's keys.
test('BUILDER_TEMPLATE_KEYS matches the newest captured WorkflowTemplateBase (skipped without the capture)', async (t) => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  // main checkout: six levels up is gohighlevel/; a worktree sits two deeper (plugin/.worktrees/<name>).
  const sniffs = ['../../../../../../knowledge/sniffs/', '../../../../../../../../knowledge/sniffs/']
    .map((r) => decodeURIComponent(new URL(r, import.meta.url).pathname)).find((p) => existsSync(p));
  if (!sniffs) return t.skip('no knowledge/ capture beside this checkout');
  const found = [];
  for (const a of readdirSync(sniffs)) for (const b of ['', ...(existsSync(join(sniffs, a)) && !a.includes('.') ? readdirSync(join(sniffs, a)) : [])]) {
    const f = join(sniffs, a, b, 'recovered-source/src/models/Workflow.ts');
    const m = /bundle-(\d{4}-\d{2}-\d{2}(?:-\d+)?)/.exec(join(a, b));
    if (m && existsSync(f)) found.push([m[1], f]);
  }
  if (!found.length) return t.skip('no captured Workflow.ts');
  const newest = found.sort((x, y) => x[0].localeCompare(y[0])).at(-1)[1];
  const src = readFileSync(newest, 'utf8');
  const body = src.slice(src.indexOf('export interface WorkflowTemplateBase'), src.indexOf('export type AdvanceCanvasMeta'));
  const keys = [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s{2}([A-Za-z_]+)\??:/gm)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...BUILDER_TEMPLATE_KEYS].sort(), newest);
});

// wave22: send_to_eliza's drawer keys (models/actions/SendToEliza.ts) were flagged unknown — the extractor never mapped
// the type to ISendToEliza, so the card had no model fields.
test('send_to_eliza: the drawer keys sendToSpecificUser / userId pass; an invented key does not', () => {
  const step = (attrs) => [{ id: 'e', name: 'Eliza', type: 'send_to_eliza', order: 0, attributes: { type: 'send_to_eliza', ...attrs } }];
  const ok = gateDocument(step({ sendToSpecificUser: true, userId: 'U1' }), { catalog, marketplaceTypes: new Set() });
  assert.deepEqual(ok.errors.concat(ok.warnings).filter((f) => f.check === 'ATTRIBUTE_KEY'), [], JSON.stringify(ok));
  const bad = gateDocument(step({ sendToEveryone: true }), { catalog, marketplaceTypes: new Set() });
  assert.equal(bad.errors.concat(bad.warnings).filter((f) => f.check === 'ATTRIBUTE_KEY').length, 1);
});
test('MODEL_KEYS_UNMAPPED_BY_EXTRACTOR matches ISendToEliza in the newest capture (skipped without it)', async (t) => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs'); const { join } = await import('node:path');
  const sniffs = ['../../../../../../knowledge/sniffs/', '../../../../../../../../knowledge/sniffs/']
    .map((r) => decodeURIComponent(new URL(r, import.meta.url).pathname)).find((p) => existsSync(p));
  if (!sniffs) return t.skip('no knowledge/ capture');
  const found = [];
  for (const a of readdirSync(sniffs)) for (const b of ['', ...(!a.includes('.') ? readdirSync(join(sniffs, a)) : [])]) {
    const f = join(sniffs, a, b, 'recovered-source/src/models/actions/SendToEliza.ts'); const m = /bundle-(\d{4}-\d{2}-\d{2}(?:-\d+)?)/.exec(join(a, b));
    if (m && existsSync(f)) found.push([m[1], f]);
  }
  if (!found.length) return t.skip('no captured SendToEliza.ts');
  const src = readFileSync(found.sort((x, y) => x[0].localeCompare(y[0])).at(-1)[1], 'utf8');
  const body = src.slice(src.indexOf('export interface ISendToEliza'), src.indexOf('}', src.indexOf('export interface ISendToEliza')));
  assert.deepEqual([...body.matchAll(/^\s+([A-Za-z_]+)\??:/gm)].map((m) => m[1]).sort(), [...MODEL_KEYS_UNMAPPED_BY_EXTRACTOR.send_to_eliza].sort());
});

test('update_appointment_status rental partial WARNS (drawer cannot show it); appointment partial does not', () => {
  const st = (category) => [{ id: 'u', name: 'Status', type: 'update_appointment_status', order: 0, attributes: { type: 'update_appointment_status', category, status_type: 'partial' } }];
  const w = gateDocument(st('rental_booking'), { catalog, marketplaceTypes: new Set() }).warnings.filter((f) => f.check === 'DRAWER_CANNOT_SHOW');
  assert.equal(w.length, 1); assert.match(w[0].message, /cannot display 'partial' for rental appointments/);
  assert.equal(gateDocument(st('service_booking'), { catalog, marketplaceTypes: new Set() }).warnings.filter((f) => f.check === 'DRAWER_CANNOT_SHOW').length, 0);
});

// wave23 W23-1: a builder-made agent carrying a template, an MCP server, Skills or the guard switch was refused on
// publish and on in-scope edits ("an invented key"). The four drawer keys are known; an invented one still is not.
test('ai_agent: the drawer keys pass the gate; an invented key on the same step is still an ATTRIBUTE_KEY error', () => {
  const agent = (extra) => [{ id: 'a1', name: 'Agent', type: 'ai_agent', order: 0, attributes: { prompt: 'p', model: 'm', tools: [],
    outputFormat: 'text', outputDescription: '', memoryEnabled: false, ...extra } }];
  const keyErr = (tpl) => gateDocument(tpl, { catalog, marketplaceTypes: new Set() }).errors.filter((f) => f.check === 'ATTRIBUTE_KEY');
  assert.deepEqual(keyErr(agent({ templateId: 'tpl', mcpConnections: [], skills: [{ id: 'builtin:x', name: 'X' }], disableToolOutputGuards: true })), []);
  const bad = keyErr(agent({ templateId: 'tpl', agentName: 'x' }));
  assert.equal(bad.length, 1); assert.match(bad[0].message, /\[agentName\]/);
});
